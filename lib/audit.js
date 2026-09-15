const db = require('../db');

function getAuditUser(req) {
  const user = req?.user || {};
  return user.name || user.username || user.role || 'System';
}

function getAuditLogsMemory() {
  if (!Array.isArray(db.data.audit_logs)) db.data.audit_logs = [];
  return db.data.audit_logs;
}

function appendAuditLog(action, payload = {}, req = null) {
  const user = payload.user || getAuditUser(req);
  const requestUser = req?.user || {};
  const actorRole = String(payload.actorRole || requestUser.role || (requestUser.type === 'applicant' ? 'applicant' : 'system')).trim().toLowerCase();
  const actorId = payload.actorId ?? requestUser.id ?? requestUser.appId ?? requestUser.app_id ?? null;
  const applicant = payload.applicant || payload.appId || null;
  const entry = {
    id: Date.now() + Math.round(Math.random() * 10000),
    action: String(action || 'system-activity'),
    user,
    actorId,
    actorName: user,
    actorRole,
    applicant,
    entityType: payload.entityType || (applicant ? 'application' : 'system'),
    entityId: payload.entityId ?? applicant,
    entityLabel: payload.entityLabel || '',
    details: payload.details || '',
    note: payload.note || payload.details || '',
    timestamp: new Date().toISOString(),
  };

  if (db.isPostgres) {
    try {
      db.prepare('INSERT INTO audit_logs (action, user_name, applicant, details, timestamp) VALUES (?, ?, ?, ?, ?)')
        .run(entry.action, entry.user, entry.applicant || '', entry.details, entry.timestamp);
    } catch (_) {
      // Postgres schema can be added later; keep the in-memory fallback available.
    }
  } else {
    const logs = getAuditLogsMemory();
    logs.unshift(entry);
    if (typeof db.save === 'function') db.save();
  }

  return entry;
}

function listAuditLogs() {
  if (db.isPostgres) {
    try {
      return db.prepare('SELECT * FROM audit_logs ORDER BY timestamp DESC, id DESC').all();
    } catch (_) {
      return [];
    }
  }
  return getAuditLogsMemory().slice(0, 50);
}

module.exports = { appendAuditLog, listAuditLogs, getAuditUser, getAuditLogsMemory };
