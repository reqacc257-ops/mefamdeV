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

const API_BASE = (window.MEFAMDEV_API_BASE || '/api').replace(/\/$/, '');
function storeSession(user, token) {
  sessionStorage.setItem('mefamdev_token', token);
  sessionStorage.setItem('mefamdev_session', JSON.stringify({ ...user, loginTime: Date.now() }));
}

// ── Token helpers ─────────────────────────────────────────────────────────────
const MefamAPI = {
  // ── Auth ───────────────────────────────────────────────────────────────────
  async loginStaff(username, password) {
    sessionStorage.removeItem('mefamdev_token');
    sessionStorage.removeItem('mefamdev_session');
    try {
      const res = await this._post('/auth/login', { username, password }, false);
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

  async loginApplicant(refNo, name, password, username) {
    sessionStorage.removeItem('mefamdev_token');
    sessionStorage.removeItem('mefamdev_session');
    const payload = { refNo, name, password };
    if (username) payload.username = username;
    try {
      const res = await this._post('/auth/applicant', payload, false);
      if (res?.token) storeSession(res.user, res.token);
      return res;
    } catch (error) {
      return { error: 'Unable to reach the server. Please try again.' };
    }
  },

  async requestApplicantPasswordReset(email) {
    return this._post('/auth/applicant/forgot-password', { email }, false);
  },

  async resetApplicantPassword(token, password) {
    return this._post('/auth/applicant/reset-password', { token, password }, false);
  },

  async changeStaffPassword(oldPassword, newPassword) {
    return this._post('/auth/change-password', { oldPassword, newPassword });
  },

  async revokeTrustedDevice(deviceId) {
    return this._post('/auth/director/trusted-device/revoke', { deviceId });
  },

  logout() {
    sessionStorage.removeItem('mefamdev_token');
    sessionStorage.removeItem('mefamdev_session');
    window.location.href = '/index.html';
  },

  getSession() {
    try { return JSON.parse(sessionStorage.getItem('mefamdev_session')); } catch { return null; }
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
  async reapplyApplication(id, schoolYear) {
    return this._post(`/applications/${id}/reapply`, { schoolYear });
  },
  async deleteApplication(id) {
    return this._delete(`/applications/${id}`);
  },

  /** Public (no auth): submit the application form */
  async submitApplication(data) {
    const payload = { ...data, id: data.id || Date.now() };
    try {
      const res = await this._post('/public/apply', payload, false);
      if (res?.ok || res?.id) {
        const appId = res.id || payload.id;
        const loginRes = await this.loginApplicant(appId, payload.name, payload.password, payload.username);
        if (!loginRes?.token) return loginRes || { error: 'Unable to sign in after submitting application.' };
        return { ok: true, id: appId };
      }
      throw new Error(res?.error || 'Unable to submit application');
    } catch (error) {
      return { error: error.message || 'Unable to submit application. Please try again.' };
    }
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
  async logAbsence(appId, days, reason) {
    return this._post('/events/absences', { appId, days, reason });
  },
  async resetAbsence(appId) { return this._delete(`/events/absences/${appId}`); },
  async getGrades(semester) {
    return semester ? this._get(`/events/grades?semester=${encodeURIComponent(semester)}`) : this._get('/events/grades');
  },
  async getGradeRetention(appId) { return this._get(`/grades/retention/${appId}`); },
  async deleteRetainedGrades(appId) { return this._post(`/grades/retention/${appId}/delete`, { confirm: true }); },
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
  async getDisbursements() { return this._get('/financials/disbursements'); },
  async disburseStipend(appId, amount, period) {
    return this._post('/financials/disbursements', { appId, amount, period });
  },

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
  async reviewGradeExtraction(id, action, subjects, reviewNotes, schoolYear) {
    return this._put(`/grade-extraction/${id}/review`, { action, subjects, reviewNotes, schoolYear });
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
    return this._get(`/grades/student/${encodeURIComponent(appId)}/grade-card${query}`);
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

  // ── Admin: submission cooldown
  async getSubmitCooldown() { return this._get('/applications/cooldown'); },
  async setSubmitCooldown(minutes) { return this._post('/applications/cooldown', { minutes }); },

  // ── Communications ────────────────────────────────────────────────────────
  async getAnnouncements() { return this._get('/comms'); },
  async postAnnouncement(subject, message, target, tag) {
    return this._post('/comms', { subject, message, target, tag });
  },
  async deleteAnnouncement(id) { return this._delete(`/comms/${id}`); },

  // ── Internal fetch helpers ────────────────────────────────────────────────
  _token() {
    const sessionToken = sessionStorage.getItem('mefamdev_token') || '';
    if (sessionToken) return sessionToken;

    try {
      const previewRaw = localStorage.getItem('mefamdev_preview_session');
      if (previewRaw) {
        const previewSession = JSON.parse(previewRaw);
        if (previewSession?.token) return previewSession.token;
      }
    } catch (e) {
      // Ignore malformed preview session data.
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
    const r = await fetch(`${API_BASE}${path}`, { headers, credentials: 'same-origin' });
    if (r.status === 401) { this.logout(); return; }
    return r.json();
  },
  async _post(path, body, auth = true) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth) {
      const token = this._token();
      if (token) headers['Authorization'] = 'Bearer ' + token;
    }
    const r = await fetch(`${API_BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body), credentials: 'same-origin' });
    if (auth && r.status === 401) { this.logout(); return; }
    return r.json();
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
    return r.json();
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
    return r.json();
  },
  async _delete(path) {
    const headers = {};
    const token = this._token();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const r = await fetch(`${API_BASE}${path}`, {
      method: 'DELETE',
      headers,
      credentials: 'same-origin'
    });
    if (r.status === 401) { this.logout(); return; }
    return r.json();
  },
};

window.MefamAPI = MefamAPI;
