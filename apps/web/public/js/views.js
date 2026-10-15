/* views：login / register / query / help / me */
import { api, esc, maskId, currentUser, showMsg } from "/js/api.js";
import { navigate } from "/js/router.js";

/* ---------- 登录 ---------- */
export async function loginView(el) {
  const u = await currentUser();
  if (u) { location.hash = "#me"; return; }
  el.innerHTML = `
    <div class="card narrow">
      <h2>用户登录</h2>
      <form id="login-form">
        <div class="field"><label>用户名</label><input name="username" autocomplete="username"></div>
        <div class="field"><label>密码</label><input name="password" type="password" autocomplete="current-password"></div>
        <div class="form-msg" id="lmsg"></div>
        <button class="btn block" type="submit">登 录</button>
      </form>
      <p class="links"><a href="#register">立即注册</a><span>|</span><a href="#help">帮助中心</a></p>
    </div>`;
  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    showMsg("lmsg", "登录中…", true);
    try {
      await api("/api/login", { method: "POST", body: JSON.stringify({
        username: String(fd.get("username") || "").trim(), password: String(fd.get("password") || "") }) });
      showMsg("lmsg", "登录成功，正在进入…", true);
      setTimeout(() => { location.hash = "#me"; }, 300);
    } catch (err) { showMsg("lmsg", err.message); }
  });
}

/* ---------- 注册 ---------- */
export async function registerView(el) {
  const u = await currentUser();
  if (u) { location.hash = "#me"; return; }
  el.innerHTML = `
    <div class="card narrow">
      <h2>注册账号</h2>
      <form id="reg-form">
        <div class="field"><label>用户名 *</label><input name="username" placeholder="3~20 位字母、数字或下划线" autocomplete="username"></div>
        <div class="field"><label>密码 *</label><input name="password" type="password" placeholder="6~64 位" autocomplete="new-password"></div>
        <div class="field"><label>确认密码 *</label><input name="password2" type="password" autocomplete="new-password"></div>
        <div class="form-msg" id="rmsg"></div>
        <button class="btn block" type="submit">注 册</button>
      </form>
      <p class="links"><a href="#login">已有账号？直接登录</a></p>
    </div>`;
  document.getElementById("reg-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const username = String(fd.get("username") || "").trim();
    const p1 = String(fd.get("password") || ""), p2 = String(fd.get("password2") || "");
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) { showMsg("rmsg", "用户名需为 3~20 位字母、数字或下划线"); return; }
    if (p1.length < 6) { showMsg("rmsg", "密码至少 6 位"); return; }
    if (p1 !== p2) { showMsg("rmsg", "两次输入的密码不一致"); return; }
    showMsg("rmsg", "注册中…", true);
    try {
      await api("/api/register", { method: "POST", body: JSON.stringify({ username, password: p1 }) });
      showMsg("rmsg", "注册成功，正在进入…", true);
      setTimeout(() => { location.hash = "#me"; }, 300);
    } catch (err) { showMsg("rmsg", err.message); }
  });
}

/* ---------- 学籍查询（公开） ---------- */
export async function queryView(el) {
  el.innerHTML = `
    <div class="card narrow">
      <h2>学籍查询</h2>
      <p class="tip">输入姓名与证件号码查询已登记的学籍信息。</p>
      <form id="q-form">
        <div class="field"><label>姓名</label><input name="name"></div>
        <div class="field"><label>证件号码</label><input name="idNumber"></div>
        <div class="form-msg" id="qmsg"></div>
        <button class="btn block" type="submit">查 询</button>
      </form>
      <div id="q-result"></div>
    </div>`;
  document.getElementById("q-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    showMsg("qmsg", "查询中…", true);
    document.getElementById("q-result").innerHTML = "";
    try {
      const d = await api("/api/query", { method: "POST", body: JSON.stringify({
        name: String(fd.get("name") || "").trim(), idNumber: String(fd.get("idNumber") || "").trim() }) });
      if (!d.found) { showMsg("qmsg", "未查询到匹配的学籍信息"); return; }
      showMsg("qmsg", "");
      el.querySelector("#q-result").innerHTML = d.records.map((r) => `
        <div class="rec-card">
          <div class="row1"><span class="school">${esc(r.institution || "—")}</span><span class="pill">${esc(r.level || "")}</span></div>
          <div class="row2">${esc(r.name)} · ${esc(r.major || "")}</div>
          <div class="row3">证件号 ${esc(maskId(r.idNumber))} · ${esc(r.status || "")}</div>
        </div>`).join("");
    } catch (err) { showMsg("qmsg", err.message); }
  });
}

/* ---------- 帮助 ---------- */
export async function helpView(el) {
  el.innerHTML = `
    <div class="card">
      <h2>帮助中心</h2>
      <ol>
        <li>注册账号后即可查看本人学籍档案；档案数据由培训机构管理员录入。</li>
        <li>在「我的 → 学籍信息设置」可以登记或修改自己的学籍 / 学历信息。</li>
        <li>忘记密码请联系管理员重置。</li>
        <li>学籍查询需要姓名 + 证件号码一致才能命中。</li>
      </ol>
      <p class="disclaimer">演示系统 · 与中国高等教育学生信息网（学信网）无任何关联</p>
    </div>`;
}

/* ---------- 我的（需登录） ---------- */
export async function meView(el) {
  const u = await currentUser();
  if (!u) { location.hash = "#login"; return; }
  let cache = [];
  let editSid = null;

  function meHeader() {
    return `<div class="me-head"><div class="avatar">${esc((u.username || "学").slice(0, 1).toUpperCase())}</div>
      <div><b>${esc(u.username)}</b><div class="meta">注册学员</div></div></div>`;
  }

  function renderHome() {
    el.innerHTML = `${meHeader()}
      <div class="menu-list">
        <div class="menu-item" id="go-records"><span>学籍信息设置</span><span class="arrow">›</span></div>
        <div class="menu-item" id="go-password"><span>修改密码</span><span class="arrow">›</span></div>
        <div class="menu-item" id="go-help"><span>帮助中心</span><span class="arrow">›</span></div>
      </div>
      <div class="pad"><button class="btn ghost block" id="logout">退出登录</button></div>`;
    document.getElementById("go-records").addEventListener("click", renderRecords);
    document.getElementById("go-password").addEventListener("click", renderPassword);
    document.getElementById("go-help").addEventListener("click", () => { location.hash = "#help"; });
    document.getElementById("logout").addEventListener("click", async () => {
      await api("/api/logout", { method: "POST" }).catch(() => {});
      location.hash = "#login";
    });
  }

  const STATUS_TEXT = { "在读": "在籍", "已结业": "不在籍（毕业）", "休学": "休学", "退学": "退学" };

  async function renderRecords() {
    const d = await api("/api/students").catch(() => ({ students: [] }));
    cache = d.students || [];
    el.innerHTML = `<div class="view-head"><a href="#" id="rec-back">‹</a><span>学籍信息设置</span></div>
      <div class="section">
        <div class="section-head"><h3>我的档案（${cache.length}）</h3></div>
        <div id="mine-list">${cache.length ? cache.map((r) => `
          <div class="mini-card">
            <div class="t">${esc(r.name)} <span class="status-pill">${esc(STATUS_TEXT[r.status] || r.status || "—")}</span></div>
            <div class="meta">${esc(r.institution)} · ${esc(r.major)}</div>
            <div class="ops"><button class="btn small ghost" data-edit="${r.sid}">编辑</button></div>
          </div>`).join("") : `<div class="empty-box">还没有登记学籍信息，点击下方按钮新增。</div>`}</div>
        <button class="btn" id="mine-add" style="margin-top:8px">＋ 新增学籍信息</button>
      </div>`;
    document.getElementById("rec-back").addEventListener("click", (e) => { e.preventDefault(); renderHome(); });
    el.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => openForm(b.dataset.edit)));
    document.getElementById("mine-add").addEventListener("click", () => openForm(null));
  }

  const FIELDS = [
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

  function openForm(sid) {
    editSid = sid;
    const rec = sid ? cache.find((r) => r.sid === sid) : null;
    let h = `<div class="view-head"><a href="#" id="form-back">‹</a><span>${sid ? "编辑学籍信息" : "新增学籍信息"}</span></div><div class="section"><form id="rec-form">`;
    for (const [key, label, type, req0] of FIELDS) {
      const v = esc(rec ? rec[key] : "");
      if (type.startsWith("select:")) {
        const opts = type.slice(7).split(";");
        h += `<div class="field"><label>${label}${req0 ? ' <span class="req">*</span>' : ""}</label><select name="${key}">` +
          opts.map((o) => `<option value="${esc(o)}" ${o === (rec?.[key] || "") ? "selected" : ""}>${o === "" ? "请选择" : esc(o)}</option>`).join("") +
          `</select></div>`;
      } else {
        h += `<div class="field"><label>${label}${req0 ? ' <span class="req">*</span>' : ""}</label><input name="${key}" value="${v}"></div>`;
      }
    }
    h += `<div class="field"><label>备注</label><input name="remark" value="${esc(rec?.remark || "")}"></div>
      <div class="form-msg" id="fmsg"></div></form>
      <button class="btn block" id="form-save">保存</button></div>`;
    el.innerHTML = h;
    document.getElementById("form-back").addEventListener("click", (e) => { e.preventDefault(); renderRecords(); });
    document.getElementById("form-save").addEventListener("click", async () => {
      const fd = new FormData(document.getElementById("rec-form"));
      const body = {};
      for (const [k, v] of fd.entries()) body[k] = String(v).trim();
      if (!body.name || !body.idNumber) { showMsg("fmsg", "姓名和证件号码为必填项"); return; }
      showMsg("fmsg", "保存中…", true);
      try {
        if (editSid) await api("/api/students/" + editSid, { method: "PUT", body: JSON.stringify(body) });
        else await api("/api/students", { method: "POST", body: JSON.stringify(body) });
        showMsg("fmsg", "保存成功", true);
        setTimeout(renderRecords, 400);
      } catch (err) { showMsg("fmsg", err.message); }
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
        await api("/api/change-password", { method: "POST", body: JSON.stringify({ oldPassword: o, newPassword: n1 }) });
        showMsg("pw-msg", "密码修改成功（其他设备已自动退出）", true);
      } catch (err) { showMsg("pw-msg", err.message); }
    });
  }

  renderHome();
}
