/* views：登录 / 教育信息 / 个人中心 / 帮助（公开查询已下线；账号由管理员建） */
import { api, esc, currentUser, showMsg } from "/js/api.js";

const STATUS_TEXT = { "在读": "在读", "已结业": "已结业", "休学": "休学", "退学": "退出" };
const KIND_TEXT = { xueji: "学籍", xueli: "学历", degree: "学位" };

/* ---------- 登录（唯一入口） ---------- */
export async function loginView(el) {
  const u = await currentUser();
  if (u) { location.hash = u.role === "admin" ? "#me" : "#edu"; return; }
  el.innerHTML = `
    <div class="card narrow">
      <h2>学员登录</h2>
      <form id="login-form">
        <div class="field"><label>用户名</label><input name="username" autocomplete="username"></div>
        <div class="field"><label>密码</label><input name="password" type="password" autocomplete="current-password"></div>
        <div class="form-msg" id="lmsg"></div>
        <button class="btn block" type="submit">登 录</button>
      </form>
      <p class="tip">账号由培训机构管理员开通；忘记密码请联系管理员重置。</p>
    </div>`;
  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    showMsg("lmsg", "登录中…", true);
    try {
      const d = await api("/api/login", { method: "POST", body: JSON.stringify({
        username: String(fd.get("username") || "").trim(), password: String(fd.get("password") || "") }) });
      showMsg("lmsg", "登录成功，正在进入…", true);
      const admin = d.user?.role === "admin";
      setTimeout(() => { location.hash = admin ? "#me" : "#edu"; }, 300);
    } catch (err) { showMsg("lmsg", err.message); }
  });
}

/* ---------- 教育信息（需登录）：我的学籍 / 学历 ---------- */
export async function eduView(el) {
  const u = await currentUser();
  if (!u) { location.hash = "#login"; return; }
  let cache = [];

  function render() {
    const xueji = cache.filter((r) => r.type === "xueji");
    const edu = cache.filter((r) => r.type !== "xueji");
    const card = (r) => `
      <div class="rec-card" data-open="${esc(r.sid)}">
        <div class="row1"><span class="school">${esc(r.major || r.institution || "—")}</span>
          <span class="pill">${esc(KIND_TEXT[r.type] || "学籍")}</span></div>
        <div class="row2">${esc(r.className || "—")} · ${esc(STATUS_TEXT[r.status] || r.status || "—")}</div>
        <div class="row3">${esc(r.enrollDate || "—")} ~ ${esc(r.gradDate || "至今")}</div>
      </div>`;
    el.innerHTML = `
      <div class="section">
        <div class="section-head"><h3>教育信息</h3><span class="meta">${cache.length} 条</span></div>
        <div class="group-title">学籍信息</div>
        ${xueji.length ? xueji.map(card).join("") : `<div class="empty-box">暂无学籍信息</div>`}
        <div class="group-title">学历 / 学位信息</div>
        ${edu.length ? edu.map(card).join("") : `<div class="empty-box">暂无学历 / 学位信息</div>`}
        <button class="btn block" id="edu-add" style="margin-top:10px">＋ 添加教育经历</button>
      </div>`;
    el.querySelectorAll("[data-open]").forEach((n) => n.addEventListener("click", () => openDetail(n.dataset.open)));
    document.getElementById("edu-add").addEventListener("click", () => openForm(null));
  }

  const FIELDS = [
    ["major", "项目 / 专业", "text"], ["className", "班级", "text"],
    ["level", "培训层次", "text"], ["duration", "学制", "text"], ["studyMode", "学习形式", "text"],
    ["enrollDate", "入学日期", "text"], ["gradDate", "毕（结）业日期", "text"],
    ["status", "学籍状态", "select:在读;已结业;休学;退学"],
    ["institution", "培训机构", "text"], ["branch", "分院", "text"], ["dept", "系所", "text"],
    ["studentNo", "学号", "text"], ["certNo", "证书编号", "text"], ["gradType", "毕（结）业", "select:;毕业;结业"],
    ["degreeName", "学位名称", "text"], ["degreeUnit", "学位授予单位", "text"],
    ["name", "姓名 *", "text"], ["idNumber", "证件号码 *", "text"],
    ["gender", "性别", "select:;男;女"], ["ethnicity", "民族", "text"], ["birthdate", "出生日期", "text"],
    ["idType", "证件类型", "text"], ["eduCategory", "学历类别", "text"],
    ["presidentName", "校（院）长姓名", "text"], ["remark", "备注", "text"],
  ];

  function fieldHTML([key, label, type], rec) {
    const v = escapeAttr(rec ? rec[key] : "");
    if (type.startsWith("select:")) {
      const opts = type.slice(7).split(";");
      const cur = rec?.[key] || "";
      return `<div class="field"><label>${label}</label><select name="${key}">` +
        opts.map((o) => `<option value="${escapeAttr(o)}" ${o === cur ? "selected" : ""}>${o === "" ? "请选择" : esc(o)}</option>`).join("") +
        `</select></div>`;
    }
    return `<div class="field"><label>${label}</label><input name="${key}" value="${v}"></div>`;
  }

  function openForm(sid) {
    const rec = sid ? cache.find((r) => r.sid === sid) : null;
    el.innerHTML = `<div class="view-head"><a href="#" id="f-back">‹</a><span>${sid ? "编辑教育经历" : "添加教育经历"}</span></div>
      <div class="section">
        <div class="tip">选择「学籍」类型填写在读课程；把学籍状态选为「已结业」或填学位名称，即归入学历 / 学位信息。</div>
        <form id="edu-form">${FIELDS.map((f) => fieldHTML(f, rec)).join("")}
          <div class="form-msg" id="fmsg"></div></form>
        <button class="btn block" id="f-save">保存</button>
      </div>`;
    document.getElementById("f-back").addEventListener("click", (e) => { e.preventDefault(); render(); });
    document.getElementById("f-save").addEventListener("click", async () => {
      const fd = new FormData(document.getElementById("edu-form"));
      const body = {};
      for (const [k, v] of fd.entries()) body[k] = String(v).trim();
      if (!body.name || !body.idNumber) { showMsg("fmsg", "姓名和证件号码为必填项"); return; }
      showMsg("fmsg", "保存中…", true);
      try {
        if (sid) await api("/api/my/enrollments/" + sid, { method: "PUT", body: JSON.stringify(body) });
        else await api("/api/my/enrollments", { method: "POST", body: JSON.stringify(body) });
        showMsg("fmsg", "保存成功", true);
        await load(); render();
      } catch (err) { showMsg("fmsg", err.message); }
    });
  }

  function openDetail(sid) {
    const r = cache.find((x) => x.sid === sid);
    if (!r) return;
    const rows = FIELDS.map(([k, label]) => [label, r[k]]).filter(([, v]) => v !== "" && v != null);
    el.innerHTML = `<div class="view-head"><a href="#" id="d-back">‹</a><span>${esc(r.major || "教育经历")}</span></div>
      <div class="section">
        <div class="detail-rows">${rows.map(([k, v]) =>
          `<div class="detail-row"><span class="k">${k}</span><span class="v">${esc(k.includes("证件") ? maskId(v) : v)}</span></div>`).join("")}</div>
        <div class="cert-box">
          <div class="t">结业证明</div>
          <div class="meta">本证明由 ${esc(r.institution || "培训机构")} 出具（演示数据，不作为学历凭证）。</div>
        </div>
        <div class="pad-row">
          <button class="btn ghost" id="d-edit">编辑</button>
          <button class="btn ghost danger" id="d-del">删除</button>
        </div>
      </div>`;
    document.getElementById("d-back").addEventListener("click", (e) => { e.preventDefault(); render(); });
    document.getElementById("d-edit").addEventListener("click", () => openForm(sid));
    document.getElementById("d-del").addEventListener("click", async () => {
      if (!confirm("确认删除这条教育经历？")) return;
      try { await api("/api/my/enrollments/" + sid, { method: "DELETE" }); await load(); render(); }
      catch (err) { alert(err.message); }
    });
  }

  async function load() {
    const d = await api("/api/my/enrollments").catch(() => ({ enrollments: [] }));
    cache = d.enrollments || [];
  }
  await load();
  render();
}

/* ---------- 个人中心（需登录） ---------- */
export async function meView(el) {
  const u = await currentUser();
  if (!u) { location.hash = "#login"; return; }
  let profile = { username: u.username, phone: "", email: "", displayName: "", avatar: "" };

  function renderHome() {
    const name = profile.displayName || profile.username;
    el.innerHTML = `
      <div class="me-head"><div class="avatar">${esc((name || "学").slice(0, 1).toUpperCase())}</div>
        <div><b>${esc(name)}</b><div class="meta">${esc(profile.phone || "未填写手机号")}</div></div></div>
      <div class="menu-list">
        <div class="menu-item" id="go-profile"><span>联系方式</span><span class="v">${esc(profile.phone || "未填写")}</span><span class="arrow">›</span></div>
        <div class="menu-item" id="go-password"><span>修改密码</span><span class="arrow">›</span></div>
        <div class="menu-item" id="go-help"><span>帮助中心</span><span class="arrow">›</span></div>
      </div>
      <div class="pad"><button class="btn ghost block" id="logout">退出登录</button></div>`;
    document.getElementById("go-profile").addEventListener("click", renderProfile);
    document.getElementById("go-password").addEventListener("click", renderPassword);
    document.getElementById("go-help").addEventListener("click", () => { location.hash = "#help"; });
    document.getElementById("logout").addEventListener("click", async () => {
      await api("/api/logout", { method: "POST" }).catch(() => {});
      location.hash = "#login";
    });
  }

  function renderProfile() {
    el.innerHTML = `<div class="view-head"><a href="#" id="p-back">‹</a><span>联系方式</span></div>
      <div class="section">
        <div class="field"><label>显示名称</label><input id="p-name" value="${escapeAttr(profile.displayName || "")}"></div>
        <div class="field"><label>手机号</label><input id="p-phone" value="${escapeAttr(profile.phone || "")}"></div>
        <div class="field"><label>邮箱</label><input id="p-email" value="${escapeAttr(profile.email || "")}"></div>
        <div class="field"><label>头像链接</label><input id="p-avatar" placeholder="http(s)://..." value="${escapeAttr(profile.avatar || "")}"></div>
        <div class="form-msg" id="p-msg"></div>
        <button class="btn block" id="p-save">保存</button>
      </div>`;
    document.getElementById("p-back").addEventListener("click", (e) => { e.preventDefault(); renderHome(); });
    document.getElementById("p-save").addEventListener("click", async () => {
      showMsg("p-msg", "保存中…", true);
      try {
        const d = await api("/api/my/profile", { method: "PUT", body: JSON.stringify({
          displayName: document.getElementById("p-name").value.trim(),
          phone: document.getElementById("p-phone").value.trim(),
          email: document.getElementById("p-email").value.trim(),
          avatar: document.getElementById("p-avatar").value.trim(),
        }) });
        profile = d.profile;
        showMsg("p-msg", "已保存", true);
        setTimeout(renderHome, 400);
      } catch (err) { showMsg("p-msg", err.message); }
    });
  }

  function renderPassword() {
    el.innerHTML = `<div class="view-head"><a href="#" id="pw-back">‹</a><span>修改密码</span></div>
      <div class="section">
        <div class="field"><label>原密码</label><input type="password" id="pw-old"></div>
        <div class="field"><label>新密码</label><input type="password" id="pw-new" placeholder="6~64 位"></div>
        <div class="field"><label>确认新密码</label><input type="password" id="pw-new2"></div>
        <div class="form-msg" id="pw-msg"></div>
        <button class="btn block" id="pw-save">确认修改</button>
      </div>`;
    document.getElementById("pw-back").addEventListener("click", (e) => { e.preventDefault(); renderHome(); });
    document.getElementById("pw-save").addEventListener("click", async () => {
      const o = document.getElementById("pw-old").value, n1 = document.getElementById("pw-new").value, n2 = document.getElementById("pw-new2").value;
      if (n1.length < 6) { showMsg("pw-msg", "新密码至少 6 位"); return; }
      if (n1 !== n2) { showMsg("pw-msg", "两次输入的新密码不一致"); return; }
      try {
        await api("/api/my/change-password", { method: "POST", body: JSON.stringify({ oldPassword: o, newPassword: n1 }) });
        showMsg("pw-msg", "密码修改成功", true);
      } catch (err) { showMsg("pw-msg", err.message); }
    });
  }

  await api("/api/my/profile").then((d) => { profile = d.profile || profile; }).catch(() => {});
  renderHome();
}

/* ---------- 帮助 ---------- */
export async function helpView(el) {
  el.innerHTML = `
    <div class="card">
      <h2>帮助中心</h2>
      <ol>
        <li>账号由培训机构管理员开通，登录后查看本人的学籍与学历信息。</li>
        <li>在「教育信息」里可以添加或编辑自己的教育经历，状态为「已结业」或填写学位名称的会归入学历 / 学位信息。</li>
        <li>个人中心只维护联系方式（手机号 / 邮箱）和密码。</li>
        <li>忘记密码请联系管理员重置。</li>
      </ol>
      <p class="disclaimer">演示系统 · 与任何官方学历平台无关联</p>
    </div>`;
}

/* ---------- 小工具 ---------- */
function escapeAttr(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
function maskId(s) {
  const v = String(s || "");
  if (/^\d{17}[\dXx]$/.test(v)) return v.slice(0, 6) + "********" + v.slice(-4);
  if (v.length > 8) return v.slice(0, 3) + "****" + v.slice(-4);
  return "****";
}
