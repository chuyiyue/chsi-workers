import { h, icon } from "../dom.js";
import { api } from "../api.js";
import { toast } from "../ui.js";
import { fieldType, refOptions, invalidateOptions } from "../fields.js";

/** 打开新建 / 编辑面板（原生 <dialog>，从右侧滑入） */
export async function openForm(res, { id = null, onSaved } = {}) {
  const mode = id ? "edit" : "create";
  let record = {};
  const refs = {};
  try {
    const needs = [...new Set(res.fields.filter((f) => f.type === "ref").map((f) => f.to))];
    for (const key of needs) invalidateOptions(key); // 总是拿最新选项
    const [rec] = await Promise.all([
      id ? api(`/api/admin/r/${res.key}/${id}`) : null,
      ...needs.map(async (key) => { refs[key] = await refOptions(key); }),
    ]);
    if (rec) record = rec.record;
  } catch (err) {
    toast(err.message, "error");
    return;
  }

  const ctx = { mode, refs, masks: record._masks || {} };
  const controls = res.fields.map((f) => ({ f, c: fieldType(f.type).input(f, record[f.key], ctx) }));
  const wrappers = new Map();

  const body = h("div", { class: "sheet-body" },
    controls.map(({ f, c }) => {
      const wrap = h("div", { class: "field" },
        h("label", { class: "name", htmlFor: `fld-${f.key}` }, f.label,
          (f.required || (mode === "create" && f.requiredOnCreate)) && h("span", { class: "req", "aria-hidden": "true" }, "*")),
        c.el,
        f.hint && h("p", { class: "hint" }, f.hint),
        h("p", { class: "err", hidden: true }),
      );
      wrappers.set(f.key, wrap);
      return wrap;
    }),
  );

  const saveBtn = h("button", { class: "btn primary", type: "submit" }, mode === "create" ? `创建${res.label}` : "保存修改");
  const dlg = h("dialog", { class: "sheet", "aria-label": mode === "create" ? `新建${res.label}` : `编辑${res.label}` },
    h("form", { novalidate: true },
      h("div", { class: "sheet-head" },
        h("h2", null, mode === "create" ? `新建${res.label}` : `编辑${res.label}`),
        h("button", { class: "btn quiet icon-only", type: "button", "aria-label": "关闭", onClick: () => dlg.close() }, icon("x")),
      ),
      body,
      h("div", { class: "sheet-foot" },
        h("button", { class: "btn", type: "button", onClick: () => dlg.close() }, "取消"),
        saveBtn,
      ),
    ),
  );

  const clearErrors = () => {
    for (const w of wrappers.values()) {
      w.classList.remove("invalid");
      const e = w.querySelector(".err");
      e.hidden = true; e.textContent = "";
    }
  };
  const showErrors = (fields) => {
    let first = true;
    for (const [key, msg] of Object.entries(fields || {})) {
      const w = wrappers.get(key);
      if (!w) continue;
      w.classList.add("invalid");
      const e = w.querySelector(".err");
      e.hidden = false; e.textContent = msg;
      if (first) { w.querySelector("input,select,textarea")?.focus(); first = false; }
    }
  };

  dlg.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    clearErrors();
    const payload = {};
    for (const { f, c } of controls) {
      if (f.immutable && mode === "edit") continue;
      const v = c.get();
      if (c.skipEmpty && v === "") continue;
      payload[f.key] = v;
    }
    const label = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.textContent = "保存中…";
    try {
      await api(id ? `/api/admin/r/${res.key}/${id}` : `/api/admin/r/${res.key}`, { method: id ? "PUT" : "POST", body: payload });
      invalidateOptions(res.key);
      toast(mode === "create" ? "已创建" : "已保存修改");
      dlg.close();
      if (onSaved) onSaved();
    } catch (err) {
      showErrors(err.fields);
      toast(err.message, "error");
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = label;
    }
  });

  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  body.querySelector("input:not([disabled]),select:not([disabled]),textarea")?.focus();
}
