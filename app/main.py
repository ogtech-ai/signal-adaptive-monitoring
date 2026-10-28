import csv, io, json, platform, hashlib
from pathlib import Path
import sklearn
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from app.core import Monitor, synthetic, validate

app = FastAPI(title="Signal Adaptive Monitoring")
app.mount("/static", StaticFiles(directory="app/static"), name="static")


@app.get("/")
def index():
    return FileResponse("app/static/index.html")


@app.get("/api/data")
def data(source: str = "synthetic"):
    if source == "uci":
        p = Path("data/uci_slice.json")
        if not p.exists():
            raise HTTPException(404, "UCI 尚未下載；請執行 scripts/download_uci.py")
        return json.loads(p.read_text())
    return dict(
        rows=synthetic(),
        source="全合成 / seed 520 / 1 分鐘",
        channels=["功率 kW", "電壓 V", "電流 A"],
        device="synthetic-01",
    )


class Run(BaseModel):
    rows: list
    start: int = 0
    end: int = 180
    approve: bool = False
    freeze: bool = True
    rollback_at: int = -1
    actions: list[dict] = []


@app.post("/api/run")
def run(r: Run):
    try:
        model = Monitor(r.rows, r.start, r.end)
        model.frozen = False if r.rollback_at >= 0 else r.freeze
        result = []
        approved = r.approve
        actions = {}
        for action in r.actions:
            at = int(action.get("at", -1))
            if at < r.end or at >= len(r.rows):
                raise ValueError("控制事件必須在測試區間")
            actions.setdefault(at, []).append(action)
        for i, row in enumerate(r.rows):
            if i < r.end:
                result.append(None)
                continue
            for action in actions.get(i, []):
                if "frozen" in action:
                    model.frozen = bool(action["frozen"])
                if "approved" in action:
                    approved = bool(action["approved"])
                if action.get("rollback"):
                    model.rollback()
            if i == r.rollback_at:
                model.rollback()
            result.append(model.score(row, approved))
        return dict(
            scores=result,
            model=dict(
                name="median/MAD + IsolationForest",
                implementation="1.0.0",
                reference_sha256=hashlib.sha256(
                    json.dumps(r.rows[r.start : r.end], sort_keys=True).encode()
                ).hexdigest(),
                seed=520,
                trees=64,
                reference=[r.start, r.end],
                center=model.center.tolist(),
                baseline=model.base.tolist(),
                scale=model.scale.tolist(),
                ml_threshold=model.ml_threshold,
                version=model.version,
                sklearn=sklearn.__version__,
                python=platform.python_version(),
                adaptation="受控基準校正；非 TTT",
                scope="單一來源/設備；未跨設備驗證",
            ),
        )
    except (ValueError, TypeError) as e:
        raise HTTPException(422, str(e))


# Minimal in-memory MLOps demo. Existing UCI and replay adapters remain available.
from app.lifecycle import Sessions
from pydantic import Field

sessions = Sessions()


class NewSession(BaseModel):
    seed: int = Field(default=520, ge=0, le=2**32 - 1)


class Command(BaseModel):
    session_id: str
    expected_revision: int = Field(ge=0)
    windows: int = Field(default=1, ge=1, le=4)
    enabled: bool = True
    kind: str = "spike"


def lifecycle_result(key, engine):
    return dict(session_id=key, **engine.snapshot())


@app.post("/api/lifecycle/create")
def lifecycle_create(r: NewSession):
    try:
        key, engine = sessions.create(r.seed)
        return lifecycle_result(key, engine)
    except ValueError as error:
        raise HTTPException(429, str(error))


@app.get("/api/lifecycle/{key}")
def lifecycle_state(key: str):
    try:
        return lifecycle_result(key, sessions.get(key))
    except KeyError as error:
        raise HTTPException(404, str(error))


@app.post("/api/lifecycle/{action}")
def lifecycle_command(action: str, r: Command):
    try:
        if action == "release":
            sessions.release(r.session_id)
            return {"released": True}
        engine = sessions.get(r.session_id)
        if action == "advance":
            result, job = engine.advance(r.expected_revision, r.windows)
            if job is not None:
                sessions.executor.submit(engine.run_job, job)
        elif action == "reset":
            result = engine.reset(r.expected_revision)
        elif action == "configure":
            result = engine.configure(r.expected_revision, r.enabled)
        elif action == "rollback":
            result = engine.rollback(r.expected_revision)
        elif action == "inject":
            result = engine.inject(r.expected_revision, r.kind)
        else:
            raise ValueError("未知動作")
        return dict(session_id=r.session_id, **result)
    except KeyError as error:
        raise HTTPException(404, str(error))
    except ValueError as error:
        if str(error) == "STALE_REVISION":
            raise HTTPException(
                409,
                detail=dict(
                    reason="過期或重複操作，已保留目前狀態",
                    state=lifecycle_result(r.session_id, engine),
                ),
            )
        raise HTTPException(422, str(error))
