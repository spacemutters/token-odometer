// Token Odometer: UI, example data and the share card. Counting happens in worker.js.

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('en-US');
const compact = (n) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const MOBY_DICK = 270000; // about 206,000 words, roughly 1.3 tokens per word

// ---------- the odometer ----------
let drums = 0;
function buildOdometer(n) {
  const el = $('odometer');
  if (n === drums) return;
  drums = n;
  el.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const fromRight = n - i;
    const d = document.createElement('div');
    d.className = 'drum' + (fromRight === 1 ? ' tenth' : '');
    d.innerHTML = '<div class="reel">' + [...'0123456789'].map((c) => `<span>${c}</span>`).join('') + '</div>';
    el.append(d);
    if (fromRight > 1 && (fromRight - 1) % 3 === 0) {
      const g = document.createElement('div');
      g.className = 'gap';
      el.append(g);
    }
  }
}
function setOdometer(value) {
  const digits = String(Math.max(0, Math.round(value)));
  buildOdometer(Math.max(12, digits.length));
  const padded = digits.padStart(drums, '0');
  [...$('odometer').querySelectorAll('.reel')].forEach((r, i) => {
    r.style.transform = `translateY(${-Number(padded[i]) * 10}%)`;
  });
  $('odometer').setAttribute('aria-label', `${fmt.format(Math.round(value))} tokens`);
}
setOdometer(0);

// ---------- picking files ----------
const status = (t) => { $('status').textContent = t; };

function projectFromPath(parts) {
  // parts: path segments below the folder the person picked, file name last
  const i = parts.indexOf('projects');
  if (i >= 0 && parts.length > i + 2) return parts[i + 1];
  return parts.length > 1 ? parts[0] : '(this folder)';
}

async function walk(dir, path, out) {
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'directory') await walk(handle, [...path, name], out);
    else if (name.endsWith('.jsonl')) out.push({ handle, project: projectFromPath([...path, name]) });
  }
}

async function pickWithHandle() {
  const dir = await window.showDirectoryPicker({ id: 'claude-projects', mode: 'read' });
  status('Looking for history files...');
  const found = [];
  await walk(dir, [dir.name], found);
  const files = [];
  for (const f of found) files.push({ file: await f.handle.getFile(), project: f.project });
  return files;
}

$('pick').addEventListener('click', async () => {
  if (!('showDirectoryPicker' in window)) { $('fallback').click(); return; }
  try {
    count(await pickWithHandle());
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    status('That folder could not be read. Try picking the projects folder inside .claude.');
  }
});
$('fallback').addEventListener('change', (e) => {
  const files = [...e.target.files]
    .filter((f) => f.name.endsWith('.jsonl'))
    .map((f) => ({ file: f, project: projectFromPath(f.webkitRelativePath.split('/')) }));
  count(files);
  e.target.value = '';
});

// ---------- counting ----------
let worker;
function count(files) {
  if (!files.length) {
    status('No Claude Code history in that folder. Pick the projects folder inside .claude.');
    return;
  }
  worker?.terminate();
  worker = new Worker('worker.js');
  $('pick').disabled = $('example').disabled = true;
  setOdometer(0);
  const started = performance.now();
  worker.onmessage = ({ data }) => {
    if (data.type === 'progress') {
      setOdometer(data.total);
      const pct = data.bytesTotal ? Math.min(99, Math.floor((data.bytesDone / data.bytesTotal) * 100)) : 0;
      status(`Reading ${fmt.format(data.files)} files, ${pct}%`);
    } else if (data.type === 'done') {
      $('pick').disabled = $('example').disabled = false;
      const r = data.result;
      if (!r.messages) {
        setOdometer(0);
        status('No Claude Code replies found in those files. Pick the projects folder inside .claude.');
        return;
      }
      const secs = ((performance.now() - started) / 1000).toFixed(1);
      status(`Read ${fmt.format(data.files)} files (${compact(data.bytesTotal)}B) in ${secs} s. Nothing was uploaded.`);
      show(r, false);
    }
  };
  worker.postMessage({ files });
}

// ---------- results ----------
let current = null;

function prettyModel(id) {
  if (!id) return '-';
  let m = id.match(/^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/);
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? '.' + m[3] : ''}`;
  m = id.match(/^claude-(\d+)(?:-(\d+))?-([a-z]+)/);
  if (m) return `${m[3][0].toUpperCase()}${m[3].slice(1)} ${m[1]}${m[2] ? '.' + m[2] : ''}`;
  return id;
}
const hourLabel = (h) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;
const dayLabel = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function summarize(r) {
  const busiest = r.byDay.reduce((a, b) => (b[1] > a[1] ? b : a), ['', 0]);
  const peak = r.byHour.reduce((best, v, h) => (v > r.byHour[best] ? h : best), 0);
  const top = r.byModel.reduce((a, b) => (b[1] > a[1] ? b : a), ['', 0]);
  return {
    total: r.total,
    parts: r.parts,
    messages: r.messages,
    sessions: r.sessions,
    days: r.byDay.length,
    busiest: busiest[0] ? { day: dayLabel(busiest[0]), tokens: busiest[1] } : null,
    peak: hourLabel(peak),
    model: prettyModel(top[0]),
    since: r.first ? new Date(r.first).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null,
    byDay: new Map(r.byDay),
  };
}

function show(r, example) {
  const s = summarize(r);
  current = { ...s, example };
  setOdometer(s.total);
  $('hero-eyebrow').textContent = example ? 'Example garage' : s.since ? `Claude Code, since ${s.since}` : 'Claude Code';
  $('badge').hidden = !example;

  const stats = [
    [fmt.format(s.messages), 'replies from Claude'],
    [fmt.format(s.sessions), 'sessions'],
    [fmt.format(s.days), 'days at the wheel'],
    [s.busiest ? compact(s.busiest.tokens) : '-', s.busiest ? `busiest day, ${s.busiest.day}` : 'busiest day'],
    [s.peak, 'your busiest hour'],
    [s.model, 'most-used model'],
  ];
  $('stats').innerHTML = stats.map(([b, t]) => `<div class="stat"><b>${b}</b><span>${t}</span></div>`).join('');

  const order = [
    ['cacheRead', 'Cache reads', 'var(--heat4)'],
    ['cacheWrite', 'Cache writes', 'var(--heat3)'],
    ['output', 'Written by Claude', 'var(--heat2)'],
    ['input', 'Fresh input', 'var(--heat1)'],
  ];
  $('bar').innerHTML = order.map(([k, , c]) => `<i style="width:${(s.parts[k] / s.total) * 100}%;background:${c}"></i>`).join('');
  $('bar').setAttribute('aria-label', order.map(([k, l]) => `${l} ${Math.round((s.parts[k] / s.total) * 100)}%`).join(', '));
  const pct = (k) => { const v = (s.parts[k] / s.total) * 100; return v >= 1 ? `${Math.round(v)}%` : v > 0 ? '<1%' : '0%'; };
  $('legend').innerHTML = order.map(([k, l, c]) => `<li style="--c:${c}"><b>${compact(s.parts[k])}</b>${l}, ${pct(k)}</li>`).join('');

  drawHeat($('heat'), s.byDay);
  const moby = s.total / MOBY_DICK;
  $('compare').innerHTML = `That's about <b>${fmt.format(Math.round(moby))}</b> copies of Moby-Dick, at roughly 270,000 tokens each.`;
  $('results').hidden = false;
}

function heatDays(byDay) {
  // 53 weeks ending this week, columns are weeks starting Sunday
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - start.getDay() - 52 * 7);
  const days = [];
  for (const d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    days.push([key, byDay.get(key) || 0]);
  }
  const vals = days.map((d) => d[1]).filter(Boolean).sort((a, b) => a - b);
  const q = (p) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))] || 0;
  const cuts = [q(0.25), q(0.5), q(0.75)];
  const level = (v) => (!v ? 0 : v <= cuts[0] ? 1 : v <= cuts[1] ? 2 : v <= cuts[2] ? 3 : 4);
  return days.map(([k, v]) => ({ key: k, v, l: level(v) }));
}

function drawHeat(el, byDay) {
  const days = heatDays(byDay);
  el.innerHTML = days.map((d) => `<i data-l="${d.l}" title="${d.key}: ${fmt.format(d.v)} tokens"></i>`).join('');
  const active = days.filter((d) => d.v).length;
  el.setAttribute('aria-label', `${active} active days in the last year`);
}

// ---------- example data ----------
function example() {
  let seed = 7;
  const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const byDay = [];
  const today = new Date();
  let tot = 0;
  for (let i = 300; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const ramp = 0.25 + (300 - i) / 300;
    if (rnd() < 0.18 + (d.getDay() % 6 === 0 ? 0.25 : 0)) continue;
    const v = Math.round(ramp * (40e6 + rnd() * 260e6) * (rnd() < 0.06 ? 3 : 1));
    byDay.push([`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, v]);
    tot += v;
  }
  const parts = { cacheRead: Math.round(tot * 0.912), cacheWrite: Math.round(tot * 0.071), output: Math.round(tot * 0.0158), input: 0 };
  parts.input = tot - parts.cacheRead - parts.cacheWrite - parts.output;
  const byHour = new Array(24).fill(0).map((_, h) => Math.round(400 + 900 * Math.exp(-((h - 21) ** 2) / 18)));
  const first = new Date(today);
  first.setDate(first.getDate() - 300);
  return {
    parts, total: tot, messages: 61842, sessions: 1288, projects: 41, byDay, byHour,
    byModel: [['claude-opus-5-5', tot * 0.7], ['claude-sonnet-5-5', tot * 0.3]],
    first: first.toISOString(), last: today.toISOString(),
  };
}
$('example').addEventListener('click', () => {
  status('This is made-up example data. Pick your folder to see your own.');
  show(example(), true);
});
$('again').addEventListener('click', () => $('pick').click());

// ---------- share card ----------
$('download').addEventListener('click', async () => {
  if (!current) return;
  const canvas = await drawCard(current);
  canvas.toBlob((b) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = current.example ? 'token-odometer-example.png' : 'token-odometer.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, 'image/png');
});

export async function drawCard(s) {
  const W = 1080, H = 1350;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const mono = 'ui-monospace, "SF Mono", "Cascadia Mono", Consolas, monospace';
  const sans = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const amber = '#f2a33a', ink = '#f1ece2', muted = '#a59e90';

  g.fillStyle = '#12110f'; g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W / 2, 380, 40, W / 2, 380, 620);
  glow.addColorStop(0, 'rgba(242,163,58,0.20)'); glow.addColorStop(1, 'rgba(242,163,58,0)');
  g.fillStyle = glow; g.fillRect(0, 0, W, H);

  g.textAlign = 'center';
  g.fillStyle = amber; g.font = `600 26px ${sans}`;
  g.letterSpacing = '6px';
  g.fillText(s.example ? 'TOKEN ODOMETER · EXAMPLE' : 'TOKEN ODOMETER', W / 2, 118);
  g.letterSpacing = '0px';

  // drums
  const digits = String(Math.round(s.total));
  const n = Math.max(12, digits.length);
  const padded = digits.padStart(n, '0');
  const groups = Math.floor((n - 1) / 3);
  const gap = 16, dw = Math.min(70, (W - 140 - groups * gap - (n - 1) * 5) / n), dh = dw * 1.5;
  const width = n * dw + (n - 1) * 5 + groups * gap;
  let x = (W - width) / 2;
  const y = 250;
  g.fillStyle = '#2b2925';
  roundRect(g, x - 18, y - 18, width + 36, dh + 36, 20); g.fill();
  for (let i = 0; i < n; i++) {
    const last = i === n - 1;
    g.fillStyle = last ? '#c0392b' : '#0a0a09';
    roundRect(g, x, y, dw, dh, 7); g.fill();
    const shade = g.createLinearGradient(0, y, 0, y + dh);
    shade.addColorStop(0, 'rgba(0,0,0,0.5)'); shade.addColorStop(0.3, 'rgba(0,0,0,0)'); shade.addColorStop(0.7, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(0,0,0,0.5)');
    g.fillStyle = shade; roundRect(g, x, y, dw, dh, 7); g.fill();
    g.fillStyle = last ? '#ffffff' : '#f6d9a6';
    g.font = `600 ${Math.round(dw * 1.05)}px ${mono}`;
    g.textBaseline = 'middle';
    g.fillText(padded[i], x + dw / 2, y + dh / 2 + 3);
    x += dw + 5;
    const fromRight = n - i - 1;
    if (fromRight > 0 && fromRight % 3 === 0) x += gap;
  }
  g.textBaseline = 'alphabetic';
  g.fillStyle = muted; g.font = `500 24px ${mono}`;
  g.letterSpacing = '8px';
  g.fillText('TOKENS', W / 2, y + dh + 78);
  g.letterSpacing = '0px';
  g.fillStyle = ink; g.font = `700 54px ${sans}`;
  g.fillText(`${compact(s.total)} tokens through Claude Code`, W / 2, y + dh + 160);
  if (s.since) { g.fillStyle = muted; g.font = `400 28px ${sans}`; g.fillText(`since ${s.since}`, W / 2, y + dh + 206); }

  // stats
  const stats = [
    [fmt.format(s.messages), 'replies'],
    [fmt.format(s.days), 'days at the wheel'],
    [s.peak, 'busiest hour'],
    [s.busiest ? compact(s.busiest.tokens) : '-', 'busiest day'],
    [s.model, 'top model'],
    [fmt.format(Math.round(s.total / MOBY_DICK)), 'Moby-Dicks, about'],
  ];
  const top = 720, colW = (W - 120) / 3;
  stats.forEach(([v, l], i) => {
    const cx = 60 + colW * (i % 3) + colW / 2, cy = top + Math.floor(i / 3) * 130;
    g.fillStyle = ink; g.font = `600 44px ${mono}`; g.fillText(v, cx, cy);
    g.fillStyle = muted; g.font = `400 24px ${sans}`; g.fillText(l, cx, cy + 40);
  });

  // heatmap, last 53 weeks
  const days = heatDays(s.byDay);
  const cell = 14, cg = 3, cols = Math.ceil(days.length / 7);
  const hx = (W - (cols * (cell + cg) - cg)) / 2, hy = 1030;
  const levels = ['#26231f', '#5a3d14', '#8f5a17', '#c9801f', '#f2a33a'];
  days.forEach((d, i) => {
    g.fillStyle = levels[d.l];
    roundRect(g, hx + Math.floor(i / 7) * (cell + cg), hy + (i % 7) * (cell + cg), cell, cell, 3); g.fill();
  });

  g.fillStyle = muted; g.font = `400 24px ${sans}`;
  g.fillText('Counted on my own computer at token-odometer.vercel.app', W / 2, 1270);
  return c;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// For the test harness and the launch film: count files without the picker, drive the page frame by frame.
window.__countFiles = count;
window.__current = () => current;
window.__show = show;
window.__setOdometer = setOdometer;
window.__drawCard = drawCard;
