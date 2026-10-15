import { h, icon, clear } from "../dom.js";
import { api, qs } from "../api.js";
import { toast, confirmDialog, debounce } from "../ui.js";
import { fieldType, refLabels, invalidateOptions } from "../fields.js";
import { openForm } from "./form.js";

export function resourcePage(res) {
  return { id: `r/${res.key}`, label: res.plural, icon: res.icon, render: (root) => renderList(root, res) };
}

async function renderList(root, res) {
  const state = { q: "", filters: {}, cursor: null, rows: [], loading: false };
  const cols = res.fields.filter((f) => f.list);
  const searchable = res.fields.filter((f) => f.search);
  const filterFields = res.fields.filter((f) => f.filter);
  let labels = {};
  try { labels = await refLabels(res); } catch (err) { toast(err.message, "error"); }
  const ctx = { refLabels: labels };

  const count = h("span", { class: "count" });
  const addBtn = h("button", { class: "btn primary", type: "button", onClick: () => create() }, icon("plus"), `新建${res.label}`);
  const search = searchable.length
    ? h("div", { class: "search" }, icon("search"),
        h("input", {
          type: "search", "aria-label": "搜索", "aria-keyshortcuts": "/", title: "按 / 快速聚焦",
          placeholder: `搜索${searchable.map((f) => f.label).join("、")}`,
          onInput: debounce((e) => { state.q = e.target.value.trim(); load(true); }),
        }))
    : null;
  const selects = filterFields.map((f) =>
    h("select", {
      "aria-label": `按${f.label}筛选`,
      onChange: (e) => { if (e.target.value) state.filters[f.key] = e.target.value; else delete state.filters[f.key]; load(true); },
    }, h("option", { value: "" }, `全部${f.label}`), f.options.map((o) => h("option", { value: o }, o))));

  const tbody = h("tbody");
  const table = h("table", null,
    h("thead", null, h("tr", null, cols.map((f) => h("th", { scope: "col" }, f.label)), h("th", { class: "actions", scope: "col" }, h("span", { class: "sr" }, "操作")))),
    tbody);
  const wrap = h("div", { class: "table-wrap" }, table);
  const emptyBox = h("div", { class: "table-wrap", hidden: true });
  const moreRow = h("div", { class: "more", hidden: true },
    h("button", { class: "btn", type: "button", onClick: () => load(false) }, "加载更多"));

  clear(root).append(h("div", { class: "page" },
    h("div", { class: "page-head" }, h("h1", null, res.plural), count, h("span", { class: "spacer" }), addBtn),
    (search || selects.length > 0) && h("div", { class: "toolbar" }, search, selects),
    wrap, emptyBox, moreRow));

  function create() { openForm(res, { onSaved: () => load(true) }); }

  function skeleton() {
    clear(tbody).append(...Array.from({ length: 5 }, () =>
      h("tr", { class: "skeleton" }, cols.map(() => h("td", null, h("span"))), h("td"))));
    wrap.hidden = false; emptyBox.hidden = true; moreRow.hidden = true;
  }

  function paint() {
    const filtered = Boolean(state.q) || Object.keys(state.filters).length > 0;
    if (state.rows.length === 0) {
      wrap.hidden = true; emptyBox.hidden = false; moreRow.hidden = Boolean(!state.cursor);
      clear(emptyBox).append(h("div", { class: "empty" },
        h("h2", null, filtered ? `没有符合条件的${res.label}` : `还没有${res.label}`),
        h("p", null, filtered ? "换个关键词或筛选条件试试。" : `创建第一条${res.label}，它会出现在这里。`),
        filtered ? null : h("button", { class: "btn primary", type: "button", onClick: create }, icon("plus"), `新建${res.label}`)));
      count.textContent = "";
      return;
    }
    wrap.hidden = false; emptyBox.hidden = true;
    clear(tbody).append(...state.rows.map(rowEl));
    moreRow.hidden = !state.cursor;
    count.textContent = `${state.rows.length} 条${state.cursor ? "，还有更多" : ""}`;
  }

  function rowEl(row) {
    const edit = () => openForm(res, { id: row.id, onSaved: () => load(true) });
    const name = row[res.labelField] || "这条记录";
    return h("tr", { tabindex: "0", onClick: edit, onKeydown: (e) => { if (e.key === "Enter") edit(); } },
      cols.map((f) => h("td", null, fieldType(f.type).cell(f, row[f.key], ctx))),
      h("td", { class: "actions" },
        h("button", { class: "btn quiet icon-only", type: "button", "aria-label": `编辑${name}`, onClick: (e) => { e.stopPropagation(); edit(); } }, icon("edit")),
        h("button", { class: "btn quiet icon-only danger", type: "button", "aria-label": `删除${name}`, onClick: (e) => { e.stopPropagation(); remove(row, name); } }, icon("trash"))));
  }

  async function remove(row, name) {
    const ok = await confirmDialog({ title: `删除${res.label}？`, message: `“${name}”会被永久删除，无法恢复。`, confirmText: "删除", danger: true });
    if (!ok) return;
    try {
      await api(`/api/admin/r/${res.key}/${row.id}`, { method: "DELETE" });
      invalidateOptions(res.key);
      toast("已删除");
      load(true);
    } catch (err) {
      toast(err.message, "error");
    }
  }

  async function load(reset) {
    if (state.loading) return;
    state.loading = true;
    if (reset) { state.cursor = null; state.rows = []; skeleton(); }
    try {
      const params = { q: state.q, cursor: reset ? "" : state.cursor };
      for (const [k, v] of Object.entries(state.filters)) params[`f_${k}`] = v;
      const data = await api(`/api/admin/r/${res.key}${qs(params)}`);
      state.rows = state.rows.concat(data.rows);
      state.cursor = data.cursor;
      paint();
    } catch (err) {
      toast(err.message, "error");
      if (reset) paint();
    } finally {
      state.loading = false;
    }
  }

  await load(true);
}
