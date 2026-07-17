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

test('forgot-password creates a reset token for any applicant email', async () => {
  db.data.applications = [];
  db.prepare(
    'INSERT INTO applications (name, email, status) VALUES (?, ?, ?)' 
  ).run('Reset Test Applicant', 'applicant@example.com', 'Pending Review');

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);

  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));

  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/applicant/forgot-password?email=applicant@example.com`);
    const body = await res.json();
    const savedApp = db.prepare('SELECT * FROM applications WHERE id = ?').get(1);

    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.match(savedApp.reset_token || '', /[a-f0-9]+/);
  } finally {
    server.close();
  }
});

test('forgot-password builds a reset link from the app origin instead of the login page path', async () => {
  process.env.APP_BASE_URL = 'http://localhost:3000/index.html';
  db.data.applications = [];
  db.prepare(
    'INSERT INTO applications (name, email, status) VALUES (?, ?, ?)' 
  ).run('Path Bug Applicant', 'pathbug@example.com', 'Pending Review');

  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);

  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));

  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/applicant/forgot-password?email=pathbug@example.com`);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.match(logs.join('\n'), /http:\/\/localhost:3000\/reset_password\.html\?token=/);
  } finally {
    console.log = originalLog;
    delete process.env.APP_BASE_URL;
    server.close();
  }
});
