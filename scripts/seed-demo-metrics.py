#!/usr/bin/env python3
"""
Shape the Kestrel demo workspace so its metric charts look realistic:
different time-preference horizons/densities per metric (so the curves differ
in span, granularity, and point count) and a logical consensus trajectory per
metric (so the forecast lines slope instead of sitting flat).

Idempotent: matches metrics by name, sets time preference, respawns markets,
then moves each market's consensus to a point on the metric's trajectory using
the AMM "trade towards value" mode (betTowardsValue), which sets consensus
precisely rather than whipsawing low-liquidity markets.

Usage:
  TELARCHY_KEY=mtrk_... TELARCHY_EMAIL=you@x.com TELARCHY_PASSWORD=... \
    WS_ID=<workspace-uuid> python3 scripts/seed-demo-metrics.py

See docs/screenshots.md.
"""
import os, json, time, http.cookiejar, urllib.request, urllib.error
from collections import defaultdict

BASE = os.environ.get("BASE_URL", "https://telarchy.com")
KEY = os.environ["TELARCHY_KEY"]
WS = os.environ["WS_ID"]
EMAIL = os.environ.get("TELARCHY_EMAIL")
PW = os.environ.get("TELARCHY_PASSWORD")

# Per-metric shape (matched by name substring) + consensus trajectory.
# start/far are the consensus at the nearest/furthest sampled date.
CONFIG = [
    {"match": "MRR",            "halfLife": 2.5, "density": 5, "start": 49000, "far": 64000},
    {"match": "Paying customers","halfLife": 1.5, "density": 4, "start": 318,  "far": 470},
    {"match": "Trial-to-paid",  "halfLife": 0.6, "density": 3, "start": 24.5, "far": 31},
    {"match": "churn",          "halfLife": 1.0, "density": 4, "start": 2.05, "far": 1.3},
]

cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

def call(method, path, body=None, key=False):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    r.add_header("X-Workspace-Id", WS)
    if key:
        r.add_header("X-API-Key", KEY)
    try:
        with opener.open(r, timeout=40) as resp:
            t = resp.read().decode()
            return resp.status, (json.loads(t) if t else {})
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

# 1) Log in so trades run as the admin participant (admin master key can't trade).
if EMAIL and PW:
    s, _ = call("POST", "/api/auth/sign-in/email", {"email": EMAIL, "password": PW})
    print("login:", s)

# 2) Fetch metrics, set per-metric time preference (respawns markets).
# SKIP_TP=1 leaves time preference (and the market set) untouched and only
# re-sets the consensus trajectory on the existing markets, useful when bots or
# a refresh have flattened a previously-shaped workspace.
skip_tp = os.environ.get("SKIP_TP") == "1"
s, data = call("GET", "/api/metrics", key=True)
metrics = data if isinstance(data, list) else data.get("metrics", [])
id_to_cfg = {}
for m in metrics:
    for c in CONFIG:
        if c["match"].lower() in (m.get("name") or "").lower():
            id_to_cfg[m["id"]] = c
            if not skip_tp:
                s, _ = call("PUT", f"/api/metrics/{m['id']}",
                            {"timePreference": {"enabled": True, "halfLife": c["halfLife"], "density": c["density"]}},
                            key=True)
                print(f"TP {m['name']:30.30} hl={c['halfLife']} density={c['density']} -> {s}")

# 3) Refresh so the new sampled-date markets exist.
if not skip_tp:
    call("POST", "/api/predictions/markets/refresh", {}, key=True)
    time.sleep(2)

# 4) Move each market's consensus along its metric's trajectory.
s, data = call("GET", "/api/predictions/markets?limit=200", key=True)
mkts = data if isinstance(data, list) else data.get("markets", [])
by_metric = defaultdict(list)
for m in mkts:
    if m.get("metricId") in id_to_cfg and m.get("active", True) and not m.get("resolved") and not m.get("voided"):
        by_metric[m["metricId"]].append(m)

for mid, ms in by_metric.items():
    c = id_to_cfg[mid]
    ms.sort(key=lambda m: m.get("targetDate", ""))
    n = len(ms)
    for i, m in enumerate(ms):
        frac = (i / (n - 1)) if n > 1 else 1.0
        target = round(c["start"] + (c["far"] - c["start"]) * frac, 4)
        # clamp inside (rangeMin, rangeMax)
        lo, hi = m.get("rangeMin", 0), m.get("rangeMax", target * 2 or 1)
        target = min(max(target, lo + (hi - lo) * 0.01), hi - (hi - lo) * 0.01)
        s, r = call("POST", "/api/predictions/trade", {"marketId": m["id"], "value": target, "maxBudget": 60})
        tail = r.get("consensus") if isinstance(r, dict) else r
        print(f"  {c['match']:16.16} {m.get('targetDate'):10} -> target {target} (http {s}, consensus {tail})")
        time.sleep(0.2)

print("done")
