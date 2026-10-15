import { h, icon, clear } from "./dom.js";
import { api } from "./api.js";
import { toast } from "./ui.js";
import { extraPages } from "./registry.js";
import "./extensions.js";
import { renderLogin } from "./views/login.js";
import { renderDashboard } from "./views/dashboard.js";
import { resourcePage } from "./views/list.js";
import { auditPage } from "./views/audit.js";

const app = document.getElementById("app");
let meta = null;
let pages = [];
let navLinks = new Map();
let view = null;

async function boot() {
  try {
    await api("/api/auth/me");
  } catch {
    return renderLogin(app, boot);
  }
  try {
    meta = await api("/api/admin/meta");
  } catch (err) {
    clear(app).append(h("div", { class: "login" }, h("p", { class: "err" }, err.message)));
    return;
  }
  buildShell();
  route();
}

function buildShell() {
  pages = [
    { id: "", label: "总览", icon: "home", render: renderDashboard },
    "gap",
    ...meta.resources.map(resourcePage),
    ...extraPages,
    "gap",
    auditPage,
  ];

  navLinks = new Map();
  const nav = h("nav", { class: "nav", "aria-label": "主导航" }, pages.map((p) => {
    if (p === "gap") return h("div", { class: "gap" });
    const a = h("a", { href: `#/${p.id}` }, icon(p.icon), h("span", null, p.label));
    navLinks.set(p.id, a);
    return a;
  }));

  const logout = h("button", { type: "button", onClick: async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    boot();
  } }, icon("logout"), "退出登录");

  view = h("main", { id: "view" });
  clear(app).append(h("div", { class: "shell" },
    h("aside", { class: "sidebar" },
      h("div", { class: "brand" }, meta.site.name), nav, h("div", { class: "sidebar-foot" }, logout)),
    h("div", { class: "main" },
      h("header", { class: "topbar" },
        h("button", { class: "btn quiet icon-only", type: "button", "aria-label": "打开菜单", onClick: () => document.body.classList.add("nav-open") }, icon("menu")),
        h("strong", null, meta.site.name)),
      view)));

  document.body.addEventListener("click", (e) => {
    if (document.body.classList.contains("nav-open") && !e.target.closest(".sidebar, .topbar button")) document.body.classList.remove("nav-open");
  });
}

async function route() {
  if (!view) return;
  const id = location.hash.replace(/^#\/?/, "");
  const page = pages.find((p) => p !== "gap" && p.id === id) || pages[0];
  for (const [k, a] of navLinks) {
    if (k === page.id) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
  document.title = `${page.label} · ${meta.site.name}`;
  document.body.classList.remove("nav-open");
  window.scrollTo(0, 0);
  try {
    await page.render(view, { meta });
  } catch (err) {
    clear(view).append(h("div", { class: "page" }, h("div", { class: "table-wrap" }, h("div", { class: "empty" },
      h("h2", null, "页面没能加载"), h("p", null, err.message),
      h("button", { class: "btn", type: "button", onClick: route }, "重试")))));
  }
}

window.addEventListener("hashchange", route);
window.addEventListener("admin:unauthorized", () => {
  view = null;
  toast("登录已过期，请重新登录", "error");
  renderLogin(app, boot);
});

/* 按 / 聚焦搜索框 */
document.addEventListener("keydown", (e) => {
  if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
  const s = document.querySelector('input[type="search"]');
  if (s) { e.preventDefault(); s.focus(); }
});

boot();
