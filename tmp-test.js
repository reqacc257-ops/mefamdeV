const mod = require('./routes/documents');
console.log('type:', typeof mod);
console.log('name:', mod && mod.name);
console.log('keys:', Object.keys(mod || {}));
console.log('string:', String(mod));
