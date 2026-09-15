/**
 * mefamdev-api.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Drop-in API layer for MEFAMDEV-Life.
 *
 * Add this to every HTML page:
 *   <script src="/mefamdev-api.js"></script>
 *
 * It replaces direct localStorage usage with real API calls.
 * The public form and applicant portal also use this.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const configuredApiBase = window.MEFAMDEV_API_BASE || '';
const defaultApiBase = window.location.protocol === 'file:'
  ? 'https://mefamdev.onrender.com/api'
  : '/api';
const API_BASE = (configuredApiBase || defaultApiBase).replace(/\/$/, '');

function normalizeAuditEntry(entry = {}) {
  const safe = entry && typeof entry === 'object' ? entry : {};
  return {
    id: safe.id || `aud_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`,
    timestamp: safe.timestamp || new Date().toISOString(),
    actorId: safe.actorId ?? null,
    actorName: safe.actorName || safe.user || 'System',
    actorRole: safe.actorRole || safe.role || 'unknown',
    action: safe.action || 'system.activity',
    entityType: safe.entityType || safe.entity || 'settings',
    entityId: safe.entityId ?? safe.appId ?? safe.applicant ?? null,
    entityLabel: safe.entityLabel || safe.applicant || '',
    before: safe.before ?? null,
    after: safe.after ?? null,
    note: safe.note || safe.details || '',
    meta: safe.meta || {},
  };
}

function formatRelativeTime(isoString) {
  const input = isoString ? new Date(isoString) : null;
  if (!input || Number.isNaN(input.getTime())) return 'just now';
  const diffMs = Date.now() - input.getTime();
  const calc = (value, unit) => {
    const v = Math.round(value);
    return `${v}${unit} ago`;
  };
  const minutes = Math.max(0, Math.round(diffMs / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return calc(minutes, 'm');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return calc(hours, 'h');
  const days = Math.round(hours / 24);
  if (days < 7) return calc(days, 'd');
  return input.toLocaleDateString();
}

function renderActorLine({ actorName, actorRole, action, timestamp, compact = true }) {
  const name = actorName || 'System';
  const role = actorRole || 'unknown';
  const verb = action || 'activity';
  const timeLabel = timestamp ? formatRelativeTime(timestamp) : 'just now';
  const fullText = `${name} (${role}) • ${verb} • ${timeLabel}`;
  if (compact) {
    return `<span title="${escapeHtml(fullText)}">${escapeHtml(name)} · ${escapeHtml(timeLabel)}</span>`;
  }
  const avatar = name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join('').slice(0, 2) || 'S';
  return `
    <div class="audit-actor-line" title="${escapeHtml(fullText)}">
      <span class="audit-avatar">${escapeHtml(avatar)}</span>
      <span class="audit-name">${escapeHtml(name)}</span>
      <span class="audit-role">${escapeHtml(role)}</span>
      <span class="audit-action">${escapeHtml(verb)}</span>
      <span class="audit-time">${escapeHtml(new Date(timestamp || Date.now()).toLocaleString())}</span>
    </div>
  `;
}

function hydratePreviewSessionFromStorage() {
  try {
    const previewRaw = localStorage.getItem('mefamdev_preview_session');
    if (!previewRaw) return false;
    const previewSession = JSON.parse(previewRaw);
    const normalizedSession = previewSession && typeof previewSession === 'object' ? previewSession : null;
    if (!normalizedSession || !normalizedSession.type || !normalizedSession.appId) return false;
    if (normalizedSession.token) sessionStorage.setItem('mefamdev_token', normalizedSession.token);
    const existingSession = sessionStorage.getItem('mefamdev_session');
    if (!existingSession || JSON.parse(existingSession).appId !== normalizedSession.appId) {
      sessionStorage.setItem('mefamdev_session', JSON.stringify({
        ...normalizedSession,
        loginTime: Number(normalizedSession.loginTime || Date.now())
      }));
    }
    return true;
  } catch (e) {
    return false;
  }
}

function storeSession(user, token) {
  localStorage.removeItem('mefamdev_preview_session');
  sessionStorage.setItem('mefamdev_token', token);
  sessionStorage.setItem('mefamdev_session', JSON.stringify({ ...user, loginTime: Date.now() }));
}

function clearClientSession() {
  sessionStorage.removeItem('mefamdev_token');
  sessionStorage.removeItem('mefamdev_session');
  localStorage.removeItem('mefamdev_preview_session');
  localStorage.removeItem('mefamdev_trusted_device_until');
}

// ── Token helpers ─────────────────────────────────────────────────────────────
const MefamAPI = {
  // ── Auth ───────────────────────────────────────────────────────────────────
  async loginUser(username, password) {
    // Unified login: backend determines if staff or applicant
    sessionStorage.removeItem('mefamdev_token');
    sessionStorage.removeItem('mefamdev_session');
    try {
      const deviceId = `browser:${navigator.userAgent || 'unknown-device'}`;
      const res = await this._post('/auth/login', { username, password, deviceId }, false);
      if (res?.token) storeSession(res.user, res.token);
      return res;
    } catch (error) {
      return { error: 'Unable to reach the server. Please try again.' };
    }
  },
  async loginStaff(username, password) {
    sessionStorage.removeItem('mefamdev_token');
    sessionStorage.removeItem('mefamdev_session');
    try {
      const deviceId = `browser:${navigator.userAgent || 'unknown-device'}`;
      const res = await this._post('/auth/login', { username, password, deviceId }, false);
      if (res?.token) storeSession(res.user, res.token);
      return res;
    } catch (error) {
      return { error: 'Unable to reach the server. Please try again.' };
    }
  },
  async verifyDirectorOtp(challengeId, otp, deviceId, trustDevice) {
    const res = await this._post('/auth/director/verify-otp', { challengeId, otp, deviceId, trustDevice }, false);
    if (res?.token) storeSession(res.user, res.token);
    return res;
  },

  async loginApplicant(username, password) {
    // Simplified: username + password only (no reference number needed)
    sessionStorage.removeItem('mefamdev_token');
    sessionStorage.removeItem('mefamdev_session');
    const payload = { username, password };
    try {
      const res = await this._post('/auth/applicant', payload, false);
      if (res?.token) storeSession(res.user, res.token);
      return res;
    } catch (error) {
      return { error: error.message || 'Invalid username or password.' };
    }
  },

  async requestApplicantPasswordReset(email, referenceNumber) {
    return this._post('/auth/applicant/forgot-password', { email, referenceNumber }, false);
  },

  async resetApplicantPassword(token, password) {
    return this._post('/auth/applicant/reset-password', { token, password }, false);
  },

  async changeStaffPassword(oldPassword, newPassword) {
    return this._post('/auth/change-password', { oldPassword, newPassword });
  },
  async updateStaffProfile(name, username, currentPassword) {
    return this._put('/auth/profile', { name, username, currentPassword });
  },

  async revokeTrustedDevice(deviceId) {
    return this._post('/auth/director/trusted-device/revoke', { deviceId });
  },

  logout() {
    const token = this._token();
    const session = this.getSession();
    if (token && session?.type === 'staff') {
      fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
        credentials: 'same-origin',
        keepalive: true,
      }).catch(() => {});
    }
    clearClientSession();
    window.location.assign('/index.html');
  },

  getSession() {
    try {
      const raw = sessionStorage.getItem('mefamdev_session');
      if (!raw) {
        hydratePreviewSessionFromStorage();
        const rehydrated = sessionStorage.getItem('mefamdev_session');
        if (!rehydrated) return null;
        return JSON.parse(rehydrated);
      }
      const session = JSON.parse(raw);
      const loginTime = Number(session?.loginTime || 0);
      if (!session || typeof session !== 'object') {
        clearClientSession();
        return null;
      }
      if (loginTime && Date.now() - loginTime > 8 * 60 * 60 * 1000) {
        clearClientSession();
        return null;
      }
      return session;
    } catch {
      clearClientSession();
      return null;
    }
  },

  // ── Applications ───────────────────────────────────────────────────────────
  async getApplications(opts) {
    // opts: { status, page, pageSize, q, includeLatestGrade }
    if (!opts || Object.keys(opts).length === 0) return this._get('/applications');
    const params = [];
    if (opts.status) params.push(`status=${encodeURIComponent(opts.status)}`);
    if (opts.page) params.push(`page=${encodeURIComponent(opts.page)}`);
    if (opts.pageSize) params.push(`pageSize=${encodeURIComponent(opts.pageSize)}`);
    if (opts.q) params.push(`q=${encodeURIComponent(opts.q)}`);
    if (opts.includeLatestGrade) params.push(`includeLatestGrade=1`);
    const qs = params.length ? ('?' + params.join('&')) : '';
    return this._get(`/applications${qs}`);
  },
  async getApplication(id) {
    return this._get(`/applications/${id}`);
  },
  async updateApplication(id, fields) {
    return this._patch(`/applications/${id}`, fields);
  },
  async endApplicationYear(id) {
    return this._post(`/applications/${id}/end-year`, {});
  },
  async endAllApplicationYears() {
    return this._post('/applications/end-year-all', { confirmAll: true });
  },
  async reapplyApplication(id, schoolYear, details = {}) {
    return this._post(`/applications/${id}/reapply`, { schoolYear, ...details });
  },
  async deleteApplication(id, confirmation = {}) {
    return this._delete(`/applications/${id}`, confirmation);
  },
  async deleteDummyApplications() {
    return this._post('/applications/delete-dummy', {});
  },

  /** Public (no auth): submit the application form */
  async submitApplication(data) {
    const payload = { ...data, id: data.id || Date.now() };
    try {
      const res = await this._post('/public/apply', payload, false, true);
      if (res?.error) {
        return { error: res.error };
      }
      if (res?.ok !== true) {
        return { error: 'Submission was not confirmed by the server.' };
      }

      const appId = Number(res.id ?? payload.id);
      if (!Number.isFinite(appId)) {
        return { error: 'Submission was not confirmed by the server.' };
      }

      const loginRes = await this.loginApplicant(payload.username, payload.password);
      if (!loginRes?.token) {
        return loginRes || { error: 'Unable to sign in after submitting application.' };
      }
      return { ok: true, id: appId };
    } catch (error) {
      return { error: error.message || 'Unable to submit application. Please try again.' };
    }
  },
  async checkUsernameAvailability(username) {
    return this._get(`/public/username-availability?username=${encodeURIComponent(username)}`);
  },

  // ── Families ───────────────────────────────────────────────────────────────
  async getFamilies() { return this._get('/families'); },
  async addFamily(data) { return this._post('/families', data); },
  async updateFamily(id, data) { return this._put(`/families/${id}`, data); },
  async deleteFamily(id) { return this._delete(`/families/${id}`); },

  // ── Events & Attendance ────────────────────────────────────────────────────
  async getEvents() { return this._get('/events'); },
  async addEvent(data) { return this._post('/events', data); },
  async deleteEvent(id) { return this._delete(`/events/${id}`); },
  async startEventSession(eventId, expiresInMinutes) { return this._post(`/events/${eventId}/start`, { expiresInMinutes }); },
  async endEventSession(eventId) { return this._post(`/events/${eventId}/end`); },
  async saveEventAttendance(eventId, appIds) {
    return this._put(`/events/${eventId}/attendance`, { appIds });
  },
  async getEventCheckins(eventId) { return this._get(`/events/${eventId}/checkins`); },
  async checkinByCode(code, name, studentId) { return this._post('/events/checkin', { code, name, studentId }, false); },
  async getAbsences() { return this._get('/events/absences'); },
  async getMonitoring() { return this._get('/events/monitoring'); },
  async getStudentAlerts() { return this._get('/events/alert-students'); },
  async alertStudent(appId, type, message) {
    return this._post('/events/alert-students', { appId, type, message });
  },
  async deleteStudentAlert(id) { return this._delete(`/events/alert-students/${id}`); },
  async logAbsence(appId, days, reason) {
    return this._post('/events/absences', { appId, days, reason });
  },
  async resetAbsence(appId) { return this._delete(`/events/absences/${appId}`); },
  async getGrades(semester) {
    return semester ? this._get(`/events/grades?semester=${encodeURIComponent(semester)}`) : this._get('/events/grades');
  },
  async getSchools() {
    return this._get('/schools');
  },
  async getSchoolConfig(schoolId) {
    return this._get(`/schools/${encodeURIComponent(schoolId)}/config`);
  },
  async ocrImportGrades(payload) {
    return this._post('/grades/ocr-import', payload);
  },
  async getReviewQueue() {
    return this._get('/grades/review-queue');
  },
  async resolveGradeReview(id, payload) {
    return this._post(`/grades/${encodeURIComponent(id)}/resolve`, payload);
  },
  async getGradeRetention(appId) { return this._get(`/grades/retention/${appId}`); },
  async deleteRetainedGrades(appId, password) {
    return this._post(`/grades/retention/${appId}/delete`, { confirm: true, password: password || '' });
  },
  async saveGrade(appId, grade, semesterOrOptions, maybeOptions) {
    // saveGrade supports legacy (appId, grade, semester) and new format
    let options = {};
    if (semesterOrOptions && typeof semesterOrOptions === 'object') {
      options = semesterOrOptions;
    } else if (maybeOptions && typeof maybeOptions === 'object') {
      options = maybeOptions;
    }

    if (options.subject && options.quarter && options.schoolYear) {
          // Use camelCase key for server-side handler (events.js expects schoolYear)
          return this._put(`/events/grades/${appId}`, { grade, subject: options.subject, quarter: options.quarter, schoolYear: options.schoolYear });
        }

    const semester = typeof semesterOrOptions === 'string' ? semesterOrOptions : (options.semester || '');
    return this._put(`/events/grades/${appId}`, { grade, semester });
  },

  // Subjects
  async getSubjects() { return this._get('/events/subjects'); },
  async saveSubjects(subjects) { return this._put('/events/subjects', { subjects }); },

  // ── Financials ────────────────────────────────────────────────────────────
  async getFinancialSummary() { return this._get('/financials/summary'); },
  async getFundLog() { return this._get('/financials/funds'); },
  async addFunds(source, amount, date, notes) {
    return this._post('/financials/funds', { source, amount, date, notes });
  },
  async deleteFunds(id) { return this._delete(`/financials/funds/${id}`); },
  async getDisbursements() { return this._get('/financials/disbursements'); },
  async disburseStipend(appId, amount, period) {
    return this._post('/financials/disbursements', { appId, amount, period });
  },
  async deleteDisbursement(id) { return this._delete(`/financials/disbursements/${id}`); },

  // ── Records ───────────────────────────────────────────────────────────────
  async getIntakeSheets() { return this._get('/records/intake'); },
  async saveIntakeSheet(data) { return this._post('/records/intake', data); },
  async deleteIntakeSheet(id) { return this._delete(`/records/intake/${id}`); },
  async getAssessments() { return this._get('/records/assessments'); },
  async saveAssessment(data) { return this._post('/records/assessments', data); },
  async deleteAssessment(id) { return this._delete(`/records/assessments/${id}`); },

  // ── Document Checklist ────────────────────────────────────────────────────
  async getDocuments(appId) { return this._get(`/documents/${appId}`); },
  async setDocumentStatus(appId, docKey, status, note) {
    return this._put(`/documents/${appId}/${docKey}`, { status, note });
  },
  async uploadDocument(appId, docKey, payload) {
    return this._post(`/documents/${appId}/${docKey}/upload`, payload);
  },

  // ── Report Card Extraction (photo -> Claude -> staff review) ────────────
  async uploadReportCardForExtraction(appId, payload) {
    return this._post(`/grade-extraction/${appId}/upload`, payload);
  },
  async getPendingGradeExtractions() { return this._get('/grade-extraction/pending'); },
  async getGradeExtractionHistory(appId) { return this._get(`/grade-extraction/${appId}`); },
  async reviewGradeExtraction(id, action, subjects, reviewNotes, schoolYear, gradingPeriodCount, fileData = '') {
    return this._put(`/grade-extraction/${id}/review`, { action, subjects, reviewNotes, schoolYear, gradingPeriodCount, fileData });
  },

  // ── Grades (applicant + admin) ─────────────────────────────────────────
  async submitQuarter(schoolYear, quarter, subjects = [], fileData = '') {
    return this._post(`/grades`, { schoolYear, quarter, subjects, fileData });
  },

  async myGrades(schoolYear) {
    return this._get(`/grades/mine?school_year=${encodeURIComponent(schoolYear)}`);
  },
  async getApprovedGradeCard(appId, schoolYear) {
    const query = schoolYear ? `?school_year=${encodeURIComponent(schoolYear)}` : '';
    try {
      return await this._get(`/grades/student/${encodeURIComponent(appId)}/grade-card${query}`);
    } catch (error) {
      const legacy = await this._get(`/events/grades?appId=${encodeURIComponent(appId)}&schoolYear=${encodeURIComponent(schoolYear || '')}`);
      if (!Array.isArray(legacy)) throw error;
      const grouped = new Map();
      legacy.forEach(row => {
        if (!row.subject || !row.quarter) return;
        if (!grouped.has(row.subject)) grouped.set(row.subject, { subject: row.subject, quarters: {}, average: null });
        grouped.get(row.subject).quarters[row.quarter] = row.grade_val;
      });
      grouped.forEach(subject => {
        const values = Object.values(subject.quarters).filter(value => value !== null && value !== undefined);
        subject.average = values.length ? Math.round(values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length) : null;
      });
      return Array.from(grouped.values());
    }
  },

  async pendingGrades() {
    return this._get(`/grades/pending`);
  },

  async approveGrade(id) {
    return this._patch(`/grades/${id}/approve`);
  },

  async rejectGrade(id, reason = '') {
    return this._patch(`/grades/${id}/reject`, { reason });
  },

  async editGrade(id, grade_value) {
    return this._patch(`/grades/${id}`, { grade_value });
  },

  // ── Admin: reset applicant password
  async resetApplicationPassword(id, password) {
    return this._post(`/applications/${id}/reset-password`, { password });
  },

  // ── Communications ────────────────────────────────────────────────────────
  async getAnnouncements() { return this._get('/comms'); },
  async postAnnouncement(subject, message, target, tag) {
    return this._post('/comms', { subject, message, target, tag });
  },
  async deleteAnnouncement(id) { return this._delete(`/comms/${id}`); },

  // ── Audit logs ───────────────────────────────────────────────────────────
  async logAudit(entry) {
    const normalized = normalizeAuditEntry(entry);
    const payload = {
      id: normalized.id,
      timestamp: normalized.timestamp,
      entityType: normalized.entityType,
      entityId: normalized.entityId,
      entityLabel: normalized.entityLabel,
      before: normalized.before,
      after: normalized.after,
      note: normalized.note,
      meta: normalized.meta,
    };

    try {
      const result = await this._post('/audit', payload);
      const items = Array.isArray(result?.entries) ? result.entries : (result?.entry ? [result.entry] : []);
      const entries = items.map(item => normalizeAuditEntry(item));
      try {
        const existing = JSON.parse(localStorage.getItem('mefamdev_audit_logs') || '[]');
        const merged = [...entries, ...((Array.isArray(existing) ? existing : []) || [])].slice(0, 200);
        localStorage.setItem('mefamdev_audit_logs', JSON.stringify(merged));
      } catch (_) {}
      return result;
    } catch (error) {
      const fallback = { ok: true, entry: normalized, entries: [normalized], error: error.message };
      try {
        const existing = JSON.parse(localStorage.getItem('mefamdev_audit_logs') || '[]');
        const merged = [normalized, ...(Array.isArray(existing) ? existing : [])].slice(0, 200);
        localStorage.setItem('mefamdev_audit_logs', JSON.stringify(merged));
      } catch (_) {}
      return fallback;
    }
  },
  async getAudit(params = {}) {
    const qs = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      qs.append(key, String(value));
    });
    const url = qs.toString() ? `/audit?${qs.toString()}` : '/audit';
    try {
      const result = await this._get(url);
      const entries = Array.isArray(result?.entries) ? result.entries : (Array.isArray(result) ? result : []);
      const normalized = entries.map(item => normalizeAuditEntry(item));
      try { localStorage.setItem('mefamdev_audit_logs', JSON.stringify(normalized.slice(0, 200))); } catch (_) {}
      return { ok: true, entries: normalized };
    } catch (error) {
      try {
        const raw = JSON.parse(localStorage.getItem('mefamdev_audit_logs') || '[]');
        const entries = Array.isArray(raw) ? raw : [];
        const filtered = entries.filter(entry => {
          if (params.entityType && String(entry.entityType || entry.entity || '') !== String(params.entityType)) return false;
          if (params.entityId && String(entry.entityId || '') !== String(params.entityId)) return false;
          if (params.actorId && String(entry.actorId || '') !== String(params.actorId)) return false;
          return true;
        });
        return { ok: true, entries: filtered.slice(0, Number(params.limit || 50)), fallback: true };
      } catch (_) {
        return { ok: true, entries: [], fallback: true };
      }
    }
  },
  async getRecentAudit(limit = 20) {
    try {
      const result = await this._get(`/audit/recent?limit=${encodeURIComponent(limit)}`);
      const entries = Array.isArray(result?.entries) ? result.entries : (Array.isArray(result) ? result : []);
      return { ok: true, entries: entries.map(item => normalizeAuditEntry(item)) };
    } catch (_) {
      try {
        const raw = JSON.parse(localStorage.getItem('mefamdev_audit_logs') || '[]');
        const entries = Array.isArray(raw) ? raw : [];
        return { ok: true, entries: entries.slice(0, Number(limit || 20)).map(item => normalizeAuditEntry(item)) };
      } catch (_) {
        return { ok: true, entries: [] };
      }
    }
  },
  async getAuditForEntity(type, id) {
    if (!type || id === undefined || id === null) return { ok: true, entries: [] };
    return this.getAudit({ entityType: type, entityId: id, limit: 50 });
  },
  async getAuditLogs() { return this._get('/events/audit-logs'); },

  // ── Internal fetch helpers ────────────────────────────────────────────────
  _token() {
    const sessionToken = sessionStorage.getItem('mefamdev_token') || '';
    if (sessionToken) return sessionToken;

    if (hydratePreviewSessionFromStorage()) {
      const hydratedToken = sessionStorage.getItem('mefamdev_token') || '';
      if (hydratedToken) return hydratedToken;
    }

    return '';
  },

  async _get(path) {
    let token = this._token();
    const headers = {};
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (!token) {
      const session = this.getSession();
      if (session?.type === 'applicant' && session?.appId) {
        const loginRes = await this.loginApplicant(session.appId, session.name || '');
        token = loginRes?.token || '';
        if (token) headers.Authorization = 'Bearer ' + token;
      }
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const r = await fetch(`${API_BASE}${path}`, { headers, credentials: 'same-origin' });
      if (r.status === 401) { this.logout(); return; }
      if (r.status === 429) return this._parseJsonResponse(r);
      if (![429, 502, 503, 504].includes(r.status) || attempt === 2) return this._parseJsonResponse(r);
      const retryAfter = Number(r.headers.get('Retry-After'));
      const retryDelay = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 10000)
        : 350 * (attempt + 1);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  },
  async _post(path, body, auth = true, retryTransient = false) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth) {
      const token = this._token();
      if (token) headers['Authorization'] = 'Bearer ' + token;
    }
    const attempts = retryTransient ? 3 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const r = await fetch(`${API_BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body), credentials: 'same-origin' });
      if (auth && r.status === 401) { this.logout(); return; }
      if (!retryTransient || ![502, 503, 504].includes(r.status) || attempt === attempts - 1) {
        return this._parseJsonResponse(r);
      }
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  },
  async _patch(path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const token = this._token();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const r = await fetch(`${API_BASE}${path}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
      credentials: 'same-origin'
    });
    if (r.status === 401) { this.logout(); return; }
    return this._parseJsonResponse(r);
  },
  async _put(path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const token = this._token();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const r = await fetch(`${API_BASE}${path}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
      credentials: 'same-origin'
    });
    if (r.status === 401) { this.logout(); return; }
    return this._parseJsonResponse(r);
  },
  async _delete(path, body) {
    const headers = body ? { 'Content-Type': 'application/json' } : {};
    const token = this._token();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const r = await fetch(`${API_BASE}${path}`, {
      method: 'DELETE',
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
      credentials: 'same-origin'
    });
    if (r.status === 401) { this.logout(); return; }
    return this._parseJsonResponse(r);
  },
  async _parseJsonResponse(response) {
    const text = await response.text();
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('Retry-After'));
      const waitLabel = Number.isFinite(retryAfter) && retryAfter > 0
        ? ` Please try again in about ${Math.ceil(retryAfter)} second${Math.ceil(retryAfter) === 1 ? '' : 's'}.`
        : ' Please wait a moment and try again.';
      let payload = null;
      try { payload = text.trim() ? JSON.parse(text) : null; } catch (_) {}
      const error = new Error(`${payload?.error || 'The server is temporarily rate-limiting requests.'}${waitLabel}`);
      error.status = 429;
      error.retryAfter = retryAfter || null;
      throw error;
    }
    if (!text.trim()) {
      if (!response.ok) throw new Error(`Server returned an empty error response (${response.status}).`);
      return {};
    }
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new Error(`Server returned invalid JSON (${response.status}).`);
    }
    if (!response.ok) throw new Error(payload?.error || `Request failed (${response.status}).`);
    return payload;
  },
};
