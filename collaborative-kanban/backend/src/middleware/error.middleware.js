const { AppError } = require('../utils/errors');
const env = require('../config/env');

function notFoundHandler(_req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
}

// Consistent JSON errors; never leaks stack traces or driver messages.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Malformed JSON body' } });
  }
  if (err.code === 'P2025') return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } });
  if (err.code === 'P2002') return res.status(409).json({ error: { code: 'DUPLICATE', message: 'A record with these values already exists' } });
  if (err.code === 'P2003') return res.status(422).json({ error: { code: 'UNPROCESSABLE', message: 'Invalid reference' } });
  if (!env.isTest) console.error('[error]', req.method, req.originalUrl, err.code || '', err.message);
  const dbDown = /ECONNREFUSED|Connection terminated/i.test(err.message || '');
  res.status(dbDown ? 503 : 500).json({ error: { code: dbDown ? 'DB_UNAVAILABLE' : 'INTERNAL', message: dbDown ? 'Database unavailable' : 'Internal server error' } });
}
module.exports = { notFoundHandler, errorHandler };
