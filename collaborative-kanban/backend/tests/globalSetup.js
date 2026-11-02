const { Client } = require('pg');
const { execFileSync } = require('child_process');
const path = require('path');
const { testUrl } = require('./testDb');

module.exports = async () => {
  const url = new URL(testUrl());
  const dbName = url.pathname.slice(1);
  const admin = new URL(url); admin.pathname = '/postgres';
  const c = new Client({ connectionString: admin.toString() });
  await c.connect();
  const exists = await c.query('SELECT 1 FROM pg_database WHERE datname=$1', [dbName]);
  if (!exists.rowCount) await c.query(`CREATE DATABASE "${dbName}"`);
  await c.end();
  execFileSync('node', [path.join(__dirname, '..', 'scripts', 'apply-sql-migrations.js')], {
    env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'inherit',
  });
};
