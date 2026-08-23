/**
 * routes/financials.js
 */
const router = require('express').Router();
const db = require('../db');
const { requireRole } = require('../middleware/auth');

// Summary
router.get('/summary', async (req, res) => {
  const added      = (await db.prepare('SELECT COALESCE(SUM(amount),0) as total FROM fund_log').get()).total;
  const disbursed  = (await db.prepare('SELECT COALESCE(SUM(amount),0) as total FROM disbursements').get()).total;
  const scholars   = (await db.prepare("SELECT COUNT(*) as c FROM applications WHERE status='Accepted'").get()).c;
  res.json({ added, disbursed, balance: added - disbursed, scholars });
});

// Fund log
router.get('/funds', async (req, res) => {
  res.json(await db.prepare('SELECT * FROM fund_log ORDER BY created_at DESC').all());
});
router.post('/funds', requireRole('director','finance'), async (req, res) => {
  const { source, amount, date, notes } = req.body;
  if (!source || !amount || !date) return res.status(400).json({ error: 'source, amount, date required' });
  const info = await db.prepare('INSERT INTO fund_log (source,amount,date,notes) VALUES (?,?,?,?)').run(source, amount, date, notes||'');
  res.json({ ok: true, id: info.lastInsertRowid });
});

// Disbursements
router.get('/disbursements', async (req, res) => {
  res.json(await db.prepare('SELECT * FROM disbursements ORDER BY created_at DESC').all());
});
router.post('/disbursements', requireRole('director','finance'), async (req, res) => {
  const { appId, amount, period } = req.body;
  if (!amount) return res.status(400).json({ error: 'Amount required' });

  // Balance check
  const added     = (await db.prepare('SELECT COALESCE(SUM(amount),0) as t FROM fund_log').get()).t;
  const disbursed = (await db.prepare('SELECT COALESCE(SUM(amount),0) as t FROM disbursements').get()).t;
  if (amount > (added - disbursed)) return res.status(400).json({ error: 'Insufficient fund balance' });

  const scholar = await db.prepare('SELECT name FROM applications WHERE id = ?').get(appId);
  const date = new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
  const info = await db.prepare(
    'INSERT INTO disbursements (app_id, scholar_name, amount, period, date) VALUES (?,?,?,?,?)'
  ).run(appId, scholar?.name || 'Unknown', amount, period || '', date);
  res.json({ ok: true, id: info.lastInsertRowid });
});

module.exports = router;
