# 培训管理后台（apps/admin）

管理员后台：一个 Worker（接口）+ 一套无框架的原生前端。数据全部放 KV，照片等大文件后续放 R2。
记录类型是培训档案：学员、培训项目、报名记录。

## 本地运行

```bash
cd apps/admin
npm install
cp .dev.vars.example .dev.vars      # 改成自己的 ADMIN_PASSWORD；ID_ENC_KEY 用 openssl rand -base64 32 生成
npm run dev                          # http://localhost:8788/admin/
```

## 部署

```bash
npx wrangler kv namespace create KV  # 把返回的 id 填进 wrangler.jsonc
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put ID_ENC_KEY   # openssl rand -base64 32
npm run deploy
```

`ID_ENC_KEY` 丢失后，已加密保存的证件号无法恢复，请单独备份。

## 目录

```
src/schema.js          资源定义（唯一数据来源）
src/index.js           路由：认证、静态资源、/api/admin/*
src/lib/store.js       通用 KV 存储：列表分页、校验、唯一索引、引用保护、审计
src/lib/crypto.js      PBKDF2 密码、AES-GCM 字段加密、常量时间比较
web/admin/             前端（原生 ES modules，无构建步骤）
  js/fields.js         字段类型注册表（registerFieldType）
  js/registry.js       页面注册表（registerPage）
  js/extensions.js     自定义页面和字段类型放这里
  js/views/            总览、列表、表单、审计
```

## 怎么扩展

**新增一类数据**：在 `src/schema.js` 的 `resources` 里加一项，保存后就有接口、侧边栏入口、列表、
搜索、筛选、新建和编辑面板，不用改别的文件。

```js
{
  key: "teachers", label: "教师", plural: "教师", icon: "users", labelField: "name",
  fields: [
    { key: "name",  label: "姓名", type: "text", required: true, list: true, search: true },
    { key: "title", label: "职称", type: "select", options: ["初级", "中级", "高级"], list: true, filter: true },
  ],
}
```

字段属性：`required` `unique` `immutable` `list` `search` `filter` `options` `badges` `to`（ref 指向的资源）
`min` `max` `pattern` `hint` `placeholder`。完整说明在 `schema.js` 顶部注释。

**新增页面**（报表、批量导入等）：在 `web/admin/js/extensions.js` 里 `registerPage({ id, label, icon, render })`。

**新增字段类型**（图片、标签、富文本等）：`registerFieldType(name, { input, cell })`，
然后在 schema 里把字段的 `type` 写成这个名字。

## 数据在 KV 里的样子

```
learners:<id> / programs:<id> / enrollments:<id>   记录 JSON；metadata 放列表用的短字段
u:<resource>:<field>:<value>  -> id                唯一索引（先写索引、后写记录）
session:<token>                                    会话（7 天）
audit:<反向时间戳>:<rand>                           审计日志（90 天）
```

id 以反向时间戳开头，所以 `KV.list` 的顺序就是新建时间倒序。列表只读 metadata，不逐条 get。

已知限制（KV 的特性）：写入后其他地区最多约 60 秒才可见；没有事务；搜索和筛选只能在 metadata 上做，
数据到几千条以上后建议换 D1，`schema.js` 和前端不用改，替换 `src/lib/store.js` 即可。

## 安全

- 管理员密码常量时间比较；会话 token 随机 256 位，Cookie `HttpOnly; SameSite=Strict`，HTTPS 下加 `Secure`。
- 所有写操作要求自定义请求头 `X-Requested-With: fetch`（跨站表单无法带上）。
- 登录限流：生产用 Workers Rate Limiting 绑定，本地退回 KV 计数。
- 证件号 AES-GCM 加密存储，接口只返回脱敏值；学员密码 PBKDF2-SHA256（10 万次）。
- 页面带 CSP，前端不使用 `innerHTML` 拼接用户数据。
- 所有新增、修改、删除和登录都会写入操作记录。
