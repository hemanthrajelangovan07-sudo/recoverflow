import { db } from '../db/client.js';
export function checkAction(actionType, caseId) {
    const caseRow = db.prepare('SELECT * FROM cases WHERE id = ?').get(caseId);
    if (!caseRow) {
        return { status: 'rejected', reason: 'case_not_found', case_status: 'unknown' };
    }
    const row = db.prepare('SELECT config_json FROM policy_config WHERE id = 1').get();
    if (!row) {
        throw new Error('Policy config not found in database');
    }
    const policy = JSON.parse(row.config_json);
    // 1. Is the case already stopped, recovered, or closed? -> reject
    if (['stopped', 'recovered', 'closed'].includes(caseRow.status)) {
        return {
            status: 'rejected',
            reason: `case_already_${caseRow.status}`,
            case_status: caseRow.status
        };
    }
    // 2. Is opted_out = 1? -> reject, unless the call is stop_recovery
    if (caseRow.opted_out === 1 && actionType !== 'stop_recovery') {
        return {
            status: 'rejected',
            reason: 'customer_opted_out',
            case_status: caseRow.status
        };
    }
    // 5. Is failure_category in no_auto_action? -> reject
    if (policy.no_auto_action.includes(caseRow.failure_category)) {
        return {
            status: 'rejected',
            reason: 'failure_category_no_auto_action',
            case_status: caseRow.status
        };
    }
    // 4. Is amount > approval_required_above? -> set case to awaiting_approval, reject
    if (caseRow.amount > policy.approval_required_above) {
        db.prepare(`UPDATE cases SET status = 'awaiting_approval', updated_at = ? WHERE id = ?`)
            .run(new Date().toISOString(), caseId);
        return {
            status: 'rejected',
            reason: 'approval_required_above_threshold',
            case_status: 'awaiting_approval'
        };
    }
    // 3. Would this action exceed max limits?
    if (actionType === 'send_recovery_message') {
        if (caseRow.messages_sent >= policy.max_messages_per_case) {
            db.prepare(`UPDATE cases SET status = 'awaiting_approval', updated_at = ? WHERE id = ?`)
                .run(new Date().toISOString(), caseId);
            return {
                status: 'rejected',
                reason: 'max_messages_exceeded',
                case_status: 'awaiting_approval'
            };
        }
    }
    if (actionType === 'schedule_retry') {
        if (caseRow.attempts >= policy.max_retry_attempts) {
            db.prepare(`UPDATE cases SET status = 'awaiting_approval', updated_at = ? WHERE id = ?`)
                .run(new Date().toISOString(), caseId);
            return {
                status: 'rejected',
                reason: 'max_retry_attempts_exceeded',
                case_status: 'awaiting_approval'
            };
        }
    }
    return null; // OK
}
//# sourceMappingURL=engine.js.map