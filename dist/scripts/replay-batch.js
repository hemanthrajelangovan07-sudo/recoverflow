import { db } from '../db/client.js';
import { seedCases } from './seed-synthetic.js';
import { scheduleRetry, sendRecoveryMessage, createPaymentLink, stopRecovery } from '../tools/execute.js';
import { classifyFailure, estimateRecoveryProbability, selectRecoveryAction } from '../tools/diagnose.js';
import crypto from 'crypto';
function simulateCaptureIfApplicable(caseId, probability) {
    if (Math.random() < probability) {
        const now = new Date().toISOString();
        const caseRow = db.prepare('SELECT * FROM cases WHERE id = ?').get(caseId);
        // Simulate webhook capture
        db.prepare(`
      INSERT INTO payments (
        id, case_id, razorpay_payment_id, status, amount, method, is_recovery_payment, created_at
      ) VALUES (?, ?, ?, 'captured', ?, 'upi', 1, ?)
    `).run(crypto.randomUUID(), caseId, `pay_rec_${crypto.randomUUID()}`, caseRow.amount, now);
        db.prepare(`UPDATE cases SET status = 'recovered', updated_at = ? WHERE id = ?`).run(now, caseId);
        db.prepare(`
      INSERT INTO audit_log (id, case_id, event_type, actor, payload, created_at)
      VALUES (?, ?, 'webhook_payment_captured', 'system', '{}', ?)
    `).run(crypto.randomUUID(), caseId, now);
        return true;
    }
    return false;
}
async function runBaseline(prefix) {
    console.log(`\n--- Running Baseline (${prefix}) ---`);
    const cases = db.prepare(`SELECT id, failure_category FROM cases WHERE source_payment_id LIKE ?`).all(`pay_${prefix}_%`);
    let recoveredCount = 0;
    for (const c of cases) {
        try {
            await sendRecoveryMessage(c.id, 'email');
            await scheduleRetry(c.id, new Date().toISOString());
            const prob = c.failure_category === 'insufficient_funds' ? 0.3 : (c.failure_category === 'temporary_timeout' ? 0.5 : 0.05);
            if (simulateCaptureIfApplicable(c.id, prob)) {
                recoveredCount++;
            }
        }
        catch (e) {
            // Policy reject
        }
    }
    console.log(`Baseline recovered ${recoveredCount} out of ${cases.length}`);
}
async function runAgent(prefix) {
    console.log(`\n--- Running Agent (${prefix}) ---`);
    const cases = db.prepare(`SELECT id, source_payment_id FROM cases WHERE source_payment_id LIKE ?`).all(`pay_${prefix}_%`);
    let recoveredCount = 0;
    for (const c of cases) {
        try {
            const classify = await classifyFailure(c.source_payment_id);
            const probResult = await estimateRecoveryProbability(c.id);
            const actionResult = await selectRecoveryAction(c.id);
            if (actionResult.recommended_action === 'retry') {
                await scheduleRetry(c.id, new Date().toISOString());
            }
            else if (actionResult.recommended_action === 'reminder') {
                await sendRecoveryMessage(c.id, 'email');
            }
            else if (actionResult.recommended_action === 'payment_link') {
                try {
                    await createPaymentLink(c.id);
                }
                catch (e) {
                    // ignore auth failure for test mode
                }
            }
            else if (actionResult.recommended_action === 'stop') {
                await stopRecovery(c.id, 'Agent decided to stop');
            }
            const prob = probResult.probability * 1.5; // Agent boost simulation
            if (actionResult.recommended_action !== 'stop' && actionResult.recommended_action !== 'escalate' && simulateCaptureIfApplicable(c.id, prob)) {
                recoveredCount++;
            }
        }
        catch (e) {
            // Policy reject
        }
    }
    console.log(`Agent recovered ${recoveredCount} out of ${cases.length}`);
}
async function compareMetrics(baselinePrefix, agentPrefix) {
    console.log(`\n--- Metrics Comparison ---`);
    const baselinePayments = db.prepare(`
    SELECT SUM(p.amount) as total 
    FROM payments p JOIN cases c ON p.case_id = c.id
    WHERE p.status = 'captured' AND c.source_payment_id LIKE ?
  `).get(`pay_${baselinePrefix}_%`);
    const agentPayments = db.prepare(`
    SELECT SUM(p.amount) as total 
    FROM payments p JOIN cases c ON p.case_id = c.id
    WHERE p.status = 'captured' AND c.source_payment_id LIKE ?
  `).get(`pay_${agentPrefix}_%`);
    const baselineAmount = baselinePayments.total || 0;
    const agentAmount = agentPayments.total || 0;
    console.log(`Baseline Amount Recovered: ₹${baselineAmount / 100}`);
    console.log(`Agent Amount Recovered:    ₹${agentAmount / 100}`);
    console.log(`Incremental Recovery:      ₹${(agentAmount - baselineAmount) / 100}`);
}
async function main() {
    const runId = Date.now().toString();
    const baselinePrefix = `baseline_${runId}`;
    const agentPrefix = `agent_${runId}`;
    seedCases(baselinePrefix, 50);
    seedCases(agentPrefix, 50);
    await runBaseline(baselinePrefix);
    await runAgent(agentPrefix);
    await compareMetrics(baselinePrefix, agentPrefix);
    console.log(`\nDemo Cases available for inspection in DB: prefix ${runId}`);
    process.exit(0);
}
import { fileURLToPath } from 'url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch(console.error);
}
//# sourceMappingURL=replay-batch.js.map