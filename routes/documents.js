/**
 * routes/documents.js — Per-applicant document checklist
 *
 * GET  /api/documents/:appId            — get checklist (staff, or the applicant themself)
 * PUT  /api/documents/:appId/:docKey    — set a document's status + optional note (staff only)
 *
 * Mount in server.js alongside the other routes, e.g.:
 *   app.use('/api/documents', requireAuth, require('./routes/documents'));
 */
const router = require('express').Router();
const db = require('../db');

// Self-contained: creates its own table if it doesn't exist yet.
db.exec(`
  CREATE TABLE IF NOT EXISTS document_status (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id INTEGER NOT NULL,
    doc_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Required',
    note TEXT DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now')),
    file_name TEXT DEFAULT '',
    file_type TEXT DEFAULT '',
    file_data TEXT DEFAULT '',
    upload_method TEXT DEFAULT '',
    UNIQUE(app_id, doc_key)
  )
`);

// The fixed list of documents every applicant needs. Add/remove entries here
// and both the admin dashboard and applicant portal will pick it up automatically.
const REQUIRED_DOCS = [
  { key: 'reportCard',     label: 'Report Card / Grade Slip' },
  { key: 'certEnrollment', label: 'Certificate of Enrollment' },
  { key: 'idPhoto',        label: '1 pc. 2x2 ID Photo' },
  { key: 'barangayCert',   label: 'Barangay Certificate of Indigency' },
  { key: 'guardianId',     label: 'Parent/Guardian Valid ID' },
];

function buildChecklist(appId) {
  const rows = db.prepare(
    'SELECT doc_key, status, note, updated_at, file_name, file_type, file_data, upload_method FROM document_status WHERE app_id = ?'
  ).all(appId);
  const map = {};
  rows.forEach(r => { map[r.doc_key] = r; });

  return REQUIRED_DOCS.map(d => ({
    key: d.key,
    label: d.label,
    status: map[d.key]?.status || 'Required',   // Required | Received | Missing
    note: map[d.key]?.note || '',
    updatedAt: map[d.key]?.updated_at || null,
    fileName: map[d.key]?.file_name || '',
    fileType: map[d.key]?.file_type || '',
    fileData: map[d.key]?.file_data || '',
    uploadMethod: map[d.key]?.upload_method || '',
  }));
}

function seedChecklistForApplication(appId) {
  const existing = db.prepare('SELECT doc_key FROM document_status WHERE app_id = ?').all(appId);
  const existingKeys = new Set(existing.map(row => row.doc_key));
  const insertStmt = db.prepare(`
    INSERT INTO document_status (app_id, doc_key, status, note, updated_at, file_name, file_type, file_data, upload_method)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  REQUIRED_DOCS.forEach(doc => {
    if (!existingKeys.has(doc.key)) {
      insertStmt.run(appId, doc.key, 'Required', '', new Date().toISOString(), '', '', '', '');
    }
  });

  return buildChecklist(appId);
}

function saveDocumentUpload(appId, docKey, payload) {
  if (!REQUIRED_DOCS.some(d => d.key === docKey)) {
    throw new Error('Unknown document type');
  }

  const maxBytes = 10 * 1024 * 1024; // 10 MB
  const fileData = payload.fileData || '';
  const base64Part = String(fileData).includes(',') ? String(fileData).split(',')[1] : String(fileData);
  const decodedSize = Math.floor(base64Part.length * 3 / 4) - (base64Part.endsWith('==') ? 2 : base64Part.endsWith('=') ? 1 : 0);
  if (base64Part && decodedSize > maxBytes) {
    throw new Error('File exceeds the 10MB limit');
  }
  if (payload.fileType && !String(payload.fileType).startsWith('image/')) {
    throw new Error('Only image uploads are accepted');
  }

  const existing = db.prepare('SELECT * FROM document_status WHERE app_id = ? AND doc_key = ?').get([appId, docKey]);
  const status = payload.status || (payload.fileData ? 'Received' : 'Required');
  const note = payload.note || (existing?.note || '');
  const fileName = payload.fileName || existing?.file_name || '';
  const fileType = payload.fileType || existing?.file_type || '';
  const uploadMethod = payload.uploadMethod || existing?.upload_method || '';

  if (existing) {
    db.prepare(`
      UPDATE document_status
      SET status = ?, note = ?, updated_at = ?, file_name = ?, file_type = ?, file_data = ?, upload_method = ?
      WHERE app_id = ? AND doc_key = ?
    `).run(status, note, new Date().toISOString(), fileName, fileType, fileData, uploadMethod, appId, docKey);
  } else {
    db.prepare(`
      INSERT INTO document_status (app_id, doc_key, status, note, updated_at, file_name, file_type, file_data, upload_method)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(appId, docKey, status, note, new Date().toISOString(), fileName, fileType, fileData, uploadMethod);
  }

  return buildChecklist(appId);
}

// ── GET checklist ─────────────────────────────────────────────────────────
router.get('/:appId', (req, res) => {
  const appId = parseInt(req.params.appId);
  if (req.user.type === 'applicant' && req.user.appId !== appId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(buildChecklist(appId));
});

// ── PUT update one document ───────────────────────────────────────────────
router.put('/:appId/:docKey', (req, res) => {
  if (req.user.type === 'applicant') return res.status(403).json({ error: 'Forbidden' });

  const { appId, docKey } = req.params;
  if (!REQUIRED_DOCS.some(d => d.key === docKey)) {
    return res.status(400).json({ error: 'Unknown document type' });
  }

  const status = req.body.status;
  if (!['Required', 'Received', 'Missing'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const note = req.body.note || '';

  const existing = db.prepare('SELECT * FROM document_status WHERE app_id = ? AND doc_key = ?').get([appId, docKey]);
  const fileName = existing?.file_name || '';
  const fileType = existing?.file_type || '';
  const fileData = existing?.file_data || '';
  const uploadMethod = existing?.upload_method || '';

  if (existing) {
    db.prepare(`
      UPDATE document_status
      SET status = ?, note = ?, updated_at = ?, file_name = ?, file_type = ?, file_data = ?, upload_method = ?
      WHERE app_id = ? AND doc_key = ?
    `).run(status, note, new Date().toISOString(), fileName, fileType, fileData, uploadMethod, appId, docKey);
  } else {
    db.prepare(`
      INSERT INTO document_status (app_id, doc_key, status, note, updated_at, file_name, file_type, file_data, upload_method)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(appId, docKey, status, note, new Date().toISOString(), fileName, fileType, fileData, uploadMethod);
  }

  res.json({ ok: true, checklist: buildChecklist(appId) });
});

router.post('/:appId/:docKey/upload', (req, res) => {
  const { appId, docKey } = req.params;
  if (req.user.type === 'applicant' && req.user.appId !== parseInt(appId)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (!REQUIRED_DOCS.some(d => d.key === docKey)) {
    return res.status(400).json({ error: 'Unknown document type' });
  }

  const payload = req.body || {};
  if (!payload.fileData || !payload.fileName) {
    return res.status(400).json({ error: 'Image data and file name are required' });
  }

  try {
    const checklist = saveDocumentUpload(appId, docKey, payload);
    res.json({ ok: true, checklist });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to save document upload' });
  }
});

router.seedChecklistForApplication = seedChecklistForApplication;
router.__test = { saveDocumentUpload, seedChecklistForApplication };
module.exports = router;
