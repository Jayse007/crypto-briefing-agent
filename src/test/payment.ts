import assert from 'node:assert/strict';
import { settleAceDataPayment } from '../payment.ts';

async function main() {
  console.log('─── test:payment ───────────────────────────────────────\n');

  const result = await settleAceDataPayment(['scrape', 'summarize', 'image'], 'test-run-000');

  console.log('Payment result:', JSON.stringify(result, null, 2));

  assert.strictEqual(result.success, true, 'Expected payment settlement to succeed');
  assert.strictEqual(result.callsSettled, 0, 'Expected no x402 settlements in an isolated test run');
  assert.strictEqual(result.txHash, 'credits-test-run-000', 'Expected credits fallback txHash');

  console.log('\ntest:payment PASSED ✓');
}

main().catch((err) => {
  console.error('\ntest:payment FAILED ✗');
  console.error(err);
  process.exit(1);
});
