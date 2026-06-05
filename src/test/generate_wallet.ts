import 'dotenv/config';
import { Keypair, PublicKey } from '@solana/web3.js';



const KEYPAIR_JSON = process.env.AGENT_KEYPAIR!;
const raw = JSON.parse(KEYPAIR_JSON) as number[];
const _keypair = Keypair.fromSecretKey(Uint8Array.from(raw));

console.log(`[SAP] Loaded keypair: ${_keypair.publicKey.toBase58()}`);
console.log(_keypair);