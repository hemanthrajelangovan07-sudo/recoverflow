import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';
import { getPaymentFailure, getRecoveryStatus } from './tools/read.js';
import { classifyFailure, estimateRecoveryProbability, selectRecoveryAction } from './tools/diagnose.js';
import { createPaymentLink, issueInvoice, scheduleRetry, sendRecoveryMessage, stopRecovery } from './tools/execute.js';
import { getBatchSummary } from './analytics/metrics.js';
import { db } from './db/client.js';
const server = new Server({
    name: 'recoverflow-server',
    version: '1.0.0',
}, {
    capabilities: {
        tools: {},
        resources: {},
    },
});
server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
        resources: [
            {
                uri: 'recoverflow://cases',
                name: 'Open Cases',
                mimeType: 'application/json',
                description: 'List of all open cases',
            },
            {
                uri: 'recoverflow://batch/summary',
                name: 'Batch Summary',
                mimeType: 'application/json',
                description: 'Aggregate metrics for the current demo batch',
            }
        ],
    };
});
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri === 'recoverflow://cases') {
        const cases = db.prepare("SELECT * FROM cases WHERE status = 'open'").all();
        return {
            contents: [{ uri: request.params.uri, mimeType: 'application/json', text: JSON.stringify(cases, null, 2) }]
        };
    }
    if (request.params.uri === 'recoverflow://batch/summary') {
        const summary = getBatchSummary();
        return {
            contents: [{ uri: request.params.uri, mimeType: 'application/json', text: JSON.stringify(summary, null, 2) }]
        };
    }
    if (request.params.uri.startsWith('recoverflow://cases/') && request.params.uri.endsWith('/timeline')) {
        const caseId = request.params.uri.split('/')[3];
        const timeline = db.prepare('SELECT * FROM audit_log WHERE case_id = ? ORDER BY created_at ASC').all(caseId);
        return {
            contents: [{ uri: request.params.uri, mimeType: 'application/json', text: JSON.stringify(timeline, null, 2) }]
        };
    }
    throw new McpError(ErrorCode.InvalidRequest, `Resource not found: ${request.params.uri}`);
});
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: 'get_payment_failure',
                description: 'Retrieves details about a failed payment from Razorpay.',
                inputSchema: { type: 'object', properties: { payment_id: { type: 'string' } }, required: ['payment_id'] },
            },
            {
                name: 'get_recovery_status',
                description: 'Retrieves recovery status and audit timeline for a case.',
                inputSchema: { type: 'object', properties: { case_id: { type: 'string' } }, required: ['case_id'] },
            },
            {
                name: 'classify_failure',
                description: 'Classifies failure category based on error codes.',
                inputSchema: { type: 'object', properties: { payment_id: { type: 'string' } }, required: ['payment_id'] },
            },
            {
                name: 'estimate_recovery_probability',
                description: 'Estimates recovery probability based on category.',
                inputSchema: { type: 'object', properties: { case_id: { type: 'string' } }, required: ['case_id'] },
            },
            {
                name: 'select_recovery_action',
                description: 'Selects the next optimal automated recovery action.',
                inputSchema: { type: 'object', properties: { case_id: { type: 'string' } }, required: ['case_id'] },
            },
            {
                name: 'create_payment_link',
                description: 'Creates a Razorpay payment link for recovery. (Requires policy approval)',
                inputSchema: { type: 'object', properties: { case_id: { type: 'string' } }, required: ['case_id'] },
            },
            {
                name: 'issue_invoice',
                description: 'Issues a Razorpay invoice for recovery. (Requires policy approval)',
                inputSchema: { type: 'object', properties: { case_id: { type: 'string' } }, required: ['case_id'] },
            },
            {
                name: 'send_recovery_message',
                description: 'Sends a recovery message. (Requires policy approval)',
                inputSchema: { type: 'object', properties: { case_id: { type: 'string' }, channel: { type: 'string', enum: ['email', 'sms', 'whatsapp'] } }, required: ['case_id', 'channel'] },
            },
            {
                name: 'schedule_retry',
                description: 'Schedules an automated retry for a case. (Requires policy approval)',
                inputSchema: { type: 'object', properties: { case_id: { type: 'string' }, timestamp: { type: 'string' } }, required: ['case_id', 'timestamp'] },
            },
            {
                name: 'stop_recovery',
                description: 'Stops automated recovery for a case manually.',
                inputSchema: { type: 'object', properties: { case_id: { type: 'string' }, reason: { type: 'string' } }, required: ['case_id', 'reason'] },
            },
        ],
    };
});
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        let result;
        switch (name) {
            case 'get_payment_failure':
                result = await getPaymentFailure(args.payment_id);
                break;
            case 'get_recovery_status':
                result = await getRecoveryStatus(args.case_id);
                break;
            case 'classify_failure':
                result = await classifyFailure(args.payment_id);
                break;
            case 'estimate_recovery_probability':
                result = await estimateRecoveryProbability(args.case_id);
                break;
            case 'select_recovery_action':
                result = await selectRecoveryAction(args.case_id);
                break;
            case 'create_payment_link':
                result = await createPaymentLink(args.case_id);
                break;
            case 'issue_invoice':
                result = await issueInvoice(args.case_id);
                break;
            case 'send_recovery_message':
                result = await sendRecoveryMessage(args.case_id, args.channel);
                break;
            case 'schedule_retry':
                result = await scheduleRetry(args.case_id, args.timestamp);
                break;
            case 'stop_recovery':
                result = await stopRecovery(args.case_id, args.reason);
                break;
            default:
                throw new McpError(ErrorCode.MethodNotFound, `Tool not found: ${name}`);
        }
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
    }
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('RecoverFlow MCP Server running on stdio');
}
import { fileURLToPath } from 'url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        console.error('Server error:', error);
        process.exit(1);
    });
}
//# sourceMappingURL=server.js.map