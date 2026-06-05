import 'dotenv/config';
import assert from 'node:assert/strict';
import { generateBriefSummary } from '../summarizer.ts';

async function main() {
  console.log('─── test:summarizer ─────────────────────────────────────\n');

  const rawNews = `Solana validators upgraded to the latest stable release.\n
  A new DeFi protocol announced a $30M TVL milestone on Solana.\n
  Market sentiment remains mixed as SOL trades near $150.`;

  const brief = await generateBriefSummary(rawNews);

  console.log('Brief:', JSON.stringify(brief, null, 2));

  assert.ok(typeof brief.headline === 'string' && brief.headline.length > 0, 'headline should be populated');
  assert.ok(typeof brief.summary === 'string' && brief.summary.length > 0, 'summary should be populated');
  assert.ok(Array.isArray(brief.topStories), 'topStories should be an array');
  assert.ok(
    ['bullish', 'bearish', 'neutral'].includes(brief.sentiment),
    'sentiment should be one of bullish, bearish, or neutral'
  );
  assert.ok(typeof brief.timestamp === 'string' && brief.timestamp.length > 0, 'timestamp should be populated');

  console.log('\ntest:summarizer PASSED ✓');
}

main().catch((err) => {
  console.error('\ntest:summarizer FAILED ✗');
  console.error(err);
  process.exit(1);
});
