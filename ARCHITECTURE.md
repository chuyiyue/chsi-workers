# 培训机构学员档案 · 架构与产品方案 v4

> v4 修订（2026-10-16）：产品方向调整 —— **去掉公开查询**，学员端收敛为
> 「教育信息 + 个人中心」两页；学员账号由管理员开通，教育经历由学员自助录入。
> 术语**不改**（保留学籍 / 学历 / 学位体系，界面文字不动）；密码**保持加盐 SHA-256**。

## 一、定位与边界

培训机构学员档案（演示系统）。与任何官方学历平台无关联，页面常驻演示标识。

明确不做：

- **公开查询** —— 已下线。`/api/query`、验证码、查询限流一并移除（匿名查他人档案
  本身就不该存在）。
- **自助注册** —— 已下线。账号只能由管理后台开通。
- **一键生成"官方感"档案的入口**：学员确实可以自助录入教育经历（用户 v4 明确要求），
  但记录一律归属本人、只能自己看，且结业证明页如实写明"由 XX 机构出具"，不做官方话术。

## 二、学员端（手机优先，底栏两个按钮）

### 1. 教育信息
- 分两组列出本人的**学籍信息**与**学历 / 学位信息**；
- 卡片显示：项目（专业/课程）、班级、状态（在读 / 已结业 / 休学 / 退出）、起止日期；
- 点开详情：全部字段（含分院/系所/证书编号/学位名称/学位授予单位等）+ **结业证明**区，
  证明区明示出具机构与"演示数据，不作为学历凭证"；
- 学员可**新增 / 编辑 / 删除自己的教育经历**。类型由数据推导，不设显式开关：
  状态「已结业」→ 学历信息；填了学位名称 → 学位信息；否则 → 学籍信息。

### 2. 个人中心
- 头像（外链）、显示名称、手机号、邮箱；
- 修改密码、退出登录；
- 学员可改的只有联系方式与密码；用户名、角色、归属不可改。

## 三、接口

```
POST /api/login                       学员 / 管理员登录（管理后台同源）
POST /api/logout                      GET /api/me
GET  /api/my/enrollments              我的教育经历（?kind=edu|xueji&status=）
GET  /api/my/enrollments/:sid         详情（限本人；他人 404）
POST /api/my/enrollments              新增
PUT  /api/my/enrollments/:sid         编辑
DELETE /api/my/enrollments/:sid       删除
GET  /api/my/profile                  个人资料
PUT  /api/my/profile                  只改联系方式（phone / email / displayName / avatar）
POST /api/my/change-password           改密（作废该用户全部旧会话，当前设备换新 cookie）
```

- 所有 `/api/my/*` 一律按登录会话的 `uid` 取数，**只看自己的记录**；查询参数不能指定他人。
- 学员登录沿用现有会话机制（`session:<uid>:<token>` + `sidx:<token>` 索引，7 天 HttpOnly Cookie）。
  密码为**加盐 SHA-256**（v3 决议维持；方案里"PBKDF2"的说法已作废）。
- 已删除：`/api/query`、`/api/register`、`middleware/turnstile.js`、
  `QUERY_RL_LIMIT` / `CAPTCHA_TTL` / `CAPTCHA_FAILED`、旧 `idx:*` 索引写入。
  登录限流（KV 计数，10/min/IP）保留。

## 四、管理后台

| 板块 | 内容 |
|---|---|
| 用户管理 | 开通学员账号、重置密码、删除用户（连带其教育经历与照片）、代录教育经历 |
| 教育经历管理 | 全量列表 + 按用户过滤 + 搜索 + 编辑 + 删除 |
| 网站设置 | 站点名 / 机构名 / 演示标识开关 |

## 五、数据与存储

```
user:<username>            { id, username, salt, passHash, role, orgId, tokenVersion, phone, email, displayName, avatar }
session:<uid>:<token>      会话（7 天）
sidx:<token>               token → uid 索引
student:<uid>:<sid>        教育经历（type: xueji|xueli|degree；照片只存 key/URL）
photo:photos/<sid>/<n>.bin 照片（R2 优先，无 R2 时降级 KV）
site:settings              站点设置
```

- 照片：R2 优先、KV 降级；记录里只存 `photoKeys`（`{kind,key}` 或 `{kind:"url",url}`），
  读取走 `/api/photos/:sid/:n` 鉴权（本人或管理员）。
- 公开查询相关的 `published` 字段与 `idx:*` 索引已废弃。

## 六、实施状态

| 步骤 | 状态 |
|---|---|
| 1. 学员登录 + `/api/my/*` 接口 | ✅ 完成 |
| 2. 培训档案页（教育信息）+ 个人中心页 | ✅ 完成 |
| 3. 管理后台教育经历录入入口 | ✅ 完成（原有代录入口沿用） |
| 4. 旧 KV 迁移到新结构（去 published / 清 idx / 照片拆离） | ✅ 脚本就绪（含 dryRun），待线上执行 |
| 5. 旧 Worker / 旧代码下线 | ✅ 无部署影子（旧 `src/worker.js`、`public/` 已从仓库删除） |

## 七、已知局限（承认但不处理）

- 学员自助录入决定档案内容由学员自己负责，系统不做真伪背书；
  结业证明区只声明出具机构与演示性质。
- 限流为 KV 计数（最终一致），非原子；内部演示规模够用，将来被刷再换
  Workers Rate Limiting 绑定。
- 教育经历列表一次性拉全（cursor 循环）后在内存过滤，未做服务端分页游标返回；
  内部演示规模（千级）实测通过（1010 条不截断）。
