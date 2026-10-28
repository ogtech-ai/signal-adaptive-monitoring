const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
(async () => {
  let b = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  let p = await b.newPage({ viewport: { width: 390, height: 844 } });
  await p.goto(process.env.DEMO_URL || "http://127.0.0.1:8011");
  await p.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("資料已就緒"),
  );
  const result = await p.evaluate(() => {
    const lum = (c) => {
      const x = c
        .match(/[\d.]+/g)
        .slice(0, 3)
        .map(Number)
        .map((v) => {
          v /= 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        });
      return x[0] * 0.2126 + x[1] * 0.7152 + x[2] * 0.0722;
    };
    return [
      "#preview-badge",
      "#calibration-state",
      ".chart-legend",
      "#coverage-count",
      ".interpretation",
      ".events-panel th",
    ].map((selector) => {
      let el = document.querySelector(selector),
        css = getComputedStyle(el),
        bg = css.backgroundColor;
      while (bg === "rgba(0, 0, 0, 0)" || bg === "transparent") {
        el = el.parentElement;
        bg = getComputedStyle(el).backgroundColor;
      }
      let a = lum(css.color),
        b = lum(bg);
      return {
        selector,
        font: parseFloat(css.fontSize),
        ratio: +((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2),
        foreground: css.color,
        background: bg,
      };
    });
  });
  result.forEach((r) => {
    assert.ok(r.font >= 12);
    assert.ok(r.ratio >= 4.5, r.selector + " ratio " + r.ratio);
  });
  require("fs").writeFileSync(
    "delivery/ui-readability-qa.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
  await b.close();
})();
