"use strict";
const $ = (id) => document.getElementById(id);
const COLORS = {
  signal: "#315cdb",
  fixed: "#315cdb",
  adaptive: "#0e9b8d",
  ml: "#a38cbd",
  shift: "#bd8951",
  alert: "#da972e",
  reference: "#edf2ff",
  injection: "#fff0d2",
  grid: "#e7ebf0",
  text: "#7c8798",
};
let original = [],
  rows = [],
  labels = {},
  scores = [],
  meta = {},
  model = {},
  cursor = 180,
  selected = -1;
let timer = null,
  ready = false,
  busy = false,
  request = 0,
  actions = [],
  runAbort = null,
  sourceRequest = 0;
const channels = [
  { unit: "kW", name: "功率" },
  { unit: "V", name: "電壓" },
  { unit: "A", name: "電流" },
];
const escapeHTML = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const end = () => Number($("end").value);
function stateAt(i) {
  let frozen = true,
    approved = false;
  for (const a of actions
    .filter((a) => a.at <= i)
    .sort((a, b) => a.at - b.at)) {
    if ("frozen" in a) frozen = a.frozen;
    if ("approved" in a) approved = a.approved;
    if (a.rollback) frozen = true;
  }
  return { frozen, approved };
}
function status(message, kind = "info") {
  $("status").textContent = message;
  $("status").dataset.kind = kind;
}
function pause() {
  clearInterval(timer);
  timer = null;
  $("play").innerHTML =
    '<svg class="icon"><use href="#i-play"/></svg><span>播放</span>';
  $("play").setAttribute("aria-label", "播放");
}
function setBusy(value) {
  busy = value;
  document
    .querySelector(".monitor-grid")
    .setAttribute("aria-busy", String(value));
  updateControls();
}
function updateControls() {
  $("setup-action").textContent = ready ? "調整設定" : "核准參考";
  const phase = ready ? 3 : rows.length ? 2 : 1;
  document.querySelectorAll(".workflow li").forEach((item, i) => {
    item.className =
      i + 1 < phase ? "complete" : i + 1 === phase ? "current" : "";
    if (i + 1 === phase) item.setAttribute("aria-current", "step");
    else item.removeAttribute("aria-current");
  });
  const state = stateAt(cursor);
  $("build").disabled = busy || !rows.length;
  $("build").querySelector("span").textContent = busy
    ? "分析中…"
    : ready
      ? "重新建立基準"
      : "建立參考基準";
  for (const id of ["play", "step", "approve", "freeze", "rollback", "export"])
    $(id).disabled = busy || !ready;
  document
    .querySelectorAll("[data-inject]")
    .forEach((b) => (b.disabled = busy || !ready || cursor < end()));
  $("seek").disabled = busy || !rows.length;
  $("start").disabled = busy;
  $("end").disabled = busy;
  $("refok").disabled = busy;
  $("reset").disabled = busy || !rows.length;
  $("approve").checked = state.approved;
  $("freeze").querySelector("span").textContent = state.frozen
    ? "解除凍結"
    : "凍結更新";
  $("calibration-state").className =
    "badge " +
    (!ready || state.frozen ? "neutral" : state.approved ? "teal" : "amber");
  $("calibration-state").innerHTML =
    !ready || state.frozen
      ? '<svg class="icon"><use href="#i-lock"/></svg>已凍結'
      : state.approved
        ? "受控校正中"
        : "等待核准";
  $("calibration-hint").textContent = !ready
    ? "建立基準後可操作。所有評分先於更新。"
    : state.frozen
      ? "校正已停止；固定基準與 ML 始終保留。"
      : state.approved
        ? "先評分，再更新。超過 3 MAD 或缺值不更新。"
        : "已解除凍結；核准後續工況才會更新。";
  $("preview-badge").textContent = busy
    ? "重新分析"
    : !ready
      ? "資料預覽"
      : timer
        ? "回放中"
        : "已建立基準";
  $("preview-badge").className = "badge " + (ready ? "teal" : "neutral");
}
async function load() {
  if ($("source").value === "csv") return;
  $("source").querySelector("option[value=csv]")?.remove();
  pause();
  if (runAbort) runAbort.abort();
  request++;
  const id = ++sourceRequest;
  ready = false;
  setBusy(true);
  status("正在讀取資料…");
  try {
    const response = await fetch("/api/data?source=" + $("source").value);
    const data = await response.json();
    if (!response.ok) throw Error(data.detail);
    if (id !== sourceRequest) return;
    original = data.rows;
    meta = data;
    $("start").value = 0;
    $("end").value = Math.min(180, Math.floor(original.length * 0.4));
    reset(false);
    $("provenance").textContent =
      (meta.device === "UCI-household-01"
        ? "CC BY 4.0 · "
        : meta.device === "synthetic-01"
          ? "seed 520 · "
          : "") +
      original.length.toLocaleString() +
      " 筆 · 1 分鐘 / 筆 · 三通道";
    $("evidence-source").textContent = data.source + " · " + data.device;
    $("setup").open = window.innerWidth > 600;
    status("資料已就緒。選擇並核准參考區間，開始建立基準。");
  } catch (error) {
    if (id === sourceRequest) {
      original = [];
      rows = [];
      meta = {};
      reset(false);
      $("provenance").textContent = "此來源尚未載入";
      $("evidence-source").textContent = "尚無有效資料";
      status(error.message + "；可選合成來源進行離線測試。", "error");
    }
  } finally {
    if (id === sourceRequest) setBusy(false);
  }
}
function reset(showMessage = true) {
  pause();
  $("chart-tooltip").hidden = true;
  request++;
  if (runAbort) runAbort.abort();
  rows = structuredClone(original);
  labels = {};
  scores = [];
  model = {};
  ready = false;
  actions = [];
  selected = -1;
  cursor = Math.min(rows.length - 1, Math.max(0, end()));
  $("refok").checked = false;
  $("approve").checked = false;
  $("event-filter").value = "all";
  $("seek").min = 0;
  $("seek").max = Math.max(0, rows.length - 1);
  $("seek").value = Math.max(0, cursor);
  $("model").textContent = "尚未建立模型";
  $("version-info").textContent = "建立基準後顯示模型版本。";
  $("setup-summary").textContent = rows.length
    ? `${meta.device === "UCI-household-01" ? "UCI 公開用電" : meta.device === "synthetic-01" ? "合成三通道" : "CSV"} · 參考 ${Number($("start").value)}–${end() - 1} · 待核准`
    : "三個步驟，開始監測";
  $("setup").open = showMessage || window.innerWidth > 600;
  draw();
  if (showMessage)
    status("實驗已重設。原始資料保留，合成事件與校正歷史已清除。");
}
async function compute(rewind = false) {
  pause();
  if (!$("refok").checked) {
    $("setup").open = true;
    status("請先核准此區間作為展示參考工況。", "warning");
    $("refok").focus();
    return false;
  }
  const start = Number($("start").value),
    stop = end();
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(stop) ||
    start < 0 ||
    stop > rows.length ||
    stop - start < 40 ||
    stop >= rows.length
  ) {
    status("參考區間至少 40 筆，且必須保留後續回放資料。", "error");
    return false;
  }
  if (rewind && Object.keys(labels).some((i) => +i >= start && +i < stop)) {
    status("參考區間包含合成事件。請先清除實驗，再選擇參考工況。", "error");
    return false;
  }
  if (runAbort) runAbort.abort();
  runAbort = new AbortController();
  const id = ++request;
  setBusy(true);
  status("CPU 分析中：建立基準並依時間逐筆評分…");
  try {
    const response = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rows,
        start,
        end: stop,
        approve: false,
        freeze: true,
        actions,
      }),
      signal: runAbort.signal,
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.detail);
    if (id !== request) return false;
    scores = data.scores;
    model = data.model;
    ready = true;
    if (rewind) cursor = stop;
    $("seek").min = stop;
    $("seek").value = cursor;
    $("model").textContent = JSON.stringify(
      {
        ...model,
        state_scope: "完整資料重播結尾；目前游標版本另見校正控制",
        source: meta.source,
        device: meta.device,
        rows: rows.length,
      },
      null,
      2,
    );
    $("version-info").textContent =
      `Python ${model.python} · scikit-learn ${model.sklearn} · 模型 ${model.implementation} · 參考雜湊 ${model.reference_sha256.slice(0, 12)}…`;
    $("setup-summary").textContent =
      `${meta.device === "UCI-household-01" ? "UCI 公開用電" : meta.device === "synthetic-01" ? "合成三通道" : "CSV"} · 參考 ${start}–${stop - 1} · ${stop - start} 筆`;
    $("setup").open = false;
    draw();
    status(
      rewind
        ? "基準已建立。播放資料，或在目前游標加入一個合成變化。"
        : "實驗已更新。固定基準保留，所有資料先評分再校正。",
      "success",
    );
    return true;
  } catch (error) {
    if (error.name !== "AbortError" && id === request) {
      ready = false;
      scores = [];
      model = {};
      $("model").textContent = "模型尚未建立；請修正資料或參考區間。";
      $("version-info").textContent = "模型尚未建立。";
      draw();
      status(error.message, "error");
    }
    return false;
  } finally {
    if (id === request) setBusy(false);
  }
}
function timeLabel(i, full = false) {
  if (meta.device === "csv-single-device")
    return full ? "第 " + i + " 筆（時間未提供）" : "#" + i;
  const timestamp = meta.timestamps?.[i];
  if (timestamp) {
    const [date, time] = timestamp.split(" ");
    return full ? date + " " + time.slice(0, 5) : time.slice(0, 5);
  }
  const minutes = Math.max(0, i);
  return (
    (full ? "第 " + i + " 筆 · " : "") +
    String(Math.floor(minutes / 60)).padStart(2, "0") +
    ":" +
    String(minutes % 60).padStart(2, "0")
  );
}
function formatValue(v) {
  return v === null || !Number.isFinite(v) ? "—" : v.toFixed(2);
}
function path(values, w, h, min, max) {
  let active = false;
  return values
    .map((value, i) => {
      if (value === null || !Number.isFinite(value)) {
        active = false;
        return "";
      }
      const command = active ? "L" : "M";
      active = true;
      return `${command}${(52 + (i * (w - 72)) / Math.max(1, values.length - 1)).toFixed(1)},${(h - 35 - ((value - min) / (max - min || 1)) * (h - 62)).toFixed(1)}`;
    })
    .join(" ");
}
function runs(from, to, condition) {
  let out = [],
    begin = -1;
  for (let i = from; i < to; i++) {
    if (condition(i)) {
      if (begin < 0) begin = i;
    } else if (begin >= 0) {
      out.push([begin, i - 1]);
      begin = -1;
    }
  }
  if (begin >= 0) out.push([begin, to - 1]);
  return out;
}
function graph(id, series, colors, threshold) {
  const el = $(id),
    width = Math.max(240, el.clientWidth || 800),
    height = id === "signal" ? 280 : 190;
  const lo = Math.max(0, cursor - 239),
    hi = Math.max(lo + 1, Math.min(cursor + 1, rows.length)),
    size = hi - lo;
  const sliced = series.map((s) => s.slice(lo, hi));
  const values = sliced.flat().filter((v) => v !== null && Number.isFinite(v));
  const channel = +$("channel").value,
    band =
      ready && id === "signal" && model.baseline
        ? {
            low: model.baseline[channel] - 4 * model.scale[channel],
            high: model.baseline[channel] + 4 * model.scale[channel],
          }
        : null;
  if (band) values.push(band.low, band.high);
  let min = values.length ? Math.min(...values) : 0,
    max = values.length ? Math.max(...values) : 1;
  if (id === "scores") {
    min = 0;
    max = Math.max(6, max) * 1.12;
  } else {
    const padding = Math.max((max - min) * 0.16, 0.05);
    min -= padding;
    max += padding;
    if (
      id === "signal" &&
      channel !== 1 &&
      rows
        .slice(lo, hi)
        .every((row) => row[channel] === null || row[channel] >= 0)
    )
      min = Math.max(0, min);
  }
  const xpos = (i) => 52 + ((i - lo) * (width - 72)) / Math.max(1, size - 1),
    ypos = (v) => height - 35 - ((v - min) / (max - min || 1)) * (height - 62);
  el.setAttribute("viewBox", `0 0 ${width} ${height}`);
  el.dataset.lo = lo;
  el.dataset.hi = hi;
  let html = "";
  if (band) {
    html += `<rect x="52" y="${ypos(band.high)}" width="${width - 72}" height="${Math.max(0, ypos(band.low) - ypos(band.high))}" fill="#edf2ff" opacity=".7"/><line x1="52" x2="${width - 20}" y1="${ypos(band.high)}" y2="${ypos(band.high)}" stroke="#c9d6fa" stroke-dasharray="3 4"/>`;
  }
  const refStart = Number($("start").value),
    refEnd = end() - 1;
  if (id === "signal" && refEnd >= lo && refStart < hi) {
    const x = xpos(Math.max(lo, refStart)),
      right = xpos(Math.min(hi - 1, refEnd));
    html += `<rect x="${x}" y="20" width="${Math.max(2, right - x)}" height="${height - 55}" fill="${COLORS.reference}"/><text x="${x + 8}" y="33" class="annotation">${ready ? "參考工況" : "參考預選"}</text>`;
  }
  for (let tick = 0; tick < 4; tick++) {
    const value = min + ((max - min) * tick) / 3,
      y = ypos(value);
    html += `<line x1="52" x2="${width - 20}" y1="${y}" y2="${y}" stroke="${COLORS.grid}"/><text x="42" y="${y + 4}" text-anchor="end">${value.toFixed(id === "signal" && +$("channel").value === 1 ? 0 : 1)}</text>`;
  }
  for (const [start, stop] of runs(lo, hi, (i) => !!labels[i])) {
    html += `<rect x="${xpos(start) - 1}" y="20" width="${Math.max(3, xpos(stop) - xpos(start) + 3)}" height="${height - 55}" fill="${COLORS.injection}" opacity=".72"/>`;
  }
  if (id === "signal") {
    for (const [start, stop] of runs(
      lo,
      hi,
      (i) => scores[i] && (scores[i].fixed > 4 || scores[i].missing),
    )) {
      html += `<line x1="${xpos(start)}" x2="${xpos(stop) + 2}" y1="12" y2="12" stroke="${COLORS.alert}" stroke-width="3" stroke-linecap="round"/>`;
    }
  }
  if (threshold)
    html += `<line x1="52" x2="${width - 20}" y1="${ypos(threshold)}" y2="${ypos(threshold)}" stroke="#a2aab7" stroke-dasharray="5 5"/>`;
  sliced.forEach((v, j) => {
    html += `<path d="${path(v, width, height, min, max)}" fill="none" stroke="${colors[j]}" stroke-width="${id === "signal" ? 2.2 : 1.7}" ${id === "scores" && j === 1 ? 'stroke-dasharray="5 4"' : ""} stroke-linejoin="round" stroke-linecap="round"/>`;
  });
  if (id === "signal") {
    const injected = sliced[0].map((v, j) => (labels[lo + j] ? v : null));
    html += `<path d="${path(injected, width, height, min, max)}" fill="none" stroke="#d99125" stroke-width="2.4" stroke-linecap="round"/>`;
    for (const [begin, last] of runs(lo, hi, (i) => !!labels[i]))
      if (begin === last && rows[begin][channel] !== null)
        html += `<circle cx="${xpos(begin)}" cy="${ypos(rows[begin][channel])}" r="3" fill="#d99125"/>`;
  }
  for (let tick = 0; tick < 4; tick++) {
    const i = lo + Math.round(((size - 1) * tick) / 3);
    html += `<text x="${xpos(i)}" y="${height - 9}" text-anchor="${tick === 0 ? "start" : tick === 3 ? "end" : "middle"}">${timeLabel(i)}</text>`;
  }
  if (selected >= lo && selected < hi) {
    html += `<line x1="${xpos(selected)}" x2="${xpos(selected)}" y1="18" y2="${height - 35}" stroke="${COLORS.text}" stroke-dasharray="3 3"/>`;
  }
  el.innerHTML = html;
}
function groupEvents() {
  const groups = [];
  for (let i = end(); i <= cursor; i++) {
    const score = scores[i];
    if (!score) continue;
    const type =
      labels[i] ||
      (score.missing
        ? "來源缺值"
        : score.fixed > 4 || score.adaptive > 4 || score.ml_alert
          ? "背景警報"
          : "");
    if (!type) continue;
    const last = groups.at(-1);
    if (last && last.stop === i - 1 && last.type === type) {
      last.stop = i;
      last.fixed = Math.max(last.fixed, score.fixed);
      last.adaptive = Math.max(last.adaptive, score.adaptive);
      last.ml ||= score.ml_alert;
    } else
      groups.push({
        start: i,
        stop: i,
        type,
        synthetic: !!labels[i],
        fixed: score.fixed,
        adaptive: score.adaptive,
        ml: score.ml_alert,
      });
  }
  return groups;
}
function drawEvents() {
  const all = groupEvents(),
    filter = $("event-filter").value,
    groups = all
      .filter(
        (g) =>
          filter === "all" ||
          (filter === "synthetic" ? g.synthetic : !g.synthetic),
      )
      .reverse();
  $("event-count").textContent = groups.length;
  $("events-empty").hidden = groups.length > 0;
  $("events-empty").querySelector("strong").textContent = !ready
    ? "先建立基準，再觀察變化"
    : filter === "synthetic"
      ? "目前還沒有合成事件"
      : "此回放區間沒有警報";
  $("events-empty").querySelector("p").textContent = !ready
    ? "回放資料或加入合成事件，這裡會顯示需要留意的區間。"
    : filter === "synthetic"
      ? "使用右側測試動作，在目前游標加入一個合成變化。"
      : "繼續回放，或加入合成事件檢查模型反應。";
  $("events").innerHTML = groups
    .slice(0, 50)
    .map(
      (g) =>
        `<tr data-i="${g.start}" tabindex="0" aria-label="定位${escapeHTML(g.type)}，第 ${g.start} 至 ${g.stop} 筆" class="${selected >= g.start && selected <= g.stop ? "selected" : ""}"><td><strong>${timeLabel(g.start)}</strong><small>#${g.start}${g.stop > g.start ? "–" + g.stop + " · " + (g.stop - g.start + 1) + " 筆" : ""}</small></td><td><span class="event-type ${g.synthetic ? "synthetic" : ""}"><i></i>${escapeHTML(g.type)}</span></td><td class="mono">${g.fixed.toFixed(1)} <span class="subtle">/</span> ${g.adaptive.toFixed(1)}</td><td><span class="ml-state ${g.ml ? "active" : ""}">${g.ml ? "觸發" : "—"}</span></td><td class="event-arrow">↗</td></tr>`,
    )
    .join("");
}
function draw() {
  $("comparison-empty").hidden = ready;
  $("scores").toggleAttribute("hidden", !ready);
  $("score-legend").hidden = !ready;
  $("baseline-legend").textContent = ready ? "固定基準 ±4 MAD" : "參考預選區間";
  const valid = scores.slice(0, cursor + 1).filter(Boolean),
    indices = Object.keys(labels).filter((i) => +i <= cursor),
    hits = indices.filter(
      (i) =>
        scores[i] &&
        (scores[i].fixed > 4 ||
          scores[i].adaptive > 4 ||
          scores[i].ml_alert ||
          scores[i].missing),
    );
  $("fixed").textContent = ready
    ? valid.filter((s) => s.fixed > 4 || s.missing).length.toLocaleString()
    : "—";
  $("adaptive").textContent = ready
    ? valid.filter((s) => s.adaptive > 4 || s.missing).length.toLocaleString()
    : "—";
  $("recall").textContent = indices.length
    ? Math.round((hits.length * 100) / indices.length) + "%"
    : "—";
  $("coverage-count").textContent = indices.length
    ? `${hits.length} / ${indices.length} 注入筆次`
    : "尚無合成事件";
  $("current-value").textContent = formatValue(
    rows[cursor]?.[+$("channel").value],
  );
  $("current-unit").textContent = channels[+$("channel").value].unit;
  $("current-time").textContent = rows.length
    ? timeLabel(cursor, true)
    : "尚無資料";
  $("position").textContent = rows.length
    ? `第 ${cursor.toLocaleString()} / ${(rows.length - 1).toLocaleString()} 筆`
    : "—";
  $("replay-progress").textContent = rows.length
    ? `${Math.round((cursor / Math.max(1, rows.length - 1)) * 100)}%`
    : "—";
  $("seek").style.setProperty(
    "--progress",
    rows.length ? (cursor / (rows.length - 1)) * 100 + "%" : "0%",
  );
  const s = scores[cursor];
  $("current-version").textContent = s?.version ?? "—";
  $("current-shift").textContent = s ? s.shift.toFixed(2) + " MAD" : "—";
  const point = !ready
    ? "尚未建立基準"
    : labels[cursor]
      ? labels[cursor]
      : s?.missing
        ? "資料缺值"
        : s && (s.fixed > 4 || s.adaptive > 4 || s.ml_alert)
          ? "背景警報 · 無真值"
          : "未觸發警報";
  $("point-state").textContent = point;
  $("point-state").className =
    "point-state " +
    (labels[cursor]
      ? "synthetic"
      : s && (s.fixed > 4 || s.missing)
        ? "alert"
        : "");
  graph("signal", [rows.map((r) => r[+$("channel").value])], [COLORS.signal]);
  graph(
    "scores",
    [
      scores.map((s) => s?.fixed ?? null),
      scores.map((s) => s?.adaptive ?? null),
      scores.map((s) => s?.shift ?? null),
    ],
    [COLORS.fixed, COLORS.adaptive, COLORS.shift],
    4,
  );
  drawEvents();
  updateControls();
}
function addAction(action) {
  actions = actions.filter((a) => a.at <= cursor);
  actions.push({ at: cursor, ...action });
  return compute();
}
function locateEvent(row) {
  if (!row) return;
  pause();
  selected = +row.dataset.i;
  cursor = selected;
  $("seek").value = cursor;
  draw();
  $("signal-wrap").scrollIntoView({
    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth",
    block: "center",
  });
}
$("source").onchange = load;
for (const id of ["start", "end"])
  $(id).onchange = () => {
    reset(false);
    status("參考區間已變更。請重新核准並建立基準。");
  };
$("build").onclick = async () => {
  actions = [];
  await compute(true);
};
$("reset").onclick = () => reset();
$("play").onclick = () => {
  if (timer) {
    pause();
    updateControls();
    return;
  }
  if (!ready || busy) return;
  $("play").innerHTML =
    '<svg class="icon"><use href="#i-pause"/></svg><span>暫停</span>';
  $("play").setAttribute("aria-label", "暫停");
  timer = setInterval(() => {
    cursor = Math.min(rows.length - 1, cursor + Number($("speed").value));
    $("seek").value = cursor;
    draw();
    if (cursor === rows.length - 1) {
      pause();
      updateControls();
    }
  }, 200);
  updateControls();
};
$("step").onclick = () => {
  pause();
  if (!ready || busy) return;
  cursor = Math.min(rows.length - 1, cursor + 1);
  $("seek").value = cursor;
  draw();
};
$("seek").oninput = (event) => {
  pause();
  cursor = +event.target.value;
  selected = -1;
  draw();
};
$("channel").onchange = draw;
$("event-filter").onchange = drawEvents;
$("freeze").onclick = () => addAction({ frozen: !stateAt(cursor).frozen });
$("approve").onchange = () => {
  if (ready) addAction({ approved: $("approve").checked });
};
$("rollback").onclick = () => addAction({ rollback: true });
$("events").onclick = (event) =>
  locateEvent(event.target.closest("tr[data-i]"));
$("events").onkeydown = (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    locateEvent(event.target.closest("tr[data-i]"));
  }
};
document.querySelectorAll("[data-inject]").forEach(
  (button) =>
    (button.onclick = async () => {
      if (!ready || busy) return;
      pause();
      const type = button.dataset.inject,
        start = Math.max(cursor, end()),
        count = type === "spike" ? 1 : type === "drift" ? 90 : 10;
      for (let j = 0; j < count && start + j < rows.length; j++) {
        const i = start + j;
        labels[i] =
          "合成 " + { spike: "尖峰", drift: "慢性漂移", missing: "缺值" }[type];
        if (type === "missing") rows[i][0] = null;
        else {
          rows[i][0] =
            (rows[i][0] ?? 0) + (type === "spike" ? 2 : (1.5 * j) / 89);
          rows[i][2] =
            (rows[i][2] ?? 0) + (type === "spike" ? 8.7 : (6.5 * j) / 89);
        }
      }
      if (await compute()) {
        const until = Math.min(rows.length - 1, start + count - 1);
        status(
          `已注入${{ spike: "合成尖峰", drift: "合成漂移", missing: "合成缺值" }[type]}：第 ${start}${until > start ? "–" + until : ""} 筆。可播放觀察後續反應。`,
          "success",
        );
      }
    }),
);
$("export").onclick = () => {
  const blob = new Blob(
    [
      JSON.stringify(
        {
          schema: 2,
          model,
          model_scope: "全資料時間序重播結尾；非目前游標狀態",
          current_cursor_state: {
            version: scores[cursor]?.version ?? 0,
            shift: scores[cursor]?.shift ?? 0,
            score_before_update: true,
          },
          meta,
          rows,
          labels,
          controls: { start: Number($("start").value), end: end(), actions },
          cursor,
          note: "ML 可由種子、參考資料與套件版本重建；合成標籤不餵入模型；未輸出 pickle",
        },
        null,
        2,
      ),
    ],
    { type: "application/json" },
  );
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = "signal-experiment.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  status("實驗已匯出，包含資料、模型參數與控制時間軸。", "success");
};
$("csv").onchange = async (event) => {
  try {
    if (!event.target.files[0]) return;
    const text = await event.target.files[0].text(),
      lines = text.trim().split(/\r?\n/),
      header = lines.shift().split(",");
    if (header.join(",") !== "power_kw,voltage_v,current_a")
      throw Error("CSV 欄位需為 power_kw,voltage_v,current_a");
    const parsed = lines.map((line) =>
      line.split(",").map((v) => (v.trim() === "" ? null : Number(v))),
    );
    if (
      parsed.length < 80 ||
      parsed.length > 20000 ||
      parsed.some(
        (row) =>
          row.length !== 3 ||
          row.some((v) => v !== null && !Number.isFinite(v)),
      )
    )
      throw Error("CSV 需 80–20,000 筆、三個數值欄位；空白視為缺值");
    sourceRequest++;
    if (runAbort) runAbort.abort();
    let option = $("source").querySelector("option[value=csv]");
    if (!option) {
      option = document.createElement("option");
      option.value = "csv";
      option.textContent = "自訂 CSV · 使用者資料";
      option.disabled = true;
      $("source").append(option);
    }
    option.selected = true;
    original = parsed;
    meta = {
      source: "使用者 CSV · 授權與時間順序需自行確認",
      device: "csv-single-device",
    };
    $("start").value = 0;
    $("end").value = Math.min(180, Math.floor(parsed.length * 0.5));
    reset(false);
    $("provenance").textContent =
      parsed.length.toLocaleString() + " 筆 · CSV 單一設備";
    $("evidence-source").textContent = meta.source;
    status("CSV 已載入。請選擇並核准參考區間。");
    setBusy(false);
  } catch (error) {
    status(error.message, "error");
  }
};
$("signal").addEventListener("pointermove", (event) => {
  const el = $("signal"),
    rect = el.getBoundingClientRect(),
    width = rect.width,
    lo = +el.dataset.lo,
    hi = +el.dataset.hi;
  if (!rows.length || hi <= lo) return;
  const offset = Math.max(
      0,
      Math.min(1, (event.clientX - rect.left - 52) / (width - 72)),
    ),
    i = Math.min(hi - 1, lo + Math.round(offset * (hi - lo - 1))),
    score = scores[i];
  $("chart-tooltip").innerHTML =
    `<strong>${timeLabel(i, true)}</strong><span>${channels[+$("channel").value].name} ${formatValue(rows[i]?.[+$("channel").value])} ${channels[+$("channel").value].unit}</span>${labels[i] ? '<span class="synthetic">' + escapeHTML(labels[i]) + "</span>" : ""}${score ? `<small>固定 ${score.fixed.toFixed(2)} · 校正 ${score.adaptive.toFixed(2)}</small>` : ""}`;
  $("chart-tooltip").hidden = false;
  $("chart-tooltip").style.left =
    Math.min(Math.max(8, event.clientX - rect.left + 12), width - 210) + "px";
  $("chart-tooltip").style.top =
    Math.min(Math.max(12, event.clientY - rect.top - 60), 160) + "px";
});
$("signal").addEventListener("pointerleave", () => {
  $("chart-tooltip").hidden = true;
});
new ResizeObserver(() => draw()).observe($("signal-wrap"));
load();
