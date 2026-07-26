/**
 * routes/applications.js
 *
 * GET    /api/applications          — list all (staff)
 * GET    /api/applications/:id      — single application
 * POST   /api/applications          — create (staff / admin)
 * PATCH  /api/applications/:id      — update status, etc.
 * DELETE /api/applications/:id      — delete (director only)
 *
 * POST   /api/public/apply          — public form submission (no auth)
 */

const router = require('express').Router();
const db = require('../db');
const crypto = require('crypto');
const { requireRole } = require('../middleware/auth');
const documentsRouter = require('./documents');

// Runtime toggle for submission cooldown (minutes). 0 = disabled.
let submitCooldownMinutes = 0;

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseApp(row) {
  if (!row) return null;
  return {
    ...row,
    name: row.name || '',
    email: row.email || '',
    status: row.status || 'Pending Review',
    school: row.school || '',
    grade: row.grade || '',
    sy: row.sy || '',
    barangay: row.barangay || '',
    family_members: JSON.parse(row.family_members || '[]'),
    properties:     JSON.parse(row.properties     || '[]'),
    can_provide:    JSON.parse(row.can_provide     || '[]'),
    // Legacy field names kept for frontend compatibility
    familyMembers: JSON.parse(row.family_members || '[]'),
    livingWith:    row.living_with,
    eduLevel:      row.edu_level,
    prevGrade:     row.prev_grade,
    prevSchool:    row.prev_school,
    totalIncome:   row.total_income,
    totalExpense:  row.total_expense,
    whyScholar:    row.why_scholar,
    reference:      row.reference || row.reference_number || row.referenceNumber || '',
    referenceNumber: row.reference_number || row.referenceNumber || row.reference || '',
    date:            row.date_label || row.date || '—',
    submittedData: (() => {
      try { return JSON.parse(row.submitted_data || '{}'); } catch { return row.submitted_data || {}; }
    })(),
    statusHistory: (() => {
      try { return JSON.parse(row.status_history || '[]'); } catch { return []; }
    })(),
    submittedAt: row.submitted_at || row.submittedAt || '',
    statusUpdatedAt: row.status_updated_at || row.statusUpdatedAt || '',
  };
}

// ── GET all (supports optional paging & filtering) ─────────────────────────────────
router.get('/', (req, res) => {
  const page = req.query.page ? Math.max(1, parseInt(req.query.page, 10) || 1) : null;
  const pageSize = req.query.pageSize ? Math.max(1, parseInt(req.query.pageSize, 10) || 20) : null;
  const status = req.query.status ? String(req.query.status).trim() : null;
  const q = req.query.q ? String(req.query.q).trim() : null;
  const includeLatestGrade = req.query.includeLatestGrade === 'true' || req.query.includeLatestGrade === '1';

  // If no paging requested, maintain original behavior
  if (!page) {
    const rows = db.prepare('SELECT * FROM applications ORDER BY id DESC').all();
    return res.json(rows.map(parseApp));
  }

  // Build WHERE clauses
  const where = [];
  const params = [];
  if (status) { where.push('status = ?'); params.push(status); }
  if (q) {
    // search name or reference number
    where.push('(LOWER(name) LIKE ? OR LOWER(reference_number) LIKE ?)');
    const like = '%' + q.toLowerCase().replace(/%/g, '\\%') + '%';
    params.push(like, like);
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  // Count total
  const countRow = db.prepare(`SELECT COUNT(*) as c FROM applications ${whereSql}`).get(...params);
  const total = countRow ? Number(countRow.c || 0) : 0;

  const offset = (page - 1) * (pageSize || 20);
  // Select fields — include latest grade via subquery when requested
  const latestGradeSql = includeLatestGrade ? `, (SELECT grade_val FROM grades g WHERE g.app_id = applications.id ORDER BY datetime(updated_at) DESC LIMIT 1) as latest_grade` : '';
  const rows = db.prepare(`SELECT * ${latestGradeSql} FROM applications ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, pageSize || 20, offset);

  const items = rows.map(r => {
    const parsed = parseApp(r);
    if (includeLatestGrade) parsed.latest_grade = r.latest_grade !== undefined ? Number(r.latest_grade || 0) : null;
    return parsed;
  });

  return res.json({ items, total, page, pageSize: pageSize || 20 });
});

// ── GET single ────────────────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });

  // Applicants can only see their own application
  if (req.user.type === 'applicant' && req.user.appId !== row.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(parseApp(row));
});

// ── PATCH status / fields ─────────────────────────────────────────────────────
router.patch('/:id', (req, res) => {
  if (req.user.type === 'applicant') return res.status(403).json({ error: 'Forbidden' });

  const allowed = ['status','sy','school','grade','contact','ambition','why_scholar'];
  const updates = [];
  const values  = [];
  for (const key of allowed) {
    if (req.body[key] !== undefined) { updates.push(`${key} = ?`); values.push(req.body[key]); }
  }
  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });

  const newStatus = req.body.status;
  const app = db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id);
  if (!app) return res.status(404).json({ error: 'Not found' });

  if (newStatus && newStatus.toLowerCase() === 'accepted') {
    const familyMembers = JSON.parse(app.family_members || '[]');
    const applicantName = app.name || '';
    const lastName = applicantName.trim().split(/\s+/).slice(-1)[0] || 'Family';
    const alreadyExists = db.prepare('SELECT id FROM families WHERE surname = ?').get(lastName);

    if (!alreadyExists && familyMembers.length > 0) {
      const guardianName = familyMembers.find(member => /father|mother|guardian/i.test(member.relation || ''))?.name || applicantName;
      const contact = app.contact || '';
      const barangay = app.barangay || '';
      const income = app.total_income || '';
      const benefits = JSON.parse(app.properties || '[]').join(', ') || '';

      db.prepare(`
        INSERT INTO families (surname, guardian, barangay, contact, income, bracket, benefits)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(lastName, guardianName, barangay, contact, income, '', benefits);
    }
  }

  values.push(req.params.id);
  db.prepare(`UPDATE applications SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  res.json({ ok: true });
});

// ── DELETE ────────────────────────────────────────────────────────────────────
router.delete('/:id', requireRole('director'), (req, res) => {
  db.prepare('DELETE FROM applications WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── Public form submit (exported separately, mounted without auth) ─────────────
function submitPublicApplication(req, res) {
  const b = req.body;
  if (!b.name || !b.sy) return res.status(400).json({ error: 'Name and school year required' });
  if (!b.username) return res.status(400).json({ error: 'Portal username required' });
  if (!b.password) return res.status(400).json({ error: 'Portal password required' });

  // Server-side submission cooldown (minutes). Uses runtime value `submitCooldownMinutes` (0 = disabled).
  if (submitCooldownMinutes > 0 && b.contact) {
    const recent = db.prepare(
      `SELECT id FROM applications WHERE contact = ? AND submitted_at > datetime('now', '-${submitCooldownMinutes} minutes')`
    ).get(b.contact);
    if (recent) return res.status(429).json({ error: `Please wait ${submitCooldownMinutes} minutes before resubmitting.` });
  }

  const hasId = b.id !== undefined && b.id !== null && b.id !== '';
  const insertColumns = [
    'sy', 'name', 'address', 'barangay', 'dob', 'age', 'gender', 'contact', 'email', 'religion', 'birthplace',
    'talents', 'clubs', 'ambition', 'living_with', 'edu_level', 'prev_grade', 'prev_school',
    'school', 'grade', 'degree', 'why_scholar', 'total_income', 'total_expense',
    'family_members', 'properties', 'can_provide', 'status', 'date_label', 'password_hash', 'portal_username',
    'reference_number', 'submitted_at', 'submitted_data', 'status_updated_at', 'status_history'
  ];
  if (hasId) insertColumns.unshift('id');

  const stmt = db.prepare(`
    INSERT INTO applications
      (${insertColumns.join(', ')})
    VALUES
      (${insertColumns.map(col => `@${col}`).join(', ')})
  `);

  const params = {
    sy:            b.sy,
    name:          b.name,
    address:       b.address        || '',
    barangay:      b.barangay       || '',
    dob:           b.dob            || '',
    age:           b.age            || null,
    gender:        b.gender         || '',
    contact:       b.contact        || '',
    email:         b.email          || '',
    religion:      b.religion       || '',
    birthplace:    b.birthplace     || '',
    talents:       b.talents        || '',
    clubs:         b.clubs          || '',
    ambition:      b.ambition       || '',
    living_with:   b.livingWith     || '',
    edu_level:     b.eduLevel       || '',
    prev_grade:    b.prevGrade      || '',
    prev_school:   b.prevSchool     || '',
    school:        b.school         || '',
    grade:         b.grade          || '',
    degree:        b.degree          || '',
    why_scholar:   b.whyScholar     || '',
    total_income:  b.totalIncome    || '0',
    total_expense: b.totalExpense   || '0',
    family_members: JSON.stringify(b.familyMembers || []),
    properties:    JSON.stringify(b.properties    || []),
    can_provide:   JSON.stringify(b.canProvide    || []),
    status:        'Pending Review',
    date_label:    b.date || b.dateLabel || b.applicationDate || b.application_date || new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    password_hash: b.password ? crypto.createHash('sha256').update(String(b.password)).digest('hex') : null,
    portal_username: b.username ? String(b.username).trim() : null,
    reference_number: b.referenceNumber || b.reference_number || '',
    submitted_at: b.submittedAt || b.submitted_at || new Date().toISOString(),
    submitted_data: JSON.stringify(b.submittedData || {}),
    status_updated_at: b.statusUpdatedAt || b.status_updated_at || new Date().toISOString(),
    status_history: JSON.stringify(b.statusHistory || [{ status: 'Pending Review', changedAt: new Date().toISOString(), note: 'Application submitted' }])
  };
  if (hasId) params.id = Number(b.id);

  const info = stmt.run(params);

  db.prepare(`
    UPDATE applications
    SET submitted_at = ?, submitted_data = ?, status_updated_at = ?, status_history = ?
    WHERE id = ?
  `).run(
    b.submittedAt || b.submitted_at || new Date().toISOString(),
    JSON.stringify(b.submittedData || {}),
    b.statusUpdatedAt || b.status_updated_at || new Date().toISOString(),
    JSON.stringify(b.statusHistory || [{ status: 'Pending Review', changedAt: new Date().toISOString(), note: 'Application submitted' }]),
    info.lastInsertRowid
  );

  if (documentsRouter && typeof documentsRouter.seedChecklistForApplication === 'function') {
    documentsRouter.seedChecklistForApplication(info.lastInsertRowid);
  }

  res.json({ ok: true, id: info.lastInsertRowid });
}

module.exports = router;
module.exports.submitPublicApplication = submitPublicApplication;

// ── Admin: reset / set applicant password ───────────────────────────────────
router.post('/:id/reset-password', requireRole('director','program','finance'), (req, res) => {
  const id = req.params.id;
  const newPass = req.body.password;
  const app = db.prepare('SELECT id FROM applications WHERE id = ?').get(id);
  if (!app) return res.status(404).json({ error: 'Application not found' });

  if (newPass === null || newPass === undefined || newPass === '') {
    // Clear password
    db.prepare('UPDATE applications SET password_hash = NULL WHERE id = ?').run(id);
    return res.json({ ok: true, message: 'Password cleared' });
  }

  const hash = crypto.createHash('sha256').update(String(newPass)).digest('hex');
  db.prepare('UPDATE applications SET password_hash = ? WHERE id = ?').run(hash, id);
  res.json({ ok: true });
});

// ── Admin: get/set submission cooldown minutes ──────────────────────────────
router.get('/cooldown', requireRole('director','program','finance'), (req, res) => {
  res.json({ minutes: submitCooldownMinutes });
});

router.post('/cooldown', requireRole('director','program','finance'), (req, res) => {
  const mins = parseInt(req.body.minutes, 10);
  if (isNaN(mins) || mins < 0) return res.status(400).json({ error: 'Invalid minutes' });
  submitCooldownMinutes = mins;
  res.json({ ok: true, minutes: submitCooldownMinutes });
});
