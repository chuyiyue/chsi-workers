// 构建部署包：把 public/* 内联进 Worker，输出 dist/worker.js
// 用法：node build.mjs
import { readFileSync, readdirSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const pubDir = join(root, "public");
const files = {};

function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else files["/" + relative(pubDir, p).replace(/\\/g, "/")] = readFileSync(p, "utf8");
  }
}
walk(pubDir);

let src = readFileSync(join(root, "src", "worker.js"), "utf8");
if (!src.includes("/*__ASSETS_MAP__*/")) {
  console.error("src/worker.js 缺少 /*__ASSETS_MAP__*/ 占位符");
  process.exit(1);
}
const mapJs = "globalThis.__ASSETS__ = " + JSON.stringify(files) + ";";
src = src.replace("/*__ASSETS_MAP__*/", () => mapJs);

mkdirSync(join(root, "dist"), { recursive: true });
writeFileSync(join(root, "dist", "worker.js"), src);
console.log(`built dist/worker.js: ${Object.keys(files).length} assets, ${(Buffer.byteLength(src) / 1024).toFixed(1)} KB`);
