# IP Record Extension · 站点 IP 记录

在同一个 Chrome 配置文件里用不同节点访问不同网站时，记下「这个网站上次用的是哪个 IP、哪个国家」，避免某站被美国 IP、另一个站被日本 IP 风控。

## 功能

- **点击即记录**：点工具栏图标，弹出悬浮窗，立刻向多个 IP 源查询当前出口 IP 和国家并保存，备注框自动获得焦点，输入即保存。
- **多源投票**：Cloudflare、ipinfo.io、ipapi.co、ipwho.is、ip.sb、freeipapi.com 并行查询，按多数票得出 IP 和国家；可展开查看每个源的结果。
- **站点自身视角**：如果网站在 Cloudflare 后面，会额外请求 `https://<网站>/cdn-cgi/trace`，以**这个网站实际看到的 IP** 为准。用 Clash 等按域名分流时，这比通用 IP 接口更准。
- **换国家提醒**：当前国家和该站上次记录不同时，悬浮窗顶部提醒，并显示上次的 IP 和备注。
- **搜索与跳转**：悬浮窗和管理页都能搜 `abc.com`、IP、国家代码或备注；切换好节点后点「跳转」打开网站。
- **图标状态**：有记录的网站图标为蓝色带绿色对勾，角标显示上次的国家代码，悬停显示 IP 和备注；没有记录时为灰色。
- **管理页**（悬浮窗右上角齿轮，`chrome-extension://…/options.html`）：全部记录表格、按国家筛选、每站只看最近一条、直接编辑备注、删除；导入导出；设置。
- **导入导出**：JSON（完整，可导回）和 CSV（Excel 可直接打开）；导入支持合并或覆盖。
- 同一网站再次用同一个 IP 时只更新「最近使用」和次数，不会刷出重复记录（可在设置里关闭）。
- 快捷键 `Alt+Shift+I` 打开悬浮窗。

子域名归到同一个站点（`www.abc.com`、`m.abc.com` → `abc.com`），常见二级后缀（`co.uk`、`com.cn`…）和托管平台（`github.io`、`pages.dev`、`vercel.app`…）单独处理。

## 安装

1. 到 [Releases](https://github.com/trageeker/IP-Record-Extension/releases) 下载 `ip-record-extension-v*.zip` 并解压（或克隆本仓库，用 `src` 目录）。
2. 打开 `chrome://extensions`，右上角开启「开发者模式」。
3. 点「加载已解压的扩展程序」，选择解压出来的文件夹（里面有 `manifest.json`）。
4. 建议把图标固定到工具栏。

Edge、Brave 等 Chromium 浏览器同样适用（Chrome 110+）。

## 权限说明

- `<all_urls>`：读取网站的 `/cdn-cgi/trace` 以及访问各 IP 接口。插件不读取、不注入任何网页内容。
- `tabs`：知道当前标签页是哪个网站，以便切换图标和记录。
- `storage` / `unlimitedStorage`：记录只保存在本机 `chrome.storage.local`，不上传任何地方。

注意：插件检测的是**浏览器发出请求时的出口 IP**。如果代理软件按域名分流，而网站不在 Cloudflare 后面，各 IP 接口看到的可能和网站看到的不同；遇到各源结果不一致时悬浮窗会提示。

## 开发

```bash
npm test          # 单元测试（Node 20+，无依赖）
npm run build     # 打包 dist/ip-record-extension-v<版本>.zip
```

`test/e2e.mjs` 是真实 Chromium 端到端测试（需要 Playwright：`PLAYWRIGHT_DIR=<含 playwright 的 node_modules> node test/e2e.mjs`）。图标由 `scripts/make_icons.py` 生成。

推送 `v*` 标签会由 GitHub Actions 自动测试、打包并发布 Release。
