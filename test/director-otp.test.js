const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const app = require('../server');
const db = require('../memory-store');

const TEST_DIRECTOR_PASSWORD = 'test-director-password';
const TEST_DIRECTOR_HASH = crypto.createHash('sha256').update(TEST_DIRECTOR_PASSWORD).digest('hex');

function setTestDirectorPassword() {
  db.prepare('UPDATE staff SET password = ? WHERE username = ?').run(TEST_DIRECTOR_HASH, 'director');
}

test('director OTP is enabled by default when the env flag is omitted', async () => {
  const previousEmail = process.env.DIRECTOR_EMAIL;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousVerificationEnabled = process.env.DIRECTOR_VERIFICATION_ENABLED;
  process.env.DIRECTOR_EMAIL = 'director@example.com';
  delete process.env.NODE_ENV;
  delete process.env.DIRECTOR_VERIFICATION_ENABLED;
  setTestDirectorPassword();

  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/auth`;

  try {
    const loginRes = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'director', password: TEST_DIRECTOR_PASSWORD })
    });
    const challenge = await loginRes.json();
    assert.equal(loginRes.status, 200);
    assert.equal(challenge.requiresOtp, true);
    assert.match(challenge.developmentOtp || '', /^\d{6}$/);
  } finally {
    server.close();
    if (previousEmail === undefined) delete process.env.DIRECTOR_EMAIL;
    else process.env.DIRECTOR_EMAIL = previousEmail;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousVerificationEnabled === undefined) delete process.env.DIRECTOR_VERIFICATION_ENABLED;
    else process.env.DIRECTOR_VERIFICATION_ENABLED = previousVerificationEnabled;
  }
});

test('director login requires an OTP before issuing a dashboard token', async () => {
  const previousEmail = process.env.DIRECTOR_EMAIL;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousVerificationEnabled = process.env.DIRECTOR_VERIFICATION_ENABLED;
  process.env.DIRECTOR_EMAIL = 'director@example.com';
  delete process.env.NODE_ENV;
  process.env.DIRECTOR_VERIFICATION_ENABLED = 'true';
  setTestDirectorPassword();

  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/auth`;

  try {
    const loginRes = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'director', password: TEST_DIRECTOR_PASSWORD })
    });
    const challenge = await loginRes.json();
    assert.equal(loginRes.status, 200);
    assert.equal(challenge.requiresOtp, true);
    assert.match(challenge.developmentOtp || '', /^\d{6}$/);

    const verifyRes = await fetch(`${base}/director/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeId: challenge.challengeId, otp: challenge.developmentOtp })
    });
    const verified = await verifyRes.json();
    assert.equal(verifyRes.status, 200);
    assert.ok(verified.token);
    assert.equal(verified.user.role, 'director');

    const logoutRes = await fetch(`${base}/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${verified.token}` }
    });
    assert.equal(logoutRes.status, 200);
  } finally {
    server.close();
    if (previousEmail === undefined) delete process.env.DIRECTOR_EMAIL;
    else process.env.DIRECTOR_EMAIL = previousEmail;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousVerificationEnabled === undefined) delete process.env.DIRECTOR_VERIFICATION_ENABLED;
    else process.env.DIRECTOR_VERIFICATION_ENABLED = previousVerificationEnabled;
  }
});

test('director can trust a device for one day after email verification', async () => {
  const previousEmail = process.env.DIRECTOR_EMAIL;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousVerificationEnabled = process.env.DIRECTOR_VERIFICATION_ENABLED;
  process.env.DIRECTOR_EMAIL = 'director@example.com';
  delete process.env.NODE_ENV;
  process.env.DIRECTOR_VERIFICATION_ENABLED = 'true';
  setTestDirectorPassword();

  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/auth`;

  try {
    const firstLoginRes = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'director', password: TEST_DIRECTOR_PASSWORD, deviceId: 'device-123' })
    });
    const firstChallenge = await firstLoginRes.json();
    assert.equal(firstLoginRes.status, 200);
    assert.equal(firstChallenge.requiresOtp, true);

    const trustRes = await fetch(`${base}/director/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeId: firstChallenge.challengeId, otp: firstChallenge.developmentOtp, deviceId: 'device-123', trustDevice: true })
    });
    const trusted = await trustRes.json();
    assert.equal(trustRes.status, 200);
    assert.ok(trusted.token);

    const logoutRes = await fetch(`${base}/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${trusted.token}` }
    });
    assert.equal(logoutRes.status, 200);

    const secondLoginRes = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'director', password: TEST_DIRECTOR_PASSWORD, deviceId: 'device-123' })
    });
    const secondLoginBody = await secondLoginRes.json();
    assert.equal(secondLoginRes.status, 200);
    assert.ok(secondLoginBody.token);
    assert.equal(secondLoginBody.requiresOtp, undefined);
  } finally {
    server.close();
    if (previousEmail === undefined) delete process.env.DIRECTOR_EMAIL;
    else process.env.DIRECTOR_EMAIL = previousEmail;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousVerificationEnabled === undefined) delete process.env.DIRECTOR_VERIFICATION_ENABLED;
    else process.env.DIRECTOR_VERIFICATION_ENABLED = previousVerificationEnabled;
  }
});
