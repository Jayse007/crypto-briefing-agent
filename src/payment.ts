/**
 * payment.ts
 *
 * Handles all three AceData API calls (scrape, LLM, image) AND x402 payment
 * settlement — rewritten against the real @acedatacloud/x402-client SDK.
 *
 * ─── What the README actually tells us ───────────────────────────────────────
 *
 * The @acedatacloud/x402-client package works in two ways:
 *
 * 1. HIGH-LEVEL (recommended): Wrap the AceDataCloud SDK with a paymentHandler.
 *    The SDK fires the request, gets a 402, calls your paymentHandler to sign
 *    the X-Payment header, then retries automatically. You never touch HTTP.
 *
 *      const client = new AceDataCloud({
 *        paymentHandler: createX402PaymentHandler({ network, solanaWallet }),
 *      });
 *      await client.openai.chat.completions.create({ ... });
 *
 * 2. LOW-LEVEL: Call signSolanaPayment() / signEVMPayment() yourself and
 *    attach the result as a base64 X-Payment header on a raw fetch/axios call.
 *
 *      const envelope = await signSolanaPayment(paymentRequirement, wallet);
 *      const header   = btoa(JSON.stringify(envelope));
 *
 * ─── Which path we use ───────────────────────────────────────────────────────
 *
 * We are a Node.js backend agent. The AceData docs show that the Solana path
 * needs a "wallet adapter with signTransaction()" — which is exactly what a
 * Solana keypair provides. We build a minimal wallet shim from the raw keypair
 * bytes stored in AGENT_KEYPAIR, pass it to createX402PaymentHandler, and let
 * the SDK handle the 402 → sign → retry loop for every AceData API call.
 *
 * This file therefore does two things:
 *   a) Exports `getAceDataClient()` — a singleton AceDataCloud client with x402
 *      wired in. All three API modules (scraper, summarizer, imageGen) should
 *      import this instead of building their own axios instances, so that every
 *      request is automatically paid via x402.
 *   b) Exports `settleAceDataPayment()` — kept for backward compatibility with
 *      index.ts. After all three AceData calls complete, this function reads the
 *      x402 transaction hashes that the SDK stored during those calls, packages
 *      them into a PaymentResult, and returns it so index.ts can write the hash
 *      to the SAP ledger.
 *
 * ─── Install ─────────────────────────────────────────────────────────────────
 *
 *   npm install @acedatacloud/sdk @acedatacloud/x402-client @solana/web3.js
 *
 * Note: @solana/web3.js is required HERE as a peer dep of @acedatacloud/x402-client
 * for Solana signing. It is NOT imported in sapAgent.ts (which uses @solana/kit).
 * Having both in package.json is intentional and safe.
 *
 * ─── .env additions ──────────────────────────────────────────────────────────
 *
 *   AGENT_KEYPAIR=[12,34,...]   ← same 64-byte array already used by sapAgent.ts
 *   ACEDATA_API_KEY=Bearer ...  ← already present; used as the platform token
 *
 * No EVM private key is needed — we pay on Solana, not Base.
 */

import { AceDataCloud } from '@acedatacloud/sdk';
import {
  createX402PaymentHandler,
  type X402PaymentHandler,
} from '@acedatacloud/x402-client';

// @solana/web3.js is used ONLY here as a peer dep of x402-client for signing.
// Do not import it in sapAgent.ts.
import { Keypair, Transaction, VersionedTransaction } from '@solana/web3.js';
import 'dotenv/config';

// ─── env ─────────────────────────────────────────────────────────────────────

const KEYPAIR_JSON = process.env.AGENT_KEYPAIR!;
const ACEDATA_KEY  = process.env.ACEDATA_API_KEY!; // "Bearer platform-v1-xxxx"

// ─── types ───────────────────────────────────────────────────────────────────

export interface PaymentResult {
  /** On-chain tx hash(es) from the x402 settlements that ran during this cycle. */
  txHash: string;
  success: boolean;
  /** Number of AceData API calls settled this cycle. */
  callsSettled: number;
}

// ─── wallet shim ─────────────────────────────────────────────────────────────

/**
 * Builds a minimal Solana wallet adapter object from raw keypair bytes.
 *
 * The @acedatacloud/x402-client Solana path calls wallet.signTransaction()
 * to produce the SPL USDC transfer signature for the X-Payment header.
 * A Solana CLI keypair implements this interface natively, so we just wrap
 * the raw bytes from AGENT_KEYPAIR in a Keypair and expose the two methods
 * the SDK needs.
 *
 * This shim is intentionally minimal — it only implements what
 * createX402PaymentHandler({ network: 'solana', solanaWallet }) actually calls.
 */
function buildSolanaWallet(keypairBytes: Uint8Array) {
  const kp = Keypair.fromSecretKey(keypairBytes);

  return {
    publicKey: kp.publicKey,

    /** Signs a legacy Transaction — called by x402-client for SPL transfer. */
    async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
      if (tx instanceof VersionedTransaction) {
        tx.sign([kp]);
      } else {
        tx.sign(kp);
      }
      return tx;
    },

    /** Signs a batch — required by the WalletAdapter interface. */
    async signAllTransactions<T extends Transaction | VersionedTransaction>(
      txs: T[]
    ): Promise<T[]> {
      return Promise.all(txs.map((tx) => this.signTransaction(tx)));
    },
  };
}

// ─── x402 transaction log ────────────────────────────────────────────────────

/**
 * Collects x402 transaction hashes as the SDK settles each AceData API call.
 * index.ts reads this at the end of each cycle via getLastCycleTxHashes().
 */
const _txLog: string[] = [];

function recordTx(txHash: string) {
  _txLog.push(txHash);
}

/** Returns and clears the tx hashes recorded since the last call. */
function drainTxLog(): string[] {
  return _txLog.splice(0);
}

// ─── singleton AceDataCloud client ───────────────────────────────────────────

let _aceClient: AceDataCloud | null = null;

/**
 * Returns a singleton AceDataCloud client with x402 payment wired in.
 *
 * ALL AceData API calls (scraper, summarizer, imageGen) should go through
 * this client. When the server returns 402, the SDK calls paymentHandler
 * automatically, signs the X-Payment header with our Solana keypair,
 * retries the request, and resolves with the 200 response. No manual
 * retry logic needed in the calling code.
 *
 * Usage in scraper.ts (replaces raw axios):
 *
 *   import { getAceDataClient } from './payment';
 *   const client = await getAceDataClient();
 *   const res = await client.fetch('https://api.acedata.cloud/web/search', {
 *     method: 'POST',
 *     body: JSON.stringify({ query: '...' }),
 *   });
 *
 * Or — if you want to keep using axios in scraper/summarizer/imageGen —
 * the low-level option below shows how to attach X-Payment manually.
 */
export async function getAceDataClient(): Promise<AceDataCloud> {
  if (_aceClient) return _aceClient;
  

  const raw  = JSON.parse(KEYPAIR_JSON) as number[];
  const wallet = buildSolanaWallet(new Uint8Array(raw));
  
  
  // Strip "Bearer " prefix if present — AceDataCloud SDK wants the raw token.
  const platformToken = ACEDATA_KEY.replace(/^Bearer\s+/i, '');

  // createX402PaymentHandler wires up the 402 → sign → retry loop.
  // On Solana it uses SPL USDC via the x402 Solana scheme.
  // The facilitator is https://facilitator.acedata.cloud (hardcoded in the SDK).
  const paymentHandler: X402PaymentHandler = createX402PaymentHandler({
    network: 'solana',
    solanaWallet: wallet,
    // Called after every successful settlement so we can log the tx hash.
    onPaymentSettled: ({ txHash }) => {
      if (txHash) {
        console.log(`[Payment] x402 settled — Solana tx: ${txHash}`);
        recordTx(txHash);
      }
    },
  });

  _aceClient = new AceDataCloud({
    // The platform token authenticates you to AceData's API gateway.
    // x402 kicks in when the free-tier credits run out; until then the
    // SDK uses the token and skips the payment flow.
    apiToken: platformToken,
    paymentHandler,
  });

  console.log('[Payment] AceDataCloud client initialised with x402 Solana handler');
  return _aceClient;
}

// ─── public API (called by index.ts) ─────────────────────────────────────────

/**
 * Called at the end of each agent cycle by index.ts.
 *
 * Drains the tx hash log populated by onPaymentSettled callbacks and
 * packages them into a PaymentResult. If the free-tier credits covered
 * all three calls (no 402 was returned), txHash will be 'credits-used'
 * and success is still true — the agent ran correctly, just without
 * on-chain settlement this cycle.
 *
 * @param servicesUsed - Array of service names, for logging only.
 * @param runId        - Unique run identifier, used as fallback txHash.
 */
export async function settleAceDataPayment(
  servicesUsed: string[],
  runId: string
): Promise<PaymentResult> {
  console.log(`[Payment] Collecting x402 receipts for run ${runId}...`);
  console.log(`[Payment] Services used this cycle: ${servicesUsed.join(', ')}`);

  const hashes = drainTxLog();

  if (hashes.length > 0) {
    // One or more AceData calls triggered a real x402 settlement.
    const combined = hashes.join(',');
    console.log(`[Payment] ${hashes.length} on-chain settlement(s): ${combined}`);
    return {
      txHash: combined,
      success: true,
      callsSettled: hashes.length,
    };
  }

  // No 402 was triggered — free-tier credits absorbed the cost.
  // This is not a failure; the agent ran correctly.
  console.log('[Payment] No x402 settlements this cycle (free-tier credits used)');
  return {
    txHash: `credits-${runId}`,
    success: true,
    callsSettled: 0,
  };
}

// ─── low-level option (alternative to getAceDataClient) ──────────────────────
//
// If you prefer to keep raw axios in scraper.ts / summarizer.ts / imageGen.ts
// and attach X-Payment manually, use signSolanaPayment from the SDK:
//
//   import { signSolanaPayment } from '@acedatacloud/x402-client';
//
//   // 1. Make the first request without X-Payment to get the 402 body.
//   const probe = await axios.post(url, body, { validateStatus: () => true });
//   if (probe.status !== 402) { /* already paid with credits */ return probe; }
//
//   // 2. Pick the Solana requirement from the accepts array.
//   const req = probe.data.accepts.find((r: any) => r.network === 'solana');
//
//   // 3. Sign the payment envelope.
//   const raw    = JSON.parse(KEYPAIR_JSON) as number[];
//   const wallet = buildSolanaWallet(new Uint8Array(raw));
//   const envelope = await signSolanaPayment(req, wallet);
//   const header   = btoa(JSON.stringify(envelope));
//
//   // 4. Retry with X-Payment header.
//   const final = await axios.post(url, body, {
//     headers: { 'X-Payment': header },
//   });
//   const receipt = final.headers['x-payment-response'];
//   // Decode with decodePaymentResponse(receipt) from '@acedatacloud/x402-client'