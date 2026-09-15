/**
 * Central client-side audit log for local-only actions and UI events.
 * API-backed mutations are audited by the server request middleware.
 */
(function (global) {
  'use strict';

  const ACTIONS = {
    APPLICATION_SUBMIT: 'application.submit',
    APPLICATION_STATUS_CHANGE: 'application.status-change',
    APPLICATION_ACCEPT: 'application.accept',
    APPLICATION_REJECT: 'application.reject',
    APPLICATION_EDIT: 'application.edit',
    APPLICATION_DELETE: 'application.delete',
    APPLICATION_REAPPLY: 'application.reapply',
    APPLICATION_MEKONG_TOGGLE: 'application.mekong-toggle',
    APPLICATION_END_YEAR: 'application.end-year',
    APPLICATION_END_YEAR_ALL: 'application.end-year-all',
    APPLICATION_PROFILE_PHOTO: 'application.profile-photo',
    APPLICATION_RESET_PASSWORD: 'application.reset-password',
    APPLICATION_DELETE_DUMMY: 'application.delete-dummy',
    APPLICATION_NOTES_UPDATE: 'application.notes-update',
    DOCUMENT_UPLOAD: 'document.upload',
    DOCUMENT_APPROVE: 'document.approve',
    DOCUMENT_REJECT: 'document.reject',
    GRADE_ENTER: 'grade.enter',
    GRADE_EDIT: 'grade.edit',
    GRADE_APPROVE: 'grade.approve',
    GRADE_REJECT: 'grade.reject',
    GRADE_EXTRACTION_REVIEW: 'grade.extraction-review',
    GRADE_SUBJECTS_UPDATE: 'grade.subjects-update',
    GRADE_PERIODS_UPDATE: 'grade.periods-update',
    FUND_ADD: 'fund.add',
    FUND_DELETE: 'fund.delete',
    DISBURSEMENT_RELEASE: 'disbursement.release',
    DISBURSEMENT_BATCH: 'disbursement.batch',
    DISBURSEMENT_DELETE: 'disbursement.delete',
    FAMILY_ADD: 'family.add',
    FAMILY_EDIT: 'family.edit',
    FAMILY_DELETE: 'family.delete',
    EVENT_ADD: 'event.add',
    EVENT_EDIT: 'event.edit',
    EVENT_DELETE: 'event.delete',
    EVENT_SESSION_START: 'event.session-start',
    EVENT_SESSION_END: 'event.session-end',
    EVENT_ATTENDANCE_SAVE: 'event.attendance-save',
    ABSENCE_LOG: 'absence.log',
    ABSENCE_RESET: 'absence.reset',
    STUDENT_ALERT: 'student.alert',
    ANNOUNCEMENT_POST: 'announcement.post',
    ANNOUNCEMENT_DELETE: 'announcement.delete',
    SETTINGS_UPDATE: 'settings.update',
    SETTINGS_PASSWORD_CHANGE: 'settings.password-change',
    SETTINGS_PROFILE_UPDATE: 'settings.profile-update',
    SETTINGS_TRUSTED_DEVICE_REVOKE: 'settings.trusted-device-revoke',
    SETTINGS_DELETE_RETAINED_GRADES: 'settings.delete-retained-grades',
    PRINT_GENERATED: 'print.generated',
    AUTH_LOGIN: 'auth.login',
    AUTH_FAILED: 'auth.failed',
    AUTH_LOGOUT: 'auth.logout',
    INTAKE_SAVE: 'intake.save',
    INTAKE_DELETE: 'intake.delete',
    ASSESSMENT_SAVE: 'assessment.save',
    ASSESSMENT_DELETE: 'assessment.delete',
    AUTH_OTP_VERIFY: 'auth.otp-verify',
    AUTH_PASSWORD_RESET_REQUEST: 'auth.password-reset-request',
    AUTH_PASSWORD_RESET: 'auth.password-reset',
    AUTH_CHECKIN: 'auth.checkin',
  };
  const ENTITIES = {
    APPLICATION: 'Application',
    DOCUMENT: 'Document',
    GRADE: 'Grade',
    FUND: 'Fund',
    DISBURSEMENT: 'Disbursement',
    FAMILY: 'Family',
    EVENT: 'Event',
    ANNOUNCEMENT: 'Announcement',
    SETTINGS: 'Settings',
    AUTH: 'Auth',
    PRINT: 'Print',
    INTAKE: 'Intake',
    ASSESSMENT: 'Assessment',
    SUBJECTS: 'Subjects',
    ABSENCE: 'Absence',
    STUDENT_ALERT: 'StudentAlert',
    SYSTEM: 'System',
  };
  const STORAGE_KEY = 'mefamdev_audit_logs';
  const MAX_LOCAL = 2000;

  function readLocal() {
    try {
      const value = JSON.parse(global.localStorage.getItem(STORAGE_KEY) || '[]');
      if (!Array.isArray(value)) return [];
      const filtered = value
        .filter(row => row?.action !== 'print.generated')
        .map(row => {
          const isLegacySystem = String(row?.actorName || row?.user || '').trim().toLowerCase() === 'system'
            || String(row?.actorRole || '').trim().toLowerCase() === 'system';
          return isLegacySystem ? { ...row, user: 'Director', actorName: 'Director', actorRole: 'director' } : row;
        });
      if (JSON.stringify(filtered) !== JSON.stringify(value)) {
        global.localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
      }
      return filtered;
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
    const sessionCandidates = [];
    for (const source of [global, global.parent !== global ? global.parent : null, global.opener]) {
      try {
        const session = source?.MefamAPI?.getSession?.();
        if (session) sessionCandidates.push(session);
      } catch (_) {}
    }
    try {
      const session = sessionCandidates.find(value => value && typeof value === 'object');
      if (session?.type === 'staff' || (session && session.role && session.role !== 'applicant')) {
        return {
          name: session.name || session.displayName || session.username || 'Staff',
          role: String(session.role || 'staff').toLowerCase(),
          id: session.id || session.staffId || null
        };
      }
      if (session?.type === 'applicant') {
        return { name: session.name || 'Applicant', role: 'applicant', id: session.appId || null };
      }
    } catch (_) {}
    for (const storage of [global.sessionStorage, global.parent !== global ? global.parent.sessionStorage : null, global.opener?.sessionStorage]) {
      try {
        const raw = storage?.getItem('mefamdev_session');
        if (!raw) continue;
        const session = JSON.parse(raw);
        if (session && (session.name || session.username || session.displayName)) {
          return {
            name: session.name || session.displayName || session.username,
            role: String(session.role || session.type || 'staff').toLowerCase(),
            id: session.id || session.staffId || session.appId || null
          };
        }
      } catch (_) {}
    }
    try {
      const profile = JSON.parse(global.localStorage?.getItem('mefamdev_staff_profile') || '{}');
      if (profile.displayName) {
        const session = sessionCandidates.find(value => value && typeof value === 'object');
        return {
          name: profile.displayName,
          role: String(session?.role || 'staff').toLowerCase(),
          id: session?.id || session?.staffId || null
        };
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
    safeLog(action, options) {
      try { return this.log(action, options).catch(() => null); } catch (_) { return null; }
    },
    async getAll() {
      let remote = [];
      try {
        const rows = await global.MefamAPI?.getAuditLogs?.();
        if (Array.isArray(rows)) remote = rows.filter(row => row?.action !== 'print.generated');
      } catch (_) {}
      const local = readLocal();
      const localById = new Map(local.filter(row => row?.id).map(row => [row.id, row]));
      const merged = remote.map(row => {
        const localMatch = row?.id ? localById.get(row.id) : null;
        const remoteName = String(row?.actorName || row?.user_name || row?.user || '').trim().toLowerCase();
        if (localMatch?.actorName && !['system', 'unknown'].includes(remoteName)) return row;
        if (localMatch?.actorName && (!remoteName || remoteName === 'system' || remoteName === 'unknown')) {
          return { ...row, actorName: localMatch.actorName, actorRole: localMatch.actorRole, actorId: localMatch.actorId };
        }
        return row;
      });
      const remoteIds = new Set(remote.map(row => row?.id).filter(Boolean));
      return [...merged, ...local.filter(row => row?.id && !remoteIds.has(row.id))];
    },
    clearLocal() { writeLocal([]); },
  };

  global.AuditLog = AuditLog;
  global.AUDIT_ACTIONS = ACTIONS;
  global.AUDIT_ENTITY_TYPES = ENTITIES;
})(window);
