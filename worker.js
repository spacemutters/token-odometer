// Counts tokens in Claude Code history files. Runs off the main thread so the odometer keeps rolling.
// Same rules as tools/reference_count.py, which the numbers are checked against:
// one count per assistant reply, deduplicated by message.id (falling back to requestId),
// because Claude Code writes one line per content block and repeats the same usage on each.

const state = () => ({
  parts: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
  messages: 0,
  sessions: new Set(),
  projects: new Set(),
  byDay: new Map(),
  byHour: new Array(24).fill(0),
  byModel: new Map(),
  first: null,
  last: null,
  seen: new Set(),
});

const pad = (n) => String(n).padStart(2, '0');
const localDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const total = (p) => p.input + p.output + p.cacheWrite + p.cacheRead;

function take(s, line, project) {
  if (!line.includes('"usage"') || !line.includes('"assistant"')) return;
  let d;
  try { d = JSON.parse(line); } catch { return; }
  const m = d.message || {};
  const u = m.usage;
  if (d.type !== 'assistant' || !u || typeof u !== 'object') return;
  const key = m.id || d.requestId;
  if (!key || s.seen.has(key)) return;
  s.seen.add(key);

  const p = {
    input: u.input_tokens || 0,
    output: u.output_tokens || 0,
    cacheWrite: u.cache_creation_input_tokens || 0,
    cacheRead: u.cache_read_input_tokens || 0,
  };
  const t = total(p);
  for (const k in p) s.parts[k] += p[k];
  s.messages += 1;
  if (d.sessionId) s.sessions.add(d.sessionId);
  s.projects.add(project);
  if (m.model && m.model !== '<synthetic>') s.byModel.set(m.model, (s.byModel.get(m.model) || 0) + t);
  if (d.timestamp) {
    const when = new Date(d.timestamp);
    if (!isNaN(when)) {
      const day = localDay(when);
      s.byDay.set(day, (s.byDay.get(day) || 0) + t);
      s.byHour[when.getHours()] += 1;
      if (!s.first || when < s.first) s.first = when;
      if (!s.last || when > s.last) s.last = when;
    }
  }
}

function snapshot(s) {
  return {
    parts: { ...s.parts },
    total: total(s.parts),
    messages: s.messages,
    sessions: s.sessions.size,
    projects: s.projects.size,
    byDay: [...s.byDay],
    byHour: s.byHour.slice(),
    byModel: [...s.byModel],
    first: s.first && s.first.toISOString(),
    last: s.last && s.last.toISOString(),
  };
}

self.onmessage = async ({ data }) => {
  const { files } = data; // [{ file: File, project: string }]
  const s = state();
  const bytesTotal = files.reduce((a, f) => a + f.file.size, 0);
  let bytesDone = 0;
  let lastPost = 0;
  for (let i = 0; i < files.length; i++) {
    const { file, project } = files[i];
    const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();
    let rest = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytesDone += value.length; // close enough for a progress bar; exact bytes come from file sizes below
      const chunk = rest + value;
      const lines = chunk.split('\n');
      rest = lines.pop();
      for (const line of lines) take(s, line, project);
      const now = performance.now();
      if (now - lastPost > 200) {
        lastPost = now;
        self.postMessage({ type: 'progress', filesDone: i, files: files.length, bytesDone, bytesTotal, total: total(s.parts) });
      }
    }
    if (rest) take(s, rest, project);
  }
  self.postMessage({ type: 'done', result: snapshot(s), files: files.length, bytesTotal });
};
