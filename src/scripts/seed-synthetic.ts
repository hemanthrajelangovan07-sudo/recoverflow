import { db } from '../db/client.js';
import crypto from 'crypto';

export function seedCases(prefix: string, count: number) {
  const categories = [
    { cat: 'temporary_timeout', prob: 0.9, amount: 150000 },
    { cat: 'insufficient_funds', prob: 0.6, amount: 200000 },
    { cat: 'expired_method', prob: 0.3, amount: 500000 },
    { cat: 'mandate_cancelled', prob: 0.1, amount: 100000 },
    { cat: 'hard_decline', prob: 0.05, amount: 250000 },
    { cat: 'suspected_fraud', prob: 0.0, amount: 800000 },
    { cat: 'customer_abandoned', prob: 0.2, amount: 300000 },
    { cat: 'temporary_timeout', prob: 0.9, amount: 3000000 }, // Above approval threshold (30,000 INR)
  ];

  const now = new Date().toISOString();
  
  for (let i = 0; i < count; i++) {
    const c = categories[i % categories.length];
    if (!c) continue;
    const caseId = crypto.randomUUID();
    const paymentId = `pay_${prefix}_${i}`;

    db.prepare(`
      INSERT INTO cases (
        id, source_payment_id, customer_id, amount, currency, status, failure_category, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'INR', 'open', ?, ?, ?)
    `).run(caseId, paymentId, `cust_${prefix}_${i}`, c.amount, c.cat, now, now);
  }
  
  console.log(`Seeded ${count} cases with prefix ${prefix}`);
}

import { fileURLToPath } from 'url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seedCases('manual', 50);
}
