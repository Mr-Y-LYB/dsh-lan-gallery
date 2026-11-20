/**
 * 删除压力测试：连续删除 + 并发删除 + 文件被占用的场景。
 *
 *   node test/delete-stress.mjs
 */

import { mkdirSync, writeFileSync, existsSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { apply } from "../lib/index.js";

process.on("unhandledRejection", (error) => {
  console.log("FAIL:", error && error.message ? error.message : String(error));
  process.exit(1);
});

const ROOT = join(tmpdir(), "lg-delstress-" + Date.now());
const GALLERY = join(ROOT, "images");
const TRASH = join(ROOT, "trash");
const THUMBS = join(ROOT, ".thumbs");
const TOKEN = "stress";
const PORT = 8981;

mkdirSync(GALLERY, { recursive: true });
mkdirSync(THUMBS, { recursive: true });

const TOTAL = 20;
const ids = [];
for (let i = 0; i < TOTAL; i += 1) {
  const id = i.toString(16).padStart(32, "0");
  ids.push(id);
  mkdirSync(join(GALLERY, id), { recursive: true });
  writeFileSync(join(GALLERY, id, "image.png"), Buffer.alloc(2048, i));
  writeFileSync(join(GALLERY, id, "job.json"), JSON.stringify({ prompt: "p" + i, width: 8, height: 8, seed: 1000 + i }));
  // 预置一个缩略图缓存，删除后应当被清掉
  writeFileSync(join(THUMBS, `${id}.jpg`), Buffer.alloc(512, 9));
}

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
const headers = { "x-gallery-token": TOKEN };
const results = [];
const check = (name, ok, info = "") => results.push({ name, ok, info });

// 1) 连续删除 20 张
let okCount = 0;
const hows = new Set();
for (const id of ids) {
  const r = await fetch(`${base}/api/lan-gallery/d/${id}`, { method: "DELETE", headers });
  if (r.ok) {
    okCount += 1;
    try {
      const body = await r.json();
      if (body.how) hows.add(body.how);
    } catch {
      /* 忽略 */
    }
  }
}
check("连续删除 20 张全部成功", okCount === TOTAL, `${okCount}/${TOTAL}`);
check("全部落到 trash", (await import("node:fs")).readdirSync(TRASH).length === TOTAL, `实际 ${(await import("node:fs")).readdirSync(TRASH).length}`);
check("源目录已清空", (await import("node:fs")).readdirSync(GALLERY).length === 0);
check("缩略图缓存已清理", (await import("node:fs")).readdirSync(THUMBS).length === 0, `剩 ${(await import("node:fs")).readdirSync(THUMBS).length} 个`);

// 2) 并发删除同一张（新增一条）
const raceId = "f".repeat(32);
mkdirSync(join(GALLERY, raceId), { recursive: true });
writeFileSync(join(GALLERY, raceId, "image.png"), Buffer.alloc(1024, 1));
writeFileSync(join(GALLERY, raceId, "job.json"), JSON.stringify({ prompt: "race", width: 8, height: 8, seed: 1 }));

const raceResults = await Promise.all(
  Array.from({ length: 5 }, () =>
    fetch(`${base}/api/lan-gallery/d/${raceId}`, { method: "DELETE", headers }).then(
      (r) => r.status,
      () => 0,
    ),
  ),
);
const raceOk = raceResults.filter((s) => s === 200).length;
check("并发删同一张：全部 200（幂等）", raceOk === 5, `状态码 ${raceResults.join(",")}`);
check("并发删同一张：没有 500", raceResults.every((s) => s !== 500), raceResults.join(","));
check("并发删除后条目确实没了", !existsSync(join(GALLERY, raceId)));

// 3) 删除不存在的条目
const missing = await fetch(`${base}/api/lan-gallery/d/${"e".repeat(32)}`, { method: "DELETE", headers });
check("删不存在的返回 500（带错误信息）", missing.status === 500, `实际 ${missing.status}`);
const missingBody = await missing.json().catch(() => ({}));
check("错误信息非空", Boolean(missingBody.error), String(missingBody.error).slice(0, 40));

// 4) 文件被占用时也能删（持有读句柄期间发删除）
const heldId = "d".repeat(32);
mkdirSync(join(GALLERY, heldId), { recursive: true });
writeFileSync(join(GALLERY, heldId, "image.png"), Buffer.alloc(4096, 3));
writeFileSync(join(GALLERY, heldId, "job.json"), JSON.stringify({ prompt: "held", width: 8, height: 8, seed: 2 }));

const fsMod = await import("node:fs");
const handle = fsMod.openSync(join(GALLERY, heldId, "image.png"), "r");
let heldStatus = 0;
try {
  const r = await fetch(`${base}/api/lan-gallery/d/${heldId}`, { method: "DELETE", headers });
  heldStatus = r.status;
} finally {
  fsMod.closeSync(handle);
}
check("文件被读句柄占用时删除仍成功", heldStatus === 200, `实际 ${heldStatus}`);

console.log("");
for (const r of results) {
  console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.info ? "  —  " + r.info : ""}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log("");
console.log(failed === 0 ? `全部通过（${results.length} 项）` : `${failed} 项失败`);
if (hows.size) console.log(`移动方式: ${[...hows].join(", ")}`);

rmSync(ROOT, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
