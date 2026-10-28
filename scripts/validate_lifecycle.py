"""Bounded long-cycle CPU QA; no network, devices, paid API, or ground-truth labels for fit."""

import json, platform, time, tracemalloc
from pathlib import Path
import sklearn
from app.lifecycle import (
    Lifecycle,
    MAX_SAMPLES,
    MAX_POINTS,
    MAX_ELIGIBLE,
    MAX_HISTORY,
    MAX_VERSIONS,
    MAX_WINDOWS,
    MAX_EVENTS,
)

s = Lifecycle()
start = time.perf_counter()
tracemalloc.start()
jobs = []
maxima = dict(points=0, eligible=0, history=0, models=0, windows=0, events=0)
while not s.source_exhausted:
    state, job = s.advance(s.revision, 4)
    if job:
        s.run_job(job)
        jobs.append(
            {
                "at": s.total,
                "state": s.state,
                "active": s.active,
                "winner": s.last_job.get("winner"),
                "test": s.last_job.get("test"),
                "reasons": s.last_job.get("reasons"),
                "duration_ms": s.last_job.get("duration_ms"),
            }
        )
    for name, value in [
        ("points", len(s.points)),
        ("eligible", len(s.eligible)),
        ("history", len(s.history)),
        ("models", len(s.models)),
        ("windows", len(s.window_history)),
        ("events", len(s.events)),
    ]:
        maxima[name] = max(maxima[name], value)
    assert (
        len(s.points) <= MAX_POINTS
        and len(s.eligible) <= MAX_ELIGIBLE
        and len(s.history) <= MAX_HISTORY
        and len(s.models) <= MAX_VERSIONS
        and len(s.window_history) <= MAX_WINDOWS
        and len(s.events) <= MAX_EVENTS
    )
    assert s.total <= MAX_SAMPLES
_, peak = tracemalloc.get_traced_memory()
tracemalloc.stop()
assert any(j["state"] == "promoted" for j in jobs) and any(
    j["state"] == "rejected" for j in jobs
)
if len(s.stack) > 1:
    old = s.active
    s.rollback(s.revision)
    assert s.active != old and not s.training_enabled
before = s.total
for _ in range(12):
    s.advance(s.revision)
assert s.total == before
for _ in range(12):
    s.reset(s.revision)
assert s.total == 512 and s.active == "v1" and not s.history
result = {
    "platform": platform.platform(),
    "cpu": platform.processor() or platform.machine(),
    "python": platform.python_version(),
    "sklearn": sklearn.__version__,
    "seed": 520,
    "seconds": round(time.perf_counter() - start, 3),
    "tracemalloc_peak_mb": round(peak / 1024**2, 2),
    "tracemalloc_scope": "Python allocations; not total process RSS",
    "processed_before_reset": before,
    "sample_cap": MAX_SAMPLES,
    "bounded_maxima": maxima,
    "training_jobs": len(jobs),
    "promotions": sum(j["state"] == "promoted" for j in jobs),
    "rejections": sum(j["state"] == "rejected" for j in jobs),
    "jobs": jobs,
    "rollback": True,
    "post_cap_advance_12_times": True,
    "reset_12_times": True,
    "scope": "Mac native CPU; entirely synthetic; not G520/Linux/device performance",
}
Path("docs/lifecycle-longrun.json").write_text(json.dumps(result, indent=2))
print(json.dumps({k: v for k, v in result.items() if k != "jobs"}, indent=2))
