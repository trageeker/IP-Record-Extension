// 弹窗和管理页共用的显示工具

let names;
try { names = new Intl.DisplayNames(["zh-CN"], { type: "region" }); } catch { names = null; }

export function countryName(cc) {
  if (!cc) return "未知";
  try { return names?.of(cc) || cc; } catch { return cc; }
}

export function flag(cc) {
  if (!cc || !/^[A-Z]{2}$/.test(cc)) return "🏳️";
  return String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export function ago(ts) {
  if (!ts) return "";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "刚刚";
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} 天前`;
  return fmtDate(ts);
}

export function fmtDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k === "text") n.textContent = v;
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}

export function siteUrl(r) {
  if (r.url && /^https?:/.test(r.url)) {
    try { return new URL(r.url).origin + "/"; } catch { /* fall through */ }
  }
  return `https://${r.host || r.site}/`;
}

export function download(name, content, type) {
  const blob = new Blob([content], { type });
  const a = el("a", { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ISO 3166-1 alpha-2
export const COUNTRY_CODES = ("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL " +
  "GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR " +
  "LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK " +
  "PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR " +
  "TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW").split(" ");

/** 「JP」「jp 日本」「日本」→ JP；无法识别返回 null，空串返回 "" */
export function parseCountry(input) {
  const s = String(input || "").trim();
  if (!s) return "";
  const m = s.match(/^([a-z]{2})(\s|$)/i);
  if (m && COUNTRY_CODES.includes(m[1].toUpperCase())) return m[1].toUpperCase();
  const hit = COUNTRY_CODES.find((c) => countryName(c) === s);
  return hit || null;
}

export function countryOptions() {
  return COUNTRY_CODES.map((c) => el("option", { value: `${c} ${countryName(c)}` }));
}

/** 「常用：🇯🇵 日本 8/10 次 · IP 1.2.3.4 5 次」；只有一次使用时返回空串 */
export function statsText(st) {
  if (!st || st.total < 2) return "";
  const c = st.countries[0], i = st.ips[0];
  const parts = [];
  if (c) parts.push(`${flag(c.value)} ${countryName(c.value)} ${c.count}/${st.total} 次`);
  if (i) parts.push(`IP ${i.value} ${i.count} 次`);
  return `最常用：${parts.join(" · ")}`;
}
