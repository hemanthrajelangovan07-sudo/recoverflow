import type { RejectedResult } from '../policy/engine.js';
export declare function createPaymentLink(case_id: string): Promise<RejectedResult | {
    case_id: string;
    payment_link_id: string;
    url: string;
    expires_at: string;
    status: "cancelled" | "created" | "expired" | "paid" | "partially_paid";
}>;
export declare function issueInvoice(case_id: string): Promise<RejectedResult | {
    case_id: string;
    invoice_id: string;
    status: "cancelled" | "deleted" | "draft" | "expired" | "issued" | "paid" | "partially_paid" | undefined;
    url: string | null | undefined;
}>;
export declare function sendRecoveryMessage(case_id: string, channel: "email" | "sms" | "whatsapp"): Promise<RejectedResult | {
    case_id: string;
    message_id: `${string}-${string}-${string}-${string}-${string}`;
    channel: "email" | "sms" | "whatsapp";
    status: string;
    sent_at: string;
}>;
export declare function scheduleRetry(case_id: string, timestamp: string): Promise<RejectedResult | {
    case_id: string;
    retry_id: `${string}-${string}-${string}-${string}-${string}`;
    scheduled_for: string;
    attempt_number: any;
}>;
export declare function stopRecovery(case_id: string, reason: string): Promise<{
    case_id: string;
    status: string;
    reason: string;
    stopped_at: string;
}>;
//# sourceMappingURL=execute.d.ts.map