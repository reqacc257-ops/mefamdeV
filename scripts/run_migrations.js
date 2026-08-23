const db = require('../db');

async function run() {
  try {
    await db.initialize();
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
    return;
  }
  console.log('Migrations applied');
}

if (require.main === module) run();
module.exports = { run };
