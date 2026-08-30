const router = require('express').Router();
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const { extractReportCard, computeFlags, normalizeExtractionResult } = require('../lib/gradeExtraction');

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

async function syncApplicationStatusFromReview(appId, action, note) {
  const appIdNum = Number(appId);
  if (!appIdNum) return;

  const app = await db.prepare('SELECT id, status, status_history FROM applications WHERE id = ?').get(appIdNum);
  if (!app) return;

  const now = new Date().toISOString();
  const history = typeof app.status_history === 'string'
    ? (() => { try { return JSON.parse(app.status_history || '[]'); } catch { return []; } })()
    : (app.status_history || []);

  const nextStatus = action === 'approve' ? 'Accepted' : 'Rejected';
  const entry = { status: nextStatus, changedAt: now, note: note || `Grade review marked as ${nextStatus.toLowerCase()}.` };
  if (!history.some(item => item && item.status === nextStatus)) {
    history.push(entry);
  }

  await db.prepare('UPDATE applications SET status = ?, status_updated_at = ?, status_history = ? WHERE id = ?')
    .run(nextStatus, now, JSON.stringify(history), appIdNum);
}

router.post('/:appId/upload', async (req, res) => {
  const appId = parseInt(req.params.appId, 10);
  if (!appId) return res.status(400).json({ error: 'Invalid application ID' });
  if (req.user.type === 'applicant' && String(req.user.appId) !== String(appId)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { fileData, fileName, fileType } = req.body || {};
  if (!fileData || !fileName) {
    return res.status(400).json({ error: 'Image and file name are required' });
  }

  try {
    const extracted = normalizeExtractionResult(await extractReportCard({ fileData, fileType }));
    const flags = computeFlags(extracted);
    const info = await db.prepare(`
      INSERT INTO grade_extraction (app_id, status, file_name, file_type, file_data, extracted, flags, uploaded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(appId, 'pending', fileName, fileType || '', fileData, JSON.stringify(extracted), JSON.stringify(flags), new Date().toISOString());
    const saved = await db.prepare('SELECT * FROM grade_extraction WHERE id = ?').get(info.lastInsertRowid);
    return res.json({ ok: true, extraction: normalizeExtraction(saved) });
  } catch (error) {
    const extracted = { schoolYear: null, gradeLevel: null, subjects: [], generalAverage: null, confidence: null, uncertainFields: [] };
    const flags = [error.code === 'GEMINI_RATE_LIMITED'
      ? 'Gemini is temporarily rate-limited. Please enter the grades manually from the uploaded image.'
      : 'Automatic grade reading failed. Please enter the grades manually from the uploaded image.'];
    const reviewNote = error.code === 'GEMINI_RATE_LIMITED'
      ? 'Gemini rate limit reached; staff review required.'
      : `Automatic extraction failed; staff review required. ${error.message || ''}`.trim();
    const info = await db.prepare(`
      INSERT INTO grade_extraction (app_id, status, file_name, file_type, file_data, extracted, flags, uploaded_at, review_notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(appId, 'pending', fileName, fileType || '', fileData, JSON.stringify(extracted), JSON.stringify(flags), new Date().toISOString(), reviewNote);
    const saved = await db.prepare('SELECT * FROM grade_extraction WHERE id = ?').get(info.lastInsertRowid);
    return res.json({ ok: true, warning: 'Extraction failed; saved for manual review.', extraction: normalizeExtraction(saved) });
  }
});

router.get('/pending', requireRole('director', 'edu'), async (req, res) => {
  const rows = await db.prepare('SELECT * FROM grade_extraction WHERE status = ? ORDER BY uploaded_at DESC').all('pending');
  res.json(rows.map(normalizeExtraction));
});

router.get('/:appId', async (req, res) => {
  const appId = parseInt(req.params.appId, 10);
  if (!appId) return res.status(400).json({ error: 'Invalid application ID' });
  if (req.user.type === 'applicant' && String(req.user.appId) !== String(appId)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const rows = await db.prepare('SELECT * FROM grade_extraction WHERE app_id = ? ORDER BY uploaded_at DESC').all(appId);
  res.json(rows.map(normalizeExtraction));
});

router.put('/:id/review', requireRole('director', 'edu'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const action = String(req.body.action || '').toLowerCase();
  if (!id) return res.status(400).json({ error: 'Invalid review ID' });
  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action' });
  }

  const row = await db.prepare('SELECT * FROM grade_extraction WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Extraction record not found' });

  const extracted = row.extracted ? JSON.parse(row.extracted) : null;
  const subjects = Array.isArray(req.body.subjects) ? req.body.subjects : [];
  const reviewNotes = String(req.body.reviewNotes || '');
  const schoolYear = String(req.body.schoolYear || extracted?.schoolYear || '').trim();
  const reviewerId = req.user.id || req.user.username || 'staff';

  let rejectedCells = [];
  if (action === 'approve') {
    if (!subjects.length) {
      return res.status(400).json({ error: 'Reviewed subjects are required for approval' });
    }

    if (!schoolYear) {
      return res.status(400).json({ error: 'School year is required to save grades' });
    }

    for (const subject of subjects) {
      const name = String(subject.name || '').trim();
      if (!name) continue;
      for (const quarterKey of ['q1', 'q2', 'q3', 'q4']) {
        const raw = subject[quarterKey];
        if (raw === null || raw === undefined || raw === '') continue;
        const value = Number(raw);
        if (!Number.isFinite(value) || value < 60 || value > 100) {
          rejectedCells.push(`${name} ${quarterKey.toUpperCase()}`);
        }
      }
    }
    if (rejectedCells.length) {
      return res.status(400).json({
        error: 'Some grades are outside the allowed 60-100 range.',
        rejectedCells,
      });
    }

    for (const subject of subjects) {
      const name = String(subject.name || '').trim();
      if (!name) continue;
      for (const [index, quarterKey] of ['q1', 'q2', 'q3', 'q4'].entries()) {
        const raw = subject[quarterKey];
        if (raw === null || raw === undefined || raw === '') continue;
        const value = Number(raw);
        const quarter = String(index + 1);
        const existing = await db.prepare('SELECT * FROM grades WHERE app_id = ? AND school_year = ? AND subject = ? AND quarter = ?').get(row.app_id, schoolYear, name, quarter);
        if (existing) {
          await db.prepare('UPDATE grades SET grade_val = ?, updated_at = ? WHERE id = ?').run(value, new Date().toISOString(), existing.id);
        } else {
          await db.prepare('INSERT INTO grades (app_id, school_year, subject, quarter, grade_val, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
            .run(row.app_id, schoolYear, name, quarter, value, new Date().toISOString());
        }
      }
    }
  }

  const status = action === 'approve' ? 'approved' : 'rejected';
  const reviewedAt = new Date().toISOString();
  if (action === 'reject') {
    const applicantNote = reviewNotes || 'Your report card upload was rejected. Please upload a clearer photo for review.';
    await db.prepare('UPDATE grade_extraction SET status = ?, file_data = ?, review_notes = ?, reviewer_id = ?, reviewed_at = ? WHERE id = ?')
      .run(status, '', applicantNote, reviewerId, reviewedAt, id);
    await db.prepare(`
      UPDATE document_status
      SET status = ?, note = ?, updated_at = ?, file_name = ?, file_type = ?, file_data = ?, upload_method = ?
      WHERE app_id = ? AND doc_key = ?
    `).run('Missing', applicantNote, reviewedAt, '', '', '', '', row.app_id, 'reportCard');
  } else {
    await db.prepare('UPDATE grade_extraction SET status = ?, review_notes = ?, reviewer_id = ?, reviewed_at = ? WHERE id = ?')
      .run(status, reviewNotes, reviewerId, reviewedAt, id);
  }

  await syncApplicationStatusFromReview(row.app_id, action, reviewNotes || (action === 'approve' ? 'Grade review approved.' : 'Grade review rejected.'));

  const updated = await db.prepare('SELECT * FROM grade_extraction WHERE id = ?').get(id);
  res.json({ ok: true, extraction: normalizeExtraction(updated), rejectedCells });
});

module.exports = router;
