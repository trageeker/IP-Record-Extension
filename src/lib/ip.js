// 多源检测出口 IP 与国家，按多数票得出结论。
// 目标站点若在 Cloudflare 后面，会额外请求 https://<站点>/cdn-cgi/trace，拿到「这个网站看到的 IP」，
// 分流代理（不同网站走不同节点）时它比通用 IP 接口更准，结论优先采用它。

export const SOURCES = [
  {
    id: "cloudflare", name: "Cloudflare", url: "https://www.cloudflare.com/cdn-cgi/trace", type: "text",
    parse: (t) => parseTrace(t),
  },
  {
    id: "ipinfo", name: "ipinfo.io", url: "https://ipinfo.io/json",
    parse: (j) => ({ ip: j.ip, country: j.country, city: j.city, region: j.region, org: j.org }),
  },
  {
    id: "ipapi", name: "ipapi.co", url: "https://ipapi.co/json/",
    parse: (j) => ({ ip: j.ip, country: j.country_code || j.country, city: j.city, region: j.region, org: j.org }),
  },
  {
    id: "ipwho", name: "ipwho.is", url: "https://ipwho.is/",
    parse: (j) => (j.success === false ? null : {
      ip: j.ip, country: j.country_code, city: j.city, region: j.region, org: j.connection?.isp || j.connection?.org,
    }),
  },
  {
    id: "ipsb", name: "ip.sb", url: "https://api.ip.sb/geoip",
    parse: (j) => ({ ip: j.ip, country: j.country_code, city: j.city, region: j.region, org: j.isp || j.organization }),
  },
  {
    id: "freeipapi", name: "freeipapi.com", url: "https://freeipapi.com/api/json",
    parse: (j) => ({ ip: j.ipAddress, country: j.countryCode, city: j.cityName, region: j.regionName }),
  },
];

export const SOURCE_ORIGINS = [...new Set(SOURCES.map((s) => new URL(s.url).origin))];
export const DEFAULT_SOURCE_IDS = SOURCES.map((s) => s.id);

export function parseTrace(text) {
  if (typeof text !== "string" || !/^ip=/m.test(text) || !/^h=/m.test(text)) return null;
  const kv = Object.fromEntries(
    text.split("\n").map((l) => l.trim()).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
  if (!kv.ip) return null;
  return { ip: kv.ip, country: kv.loc && kv.loc !== "XX" ? kv.loc : undefined, colo: kv.colo };
}

async function fetchWithTimeout(url, ms, fetchImpl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetchImpl(url, { signal: ctrl.signal, cache: "no-store", credentials: "omit", redirect: "follow" });
  } finally {
    clearTimeout(timer);
  }
}

async function querySource(src, { timeout, fetchImpl }) {
  const t0 = Date.now();
  try {
    const res = await fetchWithTimeout(src.url, timeout, fetchImpl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = src.type === "text" ? await res.text() : await res.json();
    const r = src.parse(body);
    if (!r || !r.ip) throw new Error("响应里没有 IP");
    return { id: src.id, name: src.name, ok: true, ms: Date.now() - t0, ...clean(r) };
  } catch (e) {
    return { id: src.id, name: src.name, ok: false, ms: Date.now() - t0, error: e.name === "AbortError" ? "超时" : String(e.message || e) };
  }
}

function clean(r) {
  const out = { ip: String(r.ip).trim() };
  if (r.country) out.country = String(r.country).trim().toUpperCase();
  for (const k of ["city", "region", "org", "colo"]) if (r[k]) out[k] = String(r[k]).trim();
  return out;
}

/** 目标站点的 Cloudflare trace；站点不在 Cloudflare 后面就返回 null */
export async function siteTrace(hostname, { timeout = 4000, fetchImpl = fetch } = {}) {
  if (!hostname || !hostname.includes(".")) return null;
  const t0 = Date.now();
  try {
    const res = await fetchWithTimeout(`https://${hostname}/cdn-cgi/trace`, timeout, fetchImpl);
    if (!res.ok) return null;
    const r = parseTrace(await res.text());
    if (!r) return null;
    return { id: "site", name: `${hostname}（站点自身）`, ok: true, ms: Date.now() - t0, ...clean(r) };
  } catch {
    return null;
  }
}

function tally(values) {
  const m = new Map();
  for (const v of values) if (v) m.set(v, (m.get(v) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

/**
 * 汇总各源结果。prefer：
 *   "auto"     —— 网站自身 trace 优先，否则多数票（默认）
 *   "majority" —— 纯多数票（网站自身 trace 也算一票）
 *   某个源 id  —— 以该源为准（含 "site" 网站自身）；它失败时回退到 auto
 */
export function consensus(results, site, prefer = "auto") {
  const ok = results.filter((r) => r.ok);
  const all = site ? [site, ...ok] : ok;
  if (!all.length) return null;

  let pick = null;
  if (prefer && prefer !== "auto" && prefer !== "majority") pick = all.find((r) => r.id === prefer) || null;
  if (!pick && prefer !== "majority" && site) pick = site;

  const voters = prefer === "majority" ? all : ok;
  const ipVotes = tally(voters.map((r) => r.ip));
  const ccVotes = tally(voters.map((r) => r.country));
  const ip = pick?.ip || ipVotes[0]?.[0];
  const sameIp = all.filter((r) => r.ip === ip);
  const country = pick?.country || tally(sameIp.map((r) => r.country))[0]?.[0] || ccVotes[0]?.[0] || "";
  const detail = (pick?.city ? pick : null) || sameIp.find((r) => r.city) || {};
  const orgSrc = (pick?.org ? pick : null) || sameIp.find((r) => r.org) || {};

  const agreeIp = ok.filter((r) => r.ip === ip).length;
  const agreeCountry = ok.filter((r) => r.country === country).length;
  const ips = tally(ok.map((r) => r.ip)).map(([v]) => v);
  return {
    ip,
    country,
    city: detail.city || "",
    region: detail.region || "",
    org: orgSrc.org || "",
    via: !pick ? "sources" : pick === site ? "site" : "source",
    viaName: pick && pick !== site ? pick.name : "",
    agreeIp,
    agreeCountry,
    total: ok.length,
    mixed: ips.length > 1 || (site && ips.length > 0 && !ips.includes(site.ip)),
  };
}

export async function detect(hostname, { sourceIds = DEFAULT_SOURCE_IDS, timeout = 6000, useSiteTrace = true, prefer = "auto", fetchImpl = fetch } = {}) {
  const srcs = SOURCES.filter((s) => sourceIds.includes(s.id));
  const [site, ...results] = await Promise.all([
    useSiteTrace ? siteTrace(hostname, { timeout: Math.min(timeout, 4000), fetchImpl }) : Promise.resolve(null),
    ...srcs.map((s) => querySource(s, { timeout, fetchImpl })),
  ]);
  return { result: consensus(results, site, prefer), sources: site ? [site, ...results] : results, at: Date.now() };
}
