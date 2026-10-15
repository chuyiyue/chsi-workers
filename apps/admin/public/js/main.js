/* 管理后台入口：登录态 → 三板块面板切换 */
import { api, currentUser, showMsg } from "./shared.js";
import * as usersPanel from "./users.js";
import * as studsPanel from "./studs.js";
import * as settingsPanel from "./settings.js";

const PANELS = {
  users: { mod: usersPanel, title: "用户管理", extra: "" },
  studs: { mod: studsPanel, title: "学籍管理", extra: "" },
  settings: { mod: settingsPanel, title: "网站设置", extra: "" },
};

let current = "users";

export function renderPanel(name) {
  current = name;
  const p = PANELS[name];
  document.getElementById("page-title").textContent = p.title;
  document.querySelectorAll("[data-nav]").forEach((a) =>
    a.classList.toggle("active", a.dataset.nav === name));
  const c = document.getElementById("content");
  c.innerHTML = "";
  p.mod.render(c).catch((e) => { c.innerHTML = `<p class="msg error">${e.message}</p>`; });
}

function showApp() {
  document.getElementById("view-login").style.display = "none";
  document.getElementById("view-app").style.display = "";
  document.querySelectorAll("[data-nav]").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    if (PANELS[a.dataset.nav]) renderPanel(a.dataset.nav);
  }));
  renderPanel(current);
}

(async function init() {
  const u = await currentUser();
  if (u && u.role === "admin") { showApp(); return; }
  document.getElementById("view-login").style.display = "";
  document.getElementById("admin-login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const d = await api("/api/login", { method: "POST", body: JSON.stringify({
        username: String(fd.get("username") || "").trim(), password: String(fd.get("password") || "") }) });
      if (d.user.role !== "admin") {
        await api("/api/logout", { method: "POST" }).catch(() => {});
        showMsg("lmsg", "此入口仅限管理员");
        return;
      }
      showApp();
    } catch (err) { showMsg("lmsg", err.message); }
  });
})();

document.getElementById("logout-btn")?.addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" }).catch(() => {});
  location.reload();
});
