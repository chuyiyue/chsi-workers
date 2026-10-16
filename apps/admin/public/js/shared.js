/* 管理后台共享 client + 学籍表单 */
export async function api(path, opts = {}) {
  const r = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.ok === false) {
    const e = new Error(d.error || `请求失败（${r.status}）`);
    e.code = d.code;
    throw e;
  }
  return d;
}

export async function currentUser() {
  try { return (await api("/api/me")).user; } catch { return null; }
}

export function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function showMsg(id, text, ok) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text || "";
  el.className = "msg " + (ok ? "ok" : "error");
}

/* 与前台一致的学籍字段定义（M6 可抽到 packages/shared） */
export const STUDENT_FIELDS = [
  ["name", "姓名", "text", 1], ["gender", "性别", "select:;男;女", 0],
  ["ethnicity", "民族", "text", 0], ["birthdate", "出生日期", "text", 0],
  ["idType", "证件类型", "text", 0], ["idNumber", "证件号码", "text", 1],
  ["studentNo", "学号", "text", 0], ["level", "培训层次", "text", 0],
  ["major", "专业/课程", "text", 0], ["duration", "学制", "text", 0],
  ["studyMode", "学习形式", "text", 0], ["eduCategory", "学历类别", "text", 0],
  ["branch", "分院", "text", 0], ["dept", "系所", "text", 0], ["className", "班级", "text", 0],
  ["enrollDate", "入学日期", "text", 0], ["gradDate", "毕（结）业日期", "text", 0],
  ["gradType", "毕（结）业", "select:;毕业;结业", 0],
  ["presidentName", "校（院）长姓名", "text", 0], ["certNo", "证书编号", "text", 0],
  ["status", "学籍状态", "select:在读;已结业;休学;退学", 0],
  ["degreeName", "学位名称", "text", 0], ["degreeUnit", "学位授予单位", "text", 0],
  ["institution", "培训机构", "text", 0],
];

export function studentFormHTML(values = {}) {
  let h = "";
  for (const [key, label, type, req] of STUDENT_FIELDS) {
    const v = esc(values[key] || "");
    if (type.startsWith("select:")) {
      const opts = type.slice(7).split(";");
      h += `<label class="fl">${label}${req ? " *" : ""}</label><select class="in" name="${key}">` +
        opts.map((o) => `<option value="${esc(o)}" ${o === (values[key] || "") ? "selected" : ""}>${o === "" ? "请选择" : esc(o)}</option>`).join("") +
        `</select>`;
    } else {
      h += `<label class="fl">${label}${req ? " *" : ""}</label><input class="in" name="${key}" value="${v}">`;
    }
  }
  h += `<label class="fl">备注</label><input class="in" name="remark" value="${esc(values.remark || "")}">`;
  return h;
}

export function collectStudentForm(form) {
  const fd = new FormData(form);
  const o = {};
  for (const [k, v] of fd.entries()) o[k] = typeof v === "string" ? v.trim() : v;
  return o;
}
