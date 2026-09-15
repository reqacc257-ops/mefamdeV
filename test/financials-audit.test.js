const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const db = require('../memory-store');
const financialsRouter = require('../routes/financials');

test('stipend disbursement creates a semantic audit entry', async () => {
  db.data.applications = [];
  db.data.fund_log = [];
  db.data.disbursements = [];
  db.data.audit_logs = [];

  const appId = db.prepare('INSERT INTO applications (name, status) VALUES (?, ?)').run('Scholar Audit', 'Accepted').lastInsertRowid;
  db.prepare('INSERT INTO fund_log (source, amount, date, notes) VALUES (?, ?, ?, ?)').run('Test fund', 5000, '2026-09-15', '');

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { type: 'staff', role: 'finance', id: 7, name: 'Finance Test' };
    next();
  });
  app.use('/api/financials', financialsRouter);

  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/financials/disbursements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId, amount: 3000, period: 'September 2026' })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(db.data.audit_logs[0].action, 'disbursement.release');
    assert.equal(db.data.audit_logs[0].entityLabel, 'Scholar Audit');
    assert.equal(db.data.audit_logs[0].after, 3000);
    assert.equal(db.data.audit_logs[0].meta.period, 'September 2026');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
