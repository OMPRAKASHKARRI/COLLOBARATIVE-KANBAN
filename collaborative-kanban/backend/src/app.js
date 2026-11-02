const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const env = require('./config/env');
const prisma = require('./config/db');
const { auth, api } = require('./routes');
const { notFoundHandler, errorHandler } = require('./middleware/error.middleware');
const openapi = require('./openapi');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true, exposedHeaders: ['Idempotent-Replay'] }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(rateLimit({ windowMs: 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false, skip: () => !env.RATE_LIMIT_ENABLED }));

  app.get('/api/health', async (_req, res) => {
    try { await prisma.$queryRaw`SELECT 1`; res.json({ status: 'ok', db: 'up' }); }
    catch { res.status(503).json({ status: 'degraded', db: 'down' }); }
  });
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapi));
  app.use('/api/auth', auth);
  app.use('/api', api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
module.exports = { createApp };
