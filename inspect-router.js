const r = require('./routes/documents');
console.log('typeof', typeof r);
console.log('constructor', r && r.constructor && r.constructor.name);
console.log('keys', Object.keys(r));
console.log(r);
