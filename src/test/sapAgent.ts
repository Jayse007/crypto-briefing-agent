/**
 * test/sapAgent.ts
 *
 * Three-phase test for sapAgent.ts against v0.9.2 of the SDK.
 *
 * Phase 1 — SDK import (no env needed)
 *   Confirms the ESM import from ./core works without crashing.
 *
 * Phase 2 — Client creation (requires .env)
 *   Confirms SapConnection.mainnet() + conn.fromKeypair() works and
 *   prints the available API surface on the client.
 *
 * Phase 3 — Live mainnet calls (requires SOL in wallet)
 *   --register : calls registerAgent() + verifyAgent()
 *   --write    : calls writeBriefingToChain() + reportAgentCycle()
 *
 * Usage:
 *   npm run test:agent-reg                               # phases 1 + 2
 *   npx ts-node src/test/sapAgent.ts --register          # + registration
 *   npx ts-node src/test/sapAgent.ts --write             # + session write
 */

import 'dotenv/config';
import { SapConnection } from '@oobe-protocol-labs/synapse-sap-sdk';
import { Keypair }        from '@solana/web3.js';
import {
  registerAgent,
  verifyAgent,
  writeBriefingToChain,
  reportAgentCycle,
} from '../sapAgent.ts';

const SYNAPSE_RPC  = process.env['SYNAPSE_RPC_URL']!;
const KEYPAIR_JSON = process.env['AGENT_KEYPAIR']!;
const args         = process.argv.slice(2);

// ─── Phase 1 — SDK import ────────────────────────────────────────────────────

async function phase1_sdkImport() {
  console.log('════════════════════════════════════════════════════════');
  console.log('Phase 1 — ESM import from @oobe-protocol-labs/synapse-sap-sdk/core');
  console.log('════════════════════════════════════════════════════════\n');

  // If this line doesn't crash, the ESM import is working
  console.log('SapConnection type :', typeof SapConnection);
  console.log('SapConnection.mainnet :', typeof (SapConnection as any).mainnet);
  console.log('SapConnection.devnet  :', typeof (SapConnection as any).devnet);

  const methods = Object.getOwnPropertyNames(SapConnection)
    .filter(k => k !== 'length' && k !== 'prototype' && k !== 'name');
  console.log('Static methods :', methods.join(', '));

  console.log('\nPhase 1 PASSED ✓ — ESM import works\n');
}

// ─── Phase 2 — Client creation ───────────────────────────────────────────────

async function phase2_clientCreation() {
  console.log('════════════════════════════════════════════════════════');
  console.log('Phase 2 — SapConnection.mainnet() + fromKeypair()');
  console.log('════════════════════════════════════════════════════════\n');

  if (!KEYPAIR_JSON) { console.error('✗ AGENT_KEYPAIR not in .env'); process.exit(1); }
  if (!SYNAPSE_RPC)  { console.error('✗ SYNAPSE_RPC_URL not in .env'); process.exit(1); }

  const raw     = JSON.parse(KEYPAIR_JSON) as number[];
  const keypair = Keypair.fromSecretKey(new Uint8Array(raw));
  console.log('Agent wallet :', keypair.publicKey.toBase58());

  // Test the connection call used in sapAgent.ts
  let conn: any;
  try {
    conn = (SapConnection as any).mainnet(SYNAPSE_RPC);
    console.log('✓ SapConnection.mainnet(rpcUrl) succeeded');
  } catch (err: any) {
    // Fallback — try without URL arg (some versions ignore the arg)
    try {
      conn = (SapConnection as any).mainnet();
      console.log('✓ SapConnection.mainnet() succeeded (no URL arg)');
      console.log('  Note: update getClient() in sapAgent.ts to pass rpcUrl differently');
    } catch (err2: any) {
      console.error('✗ SapConnection.mainnet() failed:', err2.message);
      process.exit(1);
    }
  }

  let client: any;
  try {
    client = conn.fromKeypair(keypair);
    console.log('✓ conn.fromKeypair(keypair) succeeded');
  } catch (err: any) {
    console.error('✗ conn.fromKeypair() failed:', err.message);
    process.exit(1);
  }

  // Print available top-level API
  const topKeys = Object.getOwnPropertyNames(Object.getPrototypeOf(client))
    .filter(k => k !== 'constructor');
  console.log('\nClient prototype methods :', topKeys.join(', '));

  // Check high-level APIs we depend on
  const checks: [string, boolean][] = [
    ['client.builder',        !!client.builder],
    ['client.session',        !!client.session],
    ['client.agent',          !!client.agent],
    ['client.session.start',  typeof client.session?.start  === 'function'],
    ['client.session.write',  typeof client.session?.write  === 'function'],
    ['client.session.close',  typeof client.session?.close  === 'function'],
    ['client.builder.agent',  typeof client.builder?.agent  === 'function'],
  ];

  console.log('\nAPI surface check:');
  let allOk = true;
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? '✓' : '✗'} ${name}`);
    if (!ok) allOk = false;
  }

  if (!allOk) {
    console.error('\n✗ Some APIs missing — paste this output for diagnosis');
    process.exit(1);
  }

  console.log('\nPhase 2 PASSED ✓\n');
}

// ─── Phase 3a — Registration ─────────────────────────────────────────────────

async function phase3a_register() {
  console.log('════════════════════════════════════════════════════════');
  console.log('Phase 3a — registerAgent() + verifyAgent()');
  console.log('════════════════════════════════════════════════════════');
  console.log('⚠ Live mainnet write — requires SOL in your wallet\n');

  await registerAgent();
  await verifyAgent();

  console.log('\nView on Explorer: https://explorer.oobeprotocol.ai');
  console.log('Phase 3a PASSED ✓\n');
}

// ─── Phase 3b — Session write ────────────────────────────────────────────────

async function phase3b_write() {
  console.log('════════════════════════════════════════════════════════');
  console.log('Phase 3b — writeBriefingToChain() + reportAgentCycle()');
  console.log('════════════════════════════════════════════════════════');
  console.log('⚠ Live mainnet write — requires SOL in your wallet\n');

  // Minimal fixture — same shape as a real pipeline output
  const brief = {
    headline:   'Test briefing — sapAgent test suite',
    summary:    'This is a test write to confirm the session ledger works end-to-end.',
    topStories: ['Story A', 'Story B', 'Story C'],
    sentiment:  'neutral' as const,
    timestamp:  new Date().toISOString(),
  };
  const image = {
    url:     'https://placehold.co/1024x1024?text=Test',
    prompt:  'test prompt',
    success: false,
  };

  const txSig = await writeBriefingToChain(brief, image, 'test-payment-tx');
  console.log('\nWrite TX :', txSig);

  await reportAgentCycle();

  console.log('\nView on Explorer: https://explorer.oobeprotocol.ai');
  console.log('Phase 3b PASSED ✓\n');
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  await phase1_sdkImport();
  await phase2_clientCreation();

  if (args.includes('--register')) await phase3a_register();
  if (args.includes('--write'))    await phase3b_write();

  if (!args.includes('--register') && !args.includes('--write')) {
    console.log('Phases 1+2 complete. Run with --register or --write for live calls.');
  }
}
main().catch(err => {
  console.error('\ntest:sap FAILED ✗');
  console.error(err);
  process.exit(1);
});