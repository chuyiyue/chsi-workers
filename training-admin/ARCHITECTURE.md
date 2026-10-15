# 培训学员管理平台 · 新架构方案

适用范围：培训机构内部使用的「管理员后台 + 学员端几个页面」。
记录类型一律如实：培训档案、课程记录、结业证明（由本机构出具）。
不使用「学籍 / 学历 / 学位」体系，不复刻任何官方平台的页面样式。

## 1. 现状问题（读完代码后的结论）

| 问题 | 位置 | 影响 |
| --- | --- | --- |
| 用 `KV.list` 扫描再逐个 `KV.get` 做查询 | `/api/students`、`/api/users`、`/api/query`、按 id 找记录 | 每次请求 O(n) 次 KV 读取；KV 单次 list 最多 1000 个 key，超过后数据会「丢失」 |
| 照片以 data URL 存进 JSON 记录（最大 25MB/条） | `cleanPhoto` | 列表接口会把所有照片整条读出来，慢且贵 |
| 密码用加盐 SHA-256 | `hashPassword` | 太快，抗暴力破解弱，应换 PBKDF2/scrypt |
| 会话 Cookie 无 `Secure`；管理员密码比较非常量时间 | `sessionCookie`、`admin-login` | 安全细节缺失 |
| 限流是 KV 读后写，非原子 | `rl:<ip>` | 并发下可绕过 |
| 前端把 `public/*` 当字符串内联进 Worker | `build.mjs` | 不能放图片/字体等二进制；两份 wrangler 配置并存，容易漂移 |
| 前端是 5 个手写 HTML + 全局 `app.js` | `public/` | 表单字段在前后端各写一遍，改字段要改多处 |
| 公开接口按「姓名 + 证件号」查记录 | `/api/query` | 等于开放了个人信息查询入口，不建议保留 |

## 2. 目标架构

```
浏览器
 ├─ /admin/*   管理后台（SPA）
 └─ /app/*     学员端（SPA，手机优先）
        │  同源 fetch，Cookie 会话
        ▼
Cloudflare Worker（Hono + TypeScript）
 ├─ Static Assets 绑定：托管前端构建产物（取代 build.mjs 内联）
 ├─ KV   全部业务数据（学员、报名、证明、设置）+ 会话、验证码（带 TTL）
 └─ R2   照片 / 附件（只存对象，记录里存 key）
```

选择理由：
- 数据继续放 KV，不引入 D1；但按下面第 4 节的 key 设计来存，避免原来的「list 扫描 + 逐个 get」；
- 照片不再塞进 KV 记录，改放 R2，经 Worker 鉴权后读取；
- Worker 层用 Hono 分模块路由，类型和校验（zod）前后端共用。

## 3. 仓库结构

```
/
├─ apps/
│  ├─ web/                 前端（Vite，多入口：admin、app）
│  │   ├─ admin/           管理后台页面
│  │   ├─ app/             学员端页面
│  │   └─ shared/          UI 组件、api 客户端、表单渲染
│  └─ worker/
│      ├─ src/index.ts     入口与路由挂载
│      ├─ src/routes/      auth.ts · learners.ts · records.ts · certificates.ts · files.ts · settings.ts
│      ├─ src/lib/         password.ts · session.ts · crypto.ts · audit.ts
│      └─ scripts/         一次性迁移脚本（旧 KV 数据 → 新 key 结构）
├─ packages/schema/        zod schema + 字段定义（前后端共用，唯一数据来源）
├─ wrangler.jsonc          单一配置，dev/prod 用 env 区分
└─ ARCHITECTURE.md
```

## 4. 数据模型（KV key 设计）

核心思路：把「一个学员的所有东西」放在同一个 key 前缀下，一次 `list({prefix})` 就能取全；
列表页需要的摘要字段放进 key 的 metadata（≤1KB），列表时不用再逐个 get。

```
learner:<learnerId>                      学员资料 JSON
   {id, username, passHash, salt, name, gender, phone,
    idNumberEnc, idNumberHash, createdAt}
   metadata: {username, name, createdAt}

lname:<username>        -> learnerId     登录用的用户名索引
lidh:<idNumberHash>     -> learnerId     证件号去重/精确查找索引（只存哈希）

enroll:<learnerId>:<enrollId>            一次培训报名，整条放在一个 JSON 里
   {id, programName, category, className, enrollDate, expectedEndDate,
    status,                    // 在读 / 已结业 / 休学 / 退出
    photoKey, remark,
    courseRecords: [{courseName, hours, scoreText, completedAt}],
    certificate: {certNo, issuedBy, issuedAt, fileKey, revoked} | null,
    extra: [{k, v}],           // 原来的自定义字段
    createdAt, updatedAt}
   metadata: {programName, status, className, updatedAt}

cert:<certNo>           -> {learnerId, enrollId, revoked}   证明编号校验索引

program:<programId>                      培训项目/课程（数量少，一次 list 全取）
settings                                 站点设置
audit:<反向时间戳>:<rand>                 审计日志（expirationTtl 90 天）
session:<token>   captcha:<cid>          会话、验证码（带 TTL）
```

要点：
- 学员端列表 = `list({prefix: "enroll:<自己的learnerId>:"})`，天然隔离，不会扫到别人；
- 管理后台分页用 `list` 的 `cursor`，不再「一次扫全部」；
- 证件号：AES-GCM 加密存储（密钥放 Worker secret），另存带盐哈希做索引；页面一律脱敏显示；
- 去掉 `degreeName / degreeUnit / presidentName / 学历照片 / 学历类别` 这类官方学历体系字段；
- 证明编号 `certNo` 由本系统生成，`issuedBy` 固定为机构名称，页面如实写明「培训结业证明，由 XX 机构出具」；
- 限流改用 Workers Rate Limiting 绑定，不再用 KV 计数。

KV 的限制，设计时已绕开，但要心里有数：
- 最终一致：写入后其他地区最多约 60 秒才可见。管理员改完立刻刷新自己的页面可能看到旧数据，内部低并发场景可接受；
- 没有事务：创建学员要写 `learner` + `lname` + `lidh` 三个 key，中途失败会留下残缺数据，所以写入顺序固定为「先索引、后主记录」，并提供一个修复脚本；
- 同一个 key 约每秒 1 次写入上限：不要把高频更新的计数放进同一个 key；
- 没有条件查询：「按班级筛选」「按状态筛选」要靠 key 前缀或 metadata 在 Worker 里过滤。数据量到几千条以上、筛选需求变多时，再考虑换 D1，key 结构里的 id 可以直接迁过去。

## 5. 接口划分

```
POST /api/auth/login            学员登录
POST /api/auth/admin-login      管理员登录
POST /api/auth/logout
GET  /api/me

# 学员端（只能访问自己的数据，所有查询带 learner_id = session.userId）
GET  /api/my/enrollments
GET  /api/my/enrollments/:id    含课程记录与证明
POST /api/my/change-password

# 管理后台（requireAdmin）
GET/POST       /api/admin/learners
PUT/DELETE     /api/admin/learners/:id
GET/POST       /api/admin/enrollments
PUT/DELETE     /api/admin/enrollments/:id
POST           /api/admin/enrollments/:id/records
POST           /api/admin/enrollments/:id/certificate     生成结业证明
POST           /api/admin/files                           上传到 R2，返回 key
GET/PUT        /api/admin/settings
GET            /api/admin/audit

# 公开（可选）
GET  /api/verify?certNo=…&code=…   只返回「该证明是否由本机构出具、是否有效」，不返回个人信息
```

取代原来 `/api/query` 的公开按「姓名 + 证件号」查询。

## 6. 前端页面

学员端（手机优先）：登录 · 我的培训（列表 + 详情）· 我的（改密码、退出）。
管理后台：登录 · 学员管理 · 培训项目 · 报名与记录 · 证明生成 · 站点设置 · 审计日志。

设计原则：
- 使用机构自己的品牌色、字体和版式，不模仿官方平台；
- 表单与表格由 `packages/schema` 的字段定义驱动渲染，改字段只改一处；
- 页面顶部/底部保留「内部使用」说明文字。

## 7. 安全基线

- 密码：PBKDF2-SHA256（≥ 100k 次迭代，每用户随机盐），常量时间比较；
- 会话：随机 token 存 KV（7 天 TTL），Cookie 设置 `HttpOnly; Secure; SameSite=Lax`；
- 限流：登录与验证码接口使用 Workers Rate Limiting 绑定，替代 KV 计数；
- 所有写操作记 `audit_log`；
- 上传限制类型与大小，R2 对象不公开，经 Worker 鉴权读取；
- 管理后台增加 CSRF 防护（自定义请求头校验）。

## 8. 迁移步骤

1. 新建 `apps/worker`（Hono + TS）与 KV/R2 绑定，保留旧 Worker 不动。
2. 写 schema 包与 KV 读写封装（统一处理索引先写、metadata、cursor 分页）。
3. 写一次性迁移脚本：读取旧 KV 的 `user:*`、`student:*`，按新 key 结构写入（旧字段按新模型转换，照片搬到 R2）。
4. 前端用 Vite 重建，先做管理后台，再做学员端。
5. 灰度切换域名，确认后下线旧 Worker 与 `build.mjs`。

## 9. 部署

- 单一 `wrangler.jsonc`：`assets`、`r2_buckets`、`kv_namespaces`、`vars`；
- secrets：`ADMIN_PASSWORD`（首次初始化管理员）、`ID_ENC_KEY`；
- CI：`vite build` → `wrangler deploy`。

## 10. 管理后台实现（apps/admin）

管理员后台已按本文的 KV 方案落地为 `apps/admin/`：由 `schema.js` 的资源定义驱动接口和界面，
扩展方式见 `apps/admin/README.md`。注意：后台为了通用，记录统一用 `<resource>:<id>` 作为 key；
第 4 节里按学员分组的 `enroll:<learnerId>:<id>` 前缀留给之后的学员端接口使用。
