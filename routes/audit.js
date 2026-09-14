const router = require('express').Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const MAX_AUDIT_ENTRIES = 200;
const FORBIDDEN_KEYWORDS = /password|token|secret|authorization/i;

function getAuditStore() {
  if (!Array.isArray(db.data.audit_logs)) db.data.audit_logs = [];
  return db.data.audit_logs;
}

function sanitizeAuditPrimitive(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 8192) return trimmed.slice(0, 8192) + '…';
    return trimmed;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    if (depth >= 2) return value.slice(0, 25);
    return value.map(item => sanitizeAuditPrimitive(item, depth + 1)).slice(0, 25);
  }
  if (typeof value === 'object') {
    if (depth >= 2) return { truncated: true };
    const out = {};
    for (const [key, entryValue] of Object.entries(value)) {
      if (FORBIDDEN_KEYWORDS.test(key)) continue;
      out[key] = sanitizeAuditPrimitive(entryValue, depth + 1);
    }
    return out;
  }
  return String(value || '');
}

function buildActorFromRequest(req) {
  const user = req?.user || {};
  const actorName = String(user.name || user.username || user.role || 'system').trim() || 'System';
  const actorRole = String(user.role || (user.type === 'applicant' ? 'applicant' : user.type === 'staff' ? 'unknown' : 'system')).trim().toLowerCase() || 'unknown';
  return {
    actorId: user.id ?? user.appId ?? user.app_id ?? null,
    actorName,
    actorRole,
  };
}

function buildAuditId(value) {
  const candidate = String(value || '').trim();
  if (candidate) return candidate;
  return `aud_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function normalizeEntry(rawEntry = {}, req = null, { allowClientId = true } = {}) {
  const actor = buildActorFromRequest(req);
  const input = rawEntry && typeof rawEntry === 'object' ? rawEntry : {};
  const action = String(input.action || 'system.activity').trim();
  const entityType = String(input.entityType || input.entity || 'unknown').trim();
  const note = String(input.note || input.details || input.message || '').trim();
  const before = sanitizeAuditPrimitive(input.before ?? null);
  const after = sanitizeAuditPrimitive(input.after ?? null);
  const meta = sanitizeAuditPrimitive(input.meta || {});

  if (allowClientId && input.clientId) {
    meta.clientId = String(input.clientId).trim();
  }

  return {
    id: buildAuditId(input.id || (meta.clientId ? `aud_${meta.clientId}` : '')),
    timestamp: new Date(input.timestamp || Date.now()).toISOString(),
    actorId: input.actorId ?? actor.actorId ?? null,
    actorName: String(input.actorName || actor.actorName || 'System').trim() || 'System',
    actorRole: String(input.actorRole || actor.actorRole || 'unknown').trim().toLowerCase() || 'unknown',
    action,
    entityType,
    entityId: input.entityId ?? input.id ?? input.appId ?? null,
    entityLabel: String(input.entityLabel || input.applicant || input.label || '').trim(),
    before,
    after,
    note,
    meta,
  };
}

function dedupeEntry(entry) {
  const store = getAuditStore();
  const clientId = entry?.meta?.clientId;
  if (clientId) {
    const existing = store.find(item => String(item?.meta?.clientId || '').trim() === clientId);
    if (existing) return existing;
  }
  return null;
}

function readAllowedEntries(req, entries) {
  const user = req?.user || {};
  const role = String(user.role || (user.type === 'applicant' ? 'applicant' : 'unknown')).toLowerCase();
  const actorId = user.id ?? user.appId ?? user.app_id ?? null;
  const isDirector = role === 'director';
  const isApplicant = user.type === 'applicant';

  return entries.filter(entry => {
    if (isDirector) return true;
    if (isApplicant) {
      const matchesActor = entry.actorId != null && String(entry.actorId) === String(actorId);
      const matchesEntity = entry.entityId != null && String(entry.entityId) === String(actorId);
      return matchesActor || matchesEntity;
    }
    if (entry.entityType && entry.entityId) return true;
    return entry.actorId != null && String(entry.actorId) === String(actorId);
  });
}

router.get('/', requireAuth, async (req, res) => {
  const { entityType, entityId, actorId, from, to, limit = 50, offset = 0 } = req.query || {};
  const entries = readAllowedEntries(req, getAuditStore().slice());

  const filtered = entries.filter(entry => {
    if (entityType && String(entry.entityType) !== String(entityType)) return false;
    if (entityId && String(entry.entityId) !== String(entityId)) return false;
    if (actorId && String(entry.actorId) !== String(actorId)) return false;
    if (from && new Date(entry.timestamp) < new Date(from)) return false;
    if (to && new Date(entry.timestamp) > new Date(to)) return false;
    return true;
  });

  const start = Number(offset || 0);
  const end = Number(limit || filtered.length || 0);
  res.json({ ok: true, entries: filtered.slice(start, start + end) });
});

router.get('/recent', requireAuth, async (req, res) => {
  const limit = Math.max(1, Math.min(100, Number(req.query?.limit || 20)));
  const entries = readAllowedEntries(req, getAuditStore().slice()).slice(0, limit);
  res.json({ ok: true, entries });
});

router.post('/', requireAuth, async (req, res) => {
  const body = req.body || {};
  const attemptedOverride = ['actorId', 'actorName', 'actorRole'].some(field => Object.prototype.hasOwnProperty.call(body, field));

  if (attemptedOverride) {
    return res.status(400).json({ error: 'Actor identity is derived from the authenticated session and cannot be overridden.' });
  }

  const entry = normalizeEntry(body, req);
  if (!entry.action || !entry.entityType || !entry.entityType.trim()) {
    return res.status(400).json({ error: 'action and entityType are required.' });
  }

  const existing = dedupeEntry(entry);
  if (existing) {
    return res.json({ ok: true, deduplicated: true, entries: [existing] });
  }

  const store = getAuditStore();
  store.unshift(entry);
  store.splice(MAX_AUDIT_ENTRIES);
  res.json({ ok: true, deduplicated: false, entry, entries: [entry] });
});

module.exports = router;
