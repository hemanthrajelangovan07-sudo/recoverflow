import { razorpay } from '../razorpay/client.js';
import { db } from '../db/client.js';

export async function getPaymentFailure(payment_id: string) {
  try {
    const payment = await razorpay.payments.fetch(payment_id);
    
    // We only process failed payments in this flow for now
    if (payment.status !== 'failed') {
      throw new Error(`Payment ${payment_id} is not in a failed state. Status: ${payment.status}`);
    }

    return {
      payment_id: payment.id,
      subscription_id: payment.order_id, // Razorpay ties subscription payments via orders or directly depending on setup, but often order_id or invoice_id is used. The SDK provides `invoice_id` and `order_id`.
      invoice_id: payment.invoice_id,
      amount: payment.amount,
      currency: payment.currency,
      failure_reason: payment.error_reason,
      failure_code: payment.error_code,
      error_description: payment.error_description,
      method: payment.method,
      attempted_at: new Date(payment.created_at * 1000).toISOString(),
      customer_id: payment.customer_id
    };
  } catch (error: any) {
    throw new Error(`Failed to fetch payment details: ${error.message || error}`);
  }
}

export async function getRecoveryStatus(case_id: string) {
  const caseRow = db.prepare('SELECT status, attempts, messages_sent FROM cases WHERE id = ?').get(case_id) as any;
  if (!caseRow) {
    throw new Error(`Case ${case_id} not found`);
  }

  // Calculate amount recovered if captured
  const paymentRow = db.prepare('SELECT SUM(amount) as total FROM payments WHERE case_id = ? AND status = ?').get(case_id, 'captured') as any;
  const amount_recovered = paymentRow?.total || 0;

  const timeline = db.prepare('SELECT event_type, actor, payload, created_at FROM audit_log WHERE case_id = ? ORDER BY created_at ASC').all(case_id);

  return {
    case_id,
    status: caseRow.status,
    attempts: caseRow.attempts,
    messages_sent: caseRow.messages_sent,
    amount_recovered,
    timeline: timeline.map((row: any) => ({
      ...row,
      payload: JSON.parse(row.payload)
    }))
  };
}
