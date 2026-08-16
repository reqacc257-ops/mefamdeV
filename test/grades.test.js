import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import { run as runMigrations } from '../scripts/run_migrations.js';
import app from '../server.js';

const JWT_SECRET = process.env.JWT_SECRET || 'mefamdev-secret-change-in-production';

test('grades workflow: submit -> pending -> approve -> visible in grade-card', async (t) => {
  // apply migrations
  await runMigrations();

  // start server on random port
  const srv = app.listen(0);
  const port = srv.address().port;
  const base = `http://127.0.0.1:${port}/api`;

  try {
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
    const adminToken = jwt.sign({ id: 'director', username: 'director', role: 'director' }, JWT_SECRET);
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

  } finally {
    srv.close();
  }
});
