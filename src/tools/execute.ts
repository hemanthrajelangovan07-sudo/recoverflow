import { db } from '../db/client.js';
import { razorpay } from '../razorpay/client.js';
import { checkAction } from '../policy/engine.js';
import type { RejectedResult } from '../policy/engine.js';
import crypto from 'crypto';

function logAudit(caseId: string, eventType: string, payload: any) {
  db.prepare(`
    INSERT INTO audit_log (id, case_id, event_type, actor, payload, created_at)
    VALUES (?, ?, ?, 'agent', ?, ?)
  `).run(
    crypto.randomUUID(),
    caseId,
    eventType,
    JSON.stringify(payload),
    new Date().toISOString()
  );
}

function logRejection(caseId: string, actionType: string, rejectedResult: RejectedResult) {
  logAudit(caseId, 'policy_rejected', { action: actionType, ...rejectedResult });
}

export async function createPaymentLink(case_id: string) {
  const rejected = checkAction('create_payment_link', case_id);
  if (rejected) {
    logRejection(case_id, 'create_payment_link', rejected);
    return rejected;
  }

  const caseRow = db.prepare('SELECT * FROM cases WHERE id = ?').get(case_id) as any;

  try {
    const link = await razorpay.paymentLink.create({
      amount: caseRow.amount,
      currency: caseRow.currency,
      description: `Recovery payment for ${caseRow.subscription_id || caseRow.source_payment_id}`,
      customer: {
        name: caseRow.customer_id,
        email: 'customer@example.com',
        contact: '9999999999'
      },
      notes: { case_id },
      expire_by: Math.floor(Date.now() / 1000) + (24 * 60 * 60)
    });

    logAudit(case_id, 'payment_link_created', { payment_link_id: link.id });

    return {
      case_id,
      payment_link_id: link.id,
      url: link.short_url,
      expires_at: new Date(link.expire_by! * 1000).toISOString(),
      status: link.status
    };
  } catch (error: any) {
    throw new Error(`Failed to create payment link: ${error.message}`);
  }
}

export async function issueInvoice(case_id: string) {
  const rejected = checkAction('issue_invoice', case_id);
  if (rejected) {
    logRejection(case_id, 'issue_invoice', rejected);
    return rejected;
  }

  const caseRow = db.prepare('SELECT * FROM cases WHERE id = ?').get(case_id) as any;

  try {
    const customer = {
      name: caseRow.customer_id, // Hackathon simplification
      email: 'customer@example.com'
    };

    const invoice = await razorpay.invoices.create({
      type: 'invoice',
      description: `Recovery invoice for ${caseRow.source_payment_id}`,
      customer,
      line_items: [{
        name: 'Failed Payment Recovery',
        amount: caseRow.amount,
        currency: caseRow.currency,
        quantity: 1
      }],
      notes: { case_id }
    });

    const issued = await razorpay.invoices.issue(invoice.id);

    logAudit(case_id, 'invoice_issued', { invoice_id: issued.id });

    return {
      case_id,
      invoice_id: issued.id,
      status: issued.status,
      url: issued.short_url
    };
  } catch (error: any) {
    throw new Error(`Failed to issue invoice: ${error.message}`);
  }
}

export async function sendRecoveryMessage(case_id: string, channel: "email"|"sms"|"whatsapp") {
  const rejected = checkAction('send_recovery_message', case_id);
  if (rejected) {
    logRejection(case_id, 'send_recovery_message', rejected);
    return rejected;
  }

  // Simulated send for hackathon
  const messageId = crypto.randomUUID();
  const sentAt = new Date().toISOString();

  db.prepare(`
    INSERT INTO messages (id, case_id, channel, status, sent_at)
    VALUES (?, ?, ?, 'sent', ?)
  `).run(messageId, case_id, channel, sentAt);

  db.prepare(`
    UPDATE cases SET messages_sent = messages_sent + 1, updated_at = ?
    WHERE id = ?
  `).run(sentAt, case_id);

  logAudit(case_id, 'message_sent', { message_id: messageId, channel });

  return {
    case_id,
    message_id: messageId,
    channel,
    status: 'sent',
    sent_at: sentAt
  };
}

export async function scheduleRetry(case_id: string, timestamp: string) {
  const rejected = checkAction('schedule_retry', case_id);
  if (rejected) {
    logRejection(case_id, 'schedule_retry', rejected);
    return rejected;
  }

  const caseRow = db.prepare('SELECT attempts FROM cases WHERE id = ?').get(case_id) as any;
  const attemptNumber = (caseRow.attempts || 0) + 1;
  const retryId = crypto.randomUUID();

  db.prepare(`
    INSERT INTO retries (id, case_id, attempt_number, scheduled_for, executed, result)
    VALUES (?, ?, ?, ?, 0, 'pending')
  `).run(retryId, case_id, attemptNumber, timestamp);

  db.prepare(`
    UPDATE cases SET attempts = attempts + 1, updated_at = ?
    WHERE id = ?
  `).run(new Date().toISOString(), case_id);

  logAudit(case_id, 'retry_scheduled', { retry_id: retryId, scheduled_for: timestamp, attempt_number: attemptNumber });

  return {
    case_id,
    retry_id: retryId,
    scheduled_for: timestamp,
    attempt_number: attemptNumber
  };
}

export async function stopRecovery(case_id: string, reason: string) {
  // Always succeeds, never rejected by policy engine
  const stoppedAt = new Date().toISOString();

  db.prepare(`
    UPDATE cases SET status = 'stopped', updated_at = ?
    WHERE id = ?
  `).run(stoppedAt, case_id);

  logAudit(case_id, 'recovery_stopped', { reason });

  return {
    case_id,
    status: 'stopped',
    reason,
    stopped_at: stoppedAt
  };
}
