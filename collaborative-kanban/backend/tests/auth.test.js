const jwt = require('jsonwebtoken');
const env = require('../src/config/env');
const { startServer, uid, prisma } = require('./helpers');

let s;
beforeAll(async () => { s = await startServer(); });
afterAll(async () => { await s.stop(); await prisma.$disconnect(); });

const creds = () => ({ name: 'Test User', email: `auth.${uid()}@test.dev`, password: 'Password123!' });

describe('authentication', () => {
  it('registers, hashes the password, and sets an HttpOnly refresh cookie', async () => {
    const c = creds();
    const res = await s.api.post('/api/auth/register').send(c);
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.headers['set-cookie'].join(';')).toMatch(/kb_refresh=.*HttpOnly/i);
    const row = await prisma.user.findUnique({ where: { email: c.email } });
    expect(row.passwordHash).not.toContain('Password123');
    expect(row.passwordHash.startsWith('$2')).toBe(true);
  });

  it('rejects duplicate emails (409) and invalid input (400)', async () => {
    const c = creds();
    await s.api.post('/api/auth/register').send(c).expect(201);
    await s.api.post('/api/auth/register').send(c).expect(409);
    const bad = await s.api.post('/api/auth/register').send({ name: '', email: 'nope', password: 'short' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.length).toBeGreaterThanOrEqual(3);
  });

  it('logs in with correct credentials and rejects wrong ones with a generic 401', async () => {
    const c = creds();
    await s.api.post('/api/auth/register').send(c);
    const ok = await s.api.post('/api/auth/login').send({ email: c.email, password: c.password });
    expect(ok.status).toBe(200);
    const wrong = await s.api.post('/api/auth/login').send({ email: c.email, password: 'wrong-password' });
    const unknown = await s.api.post('/api/auth/login').send({ email: `x.${uid()}@test.dev`, password: 'whatever1' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('protects /me and distinguishes missing, invalid and expired tokens', async () => {
    await s.api.get('/api/auth/me').expect(401);
    const bad = await s.api.get('/api/auth/me').set('Authorization', 'Bearer garbage');
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('TOKEN_INVALID');
    const c = creds();
    const reg = await s.api.post('/api/auth/register').send(c);
    const expired = jwt.sign({ sub: reg.body.user.id, tv: 0, typ: 'access' }, env.JWT_ACCESS_SECRET, { expiresIn: -10 });
    const res = await s.api.get('/api/auth/me').set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
    const good = await s.api.get('/api/auth/me').set('Authorization', `Bearer ${reg.body.accessToken}`);
    expect(good.body.user.email).toBe(c.email);
  });

  it('refresh requires the CSRF header + cookie; refresh tokens cannot be used as access tokens', async () => {
    const c = creds();
    const reg = await s.api.post('/api/auth/register').send(c);
    const cookie = reg.headers['set-cookie'][0].split(';')[0];
    await s.api.post('/api/auth/refresh').set('Cookie', cookie).expect(403);
    await s.api.post('/api/auth/refresh').set('X-Requested-With', 'kanban').expect(401);
    const ok = await s.api.post('/api/auth/refresh').set('Cookie', cookie).set('X-Requested-With', 'kanban');
    expect(ok.status).toBe(200);
    expect(ok.body.accessToken).toBeTruthy();
    const refreshJwt = cookie.split('=')[1];
    await s.api.get('/api/auth/me').set('Authorization', `Bearer ${refreshJwt}`).expect(401);
  });

  it('logout?all=true revokes existing access and refresh tokens', async () => {
    const reg = await s.api.post('/api/auth/register').send(creds());
    const cookie = reg.headers['set-cookie'][0].split(';')[0];
    await s.api.post('/api/auth/logout?all=true').set('Authorization', `Bearer ${reg.body.accessToken}`).expect(204);
    await s.api.get('/api/auth/me').set('Authorization', `Bearer ${reg.body.accessToken}`).expect(401);
    await s.api.post('/api/auth/refresh').set('Cookie', cookie).set('X-Requested-With', 'kanban').expect(401);
  });
});
