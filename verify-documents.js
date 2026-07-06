const docs = require('./routes/documents');
console.log(typeof docs);
console.log(docs && docs.constructor && docs.constructor.name);
console.log(Array.isArray(Object.keys(docs)) ? Object.keys(docs).slice(0,10) : 'no-keys');
