/**
 * Central client-side audit log for local-only actions and UI events.
 * API-backed mutations are audited by the server request middleware.
 */
(function (global) {
  'use strict';

  const ACTIONS = {
    PRINT_GENERATED: 'print.generated',
    AUTH_LOGIN: 'auth.login',
    AUTH_FAILED: 'auth.failed',
    AUTH_LOGOUT: 'auth.logout',
    INTAKE_SAVE: 'intake.save',
    INTAKE_DELETE: 'intake.delete',
    ASSESSMENT_SAVE: 'assessment.save',
    ASSESSMENT_DELETE: 'assessment.delete',
  };
  const ENTITIES = {
    AUTH: 'Auth',
    PRINT: 'Print',
    INTAKE: 'Intake',
    ASSESSMENT: 'Assessment',
  };
  const STORAGE_KEY = 'mefamdev_audit_logs';
  const MAX_LOCAL = 2000;

  function readLocal() {
    try {
      const value = JSON.parse(global.localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(value) ? value : [];
    } catch (_) {
      return [];
    }
  }

  function writeLocal(entries) {
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_LOCAL)));
    } catch (_) {
      // Audit logging must never break the user action being recorded.
    }
  }

  function actor() {
    try {
      const session = global.MefamAPI?.getSession?.();
      if (session?.type === 'staff') {
        return { name: session.name || session.username || 'Staff', role: session.role || 'staff', id: session.id || null };
      }
      if (session?.type === 'applicant') {
        return { name: session.name || 'Applicant', role: 'applicant', id: session.appId || null };
      }
    } catch (_) {}
    return { name: 'System', role: 'system', id: null };
  }

  const AuditLog = {
    actions: ACTIONS,
    entities: ENTITIES,
    getAllLocal: readLocal,
    async log(action, options = {}) {
      const currentActor = options.actor || actor();
      const entry = {
        id: `client-audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        action: String(action || 'system.activity'),
        actorName: currentActor.name || 'System',
        actorRole: String(currentActor.role || 'system').toLowerCase(),
        actorId: currentActor.id ?? null,
        entityType: options.entityType || 'System',
        entityId: options.entityId ?? null,
        entityLabel: String(options.entityLabel || ''),
        note: String(options.note || ''),
        details: String(options.details || options.note || ''),
        before: options.before ?? null,
        after: options.after ?? null,
        meta: options.meta || null,
      };

      writeLocal([entry, ...readLocal()]);
      try {
        const hasSession = Boolean(global.MefamAPI?.getSession?.());
        const hasToken = Boolean(global.MefamAPI?._token?.());
        if (hasSession && hasToken && global.MefamAPI?.recordAuditLog) {
          await global.MefamAPI.recordAuditLog(entry.action, entry);
        }
      } catch (error) {
        console.warn('[AuditLog] Server sync failed; local entry retained.', error);
      }
      try {
        global.dispatchEvent(new CustomEvent('mefamdev:audit-log', { detail: entry }));
      } catch (_) {}
      return entry;
    },
    async getAll() {
      let remote = [];
      try {
        const rows = await global.MefamAPI?.getAuditLogs?.();
        if (Array.isArray(rows)) remote = rows;
      } catch (_) {}
      const local = readLocal();
      const remoteIds = new Set(remote.map(row => row?.id).filter(Boolean));
      return [...remote, ...local.filter(row => row?.id && !remoteIds.has(row.id))];
    },
    clearLocal() { writeLocal([]); },
  };

  global.AuditLog = AuditLog;
  global.AUDIT_ACTIONS = ACTIONS;
  global.AUDIT_ENTITY_TYPES = ENTITIES;
})(window);
