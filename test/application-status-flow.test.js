const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const db = require('../memory-store');
const applicationsRouter = require('../routes/applications');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { type: 'staff', role: 'director' };
    next();
  });
  app.use('/api/applications', applicationsRouter);
  return app;
}

test('rejected applications cannot move to interviewing', async () => {
  db.data.applications = [];
  db.prepare('INSERT INTO applications (name, status) VALUES (?, ?)').run('Rejected Applicant', 'Rejected');

  const app = buildApp();
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));

  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/applications/1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'Interviewing' })
    });
    const body = await res.json();

    assert.equal(res.status, 400, 'rejected applications should not be allowed into interviewing');
    assert.match(body.error || '', /rejected/i);
  } finally {
    server.close();
  }
});

test('rejected applications cannot move to accepted', async () => {
  db.data.applications = [];
  db.prepare('INSERT INTO applications (name, status) VALUES (?, ?)').run('Rejected Applicant 2', 'Rejected');

  const app = buildApp();
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));

  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/applications/1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'Accepted' })
    });
    const body = await res.json();

    assert.equal(res.status, 400, 'rejected applications should not be allowed into accepted');
    assert.match(body.error || '', /rejected/i);
  } finally {
    server.close();
  }
});
