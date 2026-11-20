/**
 * 缩略图测试：用临时 gallery 目录（放一张真图），验证 /t/ 返回的是
 * 缩小后的 JPEG（几十 KB），而不是 1-2MB 的原图。
 *
 *   node test/thumb.mjs
 */

import { mkdirSync, writeFileSync, existsSync, rmSync, statSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { apply } from "../lib/index.js";

process.on("unhandledRejection", (error) => {
  console.log("FAIL:", error && error.message ? error.message : String(error));
  process.exit(1);
});

// 找一张真实大图当样本
const SAMPLE_DIR = join(process.env.USERPROFILE || "", ".dsh", "qwen-studio", "images");
let sample = null;
try {
  const { readdirSync } = await import("node:fs");
  for (const name of readdirSync(SAMPLE_DIR)) {
    if (!/^[0-9a-f]{32}$/.test(name)) continue;
    const p = join(SAMPLE_DIR, name, "image.png");
    if (existsSync(p) && statSync(p).size > 500_000) {
      sample = p;
      break;
    }
  }
} catch {
  /* 忽略 */
}

if (!sample) {
  console.log("找不到真实样本图，跳过（至少需要一张 >500KB 的图）");
  process.exit(0);
}

const ROOT = join(tmpdir(), "lg-thumb-test-" + Date.now());
const GALLERY = join(ROOT, "images");
const ID = "b".repeat(32);
mkdirSync(join(GALLERY, ID), { recursive: true });
copyFileSync(sample, join(GALLERY, ID, "image.png"));
writeFileSync(join(GALLERY, ID, "job.json"), JSON.stringify({ prompt: "t", width: 1024, height: 1024 }));

const PORT = 8978;
const TOKEN = "thumb-test";
const PY = "E:/AI/ComfyUI/ComfyUI_windows_portable/python_embeded/python.exe";

const ctx = {
  effect(fn) {
    const d = fn();
    return typeof d === "function" ? d : () => {};
  },
  inject() {},
  logger: { info() {}, warn() {} },
};

apply(ctx, {
  role: "source",
  port: PORT,
  token: TOKEN,
  galleryDir: GALLERY,
  pythonPath: PY,
  thumbSize: 512,
});
await new Promise((r) => setTimeout(r, 1200));

const base = `http://127.0.0.1:${PORT}`;
const headers = { "x-gallery-token": TOKEN };
const results = [];
const check = (name, ok, info = "") => results.push({ name, ok, info });

const originalSize = statSync(sample).size;

// 首次请求（需要现场生成）
const t0 = Date.now();
const first = await fetch(`${base}/api/lan-gallery/t/${ID}.jpg`, { headers });
const firstBuf = Buffer.from(await first.arrayBuffer());
const firstMs = Date.now() - t0;

check("首次 /t/ 返回 200", first.ok, `实际 ${first.status}`);
check("首次返回 image/jpeg", first.headers.get("content-type") === "image/jpeg", first.headers.get("content-type") || "");
check(
  "首次体积远小于原图",
  firstBuf.length < originalSize / 4,
  `${Math.round(firstBuf.length / 1024)}KB vs 原图 ${Math.round(originalSize / 1024)}KB`,
);
check("首次生成耗时合理", firstMs < 20000, `${firstMs}ms`);

// 第二次请求（应命中缓存）
const t1 = Date.now();
const second = await fetch(`${base}/api/lan-gallery/t/${ID}.jpg`, { headers });
const secondBuf = Buffer.from(await second.arrayBuffer());
const secondMs = Date.now() - t1;
check("第二次命中缓存（更快）", secondMs <= firstMs, `${secondMs}ms vs 首次 ${firstMs}ms`);
check("两次体积一致", secondBuf.length === firstBuf.length, `${secondBuf.length} vs ${firstBuf.length}`);

// 原图接口仍可用
const orig = await fetch(`${base}/api/lan-gallery/i/${ID}`, { headers });
check("原图接口仍返回 200", orig.ok, `实际 ${orig.status}`);

console.log("");
console.log(`  样本原图: ${Math.round(originalSize / 1024)}KB`);
console.log(`  缩略图:   ${Math.round(firstBuf.length / 1024)}KB  (${(originalSize / firstBuf.length).toFixed(1)}x 压缩)`);
console.log("");
for (const r of results) {
  console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.info ? "  —  " + r.info : ""}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log("");
console.log(failed === 0 ? `全部通过（${results.length} 项）` : `${failed} 项失败`);

rmSync(ROOT, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
