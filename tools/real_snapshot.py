"""Davis's real numbers in the exact shape worker.js produces, for the launch film.

usage: python real_snapshot.py <projects dir> <out.json>
Local-time days and hours, same dedupe rule as worker.js and reference_count.py.
"""
import json
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

root = Path(sys.argv[1])
seen, sessions, projects = set(), set(), set()
parts = Counter()
by_day, by_model = Counter(), Counter()
by_hour = [0] * 24
first = last = None
messages = 0
for f in root.rglob("*.jsonl"):
    with open(f, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            if '"usage"' not in line or '"assistant"' not in line:
                continue
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                continue
            m = d.get("message") or {}
            u = m.get("usage")
            if d.get("type") != "assistant" or not isinstance(u, dict):
                continue
            key = m.get("id") or d.get("requestId")
            if not key or key in seen:
                continue
            seen.add(key)
            p = {"input": u.get("input_tokens") or 0, "output": u.get("output_tokens") or 0,
                 "cacheWrite": u.get("cache_creation_input_tokens") or 0, "cacheRead": u.get("cache_read_input_tokens") or 0}
            t = sum(p.values())
            parts.update(p)
            messages += 1
            if d.get("sessionId"):
                sessions.add(d["sessionId"])
            projects.add(f.relative_to(root).parts[0])
            if m.get("model") and m["model"] != "<synthetic>":
                by_model[m["model"]] += t
            ts = d.get("timestamp")
            if ts:
                when = datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone()
                by_day[when.strftime("%Y-%m-%d")] += t
                by_hour[when.hour] += 1
                first = when if not first or when < first else first
                last = when if not last or when > last else last

out = {
    "parts": {k: parts[k] for k in ("input", "output", "cacheWrite", "cacheRead")},
    "total": sum(parts.values()), "messages": messages, "sessions": len(sessions), "projects": len(projects),
    "byDay": sorted(by_day.items()), "byHour": by_hour, "byModel": by_model.most_common(),
    "first": first.isoformat() if first else None, "last": last.isoformat() if last else None,
}
Path(sys.argv[2]).write_text(json.dumps(out))
print(out["total"], out["messages"], out["sessions"], len(out["byDay"]), out["first"], out["last"])
