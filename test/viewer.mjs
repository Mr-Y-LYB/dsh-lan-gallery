/**
 * 静态结构断言：钉住 0.3.4 修的三个点。
 *
 *   node test/viewer.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "lib", "client.js"), "utf8");

const results = [];
const check = (name, ok, info = "") => results.push({ name, ok, info });

// 1) 大图区域只允许一个 <img>：两个会各算尺寸导致左右分屏
const start = src.indexOf('className: "lg-stage"');
const end = src.indexOf('className: "lg-meta"');
const block = start >= 0 && end > start ? src.slice(start, end) : "";
const imgCount = (block.match(/h\("img"/g) || []).length;
check("大图区域内 img 元素只有一个", imgCount === 1, `实际 ${imgCount} 个`);
check("大图用 viewSrc 单元素切换", block.includes("viewSrc ? h("), "");
check("提示词展开时点图片可收起", block.includes("setMetaOpen(false)"), "");

// 2) 不再用两层定位（lg-base / lg-hi / calc 都会在旧 WebView 出问题）
check("没有 lg-base 残留", !src.includes(".lg-base{") && !src.includes('"lg-base"'));
check("没有 lg-hi 残留", !src.includes(".lg-hi{") && !src.includes('"lg-hi"'));
const calcInCode = src.replace(/\/\*[\s\S]*?\*\//g, "").match(/calc\(/g) || [];
check("CSS 里没有 calc()", calcInCode.length === 0, `代码中 ${calcInCode.length} 处`);

// 3) 删除改成 MD3 对话框，不用原生 confirm
check("有 MD3 对话框样式", src.includes(".lg-dialog{") && src.includes(".lg-scrim{"));
check("有 doDelete 处理器", src.includes("const doDelete"));
check("已移除原生 confirm", !src.includes("window.confirm"));

// 4) 提示词面板展开高度不是 55%（会挡住整张图）
check("提示词展开高度 45%", src.includes(".lg-meta.open{height:45%}"));
check("图片区域同步 45%", src.includes(".lg-stage.open{bottom:45%}"));

console.log("");
for (const r of results) {
  console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.info ? "  —  " + r.info : ""}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log("");
console.log(failed === 0 ? `全部通过（${results.length} 项）` : `${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
