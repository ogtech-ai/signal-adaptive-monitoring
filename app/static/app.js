"use strict";
const $ = (id) => document.getElementById(id),
  BLUE = "#315cdb",
  AMBER = "#cb8a24",
  GREY = "#91a1b9";
const states = {
  frozen: "訓練已凍結",
  collecting: "收集樣本",
  monitoring: "監測中",
  queued: "排程中",
  training: "訓練中",
  promoted: "已啟用",
  rejected: "候選拒絕",
  cooldown: "冷卻中",
  blocked: "邊界阻擋",
  rolled_back: "已回退",
};
let S = null,
  busy = false,
  playing = true,
  timer = null,
  poller = null,
  sessionId = null;
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const percent = (value) => (100 * (value ?? 0)).toFixed(1) + "%";
const date = (value) =>
  value ? value.replace("T", " ").slice(0, 19) + " UTC" : "—";
const clock = (seconds) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
function status(text, error = false) {
  $("status").textContent = text;
  $("status").className = "status-message" + (error ? " error" : "");
}
function controls() {
  for (const id of ["play", "step", "reset", "export", "auto-training"])
    $(id).disabled = !S || busy;
  $("rollback").disabled = !S || busy || !S.can_rollback;
  if (S?.exhausted) {
    $("play").disabled = true;
    $("step").disabled = true;
  }
  document
    .querySelectorAll("[data-inject]")
    .forEach((b) => (b.disabled = !S || busy));
  $("play").textContent = playing ? "暫停串流" : "繼續監測";
  $("stream-state").textContent = !S
    ? "初始化"
    : S.exhausted
      ? "樣本上限"
      : playing
        ? "持續流入"
        : "已暫停";
  $("stream-state").className = "badge " + (playing ? "teal" : "neutral");
}
function apply(snapshot) {
  if (S && snapshot.revision < S.revision) return;
  if (
    S &&
    snapshot.revision === S.revision &&
    snapshot.candidate?.id === S.candidate?.id &&
    snapshot.progress < S.progress
  ) {
    snapshot.progress = S.progress;
    snapshot.candidate = S.candidate;
  }
  S = snapshot;
  sessionId = S.session_id;
  draw();
  if (S.job_pending && !poller) poller = setTimeout(poll, 50);
}
async function poll() {
  poller = null;
  if (!sessionId) return;
  try {
    let r = await fetch("/api/lifecycle/" + sessionId);
    if (r.ok) apply(await r.json());
  } catch {}
  if (S?.job_pending && !poller) poller = setTimeout(poll, 50);
}
async function command(action, extra = {}, retry = true) {
  if (busy || !S) return false;
  busy = true;
  controls();
  try {
    let r = await fetch("/api/lifecycle/" + action, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        expected_revision: S.revision,
        ...extra,
      }),
    });
    let data = await r.json();
    if (r.status === 409) {
      apply(data.detail.state);
      busy = false;
      controls();
      if (action !== "advance" && retry) return command(action, extra, false);
      return false;
    }
    if (!r.ok)
      throw Error(typeof data.detail === "string" ? data.detail : "動作未完成");
    apply(data);
    return true;
  } catch (e) {
    status(e.message, true);
    return false;
  } finally {
    busy = false;
    controls();
  }
}
async function initialize() {
  status("CPU 正在建立初始參考與 v1 模型…");
  busy = true;
  controls();
  try {
    let r = await fetch("/api/lifecycle/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seed: 520 }),
    });
    let data = await r.json();
    if (!r.ok) throw Error(data.detail);
    apply(data);
    status("可重現模擬已開始。每個窗口先評分，再決定收集或訓練。");
    schedule();
  } catch (e) {
    status(e.message, true);
  } finally {
    busy = false;
    controls();
  }
}
function schedule() {
  clearTimeout(timer);
  if (playing && S && !S.exhausted) timer = setTimeout(tick, 1000);
}
async function tick() {
  if (!playing) return;
  if (!busy) await command("advance", { windows: Number($("speed").value) });
  if (S?.exhausted) playing = false;
  schedule();
  controls();
}
function path(values, width, height, min, max) {
  let active = false;
  return values
    .map((value, i) => {
      if (value === null || !Number.isFinite(value)) {
        active = false;
        return "";
      }
      const part = active ? "L" : "M";
      active = true;
      return `${part}${(47 + (i * (width - 65)) / Math.max(1, values.length - 1)).toFixed(1)},${(height - 30 - ((value - min) / (max - min || 1)) * (height - 52)).toFixed(1)}`;
    })
    .join(" ");
}
function frame(id, height, min, max, left = "", right = "") {
  const e = $(id),
    w = Math.max(240, e.clientWidth || 700);
  e.setAttribute("viewBox", `0 0 ${w} ${height}`);
  let html = "";
  for (let k = 0; k < 4; k++) {
    const value = min + ((max - min) * k) / 3,
      y = height - 30 - (k * (height - 52)) / 3;
    html += `<line x1="47" x2="${w - 18}" y1="${y}" y2="${y}" stroke="#e7edf5"/><text x="38" y="${y + 4}" text-anchor="end">${value.toFixed(1)}</text>`;
  }
  html += `<text x="47" y="${height - 6}">${esc(left)}</text><text x="${w - 18}" y="${height - 6}" text-anchor="end">${esc(right)}</text>`;
  return {
    e,
    w,
    html,
    y: (value) =>
      height - 30 - ((value - min) / (max - min || 1)) * (height - 52),
  };
}
function signalChart() {
  const p = (S?.points || []).slice(-768),
    key = $("channel").value,
    values = p.map((x) => x[key]),
    finite = values.filter(Number.isFinite);
  let min = finite.length ? Math.min(...finite) : 0,
    max = finite.length ? Math.max(...finite) : 1,
    pad = Math.max((max - min) * 0.14, 0.05);
  min = Math.max(0, min - pad);
  max += pad;
  const f = frame(
    "signal",
    280,
    min,
    max,
    p.length ? clock(p[0].seconds) : "",
    p.length ? clock(p.at(-1).seconds) : "",
  );
  let html = f.html;
  const xpos = (i) => 47 + (i * (f.w - 65)) / Math.max(1, p.length - 1);
  for (let i = 0; i < p.length; i++)
    if (p[i].alert)
      html += `<circle cx="${xpos(i)}" cy="12" r="1.4" fill="${AMBER}"/>`;
  html += `<path d="${path(values, f.w, 280, min, max)}" fill="none" stroke="${BLUE}" stroke-width="1.7"/>`;
  const labelled = values.map((v, i) => (p[i].annotation ? v : null));
  html += `<path d="${path(labelled, f.w, 280, min, max)}" fill="none" stroke="${AMBER}" stroke-width="2"/>`;
  for (const v of S?.versions || []) {
    const at = p.findIndex((x) => x.i >= v.activation_at);
    if (at > 0) {
      const x = xpos(at);
      html += `<line x1="${x}" x2="${x}" y1="20" y2="250" stroke="#a9bae4" stroke-dasharray="4 4"/><text x="${x + 5}" y="34">${esc(v.version)} 啟用</text>`;
    }
  }
  f.e.innerHTML = html;
  f.e.dataset.points = JSON.stringify(p.map((x) => x.i));
}
function histogram() {
  if (!S) return;
  const h = S.histogram,
    ref = h.reference.map((x) => (100 * x) / h.reference_n),
    cur = h.current.map((x) => (100 * x) / (h.current_n || 1)),
    max = Math.max(5, ...ref, ...cur) * 1.1,
    f = frame(
      "histogram",
      185,
      0,
      max,
      h.edges[0].toFixed(1),
      h.edges.at(-1).toFixed(1),
    ),
    step = (f.w - 65) / cur.length;
  let html = f.html;
  for (let i = 0; i < cur.length; i++) {
    const x = 47 + i * step;
    html += `<rect x="${x}" y="${f.y(ref[i])}" width="${Math.max(1, step - 1)}" height="${155 - f.y(ref[i])}" fill="#dbe5ff"/><rect x="${x + step * 0.2}" y="${f.y(cur[i])}" width="${Math.max(1, step * 0.6)}" height="${155 - f.y(cur[i])}" fill="#6488e8" opacity=".8"/>`;
  }
  f.e.innerHTML = html;
  $("histogram-count").textContent =
    `各自正規化為百分比 · 參考 ${h.reference_n} / 目前 ${h.current_n} 筆 · 超顯示範圍 ${h.outside} 筆併入邊界`;
}
function driftChart() {
  if (!S) return;
  const h = S.windows_history,
    max =
      Math.max(2.5, ...h.flatMap((x) => [x.drift, x.immutable_drift])) * 1.1,
    f = frame(
      "drift",
      145,
      0,
      max,
      h.length ? "窗 " + h[0].window : "",
      h.length ? "窗 " + h.at(-1).window : "",
    );
  f.e.innerHTML =
    f.html +
    `<line x1="47" x2="${f.w - 18}" y1="${f.y(S.drift_threshold)}" y2="${f.y(S.drift_threshold)}" stroke="${AMBER}" stroke-dasharray="4 4"/><path d="${path(
      h.map((x) => x.immutable_drift),
      f.w,
      145,
      0,
      max,
    )}" fill="none" stroke="${GREY}" stroke-width="1.5"/><path d="${path(
      h.map((x) => x.drift),
      f.w,
      145,
      0,
      max,
    )}" fill="none" stroke="${BLUE}" stroke-width="1.9"/>`;
}
function candidate() {
  const job = S?.candidate;
  $("candidate-empty").hidden = !!job;
  $("candidate-content").hidden = !job;
  $("candidate-label").textContent = job
    ? job.state === "promoted" && job.promoted_version !== S.active
      ? "已驗收／非 Active"
      : states[job.state] || job.state
    : "尚未觸發";
  $("candidate-label").className =
    "badge " +
    (job?.state === "promoted"
      ? "teal"
      : job?.state === "rejected"
        ? "amber"
        : "neutral");
  if (!job) {
    $("candidates").innerHTML = "";
    $("acceptance").textContent = "";
    $("split-details").textContent = "";
    return;
  }
  $("candidate-window").textContent =
    `${job.samples} 合格樣本 · #${job.data_window[0]}–${job.data_window[1]} · ${job.method}${job.duration_ms ? " · 實際 " + job.duration_ms + " ms" : ""}`;
  $("candidates").innerHTML = (job.candidates || [])
    .map(
      (c) =>
        `<tr class="${job.winner === c.name ? "winner" : ""}"><td><strong>${esc(c.name)}</strong><small>${c.fit_ms} ms · ${job.winner === c.name ? "選中候選" : "重新 fit"}</small></td><td>${percent(c.selection.current_alert_rate)}</td><td>${percent(c.selection.anchor_alert_rate)}</td><td>${percent(c.selection.synthetic_recall)}</td></tr>`,
    )
    .join("");
  const test = job.test;
  $("acceptance").className = "acceptance " + job.state;
  $("acceptance").textContent = test
    ? `${job.state === "promoted" ? (job.promoted_version === S.active ? "驗收通過，已啟用 " + S.active : "此候選曾通過驗收；目前 Active 為 " + S.active) : "未通過驗收，保留 active"}。最終留出：工況警報 ${percent(test.current_alert_rate)}、舊參考警報 ${percent(test.anchor_alert_rate)}、合成挑戰 ${percent(test.synthetic_recall)}、大偏移保留 ${percent(test.unsafe_drift_recall)}。${(job.reasons || []).join("；")}`
    : "真實 CPU 排程／fit 中，完成後才顯示驗收結果。";
  $("split-details").textContent = JSON.stringify(
    {
      splits: job.splits,
      gate: job.gate,
      source: job.challenge_source,
      started_at: job.training_started_at,
      finished_at: job.finished_at,
      data_sha: job.data_sha,
    },
    null,
    2,
  );
}
function histories() {
  if (!S) return;
  $("versions").innerHTML = [...S.versions]
    .reverse()
    .slice(0, 6)
    .map(
      (v) =>
        `<div class="version-item ${v.version === S.active ? "active" : ""}"><strong>${esc(v.version)} <span class="badge ${v.version === S.active ? "blue" : "neutral"}">${v.version === S.active ? "Active" : v.retained ? "模型保留" : "僅 metadata"}</span></strong><p>${esc(v.method)}<br>${esc(date(v.created_at))}<br>fit #${v.window[0]}–${v.window[1]} · ${v.samples} 筆<br>啟用於 #${v.activation_at} · 資料 ${esc(v.data_sha)}<br>留出警報 ${percent(v.metrics.current_alert_rate)} · 舊參考 ${percent(v.metrics.anchor_alert_rate)} · 合成 ${percent(v.metrics.synthetic_recall)}</p></div>`,
    )
    .join("");
  $("training-history").innerHTML =
    [...S.training_history]
      .reverse()
      .map(
        (j) =>
          `<tr><td>${esc(date(j.training_started_at || j.at))}<small>${esc(date(j.finished_at))}${j.duration_ms ? " · " + j.duration_ms + " ms" : ""}</small></td><td><span class="badge ${j.state === "promoted" ? "teal" : j.state === "rolled_back" ? "blue" : "amber"}">${esc(states[j.state] || j.state)}</span></td><td>${j.data_window ? "#" + j.data_window.join("–") : (j.from || "") + " → " + (j.to || "")}</td><td>${esc((j.reasons || []).join("；") || (j.state === "promoted" ? "時間留出／舊參考／合成挑戰通過" : "回退後凍結自動訓練"))}</td></tr>`,
      )
      .join("") ||
    '<tr><td colspan="4">尚無再訓練；等待真實觸發條件。</td></tr>';
  $("events").innerHTML =
    [...S.events]
      .reverse()
      .map(
        (e) =>
          `<tr><td>#${e.start}–${e.end}</td><td>${e.alerts} 筆警示 · ${e.max_score.toFixed(2)}×門檻<small>初始基準 ${e.baseline_alerts ?? 0} 筆 · 品質 ${e.quality} · 工況超界 ${e.guard}</small></td><td>${esc(e.annotation)}</td><td>${esc(e.version)}</td></tr>`,
      )
      .join("") || '<tr><td colspan="4">第一個完整窗口抵達後顯示。</td></tr>';
}
function draw() {
  if (!S) return;
  const point = S.points.at(-1),
    key = $("channel").value,
    unit = { power: "kW", voltage: "V", current: "A" }[key];
  $("signal-value").textContent =
    point && Number.isFinite(point[key]) ? point[key].toFixed(2) : "—";
  $("signal-unit").textContent = unit;
  $("point-state").textContent = point
    ? point.missing
      ? "資料品質警報"
      : point.guard
        ? "超出核准工況"
        : point.alert
          ? "模型警示"
          : point.fixed > 1
            ? "初始基準偏移"
            : "未觸發警示"
    : "參考已建立";
  $("point-state").className =
    "badge " + (point?.alert || point?.fixed > 1 ? "amber" : "neutral");
  $("virtual-time").textContent = clock(S.seconds);
  $("total").textContent = S.total.toLocaleString() + " 筆";
  $("windows").textContent = S.windows + " 窗";
  $("active").textContent = S.active;
  $("baseline-alert-rate").textContent =
    "初始基準 " + percent(S.windows_history.at(-1)?.fixed_alert_rate);
  $("alert-rate").textContent = percent(S.windows_history.at(-1)?.alert_rate);
  $("seed-label").textContent = S.seed;
  $("training-state").textContent = states[S.state] || S.state;
  $("training-state").className =
    "badge " +
    (["blocked", "rejected"].includes(S.state)
      ? "amber"
      : S.state === "promoted"
        ? "teal"
        : "neutral");
  $("sample-gate").textContent = S.eligible + " / " + S.min_train;
  $("sample-meter").style.width =
    Math.min(100, (S.eligible / S.min_train) * 100) + "%";
  $("persist-gate").textContent = S.streak + " / " + S.persist_required + " 窗";
  $("cooldown-gate").textContent = S.cooldown + " 窗";
  $("gate-reason").textContent = S.reason;
  $("auto-training").checked = S.training_enabled;
  $("training-progress").hidden = !S.job_pending;
  $("training-progress-label").textContent =
    S.state === "queued" ? "CPU 等待排程" : "CPU 真實訓練中";
  $("training-progress-count").textContent = S.progress + " / 3 候選";
  $("drift-value").textContent = S.drift.toFixed(2);
  $("drift-threshold").textContent = S.drift_threshold.toFixed(2);
  $("immutable-drift").textContent = S.immutable_drift.toFixed(2);
  $("limits").textContent =
    `有界保存：訊號 ${S.limits.points} 筆、合格樣本 ${S.limits.eligible} 筆、歷程 ${S.limits.history} 次、模型 ${S.limits.versions} 版。本次上限 ${S.limits.samples.toLocaleString()} 筆。工作階段重設會清空；匯出為 metadata/有界樣本，不是權重檔。`;
  signalChart();
  histogram();
  driftChart();
  candidate();
  histories();
  controls();
}
$("play").onclick = () => {
  playing = !playing;
  if (playing) schedule();
  else clearTimeout(timer);
  controls();
  status(playing ? "繼續逐窗監測。" : "串流已暫停；已送出的窗口仍會完成。");
};
$("step").onclick = async () => {
  playing = false;
  clearTimeout(timer);
  await command("advance", { windows: 1 });
  controls();
  if (!$("step").disabled) $("step").focus({ preventScroll: true });
};
$("reset").onclick = async () => {
  playing = false;
  clearTimeout(timer);
  if (await command("reset")) {
    playing = true;
    schedule();
    status("已重設 seed 520、初始參考與 v1；舊訓練結果不會覆蓋新工作階段。");
  }
  controls();
};
$("rollback").onclick = async () => {
  if (await command("rollback"))
    status("已回退上一模型並凍結自動訓練；串流與固定邊界持續。");
};
$("auto-training").onchange = async () => {
  if (await command("configure", { enabled: $("auto-training").checked }))
    $("auto-training").focus({ preventScroll: true });
};
$("channel").onchange = () => {
  signalChart();
  draw();
};
document.querySelectorAll("[data-inject]").forEach(
  (b) =>
    (b.onclick = async () => {
      if (await command("inject", { kind: b.dataset.inject }))
        status("手動合成事件已排入下一個窗口；不影響訓練標籤。");
    }),
);
$("export").onclick = () => {
  if (!S) return;
  const blob = new Blob(
      [
        JSON.stringify(
          {
            schema: "lifecycle-1",
            exported_at: new Date().toISOString(),
            ...S,
            limitations:
              "模擬工況與合成挑戰；非實體設備、非 TTT；僅有界資料與版本 metadata，不包含 sklearn pickle",
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = "signal-lifecycle.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  status("已匯出 seed、政策、分布、候選驗收與版本 metadata。");
};
$("signal").onpointermove = (event) => {
  if (!S?.points.length) return;
  const el = $("signal"),
    box = el.getBoundingClientRect(),
    p = S.points.slice(-768),
    j = Math.max(
      0,
      Math.min(
        p.length - 1,
        Math.round(
          ((event.clientX - box.left - 47) / (box.width - 65)) * (p.length - 1),
        ),
      ),
    ),
    x = p[j],
    key = $("channel").value;
  $("tooltip").innerHTML =
    `<strong>#${x.i} · ${clock(x.seconds)} · ${esc(x.version)}</strong>${key} ${x[key] === null ? "缺值" : x[key].toFixed(3)}<br>模型 ${x.score.toFixed(2)}×門檻<br>初始基準 ${x.fixed.toFixed(2)}×門檻<br>${esc(x.annotation || "無合成事件標記")}`;
  $("tooltip").hidden = false;
  $("tooltip").style.left =
    Math.max(5, Math.min(box.width - 210, event.clientX - box.left + 10)) +
    "px";
  $("tooltip").style.top = "25px";
};
$("signal").onpointerleave = () => {
  $("tooltip").hidden = true;
};
let resizeTimer;
new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (S) {
      signalChart();
      histogram();
      driftChart();
    }
  }, 40);
}).observe(document.querySelector(".signal-panel"));
window.addEventListener("pagehide", () => {
  if (S)
    navigator.sendBeacon(
      "/api/lifecycle/release",
      new Blob(
        [
          JSON.stringify({
            session_id: sessionId,
            expected_revision: S.revision,
          }),
        ],
        { type: "application/json" },
      ),
    );
});
initialize();
