// 构建部署包：把 web 前台与 admin 后台的静态产物合并到 dist/
//   dist/*        ← apps/web/public/*
//   dist/admin/*  ← apps/admin/public/*   （网关 Worker 路由 /admin/*）
// 用法：node build.mjs   （在 apps/api 下执行）
import { readdirSync, mkdirSync, copyFileSync, statSync, rmSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const apiDir = dirname(fileURLToPath(import.meta.url));
const appsDir = join(apiDir, "..");
const dist = join(apiDir, "dist");

function copyDir(src, dst) {
  if (!existsSync(src)) throw new Error(`缺少源目录：${src}`);
  mkdirSync(dst, { recursive: true });
  for (const e of readdirSync(src)) {
    const s = join(src, e), d = join(dst, e);
    if (statSync(s).isDirectory()) copyDir(s, d);
    else copyFileSync(s, d);
  }
}

rmSync(dist, { recursive: true, force: true });
copyDir(join(appsDir, "web", "public"), dist);
copyDir(join(appsDir, "admin", "public"), join(dist, "admin"));

function count(dir) {
  let n = 0;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    n += statSync(p).isDirectory() ? count(p) : 1;
  }
  return n;
}
console.log(`built dist/: web=${count(dist) - count(join(dist, "admin"))} admin=${count(join(dist, "admin"))} -> ${relative(process.cwd(), dist)}`);
