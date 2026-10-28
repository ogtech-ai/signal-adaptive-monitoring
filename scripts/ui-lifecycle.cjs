const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
(async () => {
  const b = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  globalThis.qaBrowser = b;
  const result = [];
  for (const width of [1440, 390]) {
    const p = await b.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(process.env.DEMO_URL || "http://127.0.0.1:8011");
    await p.waitForFunction(() => !document.querySelector("#play").disabled);
    await p.waitForFunction(
      () => parseInt(document.querySelector("#windows").textContent) > 0,
    );
    await p.click("#play");
    assert.match(await p.locator("#stream-state").innerText(), /暫停/);
    const first = await p.locator("#total").innerText();
    await p.waitForTimeout(1100);
    assert.equal(await p.locator("#total").innerText(), first);
    await p.locator("#step").focus();
    await p.keyboard.press("Enter");
    await p.waitForFunction(() => !document.querySelector("#step").disabled);
    assert.equal(await p.evaluate(() => document.activeElement.id), "step");
    assert.notEqual(await p.locator("#total").innerText(), first);
    await p.selectOption("#speed", "4");
    await p.click("#play");
    await p.waitForFunction(
      () => document.querySelector("#active").textContent !== "v1",
      { timeout: 60000 },
    );
    await p.waitForFunction(
      () =>
        document.querySelector("#training-state").textContent === "邊界阻擋",
      { timeout: 60000 },
    );
    await p.click("#play");
    await p.waitForFunction(() => !document.querySelector("#export").disabled);
    assert.equal(await p.locator("#candidates tr").count(), 3);
    await p.screenshot({
      path: `delivery/lifecycle-${width}-full.png`,
      fullPage: true,
    });
    await p.screenshot({ path: `delivery/lifecycle-${width}-viewport.png` });
    let dl = p.waitForEvent("download");
    await p.click("#export");
    const data = JSON.parse(fs.readFileSync(await (await dl).path(), "utf8"));
    assert.equal(data.schema, "lifecycle-1");
    assert.ok(data.training_history.some((x) => x.state === "promoted"));
    assert.ok(data.training_history.some((x) => x.state === "rejected"));
    assert.ok(data.immutable_drift > data.drift_threshold);
    assert.ok(data.points.length <= data.limits.points);
    for (const j of data.training_history.filter(
      (x) => x.state === "promoted",
    )) {
      assert.ok(j.test.synthetic_recall >= 0.92);
      assert.ok(j.test.unsafe_drift_recall >= 0.9);
      assert.ok(j.test.anchor_alert_rate <= 0.12);
      assert.ok(j.splits.train.end < j.splits.calibration.start);
      assert.ok(j.splits.selection.end < j.splits.test.start);
    }
    const version = await p.locator("#active").innerText();
    await p.click("#rollback");
    await p.waitForFunction(() => !document.querySelector("#export").disabled);
    assert.notEqual(await p.locator("#active").innerText(), version);
    assert.equal(await p.locator("#auto-training").isChecked(), false);
    assert.match(await p.locator("#training-history").innerText(), /回退/);
    await p.locator("#auto-training").focus();
    await p.keyboard.press("Space");
    await p.waitForFunction(
      () => !document.querySelector("#auto-training").disabled,
    );
    assert.equal(await p.locator("#auto-training").isChecked(), true);
    assert.equal(
      await p.evaluate(() => document.activeElement.id),
      "auto-training",
    );
    await p.locator(".secondary-controls > summary").click();
    await p.click('[data-inject="missing"]');
    await p.waitForFunction(() => !document.querySelector("#step").disabled);
    await p.click("#step");
    await p.waitForFunction(() => !document.querySelector("#step").disabled);
    assert.match(await p.locator("#events").innerText(), /手動合成missing/);
    await p.evaluate(() => {
      for (let i = 0; i < 20; i++) document.querySelector("#reset").click();
    });
    await p.waitForFunction(() => !document.querySelector("#play").disabled);
    if ((await p.locator("#play").innerText()).includes("暫停"))
      await p.click("#play");
    assert.equal(await p.locator("#active").innerText(), "v1");
    assert.equal(await p.locator("#candidates tr").count(), 0);
    assert.equal(await p.locator("#versions .version-item").count(), 1);
    assert.equal(
      await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    assert.deepEqual(errors, []);
    result.push({
      width,
      errors,
      overflow: false,
      automaticStream: true,
      threeCandidates: true,
      realPromotionAndRejection: true,
      unsafeBoundaryBlocks: true,
      immutableDriftVisible: true,
      rollback: true,
      keyboard: true,
      manualSecondary: true,
      repeatedReset20: true,
      versionsBeforeRollback: data.versions.length,
      trainingJobs: data.training_history.length,
      totalBeforeReset: data.total,
    });
    await p.close();
  }
  await b.close();
  fs.writeFileSync(
    "delivery/lifecycle-ui-qa.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
})().catch(async (e) => {
  console.error(e);
  if (globalThis.qaBrowser) await globalThis.qaBrowser.close();
  process.exitCode = 1;
});
