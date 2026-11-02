const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const env = require('./env');

// Prisma 6 "client" engine: queries are compiled in-process and executed by the pg driver adapter.
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

module.exports = prisma;
