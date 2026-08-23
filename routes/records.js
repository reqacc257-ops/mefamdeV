/**
 * routes/records.js — Intake sheets & Staff assessments
 */
const router = require('express').Router();
const db = require('../db');
const { requireRole } = require('../middleware/auth');

// ── Intake Sheets ─────────────────────────────────────
router.get('/intake', async (req, res) => {
  res.json(await db.prepare('SELECT id, linked_app_id, case_no, case_date, saved_at, json_extract(data,"$.name") as name FROM intake_sheets ORDER BY saved_at DESC').all());
});
router.get('/intake/:id', async (req, res) => {
  const row = await db.prepare('SELECT * FROM intake_sheets WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ ...row, data: JSON.parse(row.data) });
});
router.post('/intake', async (req, res) => {
  const b = req.body;
  const info = await db.prepare(
    'INSERT INTO intake_sheets (linked_app_id, case_no, case_date, case_category, case_referral, data) VALUES (?,?,?,?,?,?)'
  ).run(b.linkedAppId || null, b.caseNo || '', b.caseDate || '', b.caseCategory || '', b.caseReferral || '', JSON.stringify(b));

  // Auto-advance application to Interviewing
  if (b.linkedAppId) {
    await db.prepare("UPDATE applications SET status='Interviewing' WHERE id=? AND status='Pending Review'").run(b.linkedAppId);
  }
  res.json({ ok: true, id: info.lastInsertRowid });
});
router.delete('/intake/:id', requireRole('director','program'), async (req, res) => {
  await db.prepare('DELETE FROM intake_sheets WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── Staff Assessments ─────────────────────────────────
router.get('/assessments', async (req, res) => {
  res.json(await db.prepare('SELECT id, linked_app_id, family_surname, student, final_result, saved_at FROM assessments ORDER BY saved_at DESC').all());
});
router.post('/assessments', async (req, res) => {
  const b = req.body;
  const info = await db.prepare(
    'INSERT INTO assessments (linked_app_id, family_surname, student, final_result, data) VALUES (?,?,?,?,?)'
  ).run(b.linkedAppId || null, b.familySurname || '', b.student || '', b.finalResult || '', JSON.stringify(b));
  res.json({ ok: true, id: info.lastInsertRowid });
});
router.delete('/assessments/:id', requireRole('director','program'), async (req, res) => {
  await db.prepare('DELETE FROM assessments WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
