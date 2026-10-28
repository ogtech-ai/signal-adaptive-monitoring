// Records only an isolated app viewport; real UI actions/CPU results, no generated training animation.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  cp = require("node:child_process");
(async () => {
  const output = path.resolve("delivery");
  fs.mkdirSync(output, { recursive: true });
  const commit = cp
    .execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" })
    .trim();
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    recordVideo: {
      dir: path.join(output, "video-lifecycle"),
      size: { width: 1440, height: 1000 },
    },
    acceptDownloads: true,
  });
  const page = await context.newPage(),
    steps = [],
    errors = [];
  const begin = Date.now();
  page.on("pageerror", (e) => errors.push(e.message));
  const wait = (ms) => page.waitForTimeout(ms);
  async function caption(text) {
    console.log(text);
    steps.push({
      seconds: +((Date.now() - begin) / 1000).toFixed(2),
      step: text,
    });
    await page.evaluate((text) => {
      let el = document.getElementById("record-caption");
      if (!el) {
        el = document.createElement("div");
        el.id = "record-caption";
        el.style =
          "position:fixed;z-index:99999;top:0;left:0;width:100%;padding:12px 24px;background:#172941;color:white;font:500 16px/1.5 system-ui";
        document.body.append(el);
        document.body.style.paddingTop = "48px";
      }
      el.textContent = text;
    }, text);
    await wait(900);
  }
  async function click(selector) {
    await page.locator(selector).scrollIntoViewIfNeeded();
    await page.click(selector);
    await wait(500);
  }
  async function settled() {
    await page.waitForFunction(() => !document.querySelector("#step").disabled);
    await wait(400);
  }
  async function pause() {
    if ((await page.locator("#play").innerText()).includes("暫停"))
      await click("#play");
  }
  async function play() {
    if ((await page.locator("#play").innerText()).includes("繼續"))
      await click("#play");
  }
  await page.goto(process.env.DEMO_URL || "http://127.0.0.1:8011");
  await page.waitForFunction(() => !document.querySelector("#play").disabled);
  await caption(
    "01｜持續模擬：20Hz 週期訊號＋random noise，seed 520；不是實體記錄器",
  );
  await wait(2000);
  await page.locator("#signal").scrollIntoViewIfNeeded();
  await wait(1400);
  await caption(
    "02｜資料逐窗累積：每窗 128 筆，顯示資料量、窗口、Active 與警示",
  );
  await pause();
  await click("#step");
  await settled();
  await wait(1000);
  await caption("03｜加速連續監測；尖峰、缺值、工況漂移由時間序列自動發生");
  await page.selectOption("#speed", "4");
  await play();
  await page.locator("#signal").scrollIntoViewIfNeeded();
  await page.waitForFunction(
    () =>
      document
        .querySelector("#training-history")
        .textContent.includes("候選拒絕"),
    { timeout: 60000 },
  );
  await pause();
  await settled();
  await caption(
    "04｜第一輪候選遭拒：真正 fit 三個 CPU 模型，未通過就保留原模型",
  );
  await page.locator(".candidate-panel").scrollIntoViewIfNeeded();
  await wait(2600);
  await caption("05｜樣本＋持續漂移＋冷卻全數滿足才再訓練；沒有假訓練延遲");
  await play();
  await page.locator(".control-rail").scrollIntoViewIfNeeded();
  await page.waitForFunction(
    () => document.querySelector("#active").textContent !== "v1",
    { timeout: 60000 },
  );
  await pause();
  await settled();
  await caption(
    "06｜時間留出、舊參考與合成挑戰通過才 promotion；毫秒為實際 CPU 耗時",
  );
  await page.locator(".candidate-panel").scrollIntoViewIfNeeded();
  await wait(2700);
  await caption(
    "07｜初始與目前分布、Active 位移與不可變初始位移一起看，避免把偏移藏掉",
  );
  await page.locator(".distribution-panel").scrollIntoViewIfNeeded();
  await wait(2700);
  await caption(
    "08｜版本保存 UTC 時間、資料窗、重新 fit 方法、測試指標與啟用位置",
  );
  await page.locator(".history-panel").scrollIntoViewIfNeeded();
  await wait(2400);
  await caption("09｜繼續監測更大的工況漂移：超出核准範圍時禁止拿新窗訓練");
  await play();
  await page.locator("#signal").scrollIntoViewIfNeeded();
  await page.waitForFunction(
    () => document.querySelector("#training-state").textContent === "邊界阻擋",
    { timeout: 60000 },
  );
  await pause();
  await page.locator(".control-rail").scrollIntoViewIfNeeded();
  await wait(2300);
  await caption("10｜凍結再訓練，仍可逐窗評分；初始基準與品質／超界警示不停止");
  await page.uncheck("#auto-training");
  await settled();
  await click("#step");
  await settled();
  await wait(1300);
  await caption(
    "11｜一鍵 rollback 到上一保存模型；自動訓練保持凍結，歷史可追溯",
  );
  const old = await page.locator("#active").innerText();
  await click("#rollback");
  await settled();
  assert.notEqual(await page.locator("#active").innerText(), old);
  await page.locator(".history-panel").scrollIntoViewIfNeeded();
  await wait(2300);
  await caption(
    "12｜警示結果與合成標記分開；合成挑戰覆蓋不等於真實設備診斷準確率",
  );
  await page.locator(".events-panel").scrollIntoViewIfNeeded();
  await wait(2200);
  await caption(
    "13｜匯出有界資料、策略、候選驗收與版本 metadata；不是模型權重檔",
  );
  const dl = page.waitForEvent("download");
  await click("#export");
  await (await dl).saveAs(path.join(output, "lifecycle-recorded-export.json"));
  await wait(1200);
  await caption(
    "14｜手動測試是次要入口：排入缺值窗，仍須通過同樣的收集／訓練閘門",
  );
  await page.locator(".secondary-controls > summary").click();
  await click('[data-inject="missing"]');
  await settled();
  await click("#step");
  await settled();
  await page.locator("#signal").scrollIntoViewIfNeeded();
  await wait(1600);
  await caption(
    "15｜方法邊界：線上收集與漂移觸發重新 fit，非 TTT、非舊權重轉移、未在 G520 實測",
  );
  await page.locator(".evidence-panel > summary").click();
  await page.locator(".evidence-grid").scrollIntoViewIfNeeded();
  await wait(2600);
  await caption(
    "16｜重設相同 seed，從固定初始參考 v1 再開始；舊訓練結果不覆蓋新 session",
  );
  await click("#reset");
  await settled();
  assert.equal(await page.locator("#active").innerText(), "v1");
  await page.evaluate(() => window.scrollTo(0, 0));
  await wait(1700);
  await caption(
    "完成｜真實 CPU 計算、可解釋漂移、有限候選驗收與可回退模型生命週期",
  );
  await wait(1800);
  const video = page.video();
  await context.close();
  const raw = await video.path();
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(output, "lifecycle-recording-trace.json"),
    JSON.stringify(
      {
        commit,
        viewport: { width: 1440, height: 1000 },
        surface: "isolated application viewport only",
        audio: false,
        steps,
        errors,
        rawVideo: raw,
      },
      null,
      2,
    ),
  );
  await browser.close();
  console.log("RAW_VIDEO=" + raw);
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
