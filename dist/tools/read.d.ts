export declare function getPaymentFailure(payment_id: string): Promise<{
    payment_id: string;
    subscription_id: string;
    invoice_id: string | null;
    amount: string | number;
    currency: string;
    failure_reason: string | null;
    failure_code: string | null;
    error_description: string | null;
    method: string;
    attempted_at: string;
    customer_id: string;
}>;
export declare function getRecoveryStatus(case_id: string): Promise<{
    case_id: string;
    status: any;
    attempts: any;
    messages_sent: any;
    amount_recovered: any;
    timeline: any[];
}>;
//# sourceMappingURL=read.d.ts.map