"""Bounded CPU monitoring + chronological model selection. No annotation labels enter training."""

from collections import deque
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import copy
import hashlib
import threading
import time
import uuid
import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.covariance import ShrunkCovariance

WINDOW = 128
REFERENCE = 512
PERIOD = 64
HZ = 20
MAX_POINTS = 1536
MAX_ELIGIBLE = 1536
MAX_WINDOWS = 120
MAX_EVENTS = 60
MAX_HISTORY = 24
MAX_VERSIONS = 6
MAX_SAMPLES = 100_000
MIN_TRAIN = 768
DRIFT_THRESHOLD = 1.5
PERSIST = 3
COOLDOWN = 8
ENVELOPE = np.array([0.28, 4.0, 1.4])


def now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def digest(x):
    return hashlib.sha256(np.ascontiguousarray(x).tobytes()).hexdigest()[:16]


def signal(seed, start, count):
    """Index-seeded noise makes batching irrelevant; labels are display-only oracle annotations."""
    t = np.arange(start, start + count)
    noise = np.array(
        [
            np.random.default_rng(np.random.SeedSequence([seed, int(i)])).normal(size=3)
            for i in t
        ]
    )
    # Periodic operating regimes; first transition is deliberately small and within approved envelope.
    targets = [0.12, 0.0, 0.18, 0.42, 0.0]
    shift = np.zeros(count)
    for j, i in enumerate(t):
        if i >= 1536:
            stage = (int(i) - 1536) // 2048
            current = targets[stage % len(targets)]
            previous = 0.0 if stage == 0 else targets[(stage - 1) % len(targets)]
            phase = (int(i) - 1536) % 2048
            shift[j] = previous + (current - previous) * min(1.0, phase / 384)
    power = (
        2
        + 0.22 * np.sin(2 * np.pi * t / PERIOD)
        + 0.06 * np.sin(4 * np.pi * t / PERIOD)
        + 0.03 * noise[:, 0]
        + shift
    )
    volts = 230 + 0.32 * np.sin(2 * np.pi * t / 256) + 0.15 * noise[:, 1]
    amps = power * 4.35 + 0.045 * noise[:, 2]
    rows = np.column_stack([power, volts, amps])
    annotations = [""] * count
    for j, i in enumerate(t):
        if i >= 1536 and (int(i) - 1536) % 2048 < 384:
            annotations[j] = "合成工況漂移"
        if i >= REFERENCE and int(i) % 1024 in (600, 601, 602):
            rows[j, [0, 2]] += [1.2, 5.22]
            annotations[j] = "合成尖峰"
        if i >= REFERENCE and 880 <= int(i) % 2048 < 888:
            rows[j, 0] = np.nan
            annotations[j] = "合成缺值"
    return rows, annotations


class Detector:
    def __init__(self, name, scale):
        self.name = name
        self.scale = scale.copy()
        self.threshold = 1.0

    def fit(self, train, calibration):
        x = train / self.scale
        if self.name.startswith("IF"):
            self.estimator = IsolationForest(
                n_estimators=int(self.name[2:]),
                max_samples=min(256, len(x)),
                random_state=520,
                n_jobs=1,
            ).fit(x)
        else:
            self.estimator = ShrunkCovariance(shrinkage=0.15).fit(x)
        self.threshold = max(float(np.quantile(self.raw(calibration), 0.98)), 1e-6)
        return self

    def raw(self, x):
        y = x / self.scale
        return (
            -self.estimator.score_samples(y)
            if self.name.startswith("IF")
            else self.estimator.mahalanobis(y)
        )

    def score(self, x):
        return self.raw(x) / self.threshold


def probes(x):
    # Known synthetic challenge labels are evaluator-only, never supplied to fit or calibration.
    offsets = [
        np.array([0.6, 0, 2.61]),
        np.array([-0.6, 0, -2.61]),
        np.array([0.32, 0, 1.392]),
        np.array([0, 0, 1.8]),
    ]
    return np.concatenate([x + offset for offset in offsets])


def evaluate(model, current, anchor):
    return {
        "current_alert_rate": float(np.mean(model.score(current) > 1)),
        "anchor_alert_rate": float(np.mean(model.score(anchor) > 1)),
        "synthetic_recall": float(np.mean(model.score(probes(current)) > 1)),
        "unsafe_drift_recall": float(
            np.mean(model.score(anchor + np.array([0.42, 0, 1.827])) > 1)
        ),
    }


class Lifecycle:
    def __init__(self, seed=520):
        self.lock = threading.RLock()
        self.seed = int(seed)
        self.revision = 0
        self.generation = 0
        self._initialize()

    def _initialize(self):
        raw, _ = signal(self.seed, 0, REFERENCE)
        self.template = np.array(
            [
                np.median(raw[:256][np.arange(256) % PERIOD == p], axis=0)
                for p in range(PERIOD)
            ]
        )
        residual = raw - self.template[np.arange(REFERENCE) % PERIOD]
        self.base = np.median(residual[:256], axis=0)
        self.scale = np.maximum(
            1.4826 * np.median(abs(residual[:256] - self.base), axis=0),
            [0.03, 0.2, 0.12],
        )
        self.anchor = residual.copy()
        self.active_ref = np.median(residual[:256], axis=0)
        model = Detector("IF64", self.scale).fit(residual[:256], residual[256:384])
        self.active = "v1"
        self.models = {"v1": model}
        self.stack = ["v1"]
        self.version_number = 1
        initial = {
            "version": "v1",
            "created_at": now(),
            "method": "重新 fit / IsolationForest 64",
            "samples": 256,
            "window": [0, 255],
            "threshold": model.threshold,
            "activation_at": REFERENCE,
            "metrics": evaluate(model, residual[384:], residual[384:]),
            "data_sha": digest(residual[:256]),
        }
        self.versions = deque([initial], maxlen=MAX_HISTORY)
        self.points = deque(maxlen=MAX_POINTS)
        self.window_history = deque(maxlen=MAX_WINDOWS)
        self.events = deque(maxlen=MAX_EVENTS)
        self.history = deque(maxlen=MAX_HISTORY)
        self.eligible = deque(maxlen=MAX_ELIGIBLE)
        self.total = REFERENCE
        self.windows = 0
        self.drift_streak = 0
        self.last_attempt = -COOLDOWN
        self.training_enabled = True
        self.state = "collecting"
        self.progress = 0
        self.last_job = None
        self.job_pending = False
        self.rejected_signature = None
        self.manual = []
        self.last_window_features = residual[-256:]
        self.last_reason = "收集已核准邊界內的完整窗口"
        self.source_exhausted = False

    def reset(self, expected):
        with self.lock:
            self._expect(expected)
            rev = self.revision + 1
            self.generation += 1
            self._initialize()
            self.revision = rev
            return self.snapshot()

    def _expect(self, expected):
        if expected != self.revision:
            raise ValueError("STALE_REVISION")

    def configure(self, expected, enabled):
        with self.lock:
            self._expect(expected)
            self.training_enabled = bool(enabled)
            self.revision += 1
            if not enabled and not self.job_pending:
                self.state = "frozen"
            if not enabled:
                self.last_reason = "自動再訓練已凍結；監測與固定安全邊界繼續"
            return self.snapshot()

    def inject(self, expected, kind):
        with self.lock:
            self._expect(expected)
            if kind not in ("spike", "drift", "missing"):
                raise ValueError("未知合成事件")
            self.manual.append({"kind": kind, "at": self.total})
            self.manual = self.manual[-12:]
            self.revision += 1
            return self.snapshot()

    def rollback(self, expected):
        with self.lock:
            self._expect(expected)
            if len(self.stack) < 2:
                raise ValueError("目前沒有可回退版本")
            previous = self.active
            self.stack.pop()
            self.active = self.stack[-1]
            self.active_ref = (
                np.array(
                    next(
                        v["reference_center"]
                        for v in self.versions
                        if v["version"] == self.active
                    )
                )
                if self.active != "v1"
                else np.median(self.anchor[:256], axis=0)
            )
            self.training_enabled = False
            self.generation += 1
            self.job_pending = False
            self.state = "rolled_back"
            self.last_attempt = self.windows
            self.last_reason = "已回退並凍結自動訓練"
            self.history.append(
                {
                    "at": now(),
                    "state": "rolled_back",
                    "from": previous,
                    "to": self.active,
                    "sample": self.total,
                }
            )
            self.revision += 1
            return self.snapshot()

    def advance(self, expected, windows=1):
        with self.lock:
            self._expect(expected)
            if not 1 <= windows <= 4:
                raise ValueError("每次最多 4 個窗口")
            job = None
            for _ in range(windows):
                if self.total + WINDOW > MAX_SAMPLES:
                    self.source_exhausted = True
                    self.last_reason = "本次樣本上限已達，請重設"
                    break
                raw, annotations = signal(self.seed, self.total, WINDOW)
                indices = np.arange(self.total, self.total + WINDOW)
                for event in self.manual:
                    active = (indices >= event["at"]) & (
                        indices < event["at"] + (1 if event["kind"] == "spike" else 128)
                    )
                    if event["kind"] == "spike":
                        raw[active, 0] += 1.2
                        raw[active, 2] += 5.22
                    elif event["kind"] == "missing":
                        raw[active, 0] = np.nan
                    else:
                        raw[active, 0] += 0.35
                        raw[active, 2] += 1.5225
                    for j in np.flatnonzero(active):
                        annotations[j] = "手動合成" + event["kind"]
                self.manual = [
                    e for e in self.manual if e["at"] + 128 > self.total + WINDOW
                ]
                valid = np.isfinite(raw).all(axis=1)
                filled = np.where(
                    np.isfinite(raw), raw, self.template[indices % PERIOD]
                )
                features = filled - self.template[indices % PERIOD]
                fixed = np.max(abs(features - self.base) / self.scale, axis=1) / 4
                # All samples in this completed window score under the old active model before any fit.
                active_version = self.active
                model_score = self.models[active_version].score(features)
                safety = np.any(abs(features - self.base) > ENVELOPE, axis=1)
                quality = ~valid
                alerts = (model_score > 1) | safety | quality
                median = (
                    np.median(features[valid], axis=0)
                    if valid.any()
                    else self.active_ref.copy()
                )
                drift = float(np.max(abs(median - self.active_ref) / self.scale))
                immutable_drift = float(np.max(abs(median - self.base) / self.scale))
                self.drift_streak = (
                    self.drift_streak + 1 if drift > DRIFT_THRESHOLD else 0
                )
                spread = (
                    np.maximum(
                        1.4826 * np.median(abs(features[valid] - median), axis=0),
                        self.scale,
                    )
                    if valid.any()
                    else self.scale
                )
                # Curation is after scoring a completed window, independent of annotations and ML alert labels.
                admissible = (
                    valid
                    & ~safety
                    & np.all(abs(features - median) < 4 * spread, axis=1)
                )
                for j in np.flatnonzero(admissible):
                    self.eligible.append((int(indices[j]), features[j].copy()))
                for j, i in enumerate(indices):
                    self.points.append(
                        {
                            "i": int(i),
                            "seconds": round(float(i / HZ), 2),
                            "power": (
                                None
                                if not valid[j] and not np.isfinite(raw[j, 0])
                                else float(raw[j, 0])
                            ),
                            "voltage": float(raw[j, 1]),
                            "current": float(raw[j, 2]),
                            "fixed": float(fixed[j]),
                            "score": float(model_score[j]),
                            "alert": bool(alerts[j]),
                            "guard": bool(safety[j]),
                            "missing": bool(quality[j]),
                            "annotation": annotations[j],
                            "version": active_version,
                        }
                    )
                if alerts.any() or (fixed > 1).any():
                    self.events.append(
                        {
                            "start": int(indices[0]),
                            "end": int(indices[-1]),
                            "alerts": int(alerts.sum()),
                            "baseline_alerts": int(np.sum(fixed > 1)),
                            "quality": int(quality.sum()),
                            "guard": int(safety.sum()),
                            "max_score": float(model_score.max()),
                            "version": active_version,
                            "annotation": ", ".join(
                                sorted(set(a for a in annotations if a))
                            )
                            or "無合成真值標記；以分數判讀",
                        }
                    )
                self.total += WINDOW
                self.windows += 1
                self.last_window_features = features[valid].copy()
                self.window_history.append(
                    {
                        "window": self.windows,
                        "end": self.total,
                        "drift": drift,
                        "immutable_drift": immutable_drift,
                        "alert_rate": float(alerts.mean()),
                        "fixed_alert_rate": float(np.mean(fixed > 1)),
                        "admissible": int(admissible.sum()),
                        "median": float(median[0]),
                        "version": active_version,
                    }
                )
                if not self.job_pending:
                    prepared = self._prepare(float(admissible.mean()), median)
                    if prepared is not None:
                        job = prepared
            self.revision += 1
            return self.snapshot(), job

    def _prepare(self, admissible_rate, median):
        cooldown = max(0, COOLDOWN - (self.windows - self.last_attempt))
        recent = [row for row in self.eligible if row[0] >= self.total - 12 * WINDOW]
        if not self.training_enabled:
            self.state = "frozen"
            self.last_reason = "訓練凍結；仍持續收集與警示"
            return None
        if admissible_rate < 0.6:
            self.state = "blocked"
            self.last_reason = "超出核准邊界或缺值過多，禁止用此窗訓練"
            return None
        if len(recent) < MIN_TRAIN:
            self.state = "collecting"
            self.last_reason = f"合格樣本 {len(recent)} / {MIN_TRAIN}"
            return None
        if self.drift_streak < PERSIST:
            self.state = "monitoring"
            self.last_reason = f"漂移需持續 {PERSIST} 窗；目前 {self.drift_streak}"
            return None
        if cooldown:
            self.state = "cooldown"
            self.last_reason = f"冷卻剩餘 {cooldown} 窗"
            return None
        signature = tuple(np.round(median / self.scale).astype(int))
        if signature == self.rejected_signature:
            self.state = "rejected"
            self.last_reason = "此分布已拒絕，等待明顯改變後才重試"
            return None
        ids = np.array([i for i, _ in recent])
        x = np.array([x for _, x in recent])
        n = len(x)
        a = int(n * 0.5)
        b = int(n * 0.7)
        c = int(n * 0.85)
        job = {
            "generation": self.generation,
            "at": self.total,
            "window": self.windows,
            "ids": ids,
            "data": x,
            "cuts": (a, b, c),
            "signature": signature,
            "active": self.active,
            "active_model": self.models[self.active],
            "anchor": self.anchor.copy(),
            "scale": self.scale.copy(),
            "reference_center": np.median(x[:a], axis=0),
            "started": now(),
            "id": uuid.uuid4().hex[:8],
        }
        self.job_pending = True
        self.last_attempt = self.windows
        self.state = "queued"
        self.progress = 0
        self.last_reason = "已滿足樣本、持續漂移與冷卻條件，等待 CPU 訓練"
        self.last_job = {
            "id": job["id"],
            "state": "queued",
            "requested_at": job["started"],
            "data_window": [int(ids[0]), int(ids[-1])],
            "samples": n,
            "candidates": [],
            "splits": {
                name: {
                    "start": int(ids[start]),
                    "end": int(ids[stop - 1]),
                    "count": stop - start,
                }
                for name, start, stop in [
                    ("train", 0, a),
                    ("calibration", a, b),
                    ("selection", b, c),
                    ("test", c, n),
                ]
            },
            "method": "重新 fit；非 transfer learning / 非 TTT",
        }
        return job

    def run_job(self, job):
        started = time.perf_counter()
        x = job["data"]
        a, b, c = job["cuts"]
        table = []
        models = []
        with self.lock:
            if job["generation"] != self.generation:
                return
            self.state = "training"
            self.last_job["state"] = "training"
            self.last_job["training_started_at"] = now()
            self.last_reason = "CPU 正在 fit 候選模型（無假進度或延遲）"
        try:
            anchor = job["anchor"]
            scale = job["scale"]
            train = np.concatenate([anchor[:256], x[:a]])
            calibration = np.concatenate([anchor[256:384], x[a:b]])
            for name in ("IF48", "IF96", "Covariance"):
                t = time.perf_counter()
                model = Detector(name, scale).fit(train, calibration)
                metrics = evaluate(model, x[b:c], anchor[384:448])
                loss = (
                    metrics["current_alert_rate"]
                    + metrics["anchor_alert_rate"]
                    + 2 * (1 - metrics["synthetic_recall"])
                )
                table.append(
                    {
                        "name": name,
                        "selection": metrics,
                        "objective": round(loss, 5),
                        "fit_ms": round((time.perf_counter() - t) * 1000, 2),
                    }
                )
                models.append(model)
                with self.lock:
                    if job["generation"] != self.generation:
                        return
                    self.progress = len(table)
                    self.last_job["candidates"] = list(table)
            winner = int(np.argmin([r["objective"] for r in table]))
            model = models[winner]
            test = evaluate(model, x[c:], anchor[448:])
            old = evaluate(job["active_model"], x[c:], anchor[448:])
            reasons = []
            if test["current_alert_rate"] > 0.12:
                reasons.append("留出工況警報率 >12%")
            if test["anchor_alert_rate"] > 0.12:
                reasons.append("舊參考警報率 >12%")
            if test["synthetic_recall"] < 0.92:
                reasons.append("合成挑戰覆蓋 <92%")
            if test["unsafe_drift_recall"] < 0.9:
                reasons.append("大偏移保留率 <90%，可能掩蓋異常")
            if old["current_alert_rate"] - test["current_alert_rate"] < 0.05:
                reasons.append("較 active 的工況警報率改善未達 5 個百分點")
            accepted = not reasons
            with self.lock:
                if job["generation"] != self.generation:
                    return
                if not self.training_enabled:
                    reasons.append("操作員已凍結，保留原模型")
                    accepted = False
                if (
                    self.window_history
                    and self.window_history[-1]["admissible"] < 0.6 * WINDOW
                ):
                    reasons.append("目前窗口已超界或品質不足，候選不啟用")
                    accepted = False
                if self.windows - job["window"] > 12:
                    reasons.append("候選資料已過期超過 12 窗，保留原模型")
                    accepted = False
                self.last_job.update(
                    state="promoted" if accepted else "rejected",
                    finished_at=now(),
                    duration_ms=round((time.perf_counter() - started) * 1000, 2),
                    winner=table[winner]["name"],
                    test=test,
                    active_test=old,
                    reasons=reasons,
                    data_sha=digest(x),
                    train_sha=digest(train),
                    reference_rehearsal=256,
                    challenge_source="僅驗收用的明確合成偏移/尖峰；未進入 fit 或 calibration",
                    gate={
                        "current_alert_max": 0.12,
                        "anchor_alert_max": 0.12,
                        "synthetic_recall_min": 0.92,
                        "unsafe_drift_recall_min": 0.9,
                        "improvement_min": 0.05,
                    },
                )
                if accepted:
                    self.version_number += 1
                    version = f"v{self.version_number}"
                    self.last_job["promoted_version"] = version
                    self.active = version
                    self.models[version] = model
                    self.stack.append(version)
                    self.stack = self.stack[-MAX_VERSIONS:]
                    self.active_ref = job["reference_center"].copy()
                    self.versions.append(
                        {
                            "version": version,
                            "created_at": now(),
                            "method": "重新 fit / " + model.name,
                            "samples": len(train),
                            "window": [int(job["ids"][0]), int(job["ids"][a - 1])],
                            "threshold": model.threshold,
                            "activation_at": self.total,
                            "metrics": test,
                            "data_sha": digest(train),
                            "reference_center": self.active_ref.tolist(),
                            "job_id": job["id"],
                        }
                    )
                    keep = set(self.stack) | {self.active}
                    self.models = {k: v for k, v in self.models.items() if k in keep}
                    self.drift_streak = 0
                    self.rejected_signature = None
                    self.last_reason = (
                        "最終時間留出與舊參考/合成挑戰均通過，已 promotion"
                    )
                else:
                    self.rejected_signature = job["signature"]
                    self.last_reason = "候選拒絕：" + "；".join(reasons)
                self.last_attempt = self.windows
                self.state = "promoted" if accepted else "rejected"
                self.history.append(dict(self.last_job))
                self.job_pending = False
                self.revision += 1
        except Exception as error:
            with self.lock:
                if job["generation"] == self.generation:
                    self.state = "rejected"
                    self.job_pending = False
                    self.last_reason = "真實訓練失敗：" + str(error)
                    self.last_job.update(
                        state="rejected", finished_at=now(), reasons=[str(error)]
                    )
                    self.history.append(dict(self.last_job))
                    self.revision += 1

    def snapshot(self):
        with self.lock:
            bins = np.linspace(-0.5, 0.7, 25)
            reference = self.anchor[:, 0]
            current = (
                self.last_window_features[:, 0]
                if len(self.last_window_features)
                else np.array([])
            )

            def histogram(a):
                return np.histogram(
                    np.clip(a, bins[0] + 1e-8, bins[-1] - 1e-8), bins=bins
                )[0].tolist()

            last = (
                self.window_history[-1]
                if self.window_history
                else {
                    "drift": 0,
                    "immutable_drift": 0,
                    "admissible": 0,
                    "alert_rate": 0,
                }
            )
            return {
                "revision": self.revision,
                "seed": self.seed,
                "sample_hz": HZ,
                "window_size": WINDOW,
                "total": self.total,
                "windows": self.windows,
                "seconds": round(self.total / HZ, 1),
                "active": self.active,
                "state": self.state,
                "reason": self.last_reason,
                "training_enabled": self.training_enabled,
                "progress": self.progress,
                "job_pending": self.job_pending,
                "can_rollback": len(self.stack) > 1,
                "exhausted": self.source_exhausted,
                "drift": last["drift"],
                "immutable_drift": last["immutable_drift"],
                "drift_threshold": DRIFT_THRESHOLD,
                "streak": self.drift_streak,
                "persist_required": PERSIST,
                "eligible": len(
                    [r for r in self.eligible if r[0] >= self.total - 12 * WINDOW]
                ),
                "min_train": MIN_TRAIN,
                "cooldown": max(0, COOLDOWN - (self.windows - self.last_attempt)),
                "points": list(self.points),
                "windows_history": list(self.window_history),
                "events": list(self.events)[-24:],
                "versions": [
                    {**v, "retained": v["version"] in self.models}
                    for v in self.versions
                ],
                "training_history": copy.deepcopy(list(self.history)),
                "candidate": copy.deepcopy(self.last_job),
                "histogram": {
                    "edges": bins.tolist(),
                    "reference": histogram(reference),
                    "current": histogram(current),
                    "reference_n": len(reference),
                    "current_n": len(current),
                    "outside": int(np.sum((current < bins[0]) | (current > bins[-1]))),
                },
                "limits": {
                    "points": MAX_POINTS,
                    "eligible": MAX_ELIGIBLE,
                    "history": MAX_HISTORY,
                    "versions": MAX_VERSIONS,
                    "samples": MAX_SAMPLES,
                },
                "guard": {"power_kw": 0.28, "voltage_v": 4, "current_a": 1.4},
                "method_note": "固定參考去週期 → 殘差模型；線上收集與漂移觸發重新 fit，非 TTT、非舊權重 transfer learning",
            }


class Sessions:
    def __init__(self):
        self.items = {}
        self.lock = threading.Lock()
        self.executor = ThreadPoolExecutor(
            max_workers=1, thread_name_prefix="signal-cpu"
        )

    def create(self, seed):
        with self.lock:
            stale = [
                key
                for key, (engine, seen) in self.items.items()
                if time.monotonic() - seen > 1800
            ]
            for key in stale:
                self.items[key][0].generation += 1
                del self.items[key]
            if len(self.items) >= 8:
                raise ValueError("最多 8 個工作階段；請重用或稍後再試")
            key = uuid.uuid4().hex
            engine = Lifecycle(seed)
            self.items[key] = (engine, time.monotonic())
            return key, engine

    def release(self, key):
        with self.lock:
            item = self.items.pop(key, None)
            if item:
                item[0].generation += 1

    def get(self, key):
        with self.lock:
            if key not in self.items:
                raise KeyError("工作階段不存在或逾時")
            engine, _ = self.items[key]
            self.items[key] = (engine, time.monotonic())
            return engine
