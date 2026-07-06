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

const API_BASE = window.location.origin + '/api';

// ── Token helpers ─────────────────────────────────────────────────────────────
const MefamAPI = {
  // ── Auth ───────────────────────────────────────────────────────────────────
  async loginStaff(username, password) {
    sessionStorage.removeItem('mefamdev_token');
    sessionStorage.removeItem('mefamdev_session');
    const res = await this._post('/auth/login', { username, password });
    if (res.token) sessionStorage.setItem('mefamdev_token', res.token);
    if (res.user)  sessionStorage.setItem('mefamdev_session', JSON.stringify({ ...res.user, loginTime: Date.now() }));
    return res;
  },

  async loginApplicant(refNo, name) {
    sessionStorage.removeItem('mefamdev_token');
    sessionStorage.removeItem('mefamdev_session');
    const res = await this._post('/auth/applicant', { refNo, name });
    if (res.token) sessionStorage.setItem('mefamdev_token', res.token);
    if (res.user)  sessionStorage.setItem('mefamdev_session', JSON.stringify({ ...res.user, loginTime: Date.now() }));
    return res;
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
  async getApplications() {
    return this._get('/applications');
  },
  async getApplication(id) {
    return this._get(`/applications/${id}`);
  },
  async updateApplication(id, fields) {
    return this._patch(`/applications/${id}`, fields);
  },
  async deleteApplication(id) {
    return this._delete(`/applications/${id}`);
  },

  /** Public (no auth): submit the application form */
  async submitApplication(data) {
    const res = await this._post('/public/apply', data, false);
    if (res.id) {
      const loginRes = await this.loginApplicant(res.id, data.name);
      if (loginRes?.token) {
        sessionStorage.setItem('mefamdev_token', loginRes.token);
      }
      // Store a temporary session so applicant lands on portal
      sessionStorage.setItem('mefamdev_session', JSON.stringify({
        type: 'applicant', appId: res.id, name: data.name, loginTime: Date.now()
      }));
    }
    return res;
  },

  // ── Families ───────────────────────────────────────────────────────────────
  async getFamilies() { return this._get('/families'); },
  async addFamily(data) { return this._post('/families', data); },
  async deleteFamily(id) { return this._delete(`/families/${id}`); },

  // ── Events & Attendance ────────────────────────────────────────────────────
  async getEvents() { return this._get('/events'); },
  async addEvent(data) { return this._post('/events', data); },
  async deleteEvent(id) { return this._delete(`/events/${id}`); },
  async saveEventAttendance(eventId, appIds) {
    return this._put(`/events/${eventId}/attendance`, { appIds });
  },
  async getAbsences() { return this._get('/events/absences'); },
  async logAbsence(appId, days, reason) {
    return this._post('/events/absences', { appId, days, reason });
  },
  async resetAbsence(appId) { return this._delete(`/events/absences/${appId}`); },
  async getGrades() { return this._get('/events/grades'); },
  async saveGrade(appId, grade, semester) {
    return this._put(`/events/grades/${appId}`, { grade, semester });
  },

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
    const headers = { 'Authorization': 'Bearer ' + token };
    if (!token) {
      const session = this.getSession();
      if (session?.type === 'applicant' && session?.appId) {
        const loginRes = await this.loginApplicant(session.appId, session.name || '');
        token = loginRes?.token || '';
        if (token) headers.Authorization = 'Bearer ' + token;
      }
    }
    const r = await fetch(API_BASE + path, { headers });
    if (r.status === 401) { this.logout(); return; }
    return r.json();
  },
  async _post(path, body, auth = true) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth) headers['Authorization'] = 'Bearer ' + this._token();
    const r = await fetch(API_BASE + path, { method: 'POST', headers, body: JSON.stringify(body) });
    if (auth && r.status === 401) { this.logout(); return; }
    return r.json();
  },
  async _patch(path, body) {
    const r = await fetch(API_BASE + path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this._token() },
      body: JSON.stringify(body)
    });
    if (r.status === 401) { this.logout(); return; }
    return r.json();
  },
  async _put(path, body) {
    const r = await fetch(API_BASE + path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this._token() },
      body: JSON.stringify(body)
    });
    if (r.status === 401) { this.logout(); return; }
    return r.json();
  },
  async _delete(path) {
    const r = await fetch(API_BASE + path, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + this._token() }
    });
    if (r.status === 401) { this.logout(); return; }
    return r.json();
  },
};

window.MefamAPI = MefamAPI;
