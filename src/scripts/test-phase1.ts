import app from '../webhooks/receiver.js';
import { db } from '../db/client.js';
import http from 'http';

const server = http.createServer(app);
server.listen(0, async () => {
  const port = (server.address() as any).port;
  console.log(`Server started on port ${port} for testing`);

  const paymentFailedPayload = {
    event: 'payment.failed',
    payload: {
      payment: {
        entity: {
          id: 'pay_Test123',
          amount: 1000,
          currency: 'INR',
          customer_id: 'cust_Test123',
          subscription_id: 'sub_Test123',
          error_code: 'BAD_REQUEST_ERROR'
        }
      }
    }
  };

  const paymentCapturedPayload = {
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: 'pay_Rec123',
          amount: 1000,
          currency: 'INR',
          method: 'upi',
          notes: { case_id: '' }
        }
      }
    }
  };

  try {
    // 1. Test payment.failed
    let res = await fetch(`http://localhost:${port}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(paymentFailedPayload)
    });
    console.log('payment.failed status:', res.status);

    // Verify DB
    const caseRow = db.prepare('SELECT * FROM cases WHERE source_payment_id = ?').get('pay_Test123') as any;
    console.log('Case inserted:', !!caseRow);
    
    if (caseRow) {
      // 2. Test payment.captured
      paymentCapturedPayload.payload.payment.entity.notes = { case_id: caseRow.id };
      res = await fetch(`http://localhost:${port}/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(paymentCapturedPayload)
      });
      console.log('payment.captured status:', res.status);
      
      const updatedCase = db.prepare('SELECT status FROM cases WHERE id = ?').get(caseRow.id) as any;
      console.log('Case status updated to:', updatedCase.status);
      
      const paymentRow = db.prepare('SELECT * FROM payments WHERE razorpay_payment_id = ?').get('pay_Rec123') as any;
      console.log('Payment inserted:', !!paymentRow);
    }
  } catch(e) {
    console.error(e);
  } finally {
    server.close();
    process.exit(0);
  }
});
