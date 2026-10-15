/* 网站设置面板：机构名、站名、演示标识开关 */
import { api, esc, showMsg } from "./shared.js";

export async function render(el) {
  const d = await api("/api/settings");
  const s = d.settings;
  el.innerHTML = `
    <div class="card">
      <h3>站点信息</h3>
      <p class="desc">前台顶栏与页脚显示的名称</p>
      <label class="fl">站点名称</label><input class="in" id="s-name" value="${esc(s.siteName || "")}">
      <label class="fl">机构名称</label><input class="in" id="s-inst" value="${esc(s.institution || "")}">
      <div class="btn block" id="save-info" style="margin-top:14px;max-width:280px">保存</div>
      <div class="msg" id="info-msg"></div>
    </div>
    <div class="card">
      <h3>演示标识</h3>
      <p class="desc">「与学信网无任何关联」的合规标识显隐</p>
      <div class="setting-row"><div><div class="label">页脚免责声明</div>
        <div class="desc">ird 页脚常显「演示系统 · 与学信网无任何关联」</div></div>
        <label class="switch"><input type="checkbox" id="s-footer" ${s.demoTagFooter ? "checked" : ""}><span class="slider"></span></label></div>
      <div class="setting-row"><div><div class="label">顶栏右上角「演示」标记</div>
        <div class="desc">前台顶栏的小标签</div></div>
        <label class="switch"><input type="checkbox" id="s-corner" ${s.demoTagCorner ? "checked" : ""}><span class="slider"></span></label></div>
      <div class="btn block" id="save-tags" style="margin-top:14px;max-width:280px">保存</div>
      <div class="msg" id="tags-msg"></div>
    </div>`;
  document.getElementById("save-info").addEventListener("click", async () => {
    try {
      await api("/api/admin/settings", { method: "PUT", body: JSON.stringify({
        siteName: document.getElementById("s-name").value.trim(),
        institution: document.getElementById("s-inst").value.trim(),
      }) });
      showMsg("info-msg", "已保存", true);
    } catch (e) { showMsg("info-msg", e.message); }
  });
  document.getElementById("save-tags").addEventListener("click", async () => {
    try {
      await api("/api/admin/settings", { method: "PUT", body: JSON.stringify({
        demoTagFooter: document.getElementById("s-footer").checked,
        demoTagCorner: document.getElementById("s-corner").checked,
      }) });
      showMsg("tags-msg", "已保存", true);
    } catch (e) { showMsg("tags-msg", e.message); }
  });
}
