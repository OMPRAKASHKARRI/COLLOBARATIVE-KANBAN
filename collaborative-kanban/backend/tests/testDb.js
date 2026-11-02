// Derives the test database URL: TEST_DATABASE_URL, or DATABASE_URL with "_test" appended to the db name.
require('dotenv').config();
function testUrl() {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const u = new URL(process.env.DATABASE_URL);
  u.pathname = `${u.pathname}_test`;
  return u.toString();
}
module.exports = { testUrl };
