// 真实 Chrome 端到端：node test/e2e.mjs（需要 playwright，路径用 PLAYWRIGHT_DIR 指定）
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
const require = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, "x.js") : import.meta.url);
const { chromium } = require("playwright");
const ext = path.resolve(new URL("../src", import.meta.url).pathname);
const shots = process.env.SHOTS || "/tmp/sir-shots";
fs.mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(page, fn, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await page.evaluate(fn).catch(() => false)) return; await sleep(250); }
  throw new Error("timeout waiting for " + fn);
}
const ok = (c, m) => { if (!c) throw new Error("FAIL: " + m); console.log("✓", m); };

const pv = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
let proxy;
if (pv) { const u = new URL(pv); proxy = { server: `${u.protocol}//${u.host}`, username: decodeURIComponent(u.username), password: decodeURIComponent(u.password) }; }
const browser = await chromium.launchPersistentContext("", {
  headless: false, locale: "zh-CN", proxy, ignoreHTTPSErrors: true,
  args: ["--headless=new", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--no-sandbox"],
});
try {
  const sw = browser.serviceWorkers()[0] || await browser.waitForEvent("serviceworker");
  const extId = new URL(sw.url()).host;

  const site = browser.pages()[0] || await browser.newPage();
  await site.goto("https://www.cloudflare.com/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await sleep(1500);
  const icon0 = await sw.evaluate(async () => { const t = (await chrome.tabs.query({})).find((x) => /cloudflare\.com/.test(x.url)); return { badge: await chrome.action.getBadgeText({ tabId: t.id }), title: await chrome.action.getTitle({ tabId: t.id }) }; });
  ok(icon0.badge === "" && icon0.title.includes("还没有记录"), "无记录时图标为灰色、无角标: " + icon0.title);

  async function openPopup() {
    // 用指定标签页打开弹窗页面（无头模式下没有真正的工具栏弹窗）
    const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: "https://*/*" })).find((t) => /cloudflare\.com/.test(t.url)).id);
    const p = await browser.newPage();
    await p.setViewportSize({ width: 390, height: 600 });
    await p.goto(`chrome-extension://${extId}/popup.html?tabId=${tabId}`);
    return p;
  }

  let popup = await openPopup();
  await waitFor(popup, () => !document.querySelector("#note-box").classList.contains("hidden") || /失败|出错/.test(document.body.innerText));
  const info = await popup.evaluate(() => ({ status: document.querySelector("#cur-status").textContent, ip: document.querySelector("#cur-ip").innerText, detail: document.querySelector("#cur-detail").textContent, focus: document.activeElement?.id }));
  console.log(info);
  ok(info.status === "已记录", "点击即记录");
  ok(info.focus === "note", "备注框获得焦点");
  ok(info.detail.includes("站点自身"), "cloudflare.com 走站点自身 trace");
  await popup.type("#note", "测试备注：不能用美国 IP");
  await sleep(700);
  await popup.screenshot({ path: `${shots}/popup-new.png`, fullPage: true });
  let recs = await sw.evaluate(async () => (await chrome.storage.local.get("records")).records);
  ok(recs.length === 1 && recs[0].note === "测试备注：不能用美国 IP" && recs[0].site === "cloudflare.com", "记录 + 备注已保存");
  await popup.close().catch(() => {});
  await sleep(500);

  const icon1 = await sw.evaluate(async () => { const t = (await chrome.tabs.query({})).find((x) => /cloudflare\.com/.test(x.url)); return { badge: await chrome.action.getBadgeText({ tabId: t.id }), title: await chrome.action.getTitle({ tabId: t.id }) }; });
  ok(icon1.badge === recs[0].country && icon1.title.includes("备注"), `有记录时角标 ${icon1.badge}`);

  // 第二次点击：同 IP 合并
  popup = await openPopup();
  await waitFor(popup, () => /已记录过/.test(document.querySelector("#cur-status").textContent));
  ok(await popup.$eval("#note", (n) => n.value) === "测试备注：不能用美国 IP", "同 IP 再次点击：合并并带出原备注");
  // 构造一条日本记录用于提醒和搜索
  await sw.evaluate(async () => {
    const { records } = await chrome.storage.local.get("records");
    records.push({ id: "jp1", site: "example.jp", host: "www.example.jp", url: "https://www.example.jp/", ip: "203.0.113.9", country: "JP", note: "只能用日本", createdAt: Date.now() - 86400e3 * 3, lastSeenAt: Date.now() - 86400e3 * 3, updatedAt: 1, seen: 1 });
    await chrome.storage.local.set({ records });
  });
  await popup.close().catch(() => {});
  popup = await openPopup();
  await popup.waitForSelector("#q");
  await popup.type("#q", "example.jp");
  await sleep(400);
  const res = await popup.$$eval("#list .rec", (els) => els.map((e) => e.innerText));
  ok(res.length === 1 && res[0].includes("203.0.113.9") && res[0].includes("只能用日本"), "弹窗搜索 example.jp");
  await popup.screenshot({ path: `${shots}/popup-search.png`, fullPage: true });
  await popup.click("#list .btn.primary");
  await sleep(1500);
  const urls = await sw.evaluate(async () => (await chrome.tabs.query({})).map((t) => t.pendingUrl || t.url));
  ok(urls.some((u) => u.startsWith("https://www.example.jp")), "点击跳转打开站点");
  await popup.close().catch(() => {});

  // 管理页
  const opt = await browser.newPage();
  await opt.setViewportSize({ width: 1200, height: 720 });
  await opt.goto(`chrome-extension://${extId}/options.html#q=cloudflare`);
  await opt.waitForSelector("#rows tr");
  ok((await opt.$$("#rows tr")).length === 1, "管理页带搜索词打开");
  await opt.screenshot({ path: `${shots}/options.png` });
  await opt.$eval("#q", (n) => { n.value = ""; n.dispatchEvent(new Event("input")); });
  await sleep(300);
  ok((await opt.$$("#rows tr")).length === 2, "管理页列出全部");
  // 编辑备注
  await opt.fill("#rows tr:last-child textarea", "改过的备注");
  await sleep(700);
  recs = await sw.evaluate(async () => (await chrome.storage.local.get("records")).records);
  ok(recs.some((r) => r.note === "改过的备注"), "管理页编辑备注");
  // 导出导入
  const exported = await opt.evaluate(async () => { const m = await import("./lib/store.js"); return JSON.stringify(await m.exportJson()); });
  await sw.evaluate(() => chrome.storage.local.set({ records: [] }));
  await opt.click('[data-tab="io"]');
  fs.writeFileSync("/tmp/sir-export.json", exported);
  await opt.setInputFiles("#import-file", "/tmp/sir-export.json");
  await waitFor(opt, () => /导入完成/.test(document.querySelector("#import-result").textContent));
  ok((await opt.$eval("#import-result", (n) => n.textContent)).includes("新增 2"), "导入 JSON");
  await opt.click('[data-tab="settings"]');
  await opt.click("#test-sources");
  await waitFor(opt, () => /结论|全部失败/.test(document.querySelector("#test-state").textContent));
  console.log(await opt.$eval("#test-result", (n) => n.innerText));
  await opt.screenshot({ path: `${shots}/settings.png`, fullPage: true });
  console.log("ALL OK");
} finally {
  await browser.close();
}
