const router = require('express').Router();
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const { extractReportCard, computeFlags } = require('../lib/gradeExtraction');

// SQL create is a no-op for the in-memory JSON store, but keeps the route self-contained.
db.exec(`
  CREATE TABLE IF NOT EXISTS grade_extraction (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    file_name TEXT DEFAULT '',
    file_type TEXT DEFAULT '',
    file_data TEXT DEFAULT '',
    extracted TEXT DEFAULT '',
    flags TEXT DEFAULT '',
    review_notes TEXT DEFAULT '',
    reviewer_id TEXT DEFAULT '',
    uploaded_at TEXT DEFAULT (datetime('now')),
    reviewed_at TEXT DEFAULT ''
  )
`);

function normalizeExtraction(row) {
  return {
    id: row.id,
    appId: row.app_id,
    status: row.status,
    fileName: row.file_name,
    fileType: row.file_type,
    fileData: row.file_data,
    extracted: row.extracted ? JSON.parse(row.extracted) : null,
    flags: row.flags ? JSON.parse(row.flags) : [],
    reviewNotes: row.review_notes || '',
    reviewerId: row.reviewer_id || '',
    uploadedAt: row.uploaded_at,
    reviewedAt: row.reviewed_at,
  };
}

router.post('/:appId/upload', async (req, res) => {
  const appId = parseInt(req.params.appId, 10);
  if (!appId) return res.status(400).json({ error: 'Invalid application ID' });
  if (req.user.type === 'applicant' && req.user.appId !== appId) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { fileData, fileName, fileType } = req.body || {};
  if (!fileData || !fileName) {
    return res.status(400).json({ error: 'Image and file name are required' });
  }

  try {
    const extracted = await extractReportCard({ fileData, fileType });
    const flags = computeFlags(extracted);
    const info = db.prepare(`
      INSERT INTO grade_extraction (app_id, status, file_name, file_type, file_data, extracted, flags, uploaded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(appId, 'pending', fileName, fileType || '', fileData, JSON.stringify(extracted), JSON.stringify(flags), new Date().toISOString());
    const saved = db.prepare('SELECT * FROM grade_extraction WHERE id = ?').get(info.lastInsertRowid);
    return res.json({ ok: true, extraction: normalizeExtraction(saved) });
  } catch (error) {
    const extracted = { schoolYear: null, gradeLevel: null, subjects: [], generalAverage: null, confidence: null, uncertainFields: [] };
    const flags = [error.message || 'Extraction failed'];
    const info = db.prepare(`
      INSERT INTO grade_extraction (app_id, status, file_name, file_type, file_data, extracted, flags, uploaded_at, review_notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(appId, 'pending', fileName, fileType || '', fileData, JSON.stringify(extracted), JSON.stringify(flags), new Date().toISOString(), 'Extraction failed, staff review required');
    const saved = db.prepare('SELECT * FROM grade_extraction WHERE id = ?').get(info.lastInsertRowid);
    return res.json({ ok: true, warning: 'Extraction failed; saved for manual review.', extraction: normalizeExtraction(saved) });
  }
});

router.get('/pending', requireRole('director', 'edu'), (req, res) => {
  const rows = db.prepare('SELECT * FROM grade_extraction WHERE status = ? ORDER BY uploaded_at DESC').all('pending');
  res.json(rows.map(normalizeExtraction));
});

router.get('/:appId', (req, res) => {
  const appId = parseInt(req.params.appId, 10);
  if (!appId) return res.status(400).json({ error: 'Invalid application ID' });
  if (req.user.type === 'applicant' && req.user.appId !== appId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const rows = db.prepare('SELECT * FROM grade_extraction WHERE app_id = ? ORDER BY uploaded_at DESC').all(appId);
  res.json(rows.map(normalizeExtraction));
});

router.put('/:id/review', requireRole('director', 'edu'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const action = String(req.body.action || '').toLowerCase();
  if (!id) return res.status(400).json({ error: 'Invalid review ID' });
  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action' });
  }

  const row = db.prepare('SELECT * FROM grade_extraction WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Extraction record not found' });

  const extracted = row.extracted ? JSON.parse(row.extracted) : null;
  const subjects = Array.isArray(req.body.subjects) ? req.body.subjects : [];
  const reviewNotes = String(req.body.reviewNotes || '');
  const reviewerId = req.user.id || req.user.username || 'staff';

  let rejectedCells = [];
  if (action === 'approve') {
    if (!subjects.length) {
      return res.status(400).json({ error: 'Reviewed subjects are required for approval' });
    }

    const schoolYear = extracted?.schoolYear || String(req.body.schoolYear || '').trim();
    if (!schoolYear) {
      return res.status(400).json({ error: 'School year is required to save grades' });
    }

    subjects.forEach(subject => {
      const name = String(subject.name || '').trim();
      if (!name) return;
      ['q1', 'q2', 'q3', 'q4'].forEach((quarterKey, index) => {
        const raw = subject[quarterKey];
        if (raw === null || raw === undefined || raw === '') return;
        const value = Number(raw);
        if (!Number.isFinite(value) || value < 60 || value > 100) {
          rejectedCells.push(`${name} ${quarterKey.toUpperCase()}`);
          return;
        }
        const quarter = String(index + 1);
        const existing = db.prepare('SELECT * FROM grades WHERE app_id = ? AND school_year = ? AND subject = ? AND quarter = ?').get(row.app_id, schoolYear, name, quarter);
        if (existing) {
          db.prepare('UPDATE grades SET grade_val = ?, updated_at = ? WHERE id = ?').run(value, new Date().toISOString(), existing.id);
        } else {
          db.prepare('INSERT INTO grades (app_id, school_year, subject, quarter, grade_val, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
            .run(row.app_id, schoolYear, name, quarter, value, new Date().toISOString());
        }
      });
    });
  }

  const status = action === 'approve' ? 'approved' : 'rejected';
  db.prepare('UPDATE grade_extraction SET status = ?, review_notes = ?, reviewer_id = ?, reviewed_at = ? WHERE id = ?')
    .run(status, reviewNotes, reviewerId, new Date().toISOString(), id);

  const updated = db.prepare('SELECT * FROM grade_extraction WHERE id = ?').get(id);
  res.json({ ok: true, extraction: normalizeExtraction(updated), rejectedCells });
});

module.exports = router;
