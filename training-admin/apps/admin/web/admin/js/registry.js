/**
 * 页面注册表。资源页由 schema.js 自动生成；其余页面在 extensions.js 里注册：
 *
 *   registerPage({
 *     id: "reports",              // 对应地址 #/reports
 *     label: "报表",
 *     icon: "file",               // dom.js 里的图标名
 *     render: async (container, ctx) => { ... }   // ctx.meta 是 /api/admin/meta 的内容
 *   });
 */
export const extraPages = [];
export const registerPage = (page) => { extraPages.push(page); };
