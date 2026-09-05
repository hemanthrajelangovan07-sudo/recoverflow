# RecoverFlow — MCP Server Implementation Plan

## 0. Assumptions

This plan assumes:

- **Language/runtime:** TypeScript on Node.js 20+, using `@modelcontextprotocol/sdk`. (Best SDK support today, and the Razorpay Node SDK is first-party. Swap to the Python MCP SDK + `razorpay` PyPI package if your team prefers Python — the tool contracts below don't change.)
- **Persistence:** SQLite (via `better-sqlite3` or Prisma) for the hackathon. Easy to seed, easy to inspect, no infra to stand up.
- **Payments provider:** Razorpay **test mode** only. No production mandate or real-money flows.
- **Consumer of the MCP server:** Claude (Desktop or Code) or any MCP-compatible agent, connected over stdio for local dev, with an option to expose over Streamable HTTP for a shared demo.
- **Scope:** failed **subscription payment** recovery only (per the PS's recommended MVP) — not checkout abandonment, B2B collections, or voice.

If any of these don't match your setup, the tool contracts and data model in this doc still apply — only the transport/persistence layer changes.

---

## 1. Why an MCP server (not just an agent loop)

The core risk called out in the source PS is an LLM that directly executes money-moving actions. MCP gives us a clean boundary for that:

- The **LLM only ever sees tool schemas** — it can request `create_payment_link`, it cannot call Razorpay's charge or mandate APIs directly.
- Every tool handler enforces the **policy engine** server-side, not via prompt instructions. A prompt-level limit ("don't message more than twice") is not enforceable; a tool handler that returns an error when `messages_sent >= 2` is.
- Every tool call writes an **audit event**, independent of whether the LLM "remembers" to log it.

So the MCP server is not just a wrapper around Razorpay — it's the policy boundary. This is the single most important design decision in this doc: **treat the MCP server as the enforcement layer, and the LLM as a recommender that the server is free to override or reject.**

---

## 2. Architecture

```
┌─────────────────────────────┐
│ Razorpay (test mode)        │
│  - Subscriptions API        │
│  - Payment Links API        │
│  - Invoices API             │
│  - Webhooks                 │
└──────────────┬──────────────┘
               │ webhooks (payment.failed, payment.captured,
               │ subscription.pending, subscription.halted, invoice.paid)
               ▼
┌─────────────────────────────┐        ┌──────────────────────────┐
│ Webhook receiver (Express)  │───────▶│ SQLite (shared DB)       │
│  - verifies signature       │        │  cases, payments,        │
│  - writes case events       │        │  messages, retries,      │
└─────────────────────────────┘        │  policy, audit_log       │
                                        └──────────────┬───────────┘
                                                        │ read/write
┌─────────────────────────────┐                        │
│ MCP Server (stdio / HTTP)   │────────────────────────┘
│  Tools:                     │
│   get_payment_failure       │◀── Claude / any MCP agent
│   get_subscription_status   │    (recommends actions;
│   get_invoice_status        │     never calls Razorpay
│   classify_failure          │     directly)
│   estimate_recovery_prob.   │
│   select_recovery_action    │
│   create_payment_link  ─┐   │
│   issue_invoice         │───┼──▶ Policy engine validates
│   send_recovery_message │   │    every mutating call before
│   schedule_retry         │   │    it touches Razorpay or a
│   stop_recovery         ─┘   │    messaging channel
│   get_recovery_status       │
└─────────────────────────────┘
```

Two processes share one DB: the **webhook receiver** (dumb, just ingests Razorpay events into `cases`/`payments`) and the **MCP server** (all the intelligence and all the guardrails). This split matters because MCP servers over stdio can't receive inbound HTTP webhooks — you need the small Express process regardless of stack.

---

## 3. Data model (SQLite schema, hackathon-scoped)

```sql
-- One row per failed-payment/subscription case we're trying to recover
CREATE TABLE cases (
  id TEXT PRIMARY KEY,                 -- uuid
  source_payment_id TEXT,              -- razorpay payment id that failed
  subscription_id TEXT,
  invoice_id TEXT,
  customer_id TEXT NOT NULL,
  amount INTEGER NOT NULL,             -- paise
  currency TEXT DEFAULT 'INR',
  status TEXT NOT NULL,                -- open|awaiting_approval|stopped|recovered|closed
  failure_category TEXT,               -- temporary_timeout|insufficient_funds|expired_method|
                                        -- mandate_cancelled|hard_decline|suspected_fraud|
                                        -- customer_abandoned
  recovery_probability REAL,
  expected_recovery_value REAL,
  recommended_action TEXT,
  attempts INTEGER DEFAULT 0,
  messages_sent INTEGER DEFAULT 0,
  opted_out INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  case_id TEXT REFERENCES cases(id),
  razorpay_payment_id TEXT,
  status TEXT,                         -- failed|captured|pending
  amount INTEGER,
  method TEXT,
  is_recovery_payment INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  case_id TEXT REFERENCES cases(id),
  channel TEXT,                        -- email|sms|whatsapp
  status TEXT,
  sent_at TEXT NOT NULL
);

CREATE TABLE retries (
  id TEXT PRIMARY KEY,
  case_id TEXT REFERENCES cases(id),
  attempt_number INTEGER,
  scheduled_for TEXT,
  executed INTEGER DEFAULT 0,
  result TEXT
);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  case_id TEXT REFERENCES cases(id),
  event_type TEXT NOT NULL,            -- e.g. diagnosis_made, action_selected,
                                        -- policy_rejected, message_sent, payment_captured
  actor TEXT NOT NULL,                 -- agent|policy_engine|system|human
  payload TEXT,                        -- JSON blob
  created_at TEXT NOT NULL
);

CREATE TABLE policy_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),  -- singleton row for the hackathon
  config_json TEXT NOT NULL
);
```

`audit_log` is what makes the "audit-first design" goal in the PS real — every tool call, whether it succeeds or is rejected by policy, writes a row here. The dashboard just reads this table.

---

## 4. Policy engine

Config-driven, loaded from `policy_config`, checked inside every mutating tool handler — **not** left to the LLM's judgment:

```json
{
  "max_messages_per_case": 2,
  "max_retry_attempts": 3,
  "approval_required_above": 25000,
  "cooldown_hours_between_messages": 24,
  "stop_on_payment_captured": true,
  "stop_on_customer_opt_out": true,
  "auto_actions": ["retry", "payment_link", "reminder"],
  "human_approval_actions": ["escalate_high_value"],
  "no_auto_action": ["suspected_fraud"]
}
```

Every mutating tool (`create_payment_link`, `issue_invoice`, `send_recovery_message`, `schedule_retry`) runs this check before touching Razorpay:

1. Is the case already `stopped`, `recovered`, or `closed`? → reject.
2. Is `opted_out = 1`? → reject, unless the call is `stop_recovery`.
3. Would this action exceed `max_messages_per_case` / `max_retry_attempts`? → reject or flip case to `awaiting_approval`.
4. Is `amount > approval_required_above`? → set case to `awaiting_approval`, do not execute, return that state to the caller.
5. Is `failure_category` in `no_auto_action` (e.g. `suspected_fraud`)? → reject, log, do not execute.

A rejected tool call still returns a structured result (not just an error string) so the calling agent can explain to the user *why* — e.g. `{ "status": "rejected", "reason": "approval_required_above_threshold" }`.

---

## 5. MCP tool contracts

Twelve tools, matching the PS's tool list. Read-only tools first, then diagnosis/decisioning, then mutating/execution tools (which are the only ones the policy engine gates).

### Read-only tools

**`get_payment_failure`**
```
input:  { payment_id: string }
output: { payment_id, subscription_id?, invoice_id?, amount, currency,
          failure_reason, failure_code, error_description, method,
          attempted_at, customer_id }
```

**`get_subscription_status`**
```
input:  { subscription_id: string }
output: { subscription_id, status: "active"|"pending"|"halted"|"cancelled",
          current_start, current_end, retry_count, next_charge_at }
```

**`get_invoice_status`**
```
input:  { invoice_id: string }
output: { invoice_id, status: "issued"|"paid"|"overdue"|"cancelled",
          amount_due, due_date, customer_id }
```

**`get_recovery_status`**
```
input:  { case_id: string }
output: { case_id, status, attempts, messages_sent, amount_recovered,
          timeline: AuditEvent[] }
```

### Diagnosis / decisioning tools (deterministic, not LLM-owned)

**`classify_failure`**
```
input:  { payment_id: string }
output: { case_id, category, confidence, evidence: string[] }
```
Rule-based first (map Razorpay `error_code`/`error_reason` → category). Add a probability model only after the rules work end-to-end — this mirrors the PS's step-by-step plan (baseline before ML).

**`estimate_recovery_probability`**
```
input:  { case_id: string }
output: { case_id, probability: number, expected_amount: number,
          expected_recovery_value: number, model_version: string }
```
`expected_recovery_value = probability * amount - intervention_cost`, per the PS's formula. `intervention_cost` is a small config table (e.g. email ₹0, SMS ₹0.5, WhatsApp ₹2, human review ₹200).

**`select_recovery_action`**
```
input:  { case_id: string }
output: { case_id, recommended_action: "retry"|"payment_link"|"invoice_resend"|
          "method_update"|"reminder"|"escalate"|"stop",
          rationale: string, requires_approval: boolean }
```
This tool *recommends* — it does not execute. The LLM (or a deterministic policy) calls this, gets a recommendation, and then must call the corresponding execution tool separately, which is where policy enforcement lives.

### Execution tools (policy-gated, side-effecting)

**`create_payment_link`**
```
input:  { case_id: string }
output: { case_id, payment_link_id, url, expires_at, status } | RejectedResult
```

**`issue_invoice`**
```
input:  { case_id: string }
output: { case_id, invoice_id, status, url } | RejectedResult
```

**`send_recovery_message`**
```
input:  { case_id: string, channel: "email"|"sms"|"whatsapp" }
output: { case_id, message_id, channel, status, sent_at } | RejectedResult
```
For the hackathon, this can be a simulated send (write to `messages` table, log to console) rather than a real provider integration, unless you already have Email/SMS/WhatsApp credentials.

**`schedule_retry`**
```
input:  { case_id: string, timestamp: string }
output: { case_id, retry_id, scheduled_for, attempt_number } | RejectedResult
```

**`stop_recovery`**
```
input:  { case_id: string, reason: string }
output: { case_id, status: "stopped", reason, stopped_at }
```
Always succeeds (stopping is never something policy should block) and immediately halts any further scheduled retries/messages for the case.

`RejectedResult` shape used across all gated tools:
```
{ status: "rejected", reason: string, case_status: string }
```

### MCP annotations

Mark tool metadata so the client (and the human watching the demo) can see intent at a glance:
- Read-only tools → `readOnlyHint: true`
- `create_payment_link`, `issue_invoice`, `send_recovery_message` → `destructiveHint: false` but real side effects, so surface a confirmation in the demo UI
- `schedule_retry`, `stop_recovery` → idempotent-safe (`idempotentHint: true`) so re-calls don't duplicate retries

### Optional MCP resources

Expose read-only resources for the dashboard/agent to browse without a tool round-trip per case:
- `recoverflow://cases` — list of open cases
- `recoverflow://cases/{case_id}/timeline` — audit trail for one case
- `recoverflow://batch/summary` — aggregate metrics for the current demo batch

### Optional MCP prompt

`explain-recovery-decision` — takes a `case_id`, pulls the audit trail via the resource above, and asks the model to produce a one-paragraph human-readable explanation of why a given action was chosen. Useful for the judge-facing demo ("why did the agent pick a payment link instead of a retry here?").

---

## 6. Razorpay integration checklist

- [ ] Test-mode API key/secret in `.env` (never passed to the LLM — only the MCP server process holds them)
- [ ] Webhook endpoint registered in Razorpay dashboard, signature verified using `razorpay.webhooks.validateWebhookSignature`
- [ ] Subscribe to: `payment.failed`, `payment.captured`, `subscription.pending`, `subscription.halted`, `subscription.charged`, `invoice.paid`
- [ ] Use `razorpay.paymentLink.create()` for the fallback payment path
- [ ] Use `razorpay.invoices.create()` / `.issue()` for invoice resends
- [ ] For repeatable demo data, use Razorpay's subscription test flows to trigger `pending` → retries → `halted` rather than hand-crafting webhook payloads where possible; fall back to a signed synthetic webhook replay script if some states are hard to trigger on demand

---

## 7. Build order (maps to PS §4.6, compressed for a hackathon)

| Phase | Deliverable | Exit criteria |
|---|---|---|
| 0 — Setup | Razorpay test account, MCP server scaffold, SQLite schema applied | `get_payment_failure` returns real data for a manually-failed test payment |
| 1 — State machine | Webhook receiver live, `payment.failed`/`payment.captured`/`subscription.pending`/`subscription.halted` all write correct rows | A replayed webhook batch produces correct `cases` rows with no manual DB edits |
| 2 — Diagnosis baseline | `classify_failure` (rule-based) + `estimate_recovery_probability` (heuristic, not ML yet) | Every synthetic failure gets a category and a probability |
| 3 — Policy engine | `policy_config` loaded, all four execution tools check it before acting | A rejected call (e.g. above `approval_required_above`) returns `RejectedResult` and logs to `audit_log` |
| 4 — Action runner | `create_payment_link`, `issue_invoice`, `send_recovery_message` (simulated), `schedule_retry`, `stop_recovery` all working against Razorpay test mode | One case can go failure → link created → webhook captured → `stop_recovery` fires automatically |
| 5 — Analytics | `get_recovery_status`, batch summary resource, metrics queries (below) | Dashboard shows recovered amount, recovery rate, cost, for a full batch |
| 6 — Baseline comparison + rehearsal | Fixed-schedule baseline implemented alongside the agent path | Side-by-side batch run shows incremental recovery, not just gross recovery |

---

## 8. Metrics (compute from `cases`/`payments`/`audit_log`, not from LLM claims)

| Metric | Formula |
|---|---|
| Recovery rate | `recovered_cases / eligible_failed_cases` |
| Amount recovered | `SUM(payments.amount WHERE is_recovery_payment=1 AND status='captured')` |
| Incremental recovery | `agent_recovered_amount - baseline_recovered_amount` |
| Recovery ROI | `incremental_recovered_amount / recovery_cost` |
| Intervention precision | `successful_recoveries / interventions_executed` |
| Time to recovery | `AVG(payment_captured_at - failure_at)` |
| Contact rate | `customers_contacted / eligible_customers` |
| Opt-out rate | `opt_outs / contacted_customers` |
| Stop-rule compliance | `cases_stopped_correctly / cases_requiring_stop` |

**Hard rule carried over from the source PS:** a case only counts as "recovered" when Razorpay reports the payment as `captured` **and** it's linked to the original failed case via `payments.case_id`. A sent message, a created link, or a `pending` payment is never counted.

---

## 9. Synthetic data & demo script

1. Write a seed script that inserts ~50–100 synthetic `cases` spanning every `failure_category`, including a few "suspected fraud" and a couple above `approval_required_above`.
2. Run the **baseline** path (fixed retry + generic message) over a copy of the batch.
3. Run the **agent** path (MCP tools driven by Claude or a scripted caller) over the same batch.
4. Compare recovered amount, contact rate, and opt-outs between the two.
5. For the live demo, walk through three specific cases (per PS §2.8):
   - One that recovers successfully via payment link.
   - One that's correctly classified as non-recoverable / fraud and never auto-actioned.
   - One that hits `max_retry_attempts`, is escalated, and `stop_recovery` fires — showing the guardrail working, not just the happy path.

---

## 10. Guardrails to keep visible in the demo

- LLM never has Razorpay credentials or direct API access — only tool calls.
- Every policy limit lives in `policy_config`, not in a system prompt.
- `stop_on_payment_captured` and `stop_on_customer_opt_out` are enforced in code and checked at the top of every mutating tool handler, so a stale LLM decision can't re-trigger a message after the customer already paid or opted out.
- Explicitly out of scope for this prototype: real recurring-debit/mandate creation, voice calls, unlimited WhatsApp sends, and any tool that lets the LLM call Razorpay's charge/mandate endpoints directly.

---

## 11. Repository structure

```
recoverflow-mcp/
├── src/
│   ├── server.ts              # MCP server entry point, tool registration
│   ├── tools/
│   │   ├── read.ts             # get_payment_failure, get_subscription_status, get_invoice_status, get_recovery_status
│   │   ├── diagnose.ts         # classify_failure, estimate_recovery_probability, select_recovery_action
│   │   └── execute.ts          # create_payment_link, issue_invoice, send_recovery_message, schedule_retry, stop_recovery
│   ├── policy/
│   │   └── engine.ts           # loads policy_config, exposes checkAction()
│   ├── razorpay/
│   │   └── client.ts           # thin wrapper, holds credentials, only called server-side
│   ├── db/
│   │   ├── schema.sql
│   │   └── queries.ts
│   ├── webhooks/
│   │   └── receiver.ts         # Express app, signature verification, writes to DB
│   └── scripts/
│       ├── seed-synthetic.ts
│       └── replay-batch.ts     # runs baseline vs agent comparison
├── policy.config.json
├── .env.example
├── package.json
└── README.md
```

---

## 12. Next steps

1. Confirm stack (TS/Node vs. Python) and lock it before writing code.
2. Stand up Phase 0–1 first — the webhook state machine — since everything downstream depends on trustworthy case data.
3. Keep the policy engine's config file as the single source of truth for limits; resist the temptation to hardcode thresholds in tool handlers.
