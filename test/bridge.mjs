/**
 * 桥接测试：本机同时跑一个 source（模拟电脑）和一个 bridge（模拟手机），
 * 验证手机端挂上来的同源路由确实能把请求转发到电脑。
 *
 *   node test/bridge.mjs
 */

import { createServer } from "node:http";
import { apply } from "../lib/index.js";

const SOURCE_PORT = 8801;
const BRIDGE_PORT = 8802;
const TOKEN = "bridge-token";
const BRIDGE_BASE = `http://127.0.0.1:${BRIDGE_PORT}`;
const PREFIX = "/api/lan-gallery";

const logs = [];
const logger = {
  info: (message) => {
    logs.push(message);
    console.log("  ·", message);
  },
  warn: (message) => {
    logs.push(message);
    console.log("  !", message);
  },
};

// ---- 电脑端（source）
const sourceCtx = {
  effect(fn) {
    const disposer = fn();
    return typeof disposer === "function" ? disposer : () => {};
  },
  inject() {},
  logger,
};
await apply(sourceCtx, { role: "source", port: SOURCE_PORT, token: TOKEN });
await new Promise((resolve) => setTimeout(resolve, 1200));

// ---- 手机端（bridge）
const routes = [];
const fakeWebServer = {
  register(route) {
    routes.push(route);
    return () => {};
  },
};
const bridgeCtx = {
  effect(fn) {
    const disposer = fn();
    return typeof disposer === "function" ? disposer : () => {};
  },
  inject(_deps, callback) {
    callback({
      effect: (fn) => fn(),
      webServer: fakeWebServer,
    });
  },
  logger,
};
await apply(bridgeCtx, { role: "bridge", sourceUrl: `http://127.0.0.1:${SOURCE_PORT}`, token: TOKEN });

if (routes.length !== 1) {
  console.log(`\n  FAIL 没有挂上桥接路由（routes=${routes.length}）`);
  process.exit(1);
}
const route = routes[0];
console.log(`  · 路由 kind=${route.kind} path=${route.path}`);

// ---- 把路由挂到一个真实 HTTP server 上，模拟 DSH 的 webServer
const dispatcher = createServer((req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const matches = url.pathname === route.path || url.pathname.startsWith(route.path + "/");
  if (!matches) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
    return;
  }
  Promise.resolve(route.handler(req, res)).catch((error) => {
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(String(error));
    }
  });
});
await new Promise((resolve) => dispatcher.listen(BRIDGE_PORT, "127.0.0.1", resolve));

// ---- 断言
const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail === undefined ? "" : String(detail) });
  } catch (error) {
    results.push({ name, ok: false, detail: String(error && error.message ? error.message : error) });
  }
}

let firstId = null;

await check("桥接后的列表可用", async () => {
  const response = await fetch(`${BRIDGE_BASE}${PREFIX}/list`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload.items) || payload.items.length === 0) throw new Error("列表为空");
  firstId = payload.items[0].id;
  return `${payload.items.length} 项`;
});

await check("桥接后的原图可用", async () => {
  if (!firstId) throw new Error("没有可用 id");
  const response = await fetch(`${BRIDGE_BASE}${PREFIX}/i/${firstId}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.subarray(1, 4).toString("ascii") !== "PNG") throw new Error("不是 PNG");
  return `${(buffer.length / 1048576).toFixed(2)} MB`;
});

await check("桥接后的 job 可用", async () => {
  if (!firstId) throw new Error("没有可用 id");
  const response = await fetch(`${BRIDGE_BASE}${PREFIX}/j/${firstId}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  return payload.width ? `${payload.width}×${payload.height}` : "无元数据";
});

await check("上游不可达时给出 502", async () => {
  let brokenRoute = null;
  const brokenCtx = {
    effect(fn) {
      fn();
      return () => {};
    },
    inject(_deps, callback) {
      callback({
        effect: (fn) => fn(),
        webServer: { register: (value) => { brokenRoute = value; return () => {}; } },
      });
    },
    logger: { info() {}, warn() {} },
  };
  await apply(brokenCtx, { role: "bridge", sourceUrl: "http://127.0.0.1:1", token: TOKEN });
  if (!brokenRoute) throw new Error("没有挂上路由");

  const probe = createServer((req, res) => {
    Promise.resolve(brokenRoute.handler(req, res)).catch(() => {});
  });
  await new Promise((resolve) => probe.listen(8803, "127.0.0.1", resolve));
  const response = await fetch(`http://127.0.0.1:8803${PREFIX}/list`);
  await new Promise((resolve) => probe.close(resolve));
  if (response.status !== 502) throw new Error(`期望 502，实际 ${response.status}`);
  return 502;
});

console.log("");
for (const row of results) {
  console.log(`  ${row.ok ? "PASS" : "FAIL"}  ${row.name}${row.detail ? "  —  " + row.detail : ""}`);
}
const failed = results.filter((row) => !row.ok).length;
console.log("");
console.log(failed === 0 ? `全部通过（${results.length} 项）` : `${failed} 项失败`);

await new Promise((resolve) => dispatcher.close(resolve));
process.exit(failed === 0 ? 0 : 1);
