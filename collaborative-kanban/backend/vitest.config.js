const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    environment: 'node',
    globals: true,
    globalSetup: ['./tests/globalSetup.js'],
    setupFiles: ['./tests/setupEnv.js'],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false, // tests share one PostgreSQL test database
  },
});
