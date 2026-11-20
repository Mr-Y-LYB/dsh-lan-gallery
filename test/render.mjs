/**
 * 运行期渲染检查：用最小 hooks 替身真正执行组件函数体。
 *
 * 语法检查抓不到 TDZ、未定义变量、hook 用法错误——上一版
 * "Cannot access 'load' before initialization" 就是这么漏出去的。
 *
 *   node test/render.mjs
 */

import { pathToFileURL } from "node:url";
import * as FakeReact from "./fake-react.mjs";

process.on("unhandledRejection", (error) => {
  console.log("FAIL:", error && error.message ? error.message : String(error));
  process.exit(1);
});

// ---- 伪造浏览器环境
const appended = [];
globalThis.window = {
  __ModuleLoader__: {
    load(config) {
      globalThis.__captured = config;
    },
  },
};
globalThis.document = {
  getElementById: () => null,
  createElement: () => {
    const node = { id: "", textContent: "" };
    appended.push(node);
    return node;
  },
  head: { appendChild: () => {} },
};
globalThis.localStorage = {
  store: new Map(),
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  },
  setItem(key, value) {
    this.store.set(key, String(value));
  },
};
globalThis.fetch = () => Promise.reject(new Error("offline (expected)"));
globalThis.btoa = (value) => Buffer.from(value, "binary").toString("base64");

// ---- 加载 client bundle
const CLIENT = pathToFileURL(
  process.env.CLIENT_PATH ||
    "C:/Users/22977/Documents/deepseek-harness/default-workspace/projects/dsh-lan-gallery/lib/client.js",
).href;
await import(CLIENT);

const captured = globalThis.__captured;
if (!captured || captured.id !== "dsh-lan-gallery") {
  console.log("FAIL: client bundle 没有正确注册（id 缺失或不为 dsh-lan-gallery）");
  process.exit(1);
}

const mod = captured.factory((name) => {
  if (name === "react") return FakeReact;
  if (name === "react/jsx-runtime") return { jsx: FakeReact.createElement, jsxs: FakeReact.createElement };
  throw new Error(`unexpected require: ${name}`);
});

const results = [];
function check(name, fn) {
  FakeReact.resetHooks();
  try {
    const value = fn();
    results.push({ name, ok: true, detail: typeof value === "object" ? "返回元素树" : String(value) });
  } catch (error) {
    results.push({ name, ok: false, detail: error && error.message ? error.message : String(error) });
  }
}

console.log("id:", captured.id);
console.log("exports:", Object.keys(mod).join(", "));
console.log("apply 是 AsyncFunction:", mod.apply.constructor.name === "AsyncFunction");
console.log("inject:", JSON.stringify(mod.inject));

// ---- 自检：确认这套检查确实抓得住 TDZ。
// 如果这里没抛错，说明检查本身失效了，后面全部 PASS 也不可信。
FakeReact.resetHooks();
let tdzCaught = false;
try {
  (function tdzProbe() {
    FakeReact.useCallback(() => later(), [later]); // later 处于 TDZ
    const later = 1;
    return later;
  })();
} catch (error) {
  tdzCaught = /before initialization/.test(String(error && error.message));
}
console.log("TDZ 检测能力:", tdzCaught ? "有效（构造的 TDZ 用例被正确捕获）" : "失效");
if (!tdzCaught) {
  console.log("测试自身不可信，终止");
  process.exit(1);
}
console.log("");

// ---- apply 能否无异常执行并完成注册
const registered = [];
const ctx = {
  slots: {
    inject(_name, callback) {
      callback();
    },
    register(options, Component) {
      registered.push({ options, Component });
      return () => {};
    },
  },
};
check("apply(ctx)", () => {
  mod.apply(ctx);
  return `注册 ${registered.length} 项`;
});
console.log("注册项:", registered.map((r) => `${r.options.name}:${r.options.key || r.options.id}`).join(" / "));

// ---- 真正执行组件函数体（这里才是 TDZ 会炸的地方）
check("PanelShell()", () => mod.__Shell());
check("Panel()", () => mod.__Panel());

console.log("");
for (const row of results) {
  console.log(`  ${row.ok ? "PASS" : "FAIL"}  ${row.name}  —  ${row.detail}`);
}
const failed = results.filter((row) => !row.ok).length;
console.log("");
console.log(failed === 0 ? "渲染检查全部通过" : `${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
