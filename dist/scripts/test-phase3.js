import { db } from '../db/client.js';
import { sendRecoveryMessage, createPaymentLink } from '../tools/execute.js';
import crypto from 'crypto';
async function main() {
    const caseId1 = crypto.randomUUID();
    // 1. Insert a case above approval threshold (25000)
    db.prepare(`
    INSERT INTO cases (
      id, source_payment_id, customer_id, amount, currency, status, failure_category, created_at, updated_at
    ) VALUES (?, ?, 'cust_Test', 30000, 'INR', 'open', 'insufficient_funds', ?, ?)
  `).run(caseId1, 'pay_Phase3_1_' + Date.now(), new Date().toISOString(), new Date().toISOString());
    console.log('Testing case above approval threshold...');
    const result1 = await createPaymentLink(caseId1);
    console.log('Result:', result1);
    let auditRows = db.prepare('SELECT * FROM audit_log WHERE case_id = ?').all(caseId1);
    console.log(`Audit log events for ${caseId1}:`, auditRows.map(r => r.event_type));
    const caseId2 = crypto.randomUUID();
    // 2. Insert a case and hit max_messages_per_case (2)
    db.prepare(`
    INSERT INTO cases (
      id, source_payment_id, customer_id, amount, currency, status, failure_category, created_at, updated_at, messages_sent
    ) VALUES (?, ?, 'cust_Test', 5000, 'INR', 'open', 'insufficient_funds', ?, ?, 2)
  `).run(caseId2, 'pay_Phase3_2_' + Date.now(), new Date().toISOString(), new Date().toISOString());
    console.log('\nTesting case hitting max_messages_per_case limit...');
    const result2 = await sendRecoveryMessage(caseId2, 'email');
    console.log('Result:', result2);
    auditRows = db.prepare('SELECT * FROM audit_log WHERE case_id = ?').all(caseId2);
    console.log(`Audit log events for ${caseId2}:`, auditRows.map(r => r.event_type));
    const caseId3 = crypto.randomUUID();
    // 3. Insert a case with suspected_fraud
    db.prepare(`
    INSERT INTO cases (
      id, source_payment_id, customer_id, amount, currency, status, failure_category, created_at, updated_at
    ) VALUES (?, ?, 'cust_Test', 5000, 'INR', 'open', 'suspected_fraud', ?, ?)
  `).run(caseId3, 'pay_Phase3_3_' + Date.now(), new Date().toISOString(), new Date().toISOString());
    console.log('\nTesting case with suspected_fraud...');
    const result3 = await sendRecoveryMessage(caseId3, 'sms');
    console.log('Result:', result3);
    auditRows = db.prepare('SELECT * FROM audit_log WHERE case_id = ?').all(caseId3);
    console.log(`Audit log events for ${caseId3}:`, auditRows.map(r => r.event_type));
    process.exit(0);
}
main().catch(console.error);
//# sourceMappingURL=test-phase3.js.map