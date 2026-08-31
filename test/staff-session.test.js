const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const express = require('express');
const db = require('../memory-store');
const authRouter = require('../routes/auth');

const password = 'single-session-test-password';
const passwordHash = crypto.createHash('sha256').update(password).digest('hex');

test('staff account allows only one active session until logout', async () => {
  db.prepare('UPDATE staff SET password = ? WHERE username = ?').run(passwordHash, 'edu');

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));

  try {
    const base = `http://127.0.0.1:${server.address().port}/api/auth`;
    const login = () => fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'edu', password })
    });

    const firstLogin = await login();
    const firstBody = await firstLogin.json();
    assert.equal(firstLogin.status, 200);
    assert.ok(firstBody.token);

    const blockedLogin = await login();
    const blockedBody = await blockedLogin.json();
    assert.equal(blockedLogin.status, 409);
    assert.match(blockedBody.error, /already logged in/i);

    const logout = await fetch(`${base}/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${firstBody.token}` }
    });
    assert.equal(logout.status, 200);

    const loginAfterLogout = await login();
    assert.equal(loginAfterLogout.status, 200);
    assert.ok((await loginAfterLogout.json()).token);
  } finally {
    server.close();
  }
});
