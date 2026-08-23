const crypto = require('crypto');
const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false },
});

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

async function run() {
  const testPassword = process.argv[2];
  if (!testPassword) throw new Error('Provide the password to test as the first argument');

  try {
    const result = await pool.query('SELECT username, role, password FROM staff WHERE username = $1', ['director']);
    const director = result.rows[0];
    console.log(JSON.stringify({
      found: Boolean(director),
      username: director?.username || null,
      role: director?.role || null,
      passwordMatches: Boolean(director && director.password === hashPassword(testPassword)),
    }));
  } finally {
    await pool.end();
  }
}

run().catch(error => {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
});
