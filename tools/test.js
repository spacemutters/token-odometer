// End-to-end check: serve the site, feed it the fixture through the real worker, compare with
// reference_count.py, then screenshot the example view in light, dark and phone sizes.
// usage: node tools/test.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.jsonl': 'application/json' };

function listJsonl(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listJsonl(p, base) : e.name.endsWith('.jsonl') ? [path.relative(base, p).split(path.sep).join('/')] : [];
  });
}

(async () => {
  const server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
    if (!p.startsWith(ROOT) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  }).listen(0);
  const port = server.address().port;
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, protocolTimeout: 120000,
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'odo-test-')),
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });

  // 1. Count the fixture through the real worker
  const fixture = listJsonl(path.join(__dirname, 'fixture'));
  const got = await page.evaluate(async (files) => {
    const list = [];
    for (const rel of files) {
      const blob = await (await fetch('/tools/fixture/' + rel)).blob();
      list.push({ file: new File([blob], rel.split('/').pop()), project: rel.split('/')[0] });
    }
    window.__countFiles(list);
    for (let i = 0; i < 600 && !window.__current(); i++) await new Promise((r) => setTimeout(r, 100));
    const c = window.__current();
    const badge = document.getElementById('badge');
    return c && { total: c.total, parts: c.parts, messages: c.messages, sessions: c.sessions, days: c.days, odometer: document.getElementById('odometer').getAttribute('aria-label'),
      badgeShown: getComputedStyle(badge).display !== 'none' };
  }, fixture);
  if (got.badgeShown) { console.log('FAIL real results are labelled "Example data"'); }
  const ref = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture_count.json'), 'utf8'));
  const checks = [
    ['total', got.total, ref.total],
    ['messages', got.messages, ref.messages],
    ['sessions', got.sessions, ref.sessions],
    ['input', got.parts.input, ref.parts.input],
    ['output', got.parts.output, ref.parts.output],
    ['cache write', got.parts.cacheWrite, ref.parts.cache_write],
    ['cache read', got.parts.cacheRead, ref.parts.cache_read],
  ];
  let fail = got.badgeShown ? 1 : 0;
  for (const [k, a, b] of checks) { const ok = a === b; if (!ok) fail++; console.log(ok ? 'ok  ' : 'FAIL', k, a, ok ? '' : `(reference ${b})`); }
  console.log('odometer reads:', got.odometer);
  await page.screenshot({ path: path.join(OUT, 'fixture-desktop.png'), fullPage: true });

  // 2. Example view, light and dark, desktop and phone
  for (const [scheme, w, h, mobile] of [['light', 1280, 900, false], ['dark', 1280, 900, false], ['light', 390, 844, true], ['dark', 390, 844, true]]) {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.setViewport({ width: w, height: h, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    await page.click('#example');
    await new Promise((r) => setTimeout(r, 300));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 0) { fail++; console.log('FAIL horizontal overflow', scheme, w, overflow, 'px'); }
    await page.screenshot({ path: path.join(OUT, `example-${scheme}-${w}.png`), fullPage: true });
  }

  // 3. The share card
  const card = await page.evaluate(async () => {
    const { drawCard } = await import('/app.js');
    return (await drawCard(window.__current())).toDataURL('image/png');
  });
  fs.writeFileSync(path.join(OUT, 'card-example.png'), Buffer.from(card.split(',')[1], 'base64'));

  if (errors.length) { fail++; console.log('FAIL page errors:', errors); }
  console.log(fail ? `${fail} FAILED` : 'ALL PASSED');
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})();
