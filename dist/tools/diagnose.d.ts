export declare function classifyFailure(payment_id: string): Promise<{
    case_id: any;
    category: string;
    confidence: number;
    evidence: string[];
}>;
export declare function estimateRecoveryProbability(case_id: string): Promise<{
    case_id: string;
    probability: number;
    expected_amount: number;
    expected_recovery_value: number;
    model_version: string;
}>;
export declare function selectRecoveryAction(case_id: string): Promise<{
    case_id: string;
    recommended_action: string;
    rationale: string;
    requires_approval: boolean;
}>;
//# sourceMappingURL=diagnose.d.ts.map