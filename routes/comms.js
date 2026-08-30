/**
 * routes/comms.js — Announcements
 */
const router = require('express').Router();
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const { normalizeAnnouncementTag, displayAnnouncementTag } = require('../lib/announcement-tags');

router.get('/', async (req, res) => {
  res.json(await db.prepare('SELECT * FROM announcements ORDER BY created_at DESC').all());
});
router.post('/', async (req, res) => {
  const { subject, message, target, tag } = req.body;
  if (!subject || !message) return res.status(400).json({ error: 'subject and message required' });
  const normalizedTag = normalizeAnnouncementTag(tag);
  const tagValue = normalizedTag ? displayAnnouncementTag(normalizedTag) : '📢 General';
  const date = new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
  const info = await db.prepare(
    'INSERT INTO announcements (subject, message, target, tag, posted_by, date) VALUES (?,?,?,?,?,?)'
  ).run(subject, message, target || '', tagValue, req.user.name || '', date);
  res.json({ ok: true, id: info.lastInsertRowid });
});
router.delete('/:id', requireRole('director','program'), async (req, res) => {
  await db.prepare('DELETE FROM announcements WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
