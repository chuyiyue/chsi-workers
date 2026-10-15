import { h } from "./dom.js";

export function toast(message, kind = "") {
  const el = h("div", { class: `toast ${kind}` }, message);
  document.getElementById("toasts").append(el);
  setTimeout(() => el.remove(), kind === "error" ? 6000 : 2800);
}

/** 原生 <dialog> 确认框。返回 Promise<boolean>。 */
export function confirmDialog({ title, message, confirmText = "确定", danger = false }) {
  return new Promise((resolve) => {
    const dlg = h("dialog", { class: "alert" },
      h("h2", null, title),
      h("p", null, message),
      h("div", { class: "row" },
        h("button", { class: "btn", type: "button", onClick: () => dlg.close("no") }, "取消"),
        h("button", { class: `btn ${danger ? "danger solid" : "primary"}`, type: "button", onClick: () => dlg.close("yes") }, confirmText),
      ),
    );
    dlg.addEventListener("close", () => { resolve(dlg.returnValue === "yes"); dlg.remove(); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

export function badge(text, kind = "") {
  return h("span", { class: `badge ${kind}` }, text);
}

const fmt = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" });
export function formatTime(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : fmt.format(d);
}

export const dash = () => h("span", { class: "muted" }, "—");

export function debounce(fn, ms = 250) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
