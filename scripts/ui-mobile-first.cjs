const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let runs = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/run")) runs++;
  });
  await page.route("**/api/run", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 350));
    try {
      await route.continue();
    } catch {}
  });
  const done = async () => {
    await page.waitForFunction(
      () => !document.querySelector("#build").disabled,
    );
    assert.notEqual(
      await page.locator("#status").getAttribute("data-kind"),
      "error",
    );
  };
  const seek = async (i) => {
    await page.locator("#seek").fill(String(i));
    await page.locator("#seek").dispatchEvent("input");
  };
  await page.goto(process.env.DEMO_URL || "http://127.0.0.1:8011");
  await page.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("資料已就緒"),
  );
  assert.equal(
    await page.locator("#setup").evaluate((element) => element.open),
    true,
  );
  assert.equal(await page.locator("#refok").isVisible(), true);
  assert.equal(await page.locator("#build").isVisible(), true);
  await page.screenshot({
    path: "delivery/signal-mobile-first-initial-390.png",
    fullPage: true,
  });
  await page.screenshot({
    path: "delivery/signal-mobile-first-viewport-390.png",
  });
  const focusOrder = [];
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("Tab");
    const active = await page.evaluate(() => ({
      id: document.activeElement.id,
      tag: document.activeElement.tagName,
    }));
    focusOrder.push(active);
    if (active.id === "refok") break;
  }
  assert.equal(await page.evaluate(() => document.activeElement.id), "refok");
  await page.keyboard.press("Space");
  assert.equal(await page.locator("#refok").isChecked(), true);
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.id), "build");
  let before = runs;
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await done();
  assert.equal(runs - before, 1);
  assert.equal(await page.evaluate(() => document.activeElement.id), "play");
  await page.keyboard.press("Space");
  await page.waitForTimeout(450);
  await page.keyboard.press("Space");
  const position = +(await page.locator("#seek").inputValue());
  assert.ok(position > 180);
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.id), "step");
  await page.keyboard.press("Enter");
  assert.equal(+(await page.locator("#seek").inputValue()), position + 1);
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.id), "speed");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  assert.equal(await page.locator("#speed").inputValue(), "50");
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.id), "seek");
  await seek(400);
  before = runs;
  await page.locator('[data-inject="spike"]').scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const b = document.querySelector('[data-inject="spike"]');
    for (let i = 0; i < 20; i++) b.click();
  });
  await done();
  assert.equal(runs - before, 1);
  assert.match(
    await page.locator("#injection-feedback").innerText(),
    /固定 .* MAD .*校正 .* MAD/,
  );
  assert.match(
    await page.locator('[data-inject="spike"]').innerText(),
    /功率 \+2 kW.*電流 \+8.7 A/s,
  );
  const distance = await page.evaluate(
    () =>
      document.querySelector("#injection-feedback").getBoundingClientRect()
        .top -
      document.querySelector(".injection-actions").getBoundingClientRect()
        .bottom,
  );
  assert.ok(distance < 150);
  await page.locator("#injection-feedback").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "delivery/signal-mobile-injection-feedback-390.png",
  });
  await page.tap("#injection-feedback [data-show-results]");
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "comparison",
  );
  await seek(250);
  await page.locator("#approve").focus();
  await page.keyboard.press("Space");
  await done();
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.id), "freeze");
  await page.keyboard.press("Enter");
  await done();
  assert.match(
    await page.locator("#calibration-state").innerText(),
    /受控校正/,
  );
  assert.match(
    await page.locator("#calibration-feedback-scores").innerText(),
    /MAD/,
  );
  await seek(460);
  await page.tap('[data-inject="drift"]');
  await done();
  await seek(550);
  await page.tap('[data-inject="missing"]');
  await done();
  await seek(580);
  await page.tap("#freeze");
  await done();
  assert.match(await page.locator("#calibration-state").innerText(), /已凍結/);
  const oldVersion = +(await page.locator("#current-version").innerText());
  await page.tap("#rollback");
  await done();
  assert.equal(
    +(await page.locator("#current-version").innerText()),
    oldVersion + 1,
  );
  await page.selectOption("#event-filter", "synthetic");
  assert.equal(await page.locator("#events tr").count(), 3);
  assert.match(
    await page.locator(".events-panel thead").innerText(),
    /固定 \/ 校正 · MAD/,
  );
  await page.locator('#events tr[data-i="550"]').focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("#seek").inputValue(), "550");
  const original = await (
    await page.request.get(
      (process.env.DEMO_URL || "http://127.0.0.1:8011") +
        "/api/data?source=uci",
    )
  ).json();
  const download = page.waitForEvent("download");
  await page.tap("#export");
  const saved = JSON.parse(
    fs.readFileSync(await (await download).path(), "utf8"),
  );
  assert.ok(Math.abs(saved.rows[400][0] - original.rows[400][0] - 2) < 1e-8);
  assert.ok(Math.abs(saved.rows[400][2] - original.rows[400][2] - 8.7) < 1e-8);
  const textSizes = await page.evaluate(() =>
    Object.fromEntries(
      [
        "#preview-badge",
        "#calibration-state",
        ".chart-legend",
        "#coverage-count",
        ".interpretation",
        ".events-panel th",
      ].map((selector) => [
        selector,
        parseFloat(getComputedStyle(document.querySelector(selector)).fontSize),
      ]),
    ),
  );
  for (const [selector, size] of Object.entries(textSizes))
    assert.ok(size >= 12, selector + " is too small");
  before = runs;
  await page.locator("#reset").scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const b = document.querySelector("#reset");
    for (let i = 0; i < 12; i++) b.click();
  });
  assert.equal(runs, before);
  assert.equal(await page.locator("#setup").evaluate((e) => e.open), true);
  assert.equal(await page.evaluate(() => document.activeElement.id), "refok");
  assert.equal(await page.locator("#refok").isChecked(), false);
  assert.equal(await page.locator("#approve").isChecked(), false);
  assert.equal(await page.locator("#events tr").count(), 0);
  assert.equal(await page.locator("#injection-feedback").isVisible(), false);
  assert.equal(await page.locator("#calibration-feedback").isVisible(), false);
  assert.equal(await page.locator("#play").isDisabled(), true);
  assert.equal(await page.locator("#export").isDisabled(), true);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.deepEqual(errors, []);
  const result = {
    viewport: "390×844, mobile + touch emulation",
    firstUseExpanded: true,
    keyboardFocusOrder: focusOrder,
    keyboardBuildPlayPauseStepSpeed: true,
    rapidBuildRequests: 1,
    rapidSpikeRequests: 1,
    spikeVerified: { power_kw: 2, current_a: 8.7 },
    nearbyFeedbackDistancePx: distance,
    nearbyComparisonLink: true,
    calibrationFreezeRollback: true,
    eventScoresUnit: "MAD",
    keyboardEventSelection: true,
    textSizes,
    resetRepeated12Times: true,
    resetRestoresReferenceFocus: true,
    overflow: false,
    errors,
  };
  fs.writeFileSync(
    "delivery/ui-mobile-first-qa.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
