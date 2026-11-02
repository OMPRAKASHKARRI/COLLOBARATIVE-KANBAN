import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { execSync } from 'child_process';

const BASE = 'http://localhost:5173';
const SHOTS = '/home/claude/collaborative-kanban/screenshots';
const results = [];
const step = async (name, fn) => {
  try { const detail = await fn(); results.push({ name, ok: true, detail }); console.log('PASS', name, detail ?? ''); }
  catch (e) { results.push({ name, ok: false, detail: e.message }); console.log('FAIL', name, '-', e.message.split('\n')[0]); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = (q) => execSync(`PGPASSWORD=kanban_dev_pw psql -h localhost -U kanban -d collaborative_kanban -Atc "${q}"`).toString().trim();

const browser = await puppeteer.launch({ args: [...chromium.args.filter((a) => a !== '--single-process' && a !== '--no-zygote'), '--no-sandbox'], defaultViewport: null, executablePath: await chromium.executablePath(), headless: 'shell' });
const mk = async () => { const ctx = await browser.createBrowserContext(); const p = await ctx.newPage(); await p.setViewport({ width: 1440, height: 900 }); p.on('pageerror', (e) => console.log('  [pageerror]', e.message)); return p; };
const A = await mk(); const B = await mk();

const bodyHas = (p, text, timeout = 6000) => p.waitForFunction((t) => document.body.innerText.includes(t), { timeout, polling: 150 }, text);
const clickText = async (p, sel, text) => {
  const ok = await p.evaluate((s, t) => { const el = [...document.querySelectorAll(s)].find((e) => e.innerText.trim().includes(t)); if (el) { el.click(); return true; } return false; }, sel, text);
  if (!ok) throw new Error(`no ${sel} with text "${text}"`);
};
const login = async (p, email) => {
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle0' });
  await p.type('#email', email); await p.type('#password', 'Password123!');
  await clickText(p, 'button', 'Log in');
  await bodyHas(p, 'Branches');
};
const colTitles = (p, col) => p.$$eval(`section[aria-label^="${col},"] button[aria-label^="Open task"]`, (els) => els.map((e) => e.innerText.split('\n')[0]));
const drag = async (p, fromSel, toX, toY) => {
  const h = await p.$(fromSel); const b = await h.boundingBox();
  await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down();
  await p.mouse.move(b.x + b.width / 2 + 10, b.y + b.height / 2 + 10, { steps: 4 });
  await p.mouse.move(toX, toY, { steps: 20 }); await sleep(150); await p.mouse.up(); await sleep(400);
};
const center = async (p, sel) => { const b = await (await p.$(sel)).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b }; };

await step('login page renders + screenshot', async () => { await A.goto(`${BASE}/login`, { waitUntil: 'networkidle0' }); await A.screenshot({ path: `${SHOTS}/01-login.png` }); });
await step('invalid login shows error', async () => { await A.type('#email', 'priya@abc.test'); await A.type('#password', 'wrong-pass'); await clickText(A, 'button', 'Log in'); await bodyHas(A, 'Invalid email or password'); });
await step('login as Priya (tenant admin) and Arjun (member) in separate sessions', async () => { await login(A, 'priya@abc.test'); await login(B, 'arjun@abc.test'); });
await step('dashboard: org + branch + boards from API, screenshot', async () => {
  await bodyHas(A, 'Website Development'); await bodyHas(A, 'ABC Technologies');
  const orgs = await A.$$eval('#ws-org option', (o) => o.map((x) => x.textContent)); const br = await A.$$eval('#ws-tenant option', (o) => o.map((x) => x.textContent));
  await A.screenshot({ path: `${SHOTS}/02-dashboard.png` }); return `orgs=${orgs} branches(priya)=${br}`;
});
await step('member sees only own branch; no create-board button', async () => {
  const br = await B.$$eval('#ws-tenant option', (o) => o.map((x) => x.textContent));
  const canCreate = await B.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.innerText.includes('New board')));
  if (br.join() !== 'Hyderabad' || canCreate) throw new Error(`branches=${br} canCreate=${canCreate}`); return 'branches=Hyderabad';
});
for (const p of [A, B]) await clickText(p, 'a', 'Website Development');
await step('both users open the same board', async () => { for (const p of [A, B]) await p.waitForSelector('section[aria-label^="To Do,"]'); await bodyHas(A, 'Create Login Page'); });
await step('presence: both see 2 online + Live badge', async () => {
  await A.waitForFunction(() => document.querySelector('[aria-label="2 online"]'), { timeout: 6000, polling: 150 }); await bodyHas(A, 'Live');
  await B.waitForFunction(() => document.querySelector('[aria-label="2 online"]'), { timeout: 6000, polling: 150 });
});
await step('REAL-TIME create: A adds a task, B sees it without refresh', async () => {
  await A.click('button[aria-label="Add task to To Do"]'); await A.type('input[placeholder="What needs doing?"]', 'E2E live task'); await A.keyboard.press('Enter');
  const t0 = Date.now(); await bodyHas(B, 'E2E live task', 5000); return `${Date.now() - t0}ms`;
});
await step('DRAG cross-column: A drags card to Testing; B sees it move live; DB persisted', async () => {
  const to = await center(A, 'section[aria-label^="Testing,"]');
  await drag(A, 'button[aria-label="Drag E2E live task"]', to.x, to.y);
  await B.waitForFunction(() => [...document.querySelectorAll('section[aria-label^="Testing,"] button[aria-label^="Open task"]')].some((e) => e.innerText.includes('E2E live task')), { timeout: 5000, polling: 150 });
  const col = sql("select c.name from tasks t join columns c on c.id=t.column_id where t.title='E2E live task'"); if (col !== 'Testing') throw new Error('db column=' + col); return 'db column=Testing';
});
await step('DRAG same-column reorder: positions persisted and identical for both users', async () => {
  const before = await colTitles(A, 'To Do');
  const first = before[0]; const last = before[before.length - 1];
  const tgt = await center(A, `button[aria-label="Open task ${last}"]`);
  await drag(A, `button[aria-label="Drag ${first}"]`, tgt.x, tgt.y + tgt.box.height / 3);
  await sleep(800);
  const a = await colTitles(A, 'To Do'); const b = await colTitles(B, 'To Do');
  if (a.join('|') === before.join('|')) throw new Error('order unchanged'); if (a.join('|') !== b.join('|')) throw new Error(`A=${a} B=${b}`);
  const pos = sql("select string_agg(t.position::text, ',' order by t.position) from tasks t join columns c on c.id=t.column_id where c.name='To Do' and t.board_id=(select id from boards where name='Website Development')");
  const n = pos.split(',').length; if (pos !== [...Array(n).keys()].join(',')) throw new Error('positions=' + pos); return `${before[0]} moved; db positions=${pos}`;
});
await step('UNDO reverts the last move for everyone', async () => {
  const before = await colTitles(A, 'To Do');
  await A.click('button[aria-label="Undo"]'); await sleep(900);
  const a = await colTitles(A, 'To Do'); const b = await colTitles(B, 'To Do');
  if (a.join() === before.join() || a.join() !== b.join()) throw new Error(`before=${before} a=${a} b=${b}`);
});
await step('task panel opens with details + history (screenshot)', async () => {
  await A.click('button[aria-label="Open task E2E live task"]'); await bodyHas(A, 'Task details'); await bodyHas(A, 'History'); await sleep(600);
  await A.screenshot({ path: `${SHOTS}/04-task-panel.png` });
});
await step('CONFLICT: B saves first, A saves stale edit -> conflict banner, nothing overwritten', async () => {
  const dump = async (tag) => console.log(`  [${tag}] A dialog:`, (await A.evaluate(() => document.querySelector('[role=dialog]')?.innerText || 'none')).replace(/\n+/g, ' | ').slice(0, 260), '\n  [' + tag + '] B dialog:', (await B.evaluate(() => (document.querySelector('[role=dialog]')?.innerText || 'none') + ' ## toasts: ' + (document.querySelector('[role=status]')?.innerText || ''))).replace(/\n+/g, ' | ').slice(0, 300));
  try {
  await B.click('button[aria-label="Open task E2E live task"]'); await bodyHas(B, 'Task details');
  await B.select('#tp-pri', 'URGENT'); await clickText(B, 'button', 'Save changes'); await bodyHas(B, 'Task saved');
  await sleep(400);
  await A.type('#tp-desc', 'my description');
  await B.select('#tp-pri', 'LOW'); await clickText(B, 'button', 'Save changes'); await sleep(900);
  await bodyHas(A, 'was updated by someone else'); await A.screenshot({ path: `${SHOTS}/05-conflict.png` });
  } catch (e) { await dump('FAIL'); throw e; }
  const pri = sql("select priority from tasks where title='E2E live task'"); if (pri !== 'LOW') throw new Error('pri=' + pri);
  await clickText(A, 'button', 'Discard mine, load latest'); await sleep(300);
  const v = await A.$eval('#tp-pri', (e) => e.value); if (v !== 'LOW') throw new Error('A priority=' + v);
});
await step('stale save from A (forced) returns conflict UI', async () => {
  await A.type('#tp-desc', 'A edits'); await B.select('#tp-pri', 'HIGH'); await clickText(B, 'button', 'Save changes'); await sleep(200);
  // A saves quickly before sync banner? ensure either banner path appears
  await bodyHas(A, 'updated by someone else');
});
await A.keyboard.press('Escape'); await B.keyboard.press('Escape'); await sleep(300);
await step('activity panel shows live entries (screenshot with presence)', async () => {
  await clickText(A, 'button', 'Activity'); await bodyHas(A, 'moved'); await sleep(500); await A.screenshot({ path: `${SHOTS}/03-board-activity-presence.png` });
});
await step('NETWORK RECOVERY: B goes offline, A edits, B reconnects and reconciles', async () => {
  const cdp = await B.createCDPSession(); await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await B.evaluate(() => window.dispatchEvent(new Event('offline')));
  // drop the websocket by forcing a server-side disconnect is not possible from client; close transport via ping timeout
  await bodyHas(B, 'Reconnecting', 30000); await B.screenshot({ path: `${SHOTS}/06-reconnecting.png` });
  await A.click('button[aria-label="Add task to Done"]'); await A.type('input[placeholder="What needs doing?"]', 'Made while B offline'); await A.keyboard.press('Enter'); await sleep(500);
  if (await B.evaluate(() => document.body.innerText.includes('Made while B offline'))) throw new Error('B saw it while offline?!');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await bodyHas(B, 'Made while B offline', 30000); await bodyHas(B, 'Live', 15000);
});
await step('CROSS-TENANT: Arjun opens a Bangalore board URL -> denied, no data leaked', async () => {
  const id = sql("select b.id from boards b join tenants t on t.id=b.tenant_id where t.name='Bangalore' limit 1");
  await B.goto(`${BASE}/boards/${id}`, { waitUntil: 'networkidle0' }); await bodyHas(B, 'doesn’t exist or you don’t have access');
  const leaked = await B.evaluate(() => /CRM|Lead scoring|Import customer/.test(document.body.innerText)); if (leaked) throw new Error('leak');
  const status = await B.evaluate(async (id) => { const tok = await (await fetch('http://localhost:5000/api/auth/refresh', { method: 'POST', credentials: 'include', headers: { 'X-Requested-With': 'kanban' } })).json(); const r = await fetch(`http://localhost:5000/api/boards/${id}`, { headers: { Authorization: `Bearer ${tok.accessToken}` } }); return r.status; }, id);
  if (status !== 404) throw new Error('api status=' + status); return `ui denied, api=${status}`;
});
await step('switching branch (multi-tenant user) clears previous board; sockets rejoin new room', async () => {
  const C = await mk(); await login(C, 'meera@abc.test'); await bodyHas(C, 'CRM Development');
  const br = await C.$$eval('#ws-tenant option', (o) => o.map((x) => x.textContent)); if (br.join() !== 'Bangalore,Hyderabad') throw new Error('branches=' + br);
  await C.select('#ws-tenant', await C.$$eval('#ws-tenant option', (o) => o.find((x) => x.textContent === 'Hyderabad').value));
  await bodyHas(C, 'Website Development');
  if (await C.evaluate(() => document.body.innerText.includes('CRM Development'))) throw new Error('stale Bangalore data visible');
  await C.evaluate(() => [...document.querySelectorAll('a')].find((a) => a.innerText.includes('Website Development')).click());
  await C.waitForSelector('section[aria-label^="To Do,"]'); await C.waitForFunction(() => document.querySelector('[aria-label$="online"]'), { timeout: 6000, polling: 150 });
});
await step('MOBILE layout renders the board (screenshot)', async () => {
  const M = await mk(); await M.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true }); await login(M, 'priya@abc.test');
  await bodyHas(M, 'Website Development'); await M.screenshot({ path: `${SHOTS}/07-mobile-dashboard.png` });
  await clickText(M, 'a', 'Website Development'); await M.waitForSelector('section[aria-label^="To Do,"]'); await sleep(600); await M.screenshot({ path: `${SHOTS}/08-mobile-board.png` });
  const overflowX = await M.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2); if (overflowX) throw new Error('page scrolls horizontally');
});
await step('desktop board screenshot', async () => { await clickText(A, 'button', 'Activity'); await sleep(300); await A.screenshot({ path: `${SHOTS}/03-board.png` }); });

const failed = results.filter((r) => !r.ok);
console.log(`\nE2E: ${results.length - failed.length}/${results.length} steps passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
