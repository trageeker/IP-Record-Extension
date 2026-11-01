import test from "node:test";
import assert from "node:assert/strict";
import { siteOf, normalizeQuery, hostnameOf } from "../src/lib/domain.js";
import { parseTrace, consensus, detect } from "../src/lib/ip.js";
import * as store from "../src/lib/store.js";

const mem = () => { const d = {}; return { d, async get(k) { return { [k]: structuredClone(d[k]) }; }, async set(o) { Object.assign(d, structuredClone(o)); } }; };

test("siteOf", () => {
  assert.equal(siteOf("www.abc.com"), "abc.com");
  assert.equal(siteOf("https://m.shop.co.uk/x"), "shop.co.uk");
  assert.equal(siteOf("foo.github.io"), "foo.github.io");
  assert.equal(siteOf("1.2.3.4"), "1.2.3.4");
  assert.equal(siteOf("localhost"), "localhost");
  assert.equal(hostnameOf("chrome://extensions"), null);
  assert.equal(normalizeQuery("https://www.ABC.com/path"), "abc.com");
  assert.equal(normalizeQuery("shop.abc.com"), "shop.abc.com");
  assert.equal(normalizeQuery("www.abc.com/x"), "abc.com");
});

test("trace + consensus", () => {
  const t = parseTrace("fl=1\nh=www.cloudflare.com\nip=1.2.3.4\nloc=JP\ncolo=NRT\n");
  assert.equal(t.ip, "1.2.3.4"); assert.equal(t.country, "JP");
  assert.equal(parseTrace("<html>"), null);
  const rs = [
    { ok: true, ip: "1.1.1.1", country: "US", city: "LA" },
    { ok: true, ip: "1.1.1.1", country: "US" },
    { ok: true, ip: "2.2.2.2", country: "JP" },
    { ok: false, error: "x" },
  ];
  const c = consensus(rs, null);
  assert.equal(c.ip, "1.1.1.1"); assert.equal(c.country, "US"); assert.equal(c.agreeIp, 2); assert.equal(c.total, 3); assert.ok(c.mixed);
  const s = consensus(rs, { ok: true, ip: "2.2.2.2", country: "JP" });
  assert.equal(s.ip, "2.2.2.2"); assert.equal(s.country, "JP"); assert.equal(s.via, "site");
  assert.equal(consensus([{ ok: false }], null), null);
});

test("detect with mocked fetch", async () => {
  const fetchImpl = async (url) => {
    const json = (o) => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) });
    if (url.startsWith("https://abc.com/cdn-cgi/trace")) return { ok: true, status: 200, text: async () => "h=abc.com\nip=9.9.9.9\nloc=DE\n" };
    if (url.includes("cloudflare.com")) return { ok: true, status: 200, text: async () => "h=x\nip=8.8.8.8\nloc=US\n" };
    if (url.includes("ipinfo")) return json({ ip: "8.8.8.8", country: "US", city: "Mountain View", org: "AS15169 Google" });
    if (url.includes("ipapi.co")) return json({ ip: "8.8.8.8", country_code: "US" });
    if (url.includes("ipwho")) return json({ success: false });
    if (url.includes("ip.sb")) throw new Error("net");
    return { ok: false, status: 500 };
  };
  const d = await detect("abc.com", { fetchImpl, timeout: 1000 });
  assert.equal(d.result.ip, "9.9.9.9"); assert.equal(d.result.country, "DE"); assert.equal(d.result.via, "site");
  assert.equal(d.sources[0].id, "site");
  const d2 = await detect("abc.com", { fetchImpl, timeout: 1000, useSiteTrace: false });
  assert.equal(d2.result.ip, "8.8.8.8"); assert.equal(d2.result.agreeIp, 3); assert.equal(d2.result.city, "Mountain View");
});

test("store: record, merge, search, export/import", async () => {
  const m = mem(); store._setStorage(m);
  const det = (ip, cc) => ({ result: { ip, country: cc, agreeIp: 3, total: 3, via: "sources" }, sources: [{ id: "a", name: "A", ok: true, ip, country: cc }] });
  const a = await store.addDetection({ url: "https://www.abc.com/x", host: "www.abc.com", detection: det("1.1.1.1", "US") });
  assert.equal(a.merged, false); assert.equal(a.record.site, "abc.com");
  const b = await store.addDetection({ url: "https://abc.com/", host: "abc.com", detection: det("1.1.1.1", "US") });
  assert.equal(b.merged, true); assert.equal(b.record.seen, 2); assert.equal(b.record.id, a.record.id);
  await store.addDetection({ url: "https://abc.com/", host: "abc.com", detection: det("2.2.2.2", "JP") });
  await store.addDetection({ url: "https://xyz.org/", host: "xyz.org", detection: det("3.3.3.3", "SG") });
  await store.updateRecord(a.record.id, { note: "不能用 日本, \"quote\"\nline2" });
  let recs = await store.getRecords();
  assert.equal(recs.length, 3);
  assert.deepEqual(store.search(recs, "https://www.abc.com/").map((r) => r.site), ["abc.com", "abc.com"]);
  assert.equal(store.search(recs, "日本")[0].ip, "1.1.1.1");
  assert.equal(store.search(recs, "SG")[0].site, "xyz.org");
  await assert.rejects(store.addDetection({ url: "https://q.com", host: "q.com", detection: { result: null, sources: [] } }));

  const json = JSON.stringify(await store.exportJson());
  const csv = await store.exportCsv();
  // JSON 覆盖导入到空库
  store._setStorage(mem());
  let r = await store.importText(json, "merge");
  assert.equal(r.added, 3);
  r = await store.importText(json, "merge");
  assert.equal(r.added, 0); assert.equal(r.updated, 0);
  // CSV 导入
  store._setStorage(mem());
  r = await store.importText(csv, "merge");
  assert.equal(r.added, 3);
  const back = await store.getRecords();
  assert.equal(back.find((x) => x.ip === "1.1.1.1").note, "不能用 日本, \"quote\"\nline2");
  // 坏数据
  await assert.rejects(store.importText("{\"x\":1}"));
  r = await store.importText(JSON.stringify([{ host: "", ip: "" }, { host: "ok.com", ip: "5.5.5.5" }]));
  assert.equal(r.added, 1); assert.equal(r.skipped, 1);
});
