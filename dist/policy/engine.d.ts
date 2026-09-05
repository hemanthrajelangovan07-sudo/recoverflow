export type RejectedResult = {
    status: 'rejected';
    reason: string;
    case_status: string;
};
export declare function checkAction(actionType: string, caseId: string): RejectedResult | null;
//# sourceMappingURL=engine.d.ts.map