import { h, clear } from "../dom.js";
import { api, qs } from "../api.js";
import { badge, formatTime, toast } from "../ui.js";

export const ACTION_LABEL = { create: "新建", update: "修改", delete: "删除", login: "登录", login_failed: "登录失败" };

export const auditPage = {
  id: "audit", label: "操作记录", icon: "history",
  async render(root) {
    let rows = [];
    let cursor = null;
    const tbody = h("tbody");
    const moreBtn = h("button", { class: "btn", type: "button", onClick: () => load() }, "加载更多");
    const more = h("div", { class: "more", hidden: true }, moreBtn);
    const note = h("p", { class: "muted" }, "操作记录保留 90 天。");

    clear(root).append(h("div", { class: "page" },
      h("div", { class: "page-head" }, h("h1", null, "操作记录")),
      h("div", { class: "table-wrap" }, h("table", null,
        h("thead", null, h("tr", null, ["时间", "操作", "对象", "来源 IP"].map((t) => h("th", { scope: "col" }, t)))), tbody)),
      more, note));

    async function load() {
      moreBtn.disabled = true;
      try {
        const data = await api(`/api/admin/audit${qs({ cursor })}`);
        rows = rows.concat(data.rows);
        cursor = data.cursor;
        if (rows.length === 0) {
          clear(tbody).append(h("tr", null, h("td", { colSpan: 4 }, h("span", { class: "muted" }, "还没有操作记录。"))));
        } else {
          tbody.append(...data.rows.map((a) => h("tr", null,
            h("td", null, formatTime(a.at)),
            h("td", null, a.action === "login_failed" ? badge(ACTION_LABEL[a.action], "warn") : ACTION_LABEL[a.action] || a.action),
            h("td", null, a.target),
            h("td", { class: "muted" }, a.ip || "—"))));
        }
        more.hidden = !cursor;
      } catch (err) {
        toast(err.message, "error");
      } finally {
        moreBtn.disabled = false;
      }
    }
    await load();
  },
};
