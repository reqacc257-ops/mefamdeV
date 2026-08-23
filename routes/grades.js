const router = require('express').Router();
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const logger = require('../lib/logger');

const RETENTION_YEARS = 7;

async function getGradeRetention(appId) {
  const legacy = await db.prepare('SELECT * FROM grades WHERE app_id = ?').all(appId);
  const quarterly = await db.prepare('SELECT * FROM quarterly_grades WHERE student_id = ?').all(appId);
  const extraction = await db.prepare('SELECT * FROM grade_extraction WHERE app_id = ?').all(appId);
  const dates = [...legacy, ...quarterly, ...extraction]
    .map(row => row.updated_at || row.submitted_at || row.uploaded_at || row.created_at)
    .filter(Boolean)
    .map(value => new Date(value).getTime())
    .filter(Number.isFinite);
  const oldest = dates.length ? new Date(Math.min(...dates)) : null;
  const eligibleAt = oldest ? new Date(oldest).setFullYear(new Date(oldest).getFullYear() + RETENTION_YEARS) : null;
  return {
    appId: Number(appId),
    recordCount: legacy.length + quarterly.length + extraction.length,
    oldestRecordAt: oldest ? oldest.toISOString() : null,
    eligibleAt: eligibleAt ? new Date(eligibleAt).toISOString() : null,
    eligible: Boolean(eligibleAt && Date.now() >= eligibleAt),
  };
}

router.get('/retention/:appId', requireRole('director'), async (req, res) => {
  res.json(await getGradeRetention(req.params.appId));
});

router.post('/retention/:appId/delete', requireRole('director'), async (req, res) => {
  if (req.body?.confirm !== true) return res.status(400).json({ error: 'Final confirmation is required.' });
  const retention = await getGradeRetention(req.params.appId);
  if (!retention.eligible) {
    return res.status(400).json({ error: 'Grade records cannot be deleted before the seven-year retention period.', retention });
  }
  await db.prepare('DELETE FROM grades WHERE app_id = ?').run(req.params.appId);
  await db.prepare('DELETE FROM quarterly_grades WHERE student_id = ?').run(req.params.appId);
  await db.prepare('DELETE FROM grade_extraction WHERE app_id = ?').run(req.params.appId);
  res.json({ ok: true, deleted: true, appId: Number(req.params.appId) });
});

// Student: submit a quarter (array of subjects)
router.post('/', async (req, res) => {
  const user = req.user || {};
  if (user.type !== 'applicant') return res.status(403).json({ error: 'Only applicants may submit grades' });
  const studentId = user.appId || user.app_id || user.appID;
  const { schoolYear, quarter, subjects, fileData } = req.body || {};
  if (!studentId) return res.status(400).json({ error: 'Student ID missing from session' });
  if (!schoolYear || !quarter || !Array.isArray(subjects)) return res.status(400).json({ error: 'schoolYear, quarter and subjects are required' });

  try {
    for (const s of subjects) {
      const subj = String(s.subject || s.name || '').trim();
      const gradeVal = s.grade_value !== undefined ? Number(s.grade_value) : (s.gradeValue !== undefined ? Number(s.gradeValue) : null);
      if (!subj) return;
      const existing = await db.prepare('SELECT * FROM quarterly_grades WHERE student_id = ? AND school_year = ? AND subject = ? AND quarter = ?').get(studentId, schoolYear, subj, quarter);
      if (existing) {
        await db.prepare(`
          UPDATE quarterly_grades
          SET grade_value = ?, file_data = ?, status = 'pending', reviewed_by = '', reviewed_at = NULL, rejection_reason = ''
          WHERE id = ?
        `).run(gradeVal, fileData || existing.file_data || '', existing.id);
      } else {
        await db.prepare(`
          INSERT INTO quarterly_grades (student_id, school_year, subject, quarter, grade_value, file_data, status)
          VALUES (?, ?, ?, ?, ?, ?, 'pending')
        `).run(studentId, schoolYear, subj, quarter, gradeVal, fileData || '');
      }
    }
    logger.info('Student submitted quarter', { studentId, schoolYear, quarter, subjectsCount: subjects.length });
    return res.json({ ok: true, status: 'pending' });
  } catch (error) {
    logger.error('Submit quarter failed', error?.message || error);
    return res.status(500).json({ error: 'Unable to save grades' });
  }
});

// Student: get my grades for a school year
router.get('/mine', async (req, res) => {
  const user = req.user || {};
  if (user.type !== 'applicant') return res.status(403).json({ error: 'Only applicants may view their grades here' });
  const studentId = user.appId || user.app_id || user.appID;
  const schoolYear = String(req.query.school_year || req.query.schoolYear || '').trim();
  if (!studentId || !schoolYear) return res.status(400).json({ error: 'Missing student or school year' });
  const rows = await db.prepare('SELECT * FROM quarterly_grades WHERE student_id = ? AND school_year = ? ORDER BY subject, quarter').all(studentId, schoolYear);
  logger.info('Fetched student grades', { studentId, schoolYear, rows: rows.length });
  res.json(rows || []);
});

// Read approved grade-card for a student (grouped by subject)
router.get('/student/:studentId/grade-card', async (req, res) => {
  const studentId = Number(req.params.studentId || 0);
  const schoolYear = String(req.query.school_year || req.query.schoolYear || '').trim();
  if (!studentId || !schoolYear) return res.status(400).json({ error: 'studentId and school_year are required' });
  const rows = await db.prepare('SELECT subject, quarter, grade_value FROM quarterly_grades WHERE student_id = ? AND school_year = ? AND status = ?').all(studentId, schoolYear, 'approved');
  const grouped = {};
  rows.forEach(r => {
    const subj = r.subject || 'Unknown';
    if (!grouped[subj]) grouped[subj] = { subject: subj, quarters: {}, average: null };
    grouped[subj].quarters[r.quarter] = r.grade_value;
  });
  Object.values(grouped).forEach(g => {
    const vals = Object.values(g.quarters).filter(v => v !== null && v !== undefined);
    g.average = vals.length ? Math.round(vals.reduce((a, b) => a + (Number(b) || 0), 0) / vals.length) : null;
  });
  logger.info('Grade-card requested', { studentId, schoolYear, subjects: Object.keys(grouped).length });
  res.json(Object.values(grouped));
});

// Admin: list pending submissions
router.get('/pending', requireRole('director','edu'), async (req, res) => {
  const rows = await db.prepare('SELECT * FROM quarterly_grades WHERE status = ? ORDER BY submitted_at DESC').all('pending');
  logger.info('Admin requested pending quarterly grades', { count: rows.length, user: req.user?.username || req.user?.id });
  res.json(rows.map(r => ({ ...r })));
});

// Admin: approve a quarterly grade row
router.patch('/:id/approve', requireRole('director','edu'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const reviewer = req.user?.id || req.user?.username || 'staff';
  await db.prepare('UPDATE quarterly_grades SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?').run('approved', reviewer, new Date().toISOString(), id);
  logger.info('Quarter approved', { id, reviewer });
  res.json({ ok: true });
});

// Admin: reject
router.patch('/:id/reject', requireRole('director','edu'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const reviewer = req.user?.id || req.user?.username || 'staff';
  const reason = String(req.body.reason || req.body.rejection_reason || '').trim();
  await db.prepare('UPDATE quarterly_grades SET status = ?, reviewed_by = ?, reviewed_at = ?, rejection_reason = ? WHERE id = ?').run('rejected', reviewer, new Date().toISOString(), reason, id);
  logger.info('Quarter rejected', { id, reviewer, reason });
  res.json({ ok: true });
});

// Admin: edit a grade (manual correction)
router.patch('/:id', requireRole('director','edu'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const editor = req.user?.id || req.user?.username || 'staff';
  const gradeVal = req.body.grade_value !== undefined ? Number(req.body.grade_value) : null;
  if (gradeVal === null) return res.status(400).json({ error: 'grade_value is required' });
  await db.prepare('UPDATE quarterly_grades SET grade_value = ?, last_edited_by = ?, last_edited_at = ? WHERE id = ?').run(gradeVal, editor, new Date().toISOString(), id);
  logger.info('Quarter manually edited', { id, editor, grade_value: gradeVal });
  res.json({ ok: true });
});

module.exports = router;
