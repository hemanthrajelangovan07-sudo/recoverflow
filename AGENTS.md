# RecoverFlow — Agent Rules

Source of truth: `implementation.md` at the repo root. Read the relevant
section before generating code for any tool, the policy engine, the DB
schema, or the webhook receiver — this file states constraints, not the
spec itself.

## Stack
TypeScript, Node 20+, `@modelcontextprotocol/sdk`, Razorpay Node SDK (test
mode only), SQLite, Express (webhook receiver).

## Non-negotiable
- Only `create_payment_link`, `issue_invoice`, `send_recovery_message`,
  `schedule_retry`, and `stop_recovery` may touch Razorpay or a messaging
  channel — and each must call the policy engine check BEFORE the side
  effect, never after.
- Razorpay credentials live only in the server process env. Never expose
  them in a tool's LLM-facing schema or in logs.
- Every tool call, whether it succeeds or is rejected by policy, writes one
  row to `audit_log`.
- A case is "recovered" only when `payments.status = 'captured'` AND it's
  linked via `case_id` to the original failed case. Never infer recovery
  from a message send, a created link, or a pending payment.
- Match the tool input/output shapes in `implementation.md` §5 exactly —
  don't invent or rename fields.

## Build order
Follow `implementation.md` §7, one phase at a time. Don't start phase N+1
until phase N's exit criteria are met. Start a fresh session per phase —
don't carry one long-running session across phases, since long sessions can
lose track of earlier constraints once context gets compacted.

## Agent operating rules
- Do NOT install new npm packages without asking first.
- Do NOT edit `db/schema.sql` after it has been seeded — write a migration
  instead.
- Do NOT run destructive DB commands (DROP, DELETE without WHERE) without
  confirmation.

## Avoid
Real mandate/recurring-debit creation, voice calling, unlimited WhatsApp
sends, or any policy threshold hardcoded outside `policy.config.json`.
