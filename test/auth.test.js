const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const express = require('express');
const db = require('../memory-store');
const authRouter = require('../routes/auth');

test('applicant auth accepts a portal username and password', async () => {
  db.data.applications = [];
  const passwordHash = crypto.createHash('sha256').update('secret123').digest('hex');
  db.prepare(
    'INSERT INTO applications (name, portal_username, password_hash, status) VALUES (?, ?, ?, ?)'
  ).run('Sample Applicant', 'portaluser', passwordHash, 'Pending Review');

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);

  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));

  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/applicant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'portaluser', password: 'secret123' })
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.user?.type, 'applicant');
    assert.equal(body.user?.appId, 1);
  } finally {
    server.close();
  }
});

test('auth lookup resolves an applicant by portal username', async () => {
  db.data.applications = [];
  db.prepare(
    'INSERT INTO applications (name, portal_username, status) VALUES (?, ?, ?)' 
  ).run('Lookup Applicant', 'lookupuser', 'Pending Review');

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);

  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));

  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'lookupuser' })
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.applicant?.username, 'lookupuser');
    assert.equal(body.applicant?.id, 1);
  } finally {
    server.close();
  }
});
