// 把 URL 归一成「站点」：同一个注册域名下的子域共用记录（www.abc.com、m.abc.com → abc.com）。
// 不内置完整的公共后缀表，只处理常见的二级后缀和托管平台域名，够个人使用。

const MULTI_SUFFIXES = new Set([
  "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn", "ac.cn",
  "com.hk", "org.hk", "net.hk", "edu.hk", "gov.hk",
  "com.tw", "org.tw", "net.tw", "edu.tw", "gov.tw", "idv.tw",
  "co.jp", "ne.jp", "or.jp", "ac.jp", "go.jp",
  "co.kr", "or.kr", "ne.kr",
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk",
  "com.au", "net.au", "org.au", "edu.au",
  "co.nz", "com.sg", "com.my", "co.id", "co.th", "com.vn", "com.ph",
  "co.in", "net.in", "org.in", "com.br", "com.mx", "com.ar", "com.tr", "co.za", "com.ru",
  // 托管平台：每个子域是不同的人的站点
  "github.io", "gitlab.io", "pages.dev", "workers.dev", "vercel.app", "netlify.app",
  "herokuapp.com", "web.app", "firebaseapp.com", "onrender.com", "fly.dev", "glitch.me",
  "blogspot.com", "wordpress.com", "substack.com", "notion.site", "hf.space", "replit.app",
]);

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export function hostnameOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
}

export function siteOf(hostOrUrl) {
  let host = hostOrUrl && hostOrUrl.includes("/") ? hostnameOf(hostOrUrl) : (hostOrUrl || "").toLowerCase();
  if (!host) return null;
  host = host.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (IPV4.test(host) || host.includes(":") || !host.includes(".")) return host; // IP、localhost
  const parts = host.split(".");
  const last2 = parts.slice(-2).join(".");
  if (MULTI_SUFFIXES.has(last2) && parts.length >= 3) return parts.slice(-3).join(".");
  return last2;
}

/** 用户在搜索框里输入的东西 → 可能的站点（去掉协议、路径、www） */
export function normalizeQuery(q) {
  q = (q || "").trim().toLowerCase();
  if (!q) return "";
  if (/^[a-z]+:\/\//.test(q)) {
    const h = hostnameOf(q);
    if (h) return h.replace(/^www\./, "");
  }
  return q.replace(/^www\./, "").replace(/\/.*$/, "");
}

export function isRecordableUrl(url) {
  return !!hostnameOf(url);
}
