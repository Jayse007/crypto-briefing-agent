/**
 * test-scraper.ts
 *
 * Manual smoke-test for scraper.ts.
 * Run with: npm run test:scraper
 *
 * What a passing run looks like:
 *   [Payment] AceDataCloud client initialised with x402 Solana handler
 *   [Scraper] Fetching Solana news via AceData SERP API...
 *   [Scraper] Got N unique results across 3 queries
 *   [
 *     { title: '...', snippet: '...', url: 'https://...' },
 *     ...
 *   ]
 *
 * What a failing run looks like:
 *   [Scraper] A query failed: SERP API error 401: {"error":"Unauthorized"}
 *   → Check ACEDATA_API_KEY in your .env
 *
 *   [Scraper] Got 0 unique results across 3 queries
 *   → Key is valid but returned no hits — try broadening the query in scraper.ts
 */

import 'dotenv/config';
import { fetchSolanaNews, formatResultsForLLM } from '../scraper.ts';

async function main() {
  console.log('─── test:scraper ───────────────────────────────────────\n');

  const results = await fetchSolanaNews();

  console.log('\n─── Raw results ────────────────────────────────────────');
  console.log(JSON.stringify(results, null, 2));

  console.log('\n─── Formatted for LLM ──────────────────────────────────');
  console.log(formatResultsForLLM(results));

  console.log('\n─── Summary ────────────────────────────────────────────');
  console.log(`Total results: ${results.length}`);
  console.log('test:scraper PASSED ✓');
}

main().catch((err) => {
  console.error('\ntest:scraper FAILED ✗');
  console.error(err);
  process.exit(1);
});