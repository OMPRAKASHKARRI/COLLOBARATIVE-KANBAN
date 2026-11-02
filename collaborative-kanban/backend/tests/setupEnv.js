process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = require('./testDb').testUrl();
