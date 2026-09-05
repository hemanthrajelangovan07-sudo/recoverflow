import { razorpay } from '../razorpay/client.js';
import { db } from '../db/client.js';
import crypto from 'crypto';
export async function classifyFailure(payment_id) {
    const caseRow = db.prepare('SELECT id, failure_category FROM cases WHERE source_payment_id = ?').get(payment_id);
    if (!caseRow) {
        throw new Error(`No case found for payment_id: ${payment_id}`);
    }
    const case_id = caseRow.id;
    const code = (caseRow.failure_category || '').toLowerCase();
    let category = 'hard_decline';
    let confidence = 0.5;
    let evidence = `error_code: ${code}`;
    if (code.includes('insufficient') || code.includes('balance')) {
        category = 'insufficient_funds';
        confidence = 0.9;
    }
    else if (code.includes('timeout') || code.includes('temporary')) {
        category = 'temporary_timeout';
        confidence = 0.8;
    }
    else if (code.includes('expire')) {
        category = 'expired_method';
        confidence = 0.9;
    }
    else if (code.includes('mandate_cancelled') || code.includes('cancelled')) {
        category = 'mandate_cancelled';
        confidence = 0.9;
    }
    else if (code.includes('fraud') || code.includes('suspect')) {
        category = 'suspected_fraud';
        confidence = 0.9;
    }
    else if (code.includes('abandon')) {
        category = 'customer_abandoned';
        confidence = 0.7;
    }
    else {
        // try to fetch from razorpay as fallback
        try {
            const payment = await razorpay.payments.fetch(payment_id);
            const text = `${payment.error_code} ${payment.error_reason} ${payment.error_description}`.toLowerCase();
            evidence = `razorpay_error: ${text}`;
            if (text.includes('insufficient') || text.includes('balance'))
                category = 'insufficient_funds';
            else if (text.includes('timeout') || text.includes('temporary'))
                category = 'temporary_timeout';
            else if (text.includes('expire'))
                category = 'expired_method';
            else if (text.includes('mandate_cancelled') || text.includes('cancelled'))
                category = 'mandate_cancelled';
            else if (text.includes('fraud') || text.includes('suspect'))
                category = 'suspected_fraud';
            else if (text.includes('abandon'))
                category = 'customer_abandoned';
        }
        catch (e) {
            // ignore, stick to hard_decline
        }
    }
    // Update DB
    db.prepare(`UPDATE cases SET failure_category = ?, updated_at = ? WHERE id = ?`)
        .run(category, new Date().toISOString(), case_id);
    db.prepare(`
    INSERT INTO audit_log (id, case_id, event_type, actor, payload, created_at)
    VALUES (?, ?, 'diagnosis_made', 'agent', ?, ?)
  `).run(crypto.randomUUID(), case_id, JSON.stringify({ category, confidence, tool: 'classify_failure' }), new Date().toISOString());
    return {
        case_id,
        category,
        confidence,
        evidence: [evidence]
    };
}
export async function estimateRecoveryProbability(case_id) {
    const caseRow = db.prepare('SELECT amount, failure_category FROM cases WHERE id = ?').get(case_id);
    if (!caseRow) {
        throw new Error(`No case found for case_id: ${case_id}`);
    }
    const cat = caseRow.failure_category;
    let probability = 0.1; // default fallback
    if (cat === 'temporary_timeout')
        probability = 0.9;
    else if (cat === 'insufficient_funds')
        probability = 0.6;
    else if (cat === 'expired_method')
        probability = 0.3;
    else if (cat === 'customer_abandoned')
        probability = 0.2;
    else if (cat === 'mandate_cancelled')
        probability = 0.1;
    else if (cat === 'hard_decline')
        probability = 0.05;
    else if (cat === 'suspected_fraud')
        probability = 0.0;
    const expected_amount = caseRow.amount * probability;
    // Assume intervention cost is 0 for baseline calculation
    const expected_recovery_value = expected_amount - 0;
    db.prepare(`
    UPDATE cases 
    SET recovery_probability = ?, expected_recovery_value = ?, updated_at = ?
    WHERE id = ?
  `).run(probability, expected_recovery_value, new Date().toISOString(), case_id);
    db.prepare(`
    INSERT INTO audit_log (id, case_id, event_type, actor, payload, created_at)
    VALUES (?, ?, 'probability_estimated', 'agent', ?, ?)
  `).run(crypto.randomUUID(), case_id, JSON.stringify({ probability, expected_amount, expected_recovery_value }), new Date().toISOString());
    return {
        case_id,
        probability,
        expected_amount,
        expected_recovery_value,
        model_version: 'heuristic-v1'
    };
}
export async function selectRecoveryAction(case_id) {
    const caseRow = db.prepare('SELECT amount, failure_category, recovery_probability FROM cases WHERE id = ?').get(case_id);
    if (!caseRow) {
        throw new Error(`No case found for case_id: ${case_id}`);
    }
    let recommended_action = 'retry';
    let rationale = '';
    let requires_approval = false;
    const cat = caseRow.failure_category;
    if (cat === 'suspected_fraud') {
        recommended_action = 'stop';
        rationale = 'Policy: No automated action for suspected fraud.';
    }
    else if (cat === 'hard_decline' || cat === 'mandate_cancelled' || cat === 'expired_method') {
        recommended_action = 'payment_link';
        rationale = 'Customer needs to provide a new payment method or approve a new link.';
    }
    else if (cat === 'insufficient_funds') {
        recommended_action = 'reminder';
        rationale = 'Send a reminder for the customer to add funds before retrying.';
    }
    else if (cat === 'temporary_timeout') {
        recommended_action = 'retry';
        rationale = 'Temporary issue, high probability of success on automated retry.';
    }
    else {
        recommended_action = 'escalate';
        rationale = 'Unknown failure category, escalating for human review.';
    }
    // Example heuristic for approval (matching the policy config default of 25000 paise)
    if (caseRow.amount > 25000) {
        requires_approval = true;
        rationale += ' Amount exceeds auto-approval threshold.';
    }
    db.prepare(`
    UPDATE cases SET recommended_action = ?, updated_at = ? WHERE id = ?
  `).run(recommended_action, new Date().toISOString(), case_id);
    db.prepare(`
    INSERT INTO audit_log (id, case_id, event_type, actor, payload, created_at)
    VALUES (?, ?, 'action_selected', 'agent', ?, ?)
  `).run(crypto.randomUUID(), case_id, JSON.stringify({ recommended_action, rationale, requires_approval }), new Date().toISOString());
    return {
        case_id,
        recommended_action,
        rationale,
        requires_approval
    };
}
//# sourceMappingURL=diagnose.js.map