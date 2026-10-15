/**
 * 资源定义：后台的唯一数据来源。
 *
 * 在这里加一项，就同时得到：
 *   - /api/admin/r/<key> 的增删改查、校验、唯一约束、引用保护、审计
 *   - 后台侧边栏入口、列表页（搜索/筛选/分页）、新建与编辑面板
 *
 * 字段属性：
 *   key        字段名
 *   label      界面显示名
 *   type       text | textarea | select | date | boolean | ref | secret | password
 *              （前端可用 registerFieldType 增加新类型）
 *   required   必填
 *   unique     唯一（自动建立索引 key）
 *   immutable  创建后不可修改
 *   list       在列表里显示（会进入 KV metadata，所以只放短字段）
 *   search     参与列表搜索
 *   filter     在列表顶部提供筛选（仅 select）
 *   options    select 的选项
 *   badges     select 值 → 徽标样式（ok | info | warn | muted）
 *   to         ref 指向的资源 key
 *   max/min/pattern/hint/placeholder  校验与提示
 *
 * 资源属性：
 *   labelField  被其他资源引用时显示的字段
 *   breakdown   总览页按该字段做分布条
 */
export const resources = [
  {
    key: "learners",
    label: "学员",
    plural: "学员",
    icon: "users",
    labelField: "name",
    fields: [
      { key: "name", label: "姓名", type: "text", required: true, max: 20, list: true, search: true },
      {
        key: "username", label: "登录用户名", type: "text", required: true, unique: true, immutable: true,
        pattern: "^[a-zA-Z0-9_]{3,20}$", hint: "3–20 位字母、数字或下划线，创建后不能修改",
        list: true, search: true,
      },
      { key: "gender", label: "性别", type: "select", options: ["男", "女"], list: true, filter: true },
      { key: "phone", label: "手机号", type: "text", pattern: "^1\\d{10}$", hint: "11 位手机号", max: 11, list: true, search: true },
      {
        key: "idNumber", label: "证件号码", type: "secret", max: 24,
        hint: "加密存储，界面只显示脱敏后的值",
      },
      {
        key: "password", label: "登录密码", type: "password", min: 6, max: 64,
        requiredOnCreate: true, hint: "6–64 位。编辑时留空表示不修改",
      },
    ],
  },
  {
    key: "programs",
    label: "培训项目",
    plural: "培训项目",
    icon: "book",
    labelField: "name",
    fields: [
      { key: "name", label: "项目名称", type: "text", required: true, max: 40, list: true, search: true },
      {
        key: "category", label: "类别", type: "select", list: true, filter: true,
        options: ["技能培训", "职业资格", "兴趣课程", "其他"],
      },
      { key: "durationText", label: "学制", type: "text", max: 20, placeholder: "例如 3 个月", list: true },
      { key: "active", label: "正在招生", type: "boolean", list: true },
    ],
  },
  {
    key: "enrollments",
    label: "报名记录",
    plural: "报名记录",
    icon: "clipboard",
    labelField: "className",
    breakdown: "status",
    fields: [
      { key: "learnerId", label: "学员", type: "ref", to: "learners", required: true, list: true },
      { key: "programId", label: "培训项目", type: "ref", to: "programs", required: true, list: true },
      { key: "className", label: "班级", type: "text", max: 30, list: true, search: true },
      { key: "enrollDate", label: "报名日期", type: "date", list: true },
      { key: "expectedEndDate", label: "预计结业日期", type: "date" },
      {
        key: "status", label: "状态", type: "select", required: true, list: true, filter: true,
        options: ["在读", "已结业", "休学", "退出"],
        badges: { 在读: "info", 已结业: "ok", 休学: "warn", 退出: "muted" },
      },
      { key: "remark", label: "备注", type: "textarea", max: 300 },
    ],
  },
];

export const getResource = (key) => resources.find((r) => r.key === key);
