/* Native UI QA. Install Playwright separately; set PLAYWRIGHT_MODULE and CHROME_PATH as needed. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.DEMO_URL || "http://127.0.0.1:8011";
const output = process.env.QA_OUTPUT || "delivery";
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  const results = [];
  for (const width of [1440, 768, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
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
    await page.goto(base);
    await page.waitForFunction(() =>
      document.querySelector("#status").textContent.includes("資料已就緒"),
    );
    assert.equal(await page.locator("#source").inputValue(), "uci");
    assert.equal(await page.locator("#play").isDisabled(), true);
    assert.equal(await page.locator("#scores").isVisible(), false);
    await page.screenshot({
      path: `${output}/signal-refined-initial-${width}.png`,
      fullPage: true,
    });
    if (!(await page.locator("#setup").evaluate((e) => e.open)))
      await page.locator("#setup > summary").click();
    await page.click("#build");
    assert.match(await page.locator("#status").innerText(), /請先核准/);
    await page.check("#refok");
    await page.click("#build");
    await page.waitForFunction(() =>
      document.querySelector("#status").textContent.includes("基準已建立"),
    );
    assert.equal(await page.locator("#setup").getAttribute("open"), null);
    await page.click("#play");
    await page.waitForTimeout(650);
    await page.click("#play");
    const before = +(await page.locator("#seek").inputValue());
    await page.click("#step");
    assert.equal(+(await page.locator("#seek").inputValue()), before + 1);
    await page.selectOption("#speed", "50");
    await page.click("#play");
    await page.waitForTimeout(450);
    await page.click("#play");
    assert.ok(+(await page.locator("#seek").inputValue()) >= before + 51);
    await page.selectOption("#speed", "1");
    await seek(250);
    await page.check("#approve");
    await done();
    await page.click("#freeze");
    await done();
    assert.match(
      await page.locator("#calibration-state").innerText(),
      /受控校正/,
    );
    await seek(400);
    await page.click('[data-inject="spike"]');
    await done();
    await seek(460);
    await page.click('[data-inject="drift"]');
    await done();
    await seek(550);
    await page.click('[data-inject="missing"]');
    await done();
    await seek(580);
    await page.selectOption("#event-filter", "synthetic");
    assert.ok((await page.locator("#events tr").count()) >= 3);
    assert.match(await page.locator("#events").innerText(), /合成 尖峰/);
    assert.match(await page.locator("#events").innerText(), /合成 慢性漂移/);
    assert.match(await page.locator("#events").innerText(), /合成 缺值/);
    await page.screenshot({
      path: `${output}/signal-refined-active-${width}.png`,
      fullPage: true,
    });
    await page.click("#freeze");
    await done();
    assert.match(
      await page.locator("#calibration-state").innerText(),
      /已凍結/,
    );
    const oldVersion = +(await page.locator("#current-version").innerText());
    await page.click("#rollback");
    await done();
    assert.equal(
      +(await page.locator("#current-version").innerText()),
      oldVersion + 1,
    );
    await page.locator('#events tr[data-i="550"]').focus();
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("#seek").inputValue(), "550");
    assert.ok(
      await page.locator('#signal line[stroke-dasharray="3 3"]').count(),
    );
    await page.selectOption("#channel", "1");
    assert.equal(await page.locator("#current-unit").innerText(), "V");
    await page.selectOption("#channel", "0");
    const dl = page.waitForEvent("download");
    await page.click("#export");
    const download = await dl;
    const file = await download.path();
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(saved.schema, 2);
    assert.equal(
      saved.current_cursor_state.version,
      Number(await page.locator("#current-version").innerText()),
    );
    assert.match(saved.model_scope, /非目前游標/);
    assert.equal(saved.meta.device, "UCI-household-01");
    assert.ok(saved.controls.actions.some((a) => a.rollback));
    assert.equal(saved.labels["550"], "合成 缺值");
    await page.click("#reset");
    assert.equal(await page.locator("#events tr").count(), 0);
    assert.equal(await page.locator("#play").isDisabled(), true);
    assert.equal(await page.locator("#refok").isChecked(), false);
    assert.equal(await page.locator("#approve").isChecked(), false);
    await page.selectOption("#source", "synthetic");
    await page.waitForFunction(() =>
      document
        .querySelector("#evidence-source")
        .textContent.includes("seed 520"),
    );
    assert.equal(await page.locator("#refok").isChecked(), false);
    if (!(await page.locator("#setup").evaluate((e) => e.open)))
      await page.locator("#setup > summary").click();
    await page.check("#refok");
    await page.click("#build");
    await page.waitForFunction(() =>
      document.querySelector("#status").textContent.includes("基準已建立"),
    );
    await page.locator("#setup summary").first().click();
    await page.fill("#end", "200");
    await page.locator("#end").blur();
    assert.equal(await page.locator("#play").isDisabled(), true);
    assert.equal(await page.locator("#refok").isChecked(), false);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    assert.equal(overflow, false);
    assert.deepEqual(errors, []);
    results.push({
      width,
      errors,
      overflow,
      uci: true,
      referenceGate: true,
      replay: true,
      fastForward: true,
      step: true,
      injections: ["spike", "drift", "missing"],
      calibration: true,
      freezeRollback: true,
      groupedEvents: true,
      keyboardEventSelection: true,
      channelUnits: true,
      export: true,
      resetClearsApproval: true,
      sourceChange: true,
      referenceChangeInvalidatesModel: true,
    });
    await page.close();
  }
  await browser.close();
  fs.writeFileSync(
    `${output}/ui-refined-qa.json`,
    JSON.stringify(results, null, 2),
  );
  console.log(JSON.stringify(results, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
