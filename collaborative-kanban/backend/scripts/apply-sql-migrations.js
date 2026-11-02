// Fallback migration runner for environments where the Prisma schema engine binary
// cannot be downloaded (e.g. network-restricted CI). Normal path: `npm run db:migrate`.
// Applies prisma/migrations/*/migration.sql in order, once each, tracking in _sql_migrations.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query('CREATE TABLE IF NOT EXISTS _sql_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())');
  const dir = path.join(__dirname, '..', 'prisma', 'migrations');
  const names = fs.readdirSync(dir).filter((n) => fs.existsSync(path.join(dir, n, 'migration.sql'))).sort();
  for (const name of names) {
    const done = await client.query('SELECT 1 FROM _sql_migrations WHERE name=$1', [name]);
    if (done.rowCount) { console.log('skip', name); continue; }
    await client.query('BEGIN');
    try {
      await client.query(fs.readFileSync(path.join(dir, name, 'migration.sql'), 'utf8'));
      await client.query('INSERT INTO _sql_migrations(name) VALUES($1)', [name]);
      await client.query('COMMIT');
      console.log('applied', name);
    } catch (e) { await client.query('ROLLBACK'); console.error('FAILED', name, e.message); process.exit(1); }
  }
  await client.end();
})();
