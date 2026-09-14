const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../memory-store');
const auditRouter = require('../routes/audit');

test('audit API accepts canonical entries and serves recent activity', async () => {
  db.data.audit_logs = [];

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { type: 'staff', role: 'director', id: 7, name: 'Director Person', username: 'director' };
    next();
  });
  app.use('/api/audit', auditRouter);

  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));

  try {
    const { port } = server.address();
    const authHeader = { Authorization: `Bearer ${jwt.sign({ type: 'staff', role: 'director', id: 7, name: 'Director Person', username: 'director' }, 'local-development-only-jwt-secret')}` };

    const postRes = await fetch(`http://127.0.0.1:${port}/api/audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader },
      body: JSON.stringify({
        action: 'application.accept',
        entityType: 'application',
        entityId: 42,
        entityLabel: 'Dela Cruz, Juan',
        before: { status: 'Pending Review' },
        after: { status: 'Accepted' },
        note: 'Approved after review',
        meta: { batchId: 'B-42' }
      })
    });
    const postBody = await postRes.json();

    assert.equal(postRes.status, 200);
    assert.equal(postBody.ok, true);
    assert.equal(postBody.entries[0].actorName, 'Director Person');
    assert.equal(postBody.entries[0].action, 'application.accept');

    const recentRes = await fetch(`http://127.0.0.1:${port}/api/audit/recent?limit=10`, { headers: authHeader });
    const recentBody = await recentRes.json();
    assert.equal(recentRes.status, 200);
    assert.equal(Array.isArray(recentBody.entries), true);
    assert.equal(recentBody.entries.length >= 1, true);
    assert.equal(recentBody.entries[0].entityType, 'application');

    const getRes = await fetch(`http://127.0.0.1:${port}/api/audit?entityType=application&entityId=42`, { headers: authHeader });
    const getBody = await getRes.json();
    assert.equal(getRes.status, 200);
    assert.equal(Array.isArray(getBody.entries), true);
    assert.equal(getBody.entries.length >= 1, true);
  } finally {
    server.close();
  }
});

test('client API wrapper exposes the generic audit helpers', () => {
  const apiSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'mefamdev-api.js'), 'utf8');
  assert.match(apiSource, /async logAudit\(entry\)/);
  assert.match(apiSource, /async getAudit\(/);
  assert.match(apiSource, /async getRecentAudit\(/);
  assert.match(apiSource, /async getAuditForEntity\(/);
});
