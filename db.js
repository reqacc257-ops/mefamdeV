const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const db = process.env.DATABASE_URL
  ? new (require('./postgres-store').PostgresStore)(process.env.DATABASE_URL)
  : require('./memory-store');

function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw).digest('hex');
}

const seedStaff = [
  { username: 'director', password: 'director123', role: 'director', name: 'Director', title: 'Primary Social Worker', initials: 'DR' },
  { username: 'edu', password: 'edu123', role: 'edu', name: 'Edu Staff', title: 'Education Social Worker', initials: 'ED' },
  { username: 'finance', password: 'finance123', role: 'finance', name: 'Finance Staff', title: 'Finance Officer', initials: 'FN' },
  { username: 'program', password: 'program123', role: 'program', name: 'Coordinator', title: 'Program Coordinator', initials: 'PC' },
];

let initializationPromise;
function initialize() {
  if (initializationPromise) return initializationPromise;
  initializationPromise = (async () => {
    if (db.isPostgres) {
      const files = fs.readdirSync(path.join(__dirname, 'migrations')).filter(file => file.endsWith('.sql')).sort();
      for (const file of files) await db.init(fs.readFileSync(path.join(__dirname, 'migrations', file), 'utf8'));
      await db.seedStaff(seedStaff.map(row => ({ ...row, password: hashPassword(row.password) })));
      return;
    }

    const staffRows = db.prepare('SELECT * FROM staff').all();
    const hasValidStaffSeed = staffRows.some(row => row && row.username && row.password && row.role);
    if (!hasValidStaffSeed) {
      db.prepare('DELETE FROM staff').run();
      const insertStaff = db.prepare('INSERT INTO staff (username, password, role, name, title, initials) VALUES (?, ?, ?, ?, ?, ?)');
      for (const s of seedStaff) insertStaff.run(s.username, hashPassword(s.password), s.role, s.name, s.title, s.initials);
    }
  })();
  return initializationPromise;
}

db.initialize = initialize;
db.seedStaff = db.seedStaff || (async () => {});

if (!db.isPostgres) initialize();

module.exports = db;
