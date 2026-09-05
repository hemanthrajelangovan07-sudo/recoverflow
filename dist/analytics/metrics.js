import { db } from '../db/client.js';
export function getBatchSummary() {
    const cases = db.prepare('SELECT status, amount, opted_out, created_at, updated_at FROM cases').all();
    const payments = db.prepare('SELECT amount, status, is_recovery_payment FROM payments').all();
    const messages = db.prepare('SELECT id FROM messages').all();
    const eligible_failed_cases = cases.length;
    const recovered_cases = cases.filter(c => c.status === 'recovered').length;
    const recovery_rate = eligible_failed_cases > 0 ? (recovered_cases / eligible_failed_cases) : 0;
    const amount_recovered = payments
        .filter(p => p.is_recovery_payment === 1 && p.status === 'captured')
        .reduce((sum, p) => sum + p.amount, 0);
    // Baseline assuming fixed baseline script recovered X amount. Let's return 0 for now.
    const baseline_recovered_amount = 0;
    const incremental_recovery = amount_recovered - baseline_recovered_amount;
    // Interventions
    const customers_contacted = new Set(messages.map(m => m.case_id)).size;
    const interventions_executed = db.prepare(`SELECT count(*) as count FROM audit_log WHERE event_type IN ('payment_link_created', 'message_sent', 'invoice_issued', 'retry_scheduled')`).get();
    const successful_recoveries = recovered_cases;
    const intervention_precision = interventions_executed.count > 0 ? (successful_recoveries / interventions_executed.count) : 0;
    const opt_outs = cases.filter(c => c.opted_out === 1).length;
    const opt_out_rate = customers_contacted > 0 ? (opt_outs / customers_contacted) : 0;
    // Cost (mock 0.5 per intervention)
    const recovery_cost = interventions_executed.count * 0.5;
    const recovery_roi = recovery_cost > 0 ? (incremental_recovery / recovery_cost) : 0;
    return {
        recovery_rate: (recovery_rate * 100).toFixed(2) + '%',
        amount_recovered,
        incremental_recovery,
        recovery_cost,
        recovery_roi: recovery_roi.toFixed(2),
        intervention_precision: (intervention_precision * 100).toFixed(2) + '%',
        contact_rate: eligible_failed_cases > 0 ? ((customers_contacted / eligible_failed_cases) * 100).toFixed(2) + '%' : '0%',
        opt_out_rate: (opt_out_rate * 100).toFixed(2) + '%',
        total_cases: eligible_failed_cases,
        recovered_cases
    };
}
//# sourceMappingURL=metrics.js.map