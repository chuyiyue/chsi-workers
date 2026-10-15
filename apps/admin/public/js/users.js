/* 用户管理面板：列表 / 新增 / 改密 / 删除 / 代录 */
import { api, esc, showMsg, studentFormHTML, collectStudentForm } from "./shared.js";

let users = [];

export async function render(el) {
  const d = await api("/api/admin/users");
  users = d.users || [];
  el.innerHTML = `
    <div class="card">
      <div class="toolbar">
        <input class="in search-mini" type="search" id="user-search" placeholder="搜索用户名…">
        <button class="btn sm" id="add-user-btn">＋ 新增用户</button>
      </div>
      <div id="user-list"></div>
    </div>
    <div id="panes"></div>`;
  renderList("");
  document.getElementById("user-search").addEventListener("input", (e) => renderList(e.target.value.trim()));
  document.getElementById("add-user-btn").addEventListener("click", addDialog);
}

function renderList(q) {
  const el = document.getElementById("user-list");
  const list = users.filter((u) => !q || u.username.includes(q));
  el.innerHTML = list.length ? list.map((u) => `
    <div class="rowline">
      <div><b>${esc(u.username)}</b><div class="meta">注册于 ${esc((u.createdAt || "").replace("T", " ").slice(0, 19))}</div></div>
      <div style="display:flex;gap:8px;align-items:center">
        <span class="pill">${u.studentCount} 条学籍</span>
        <button class="btn sm secondary" data-pw="${u.id}">重置密码</button>
        <button class="btn sm secondary" data-add="${u.id}">代录学籍</button>
        <button class="btn sm danger" data-del="${u.id}">删除</button>
      </div>
    </div>`).join("") : `<p style="text-align:center;color:#999;padding:30px">暂无用户</p>`;
  el.querySelectorAll("[data-pw]").forEach((b) => b.addEventListener("click", () => pwDialog(b.dataset.pw)));
  el.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => recordDialog(b.dataset.add)));
  el.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => delUser(b.dataset.del)));
}

function addDialog() {
  crudDialog("新增用户", `
    <label class="fl">用户名</label><input class="in" id="au-name" placeholder="3~20 位字母、数字或下划线">
    <label class="fl">初始密码</label><input class="in" id="au-pw" type="password" placeholder="6~64 位">
    <div class="msg" id="dlg-msg"></div>`, async () => {
    const username = document.getElementById("au-name").value.trim();
    const password = document.getElementById("au-pw").value;
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) { showMsg("dlg-msg", "用户名需为 3~20 位字母、数字或下划线"); return false; }
    if (password.length < 6) { showMsg("dlg-msg", "密码至少 6 位"); return false; }
    try {
      await api("/api/admin/users", { method: "POST", body: JSON.stringify({ username, password }) });
      return true;
    } catch (e) { showMsg("dlg-msg", e.message); return false; }
  }, () => renderEl());
}

function pwDialog(uid) {
  const u = users.find((x) => x.id === uid);
  crudDialog(`重置密码 · ${u.username}`, `
    <label class="fl">新密码</label><input class="in" id="pw-in" type="password" placeholder="6~64 位">
    <div class="msg" id="dlg-msg"></div>`, async () => {
    const password = document.getElementById("pw-in").value;
    if (password.length < 6) { showMsg("dlg-msg", "密码至少 6 位"); return false; }
    try {
      await api("/api/admin/users/" + uid, { method: "PUT", body: JSON.stringify({ password }) });
      return true;
    } catch (e) { showMsg("dlg-msg", e.message); return false; }
  });
}

async function recordDialog(uid) {
  const u = users.find((x) => x.id === uid);
  crudDialog(`代录学籍 · ${u.username}`, `<form id="dlg-form">${studentFormHTML({ institution: "" })}</form>
    <div class="msg" id="dlg-msg"></div>`, async () => {
    const body = collectStudentForm(document.getElementById("dlg-form"));
    if (!body.name || !body.idNumber) { showMsg("dlg-msg", "姓名和证件号码为必填项"); return false; }
    body.ownerUsername = u.username;
    try {
      await api("/api/students", { method: "POST", body: JSON.stringify(body) });
      return true;
    } catch (e) { showMsg("dlg-msg", e.message); return false; }
  });
}

async function delUser(uid) {
  const u = users.find((x) => x.id === uid);
  if (!confirm(`确定删除用户「${u.username}」及其名下 ${u.studentCount} 条学籍吗？不可恢复。`)) return;
  await api("/api/admin/users/" + uid, { method: "DELETE" });
  renderEl();
}

/* 弹窗基建 */
function crudDialog(title, bodyHTML, submitFn, onDone) {
  const ov = document.createElement("div");
  ov.className = "overlay";
  ov.innerHTML = `<div class="modal"><h3>${title}</h3>${bodyHTML}
    <div class="modal-foot"><button class="btn secondary" data-close>取消</button>
    <button class="btn" data-ok>确定</button></div></div>`;
  document.body.appendChild(ov);
  ov.querySelector("[data-close]").addEventListener("click", () => ov.remove());
  ov.addEventListener("click", (e) => { if (e.target === ov) ov.remove(); });
  ov.querySelector("[data-ok]").addEventListener("click", async () => {
    const passed = await submitFn();
    if (passed) { ov.remove(); onDone?.(); }
  });
}

function renderEl() {
  // 重新渲染当前面板
  import("./main.js").then((m) => m.renderPanel("users"));
}
