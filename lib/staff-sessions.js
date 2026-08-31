const activeSessions = new Map();

function purgeExpiredSessions(now = Date.now()) {
  for (const [username, session] of activeSessions.entries()) {
    if (!session || session.expiresAt <= now) activeSessions.delete(username);
  }
}

function hasActiveSession(username) {
  purgeExpiredSessions();
  return activeSessions.has(String(username || '').trim());
}

function createSession(username, sessionId, expiresAt) {
  purgeExpiredSessions();
  activeSessions.set(String(username || '').trim(), { sessionId, expiresAt });
}

function isActiveSession(username, sessionId, expiresAt) {
  purgeExpiredSessions();
  const session = activeSessions.get(String(username || '').trim());
  return Boolean(session && session.sessionId === sessionId && session.expiresAt > Date.now() && expiresAt * 1000 > Date.now());
}

function revokeSession(username, sessionId) {
  const key = String(username || '').trim();
  const session = activeSessions.get(key);
  if (session && (!sessionId || session.sessionId === sessionId)) activeSessions.delete(key);
}

module.exports = { createSession, hasActiveSession, isActiveSession, revokeSession };
