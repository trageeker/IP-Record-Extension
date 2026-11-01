// 后台：检测 + 记录（弹窗关掉也会完成），并按当前标签页是否有记录切换图标和角标。

import { detect } from "./lib/ip.js";
import { addDetection, getRecords, getSettings, byRecent } from "./lib/store.js";
import { hostnameOf, siteOf } from "./lib/domain.js";

const ICON = (kind) => Object.fromEntries([16, 32, 48, 128].map((s) => [s, `icons/${kind}-${s}.png`]));

async function refreshIcon(tabId, url) {
  try {
    if (url === undefined) url = (await chrome.tabs.get(tabId)).url;
    const host = hostnameOf(url || "");
    const site = host && siteOf(host);
    const last = site ? (await getRecords()).filter((r) => r.site === site).sort(byRecent)[0] : null;
    if (last) {
      await chrome.action.setIcon({ tabId, path: ICON("has") });
      await chrome.action.setBadgeText({ tabId, text: last.country || "•" });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: "#16a34a" });
      await chrome.action.setBadgeTextColor?.({ tabId, color: "#ffffff" });
      await chrome.action.setTitle({ tabId, title: `${site}：上次 ${last.country || "?"} ${last.ip}${last.note ? `\n备注：${last.note}` : ""}` });
    } else {
      await chrome.action.setIcon({ tabId, path: ICON("none") });
      await chrome.action.setBadgeText({ tabId, text: "" });
      await chrome.action.setTitle({ tabId, title: site ? `${site}：还没有记录，点击记录` : "站点 IP 记录" });
    }
  } catch {
    // 标签页已关闭等
  }
}

async function refreshAllTabs() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((t) => refreshIcon(t.id, t.url)));
}

chrome.tabs.onActivated.addListener(({ tabId }) => refreshIcon(tabId));
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url || info.status === "complete") refreshIcon(tabId, tab.url);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.records) refreshAllTabs();
});
chrome.runtime.onInstalled.addListener(refreshAllTabs);
chrome.runtime.onStartup.addListener(refreshAllTabs);

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    if (msg?.type === "detect") {
      const settings = await getSettings();
      const host = hostnameOf(msg.url || "");
      const detection = await detect(host, {
        sourceIds: settings.sourceIds, timeout: settings.timeout, useSiteTrace: settings.useSiteTrace && !!host,
      });
      let saved = null;
      if (msg.save && host) saved = await addDetection({ url: msg.url, host, detection }, settings);
      return { ok: true, detection, saved };
    }
    if (msg?.type === "refreshIcons") { await refreshAllTabs(); return { ok: true }; }
    return { ok: false, error: "unknown message" };
  })().then(reply, (e) => reply({ ok: false, error: String(e.message || e) }));
  return true;
});
