CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  action TEXT,
  user_name TEXT,
  applicant TEXT,
  details TEXT,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);
