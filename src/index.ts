import 'dotenv/config';
import { fetchSolanaNews, formatResultsForLLM } from './scraper.ts';
import { generateBriefSummary } from './summarizer.ts';
import { generateBriefingCard } from './imageGen.ts';
import { checkSentinel } from './sentinel.ts';
import { registerAgent, writeBriefingToChain, reportAgentCycle } from './sapAgent.ts';
import { settleAceDataPayment } from './payment.ts';

/**
 * THE MAIN AGENT RUN
 * 
 * This function is called once per cron trigger.
 * It runs the complete workflow: trigger → execution → payment
 * with zero human intervention.
 * 
 * Think of it as a cron job that calls several external APIs,
 * writes a result to a database (on-chain), and logs a payment.
 */
async function runAgent(): Promise<void> {
  const runId = `run-${Date.now()}`;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[Agent] Starting run ${runId}`);
  console.log(`[Agent] Time: ${new Date().toISOString()}`);
  console.log(`${'='.repeat(60)}\n`);

  try {
    // ── STEP 0: Register on SAP mainnet (only does work on first run) ──
    await registerAgent();

    // ── STEP 1: Check Synapse Sentinel (network health check) ──
    const sentinelResult = await checkSentinel();
    console.log('[Agent] Sentinel status:', sentinelResult.agentActive ? 'Active ✓' : 'Offline');

    // ── STEP 2: Scrape Solana news (AceData Service #1) ──
    const rawResults = await fetchSolanaNews();
    const formattedNews = formatResultsForLLM(rawResults);
    
    if (rawResults.length === 0) {
      console.warn('[Agent] No news fetched — will generate brief from fallback data');
    }

    // ── STEP 3: Generate LLM summary (AceData Service #2) ──
    const brief = await generateBriefSummary(formattedNews);
    console.log('[Agent] Brief headline:', brief.headline);
    console.log('[Agent] Sentiment:', brief.sentiment);

    // ── STEP 4: Generate visual card (AceData Service #3) ──
    const image = await generateBriefingCard(brief.headline, brief.sentiment);
    console.log('[Agent] Image generated:', image.success ? '✓' : '✗ (fallback)');

    // ── STEP 5: Settle x402 payment via AceData facilitator ──
    const servicesUsed = ['web-search', 'chat-completion', 'image-generation'];
    const payment = await settleAceDataPayment(servicesUsed, runId);
    console.log('[Agent] Payment settled:', payment.success ? '✓' : '✗ (pending)');
    console.log('[Agent] Payment TX:', payment.txHash);

    // ── STEP 6: Write briefing to on-chain memory (SAP ledger) ──
    const onChainTx = await writeBriefingToChain(brief, image, payment.txHash);
    console.log('[Agent] On-chain write TX:', onChainTx);

    // ── STEP 7: Report the completed cycle ──
    await reportAgentCycle();

    // ── FINAL: Print the briefing ──
    console.log('\n' + '─'.repeat(60));
    console.log('SOLANA DAILY BRIEF');
    console.log('─'.repeat(60));
    console.log(`Headline: ${brief.headline}`);
    console.log(`Sentiment: ${brief.sentiment.toUpperCase()}`);
    console.log(`Summary: ${brief.summary}`);
    if (brief.topStories.length > 0) {
      console.log('Top Stories:');
      brief.topStories.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
    }
    console.log(`Image: ${image.url}`);
    console.log(`Payment TX: ${payment.txHash}`);
    console.log(`On-chain TX: ${onChainTx}`);
    console.log('─'.repeat(60));
    console.log(`[Agent] Run ${runId} complete ✓\n`);

  } catch (error: any) {
    // Top-level catch — log but don't crash so GitHub Actions doesn't fail
    console.error('[Agent] FATAL ERROR in run:', error.message);
    console.error(error.stack);
    process.exit(1);  // Non-zero exit so GitHub Actions marks it as failed
  }
}

// Run immediately
runAgent();