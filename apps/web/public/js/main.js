/* 前台入口：顶栏 + hash 路由挂载（底栏两按钮：教育信息 / 个人中心） */
import { startRouter, route } from "/js/router.js";
import { loginView, eduView, meView, helpView } from "/js/views.js";
import { getSettings, esc } from "/js/api.js";

route("#login", loginView);
route("#edu", eduView);
route("#me", meView);
route("#help", helpView);

(async function init() {
  const s = await getSettings();
  document.title = s.siteName || document.title;
  const inst = document.getElementById("inst-name");
  if (inst) inst.textContent = s.institution;
  const tag = document.getElementById("demo-tag");
  if (tag) tag.style.display = s.demoTagCorner === false ? "none" : "";
  const foot = document.getElementById("demo-footer");
  if (foot) foot.style.display = s.demoTagFooter === false ? "none" : "";

  // 未登录一律去登录页；已登录访问 #login 直接进教育信息
  if (!location.hash) location.hash = "#edu";
  startRouter();
})();
