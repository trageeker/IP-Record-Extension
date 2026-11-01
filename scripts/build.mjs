// 打包 src/ 为可直接拖进 chrome://extensions 或上传商店的 zip：npm run build
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, rmSync } from "node:fs";
const { version } = JSON.parse(readFileSync("src/manifest.json", "utf8"));
const out = `dist/ip-record-extension-v${version}.zip`;
mkdirSync("dist", { recursive: true });
rmSync(out, { force: true });
execFileSync("zip", ["-qr", `../${out}`, ".", "-x", ".*"], { cwd: "src", stdio: "inherit" });
console.log(out);
