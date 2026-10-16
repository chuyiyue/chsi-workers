# 学员学籍信息平台（演示系统）

仿学信档案布局风格的培训机构学籍演示站，运行于 Cloudflare Workers。
**演示系统 · 与中国高等教育学生信息网（学信网）无任何关联。**

## 结构

```
apps/api/    后端 Worker（纯 API + 静态网关）
  src/core/      kv(cursor 分页) / session / password / validator / photoStore / http
  src/routes/    auth / students / query / admin-users / photos / settings
  src/migrations/ 旧 KV → 新模型（照片拆离）一次性迁移
  build.mjs      合并 web+admin 静态产物到 dist/
apps/web/    前台（学籍查询 | 我的 | 帮助）
apps/admin/  后台（用户管理 | 学籍管理 | 网站设置）
packages/shared/  字段定义、错误码、KV key 约定（三端唯一合同）
```

## 本地开发

```bash
pnpm install
cd apps/api
echo 'ADMIN_PASSWORD="dev-pw"' > .dev.vars
pnpm dev          # 先 build 静态产物，再 wrangler dev :8787
```

`/` 前台，`/admin` 后台，`/api/*` 接口。

## 测试

```bash
pnpm --filter @chsi/api test
```

14 个用例：会话生命周期（改密/删号踢会话）、入参类型校验、登录限流、
1010 条记录分页不截断、照片拆离、公开查询脱敏、迁移脚本。

## 部署

push 到 `main` 由 GitHub Actions 自动部署：
`ci`（lint+test+构建校验+绑定校验）→ `deploy-staging` → `deploy-prod`。

需要 repo secrets：`CF_API_TOKEN`、`CF_ACCOUNT_ID`、`ADMIN_PASSWORD`。

| env | Worker 名 | KV | R2 |
|---|---|---|---|
| staging | chsi-workers-staging | chsi-workers-staging-kv | chsi-photos |
| prod | chsi-workers | xuexin-demo-kv | chsi-photos |

> 注意：`wrangler.jsonc` 里 KV/R2 必须在**每个 env 内**显式声明
> —— wrangler 的 env 不继承顶层 `kv_namespaces` / `r2_buckets`，漏写会静默部署出无绑定的 Worker。
> `apps/api/src/index.js` 是仅存的后端入口；旧版 `public/` + `src/worker.js` 已由 monorepo 结构取代。

## 数据模型

```
user:<username>            { id, username, salt, passHash, role, orgId, tokenVersion }
session:<uid>:<token>      会话（7 天）
sidx:<token>               token → uid 索引
student:<uid>:<sid>        学籍记录（照片只存 key，不存字节）
photo:photos/<sid>/<n>.bin 照片（R2 优先，降级 KV）
idx:<sha256(name|id)>      公开查询索引
site:settings              站点设置（站名/机构名/演示标识开关）
```
