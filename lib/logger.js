function ts() { return new Date().toISOString(); }
function info(...args) { console.log('[info]', ts(), ...args); }
function warn(...args) { console.warn('[warn]', ts(), ...args); }
function error(...args) { console.error('[error]', ts(), ...args); }
module.exports = { info, warn, error };
