-- One row per failed-payment/subscription case we're trying to recover
CREATE TABLE IF NOT EXISTS cases (
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

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  case_id TEXT REFERENCES cases(id),
  razorpay_payment_id TEXT,
  status TEXT,                         -- failed|captured|pending
  amount INTEGER,
  method TEXT,
  is_recovery_payment INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  case_id TEXT REFERENCES cases(id),
  channel TEXT,                        -- email|sms|whatsapp
  status TEXT,
  sent_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS retries (
  id TEXT PRIMARY KEY,
  case_id TEXT REFERENCES cases(id),
  attempt_number INTEGER,
  scheduled_for TEXT,
  executed INTEGER DEFAULT 0,
  result TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  case_id TEXT REFERENCES cases(id),
  event_type TEXT NOT NULL,            -- e.g. diagnosis_made, action_selected,
                                        -- policy_rejected, message_sent, payment_captured
  actor TEXT NOT NULL,                 -- agent|policy_engine|system|human
  payload TEXT,                        -- JSON blob
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS policy_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),  -- singleton row for the hackathon
  config_json TEXT NOT NULL
);
