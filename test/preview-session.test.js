const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function createStorage() {
  const store = new Map();
  return {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(String(key), String(value)); },
    removeItem(key) { store.delete(String(key)); },
    clear() { store.clear(); },
    has(key) { return store.has(String(key)); }
  };
}

test('preview session hydration keeps applicant preview auth alive', () => {
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  const context = {
    window: {
      location: { protocol: 'http:', pathname: '/index.html' },
      MEFAMDEV_API_BASE: ''
    },
    localStorage,
    sessionStorage,
    console,
    fetch: async () => ({ ok: true, text: async () => '{}' })
  };

  const script = fs.readFileSync('./public/mefamdev-api.js', 'utf8') + '\n;globalThis.__previewHydration = hydratePreviewSessionFromStorage;';
  vm.createContext(context);
  vm.runInContext(script, context);

  const sessionData = {
    type: 'applicant',
    appId: 123,
    name: 'Jane Applicant',
    loginTime: Date.now(),
    isAdminPreview: true,
    token: 'preview-token-123'
  };
  localStorage.setItem('mefamdev_preview_session', JSON.stringify(sessionData));

  assert.equal(context.__previewHydration(), true);
  assert.equal(sessionStorage.getItem('mefamdev_token'), 'preview-token-123');
  const hydrated = JSON.parse(sessionStorage.getItem('mefamdev_session'));
  assert.equal(hydrated.type, 'applicant');
  assert.equal(hydrated.appId, 123);
});
