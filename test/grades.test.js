const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { run: runMigrations } = require('../scripts/run_migrations');
const app = require('../server');

const JWT_SECRET = process.env.JWT_SECRET || 'local-development-only-jwt-secret';

test('grades workflow: submit -> pending -> approve -> visible in grade-card', async (t) => {
  // apply migrations
  await runMigrations();

  // start server on random port
  const srv = app.listen(0);
  const port = srv.address().port;
  const base = `http://127.0.0.1:${port}/api`;

  try {
    const existingApp = await db.prepare('SELECT * FROM applications WHERE id = ?').get(9999);
    if (!existingApp) {
      await db.prepare('INSERT INTO applications (id, name, email, status, reference_number, submitted_at, status_updated_at, status_history) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(9999, 'Test Student', 'student@example.com', 'Pending Review', '9999', new Date().toISOString(), new Date().toISOString(), JSON.stringify([{ status: 'Pending Review', changedAt: new Date().toISOString(), note: 'Application submitted' }]));
    }

    // create applicant token
    const applicantPayload = { type: 'applicant', appId: 9999 };
    const applicantToken = jwt.sign(applicantPayload, JWT_SECRET);

    // submit a quarter
    const submitRes = await fetch(`${base}/grades`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + applicantToken },
      body: JSON.stringify({ schoolYear: '2025-2026', quarter: 1, subjects: [{ subject: 'Mathematics', grade_value: 88 }] })
    });
    const submitJson = await submitRes.json();
    assert.equal(submitJson.ok, true, 'submit should succeed');

    // applicant can fetch their rows
    const mineRes = await fetch(`${base}/grades/mine?school_year=2025-2026`, { headers: { Authorization: 'Bearer ' + applicantToken } });
    const mineJson = await mineRes.json();
    assert.ok(Array.isArray(mineJson) && mineJson.length > 0, 'mine should return rows');
    const savedRow = mineJson[0];
    assert.equal(savedRow.subject, 'Mathematics');

    // admin lists pending rows
    const adminToken = jwt.sign({ type: 'staff', id: 'director', username: 'director', role: 'director' }, JWT_SECRET);
    const pendingRes = await fetch(`${base}/grades/pending`, { headers: { Authorization: 'Bearer ' + adminToken } });
    const pendingJson = await pendingRes.json();
    assert.ok(Array.isArray(pendingJson) && pendingJson.length > 0, 'pending should list rows');

    // approve the first pending row
    const toApprove = pendingJson.find(p => p.student_id === 9999 && p.subject === 'Mathematics');
    assert.ok(toApprove, 'approve target exists');
    const approveRes = await fetch(`${base}/grades/${toApprove.id}/approve`, { method: 'PATCH', headers: { Authorization: 'Bearer ' + adminToken } });
    const approveJson = await approveRes.json();
    assert.equal(approveJson.ok, true);

    // grade-card should include approved subject
    const cardRes = await fetch(`${base}/grades/student/9999/grade-card?school_year=2025-2026`, { headers: { Authorization: 'Bearer ' + adminToken } });
    const cardJson = await cardRes.json();
    assert.ok(Array.isArray(cardJson) && cardJson.length > 0, 'grade-card should return grouped subjects');
    const math = cardJson.find(s => s.subject === 'Mathematics');
    assert.ok(math && math.quarters[1] === 88, 'approved grade present in grade-card');

    const appRes = await fetch(`${base}/applications/9999`, { headers: { Authorization: 'Bearer ' + adminToken } });
    const app = await appRes.json();
    assert.equal(app.status, 'Accepted', 'application should be marked accepted when its grade is approved');

    // rejection path should also mirror the application status
    const rejectRes = await fetch(`${base}/grades/${toApprove.id}/reject`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + adminToken },
      body: JSON.stringify({ reason: 'Needs improvement' })
    });
    const rejectJson = await rejectRes.json();
    assert.equal(rejectJson.ok, true, 'reject should succeed');

    const rejectedAppRes = await fetch(`${base}/applications/9999`, { headers: { Authorization: 'Bearer ' + adminToken } });
    const rejectedApp = await rejectedAppRes.json();
    assert.equal(rejectedApp.status, 'Rejected', 'application should be marked rejected when its grade is rejected');

  } finally {
    srv.close();
  }
});
