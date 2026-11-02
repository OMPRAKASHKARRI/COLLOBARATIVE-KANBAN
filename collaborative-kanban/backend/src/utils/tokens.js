const jwt = require('jsonwebtoken');
const env = require('../config/env');

const signAccess = (user) =>
  jwt.sign({ sub: user.id, tv: user.tokenVersion, typ: 'access' }, env.JWT_ACCESS_SECRET, { expiresIn: env.ACCESS_TTL });
const signRefresh = (user) =>
  jwt.sign({ sub: user.id, tv: user.tokenVersion, typ: 'refresh' }, env.JWT_REFRESH_SECRET, { expiresIn: env.REFRESH_TTL });
const verifyAccess = (t) => jwt.verify(t, env.JWT_ACCESS_SECRET);
const verifyRefresh = (t) => jwt.verify(t, env.JWT_REFRESH_SECRET);

module.exports = { signAccess, signRefresh, verifyAccess, verifyRefresh };
