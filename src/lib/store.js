// 记录存放在 chrome.storage.local（unlimitedStorage）。
// 记录：{ id, site, host, url, ip, country, city, region, org, via, agree, total, mixed, sources, note, createdAt, lastSeenAt, seen, updatedAt }

import { siteOf, normalizeQuery } from "./domain.js";
import { DEFAULT_SOURCE_IDS } from "./ip.js";

export const DEFAULT_SETTINGS = {
  autoRecord: true, // 打开弹窗即检测并记录
  mergeSameIp: true, // 同一站点同一 IP 再次记录时只更新「最近使用」，不新增
  useSiteTrace: true,
  sourceIds: DEFAULT_SOURCE_IDS,
  timeout: 6000,
};

let api = globalThis.chrome?.storage?.local;
export function _setStorage(s) { api = s; } // 测试用

export async function getSettings() {
  const { settings } = await api.get("settings");
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

export async function saveSettings(patch) {
  const s = { ...(await getSettings()), ...patch };
  await api.set({ settings: s });
  return s;
}

export async function getRecords() {
  const { records } = await api.get("records");
  return Array.isArray(records) ? records : [];
}

async function putRecords(records) {
  await api.set({ records });
}

const uid = () => (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

/** 按「最近使用」倒序 */
export const byRecent = (a, b) => (b.lastSeenAt || b.createdAt) - (a.lastSeenAt || a.createdAt);

export async function recordsForSite(site) {
  return (await getRecords()).filter((r) => r.site === site).sort(byRecent);
}

/** 保存一次检测结果，返回 { record, merged } */
export async function addDetection({ url, host, detection }, settings) {
  settings = settings || (await getSettings());
  const c = detection.result;
  if (!c || !c.ip) throw new Error("所有 IP 源都失败了，未记录");
  const site = siteOf(host);
  const now = Date.now();
  const records = await getRecords();

  if (settings.mergeSameIp) {
    const same = records.filter((r) => r.site === site && r.ip === c.ip).sort(byRecent)[0];
    if (same) {
      Object.assign(same, {
        host, url, country: c.country || same.country, city: c.city || same.city, region: c.region || same.region,
        org: c.org || same.org, via: c.via, agree: c.agreeIp, total: c.total, mixed: !!c.mixed,
        sources: slimSources(detection.sources), lastSeenAt: now, seen: (same.seen || 1) + 1, updatedAt: now,
      });
      await putRecords(records);
      return { record: same, merged: true };
    }
  }
  const rec = {
    id: uid(), site, host, url,
    ip: c.ip, country: c.country || "", city: c.city || "", region: c.region || "", org: c.org || "",
    via: c.via, agree: c.agreeIp, total: c.total, mixed: !!c.mixed,
    sources: slimSources(detection.sources), note: "",
    createdAt: now, lastSeenAt: now, seen: 1, updatedAt: now,
  };
  records.push(rec);
  await putRecords(records);
  return { record: rec, merged: false };
}

function slimSources(sources) {
  return (sources || []).map((s) => (s.ok
    ? { id: s.id, name: s.name, ok: true, ip: s.ip, country: s.country || "" }
    : { id: s.id, name: s.name, ok: false, error: s.error }));
}

export async function updateRecord(id, patch) {
  const records = await getRecords();
  const r = records.find((x) => x.id === id);
  if (!r) return null;
  const allowed = {};
  for (const k of ["note", "country", "ip"]) if (k in patch) allowed[k] = patch[k];
  Object.assign(r, allowed, { updatedAt: Date.now() });
  await putRecords(records);
  return r;
}

export async function deleteRecord(id) {
  const records = await getRecords();
  await putRecords(records.filter((r) => r.id !== id));
}

export async function clearAll() {
  await putRecords([]);
}

/** 搜索：站点 / 主机名 / IP / 国家 / 备注；站点精确匹配排最前 */
export function search(records, q) {
  const n = normalizeQuery(q);
  if (!n) return [...records].sort(byRecent);
  const site = siteOf(n);
  const hits = records.filter((r) => (n.includes(".") && r.site === site) || [r.site, r.host, r.ip, r.country, r.city, r.org, r.note]
    .some((v) => v && String(v).toLowerCase().includes(n)));
  const score = (r) => (r.site === site || r.host === n ? 0 : r.site?.startsWith(n) ? 1 : 2);
  return hits.sort((a, b) => score(a) - score(b) || byRecent(a, b));
}

// ------------------------------------------------------------------ 导入导出

export async function exportJson() {
  return {
    app: "site-ip-recorder",
    format: 1,
    exportedAt: new Date().toISOString(),
    records: (await getRecords()).sort(byRecent),
  };
}

const CSV_COLS = ["site", "host", "ip", "country", "city", "region", "org", "note", "createdAt", "lastSeenAt", "seen", "url", "id"];

export async function exportCsv() {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = (await getRecords()).sort(byRecent).map((r) => CSV_COLS.map((k) => esc(
    k === "createdAt" || k === "lastSeenAt" ? (r[k] ? new Date(r[k]).toISOString() : "") : r[k],
  )).join(","));
  return "\ufeff" + [CSV_COLS.join(","), ...rows].join("\r\n");
}

function parseCsv(text) {
  text = text.replace(/^\ufeff/, "");
  const rows = [];
  let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); rows.push(row); row = []; cur = "";
    } else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((c) => c !== ""));
  if (!head) return [];
  return body.map((cells) => Object.fromEntries(head.map((h, i) => [h.trim(), cells[i] ?? ""])));
}

function normalizeImported(r) {
  if (!r || typeof r !== "object") return null;
  const host = String(r.host || r.site || "").trim().toLowerCase();
  const ip = String(r.ip || "").trim();
  if (!host || !ip) return null;
  const t = (v) => (typeof v === "number" ? v : v ? Date.parse(v) || undefined : undefined);
  const createdAt = t(r.createdAt) || Date.now();
  return {
    ...r,
    id: r.id || uid(),
    site: r.site || siteOf(host),
    host, ip,
    country: String(r.country || "").toUpperCase(),
    note: r.note || "",
    createdAt,
    lastSeenAt: t(r.lastSeenAt) || createdAt,
    updatedAt: t(r.updatedAt) || t(r.lastSeenAt) || createdAt,
    seen: Number(r.seen) || 1,
  };
}

/**
 * 导入 JSON（本插件导出的格式或记录数组）或 CSV。
 * mode: "merge" 合并（同 id 取较新的），"replace" 覆盖全部。
 */
export async function importText(text, mode = "merge") {
  let items;
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const data = JSON.parse(trimmed);
    items = Array.isArray(data) ? data : data.records;
    if (!Array.isArray(items)) throw new Error("JSON 里没有 records 数组");
  } else {
    items = parseCsv(text);
  }
  const incoming = items.map(normalizeImported).filter(Boolean);
  const skipped = items.length - incoming.length;
  if (mode === "replace") {
    await putRecords(incoming);
    return { added: incoming.length, updated: 0, skipped, total: incoming.length };
  }
  const records = await getRecords();
  const byId = new Map(records.map((r) => [r.id, r]));
  let added = 0, updated = 0;
  for (const r of incoming) {
    const old = byId.get(r.id);
    if (!old) { records.push(r); byId.set(r.id, r); added++; }
    else if ((r.updatedAt || 0) > (old.updatedAt || 0)) { Object.assign(old, r); updated++; }
  }
  await putRecords(records);
  return { added, updated, skipped, total: records.length };
}
