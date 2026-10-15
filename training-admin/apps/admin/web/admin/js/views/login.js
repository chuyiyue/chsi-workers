import { h, clear } from "../dom.js";
import { api } from "../api.js";

export function renderLogin(app, onSuccess) {
  const err = h("p", { class: "err", role: "alert" });
  const pw = h("input", { id: "pw", type: "password", name: "password", autocomplete: "current-password", maxLength: 128 });
  const btn = h("button", { class: "btn primary", type: "submit" }, "登录");

  const form = h("form", {
    onSubmit: async (e) => {
      e.preventDefault();
      err.textContent = "";
      if (!pw.value) { err.textContent = "请输入管理员密码"; pw.focus(); return; }
      btn.disabled = true; btn.textContent = "登录中…";
      try {
        await api("/api/auth/login", { method: "POST", body: { password: pw.value } });
        onSuccess();
      } catch (ex) {
        err.textContent = ex.message;
        pw.select();
        btn.disabled = false; btn.textContent = "登录";
      }
    },
  },
    h("h1", null, "登录管理后台"),
    h("div", { class: "field" }, h("label", { class: "name", htmlFor: "pw" }, "管理员密码"), pw),
    err, btn);

  clear(app).append(h("div", { class: "login" }, form));
  document.title = "登录 · 管理后台";
  pw.focus();
}
