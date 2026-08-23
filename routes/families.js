/**
 * routes/families.js
 */
const router = require('express').Router();
const db = require('../db');
const { requireRole } = require('../middleware/auth');

router.get('/',      async (req, res) => res.json(await db.prepare('SELECT * FROM families ORDER BY surname').all()));
router.post('/',     async (req, res) => {
  const b = req.body;
  if (!b.surname) return res.status(400).json({ error: 'Surname required' });
  const result = await db.prepare('INSERT INTO families (surname,guardian,barangay,contact,income,bracket,benefits) VALUES (?,?,?,?,?,?,?)').run(b.surname, b.guardian||'', b.barangay||'', b.contact||'', b.income||'', b.bracket||'', b.benefits||'');
  res.json({ ok: true, id: result.lastInsertRowid });
});
router.put('/:id', requireRole('director','finance'), async (req, res) => {
  const b = req.body;
  if (!b.surname) return res.status(400).json({ error: 'Surname required' });
  await db.prepare(
    'UPDATE families SET surname = ?, guardian = ?, barangay = ?, contact = ?, income = ?, bracket = ?, benefits = ? WHERE id = ?'
  ).run(b.surname, b.guardian||'', b.barangay||'', b.contact||'', b.income||'', b.bracket||'', b.benefits||'', req.params.id);
  res.json({ ok: true });
});
router.delete('/:id', requireRole('director','finance'), async (req, res) => {
  await db.prepare('DELETE FROM families WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
