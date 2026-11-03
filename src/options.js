import { SOURCES, detect } from "./lib/ip.js";
import {
  getRecords, getSettings, saveSettings, updateRecord, deleteRecord, clearAll,
  search, byRecent, siteStats, exportJson, exportCsv, importText,
} from "./lib/store.js";
import { probe } from "./lib/mihomo.js";
import { countryName, flag, ago, fmtDate, el, siteUrl, download, stamp, debounce, parseCountry, statsText, showIp, version, ipEl } from "./lib/ui.js";

const $ = (id) => document.getElementById(id);
let records = [];

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove("show"), 1800);
}

// ------------------------------------------------------------------ tabs
function showTab(name) {
  for (const b of document.querySelectorAll(".tab")) b.classList.toggle("active", b.dataset.tab === name);
  for (const p of document.querySelectorAll(".panel")) p.classList.toggle("hidden", p.id !== `tab-${name}`);
}
for (const b of document.querySelectorAll(".tab")) b.addEventListener("click", () => showTab(b.dataset.tab));

// ------------------------------------------------------------------ records
async function load() {
  records = await getRecords();
  const sel = $("country");
  const cur = sel.value;
  const ccs = [...new Set(records.map((r) => r.country).filter(Boolean))].sort();
  sel.replaceChildren(el("option", { value: "" }, "全部国家"),
    ...ccs.map((c) => el("option", { value: c }, `${flag(c)} ${c} ${countryName(c)}`)));
  sel.value = ccs.includes(cur) ? cur : "";
  render();
}

function filtered() {
  let items = search(records, $("q").value);
  const cc = $("country").value;
  if (cc) items = items.filter((r) => r.country === cc);
  if ($("latest-only").checked) {
    const seen = new Set();
    items = [...items].sort(byRecent).filter((r) => (seen.has(r.site) ? false : seen.add(r.site)));
  }
  return items;
}

function row(r) {
  const note = el("textarea", { rows: 1, placeholder: "添加备注…" });
  note.value = r.note || "";
  const save = debounce(async () => { await updateRecord(r.id, { note: note.value }); r.note = note.value; }, 400);
  note.addEventListener("input", save);
  note.addEventListener("blur", async () => { await updateRecord(r.id, { note: note.value }); });

  const srcTitle = (r.sources || []).map((s) => `${s.name}: ${s.ok ? `${s.ip} ${s.country || "?"}` : s.error}`).join("\n");
  return el("tr", {},
    el("td", {},
      el("div", { class: "site" }, r.site),
      r.host !== r.site ? el("div", { class: "host" }, r.host) : null,
      statsText(siteStats(records, r.site)) ? el("div", { class: "sub stats-line" }, statsText(siteStats(records, r.site))) : null,
    ),
    el("td", { title: srcTitle || null },
      el("div", {}, ipEl(r.ip, "ip")),
      el("div", { class: "sub" }, `${flag(r.country)} ${r.country || "?"} ${countryName(r.country)}`),
      el("div", { class: "sub" }, [r.city, r.org].filter(Boolean).join(" · ")),
      el("div", { class: "sub faint via" }, r.via === "manual" ? "手动填写" : r.via === "source" ? `以 ${r.viaName} 为准` : r.via === "site" ? "站点自身看到的 IP" : r.total ? `${r.agree}/${r.total} 源一致` : "导入"),
    ),
    el("td", { class: "note" }, note),
    el("td", { title: `首次：${fmtDate(r.createdAt)}\n最近：${fmtDate(r.lastSeenAt)}` },
      el("div", {}, ago(r.lastSeenAt || r.createdAt)),
      r.seen > 1 ? el("div", { class: "sub" }, `用过 ${r.seen} 次`) : null,
    ),
    el("td", { class: "acts" },
      el("button", { class: "btn small", onclick: async () => { if (r.ip === "0.0.0.0") return toast("这条没填 IP"); await navigator.clipboard.writeText(r.ip); toast("已复制 IP"); } }, "复制"),
      el("button", {
        class: "btn small", title: "修改 IP 和国家",
        onclick: async () => {
          const ip = prompt("IP（留空表示未填）", r.ip === "0.0.0.0" ? "" : r.ip);
          if (ip == null) return;
          const ccIn = prompt("国家（两位代码，如 JP；或中文名）", r.country || "");
          if (ccIn == null) return;
          const cc = parseCountry(ccIn);
          if (cc === null) return toast("国家没认出来");
          try { await updateRecord(r.id, { ip, country: cc }); toast("已修改"); load(); } catch (e) { toast(e.message); }
        },
      }, "改"),
      el("button", { class: "btn small primary", onclick: () => chrome.tabs.create({ url: siteUrl(r) }) }, "跳转"),
      el("button", {
        class: "btn small danger", title: "删除",
        onclick: async () => {
          if (!confirm(`删除 ${r.site} 的这条记录（${r.ip}）？`)) return;
          await deleteRecord(r.id);
          toast("已删除");
          load();
        },
      }, "删除"),
    ),
  );
}

function render() {
  const items = filtered();
  $("rows").replaceChildren(...items.slice(0, 1000).map(row));
  const sites = new Set(records.map((r) => r.site)).size;
  $("stats").textContent = `共 ${records.length} 条记录，${sites} 个站点` + (items.length !== records.length ? `；当前显示 ${items.length} 条` : "");
  $("empty").classList.toggle("hidden", items.length > 0);
  if (!items.length && records.length) $("empty").textContent = "没有匹配的记录";
}

$("q").addEventListener("input", debounce(() => {
  history.replaceState(null, "", $("q").value ? `#q=${encodeURIComponent($("q").value)}` : location.pathname);
  render();
}, 120));
$("country").addEventListener("change", render);
$("latest-only").addEventListener("change", render);
chrome.storage.onChanged.addListener((c, area) => {
  if (area === "local" && c.records && document.activeElement?.tagName !== "TEXTAREA") load();
});

// ------------------------------------------------------------------ import / export
$("export-json").addEventListener("click", async () => {
  download(`site-ip-records-${stamp()}.json`, JSON.stringify(await exportJson(), null, 2), "application/json");
});
$("export-csv").addEventListener("click", async () => {
  download(`site-ip-records-${stamp()}.csv`, await exportCsv(), "text/csv;charset=utf-8");
});
$("import-btn").addEventListener("click", () => $("import-file").click());
$("import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const mode = document.querySelector('input[name="import-mode"]:checked').value;
  if (mode === "replace" && !confirm("覆盖会删除现有的全部记录，确定吗？")) return;
  try {
    const r = await importText(await file.text(), mode);
    $("import-result").textContent = `导入完成：新增 ${r.added}，更新 ${r.updated}${r.skipped ? `，跳过无效 ${r.skipped}` : ""}，现共 ${r.total} 条`;
    toast("导入完成");
    load();
  } catch (err) {
    $("import-result").textContent = `导入失败：${err.message || err}`;
  }
});
$("clear-all").addEventListener("click", async () => {
  if (!confirm("清空全部记录？此操作无法撤销。")) return;
  await clearAll();
  toast("已清空");
  load();
});

// ------------------------------------------------------------------ settings
async function initSettings() {
  const s = await getSettings();
  for (const k of ["autoRecord", "resetConnections", "mergeSameIp", "useSiteTrace"]) {
    const box = $(`s-${k}`);
    box.checked = !!s[k];
    box.addEventListener("change", async () => { await saveSettings({ [k]: box.checked }); toast("已保存"); });
  }
  const pbox = $("s-proxyReset");
  pbox.checked = !!s.proxyReset;
  pbox.addEventListener("change", async () => { await saveSettings({ proxyReset: pbox.checked }); toast("已保存"); });
  for (const k of ["proxyUrl", "proxySecret", "proxyScope"]) {
    const inp = $(`s-${k}`);
    inp.value = s[k] ?? "";
    inp.addEventListener("change", async () => { await saveSettings({ [k]: inp.value.trim() }); toast("已保存"); });
  }
  $("test-proxy").addEventListener("click", async () => {
    $("proxy-state").textContent = "测试中…";
    const r = await probe({ url: $("s-proxyUrl").value, secret: $("s-proxySecret").value.trim() });
    $("proxy-state").textContent = r.ok ? `已连接 · 内核 ${r.version} · 当前 ${r.connections} 个连接` : `失败：${r.error}`;
  });
  const pref = $("s-prefer");
  pref.replaceChildren(
    el("option", { value: "auto" }, "自动：网站自身优先，其次多数票"),
    el("option", { value: "majority" }, "多数票"),
    el("option", { value: "site" }, "网站自身（Cloudflare trace）"),
    ...SOURCES.map((x) => el("option", { value: x.id }, x.name)),
  );
  pref.value = s.prefer || "auto";
  pref.addEventListener("change", async () => { await saveSettings({ prefer: pref.value }); toast("已保存"); });
  $("s-timeout").value = s.timeout;
  $("s-timeout").addEventListener("change", async () => {
    const v = Math.min(20000, Math.max(1500, Number($("s-timeout").value) || 6000));
    $("s-timeout").value = v;
    await saveSettings({ timeout: v });
    toast("已保存");
  });
  $("sources").replaceChildren(...SOURCES.map((src) => {
    const box = el("input", { type: "checkbox", value: src.id });
    box.checked = s.sourceIds.includes(src.id);
    box.addEventListener("change", async () => {
      const ids = [...document.querySelectorAll("#sources input:checked")].map((b) => b.value);
      if (ids.length < 2) { box.checked = true; toast("至少保留两个 IP 源"); return; }
      await saveSettings({ sourceIds: ids });
      toast("已保存");
    });
    return el("label", { class: "check" }, box, src.name, el("span", { class: "faint small mono" }, new URL(src.url).host));
  }));
  $("test-sources").addEventListener("click", async () => {
    $("test-state").replaceChildren(el("span", { class: "spinner" }));
    $("test-result").replaceChildren();
    const st = await getSettings();
    const d = await detect(null, { sourceIds: SOURCES.map((x) => x.id), timeout: st.timeout, useSiteTrace: false, prefer: st.prefer });
    $("test-state").textContent = d.result ? `结论：${flag(d.result.country)} ${d.result.country} ${d.result.ip}（${d.result.agreeIp}/${d.result.total} 一致）` : "全部失败";
    $("test-result").replaceChildren(...d.sources.map((x) => el("li", {},
      `${x.name}：`, x.ok ? el("span", { class: "mono" }, `${x.ip} ${x.country || "?"} · ${x.ms}ms`) : el("span", { class: "err" }, `${x.error} · ${x.ms}ms`))));
  });
}

// ------------------------------------------------------------------ init
$("ver").textContent = version();
const m = location.hash.match(/q=([^&]+)/);
if (m) $("q").value = decodeURIComponent(m[1]);
load();
initSettings();
