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

async function buildChecklistAsync(appId) {
  const rows = await db.prepare('SELECT doc_key, status, note, updated_at, file_name, file_type, file_data, upload_method FROM document_status WHERE app_id = ?').all(appId);
  const map = Object.fromEntries(rows.map(row => [row.doc_key, row]));
  return REQUIRED_DOCS.map(d => ({ key: d.key, label: d.label, status: map[d.key]?.status || 'Required', note: map[d.key]?.note || '', updatedAt: map[d.key]?.updated_at || null, fileName: map[d.key]?.file_name || '', fileType: map[d.key]?.file_type || '', fileData: map[d.key]?.file_data || '', uploadMethod: map[d.key]?.upload_method || '' }));
}

async function seedChecklistForApplicationAsync(appId) {
  const existing = await db.prepare('SELECT doc_key FROM document_status WHERE app_id = ?').all(appId);
  const keys = new Set(existing.map(row => row.doc_key));
  for (const doc of REQUIRED_DOCS) {
    if (!keys.has(doc.key)) await db.prepare('INSERT INTO document_status (app_id, doc_key, status, note, updated_at, file_name, file_type, file_data, upload_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(appId, doc.key, 'Required', '', new Date().toISOString(), '', '', '', '');
  }
  return buildChecklistAsync(appId);
}

async function saveDocumentUploadAsync(appId, docKey, payload) {
  const existing = await db.prepare('SELECT * FROM document_status WHERE app_id = ? AND doc_key = ?').get(appId, docKey);
  const status = payload.status || (payload.fileData ? 'Pending' : 'Required');
  const values = [status, payload.note || existing?.note || '', new Date().toISOString(), payload.fileName || existing?.file_name || '', payload.fileType || existing?.file_type || '', payload.fileData || '', payload.uploadMethod || existing?.upload_method || '', appId, docKey];
  if (existing) await db.prepare('UPDATE document_status SET status = ?, note = ?, updated_at = ?, file_name = ?, file_type = ?, file_data = ?, upload_method = ? WHERE app_id = ? AND doc_key = ?').run(...values);
  else await db.prepare('INSERT INTO document_status (app_id, doc_key, status, note, updated_at, file_name, file_type, file_data, upload_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(appId, docKey, ...values.slice(0, 7));
  return buildChecklistAsync(appId);
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
  // If an applicant uploads a document, leave it in review state rather than marking it as received automatically.
  const status = payload.status || (payload.fileData ? 'Pending' : 'Required');
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
router.get('/:appId', async (req, res) => {
  const appId = parseInt(req.params.appId);
  if (!appId) return res.status(400).json({ error: 'Invalid application ID' });
  if (req.user.type === 'applicant' && String(req.user.appId) !== String(appId)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(await buildChecklistAsync(appId));
});

// ── PUT update one document ───────────────────────────────────────────────
router.put('/:appId/:docKey', async (req, res) => {
  if (req.user.type === 'applicant') return res.status(403).json({ error: 'Forbidden' });

  const { appId, docKey } = req.params;
  if (!REQUIRED_DOCS.some(d => d.key === docKey)) {
    return res.status(400).json({ error: 'Unknown document type' });
  }

  const status = req.body.status;
  if (!['Required', 'Pending', 'Received', 'Missing'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const note = req.body.note || '';

  const existing = await db.prepare('SELECT * FROM document_status WHERE app_id = ? AND doc_key = ?').get([appId, docKey]);
  const fileName = existing?.file_name || '';
  const fileType = existing?.file_type || '';
  const fileData = existing?.file_data || '';
  const uploadMethod = existing?.upload_method || '';

  if (existing) {
    await db.prepare(`
      UPDATE document_status
      SET status = ?, note = ?, updated_at = ?, file_name = ?, file_type = ?, file_data = ?, upload_method = ?
      WHERE app_id = ? AND doc_key = ?
    `).run(status, note, new Date().toISOString(), fileName, fileType, fileData, uploadMethod, appId, docKey);
  } else {
    await db.prepare(`
      INSERT INTO document_status (app_id, doc_key, status, note, updated_at, file_name, file_type, file_data, upload_method)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(appId, docKey, status, note, new Date().toISOString(), fileName, fileType, fileData, uploadMethod);
  }

  res.json({ ok: true, checklist: await buildChecklistAsync(appId) });
});

router.post('/:appId/:docKey/upload', async (req, res) => {
  const { appId, docKey } = req.params;
  if (!parseInt(appId)) return res.status(400).json({ error: 'Invalid application ID' });
  if (req.user.type === 'applicant' && String(req.user.appId) !== String(parseInt(appId))) {
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
    const checklist = db.isPostgres ? await saveDocumentUploadAsync(appId, docKey, payload) : saveDocumentUpload(appId, docKey, payload);
    res.json({ ok: true, checklist });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to save document upload' });
  }
});

router.seedChecklistForApplication = db.isPostgres ? seedChecklistForApplicationAsync : seedChecklistForApplication;
router.__test = { saveDocumentUpload, seedChecklistForApplication };
module.exports = router;
