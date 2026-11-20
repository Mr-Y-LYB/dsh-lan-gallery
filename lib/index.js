/**
 * dsh-lan-gallery · host 侧
 *
 * 一个包，两种角色：
 *   source —— 电脑端：把本机创作图库对外提供（必须自己起 server，因为 DSH 的
 *             webServer 明确拒绝绑定 0.0.0.0，而手机要连就必须绑全网卡）
 *   bridge —— 手机端：把电脑图库代理到自己的同源路径 /api/lan-gallery/*，
 *             面板于是既不受跨域限制，也不受页面 CSP 限制
 *
 * 只用 Node 内置模块，不引入任何第三方依赖。
 */

import { randomBytes } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";

export const name = "lan-gallery";

/**
 * 配置 Schema。必须同步取得：cordis 的插件入口不允许顶层 await，
 * 带顶层 await 的模块会让 entry 永久停在 loading，进而拖垮整个 web boot。
 */
const requireFromHere = createRequire(import.meta.url);
let Config;
try {
  const loaded = requireFromHere("@deepseek-ai/schemastery");
  const z = loaded && loaded.default ? loaded.default : loaded;
  Config = z.object({
    role: z.union([z.const("auto"), z.const("source"), z.const("bridge")]).default("auto"),
    sourceUrl: z.string().default(""),
    token: z.string().default(""),
    port: z.natural().default(8765),
    bind: z.string().default("0.0.0.0"),
    galleryDir: z.string().default(""),
    title: z.string().default("电脑图库"),
    order: z.natural().default(11),
  });
} catch {
  Config = undefined;
}
export { Config };

const ID_RE = /^[0-9a-f]{32}$/;
const API_PREFIX = "/api/lan-gallery";
const LIST_LIMIT = 400;
const FORWARD_TIMEOUT_MS = 20000;

function log(ctx, message) {
  try {
    if (ctx?.logger?.info) ctx.logger.info(message);
    else console.log(`[lan-gallery] ${message}`);
  } catch {
    /* 日志失败不影响主流程 */
  }
}

function warn(ctx, message) {
  try {
    if (ctx?.logger?.warn) ctx.logger.warn(message);
    else console.warn(`[lan-gallery] ${message}`);
  } catch {
    /* 同上 */
  }
}

function galleryDirOf(config) {
  if (config && typeof config.galleryDir === "string" && config.galleryDir.trim()) {
    return config.galleryDir.trim();
  }
  return join(homedir(), ".dsh", "qwen-studio", "images");
}

function cors() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "x-gallery-token,content-type",
    "access-control-allow-methods": "GET,HEAD,OPTIONS",
  };
}

function sendJson(res, status, value) {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(body.length),
    "cache-control": "no-store",
    ...cors(),
  });
  res.end(body);
}

function sendText(res, status, text) {
  const body = Buffer.from(text, "utf8");
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": String(body.length),
    "cache-control": "no-store",
    ...cors(),
  });
  res.end(body);
}

/** 列出图库里的图（只认 <32 位十六进制>/image.png）。 */
async function listImages(dir, limit = LIST_LIMIT) {
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const rows = [];
  for (const entry of names) {
    if (!ID_RE.test(entry)) continue;
    const path = join(dir, entry, "image.png");
    try {
      const info = await stat(path);
      if (!info.isFile() || info.size < 1024) continue; // 正在写入的半成品跳过
      rows.push({ id: entry, mtime: Math.round(info.mtimeMs / 100) / 10, bytes: info.size });
    } catch {
      continue;
    }
  }
  rows.sort((a, b) => b.mtime - a.mtime);
  return rows.slice(0, limit);
}

async function readJob(dir, id) {
  try {
    const raw = JSON.parse(await readFile(join(dir, id, "job.json"), "utf8"));
    const keys = ["prompt", "negative_prompt", "width", "height", "steps", "cfg", "seed", "sampler_name"];
    const out = {};
    for (const key of keys) {
      const value = raw?.[key];
      if (value !== undefined && value !== null && value !== "") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function tokenOf(req, url) {
  const header = req.headers["x-gallery-token"];
  if (typeof header === "string" && header) return header;
  return url.searchParams.get("k") || "";
}

function serveFile(req, res, path, contentType) {
  let info;
  const ready = stat(path).then((value) => {
    info = value;
  });

  return ready
    .then(() => {
      const etag = `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
      if (req.headers["if-none-match"] === etag) {
        res.writeHead(304, { etag, ...cors() });
        res.end();
        return;
      }
      res.writeHead(200, {
        "content-type": contentType,
        "content-length": String(info.size),
        "cache-control": "private, max-age=604800, immutable",
        etag,
        ...cors(),
      });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      const stream = createReadStream(path);
      stream.on("error", () => res.destroy());
      stream.pipe(res);
    })
    .catch(() => sendText(res, 404, "not found"));
}

/** 电脑端：对外提供图库。 */
function startSource(ctx, config) {
  const dir = galleryDirOf(config);
  const token = typeof config.token === "string" ? config.token.trim() : "";
  const startPort = Number(config.port) || 8765;
  const bind = config.bind || "0.0.0.0";

  const server = createServer((req, res) => {
    handleSourceRequest(req, res, { dir, token }).catch((error) => {
      if (!res.headersSent) sendText(res, 500, String(error?.message || error));
      else res.destroy();
    });
  });

  let listening = false;
  let port = startPort;

  const attempt = (candidate, tries) => {
    const onError = (error) => {
      server.removeListener("listening", onListening);
      if (error?.code === "EADDRINUSE" && tries < 10) {
        attempt(candidate + 1, tries + 1);
        return;
      }
      warn(ctx, `图库服务启动失败（${bind}:${candidate}）：${error?.message || error}`);
    };
    const onListening = () => {
      listening = true;
      port = candidate;
      log(ctx, `图库服务已启动：http://${bind}:${port}（目录 ${dir}）`);
      if (!token) warn(ctx, "没有设置访问令牌，同一网络里的任何设备都能读取图库；建议在配置里填 token。");
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(candidate, bind);
  };

  attempt(startPort, 0);

  return () => {
    try {
      if (listening) server.close();
      else server.close();
    } catch {
      /* 已关闭 */
    }
  };
}

async function handleSourceRequest(req, res, { dir, token }) {
  const url = new URL(req.url || "/", "http://lan-gallery.local");

  if (req.method === "OPTIONS") {
    res.writeHead(204, cors());
    res.end();
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendText(res, 405, "method not allowed");
    return;
  }

  if (token && tokenOf(req, url) !== token) {
    sendText(res, 403, "缺少或错误的访问令牌");
    return;
  }

  // 直连（/i/..）和经桥接（/api/lan-gallery/i/..）走同一套路由。
  let pathname = url.pathname;
  if (pathname === API_PREFIX) pathname = "/";
  else if (pathname.startsWith(API_PREFIX + "/")) pathname = pathname.slice(API_PREFIX.length);

  if (pathname === "/api/meta" || pathname === "/meta") {
    const count = (await listImages(dir)).length;
    sendJson(res, 200, { ok: true, role: "source", count, title: "创作图库" });
    return;
  }

  if (pathname === "/api/list" || pathname === "/list") {
    sendJson(res, 200, { items: await listImages(dir), now: Date.now() / 1000 });
    return;
  }

  const imageMatch = /^\/(?:i|image)\/([0-9a-f]{32})$/.exec(pathname);
  if (imageMatch) {
    await serveFile(req, res, join(dir, imageMatch[1], "image.png"), "image/png");
    return;
  }

  const jobMatch = /^\/(?:j|job)\/([0-9a-f]{32})$/.exec(pathname);
  if (jobMatch) {
    sendJson(res, 200, await readJob(dir, jobMatch[1]));
    return;
  }

  sendText(res, 404, "not found");
}

/** 手机端：把电脑图库代理到同源路径。 */
function startBridge(ctx, config) {
  const sourceUrl = String(config.sourceUrl || "").trim().replace(/\/+$/, "");
  const token = typeof config.token === "string" ? config.token.trim() : "";

  if (!sourceUrl) {
    warn(ctx, "sourceUrl 为空，侧栏面板会提示未配置。请填入电脑的局域网地址，例如 http://10.0.0.5:8765");
    return () => {};
  }

  ctx.inject(["webServer"], (owner) => {
    owner.effect(
      () =>
        owner.webServer.register({
          kind: "prefix",
          path: API_PREFIX,
          handler: (req, res) => forward(req, res, { sourceUrl, token }),
        }),
      "lan-gallery: bridge",
    );
    log(ctx, `桥接已挂载：${API_PREFIX} → ${sourceUrl}`);
  });

  return () => {};
}

async function forward(req, res, { sourceUrl, token }) {
  const url = new URL(req.url || "/", "http://lan-gallery.local");
  // 原样保留路径：source 端同时认 /api/lan-gallery/* 与裸路径。
  const target = `${sourceUrl}${url.pathname}${url.search}`;

  try {
    const headers = { accept: req.headers.accept || "*/*" };
    if (token) headers["x-gallery-token"] = token;

    const upstream = await fetch(target, {
      method: req.method === "HEAD" ? "HEAD" : "GET",
      headers,
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
      redirect: "follow",
    });

    const passHeaders = {
      "content-type": upstream.headers.get("content-type") || "application/octet-stream",
      "cache-control": upstream.headers.get("cache-control") || "no-store",
      ...cors(),
    };
    const length = upstream.headers.get("content-length");
    if (length) passHeaders["content-length"] = length;

    if (!upstream.ok) {
      sendJson(res, upstream.status, { error: `上游返回 ${upstream.status}` });
      return;
    }

    res.writeHead(200, passHeaders);
    if (req.method === "HEAD" || !upstream.body) {
      res.end();
      return;
    }
    for await (const chunk of upstream.body) {
      if (!res.write(chunk)) {
        await new Promise((resolve) => res.once("drain", resolve));
      }
    }
    res.end();
  } catch (error) {
    const reason = error?.name === "TimeoutError" ? "连接电脑超时" : String(error?.message || error);
    sendJson(res, 502, { error: `连不上电脑图库：${reason}` });
  }
}

export function apply(ctx, config = {}) {
  const role = resolveRole(config);
  const settings = {
    ...config,
    token: typeof config.token === "string" && config.token.trim() ? config.token.trim() : "",
  };

  if (role === "source" && !settings.token) {
    // 首次运行自动生成一个令牌，避免裸奔
    settings.token = randomBytes(8).toString("hex");
    warn(ctx, `已临时生成访问令牌 ${settings.token}；把它写进配置的 token 字段，并在手机端填同一个值。`);
  }

  log(ctx, `启动角色：${role}`);

  try {
    if (role === "source") {
      ctx.effect(() => startSource(ctx, settings), "lan-gallery: source");
    } else {
      ctx.effect(() => startBridge(ctx, settings), "lan-gallery: bridge");
    }
  } catch (error) {
    // 任何异常都不许抛回 cordis，否则整个 web boot 会被判失败
    warn(ctx, `插件初始化失败，已跳过：${error && error.message ? error.message : String(error)}`);
  }
}

function resolveRole(config) {
  const explicit = String(config.role || "auto").toLowerCase();
  if (explicit === "source" || explicit === "bridge") return explicit;
  // auto：本机有图库目录就是电脑端（忽略 sourceUrl），否则当手机端
  if (existsSync(galleryDirOf(config))) return "source";
  return "bridge";
}
