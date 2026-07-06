const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || process.env.DATABASE_URL || path.join(__dirname, 'mefamdev.db');
const resolvedDbPath = DB_PATH.startsWith('file:') ? DB_PATH.replace('file:', '') : DB_PATH;
const dbDir = path.dirname(resolvedDbPath);
if (dbDir && !fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = require('./memory-store');

function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw).digest('hex');
}

const seedStaff = [
  { username: 'director', password: 'director123', role: 'director', name: 'Director', title: 'Primary Social Worker', initials: 'DR' },
  { username: 'edu', password: 'edu123', role: 'edu', name: 'Edu Staff', title: 'Education Social Worker', initials: 'ED' },
  { username: 'finance', password: 'finance123', role: 'finance', name: 'Finance Staff', title: 'Finance Officer', initials: 'FN' },
  { username: 'program', password: 'program123', role: 'program', name: 'Coordinator', title: 'Program Coordinator', initials: 'PC' },
];

const staffRows = db.prepare('SELECT * FROM staff').all();
const hasValidStaffSeed = staffRows.some(row => row && row.username && row.password && row.role);
if (!hasValidStaffSeed) {
  db.prepare('DELETE FROM staff').run();
  const insertStaff = db.prepare('INSERT INTO staff (username, password, role, name, title, initials) VALUES (?, ?, ?, ?, ?, ?)');
  for (const s of seedStaff) {
    insertStaff.run(s.username, hashPassword(s.password), s.role, s.name, s.title, s.initials);
  }
}

module.exports = db;
