import 'dotenv/config';
import assert from 'node:assert/strict';
import { generateBriefingCard } from '../imageGen.ts';

async function main() {
  console.log('─── test:imageGen ───────────────────────────────────────\n');

  const result = await generateBriefingCard(
    'Solana rally fuels DeFi demand across the network',
    'bullish'
  );

  console.log('Result:', JSON.stringify(result, null, 2));

  assert.ok(
    typeof result.url === 'string' && result.url.length > 0,
    'Expected a non-empty image URL'
  );
  assert.ok(
    typeof result.prompt === 'string' && result.prompt.length > 0,
    'Expected a non-empty prompt'
  );
  assert.ok(
    typeof result.success === 'boolean',
    'Expected success to be a boolean value'
  );

  console.log('\ntest:imageGen PASSED ✓');
}

main().catch((err) => {
  console.error('\ntest:imageGen FAILED ✗');
  console.error(err);
  process.exit(1);
});
