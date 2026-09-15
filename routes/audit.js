const router = require('express').Router();
const { listAuditLogs } = require('../lib/audit');

router.get('/', async (req, res) => {
  const limit = Math.max(1, Math.min(200, Number(req.query?.limit || 50)));
  const query = String(req.query?.q || '').trim().toLowerCase();
  const actorRole = String(req.query?.actorRole || '').trim().toLowerCase();
  const entityType = String(req.query?.entityType || '').trim().toLowerCase();
  let entries = listAuditLogs();

  if (query) entries = entries.filter(entry => JSON.stringify(entry).toLowerCase().includes(query));
  if (actorRole) entries = entries.filter(entry => String(entry.actorRole || entry.role || '').toLowerCase() === actorRole);
  if (entityType) entries = entries.filter(entry => String(entry.entityType || entry.entity || '').toLowerCase() === entityType);

  res.json({ ok: true, entries: entries.slice(0, limit) });
});

router.get('/recent', async (req, res) => {
  const limit = Math.max(1, Math.min(200, Number(req.query?.limit || 50)));
  res.json({ ok: true, entries: listAuditLogs().slice(0, limit) });
});

module.exports = router;