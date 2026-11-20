/**
 * 冒烟测试：不需要 DSH，直接给插件一个最小 ctx，验证 source 角色的 HTTP 面。
 *
 *   node test/smoke.mjs
 *
 * 会临时占用 8799 端口，跑完自动释放。
 */

import { apply } from "../lib/index.js";

const PORT = Number(process.env.SMOKE_PORT || 8799);
const TOKEN = "smoke-token";
const BASE = `http://127.0.0.1:${PORT}`;

const ctx = {
  effect(fn) {
    const disposer = fn();
    return typeof disposer === "function" ? disposer : () => {};
  },
  inject() {},
  logger: {
    info: (message) => console.log("  ·", message),
    warn: (message) => console.log("  !", message),
  },
};

const results = [];

async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail === undefined ? "" : String(detail) });
  } catch (error) {
    results.push({ name, ok: false, detail: String(error && error.message ? error.message : error) });
  }
}

function authHeaders() {
  return { "x-gallery-token": TOKEN };
}

await apply(ctx, { role: "source", port: PORT, token: TOKEN });
await new Promise((resolve) => setTimeout(resolve, 1200));

await check("无令牌访问列表被拒", async () => {
  const response = await fetch(`${BASE}/api/list`);
  if (response.status !== 403) throw new Error(`期望 403，实际 ${response.status}`);
  return response.status;
});

await check("meta 可用", async () => {
  const response = await fetch(`${BASE}/api/meta`, { headers: authHeaders() });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.role !== "source") throw new Error("role 不是 source");
  return `count=${payload.count}`;
});

let firstId = null;

await check("list 返回条目", async () => {
  const response = await fetch(`${BASE}/api/list`, { headers: authHeaders() });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload.items) || payload.items.length === 0) throw new Error("列表为空");
  firstId = payload.items[0].id;
  return `${payload.items.length} 项，首项 ${firstId.slice(0, 8)}`;
});

await check("原图可下载且是 PNG", async () => {
  if (!firstId) throw new Error("没有可用 id");
  const response = await fetch(`${BASE}/i/${firstId}`, { headers: authHeaders() });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const type = response.headers.get("content-type");
  if (type !== "image/png") throw new Error(`content-type=${type}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.subarray(1, 4).toString("ascii") !== "PNG") throw new Error("不是 PNG 数据");
  return `${(buffer.length / 1048576).toFixed(2)} MB`;
});

await check("job 记录可读", async () => {
  if (!firstId) throw new Error("没有可用 id");
  const response = await fetch(`${BASE}/j/${firstId}`, { headers: authHeaders() });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  return payload.width ? `${payload.width}×${payload.height}` : "无元数据";
});

await check("非法 id 被拒", async () => {
  const response = await fetch(`${BASE}/i/not-an-id`, { headers: authHeaders() });
  if (response.status !== 404) throw new Error(`期望 404，实际 ${response.status}`);
  return response.status;
});

await check("CORS 预检通过", async () => {
  const response = await fetch(`${BASE}/i/${firstId || "0".repeat(32)}`, {
    method: "OPTIONS",
  });
  if (response.status !== 204) throw new Error(`期望 204，实际 ${response.status}`);
  if (!response.headers.get("access-control-allow-origin")) throw new Error("缺少 CORS 头");
  return 204;
});

console.log("");
for (const row of results) {
  console.log(`  ${row.ok ? "PASS" : "FAIL"}  ${row.name}${row.detail ? "  —  " + row.detail : ""}`);
}
const failed = results.filter((row) => !row.ok).length;
console.log("");
console.log(failed === 0 ? `全部通过（${results.length} 项）` : `${failed} 项失败`);

process.exit(failed === 0 ? 0 : 1);
