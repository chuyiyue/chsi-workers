import { h, clear } from "../dom.js";
import { api } from "../api.js";
import { formatTime } from "../ui.js";
import { ACTION_LABEL } from "./audit.js";

export async function renderDashboard(root, { meta }) {
  const [st, audit] = await Promise.all([api("/api/admin/stats"), api("/api/admin/audit")]);

  const cards = meta.resources.map((res) =>
    h("a", { class: "stat", href: `#/r/${res.key}` },
      h("span", { class: "n" }, String(st.counts[res.key].n), st.counts[res.key].more ? "+" : ""),
      h("span", { class: "l" }, res.plural)));

  const panels = meta.resources.filter((r) => r.breakdown).map((res) => {
    const field = res.fields.find((f) => f.key === res.breakdown);
    const dist = st.breakdown[res.key] || {};
    const order = [...field.options, ...Object.keys(dist).filter((k) => !field.options.includes(k))];
    const items = order.filter((k) => dist[k] > 0);
    const body = items.length === 0
      ? h("p", { class: "muted" }, `还没有${res.label}。`)
      : [
          h("div", { class: "split", role: "img", "aria-label": items.map((k) => `${k} ${dist[k]}`).join("，") },
            items.map((k) => { const i = h("i"); i.style.setProperty("--w", String(dist[k])); return i; })),
          h("div", { class: "legend" }, items.map((k) => h("span", null, `${k} ${dist[k]}`))),
        ];
    return h("section", { class: "panel" }, h("h2", null, `${res.label}${field.label}分布`), body);
  });

  const feed = audit.rows.slice(0, 8);
  clear(root).append(h("div", { class: "page" },
    h("div", { class: "page-head" }, h("h1", null, "总览")),
    h("div", { class: "stats" }, cards),
    panels,
    h("section", { class: "panel" }, h("h2", null, "最近操作"),
      feed.length === 0
        ? h("p", { class: "muted" }, "还没有操作记录。")
        : h("ul", { class: "feed" }, feed.map((a) =>
            h("li", null, h("span", null, `${ACTION_LABEL[a.action] || a.action} · ${a.target}`), h("time", null, formatTime(a.at))))))));
}
