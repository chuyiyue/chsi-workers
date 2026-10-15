/* 公共前端逻辑 */
const INSTITUTION = "某某职业技能培训学校"; // 部署前可替换为真实机构名

async function api(path, opts = {}) {
  const r = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.ok === false) throw new Error(d.error || `请求失败（${r.status}）`);
  return d;
}

async function currentUser() {
  try {
    return (await api("/api/me")).user;
  } catch (e) {
    return null;
  }
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* 登录态头部渲染 + 退出 */
async function renderUserHeader(u) {
  const top = document.getElementById("topbar-user");
  const head = document.getElementById("head-user");
  if (u) {
    if (top) top.innerHTML = `欢迎，<b>${esc(u.username)}</b>`;
    if (head) head.innerHTML = `欢迎，<b>${esc(u.username)}</b>${u.role === "admin" ? "（管理员）" : ""}<a href="#" id="logout-link">退出</a>`;
  } else {
    if (top) top.innerHTML = `<a href="index.html">登录</a><a href="register.html">注册</a>`;
    if (head) head.innerHTML = `<a href="index.html">登录</a><a href="register.html">注册</a>`;
  }
  const lo = document.getElementById("logout-link");
  if (lo) lo.addEventListener("click", async (e) => {
    e.preventDefault();
    await api("/api/logout", { method: "POST" }).catch(() => {});
    location.href = "index.html";
  });
  const lo2 = document.getElementById("logout-link-2");
  if (lo2) lo2.addEventListener("click", async (e) => {
    e.preventDefault();
    await api("/api/logout", { method: "POST" }).catch(() => {});
    location.href = "index.html";
  });
}

/* 需要登录的页面守卫；requireRole 可为 'admin' */
async function guard(requireRole) {
  const u = await currentUser();
  if (!u) {
    location.href = "index.html?next=" + encodeURIComponent(location.pathname.split("/").pop());
    return null;
  }
  if (requireRole && u.role !== requireRole) {
    location.href = "archive.html";
    return null;
  }
  return u;
}

function showMsg(id, text, ok) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text || "";
  el.className = "form-msg " + (ok ? "ok" : "error");
}

/* 学籍档案表格（只读展示） */
function recordTable(r, masked) {
  const row = (k, v) => `<tr><th>${k}</th><td>${esc(v) || "—"}</td></tr>`;
  return `<table class="info">
    ${row("姓名", r.name)}
    ${row("性别", r.gender)}
    ${row("民族", r.ethnicity)}
    ${row("出生日期", r.birthdate)}
    ${row("证件类型", r.idType)}
    ${row("证件号码", masked ? maskId(r.idNumber) : r.idNumber)}
    ${row("学号", r.studentNo)}
    ${row("培训机构", r.institution)}
    ${row("培训层次", r.level)}
    ${row("专业/课程", r.major)}
    ${row("学制", r.duration)}
    ${row("入学日期", r.enrollDate)}
    ${row("预计结业日期", r.gradDate)}
    <tr><th>学籍状态</th><td><span class="status-pill">${esc(r.status) || "—"}</span></td></tr>
    ${row("数据更新时间", (r.updatedAt || "").replace("T", " ").slice(0, 19))}
  </table>`;
}

function maskId(id) {
  id = String(id || "");
  if (/^\d{17}[\dXx]$/.test(id)) return id.slice(0, 6) + "********" + id.slice(-4);
  if (id.length > 8) return id.slice(0, 3) + "****" + id.slice(-4);
  return "****";
}

/* ---- 网站设置：读取并应用到页面 ---- */
async function applySettings() {
  let s = null;
  try { s = (await api("/api/settings")).settings || {}; }
  catch (e) { return null; }
  const name = s.siteName || "学籍档案";
  document.querySelectorAll("[data-site-name]").forEach((el) => { el.textContent = name; });
  if (s.footerText !== undefined) document.querySelectorAll("[data-site-footer]").forEach((el) => { el.textContent = s.footerText; });
  document.querySelectorAll(".demo-tag").forEach((el) => { el.style.display = s.showDemoBadge === false ? "none" : ""; });
  if (s.icon) {
    let l = document.querySelector('link[rel="icon"]');
    if (!l) { l = document.createElement("link"); l.rel = "icon"; document.head.appendChild(l); }
    l.href = s.icon;
  }
  if (s.avatar) document.querySelectorAll("[data-site-avatar]").forEach((el) => {
    el.innerHTML = `<img src="${esc(s.avatar)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block">`;
  });
  return s;
}

/* ---- 管理后台：学籍表单（新增/编辑共用） ---- */
const STUDENT_FIELDS = [
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

function studentFormHTML(values = {}) {
  let h = "";
  for (const [key, label, type, req] of STUDENT_FIELDS) {
    const v = esc(values[key] || (key === "institution" ? INSTITUTION : ""));
    if (type.startsWith("select:")) {
      const opts = type.slice(7).split(";");
      h += `<div class="field"><label>${label}${req ? ' <span class="req">*</span>' : ""}</label><select name="${key}">` +
        opts.map((o) => `<option value="${esc(o)}" ${o === (values[key] || "") ? "selected" : ""}>${o === "" ? "请选择" : esc(o)}</option>`).join("") +
        `</select></div>`;
    } else {
      h += `<div class="field"><label>${label}${req ? ' <span class="req">*</span>' : ""}</label>` +
        `<input name="${key}" value="${v}" placeholder="${key === "birthdate" || key === "enrollDate" || key === "gradDate" ? "如 2005-05-05" : ""}"></div>`;
    }
  }
  h += `<div class="field"><label>备注</label><input name="remark" value="${esc(values.remark || "")}"></div>`;
  h += photoFieldHTML("photo", "录取照片", values.photo);
  h += photoFieldHTML("photo2", "学历照片", values.photo2);
  h += `<div class="field"><label>是否公开可查</label><select name="published">
        <option value="1" ${values.published !== false ? "selected" : ""}>是</option>
        <option value="0" ${values.published === false ? "selected" : ""}>否</option>
      </select></div>`;
  h += customFieldsEditorHTML(values.custom, "field", "fl");
  return h;
}

/* ---- 自定义字段编辑器（学籍/学历可扩展字段） ---- */
function customFieldsEditorHTML(list, wrapClass, labelClass) {
  const rows = (Array.isArray(list) ? list : []).map((f) => customFieldRowHTML(f.k, f.v)).join("");
  return `<div class="${wrapClass}"><label class="${labelClass}">自定义字段（可扩展）</label>
    <div data-custom-list>${rows}</div>
    <button type="button" class="btn ghost small" data-custom-add style="margin-top:8px">＋ 添加自定义字段</button>
    <div style="font-size:12px;color:#999;margin-top:6px">如"政治面貌 / 共青团员"。每个学籍/学历可自定义多条，保存后显示在详情页。</div></div>`;
}
function customFieldRowHTML(k = "", v = "") {
  return `<div class="custom-row" style="display:flex;gap:8px;margin-top:8px">
    <input data-ck placeholder="字段名" value="${esc(k)}" style="flex:1;min-width:0">
    <input data-cv placeholder="字段值" value="${esc(v)}" style="flex:2;min-width:0">
    <button type="button" class="btn ghost small" data-custom-del style="flex:none">删除</button></div>`;
}
function bindCustomFields(scope) {
  scope.querySelectorAll("[data-custom-add]").forEach((btn) => {
    if (btn.dataset.bound) return; btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      const list = btn.parentElement.querySelector("[data-custom-list]");
      const div = document.createElement("div");
      div.innerHTML = customFieldRowHTML();
      list.appendChild(div.firstChild);
    });
  });
  scope.addEventListener("click", (e) => {
    const del = e.target.closest("[data-custom-del]");
    if (del) del.closest(".custom-row").remove();
  });
}
function collectCustomFields(form) {
  const out = [];
  form.querySelectorAll("[data-custom-list] .custom-row").forEach((r) => {
    const k = (r.querySelector("[data-ck]").value || "").trim().slice(0, 30);
    const v = (r.querySelector("[data-cv]").value || "").trim().slice(0, 200);
    if (k) out.push({ k, v });
  });
  return out.slice(0, 30);
}

function collectStudentForm(form) {
  const fd = new FormData(form);
  const o = {};
  for (const [k, v] of fd.entries()) {
    if (k === "photoFile") continue;
    o[k] = typeof v === "string" ? v.trim() : v;
  }
  o.published = fd.get("published") !== "0";
  o.custom = collectCustomFields(form);
  return o;
}

function photoFieldHTML(key, label, val) {
  const isUrl = typeof val === "string" && /^https?:\/\//i.test(val);
  return `<div class="field"><label>${label}（可选）</label>
    <input type="file" data-photo-file="${key}" accept="image/*">
    <input type="url" data-photo-url="${key}" placeholder="或粘贴图片外链 URL（https://…）" value="${isUrl ? esc(val) : ""}" style="margin-top:8px">
    <input type="hidden" name="${key}" value="${esc(val || "")}">
    <div style="margin-top:6px;font-size:12px;color:#888" data-photo-tip="${key}">${val ? "已上传（重新选择或改填外链可替换）" : "可上传图片存入 KV，或直接填写图片外链"}</div></div>`;
}

function bindPhotoInput(form) {
  form.querySelectorAll('input[data-photo-file]').forEach((input) => {
    const key = input.dataset.photoFile;
    const hidden = form.querySelector(`input[name="${key}"]`);
    const urlIn = form.querySelector(`input[data-photo-url="${key}"]`);
    const tip = form.querySelector(`[data-photo-tip="${key}"]`);
    input.addEventListener("change", () => {
      const f = input.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => { hidden.value = rd.result; if (urlIn) urlIn.value = ""; tip.textContent = "已选择本地图片：" + f.name + "（存入 KV）"; };
      rd.readAsDataURL(f);
    });
    if (urlIn) urlIn.addEventListener("change", () => {
      const u = urlIn.value.trim();
      if (u && !/^https?:\/\//i.test(u)) { tip.textContent = "外链需以 http:// 或 https:// 开头"; return; }
      hidden.value = u; input.value = "";
      tip.textContent = u ? "已使用图片外链" : "";
    });
  });
}
