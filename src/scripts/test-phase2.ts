import { db } from '../db/client.js';
import { classifyFailure, estimateRecoveryProbability, selectRecoveryAction } from '../tools/diagnose.js';
import crypto from 'crypto';

async function main() {
  const caseId = crypto.randomUUID();
  const paymentId = 'pay_TestPhase2_' + Date.now();
  
  // 1. Insert a synthetic failure
  db.prepare(`
    INSERT INTO cases (
      id, source_payment_id, customer_id, amount, currency, status, failure_category, created_at, updated_at
    ) VALUES (?, ?, 'cust_Test', 1000, 'INR', 'open', 'insufficient_funds', ?, ?)
  `).run(caseId, paymentId, new Date().toISOString(), new Date().toISOString());

  console.log(`Inserted synthetic case: ${caseId} with raw failure_category: insufficient_funds`);

  // 2. Classify failure
  const classifyResult = await classifyFailure(paymentId);
  console.log('Classify Result:', classifyResult);

  // Verify DB updated
  let caseRow = db.prepare('SELECT failure_category FROM cases WHERE id = ?').get(caseId) as any;
  console.log('DB failure_category updated to:', caseRow.failure_category);

  // 3. Estimate probability
  const probResult = await estimateRecoveryProbability(caseId);
  console.log('Probability Result:', probResult);

  // Verify DB updated
  caseRow = db.prepare('SELECT recovery_probability, expected_recovery_value FROM cases WHERE id = ?').get(caseId) as any;
  console.log('DB recovery_probability updated to:', caseRow.recovery_probability);
  console.log('DB expected_recovery_value updated to:', caseRow.expected_recovery_value);

  // 4. Select recovery action
  const actionResult = await selectRecoveryAction(caseId);
  console.log('Action Result:', actionResult);

  // Verify DB updated
  caseRow = db.prepare('SELECT recommended_action FROM cases WHERE id = ?').get(caseId) as any;
  console.log('DB recommended_action updated to:', caseRow.recommended_action);

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
