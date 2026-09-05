import express from 'express';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { db } from '../db/client.js';
import dotenv from 'dotenv';
dotenv.config();

const app = express();

app.use(express.json({
  verify: (req: any, res, buf) => {
    req.rawBody = buf.toString();
  }
}));

const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

app.post('/webhook', (req: any, res: any) => {
  const signature = req.headers['x-razorpay-signature'] as string;
  
  if (webhookSecret && signature) {
    try {
      const isValid = Razorpay.validateWebhookSignature(req.rawBody, signature, webhookSecret);
      if (!isValid) {
        return res.status(400).send('Invalid signature');
      }
    } catch (e) {
      return res.status(400).send('Signature validation failed');
    }
  }

  const event = req.body.event;
  const payload = req.body.payload;

  if (!event || !payload) {
    return res.status(400).send('Invalid payload');
  }

  try {
    const now = new Date().toISOString();

    if (event === 'payment.failed') {
      const payment = payload.payment?.entity;
      if (payment) {
        const existingCase = db.prepare('SELECT id FROM cases WHERE source_payment_id = ?').get(payment.id);
        
        if (!existingCase) {
          const caseId = crypto.randomUUID();
          db.prepare(`
            INSERT INTO cases (
              id, source_payment_id, subscription_id, invoice_id, customer_id, 
              amount, currency, status, failure_category, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)
          `).run(
            caseId,
            payment.id,
            payment.subscription_id || null,
            payment.invoice_id || null,
            payment.customer_id || 'unknown_customer',
            payment.amount,
            payment.currency || 'INR',
            payment.error_code || null,
            now,
            now
          );
          
          db.prepare(`
            INSERT INTO audit_log (id, case_id, event_type, actor, payload, created_at)
            VALUES (?, ?, 'webhook_payment_failed', 'system', ?, ?)
          `).run(crypto.randomUUID(), caseId, JSON.stringify(payment), now);
        }
      }
    }
    else if (event === 'payment.captured') {
      const payment = payload.payment?.entity;
      if (payment) {
        const caseId = payment.notes?.case_id || null;
        
        db.prepare(`
          INSERT INTO payments (
            id, case_id, razorpay_payment_id, status, amount, method, is_recovery_payment, created_at
          ) VALUES (?, ?, ?, 'captured', ?, ?, ?, ?)
        `).run(
          crypto.randomUUID(),
          caseId,
          payment.id,
          payment.amount,
          payment.method || 'unknown',
          caseId ? 1 : 0,
          now
        );

        if (caseId) {
          const existingCase = db.prepare('SELECT id FROM cases WHERE id = ?').get(caseId);
          if (existingCase) {
            db.prepare(`UPDATE cases SET status = 'recovered', updated_at = ? WHERE id = ?`).run(now, caseId);
            db.prepare(`
              INSERT INTO audit_log (id, case_id, event_type, actor, payload, created_at)
              VALUES (?, ?, 'webhook_payment_captured', 'system', ?, ?)
            `).run(crypto.randomUUID(), caseId, JSON.stringify(payment), now);
          }
        }
      }
    }
    else if (event === 'subscription.pending') {
      const sub = payload.subscription?.entity;
      if (sub) {
        const existingCase = db.prepare('SELECT id FROM cases WHERE subscription_id = ? AND status != ?').get(sub.id, 'closed') as { id: string } | undefined;
        if (existingCase) {
          db.prepare(`
            INSERT INTO audit_log (id, case_id, event_type, actor, payload, created_at)
            VALUES (?, ?, 'webhook_subscription_pending', 'system', ?, ?)
          `).run(crypto.randomUUID(), existingCase.id, JSON.stringify(sub), now);
        }
      }
    }
    else if (event === 'subscription.halted') {
      const sub = payload.subscription?.entity;
      if (sub) {
        const existingCase = db.prepare('SELECT id FROM cases WHERE subscription_id = ? AND status != ?').get(sub.id, 'closed') as { id: string } | undefined;
        if (existingCase) {
          db.prepare(`UPDATE cases SET status = 'stopped', updated_at = ? WHERE id = ?`).run(now, existingCase.id);
          db.prepare(`
            INSERT INTO audit_log (id, case_id, event_type, actor, payload, created_at)
            VALUES (?, ?, 'webhook_subscription_halted', 'system', ?, ?)
          `).run(crypto.randomUUID(), existingCase.id, JSON.stringify(sub), now);
        }
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).send('Internal Server Error');
  }
});

const port = process.env.PORT || 3000;

import { fileURLToPath } from 'url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(port, () => {
    console.log(`Webhook receiver listening on port ${port}`);
  });
}

export default app;
