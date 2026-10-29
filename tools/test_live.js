// Checks the deployed site: the worker counts under the real security policy, and the page cannot send data out.
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');
const URL_ = process.argv[2] || 'https://token-odometer.vercel.app';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'odo-live-')),
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL_, { waitUntil: 'load' });
  // Two lines for the same reply (counted once) plus one more reply.
  const lines = [
    { type: 'assistant', timestamp: '2026-10-01T15:00:00Z', sessionId: 's1', message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 300, cache_read_input_tokens: 4000 } } },
    { type: 'assistant', timestamp: '2026-10-01T15:00:01Z', sessionId: 's1', message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 300, cache_read_input_tokens: 4000 } } },
    { type: 'assistant', timestamp: '2026-10-02T09:00:00Z', sessionId: 's2', message: { id: 'm2', model: 'claude-sonnet-5-5', usage: { input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 3, cache_read_input_tokens: 4 } } },
  ].map((o) => JSON.stringify(o)).join('\n');
  const r = await page.evaluate(async (text) => {
    window.__countFiles([{ file: new File([text], 'a.jsonl'), project: 'p' }]);
    for (let i = 0; i < 100 && !window.__current(); i++) await new Promise((r) => setTimeout(r, 100));
    let fetchBlocked = false;
    try { await fetch('https://example.com/?leak=1'); } catch { fetchBlocked = true; }
    let beaconSent = navigator.sendBeacon ? navigator.sendBeacon('https://example.com/b', 'x') : false;
    const c = window.__current();
    return { total: c && c.total, messages: c && c.messages, sessions: c && c.sessions, fetchBlocked, beaconSent };
  }, lines);
  const want = 4330 + 10;
  console.log(r);
  const ok = r.total === want && r.messages === 2 && r.sessions === 2 && r.fetchBlocked && !errors.length;
  console.log(ok ? 'LIVE OK' : 'LIVE FAILED', errors);
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
