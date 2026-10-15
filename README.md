# 学员学籍信息查询与管理平台（演示系统）

仿学信档案布局风格的培训机构学籍演示站：登录后查看个人学籍/学历档案。
运行于 Cloudflare Workers，全部数据（含证件照片字节）存于 KV。

> 品牌说明：页面使用占位机构名"某某职业技能培训学校"，部署前请替换为真实机构名
> （`public/js/app.js` 顶部 `INSTITUTION` 常量、各 HTML 的标题/页脚）。
> 全站带有"演示系统 · 非官方"标识，与学信网无关。

## 功能

- **学籍档案**（登录后）：手机端仿学信档案——绿色顶栏 + 高等教育信息（学籍/学历/学位/考研分区），学籍=绿色大卡双照片、学历=蓝色大卡单照片，证件号码脱敏；在读不展示学历照片；支持多条学籍/学历同时展示
- **底栏导航**：教育信息 / 我的；「我的」是个人中心——头像、学籍信息设置（可新增/编辑自己的多条学籍信息）、修改密码、退出登录
- **用户自助注册/登录**：每个用户只能查看和修改自己名下的档案，数据相互隔离
- **管理员**（独立入口 `/admin`，简洁后台风格）：用户管理——新增用户、删除用户、修改用户密码；在用户详情内代录/编辑/删除其学籍（含照片上传存 KV 或外链）
- 会话：KV 存储，HttpOnly Cookie，7 天有效期；密码 SHA-256 加盐哈希
- `/api/query` 公开查询接口保留在后端，前端无入口

## 目录结构

```
src/worker.js          Worker 源码（API + 静态资源 serving）
public/                前端页面（登录/注册/学籍档案/管理后台/帮助）
build.mjs              构建脚本：把 public/* 内联为 dist/worker.js
dist/worker.js         部署包（构建产物）
wrangler.toml          本地开发配置（[assets] 直连 public/）
wrangler.deploy.toml   API 部署配置（用 dist 包，无需 [assets]）
```

## 本地开发

```bash
npx wrangler dev --port 8787
```

KV 走本地模拟。管理员登录需先设置密码：`echo 'ADMIN_PASSWORD="xxx"' > .dev.vars`（仅本地）。

## 部署（Muse 自动部署）

Muse 通过 Cloudflare API 部署，无需 wrangler CLI：

```bash
node build.mjs
python3 ~/workspace/custom-connectors/custom.cloudflare/bin/deploy-worker.py \
  --project ~/workspace/xuexin-demo --admin-password "$ADMIN_PW"
```

脚本自动完成：取 account id → 创建/复用 KV namespace → 上传 Worker（含内联静态资源）→ 写入 ADMIN_PASSWORD secret → 输出访问地址。

所需 Cloudflare API Token 权限（dash.cloudflare.com → 我的个人资料 → API 令牌 → 创建令牌，
使用"编辑 Cloudflare Workers"模板）：Workers 脚本编辑、KV 存储编辑、账户读取。

## 手动部署（wrangler）

```bash
export CLOUDFLARE_API_TOKEN=...
node build.mjs
npx wrangler kv namespace create KV   # 把 id 填入 wrangler.deploy.toml
npx wrangler deploy --config wrangler.deploy.toml
npx wrangler secret put ADMIN_PASSWORD --config wrangler.deploy.toml
```

## KV key 设计

- `user:<username>` → 用户（含 salt/passHash/role）
- `session:<token>` → 会话（TTL 7 天）
- `student:<ownerId>:<sid>` → 学籍记录
- `captcha:<cid>` → 验证码（TTL 5 分钟，一次性）
- `rl:<ip>` → 查询限流计数（TTL 60 秒）
