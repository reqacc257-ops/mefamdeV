const fs = require('fs');
const path = require('path');
const db = require('../db');

async function run() {
  const migrationsDir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
    console.log('Applying', f);
    try {
      db.exec(sql);
    } catch (err) {
      console.error('Migration failed', f, err.message);
      process.exit(1);
    }
  }
  console.log('Migrations applied');
}

if (require.main === module) run();
module.exports = { run };
