// End-to-end checks at phone and laptop sizes. Needs the site running (BASE_URL)
// with DEMO_DEV_OPEN=1 locally, or a deployed preview with Turnstile test keys.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const OUT = 'scripts/e2e-out';
mkdirSync(OUT, { recursive: true });
const SKIP_DB = process.env.E2E_SKIP_DB === '1';
const SKIP_RATE = process.env.E2E_SKIP_RATE === '1';
const LAUNCH = process.env.E2E_CHANNEL ? { channel: process.env.E2E_CHANNEL } : {};
const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

// Draws a polyline on the live canvas in page units (900x620) with REAL input:
// page.mouse on laptop, CDP touch events on phone (synthetic PointerEvents cannot
// setPointerCapture, so they would never reach the app's handlers).
async function draw(page, pts, pointerType = 'mouse') {
  const r = await page.locator('.tryit .sheet canvas').first().boundingBox();
  const at = ([x, y]) => ({ x: r.x + (x / 900) * r.width, y: r.y + (y / 620) * r.height });
  if (pointerType === 'mouse') {
    const [first, ...rest] = pts.map(at);
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    for (const p of rest) await page.mouse.move(p.x, p.y, { steps: 6 });
    await page.mouse.up();
    return;
  }
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ ...p, id: 1 }] : [] });
  const [first, ...rest] = pts.map(at);
  await touch('touchStart', first);
  for (const p of rest) await touch('touchMove', p);
  await touch('touchEnd');
  await cdp.detach();
}

// Wrong working then a large wrong final line "x = 4" (the algebra answer is x = 11), as strokes
// in page units (900x620). Big strokes so the tutor can read them.
const STROKES = [
  // wrong working first: "3x - 2 = 2x + 5" (the bracket was not multiplied out; should be 3x - 6)
  [[80, 100], [130, 100], [100, 140], [135, 170], [80, 185]], // 3
  [[160, 110], [210, 180]], [[210, 110], [160, 180]], // x
  [[240, 145], [290, 145]], // -
  [[320, 110], [370, 110], [320, 180], [375, 180]], // 2
  [[410, 130], [470, 130]], [[410, 160], [470, 160]], // =
  [[500, 110], [550, 110], [500, 180], [555, 180]], // 2
  [[580, 110], [630, 180]], [[630, 110], [580, 180]], // x
  [[660, 145], [710, 145]], [[685, 120], [685, 170]], // +
  [[740, 110], [780, 110]], [[740, 110], [735, 145], [780, 150], [775, 180], [730, 180]], // 5
  [[120, 300], [230, 460]], [[230, 300], [120, 460]], // x
  [[300, 340], [430, 340]], [[300, 420], [430, 420]], // =
  [[520, 300], [500, 400], [620, 400]], [[590, 300], [590, 470]], // 4
];

for (const vp of [{ name: 'phone', width: 390, height: 844, touch: true }, { name: 'laptop', width: 1440, height: 900, touch: false }]) {
  const browser = await chromium.launch(LAUNCH);
  let page;
  try {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, deviceScaleFactor: 2 });
  page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(`${vp.name}: no horizontal scroll`, !overflow);

  await page.waitForTimeout(2500);
  const heroInk = await page.evaluate(() => {
    const c = document.querySelector('.hero-demo canvas'); // the student layer
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 16) if (d[i + 3] > 0 && d[i] < 120 && d[i + 1] < 120) dark++;
    return dark;
  });
  check(`${vp.name}: hero animation draws`, heroInk > 50, `${heroInk} ink samples`);

  await page.locator('.tryit .sheet canvas').first().scrollIntoViewIfNeeded();
  await page.waitForFunction(() => !document.querySelector('.tryit .demo-msg')?.textContent?.includes('Getting the tutor ready'), null, { timeout: 15000 });
  const scrollBefore = await page.evaluate(() => window.scrollY);
  const type = vp.touch ? 'touch' : 'mouse';
  for (const s of STROKES) await draw(page, s, type);
  const scrollAfter = await page.evaluate(() => window.scrollY);
  const touchAction = await page.evaluate(() => getComputedStyle(document.querySelector('.tryit .sheet canvas')).touchAction);
  const drawn = await page.evaluate(() => {
    const c = document.querySelector('.tryit .sheet canvas'); // the student layer
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && d[i] < 120 && d[i + 1] < 120 && d[i + 2] < 120) dark++;
    return dark;
  });
  check(`${vp.name}: ${type} drawing leaves ink and does not scroll`, drawn > 200 && scrollAfter === scrollBefore && touchAction === 'none', `ink=${drawn}, scrollY ${scrollBefore}->${scrollAfter}, touch-action=${touchAction}`);

  await page.waitForSelector('.tryit .demo-msg[data-status="thinking"]', { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('.tryit .demo-msg')?.dataset.status !== 'thinking', null, { timeout: 45000 });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${OUT}/${vp.name}-marked.png` });
  const status = await page.locator('.tryit .demo-msg').getAttribute('data-status');
  const text = (await page.locator('.tryit .demo-msg').textContent()) ?? '';
  const red = await page.evaluate(() => {
    let n = 0;
    for (const c of document.querySelectorAll('.tryit .sheet canvas')) {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && d[i] > 150 && d[i + 1] < 120) n++;
    }
    return n;
  });
  check(`${vp.name}: wrong work gets marked in red`, status !== 'error' && !/see a finished line/i.test(text) && red > 200, `status=${status}, red=${red}, msg="${text.slice(0, 60)}"`);
  } catch (e) {
    check(`${vp.name}: run aborted`, false, e.message);
    if (page) await page.screenshot({ path: `${OUT}/${vp.name}-failure.png` }).catch(() => {});
  } finally {
    await browser.close();
  }
}

// Waitlist: join shows the confirm message.
if (SKIP_DB) console.log('SKIP  waitlist (E2E_SKIP_DB=1)');
else {
  const browser = await chromium.launch(LAUNCH);
  try {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${BASE}/#waitlist`, { waitUntil: 'networkidle' });
  // Resend's test inbox: accepted and discarded, so no bounces hurt the sending domain.
  await page.fill('.waitlist input[type=email]', 'delivered@resend.dev');
  await page.click('.waitlist button.primary');
  await page.waitForSelector('.waitlist [role=status]', { timeout: 10000 });
  const msg = await page.textContent('.waitlist [role=status]');
  check('waitlist join confirms', /inbox/i.test(msg ?? ''), msg ?? '');
  const bad = await (await page.request.get(`${BASE}/api/waitlist/confirm?token=nope`, { maxRedirects: 0 })).headers().location;
  check('bad confirm token redirects to invalid', /waitlist=invalid/.test(bad ?? ''), bad ?? '');
  } catch (e) {
    check('waitlist section', false, e.message);
  } finally {
    await browser.close();
  }
}

// Thanks page: an unknown transaction shows "Confirming", never "not found", while pending.
if (SKIP_DB) console.log('SKIP  thanks (E2E_SKIP_DB=1)');
else {
  const browser = await chromium.launch(LAUNCH);
  try {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${BASE}/thanks?txn=txn_e2e_pending`);
  const h = await page.textContent('h1');
  check('thanks page waits for the webhook', /Confirming/.test(h ?? ''), h ?? '');
  } catch (e) {
    check('thanks section', false, e.message);
  } finally {
    await browser.close();
  }
}

if (process.env.E2E_PADDLE === '1') {
  // Paddle sandbox purchase: only against a deployed preview whose webhook Paddle can reach.
  const browser = await chromium.launch({ ...LAUNCH, headless: false });
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${BASE}/#pricing`, { waitUntil: 'networkidle' });
  await page.check('.buy .agree input');
  await page.click('.buy button.primary');
  console.log('Complete the Paddle sandbox checkout in the opened window with card 4242 4242 4242 4242...');
  await page.waitForURL(/\/thanks\?txn=/, { timeout: 180000 });
  await page.waitForSelector('h1:has-text("You\'re in")', { timeout: 60000 });
  check('paddle sandbox purchase reaches confirmed thanks page', true);
  await browser.close();
}

// Rate limit LAST (fresh in-memory counter): checks 1-10 must pass the gate, the 11th is refused with reason "rate".
// Against a deployed URL this spends the real visitor allowance and daily cap (x-forwarded-for is
// ignored behind Vercel), so skip it there with E2E_SKIP_RATE=1.
if (SKIP_RATE) console.log('SKIP  rate limit (E2E_SKIP_RATE=1)');
else {
  const browser = await chromium.launch(LAUNCH);
  try {
    // Own client IP (x-forwarded-for) so its 10 checks do not use up the marking sections' allowance.
    const page = await (await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '203.0.113.77' } })).newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    const res = await page.evaluate(async () => {
      const out = [];
      let body11 = null;
      for (let i = 0; i < 11; i++) {
        const r = await fetch('/api/mark', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ questionId: 'q-algebra', dataUrl: 'data:image/png;base64,iVBORw0KGgo=', space: { width: 900, height: 620 }, prior: [], transcript: [] }) });
        out.push(r.status);
        if (i === 10) body11 = await r.json().catch(() => null);
      }
      return { out, body11 };
    });
    const { out: statuses, body11 } = res;
    check('rate limit: 10 checks pass the gate, 11th refused with reason=rate',
      statuses.slice(0, 10).every((x) => x !== 429) && statuses[10] === 429 && body11?.reason === 'rate',
      `${statuses.join(',')} reason=${body11?.reason}`);
  } catch (e) {
    check('rate limit section', false, e.message);
  } finally {
    await browser.close();
  }
}

if (failures.length) {
  console.error(`\n${failures.length} failed: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('\nall e2e checks passed');
