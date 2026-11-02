// DEV ONLY: drops all data tables' contents (keeps schema). Refuses to run in production.
require('dotenv').config();
const { Client } = require('pg');
(async () => {
  if (process.env.NODE_ENV === 'production') { console.error('Refusing to reset in production'); process.exit(1); }
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  await c.query('TRUNCATE activity_logs, tasks, columns, boards, memberships, tenants, organizations, users RESTART IDENTITY CASCADE');
  await c.end();
  console.log('All tables truncated');
})();
