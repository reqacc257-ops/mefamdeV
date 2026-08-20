const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../server');

test('director login requires an OTP before issuing a dashboard token', async () => {
  const previousEmail = process.env.DIRECTOR_EMAIL;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.DIRECTOR_EMAIL = 'director@example.com';
  delete process.env.NODE_ENV;

  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/auth`;

  try {
    const loginRes = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'director', password: 'director123' })
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
  } finally {
    server.close();
    if (previousEmail === undefined) delete process.env.DIRECTOR_EMAIL;
    else process.env.DIRECTOR_EMAIL = previousEmail;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});
