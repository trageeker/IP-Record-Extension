import { hostnameOf, siteOf } from "./lib/domain.js";
import { getRecords, getSettings, updateRecord, addManual, search, byRecent, siteStats, chooseSource } from "./lib/store.js";
import { countryName, flag, ago, el, siteUrl, debounce, parseCountry, countryOptions, statsText, showIp, version } from "./lib/ui.js";

const $ = (id) => document.getElementById(id);
const state = { tab: null, host: null, site: null, record: null, merged: false, prevLast: null, records: [], detecting: false };

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove("show"), 1600);
}

function ipBlock(c, tag) {
  return [
    tag ? el("span", { class: "last-tag" }, tag) : null,
    el("span", { class: "flag" }, flag(c.country)),
    el("span", { class: "cc" }, c.country ? `${c.country} · ${countryName(c.country)}` : "国家未知"),
    el("span", { class: "ip", title: "点击选中" }, showIp(c.ip)),
  ].filter(Boolean);
}

function renderSources(sources) {
  const box = $("cur-sources");
  if (!sources?.length) return box.classList.add("hidden");
  const rec = state.record;
  box.querySelector("ul").replaceChildren(...sources.map((s) => {
    const using = rec && s.ok && rec.ip === s.ip && (rec.via === "site" ? s.id === "site" : rec.via === "source" ? rec.viaName === s.name : false);
    return el("li", { class: "src-row" },
      `${s.name}：`,
      s.ok ? el("span", { class: "mono" }, `${s.ip} ${s.country || "?"}`) : el("span", { class: "err" }, s.error),
      s.ms != null ? el("span", { class: "faint" }, `  ${s.ms}ms`) : null,
      rec && s.ok && state.site
        ? el("button", { class: `btn small use${using ? " on" : ""}`, title: "这次以这个源的结果为准", onclick: () => useSource(s, sources) }, using ? "已采用" : "用这个")
        : null,
    );
  }));
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

async function useSource(src, sources) {
  try {
    const res = await chooseSource({ recordId: state.record.id, merged: state.merged, source: src });
    state.merged = res.merged;
    const r = res.record;
    $("cur-ip").replaceChildren(...ipBlock(r));
    const bits = [r.city, r.region, r.org].filter(Boolean).join(" · ");
    $("cur-detail").textContent = [bits, viaText(r)].filter(Boolean).join("　");
    setStatus(res.merged ? `已改用 ${src.name} · 并入已有记录` : `已改用 ${src.name}`, "ok");
    bindNote(r, "备注");
    await loadRecords();
    state.prevLast = r;
    renderSources(sources);
    $("cur-sources").open = true;
    toast(`已以 ${src.name} 为准`);
  } catch (e) {
    toast(String(e.message || e));
  }
}

function viaText(r) {
  if (r.via === "manual") return "手动填写";
  if (r.via === "source") return `以 ${r.viaName} 为准`;
  if (r.via === "site") return "以站点自身看到的 IP 为准";
  return r.total ? `${r.agree ?? r.agreeIp}/${r.total} 个源一致` : "";
}

/** 让备注框编辑某条记录 */
function bindNote(rec, title) {
  state.record = rec;
  $("note-box").classList.remove("hidden");
  $("note-title").textContent = title;
  $("note").value = rec.note || "";
  $("note-state").textContent = "";
}

/** 已有记录的网站：直接显示上次的记录，不发任何请求 */
function showLast(last) {
  $("cur-ip").replaceChildren(...ipBlock(last, "上次"));
  const bits = [last.city, last.org].filter(Boolean).join(" · ");
  $("cur-detail").textContent = [ago(last.lastSeenAt || last.createdAt), bits, viaText(last)].filter(Boolean).join("　");
  const n = state.records.filter((r) => r.site === state.site).length;
  setStatus(`已有记录 · ${n} 条`, "ok");
  bindNote(last, "上次记录的备注");
  state.merged = false;
  renderSources(last.sources);
  $("cur-sources").open = false;
  $("fetch-now").classList.remove("hidden");
}

async function runDetect(save) {
  if (state.detecting) return;
  state.detecting = true;
  $("cur-ip").replaceChildren(el("span", { class: "spinner" }), el("span", { class: "muted" }, "正在重置连接并向多个 IP 源查询…"));
  $("cur-detail").textContent = "";
  $("fetch-now").classList.add("hidden");
  showWarn([]);
  $("redetect").disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({ type: "detect", url: state.tab?.url, save });
    if (!res?.ok) throw new Error(res?.error || "检测失败");
    const { detection, saved } = res;
    const c = detection.result;
    state.record = saved?.record || null;
    state.merged = !!saved?.merged;
    renderSources(detection.sources);
    if (!c) {
      $("cur-ip").replaceChildren(el("span", { class: "muted" }, "所有 IP 源都失败了，可以手动填写"));
      setStatus("检测失败", "warn");
      $("cur-sources").open = true;
      $("fetch-now").textContent = "重试";
      $("fetch-now").classList.remove("hidden");
      if (state.site) openManual();
      return;
    }
    $("cur-ip").replaceChildren(...ipBlock(c));
    const bits = [c.city, c.region, c.org].filter(Boolean).join(" · ");
    $("cur-detail").textContent = [bits, viaText(c)].filter(Boolean).join("　");

    const warns = [];
    const prev = state.prevLast;
    if (prev && prev.ip !== c.ip && prev.ip !== "0.0.0.0") {
      warns.push(prev.country !== c.country
        ? `⚠ 国家变了：上次用的是 ${flag(prev.country)} ${prev.country || "?"} ${countryName(prev.country)} · ${showIp(prev.ip)}（${ago(prev.lastSeenAt || prev.createdAt)}）`
        : `IP 变了，国家相同：上次 ${prev.ip}（${ago(prev.lastSeenAt || prev.createdAt)}）`);
      if (prev.note) warns.push(`上次备注：${prev.note}`);
    }
    const generic = detection.sources.filter((x) => x.ok && x.id !== "site");
    const gTop = [...generic.reduce((m, x) => m.set(x.ip, (m.get(x.ip) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1])[0];
    if (c.via === "site" && gTop && gTop[0] !== c.ip) {
      const g = generic.find((x) => x.ip === gTop[0]);
      warns.push(`ℹ 这个网站看到的是 ${c.ip}（${countryName(c.country)}），而通用 IP 源看到的是 ${gTop[0]}（${countryName(g?.country)}）。说明代理按域名分流：这个网站走的线路和你切换的不是同一个，以网站看到的为准。`);
    } else if (c.mixed) {
      warns.push("各源看到的 IP 不完全一致（可能是分流代理或 IPv4/IPv6 混用），可展开「各 IP 源结果」查看。");
    }
    showWarn(warns);

    if (saved) {
      setStatus(saved.merged ? `此 IP 已记录过 · 第 ${saved.record.seen} 次` : "已记录", "ok");
      bindNote(saved.record, "备注");
      $("note").focus();
      await loadRecords();
      state.prevLast = saved.record;
    } else {
      setStatus(state.site ? "未记录" : "当前页不是网站", "");
    }
    $("fetch-now").textContent = "获取当前 IP";
    if (state.site) $("fetch-now").classList.remove("hidden");
  } catch (e) {
    $("cur-ip").replaceChildren(el("span", { class: "muted" }, String(e.message || e)));
    setStatus("出错", "warn");
  } finally {
    state.detecting = false;
    $("redetect").disabled = false;
  }
}

// ------------------------------------------------------------------ 手动填写
function openManual() {
  $("manual-box").classList.remove("hidden");
  $("m-err").textContent = "";
  if (!$("countries").children.length) $("countries").replaceChildren(...countryOptions());
  $("m-ip").focus();
}

async function saveManual() {
  const cc = parseCountry($("m-country").value);
  if (cc === null) { $("m-err").textContent = "国家没认出来，请填两位代码如 JP"; return; }
  try {
    const rec = await addManual({ url: state.tab?.url, host: state.host, ip: $("m-ip").value, country: cc, note: $("m-note").value });
    $("manual-box").classList.add("hidden");
    $("m-ip").value = ""; $("m-country").value = ""; $("m-note").value = "";
    $("cur-ip").replaceChildren(...ipBlock(rec));
    $("cur-detail").textContent = "手动填写";
    showWarn([]);
    setStatus("已记录", "ok");
    bindNote(rec, "备注");
    state.merged = false;
    $("cur-sources").classList.add("hidden");
    $("note").focus();
    await loadRecords();
    state.prevLast = rec;
    toast("已保存");
  } catch (e) {
    $("m-err").textContent = String(e.message || e);
  }
}

// ------------------------------------------------------------------ 备注
const saveNote = debounce(async () => {
  if (!state.record) return;
  await updateRecord(state.record.id, { note: $("note").value });
  state.record.note = $("note").value;
  $("note-state").textContent = "已保存";
  await loadRecords();
}, 350);

// ------------------------------------------------------------------ 列表
async function loadRecords() {
  state.records = await getRecords();
  renderList();
  const t = state.site ? statsText(siteStats(state.records, state.site)) : "";
  $("cur-stats").textContent = t;
  $("cur-stats").classList.toggle("hidden", !t);
}

function recItem(r) {
  return el("div", { class: "rec" },
    el("div", { class: "top" },
      el("span", { class: "flag" }, flag(r.country)),
      el("span", { class: "site", title: r.host }, r.site),
      el("span", { class: "mono" }, showIp(r.ip)),
    ),
    el("div", { class: "meta" },
      el("span", {}, r.country ? countryName(r.country) : "国家未知"),
      el("span", { title: "最近使用" }, ago(r.lastSeenAt || r.createdAt)),
      r.seen > 1 ? el("span", {}, `用过 ${r.seen} 次`) : null,
      r.via === "manual" ? el("span", {}, "手动") : null,
      r.id === state.record?.id ? el("span", { class: "chip ok" }, "编辑中") : null,
    ),
    el("div", { class: "actions" },
      el("button", {
        class: "btn small", title: "复制 IP",
        onclick: async () => { if (r.ip === "0.0.0.0") return toast("这条没填 IP"); await navigator.clipboard.writeText(r.ip); toast("已复制 IP"); },
      }, "复制"),
      el("button", { class: "btn small primary", title: "打开此站点", onclick: () => chrome.tabs.create({ url: siteUrl(r) }) }, "跳转"),
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
  } else if (state.site) {
    items = state.records.filter((r) => r.site === state.site).sort(byRecent);
    $("list-title").textContent = `${state.site} 的记录 · ${items.length} 条`;
  } else {
    items = [...state.records].sort(byRecent);
    $("list-title").textContent = "最近的记录";
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

// ------------------------------------------------------------------ init
async function init() {
  $("ver").textContent = version();
  // ?tabId= 仅供测试：把弹窗页面当普通标签页打开时指定目标标签页
  const forced = Number(new URLSearchParams(location.search).get("tabId"));
  const [tab] = forced ? [await chrome.tabs.get(forced)] : await chrome.tabs.query({ active: true, currentWindow: true });
  state.tab = tab;
  state.host = hostnameOf(tab?.url || "");
  state.site = state.host ? siteOf(state.host) : null;
  $("cur-site").textContent = state.site ? state.host : "当前页不是网站";
  $("cur-site").title = tab?.url || "";
  if (!state.site) $("manual-toggle").classList.add("hidden");

  await loadRecords();
  state.prevLast = state.records.filter((r) => r.site === state.site).sort(byRecent)[0] || null;
  const settings = await getSettings();

  if (state.prevLast) {
    showLast(state.prevLast);
  } else if (state.site && settings.autoRecord) {
    setStatus("记录中…");
    runDetect(true);
  } else {
    setStatus(state.site ? "无记录" : "—");
    $("cur-ip").replaceChildren(el("span", { class: "muted" }, state.site ? "还没有记录，点「获取当前 IP」记录" : "可点「查看当前 IP」检测出口 IP"));
    $("fetch-now").textContent = state.site ? "获取当前 IP" : "查看当前 IP";
    $("fetch-now").classList.remove("hidden");
  }

  $("redetect").addEventListener("click", () => runDetect(!!state.site));
  $("fetch-now").addEventListener("click", () => runDetect(!!state.site));
  $("open-options").addEventListener("click", openOptions);
  $("manual-toggle").addEventListener("click", () => ($("manual-box").classList.contains("hidden") ? openManual() : $("manual-box").classList.add("hidden")));
  $("m-cancel").addEventListener("click", () => $("manual-box").classList.add("hidden"));
  $("m-save").addEventListener("click", saveManual);
  for (const id of ["m-ip", "m-country"]) $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") saveManual(); });
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
