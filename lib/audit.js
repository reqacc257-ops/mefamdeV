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
  if (req) req._auditLogged = true;
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
    before: payload.before ?? null,
    after: payload.after ?? null,
    meta: payload.meta || null,
    timestamp: new Date().toISOString(),
  };

  if (db.isPostgres) {
    db.prepare(`INSERT INTO audit_logs
      (action, user_name, applicant, details, timestamp, actor_id, actor_role, entity_type, entity_id, entity_label, note, meta)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(entry.action, entry.user, entry.applicant || '', entry.details, entry.timestamp,
        entry.actorId, entry.actorRole, entry.entityType, entry.entityId, entry.entityLabel, entry.note,
        entry.meta ? JSON.stringify(entry.meta) : null)
      .catch(() => {});
  } else {
    const logs = getAuditLogsMemory();
    logs.unshift(entry);
    if (typeof db.save === 'function') db.save();
  }

  return entry;
}

async function purgePrintAuditLogs() {
  if (db.isPostgres) {
    try {
      await db.prepare("DELETE FROM audit_logs WHERE action = 'print.generated'").run();
    } catch (_) {}
    return;
  }

  const logs = getAuditLogsMemory();
  const filtered = logs.filter(entry => entry?.action !== 'print.generated');
  if (filtered.length !== logs.length) {
    db.data.audit_logs = filtered;
    if (typeof db.save === 'function') db.save();
  }
}

async function listAuditLogs() {
  await purgePrintAuditLogs();
  if (db.isPostgres) {
    try {
      return await db.prepare('SELECT * FROM audit_logs ORDER BY timestamp DESC, id DESC').all();
    } catch (_) {
      return [];
    }
  }
  return getAuditLogsMemory().slice(0, 50);
}

module.exports = { appendAuditLog, listAuditLogs, purgePrintAuditLogs, getAuditUser, getAuditLogsMemory };
