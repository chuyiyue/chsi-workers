/* 前台入口：顶栏 + hash 路由挂载 */
import { startRouter, route } from "/js/router.js";
import { loginView, registerView, queryView, helpView, meView } from "/js/views.js";
import { getSettings, esc } from "/js/api.js";

route("#login", loginView);
route("#register", registerView);
route("#query", queryView);
route("#help", helpView);
route("#me", meView);

(async function init() {
  const s = await getSettings();
  document.title = s.siteName || document.title;
  const inst = document.getElementById("inst-name");
  if (inst) inst.textContent = s.institution;
  const tag = document.getElementById("demo-tag");
  if (tag) tag.style.display = s.demoTagCorner === false ? "none" : "";
  const foot = document.getElementById("demo-footer");
  if (foot) foot.style.display = s.demoTagFooter === false ? "none" : "";

  startRouter();
})();
