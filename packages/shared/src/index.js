/** shared package：前后端共用常量、枚举、错误码与工具
 * 设计原则：纯 ESM、零依赖；字段定义是 api/web/admin 三端的唯一合同 */

/** 学籍状态枚举 */
export const STATUS = {
  ENROLLED: "在读",
  GRADUATED: "已结业",
  SUSPENDED: "休学",
  WITHDRAWN: "退学",
};
export const STATUS_LIST = Object.values(STATUS);

/** 学历类型：xueji=在读学籍 xueli=已结业学历 degree=学位 */
export const REC_TYPE = {
  XUEJI: "xueji",
  XUELI: "xueli",
  DEGREE: "degree",
};

/** 学籍字段 schema：api/web/admin 三端共用
 * [key, label, type, required, maxLen]；type: text|date|select:;a;b */
export const STUDENT_FIELDS = [
  ["name", "姓名", "text", 1, 20],
  ["gender", "性别", "select:;男;女", 0, 2],
  ["ethnicity", "民族", "text", 0, 20],
  ["birthdate", "出生日期", "date", 0, 20],
  ["idType", "证件类型", "text", 0, 20],
  ["idNumber", "证件号码", "text", 1, 20],
  ["studentNo", "学号", "text", 0, 30],
  ["level", "培训层次", "text", 0, 30],
  ["major", "专业/课程", "text", 0, 60],
  ["duration", "学制", "text", 0, 20],
  ["studyMode", "学习形式", "text", 0, 20],
  ["eduCategory", "学历类别", "text", 0, 20],
  ["branch", "分院", "text", 0, 40],
  ["dept", "系所", "text", 0, 40],
  ["className", "班级", "text", 0, 40],
  ["enrollDate", "入学日期", "date", 0, 20],
  ["gradDate", "毕（结）业日期", "date", 0, 20],
  ["gradType", "毕（结）业", "select:;毕业;结业", 0, 10],
  ["presidentName", "校（院）长姓名", "text", 0, 20],
  ["certNo", "证书编号", "text", 0, 40],
  ["status", "学籍状态", `select:;${STATUS_LIST.join(";")}`, 0, 20],
  ["degreeName", "学位名称", "text", 0, 30],
  ["degreeUnit", "学位授予单位", "text", 0, 60],
  ["institution", "培训机构", "text", 0, 60],
  ["remark", "备注", "text", 0, 200],
];

/** 展示字段集合（不存储15位以上证件号原文，只存脱敏或全量由用户选择） */

/** 统一错误码（我在 使用 util/err 调用） */
export const ERROR_CODES = {
  BAD_REQUEST: "E_BAD_REQUEST",
  VALIDATION: "E_VALIDATION",
  UNAUTHORIZED: "E_UNAUTHORIZED",
  FORBIDDEN: "E_FORBIDDEN",
  NOT_FOUND: "E_NOT_FOUND",
  CONFLICT: "E_CONFLICT",
  RATE_LIMITED: "E_RATE_LIMITED",
  PAYLOAD_TOO_LARGE: "E_PAYLOAD_TOO_LARGE",
  SERVER: "E_SERVER",
};

/** 脱敏：18位身份证 保留前6后4，中间8位掩码 */
export function maskIdNumber(id) {
  const s = String(id || "");
  if (/^\d{17}[\dXx]$/.test(s)) return s.slice(0, 6) + "********" + s.slice(-4);
  if (s.length > 8) return s.slice(0, 3) + "****" + s.slice(-4);
  return "****";
}

/** 会话 Cookie 常量 */
export const SESSION_COOKIE = "session";

/** 7 天秒数 */
export const SESSION_TTL = 7 * 24 * 3600;

/** 60 秒秒数（限流窗） */
export const RL_WINDOW = 60;

/** 用户名格式 */
export const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

/** 演示系统：允许 6~20 位身份证或包含字母的复合证件号 */
export const ID_NUMBER_RE = /^\d{15}$|^\d{17}[\dXx]$/;
export const ID_NUMBER_LOOSE_RE = /^[0-9A-Za-z\-]{6,20}$/;

/** KV key 组装（统一约定，防止 key 散落字符串） */
export const KV = {
  user: (username) => `user:${username}`,
  session: (uid, token) => `session:${uid}:${token}`,
  sessionPrefixFor: (uid) => `session:${uid}:`,
  student: (uid, sid) => `student:${uid}:${sid}`,
  studentPrefixFor: (uid) => `student:${uid}:`,
  idx: (digest) => `idx:${digest}`,
  rl: (route, ip) => `rl:${route}:${ip}`,
};

/** R2 key 前缀 */
export const R2 = {
  photo: (sid, n) => `photos/${sid}/${n}.bin`,
};
