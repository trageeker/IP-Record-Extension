import { hostnameOf, siteOf } from "./lib/domain.js";
import { getRecords, getSettings, updateRecord, search, byRecent } from "./lib/store.js";
import { countryName, flag, ago, el, siteUrl, debounce } from "./lib/ui.js";

const $ = (id) => document.getElementById(id);
const state = { tab: null, host: null, site: null, record: null, prevLast: null, records: [] };

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove("show"), 1600);
}

function ipBlock(c) {
  return [
    el("span", { class: "flag" }, flag(c.country)),
    el("span", { class: "cc" }, c.country ? `${c.country} · ${countryName(c.country)}` : "国家未知"),
    el("span", { class: "ip", title: "点击选中" }, c.ip),
  ];
}

function renderSources(sources) {
  const box = $("cur-sources");
  const ul = box.querySelector("ul");
  ul.replaceChildren(...sources.map((s) => el("li", {},
    `${s.name}：`,
    s.ok ? el("span", { class: "mono" }, `${s.ip} ${s.country || "?"}`) : el("span", { class: "err" }, s.error),
    s.ms != null ? el("span", { class: "faint" }, `  ${s.ms}ms`) : null,
  )));
  box.classList.remove("hidden");
}

function setStatus(text, kind = "") {
  const c = $("cur-status");
  c.textContent = text;
  c.className = `chip ${kind}`;
}

function showWarn(lines) {
  const w = $("cur-warn");
  if (!lines.length) return w.classList.add("hidden");
  w.replaceChildren(...lines.map((l) => el("div", {}, l)));
  w.classList.remove("hidden");
}

async function runDetect(save) {
  $("cur-ip").replaceChildren(el("span", { class: "spinner" }), el("span", { class: "muted" }, "正在向多个 IP 源查询…"));
  $("cur-detail").textContent = "";
  showWarn([]);
  $("redetect").disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({ type: "detect", url: state.tab?.url, save });
    if (!res?.ok) throw new Error(res?.error || "检测失败");
    const { detection, saved } = res;
    const c = detection.result;
    renderSources(detection.sources);
    if (!c) {
      $("cur-ip").replaceChildren(el("span", { class: "muted" }, "所有 IP 源都失败了，请检查网络或代理"));
      setStatus("检测失败", "warn");
      return;
    }
    $("cur-ip").replaceChildren(...ipBlock(c));
    const bits = [c.city, c.region, c.org].filter(Boolean).join(" · ");
    const how = c.via === "site" ? "以站点自身看到的 IP 为准" : `${c.agreeIp}/${c.total} 个源一致`;
    $("cur-detail").textContent = [bits, how].filter(Boolean).join("　");

    const warns = [];
    const prev = state.prevLast;
    if (prev && prev.ip !== c.ip) {
      warns.push(prev.country !== c.country
        ? `⚠ 国家变了：上次用的是 ${flag(prev.country)} ${prev.country || "?"} ${countryName(prev.country)} · ${prev.ip}（${ago(prev.lastSeenAt || prev.createdAt)}）`
        : `IP 变了，国家相同：上次 ${prev.ip}（${ago(prev.lastSeenAt || prev.createdAt)}）`);
      if (prev.note) warns.push(`上次备注：${prev.note}`);
    }
    if (c.mixed) warns.push("各源看到的 IP 不完全一致（可能是分流代理或 IPv4/IPv6 混用），可展开「各 IP 源结果」查看。");
    showWarn(warns);

    if (saved) {
      state.record = saved.record;
      setStatus(saved.merged ? `此 IP 已记录过 · 第 ${saved.record.seen} 次` : "已记录", "ok");
      $("note-box").classList.remove("hidden");
      $("note").value = saved.record.note || "";
      $("note-state").textContent = "";
      $("note").focus();
      await loadRecords();
    } else if (state.site) {
      setStatus(state.records.some((r) => r.site === state.site) ? "有记录 · 未记录本次" : "无记录", "");
    } else {
      setStatus("当前页不是网站", "");
    }
  } catch (e) {
    $("cur-ip").replaceChildren(el("span", { class: "muted" }, String(e.message || e)));
    setStatus("出错", "warn");
  } finally {
    $("redetect").disabled = false;
  }
}

const saveNote = debounce(async () => {
  if (!state.record) return;
  await updateRecord(state.record.id, { note: $("note").value });
  state.record.note = $("note").value;
  $("note-state").textContent = "已保存";
  renderList();
}, 350);

async function loadRecords() {
  state.records = await getRecords();
  renderList();
}

function recItem(r) {
  const isCurrent = r.site === state.site;
  return el("div", { class: "rec" },
    el("div", { class: "top" },
      el("span", { class: "flag" }, flag(r.country)),
      el("span", { class: "site", title: r.host }, r.site),
      el("span", { class: "mono" }, r.ip),
    ),
    el("div", { class: "meta" },
      el("span", {}, r.country ? countryName(r.country) : "国家未知"),
      el("span", { title: "最近使用" }, ago(r.lastSeenAt || r.createdAt)),
      r.seen > 1 ? el("span", {}, `用过 ${r.seen} 次`) : null,
      r.id === state.record?.id ? el("span", { class: "chip ok" }, "本次") : null,
    ),
    el("div", { class: "actions" },
      el("button", {
        class: "btn small", title: "复制 IP",
        onclick: async () => { await navigator.clipboard.writeText(r.ip); toast("已复制 IP"); },
      }, "复制"),
      el("button", {
        class: "btn small primary", title: isCurrent ? "在新标签页重新打开此站点" : "打开此站点",
        onclick: () => chrome.tabs.create({ url: siteUrl(r) }),
      }, "跳转"),
    ),
    el("div", { class: "note" }, r.note || ""),
  );
}

function renderList() {
  const q = $("q").value.trim();
  let items;
  if (q) {
    items = search(state.records, q);
    $("list-title").textContent = `搜索结果 · ${items.length} 条`;
  } else {
    items = state.records.filter((r) => r.site === state.site).sort(byRecent);
    $("list-title").textContent = state.site ? `${state.site} 的记录 · ${items.length} 条` : "最近的记录";
    if (!state.site) items = [...state.records].sort(byRecent);
  }
  const shown = items.slice(0, 30);
  const list = $("list");
  if (!shown.length) {
    list.replaceChildren(el("div", { class: "empty" }, q ? "没有匹配的记录" : "此站点暂无历史记录"));
    return;
  }
  list.replaceChildren(...shown.map(recItem));
  if (items.length > shown.length) {
    list.append(el("button", { class: "btn small more", onclick: openOptions }, `还有 ${items.length - shown.length} 条，在管理页查看`));
  }
}

function openOptions() {
  const q = $("q").value.trim();
  chrome.tabs.create({ url: chrome.runtime.getURL(`options.html${q ? `#q=${encodeURIComponent(q)}` : ""}`) });
  window.close();
}

async function init() {
  // ?tabId= 仅供测试：把弹窗页面当普通标签页打开时指定目标标签页
  const forced = Number(new URLSearchParams(location.search).get("tabId"));
  const [tab] = forced ? [await chrome.tabs.get(forced)] : await chrome.tabs.query({ active: true, currentWindow: true });
  state.tab = tab;
  state.host = hostnameOf(tab?.url || "");
  state.site = state.host ? siteOf(state.host) : null;
  $("cur-site").textContent = state.site ? state.host : "当前页不是网站（只查看出口 IP）";
  $("cur-site").title = tab?.url || "";

  await loadRecords();
  state.prevLast = state.records.filter((r) => r.site === state.site).sort(byRecent)[0] || null;

  const settings = await getSettings();
  if (state.site && settings.autoRecord) {
    setStatus("记录中…");
    runDetect(true);
  } else {
    setStatus(state.site ? (state.prevLast ? "有记录" : "无记录") : "—");
    runDetect(false);
    if (state.site) $("cur-detail").title = "设置里关闭了自动记录，点右上角 ↻ 记录本次";
  }

  $("redetect").addEventListener("click", () => runDetect(!!state.site));
  $("open-options").addEventListener("click", openOptions);
  $("note").addEventListener("input", () => { $("note-state").textContent = "…"; saveNote(); });
  $("note-save").addEventListener("click", async () => {
    if (!state.record) return;
    await updateRecord(state.record.id, { note: $("note").value });
    toast("备注已保存");
    await loadRecords();
  });
  $("note").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) $("note-save").click();
  });
  $("q").addEventListener("input", debounce(renderList, 120));
  $("q").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("list").querySelector(".btn.primary")?.click();
  });
}

init();
