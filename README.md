# Signal Adaptive Monitoring

A CPU-based continuous-signal and model-lifecycle demonstration with a Traditional Chinese interface: streaming windows, distribution drift, bounded candidate fitting, chronological validation, promotion, rejection, rollback and export.

The primary stream is synthetic 20 Hz power/voltage/current data with seed 520. It is not a physical recorder connection, a G520 benchmark, fault diagnosis, test-time training, or transfer learning. Candidates are actually fitted; acceptance results are computed rather than scripted.

## Quick start

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.lock
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8011 --workers 1
# Alternative:
docker compose up --build -d
```

Open http://127.0.0.1:8011. Use **one Uvicorn worker** because sessions live in process memory. Compose runs non-root, binds loopback and limits the service to 2 CPUs and 1 GiB RAM. These are starting allocations, not target-hardware performance guarantees. No external fonts, CDN or remote model is required. Public deployments need managed HTTPS and resource/request controls.

## Configuration and CPU deployment

Python 3.12; no GPU, paid API, API key, or application secret is required. The application does not load `.env`; `.env.example` documents this explicitly. Do not put credentials or personal records in this repository.

## Three-minute workflow

1. The page builds reference v1 and continuously collects 128-sample windows, each representing 6.4 simulated seconds. Playback at 1 or 4 windows per second is accelerated simulation, not a wall-clock acquisition claim.
2. Observe injected spikes, missing values and changing operating regimes. Eligibility, sustained drift, cooldown and blocking reasons explain when training can start.
3. Review real fit duration, candidate metrics and acceptance decisions. Transitional candidates may be rejected; later candidates may be promoted.
4. Compare drift against the active reference and immutable initial reference. The original safety boundary remains independent of the adapted model.
5. Roll back to a saved model to freeze automatic training, export bounded samples and metadata, or reset the experiment.

## Model evaluation and limits

Windows are scored before their data can train a future model; historical scores are not rewritten. Three candidates use IsolationForest (48/96 trees) or ShrunkCovariance. Recent eligible samples are split chronologically: 50% fit, 20% calibration, 15% selection, 15% final test, with a fixed early-reference rehearsal set. Preprocessing does not fit on held-out samples. A selected candidate must pass final checks before promotion.

Acceptance considers current-regime and old-reference alarm rates, explicitly synthetic challenge coverage and improvement over the active model. Challenge probes are not real equipment fault labels and do not enter fitting or calibration. Reduced alarms alone do not establish better safety. Real deployment needs device specifications, representative data and independent fault validation. See [validation](docs/VALIDATION.md) and [long-run evidence](docs/lifecycle-longrun.json).

Training runs in a bounded CPU worker. Sessions retain at most 1,536 signal points, 1,536 eligible samples, 120 trend windows, 60 alert windows, 24 history events and 6 models. Experiments stop at the last complete window before 100,000 samples. At most 8 sessions are retained, with 30-minute inactivity expiry. Revision checks reject stale actions; reset/rollback invalidate old jobs, and freezing during fit prevents promotion.

State is ephemeral: no persistent model registry or pickle export. Exports contain seed, policy, bounded samples and metadata. Signal generation is reproducible by seed; asynchronous promotion timing is recorded rather than claimed deterministic.

## Tests

```sh
.venv/bin/python -m pytest -q
.venv/bin/python -m scripts.validate_lifecycle
# Optional UI check after providing Playwright/Chrome and starting the API:
PLAYWRIGHT_MODULE=/path/to/node_modules/playwright node scripts/ui-lifecycle.cjs
```

The recorded long run covers 99,968 samples, promotion/rejection, rollback, reset and capacity bounds. Python allocation measurements are not total RSS or recorder/Linux performance. [Migration](docs/MIGRATION.md) explains source packaging and deployment boundaries.

## Sources and licenses

Project code is [MIT](LICENSE). The main lifecycle stream is generated locally with NumPy. A separate legacy replay adapter includes a chronological 1,440-row slice of Georges Hebrail and Alice Berard's (2006) [Individual Household Electric Power Consumption](https://archive.ics.uci.edu/dataset/235/individual+household+electric+power+consumption), [DOI 10.24432/C58K54](https://doi.org/10.24432/C58K54), under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). [Attribution and transformations](data/ATTRIBUTION.md) document selected channels, missing-value conversion and timestamps. These are household readings with no fault labels, not industrial recorder measurements. The source archive cache is excluded from Git. Dependencies retain their own distribution licenses. No customer data, API credentials or large model weights are included.
