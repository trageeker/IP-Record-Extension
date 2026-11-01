// 用本地 mihomo（127.0.0.1:7890，控制端口 9090，GLOBAL 模式）验证切换节点后检测是否跟着变：PLAN="TW,DE:noreset,DE:reset" node test/proxy-switch.mjs
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(path.join(process.env.PLAYWRIGHT_DIR, "x.js"));
const { chromium } = require("playwright");
const ext = path.resolve(new URL("../src", import.meta.url).pathname);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sw = async (name) => { const r = await fetch("http://127.0.0.1:9090/proxies/GLOBAL", { method: "PUT", body: JSON.stringify({ name }) }); return r.status; };
const browser = await chromium.launchPersistentContext("", {
  headless: false, proxy: { server: "http://127.0.0.1:7890" },
  args: ["--headless=new", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--no-sandbox"],
});
const worker = browser.serviceWorkers()[0] || await browser.waitForEvent("serviceworker");
const id = new URL(worker.url()).host;
const page = await browser.newPage();
await page.goto(`chrome-extension://${id}/options.html`);
const detect = async (label, settings) => {
  await page.evaluate((s) => chrome.storage.local.set({ settings: s }), settings);
  const t0 = Date.now();
  const r = await page.evaluate(() => chrome.runtime.sendMessage({ type: "detect", url: "https://www.cloudflare.com/", save: false }));
  const line = r.detection.sources.map((s) => `${s.id}=${s.ok ? s.ip.split(".").slice(0, 2).join(".") + "/" + s.country : "ERR:" + s.error}`).join(" ");
  console.log(`${label.padEnd(26)} reset=${r.reset} ${Date.now() - t0}ms  => ${r.detection.result?.ip}/${r.detection.result?.country}\n    ${line}`);
};
const plan = (process.env.PLAN || "TW,DE:noreset,DE:reset,GB:reset,GB:reset").split(",");
const nodes = { TW: "🇹🇼台湾—TK专线", DE: "🇩🇪德国", GB: "🇬🇧英国伦敦-1倍", US: "🇺🇸美国洛杉矶04号", IN: "🇮🇳印度孟买", JP: "🇯🇵日本东京01号-0.1倍" };
for (const step of plan) {
  const [n, mode = "reset"] = step.split(":");
  await sw(nodes[n]);
  await sleep(300);
  await detect(`node=${n} ${mode}`, { resetConnections: mode === "reset", useSiteTrace: true });
}
await browser.close();
