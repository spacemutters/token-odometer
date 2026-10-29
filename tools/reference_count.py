"""Independent token count over a Claude Code projects folder, to check the web app's numbers.

usage: python reference_count.py <projects dir> [out.json]

Counts each assistant message once (deduplicated by message.id, falling back to requestId),
because Claude Code writes one line per content block and repeats the same usage on each.
"""
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

root = Path(sys.argv[1])
seen = set()
tot = Counter()
by_day = Counter()
by_hour = Counter()
by_model = Counter()
sessions = set()
projects = set()
messages = 0
files = 0
bad = 0

for f in root.rglob("*.jsonl"):
    files += 1
    with open(f, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            if '"usage"' not in line:
                continue
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                bad += 1
                continue
            m = d.get("message") or {}
            u = m.get("usage")
            if d.get("type") != "assistant" or not isinstance(u, dict):
                continue
            key = m.get("id") or d.get("requestId")
            if not key or key in seen:
                continue
            seen.add(key)
            parts = {
                "input": u.get("input_tokens") or 0,
                "output": u.get("output_tokens") or 0,
                "cache_write": u.get("cache_creation_input_tokens") or 0,
                "cache_read": u.get("cache_read_input_tokens") or 0,
            }
            total = sum(parts.values())
            tot.update(parts)
            messages += 1
            ts = d.get("timestamp") or ""
            if ts:
                by_day[ts[:10]] += total
                by_hour[ts[11:13]] += 1
            if m.get("model") and m.get("model") != "<synthetic>":
                by_model[m["model"]] += total
            if d.get("sessionId"):
                sessions.add(d["sessionId"])
            projects.add(f.relative_to(root).parts[0])

result = {
    "files": files,
    "messages": messages,
    "sessions": len(sessions),
    "projects": len(projects),
    "total": sum(tot.values()),
    "parts": dict(tot),
    "busiest_day": by_day.most_common(1),
    "days_active": len(by_day),
    "peak_hour_utc": by_hour.most_common(1),
    "top_model": by_model.most_common(1),
    "bad_lines": bad,
}
print(json.dumps(result, indent=1))
if len(sys.argv) > 2:
    Path(sys.argv[2]).write_text(json.dumps(result, indent=1))
