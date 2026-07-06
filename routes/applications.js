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

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseApp(row) {
  if (!row) return null;
  return {
    ...row,
    name: row.name || '',
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
    date:          row.date_label || row.date || '—',
  };
}

// ── GET all ───────────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM applications ORDER BY id DESC').all();
  res.json(rows.map(parseApp));
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

  // Cooldown: 1 submission per contact number per 5 minutes
  if (b.contact) {
    const recent = db.prepare(
      "SELECT id FROM applications WHERE contact = ? AND submitted_at > datetime('now', '-5 minutes')"
    ).get(b.contact);
    if (recent) return res.status(429).json({ error: 'Please wait 5 minutes before resubmitting.' });
  }

  const stmt = db.prepare(`
    INSERT INTO applications
      (sy, name, address, barangay, dob, age, gender, contact, religion, birthplace,
       talents, clubs, ambition, living_with, edu_level, prev_grade, prev_school,
       school, grade, degree, why_scholar, total_income, total_expense,
       family_members, properties, can_provide, status, date_label, password_hash)
    VALUES
      (@sy, @name, @address, @barangay, @dob, @age, @gender, @contact, @religion, @birthplace,
       @talents, @clubs, @ambition, @living_with, @edu_level, @prev_grade, @prev_school,
       @school, @grade, @degree, @why_scholar, @total_income, @total_expense,
       @family_members, @properties, @can_provide, 'Pending Review', @date_label, @password_hash)
  `);

  const info = stmt.run({
    sy:            b.sy,
    name:          b.name,
    address:       b.address        || '',
    barangay:      b.barangay       || '',
    dob:           b.dob            || '',
    age:           b.age            || null,
    gender:        b.gender         || '',
    contact:       b.contact        || '',
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
    degree:        b.degree         || '',
    why_scholar:   b.whyScholar     || '',
    total_income:  b.totalIncome    || '0',
    total_expense: b.totalExpense   || '0',
    family_members: JSON.stringify(b.familyMembers || []),
    properties:    JSON.stringify(b.properties    || []),
    can_provide:   JSON.stringify(b.canProvide    || []),
    date_label:    b.date || b.dateLabel || new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    password_hash: b.password ? crypto.createHash('sha256').update(String(b.password)).digest('hex') : null
  });

  res.json({ ok: true, id: info.lastInsertRowid });
}

module.exports = router;
module.exports.submitPublicApplication = submitPublicApplication;
