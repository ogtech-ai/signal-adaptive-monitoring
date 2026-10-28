const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
(async () => {
  let b = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  let p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(process.env.DEMO_URL || "http://127.0.0.1:8011");
  await p.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("資料已就緒"),
  );
  const csv = (missing) =>
    "power_kw,voltage_v,current_a\n" +
    Array.from(
      { length: 100 },
      (_, i) => `${missing && i === 10 ? "" : 2 + 0.05 * Math.sin(i)},230,8.7`,
    ).join("\n");
  await p.setInputFiles("#csv", {
    name: "test.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv(true)),
  });
  await p.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("CSV 已載入"),
  );
  assert.equal(await p.locator("#source").inputValue(), "csv");
  assert.match(await p.locator("#current-time").innerText(), /時間未提供/);
  await p.check("#refok");
  await p.click("#build");
  await p.waitForFunction(
    () =>
      document.querySelector("#status").getAttribute("data-kind") === "error",
  );
  assert.match(await p.locator("#status").innerText(), /不可缺值/);
  assert.equal(await p.locator("#play").isDisabled(), true);
  assert.match(await p.locator("#model").textContent(), /尚未建立/);
  await p.setInputFiles("#csv", {
    name: "test-valid.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv(false)),
  });
  await p.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("CSV 已載入"),
  );
  await p.check("#refok");
  await p.click("#build");
  await p.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("基準已建立"),
  );
  await p.locator("#signal").hover({ position: { x: 170, y: 140 } });
  assert.equal(await p.locator("#chart-tooltip").isVisible(), true);
  assert.match(await p.locator("#chart-tooltip").innerText(), /第/);
  await p.click("#reset");
  assert.equal(await p.locator("#chart-tooltip").isVisible(), false);
  await p.route("**/api/run", async (route) => {
    await new Promise((r) => setTimeout(r, 1200));
    try {
      await route.continue();
    } catch {}
  });
  await p.check("#refok");
  await p.click("#build");
  assert.equal(await p.locator("#freeze").isDisabled(), true);
  assert.equal(await p.locator("#export").isDisabled(), true);
  await p.selectOption("#source", "synthetic");
  await p.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("資料已就緒"),
  );
  await p.waitForTimeout(1600);
  assert.equal(await p.locator("#play").isDisabled(), true);
  assert.equal(await p.locator("#refok").isChecked(), false);
  assert.match(await p.locator("#evidence-source").textContent(), /seed 520/);
  assert.deepEqual(errors, []);
  await b.close();
  console.log(
    JSON.stringify(
      {
        csv: true,
        csvUnknownTime: true,
        missingReferenceError: true,
        errorClearsOldModel: true,
        hover: true,
        busyDisablesActions: true,
        sourceChangeAbortsStaleRun: true,
        errors,
      },
      null,
      2,
    ),
  );
})();
