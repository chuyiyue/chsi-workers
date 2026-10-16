/* 学籍管理面板：全量列表（按用户过滤） / 编辑 / 删除 */
import { api, esc, showMsg, studentFormHTML, collectStudentForm } from "./shared.js";

let records = [], usersIdx = {};

export async function render(el) {
  // 并发拉用户与记录
  const [du, ds] = await Promise.all([
    api("/api/admin/users"),
    api("/api/students?limit=100").catch(() => ({ students: [] })),
  ]);
  usersIdx = Object.fromEntries((du.users || []).map((u) => [u.id, u.username]));
  records = ds.students || [];
  // admin /api/students?limit 只拿前 100 —— 大列表场景翻页拉全（cursor 循环）
  let cursor = ds.nextCursor, guard = 0;
  while (cursor && guard++ < 50) {
    const page = await api("/api/students?limit=100&cursor=" + cursor).catch(() => null);
    if (!page) break;
    records.push(...(page.students || []));
    cursor = page.nextCursor;
  }
  const uniqOwners = [...new Set(records.map((r) => r.ownerId))];
  el.innerHTML = `
    <div class="card">
      <div class="toolbar">
        <input class="in search-mini" type="search" id="studs-search" placeholder="搜索姓名 / 证件号 / 学号…">
        <select class="in" id="studs-owner" style="max-width:220px">
          <option value="">全部用户</option>
          ${uniqOwners.map((id) => `<option value="${id}">${esc(usersIdx[id] || id)}</option>`).join("")}
        </select>
        <span class="pill">${records.length} 条</span>
      </div>
      <div id="studs-list"></div>
    </div>`;
  renderList();
  document.getElementById("studs-search").addEventListener("input", renderList);
  document.getElementById("studs-owner").addEventListener("change", renderList);
}

function renderList() {
  const q = document.getElementById("studs-search").value.trim();
  const owner = document.getElementById("studs-owner").value;
  const list = records.filter((r) =>
    (!owner || r.ownerId === owner) &&
    (!q || (r.name + r.idNumber + (r.studentNo || "")).includes(q)));
  const el = document.getElementById("studs-list");
  el.innerHTML = list.length ? list.map((r) => `
    <div class="record-card">
      <div class="head">
        <b>${esc(r.name)}</b>
        <span class="pill green">${esc(r.status || "在读")}</span>
        <span class="owner">归属：${esc(usersIdx[r.ownerId] || r.ownerUsername || r.ownerId)}</span>
        <span style="flex:1"></span>
        <button class="btn sm secondary" data-edit="${r.sid}">编辑</button>
        <button class="btn sm danger" data-del="${r.sid}">删除</button>
      </div>
      <div class="fields-hint">${esc(r.institution || "")} · ${esc(r.major || "")} · 证件号 ${esc(r.idNumber)}
        ${r.certNo ? " · 证书 " + esc(r.certNo) : ""}${r.degreeName ? " · 学位 " + esc(r.degreeName) : ""}</div>
    </div>`).join("") : `<p style="text-align:center;color:#999;padding:30px">暂无教育经历记录</p>`;
  el.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => editDialog(b.dataset.edit)));
  el.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", deleteRecord));
}

async function editDialog(sid) {
  const rec = records.find((r) => r.sid === sid);
  const d = await api("/api/students/" + sid).catch(() => null);
  const full = d?.student || rec;
  crudDialog(`编辑学籍 · ${rec.name}`, `<form id="dlg-form">${studentFormHTML(full)}</form>
    <div class="msg" id="dlg-msg"></div>`, async () => {
    const body = collectStudentForm(document.getElementById("dlg-form"));
    if (!body.name || !body.idNumber) { showMsg("dlg-msg", "姓名和证件号码为必填项"); return false; }
    try {
      await api("/api/students/" + sid, { method: "PUT", body: JSON.stringify(body) });
      return true;
    } catch (e) { showMsg("dlg-msg", e.message); return false; }
  }, () => renderEl());
}

async function deleteRecord(sid) {
  const rec = records.find((r) => r.sid === sid);
  if (!confirm(`确定删除「${rec.name}」的这条教育经历吗？不可恢复。`)) return;
  await api("/api/students/" + sid, { method: "DELETE" });
  renderEl();
}

function renderEl() {
  import("./main.js").then((m) => m.renderPanel("studs"));
}

/* 弹窗基建（与 users.js 同构，小 demo 不强抽） */
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
