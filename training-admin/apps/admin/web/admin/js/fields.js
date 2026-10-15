/**
 * 字段类型注册表。每个类型提供两件事：
 *   input(field, value, ctx) -> { el, get(), skipEmpty? }   表单里的控件
 *   cell(field, value, ctx)  -> Node | string               列表里的单元格
 *
 * 需要新字段类型（例如图片、富文本、标签）时：
 *   import { registerFieldType } from "./fields.js";
 *   registerFieldType("tags", { input(f, v) {...}, cell(f, v) {...} });
 * 然后在 schema.js 里把字段的 type 写成 "tags" 即可。
 */
import { h } from "./dom.js";
import { api } from "./api.js";
import { badge, dash } from "./ui.js";

const types = new Map();
export const registerFieldType = (name, impl) => types.set(name, impl);
export const fieldType = (name) => types.get(name) || types.get("text");

const fid = (f) => `fld-${f.key}`;
const lockedOnEdit = (f, ctx) => Boolean(f.immutable && ctx.mode === "edit");

/* ---- ref 选项缓存：id -> 显示名 ---- */
const optionCache = new Map();
export async function refOptions(resKey) {
  if (!optionCache.has(resKey)) {
    const { options } = await api(`/api/admin/r/${resKey}/options`);
    optionCache.set(resKey, options);
  }
  return optionCache.get(resKey);
}
export const invalidateOptions = (resKey) => optionCache.delete(resKey);
export async function refLabels(res) {
  const out = {};
  for (const key of new Set(res.fields.filter((f) => f.type === "ref").map((f) => f.to))) {
    out[key] = new Map((await refOptions(key)).map((o) => [o.id, o.label]));
  }
  return out;
}

/* ---- 内置类型 ---- */

registerFieldType("text", {
  input(f, v, ctx) {
    const el = h("input", {
      id: fid(f), type: "text", name: f.key, value: v ?? "", maxLength: f.max || 60,
      placeholder: f.placeholder || "", autocomplete: "off", disabled: lockedOnEdit(f, ctx),
    });
    return { el, get: () => el.value.trim() };
  },
  cell: (f, v) => v || dash(),
});

registerFieldType("textarea", {
  input(f, v) {
    const el = h("textarea", { id: fid(f), name: f.key, rows: 4, maxLength: f.max || 500, placeholder: f.placeholder || "" });
    el.value = v ?? "";
    return { el, get: () => el.value.trim() };
  },
  cell: (f, v) => (v ? String(v).slice(0, 40) : dash()),
});

registerFieldType("select", {
  input(f, v, ctx) {
    const el = h("select", { id: fid(f), name: f.key, disabled: lockedOnEdit(f, ctx) },
      !f.required && h("option", { value: "" }, "未选择"),
      f.options.map((o) => h("option", { value: o }, o)));
    el.value = v ?? (f.required ? f.options[0] : "");
    return { el, get: () => el.value };
  },
  cell(f, v) {
    if (!v) return dash();
    return f.badges && f.badges[v] ? badge(v, f.badges[v]) : v;
  },
});

registerFieldType("date", {
  input(f, v) {
    const el = h("input", { id: fid(f), type: "date", name: f.key, value: v ?? "" });
    return { el, get: () => el.value };
  },
  cell: (f, v) => v || dash(),
});

registerFieldType("boolean", {
  input(f, v) {
    const cb = h("input", { id: fid(f), type: "checkbox", name: f.key, role: "switch", checked: v === true });
    return { el: h("label", { class: "switch" }, cb, h("span", null, v === true ? "是" : "否")), get: () => cb.checked };
  },
  cell: (f, v) => (v === true ? badge("是", "ok") : badge("否")),
});

registerFieldType("ref", {
  input(f, v, ctx) {
    const opts = ctx.refs[f.to] || [];
    const el = h("select", { id: fid(f), name: f.key },
      h("option", { value: "", disabled: true }, opts.length ? "请选择" : "还没有可选项，请先去创建"),
      opts.map((o) => h("option", { value: o.id }, o.label)));
    el.value = v ?? "";
    return { el, get: () => el.value };
  },
  cell(f, v, ctx) {
    if (!v) return dash();
    return (ctx.refLabels[f.to] && ctx.refLabels[f.to].get(v)) || h("span", { class: "muted" }, "（已删除）");
  },
});

registerFieldType("secret", {
  input(f, v, ctx) {
    const mask = ctx.masks && ctx.masks[f.key];
    const el = h("input", {
      id: fid(f), type: "text", name: f.key, autocomplete: "off", maxLength: f.max || 60,
      placeholder: mask ? `已设置：${mask}（留空表示不修改）` : f.placeholder || "",
    });
    return { el, get: () => el.value.trim(), skipEmpty: true };
  },
  cell: () => dash(),
});

registerFieldType("password", {
  input(f) {
    const el = h("input", { id: fid(f), type: "password", name: f.key, autocomplete: "new-password", maxLength: f.max || 64 });
    return { el, get: () => el.value, skipEmpty: true };
  },
  cell: () => dash(),
});
