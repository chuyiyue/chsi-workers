# 培训机构学员档案（演示系统）

培训机构学员档案演示站，运行于 Cloudflare Workers（单 Worker 网关：API + 静态资源）。
**演示系统 · 与任何官方学历平台无任何关联。**

学员端两个入口：**教育信息**（学籍 / 学历信息、结业证明）、**个人中心**（联系方式、密码）。
没有公开查询、没有自助注册 —— 学员账号由管理后台开通，记录只能自己看自己的。

## 结构

```
apps/api/    后端 Worker（API + 静态网关）
  src/core/      kv(cursor 分页) / session / password / validator / photoStore / http
  src/routes/    auth / my（学员自助）/ students（管理端）/ admin-users / photos / settings
  src/migrations/ 旧 KV → 新模型（去 published、清 idx、照片拆离）
  build.mjs      合并 web+admin 静态产物到 dist/
apps/web/    前台（教育信息 | 个人中心）
apps/admin/  后台（用户管理 | 教育经历管理 | 网站设置）
packages/shared/  字段定义、错误码、KV key 约定（三端唯一合同）
```

## 接口

```
POST /api/login                      学员 / 管理员登录
POST /api/logout                     GET /api/me
GET  /api/my/enrollments             我的教育经历（?kind=edu|xueji&status=）
GET  /api/my/enrollments/:sid        详情（限本人）
POST /api/my/enrollments             新增（学员自助录入）
PUT  /api/my/enrollments/:sid        编辑
DELETE /api/my/enrollments/:sid       删除
GET  /api/my/profile                 个人资料
PUT  /api/my/profile                 只改联系方式（手机号 / 邮箱 / 显示名 / 头像）
POST /api/my/change-password          改密（踢掉该用户全部旧会话）
GET  /api/photos/:sid/:n             照片（记录本人或管理员）
/api/admin/*                         管理后台（用户 / 教育经历代录 / 网站设置）
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

覆盖：登录 / 会话生命周期（改密、删号踢会话）、`/api/my/*` 只读本人数据与越权 404、
公开查询与自助注册确认已下线（404）、照片拆离与鉴权取回、XSS 载荷拒收、
手机号校验、1010 条记录分页不截断、迁移脚本（含 dryRun）。

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

## 数据模型

```
user:<username>            { id, username, salt, passHash, role, orgId, tokenVersion, phone, email, displayName, avatar }
session:<uid>:<token>      会话（7 天）
sidx:<token>               token → uid 索引
student:<uid>:<sid>        教育经历（type: xueji|xueli|degree；照片只存 key）
photo:photos/<sid>/<n>.bin 照片（R2 优先，降级 KV）
site:settings              站点设置（站名/机构名/演示标识开关）
```

## 迁移

线上存量数据用 `apps/api/src/migrations/kv-v1-to-v2.js`：
去掉旧 `published`、重算 `type`、清掉公开查询遗留的 `idx:*`、未拆离的 data URL 照片搬到 R2。

```js
import { runMigration } from "./src/migrations/kv-v1-to-v2.js";
await runMigration(env, console.log, { dryRun: true }); // 先看统计，不写任何键
```
