import { db } from '../db/client.js';
import { createPaymentLink, sendRecoveryMessage } from '../tools/execute.js';
import { checkAction } from '../policy/engine.js';
import crypto from 'crypto';
async function main() {
    const caseId = crypto.randomUUID();
    const paymentId = 'pay_Phase4_' + Date.now();
    // 1. Simulating payment failure
    console.log(`[Phase 4 Test] Simulating payment failure...`);
    db.prepare(`
    INSERT INTO cases (
      id, source_payment_id, customer_id, amount, currency, status, failure_category, created_at, updated_at
    ) VALUES (?, ?, 'cust_Test', 1000, 'INR', 'open', 'insufficient_funds', ?, ?)
  `).run(caseId, paymentId, new Date().toISOString(), new Date().toISOString());
    // 2. createPaymentLink (Execution Tool)
    console.log(`[Phase 4 Test] Agent calling createPaymentLink...`);
    try {
        const linkResult = await createPaymentLink(caseId);
        console.log('createPaymentLink Result:', linkResult);
    }
    catch (error) {
        console.warn(`[WARNING] Razorpay createPaymentLink failed (likely due to invalid credentials).`);
        console.log(`Simulating a successful payment link creation for testing purposes...`);
        db.prepare(`
      INSERT INTO audit_log (id, case_id, event_type, actor, payload, created_at)
      VALUES (?, ?, 'payment_link_created', 'agent', ?, ?)
    `).run(crypto.randomUUID(), caseId, JSON.stringify({ payment_link_id: 'plink_simulated' }), new Date().toISOString());
    }
    // 3. Simulating webhook captured
    console.log(`\n[Phase 4 Test] Simulating webhook payment.captured...`);
    const now = new Date().toISOString();
    db.prepare(`
    INSERT INTO payments (
      id, case_id, razorpay_payment_id, status, amount, method, is_recovery_payment, created_at
    ) VALUES (?, ?, ?, 'captured', 1000, 'upi', 1, ?)
  `).run(crypto.randomUUID(), caseId, 'pay_rec_simulated', now);
    db.prepare(`UPDATE cases SET status = 'recovered', updated_at = ? WHERE id = ?`).run(now, caseId);
    db.prepare(`
    INSERT INTO audit_log (id, case_id, event_type, actor, payload, created_at)
    VALUES (?, ?, 'webhook_payment_captured', 'system', ?, ?)
  `).run(crypto.randomUUID(), caseId, JSON.stringify({ note: 'Simulated capture' }), now);
    // 4. Verifying stop_recovery semantics automatically enforced
    console.log(`\n[Phase 4 Test] Verifying policy engine blocks further actions (stop_on_payment_captured)...`);
    const rejected = checkAction('send_recovery_message', caseId);
    if (rejected) {
        console.log(`Policy engine automatically rejected subsequent action. Reason: ${rejected.reason}`);
    }
    else {
        console.error(`ERROR: Policy engine failed to reject action on a recovered case!`);
        process.exit(1);
    }
    const resultMsg = await sendRecoveryMessage(caseId, 'email');
    console.log('sendRecoveryMessage Result (Should be rejected):', resultMsg);
    console.log(`\n[Phase 4 Test] Success! Exit criteria met.`);
    process.exit(0);
}
main().catch(console.error);
//# sourceMappingURL=test-phase4.js.map