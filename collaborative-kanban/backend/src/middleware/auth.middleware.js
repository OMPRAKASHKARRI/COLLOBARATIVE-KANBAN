const prisma = require('../config/db');
const { verifyAccess } = require('../utils/tokens');
const { unauthorized } = require('../utils/errors');

// Resolves a bearer access token to a live user row (also used by the socket layer).
async function userFromAccessToken(token) {
  let payload;
  try {
    payload = verifyAccess(token);
  } catch (e) {
    const expired = e.name === 'TokenExpiredError';
    throw unauthorized(expired ? 'Access token expired' : 'Invalid token', expired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID');
  }
  if (payload.typ !== 'access') throw unauthorized('Invalid token', 'TOKEN_INVALID');
  const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, name: true, email: true, tokenVersion: true } });
  if (!user || user.tokenVersion !== payload.tv) throw unauthorized('Session is no longer valid', 'TOKEN_INVALID');
  return { user, exp: payload.exp };
}

async function authenticate(req, _res, next) {
  try {
    const h = req.get('authorization') || '';
    const [scheme, token] = h.split(' ');
    if (scheme !== 'Bearer' || !token) throw unauthorized();
    req.user = (await userFromAccessToken(token)).user;
    next();
  } catch (e) { next(e); }
}

module.exports = { authenticate, userFromAccessToken };
