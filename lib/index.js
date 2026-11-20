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
import { execFile } from "node:child_process";
import { createReadStream, existsSync, readdirSync } from "node:fs";
import { mkdir, readdir, readFile, rename, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createServer } from "node:http";

const execFileAsync = promisify(execFile);

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
    pythonPath: z.string().default(""),
    thumbSize: z.natural().default(512),
  });
} catch {
  Config = undefined;
}
export { Config };

const ID_RE = /^[0-9a-f]{32}$/;
const API_PREFIX = "/api/lan-gallery";
const LIST_LIMIT = 400;
const FORWARD_TIMEOUT_MS = 20000;

/**
 * 手机端桥接的兜底令牌：仓库里预填的就是这台电脑图库服务的令牌。
 * 配置里有值就以配置为准；面板里填了令牌则面板优先。
 */
const DEFAULT_BRIDGE_TOKEN = "PdO4zVIZqf45-nZ1";

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

/**
 * 缩略图：缓存优先 -> 调本机 Python(Pillow) 生成 512px JPEG -> 才回退原图。
 * 原图动辄 1-2MB，123 张一次性加载手机扛不住，必须走缩略图。
 */
async function serveThumb(req, res, { dir, id, pythonPath, thumbSize }) {
  const src = join(dir, id, "image.png");
  if (!existsSync(src)) {
    sendText(res, 404, "not found");
    return;
  }

  const thumbDir = join(dirname(dir), ".thumbs");
  const cached = join(thumbDir, `${id}.jpg`);
  if (existsSync(cached)) {
    await serveFile(req, res, cached, "image/jpeg");
    return;
  }

  if (pythonPath && existsSync(pythonPath)) {
    try {
      const script = fileURLToPath(new URL("../backend/thumb.py", import.meta.url));
      if (existsSync(script)) {
        await mkdir(thumbDir, { recursive: true });
        await execFileAsync(pythonPath, [script, src, cached, String(thumbSize)], {
          timeout: 25000,
          windowsHide: true,
        });
        if (existsSync(cached)) {
          await serveFile(req, res, cached, "image/jpeg");
          return;
        }
      }
    } catch {
      /* 生成失败就回退原图 */
    }
  }

  await serveFile(req, res, src, "image/png");
}

/** 电脑端：对外提供图库。 */
function startSource(ctx, config) {
  const dir = galleryDirOf(config);
  const token = typeof config.token === "string" ? config.token.trim() : "";
  const startPort = Number(config.port) || 8765;
  const bind = config.bind || "0.0.0.0";

  const server = createServer((req, res) => {
    handleSourceRequest(req, res, {
      dir,
      token,
      pythonPath: typeof config.pythonPath === "string" ? config.pythonPath.trim() : "",
      thumbSize: Number(config.thumbSize) || 512,
    }).catch((error) => {
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

async function handleSourceRequest(req, res, { dir, token, pythonPath, thumbSize }) {
  const url = new URL(req.url || "/", "http://lan-gallery.local");

  if (req.method === "OPTIONS") {
    res.writeHead(204, cors());
    res.end();
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    // 删除走单独分支，这里只放行 GET/HEAD
    const delMatch = /^\/(?:d|delete)\/([0-9a-f]{32})$/.exec(
      (() => {
        let p = url.pathname;
        if (p.startsWith(API_PREFIX)) p = p.slice(API_PREFIX.length) || "/";
        return p;
      })(),
    );
    if (delMatch && (req.method === "DELETE" || req.method === "POST")) {
      if (token && tokenOf(req, url) !== token) {
        sendText(res, 403, "缺少或错误的访问令牌");
        return;
      }
      const id = delMatch[1];
      const root = dirname(dir);
      const trashDir = join(root, "trash");
      try {
        await mkdir(trashDir, { recursive: true });
        await rename(join(dir, id), join(trashDir, id));
        sendJson(res, 200, { ok: true, moved: join(trashDir, id) });
      } catch (error) {
        sendJson(res, 500, { error: String(error?.message || error) });
      }
      return;
    }
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

  // 缩略图：优先用本机 Python(Pillow) 生成真正的 512px JPEG（约 50KB），
  // 没配 pythonPath 或生成失败时才回退成原图。
  const thumbMatch = /^\/(?:t|thumb)\/([0-9a-f]{32})(?:\.jpg)?$/.exec(pathname);
  if (thumbMatch) {
    await serveThumb(req, res, {
      dir,
      id: thumbMatch[1],
      pythonPath,
      thumbSize,
    });
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
  const token = String(config.token || "").trim() || DEFAULT_BRIDGE_TOKEN;

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

/** base64url → 文本（不限制内容）。 */
function decodeText(value) {
  if (!value) return "";
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    return Buffer.from(padded, "base64").toString("utf8");
  } catch {
    return "";
  }
}

/** 面板可以用 ?s=<base64url> 临时覆盖电脑地址，避免改配置。 */
function decodeSource(value) {
  // 去掉所有空白：手机上输入地址时很容易在冒号/斜杠后多打一个空格
  const text = decodeText(value).replace(/\s+/g, "");
  return /^https?:\/\//i.test(text) ? text : "";
}

/** 归一化地址：去空白、去尾部斜杠。 */
function normalizeBase(value) {
  return String(value || "").replace(/\s+/g, "").replace(/\/+$/, "");
}

async function forward(req, res, { sourceUrl, token }) {
  const url = new URL(req.url || "/", "http://lan-gallery.local");
  const override = decodeSource(url.searchParams.get("s"));
  const overrideToken = decodeText(url.searchParams.get("t")).trim();
  const base = normalizeBase(override || sourceUrl);
  const effectiveToken = overrideToken || token;

  if (!base) {
    sendJson(res, 400, { error: "未配置电脑地址：在面板里填一次，或写进插件配置的 sourceUrl" });
    return;
  }

  if (!effectiveToken) {
    // 明确告诉客户端是缺令牌，而不是笼统的 403
    sendJson(res, 401, { error: "缺少访问令牌：请在面板里填电脑的令牌" });
    return;
  }

  // 原样保留路径：source 端同时认 /api/lan-gallery/* 与裸路径。
  const target = `${base}${url.pathname}${url.search}`;

  try {
    const headers = { accept: req.headers.accept || "*/*" };
    if (effectiveToken) headers["x-gallery-token"] = effectiveToken;

    const upstream = await fetch(target, {
      // 删除需要透传方法，其余按只读处理
      method: ["GET", "HEAD", "DELETE", "POST"].includes(req.method || "")
        ? req.method
        : "GET",
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

  // auto：只有「本机图库里确实有图」才当电脑端。
  // 手机上装过 dsh-spicy 时图库目录可能存在但是空的，不能凭目录存在与否判断。
  const dir = galleryDirOf(config);
  try {
    if (existsSync(dir) && readdirSync(dir).some((name) => ID_RE.test(name))) return "source";
  } catch {
    /* 读不了就按手机端处理 */
  }
  return "bridge";
}
