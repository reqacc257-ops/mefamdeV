const test = require('node:test');
const assert = require('node:assert/strict');
const documentsRouter = require('../routes/documents');
const db = require('../db');
const { submitPublicApplication } = require('../routes/applications');

test('document uploads persist file metadata for the applicant checklist', () => {
  const appId = 999;
  db.prepare('DELETE FROM document_status WHERE app_id = ?').run(appId);

  const checklist = documentsRouter.__test.saveDocumentUpload(appId, 'reportCard', {
    status: 'Pending',
    note: 'Uploaded from phone',
    fileName: 'report-card.jpg',
    fileType: 'image/jpeg',
    fileData: 'data:image/jpeg;base64,abc123',
    uploadMethod: 'camera'
  });

  const reportCard = checklist.find(item => item.key === 'reportCard');
  assert.ok(reportCard);
  assert.equal(reportCard.status, 'Pending');
  assert.equal(reportCard.fileName, 'report-card.jpg');
  assert.equal(reportCard.fileType, 'image/jpeg');
  assert.equal(reportCard.fileData, 'data:image/jpeg;base64,abc123');
  assert.equal(reportCard.uploadMethod, 'camera');
});

test('applicant document uploads default to Pending status for review', () => {
  const appId = 1000;
  db.prepare('DELETE FROM document_status WHERE app_id = ?').run(appId);

  const checklist = documentsRouter.__test.saveDocumentUpload(appId, 'reportCard', {
    fileName: 'report-card.jpg',
    fileType: 'image/jpeg',
    fileData: 'data:image/jpeg;base64,abc123',
    uploadMethod: 'upload'
  });

  const reportCard = checklist.find(item => item.key === 'reportCard');
  assert.ok(reportCard);
  assert.equal(reportCard.status, 'Pending');
});

test('applicant uploads are blocked after a document is marked Received until staff reopens it', async () => {
  const appId = 1001;
  const app = { id: appId, status: 'Pending Review' };
  db.prepare('INSERT OR IGNORE INTO applications (id, name, status, sy, school_year, reference_number, contact, username, password) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(appId, 'Locked Applicant', 'Pending Review', '2026-2027', '2026-2027', `REF-${appId}`, '09170000004', `lock${appId}`, 'secret123');
  db.prepare('DELETE FROM document_status WHERE app_id = ? AND doc_key = ?').run(appId, 'reportCard');
  db.prepare('INSERT INTO document_status (app_id, doc_key, status, note, updated_at, file_name, file_type, file_data, upload_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(appId, 'reportCard', 'Received', 'Approved', new Date().toISOString(), 'report-card.jpg', 'image/jpeg', 'data:image/jpeg;base64,abc123', 'upload');

  const canUpload = await documentsRouter.__test.applicantCanUploadDocument(appId, { type: 'applicant', appId }, 'reportCard');
  assert.equal(canUpload, false);
});

test('public application submission preserves the application date from the paper-style form', () => {
  const req = {
    body: {
      name: 'Date Applicant',
      sy: '2026-2027',
      username: 'dateapplicant',
      password: 'secret123',
      contact: '09170000003',
      applicationDate: '2026-07-12'
    }
  };
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };

  submitPublicApplication(req, res);

  const createdAppId = res.body.id;
  const savedApp = db.prepare('SELECT date_label FROM applications WHERE id = ?').get(createdAppId);
  assert.equal(savedApp.date_label, '2026-07-12');
});

test('public application submission seeds the required document checklist', () => {
  const req = {
    body: {
      name: 'Test Applicant',
      sy: '2026-2027',
      username: 'testapplicant',
      password: 'secret123',
      contact: '09170000000'
    }
  };
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };

  submitPublicApplication(req, res);

  const createdAppId = res.body.id;
  const rows = db.prepare('SELECT doc_key, status FROM document_status WHERE app_id = ?').all(createdAppId);
  assert.equal(res.statusCode, 200);
  assert.ok(rows.length >= 9);
  assert.deepEqual(rows.map(row => ({ doc_key: row.doc_key, status: row.status })).sort((a, b) => a.doc_key.localeCompare(b.doc_key)), [
    { doc_key: 'baptismal', status: 'Required' },
    { doc_key: 'barangayCert', status: 'Required' },
    { doc_key: 'birthCertificate', status: 'Required' },
    { doc_key: 'certEnrollment', status: 'Required' },
    { doc_key: 'confirmationLetter', status: 'Required' },
    { doc_key: 'guardianId', status: 'Required' },
    { doc_key: 'idPhoto', status: 'Required' },
    { doc_key: 'letterOfIntent', status: 'Required' },
    { doc_key: 'reportCard', status: 'Required' }
  ]);
});

test('public application submission preserves the full paper-form metadata', () => {
  const req = {
    body: {
      name: 'Metadata Applicant',
      sy: '2026-2027',
      username: 'metadataapplicant',
      password: 'secret123',
      contact: '09170000001',
      submittedData: { fullName: 'Metadata Applicant', barangay: 'Narra' },
      statusHistory: [{ status: 'Pending Review', changedAt: '2026-07-12T00:00:00.000Z', note: 'Application submitted' }],
      submittedAt: '2026-07-12T00:00:00.000Z',
      status: 'Pending Review'
    }
  };
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };

  submitPublicApplication(req, res);

  const createdAppId = res.body.id;
  const savedApp = db.prepare('SELECT * FROM applications WHERE id = ?').get(createdAppId);
  assert.equal(savedApp.submitted_at, '2026-07-12T00:00:00.000Z');
  assert.equal(savedApp.status_updated_at, '2026-07-12T00:00:00.000Z');
  assert.equal(savedApp.status, 'Pending Review');
  assert.deepEqual(savedApp.submitted_data, { fullName: 'Metadata Applicant', barangay: 'Narra' });
  assert.deepEqual(savedApp.status_history, [{ status: 'Pending Review', changedAt: '2026-07-12T00:00:00.000Z', note: 'Application submitted' }]);
});
