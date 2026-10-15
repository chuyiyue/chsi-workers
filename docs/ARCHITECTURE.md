# chsi-workers 架构方案

版本 v1 · 2026-10-16 · 对应现状 main@b0a8261（单 Worker 全家桶：520 行 worker.js + 6 个 HTML 内联 JS，public/ 直接 serving，无 CI）

## 0. 本方案同时解决的存量问题

| 存量问题（见 CHSI-REVIEW 审查） | 本方案的对策 |
|---|---|
| /api/query 全库扫描、验证码明文、限流竞态 | idNumber 索引键 O(1) 命中、Turnstile、DO/规则限流 |
| KV list 1000 截断 | core/kv.js 统一 cursor 分页 |
| 照片 base64 内联撑爆 KV/带宽 | 照片独立存储（R2 优先），记录里只存 key/URL |
| SHA-256 单轮、固定盐、=== 比较 | core/password.js PBKDF2(100k) + 恒时比较 |
| 删号/改密后会话不死 | 会话绑定 uid+tokenVersion |
| 类型校验缺失（数字密码绕过、500） | core/validator.js 入口统一 is-string 前置校验 |
| 无测试无 CI，KV id 手改 toml | vitest+miniflare、Actions 部署、toML 变量注入 |
| 废弃 login.html/console.html 死链 | 前台、后台两个 app 重建时直接不搬 |

## 1. 总体拓扑：代码分离，部署分两阶段

**原则：前后端在代码层彻底分离（四个 package），部署形态分阶段演进，先不依赖自定义域名。**

### Phase 1（现在）——单 Worker 网关，同源免 CORS

```
浏览器
  └─ chsi-app  (apps/api 构建产物，一个 Worker)
       ├─ /api/v1/*   → API 代码（纯 JSON，无 HTML）
       ├─ /admin/*    → apps/admin/dist（静态资产，assets binding）
       └─ /*          → apps/web/dist（静态资产，assets binding）
```

- Cookie 同源可用，不用 SameSite=None，不碰自定义域名。
- 三个 app 各自独立构建、独立发版边界，只是共享一个部署单元；拆分时不动代码。
- HTML 响应统一注入安全头 + CSP；静态资产 max-age=3600，HTML no-cache。

### Phase 2（想拆时）——三 Worker + 自定义域名

```
chsi-web    → www.example.com      （纯静态 Worker）
chsi-admin  → admin.example.com   （纯静态 Worker，独立访问控制更容易加 WAF）
chsi-api    → api.example.com     （纯 API Worker，CORS 白名单 + SameSite=None/Secure cookie）
```

触发条件：需要绑定正式域名、需要给后台上 WAF/IP 白名单、或 API 想给第三方调用。hostname 变更届时单独确认。

### 为什么不用 Pages

用户环境是 CF 免费版 + Actions 部署偏好；_workers assets 已原生支持纯静态服务，少一个产品线。

## 2. Monorepo 结构

```
chsi-workers/
├── package.json               # pnpm workspaces；脚本：lint / test / build / deploy:staging / deploy:prod
├── pnpm-workspace.yaml
├── apps/
│   ├── api/                   # 后端（纯 API + 网关路由）
│   │   ├── src/
│   │   │   ├── index.js       # fetch 入口：request-id → 安全头 → 路由分发；无常驻依赖
│   │   │   ├── router.js      # 80 行内的方法+路径匹配器，支持 /api/students/:sid 参数
│   │   │   ├── middleware/
│   │   │   │   ├── auth.js        # 会话解析、requireUser / requireAdmin
│   │   │   │   ├── rateLimit.js   # 按 route 维度配置，KV 计数 + 可选 DO
│   │   │   │   ├── turnstile.js   # register/query/login 站点部署开关
│   │   │   │   └── validate.js    # content-type / body 上限 / 字段白名单
│   │   │   ├── routes/
│   │   │   │   ├── auth.js        # register login logout me change-password
│   │   │   │   ├── students.js    # CRUD，列表 cursor 分页；admin 可代录
│   │   │   │   ├── admin-users.js # /api/v1/admin/users CRUD
│   │   │   │   ├── query.js       # 公开查询（索引键）
│   │   │   │   └── photos.js      # POST /photos 直传，返回 {key,url}；GET /photos/:key 302 R2
│   │   │   └── core/
│   │   │       ├── kv.js          # listAll(cursor 循环)、getJSON/putJSON、TTL 帮手
│   │   │       ├── session.js     # session:<uid>:<token>；密码改→tokenVersion+1
│   │   │       ├── password.js    # PBKDF2-SHA256 100k + timingSafeEqual
│   │   │       ├── validator.js   # ensureString/ensureEnum/ensureDate；所有 body 先过
│   │   │       ├── photoStore.js  # R2 binding，降级：无 R2 时退「KV 单独 photo: 键」
│   │   │       └── http.js        # json()/err() + 统一错误码 + 安全响应头
│   │   ├── migrations/kv-v1-to-v2.js   # 一次性数据迁移：照片拆键、记录加 org/type
│   │   ├── wrangler.jsonc         # kv/r2/turnstile 均用 vars 注入；env: staging/prod
│   │   └── test/                  # vitest + @cloudflare/vitest-pool-workers
│   ├── web/                   # 前台：学籍查询 | 帮助中心 | 登录/注册 | 我的
│   │   ├── public/index.html …
│   │   └── src/
│   │       ├── main.js            # 原生 ES module，无框架
│   │       ├── router.js          # hash 路由
│   │       ├── api.js             # 共享 API client
│   │       └── views/…            # query / login / register / me / help
│   ├── admin/                 # 后台：与前台完全独立 bundle，独立样式，仅管理员
│   │   ├── public/…
│   │   └── src/main.js …      # users / students / 代录 / 照片上传
│   └── （构建均先保留各 app 的 build.mjs；后续可选升级 Vite，不影响后端）
├── packages/
│   └── shared/
│       └── src/index.js       # STUDENT_FIELDS、STATUS 枚举、ERROR_CODES、脱敏工具
│                             # 唯一的「合同」：api/web/admin 三端共同引用，字段改动一处生效
├── .github/workflows/deploy.yml
└── docs/
    ├── ARCHITECTURE.md        # 本文档
    └── api.md                 # /api/v1 接口表（错误码、分页约定、权限矩阵）
```

pnpm workspace 三处收益：`shared` 单点维护字段/错误码；依赖版本锁死（不再 npx 拉最新 wrangler）；API 包保持零 npm 依赖。

## 3. 前端范围调整（本期需求）

前台导航与信息架构收窄为：

- **学籍查询**（公开，Turnstile 保护）
- **帮助中心**
- **登录 / 注册**
- **我的**（登录后：本人学籍记录 CRUD、修改密码、退出）

明确不做的：前台不再出现**管理后台**入口链接（后台仅 /admin 路径直达）；前台不再展示**学历信息**分区（数据字段保留，只是 UI 不呈现；后台仍可录入管理）。

## 4. 数据模型（KV + 照片）

```
user:<username>              → { id, username, salt, passHash, role, orgId, tokenVersion, createdAt }
session:<uid>:<token>        → { uid, username, role, ver }     TTL 7d   # ver 不匹配即失效
student:<uid>:<sid>          → { sid, uid, orgId, type: xueji|xueli|degree,
                                 fields…, photoKeys:{photo,photo2}, published, createdAt, updatedAt }
photo:<sid>:<n>              → 二进制（R2 优先，降级 KV）
idx:q:<sha256(name|idNumber) → sid 列表（公开查询用；key 是哈希，防 PII 入 key 名）
rl:<route>:<ip>              → 计数器 TTL 60s
```

- **多机构可发展**：orgId 现在就写进模型（默认 'demo'），查询/管理可按 org 过滤，为多校区/多机构复用留位。
- **type 字段**替代「status==已结业 即学历」的隐式推断，UI 收窄后数据不丢。
- KV 最终一致性：注册成功即返回会话（保持现状）；需要原子计数的地方（限流）标注「尽力而为」，强一致改 DO。

## 5. 会话与安全基线

- Cookie：`Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=7d`。
- 登录限流：IP+用户名双维度，503 指数退避；Turnstile 开关挂到 register/login/query。
- /api/v1 全局安全头 + HTML CSP（connect-src 'self'；img-src 'self' data: R2 域）。
- 错误统一 `{ok:false, code:"E_XXX", error:"人类可读", traceId}`；catch 里 console.error(e.stack) 不再吞。
- admin 路由全部挂 requireAdmin；后台 HTML 加 frame-ancestors 'none'。

## 6. CI/CD（Actions）

```
push/PR → main:
  lint(eslint) → test(vitest-pool-workers，含 1080 条分页、会话失效、限流、脱敏回归)
  → build(web/admin/api)
PR merge main → deploy staging（wrangler-action，secrets: CF_API_TOKEN、KV id、TURNSTILE keys）
manual gate → deploy prod（同配置 prod env）
```

- wrangler.jsonc 里 KV/R2 id 从 Actions 变量注入，不再手改文件。
- 免费版 cron 配额与本仓无关（无 cron）。

## 7. 迁移与里程碑（每步可独立验证）

| milestone | 内容 | 验收 |
|---|---|---|
| M1 骨架 | workspaces 拆分，api 骨架（router/core/middleware）+ 全套单元测试上线；老 public/ 原样保留 | vitest 全绿；wrangler dev 三 app 均起 |
| M2 后端重写 | auth/session/password/validator/students/query/photos 全部迁入新 core；cursor 分页；索引键查询 | 用审查脚本回归：captcha bypass 不成立、1080 条全可见、改密踢会话 |
| M3 照片拆离 | R2 绑定 + mc migrations 脚本把存量 KV 照片迁出；记录里存 key | 单条记录体积 < 20KB；大图上传 200 |
| M4 前台重建 | apps/web 按新导航实现（原生 JS），删除 login.html/console.html 死链 | 手动过一遍：查询/登录/注册/我的/改密 |
| M5 后台重建 | apps/admin 迁移（独立 bundle），admin 路由全部 /api/v1/admin/* | 后台用户 CRUD + 代录 + 照片上传可用 |
| M6 CI | Actions lint/test/deploy 架设 + staging/prod env | push→staging 自动部署成功 |

每步合一次 main，保持可部署状态；M2 完成前老 API 兼容层不拆。

## 8. 边界与非目标

- 不引入前端框架/Vue/React（保持「能跑就别折腾」，需要时再上 Vite）。
- 不做 D1 迁移除非记录量级暴涨（KV + 索引键在 <10k 学员规模够用）。
- 不绑域名（Phase 2 再议，hostname 届时确认）。
- 数据量级假设：<= 万级学员、记录 KB 级；照片是主要体积，必须出 KV。
