const test = require('node:test');
const assert = require('assert');
const db = require('../db');
const gradeExtractionRouter = require('../routes/gradeExtraction');
const { normalizeExtractionResult, parseNumber } = require('../lib/gradeExtraction');

test('parseNumber handles numeric strings and nulls', () => {
  assert.strictEqual(parseNumber('86'), 86);
  assert.strictEqual(parseNumber(' 87 '), 87);
  assert.strictEqual(parseNumber(''), null);
  assert.strictEqual(parseNumber(null), null);
  assert.strictEqual(parseNumber('86.5'), 86.5);
});

test('normalizeExtractionResult merges MAPEH subcomponents and parses values', () => {
  const raw = {
    schoolYear: '2025-2026',
    subjects: [
      { name: 'Music', q1: '86', q2: '87' },
      { name: 'Arts', q1: '85', q2: '86' },
      { name: 'PE', q1: '86', q2: '88' },
      { name: 'Technology and Livelihood', q1: null, q2: '91' },
      { name: 'Education (TLE)', q1: '90', q2: null },
      { name: 'Filipino', q1: '80', q2: '84' },
    ],
    generalAverage: '86.2',
    confidence: '0.92',
    uncertainFields: ['Science Q3']
  };

  const norm = normalizeExtractionResult(raw);
  assert.strictEqual(norm.schoolYear, '2025-2026');
  assert.strictEqual(norm.generalAverage, 86.2);
  assert.strictEqual(Math.round(norm.confidence * 100), 92);
  assert.strictEqual(Array.isArray(norm.uncertainFields) && norm.uncertainFields.length, 1);

  const mapeh = norm.subjects.find(s => String(s.name).toLowerCase() === 'mapeh');
  assert.ok(mapeh, 'MAPEH combined row should exist');
  // q1 average of [86,85,86] = 85.666... -> rounded to one decimal -> 85.7
  assert.ok(Math.abs(mapeh.q1 - 85.7) < 0.05, `unexpected mapeh.q1: ${mapeh.q1}`);
  // q2 average of [87,86,88] = 87
  assert.ok(Math.abs(mapeh.q2 - 87) < 0.01, `unexpected mapeh.q2: ${mapeh.q2}`);

  const fil = norm.subjects.find(s => String(s.name).toLowerCase() === 'filipino');
  assert.ok(fil && fil.q1 === 80, 'Filipino q1 should be 80');
  const tleRows = norm.subjects.filter(s => /technology|tle/i.test(s.name));
  assert.strictEqual(tleRows.length, 1, 'TLE variants should merge into one row');
  assert.strictEqual(tleRows[0].q1, 90);
  assert.strictEqual(tleRows[0].q2, 91);
});

test('approved grade review marks the report card requirement as Received', async () => {
  const appId = 2001;
  db.prepare('DELETE FROM document_status WHERE app_id = ?').run(appId);
  db.prepare('DELETE FROM grade_extraction WHERE app_id = ?').run(appId);

  await db.prepare(`
    INSERT INTO grade_extraction (app_id, status, file_name, file_type, file_data, extracted, flags, uploaded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(appId, 'pending', 'report-card.jpg', 'image/jpeg', 'data:image/jpeg;base64,abc123', JSON.stringify({ schoolYear: '2025-2026', subjects: [] }), JSON.stringify([]), new Date().toISOString());

  const extraction = await db.prepare('SELECT * FROM grade_extraction WHERE app_id = ? ORDER BY id DESC LIMIT 1').get(appId);
  assert.ok(extraction, 'grade extraction row should exist');
  await gradeExtractionRouter.__test.markReportCardReceived(extraction.app_id, 'Approved by staff after grade review.');

  const row = await db.prepare('SELECT status, note FROM document_status WHERE app_id = ? AND doc_key = ?').get(appId, 'reportCard');
  assert.ok(row, 'reportCard document row should exist');
  assert.equal(row.status, 'Received');
  assert.match(String(row.note || ''), /approved/i);
});

test('rejected grade-file review does not reject the applicant', async () => {
  const appId = 2002;
  const now = new Date().toISOString();
  await db.prepare('DELETE FROM applications WHERE id = ?').run(appId);
  await db.prepare(`
    INSERT INTO applications (id, name, email, status, reference_number, submitted_at, status_updated_at, status_history)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(appId, 'Accepted Grade Upload Test', 'accepted-grade@example.com', 'Accepted', '2002', now, now, JSON.stringify([{ status: 'Accepted', changedAt: now }]));

  await gradeExtractionRouter.__test.syncApplicationStatusFromReview(appId, 'reject', 'Blurry report card image.');

  const row = await db.prepare('SELECT status FROM applications WHERE id = ?').get(appId);
  assert.equal(row.status, 'Accepted');
});
