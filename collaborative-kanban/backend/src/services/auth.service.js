const bcrypt = require('bcryptjs');
const prisma = require('../config/db');
const { signAccess, signRefresh, verifyRefresh } = require('../utils/tokens');
const { unauthorized, AppError } = require('../utils/errors');

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email });
// Constant-time-ish defence against user enumeration on login.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

async function register({ name, email, password }) {
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
  const user = await prisma.user.create({ data: { name, email, passwordHash: await bcrypt.hash(password, 12) } });
  return { user, accessToken: signAccess(user), refreshToken: signRefresh(user) };
}

async function login({ email, password }) {
  const user = await prisma.user.findUnique({ where: { email } });
  const ok = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !ok) throw unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  return { user, accessToken: signAccess(user), refreshToken: signRefresh(user) };
}

async function refresh(token) {
  if (!token) throw unauthorized('No refresh token', 'NO_REFRESH');
  let p;
  try { p = verifyRefresh(token); } catch { throw unauthorized('Refresh token invalid or expired', 'REFRESH_INVALID'); }
  const user = await prisma.user.findUnique({ where: { id: p.sub } });
  if (!user || p.typ !== 'refresh' || user.tokenVersion !== p.tv) throw unauthorized('Refresh token invalid or expired', 'REFRESH_INVALID');
  return { user, accessToken: signAccess(user), refreshToken: signRefresh(user) };
}

// Invalidates every outstanding access/refresh token for the user.
async function logoutEverywhere(userId) {
  await prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
}

module.exports = { register, login, refresh, logoutEverywhere, publicUser };
