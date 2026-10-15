/** 入口统一校验：所有 body 先 stringify-safe 化，阻断类型绕过 */
import { USERNAME_RE, ID_NUMBER_RE, ID_NUMBER_LOOSE_RE, STATUS_LIST, ERROR_CODES } from "@chsi/shared";
import { err } from "./http.js";

/** 把任何值归一为对象，非对象即空对象 */
export function asObject(v) {
  if (v == null || typeof v !== "object" || Array.isArray(v)) return {};
  return v;
}

/** 必须是 string 才返回，否则 ""（阻断 12345 无 .length 绕过） */
export function str(v, max = 4096) {
  if (typeof v !== "string") return "";
  return v.slice(0, max);
}

export function trimStr(v, max = 4096) {
  return str(v, max).trim();
}

export function username(v) {
  const s = trimStr(v, 64);
  return USERNAME_RE.test(s) ? s : null;
}

export function password(v) {
  if (typeof v !== "string" || v.length < 6 || v.length > 64) return null;
  return v;
}

export function idNumber(v) {
  const s = trimStr(v, 32).replace(/\s+/g, "");
  if (ID_NUMBER_RE.test(s) || ID_NUMBER_LOOSE_RE.test(s)) return s;
  return null;
}

export function status(v) {
  const s = trimStr(v, 20);
  return STATUS_LIST.includes(s) ? s : null;
}

export function gender(v) {
  const s = trimStr(v, 20);
  return ["男", "女"].includes(s) ? s : "";
}

/** 针对 STUDENT_FIELDS 的批量校验 + 清洗 */
export function validateStudentFields(b) {
  const errs = [];
  const out = {};
  const name = trimStr(b.name, 40);
  if (!name || name.length > 20) errs.push("姓名不能为空且不超过20字");
  const idn = trimStr(b.idNumber, 40).replace(/\s+/g, "");
  if (!idn || idn.length < 6 || idn.length > 20) errs.push("证件号码格式不正确（需 6~20 位）");
  if (errs.length) return { errs, out };
  out.name = name;
  out.idNumber = idn;
  out.gender = gender(b.gender);
  const pick = (v, max = 60) => (v == null ? "" : String(v).slice(0, max));
  for (const k of ["ethnicity", "birthdate", "idType", "studentNo", "level", "major", "duration",
    "studyMode", "eduCategory", "branch", "dept", "className", "enrollDate", "gradDate",
    "gradType", "presidentName", "certNo", "degreeName", "degreeUnit", "institution", "remark"]) {
    out[k] = pick(b[k], 200);
  }
  const st = trimStr(b.status, 20);
  out.status = STATUS_LIST.includes(st) ? st : "在读";
  return { errs, out };
}

/** 统一 400 */
export function badReq(error, code = ERROR_CODES.VALIDATION) {
  return err(400, code, error);
}
