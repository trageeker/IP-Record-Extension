// 代理内核（mihomo / Clash Meta / Clash Verge / FlClash 等）的外部控制 API。
// 切换节点后，内核里已经建立的出站连接仍挂在旧节点上，Chrome 清连接池也关不掉它们；
// 检测前调用 API 把这些连接断开，下一次请求才会按当前节点重新建连。

export const MIHOMO_DEFAULTS = { url: "http://127.0.0.1:9090", secret: "", scope: "matched" };

function base(url) {
  let u = String(url || MIHOMO_DEFAULTS.url).trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(u)) u = "http://" + u;
  return u;
}

async function call(cfg, path, method = "GET", timeout = 2500) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const headers = cfg.secret ? { Authorization: `Bearer ${cfg.secret}` } : {};
    const res = await fetch(base(cfg.url) + path, { method, headers, signal: ctl.signal, cache: "no-store" });
    if (res.status === 401 || res.status === 403) throw new Error("密钥不对（401）");
    if (res.status === 502) throw new Error("请求被代理转发了（HTTP 502），请把 127.0.0.1 加入代理绕过列表");
    if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  } catch (e) {
    if (e.name === "AbortError") throw new Error("连不上控制端口（超时）");
    if (e instanceof TypeError) throw new Error("连不上控制端口");
    throw e;
  } finally {
    clearTimeout(t);
  }
}

/** 主机是否命中列表（含子域名） */
export function hostMatches(host, hosts) {
  host = String(host || "").toLowerCase().replace(/\.$/, "");
  if (!host) return false;
  return hosts.some((h) => host === h || host.endsWith("." + h));
}

/** 挑出要断开的连接：scope=matched 时只挑访问 hosts 的连接 */
export function pickConnections(list, hosts) {
  return (list || []).filter((c) => {
    const m = c.metadata || {};
    return hostMatches(m.host, hosts) || hostMatches(m.sniffHost, hosts);
  });
}

/** 测试连接：返回 { ok, version, connections } */
export async function probe(cfg) {
  try {
    const v = await call(cfg, "/version");
    const c = await call(cfg, "/connections");
    return { ok: true, version: v?.version || (v?.meta ? "meta" : "?"), connections: (c?.connections || []).length };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

/**
 * 断开内核里的连接。
 * scope = "matched"：只断开访问 IP 源和当前网站的连接（不影响别的下载/视频）；
 * scope = "all"：断开全部连接（等同客户端里的「关闭所有连接」）。
 * 返回 { ok, closed, scope, error }
 */
export async function closeConnections(cfg, hosts) {
  cfg = { ...MIHOMO_DEFAULTS, ...cfg };
  try {
    if (cfg.scope === "all") {
      const c = await call(cfg, "/connections").catch(() => null);
      await call(cfg, "/connections", "DELETE");
      return { ok: true, scope: "all", closed: (c?.connections || []).length };
    }
    const c = await call(cfg, "/connections");
    const hit = pickConnections(c?.connections, hosts);
    await Promise.all(hit.map((x) => call(cfg, `/connections/${encodeURIComponent(x.id)}`, "DELETE").catch(() => null)));
    return { ok: true, scope: "matched", closed: hit.length };
  } catch (e) {
    return { ok: false, scope: cfg.scope, closed: 0, error: String(e.message || e) };
  }
}
