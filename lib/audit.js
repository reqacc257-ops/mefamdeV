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
  const entry = {
    id: Date.now() + Math.round(Math.random() * 10000),
    action: String(action || 'system-activity'),
    user,
    applicant: payload.applicant || payload.appId || null,
    details: payload.details || '',
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
