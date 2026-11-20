/**
 * 删除路由测试：用临时 gallery 目录，验证 DELETE /d/<id> 把图移到 trash。
 *
 *   node test/delete.mjs
 */

import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { apply } from "../lib/index.js";

process.on("unhandledRejection", (error) => {
  console.log("FAIL:", error && error.message ? error.message : String(error));
  process.exit(1);
});

const ROOT = join(tmpdir(), "lg-delete-test-" + Date.now());
const GALLERY = join(ROOT, "images");
const TRASH = join(ROOT, "trash");
const ID = "a".repeat(32);

mkdirSync(join(GALLERY, ID), { recursive: true });
writeFileSync(join(GALLERY, ID, "image.png"), Buffer.alloc(4096, 1));
writeFileSync(join(GALLERY, ID, "job.json"), JSON.stringify({ prompt: "test", width: 8, height: 8 }));

const PORT = 8977;
const TOKEN = "delete-test";
const ctx = {
  effect(fn) {
    const d = fn();
    return typeof d === "function" ? d : () => {};
  },
  inject() {},
  logger: { info() {}, warn() {} },
};

apply(ctx, { role: "source", port: PORT, token: TOKEN, galleryDir: GALLERY });
await new Promise((r) => setTimeout(r, 1200));

const base = `http://127.0.0.1:${PORT}`;
const results = [];
function check(name, ok, info = "") {
  results.push({ name, ok, info });
}

// 1) 删除前存在
check("删除前条目存在", existsSync(join(GALLERY, ID)));

// 2) 列表里能看到
const listBefore = await (await fetch(`${base}/api/lan-gallery/list`, { headers: { "x-gallery-token": TOKEN } })).json();
check("列表包含该条目", listBefore.items.some((it) => it.id === ID), `共 ${listBefore.items.length} 项`);

// 3) 无令牌删除被拒
const denied = await fetch(`${base}/api/lan-gallery/d/${ID}`, { method: "DELETE" });
check("无令牌删除返回 403", denied.status === 403, `实际 ${denied.status}`);

// 4) 带令牌删除成功
const del = await fetch(`${base}/api/lan-gallery/d/${ID}`, {
  method: "DELETE",
  headers: { "x-gallery-token": TOKEN },
});
check("带令牌删除返回 200", del.ok, `实际 ${del.status}`);

// 5) 已移到 trash
await new Promise((r) => setTimeout(r, 300));
check("图片已移入 trash", existsSync(join(TRASH, ID)), TRASH);
check("原目录已清空", !existsSync(join(GALLERY, ID)));

// 6) 列表里没有了
const listAfter = await (await fetch(`${base}/api/lan-gallery/list`, { headers: { "x-gallery-token": TOKEN } })).json();
check("列表不再包含该条目", !listAfter.items.some((it) => it.id === ID), `共 ${listAfter.items.length} 项`);

console.log("");
for (const r of results) {
  console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.info ? "  —  " + r.info : ""}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log("");
console.log(failed === 0 ? `全部通过（${results.length} 项）` : `${failed} 项失败`);

rmSync(ROOT, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
