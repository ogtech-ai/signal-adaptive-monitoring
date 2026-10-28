import numpy as np
import pytest
from concurrent.futures import ThreadPoolExecutor
from fastapi.testclient import TestClient
import app.lifecycle as lc
from app.main import app


def next_job(engine, limit=80):
    for _ in range(limit):
        _, job = engine.advance(engine.revision)
        if job:
            return job
    raise AssertionError("no genuine drift trigger")


def promoted(engine):
    for _ in range(80):
        _, job = engine.advance(engine.revision)
        if job:
            engine.run_job(job)
            if engine.state == "promoted":
                return
    raise AssertionError("no accepted candidate")


def test_seed_batching_and_training_only_preprocessing(monkeypatch):
    a, _ = lc.signal(520, 0, 1024)
    b, _ = lc.signal(520, 0, 512)
    c, _ = lc.signal(520, 512, 512)
    assert np.allclose(a, np.concatenate([b, c]), equal_nan=True)
    first = lc.Lifecycle()
    original = lc.signal

    def changed(seed, start, count):
        raw, labels = original(seed, start, count)
        if start == 0:
            raw[256:] += 2
        return raw, labels

    monkeypatch.setattr(lc, "signal", changed)
    second = lc.Lifecycle()
    assert np.array_equal(first.template, second.template)
    assert np.array_equal(first.scale, second.scale)
    assert np.array_equal(
        first.models["v1"].estimator.estimators_[0].tree_.threshold,
        second.models["v1"].estimator.estimators_[0].tree_.threshold,
    )


def test_minimum_persistence_time_split_and_no_label_leak(monkeypatch):
    a = lc.Lifecycle()
    job = next_job(a)
    assert len(job["data"]) >= lc.MIN_TRAIN and a.drift_streak >= lc.PERSIST
    i = job["ids"]
    x, y, z = job["cuts"]
    assert i[x - 1] < i[x] <= i[y - 1] < i[y] <= i[z - 1] < i[z]
    assert np.all(np.abs(job["data"] - a.base) <= lc.ENVELOPE)
    original = lc.signal

    def fake_labels(seed, start, count):
        raw, _ = original(seed, start, count)
        return raw, ["FAKE healthy/fault truth"] * count

    monkeypatch.setattr(lc, "signal", fake_labels)
    b = lc.Lifecycle()
    other = next_job(b)
    assert np.array_equal(job["data"], other["data"])
    assert np.array_equal(job["ids"], other["ids"])
    a.run_job(job)
    b.run_job(other)
    assert a.last_job["winner"] == b.last_job["winner"]
    assert a.last_job["test"] == b.last_job["test"]


def test_real_promotion_score_before_update_guard_and_rollback():
    s = lc.Lifecycle()
    base = s.base.copy()
    template = s.template.copy()
    promoted(s)
    version = s.active
    activation = s.versions[-1]["activation_at"]
    assert version != "v1" and all(
        p["version"] != version for p in s.points if p["i"] < activation
    )
    assert np.array_equal(s.base, base) and np.array_equal(s.template, template)
    assert s.last_job["test"]["synthetic_recall"] >= 0.92
    assert s.last_job["test"]["unsafe_drift_recall"] >= 0.9
    s.advance(s.revision)
    assert s.points[-1]["version"] == version
    result = s.rollback(s.revision)
    assert result["active"] == "v1" and not result["training_enabled"]
    with pytest.raises(ValueError):
        s.rollback(s.revision)


def test_freeze_reset_cancel_pending_results_and_cooldown():
    s = lc.Lifecycle()
    job = next_job(s)
    active = s.active
    s.configure(s.revision, False)
    s.run_job(job)
    assert s.active == active and s.state == "rejected"
    assert s.snapshot()["cooldown"] == lc.COOLDOWN
    t = lc.Lifecycle()
    job = next_job(t)
    result = t.reset(t.revision)
    rev = t.revision
    t.run_job(job)
    assert t.active == "v1" and not t.history and t.revision == rev
    assert result["total"] == lc.REFERENCE


def test_duplicate_revision_and_api_release():
    s = lc.Lifecycle()

    def advance():
        try:
            s.advance(0)
            return True
        except ValueError:
            return False

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sum(pool.map(lambda _: advance(), range(2))) == 1
    assert s.total == lc.REFERENCE + lc.WINDOW
    c = TestClient(app)
    r = c.post("/api/lifecycle/create", json={"seed": 520})
    assert r.status_code == 200
    state = r.json()
    payload = {
        "session_id": state["session_id"],
        "expected_revision": state["revision"],
    }
    assert c.post("/api/lifecycle/advance", json=payload).status_code == 200
    assert c.post("/api/lifecycle/advance", json=payload).status_code == 409
    assert (
        c.post("/api/lifecycle/advance", json={**payload, "windows": 100}).status_code
        == 422
    )
    assert c.post("/api/lifecycle/release", json=payload).status_code == 200
    assert c.get("/api/lifecycle/" + state["session_id"]).status_code == 404


def test_histogram_integrity_and_initial_sample_gates():
    s = lc.Lifecycle()
    snapshot, job = s.advance(s.revision)
    assert job is None and s.active == "v1"
    hist = snapshot["histogram"]
    assert sum(hist["reference"]) == hist["reference_n"]
    assert sum(hist["current"]) == hist["current_n"]
    assert snapshot["eligible"] < lc.MIN_TRAIN


def test_stale_job_cannot_promote_after_current_data_turns_unsafe():
    s = lc.Lifecycle()
    job = next_job(s)
    for _ in range(14):
        s.advance(s.revision)
    active = s.active
    s.run_job(job)
    assert s.active == active and any(
        "過期" in reason for reason in s.last_job["reasons"]
    )


def test_sessions_are_bounded_and_release_is_idempotent():
    sessions = lc.Sessions()
    keys = [sessions.create(520)[0] for _ in range(8)]
    with pytest.raises(ValueError):
        sessions.create(520)
    sessions.release(keys[0])
    sessions.release(keys[0])
    sessions.create(520)
    assert len(sessions.items) == 8
    sessions.executor.shutdown(wait=True)
