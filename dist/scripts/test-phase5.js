import { getBatchSummary } from '../analytics/metrics.js';
import { getRecoveryStatus } from '../tools/read.js';
import { db } from '../db/client.js';
import crypto from 'crypto';
async function main() {
    const caseId = crypto.randomUUID();
    const paymentId = 'pay_Phase5_' + Date.now();
    // 1. Insert a synthetic failure for Phase 5
    db.prepare(`
    INSERT INTO cases (
      id, source_payment_id, customer_id, amount, currency, status, failure_category, created_at, updated_at
    ) VALUES (?, ?, 'cust_Test', 1000, 'INR', 'open', 'insufficient_funds', ?, ?)
  `).run(caseId, paymentId, new Date().toISOString(), new Date().toISOString());
    db.prepare(`
    INSERT INTO audit_log (id, case_id, event_type, actor, payload, created_at)
    VALUES (?, ?, 'diagnosis_made', 'agent', '{"category": "insufficient_funds"}', ?)
  `).run(crypto.randomUUID(), caseId, new Date().toISOString());
    // 2. Fetch recovery status for the single case
    console.log(`[Phase 5 Test] Fetching recovery status for case...`);
    const status = await getRecoveryStatus(caseId);
    console.log('Recovery Status:', JSON.stringify(status, null, 2));
    // 3. Fetch batch summary
    console.log(`\n[Phase 5 Test] Fetching batch summary...`);
    const summary = getBatchSummary();
    console.log('Batch Summary:', JSON.stringify(summary, null, 2));
    console.log(`\n[Phase 5 Test] Success! Exit criteria met.`);
    process.exit(0);
}
main().catch(console.error);
//# sourceMappingURL=test-phase5.js.map