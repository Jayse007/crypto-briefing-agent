import axios from 'axios';
import 'dotenv/config';

const SYNAPSE_RPC = process.env.SYNAPSE_RPC_URL!;
const SENTINEL_AGENT = 'Ccr2yK3hLALU4p8oNRqrh4dGuvPJTth5KCLMio8cE1ph';

export interface SentinelResult {
  checked: boolean;
  agentActive: boolean;
  timestamp: string;
}

/**
 * Checks in with Synapse Sentinel — the network's monitoring agent.
 * This demonstrates your agent uses the SAP network's services,
 * not just for payments but for coordination.
 * 
 * Under the hood, Sentinel is just another registered agent on SAP.
 * "Checking in" means fetching its on-chain account data via RPC.
 */
export async function checkSentinel(): Promise<SentinelResult> {
  console.log('[Sentinel] Checking Synapse Sentinel...');

  try {
    // The simplest way to check Sentinel — fetch its account from Synapse RPC
    // This proves you're using Synapse RPC (not another provider) 
    // and interacting with the SAP network.
    
    // We use the Synapse RPC endpoint directly for this check.
    // Sentinel's wallet is the public key above.
    
    const response = await axios.post(
      SYNAPSE_RPC,
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'getAccountInfo',
        params: [
          SENTINEL_AGENT,
          { encoding: 'base64' }
        ],
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000,
      }
    );

    const accountExists = response.data?.result?.value !== null;

    console.log(`[Sentinel] Check complete. Agent active: ${accountExists}`);
    return {
      checked: true,
      agentActive: accountExists,
      timestamp: new Date().toISOString(),
    };

  } catch (error: any) {
    console.error('[Sentinel] Error checking sentinel:', error.message);
    return {
      checked: false,
      agentActive: false,
      timestamp: new Date().toISOString(),
    };
  }
}