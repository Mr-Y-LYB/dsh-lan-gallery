/**
 * dsh-lan-gallery · client 侧
 *
 * 往侧栏面板列表里加一项「电脑图库」，点开就是电脑那边的图。
 * 所有请求都走同源 /api/lan-gallery/*，由 host 侧的 bridge 转发到电脑，
 * 所以不碰 CORS，也不碰页面 CSP。
 *
 * 样式约束：DSH Go 内置 WebView 很旧，**不能用** grid / aspect-ratio /
 * color-mix / inset / flex-gap。这里全部用绝对定位 + float + padding-bottom。
 */

window.__ModuleLoader__.load({
  id: "dsh-lan-gallery",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const h = React.createElement;
    const { useCallback, useEffect, useRef, useState } = React;

    const API = "/api/lan-gallery";
    const POLL_MS = 4000;
    const STYLE_ID = "dsh-lan-gallery-style";
    const SOURCE_KEY = "lan-gallery-source";
    const TOKEN_KEY = "lan-gallery-token";

    /** 用 base64url 携带电脑地址，这样 <img> 请求也能带上（img 无法自定义头）。 */
    function encodeSource(value) {
      try {
        const bytes = new TextEncoder().encode(value);
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      } catch {
        return "";
      }
    }

    function storedSource() {
      try {
        return localStorage.getItem(SOURCE_KEY) || "";
      } catch {
        return "";
      }
    }

    function storedToken() {
      try {
        return localStorage.getItem(TOKEN_KEY) || "";
      } catch {
        return "";
      }
    }

    function withSource(url) {
      const parts = [];
      const source = storedSource();
      const token = storedToken();
      if (source) parts.push("s=" + encodeSource(source));
      if (token) parts.push("t=" + encodeSource(token));
      if (!parts.length) return url;
      return url + (url.includes("?") ? "&" : "?") + parts.join("&");
    }

    const CSS = `
      .lg-root{position:relative;height:100%;min-height:0;overflow:hidden;
        background:#151518;color:#e9e9ee;
        font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}

      /* ---- 顶栏 ---- */
      .lg-head{position:absolute;top:0;left:0;right:0;height:50px;z-index:20;
        background:#1b1b1f;border-bottom:1px solid #2a2a30;
        display:-webkit-box;display:flex;-webkit-box-align:center;align-items:center;padding:0 12px}
      .lg-name{font-size:15px;font-weight:600}
      .lg-badge{margin-left:8px;font-size:10.5px;line-height:17px;height:17px;padding:0 7px;
        border-radius:9px;background:#2b2b32;color:#9d9da8}
      .lg-badge.ok{background:#1b3427;color:#69cf8d}
      .lg-badge.err{background:#3a1e1e;color:#ef8b8b}
      .lg-refresh{margin-left:auto;width:30px;height:30px;border-radius:50%;padding:0;
        background:#2b2b32;border:0;color:#cfcfd8;cursor:pointer;
        display:-webkit-box;display:flex;-webkit-box-align:center;align-items:center;
        -webkit-box-pack:center;justify-content:center}

      /* ---- 网格 ---- */
      .lg-body{position:absolute;top:50px;left:0;right:0;bottom:0;overflow-y:auto;
        -webkit-overflow-scrolling:touch;padding:6px 6px 24px}
      .lg-cell{position:relative;display:block;float:left;width:32%;margin:0 2% 2% 0;height:0;
        padding-bottom:42.6%;border-radius:8px;overflow:hidden;background:#202026;cursor:pointer}
      .lg-cell:nth-child(3n){margin-right:0}
      .lg-cell img{position:absolute;top:0;left:0;width:100%;height:100%;
        object-fit:cover;display:block}
      .lg-cell .t{position:absolute;left:4px;bottom:3px;font-size:9px;line-height:14px;
        color:#fff;background:rgba(0,0,0,.5);border-radius:3px;padding:0 4px}
      @media(min-width:560px){
        .lg-cell{width:23.5%;padding-bottom:31.3%}
        .lg-cell:nth-child(3n){margin-right:2%}
        .lg-cell:nth-child(4n){margin-right:0}
      }

      /* ---- 骨架 ---- */
      .lg-skel{position:relative;display:block;float:left;width:32%;margin:0 2% 2% 0;height:0;
        padding-bottom:42.6%;border-radius:8px;background:#1f1f25;
        -webkit-animation:lgpulse 1.4s ease-in-out infinite;animation:lgpulse 1.4s ease-in-out infinite}
      .lg-skel:nth-child(3n){margin-right:0}
      @-webkit-keyframes lgpulse{0%,100%{opacity:.45}50%{opacity:1}}
      @keyframes lgpulse{0%,100%{opacity:.45}50%{opacity:1}}

      /* ---- 空态 / 错误 ---- */
      .lg-center{position:absolute;top:50%;left:0;right:0;padding:0 24px;
        -webkit-transform:translateY(-50%);transform:translateY(-50%);
        text-align:center;font-size:12.5px;line-height:1.9;color:#93939e;box-sizing:border-box}
      .lg-center b{display:block;font-size:14px;color:#d6d6de;margin-bottom:6px;font-weight:600}
      .lg-center code{font-size:11px;color:#7b7b86;word-break:break-all}
      .lg-field{display:block;width:100%;box-sizing:border-box;margin-top:10px;padding:9px 11px;
        border-radius:9px;font-size:12.5px;color:#e9e9ee;background:#1f1f25;
        border:1px solid #33333b;outline:none}
      .lg-save{display:block;width:100%;box-sizing:border-box;margin-top:8px;padding:10px;
        border-radius:9px;font-size:13px;color:#fff;background:#3b6ef0;border:0;cursor:pointer}
      .lg-hint{margin-top:10px;font-size:11px;color:#6e6e79;line-height:1.7}

      /* ---- 大图查看器 ---- */
      .lg-view{position:absolute;top:0;left:0;right:0;bottom:0;z-index:50;background:#000}
      .lg-vbar{position:absolute;top:0;left:0;right:0;height:54px;z-index:3;
        display:-webkit-box;display:flex;-webkit-box-align:center;align-items:center;
        padding:0 10px;background:#0a0a0c}
      .lg-back{width:40px;height:40px;border-radius:50%;padding:0;background:transparent;
        border:0;color:#e6e6ee;font-size:24px;line-height:1;cursor:pointer;
        display:-webkit-box;display:flex;-webkit-box-align:center;align-items:center;
        -webkit-box-pack:center;justify-content:center}
      .lg-idx{position:absolute;left:50%;-webkit-transform:translateX(-50%);transform:translateX(-50%);
        font-size:12px;color:#c5c5d0;letter-spacing:.03em}
      .lg-orig{margin-left:auto;font-size:11.5px;color:#dcdce6;background:#26262d;
        border:0;border-radius:16px;padding:7px 14px;cursor:pointer;white-space:nowrap}
      .lg-stage{position:absolute;top:54px;left:0;right:0;bottom:50px;overflow:hidden;
        padding:12px;box-sizing:border-box;
        display:-webkit-box;display:flex;-webkit-box-align:center;align-items:center;
        -webkit-box-pack:center;justify-content:center;
        -webkit-transition:bottom .22s;transition:bottom .22s}
      .lg-stage.open{bottom:50%}
      .lg-stage img{max-width:100%;max-height:100%;display:block;border-radius:2px;
        -webkit-user-select:none;user-select:none}
      .lg-nav{position:absolute;top:54px;bottom:50px;width:24%;z-index:2;border:0;padding:0;
        background:transparent;color:rgba(255,255,255,.18);font-size:26px;cursor:pointer;
        -webkit-transition:bottom .22s,color .2s;transition:bottom .22s,color .2s}
      .lg-nav.open{bottom:50%}
      .lg-nav.prev{left:0}
      .lg-nav.next{right:0}
      /* 参数条：默认一行，够松；点开才铺开提示词 */
      .lg-meta{position:absolute;left:0;right:0;bottom:0;height:50px;overflow:hidden;
        background:#0b0b0e;border-top:1px solid #1c1c22;box-sizing:border-box;
        -webkit-transition:height .22s;transition:height .22s}
      .lg-meta.open{height:50%}
      .lg-meta .row{height:49px;padding:0 15px;overflow:hidden;white-space:nowrap;
        display:-webkit-box;display:flex;-webkit-box-align:center;align-items:center;
        font-size:11px;color:#8e8e9a}
      .lg-meta .row i{font-style:normal;color:#5c5c68;margin-right:5px}
      .lg-meta .row span{margin-right:14px}
      .lg-copy{-webkit-box-flex:0;flex:none;margin-left:auto;font-size:11px;cursor:pointer;
        color:#9db8f5;background:rgba(120,150,240,.14);border:0;border-radius:12px;
        padding:6px 11px;white-space:nowrap}
      .lg-meta .toggle{-webkit-box-flex:0;flex:none;font-size:11.5px;
        color:#7f9ef0;background:transparent;border:0;padding:8px 0 8px 10px;cursor:pointer}
      .lg-meta .prompt{height:calc(100% - 49px);overflow-y:auto;box-sizing:border-box;
        -webkit-overflow-scrolling:touch;
        padding:4px 15px 22px;font-size:12px;line-height:1.8;color:#c0c0cc;
        white-space:pre-wrap;word-break:break-word}
    `;

    function ensureStyle() {
      if (typeof document === "undefined") return;
      if (document.getElementById(STYLE_ID)) return;
      const tag = document.createElement("style");
      tag.id = STYLE_ID;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    function ago(seconds) {
      const diff = Math.max(1, Math.round(Date.now() / 1000 - seconds));
      if (diff < 60) return diff + "秒";
      if (diff < 3600) return Math.round(diff / 60) + "分";
      if (diff < 86400) return Math.round(diff / 3600) + "时";
      return Math.round(diff / 86400) + "天";
    }

    function RefreshIcon() {
      return h(
        "svg",
        {
          width: 15,
          height: 15,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 2,
          strokeLinecap: "round",
          strokeLinejoin: "round",
        },
        h("path", { d: "M20 11a8 8 0 10-2.3 5.7" }),
        h("path", { d: "M20 4v7h-7" }),
      );
    }

    /**
     * 错误边界：面板内部任何渲染异常都显示在页面上，
     * 而不是让整块区域变成空白（手机上没有控制台可看）。
     */
    class PanelBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }

      static getDerivedStateFromError(error) {
        return { error };
      }

      render() {
        const error = this.state.error;
        if (error) {
          const text = error && error.message ? error.message : String(error);
          return h(
            "div",
            {
              style: {
                padding: "16px",
                font: "12px/1.7 -apple-system,sans-serif",
                color: "#ff7a7a",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              },
            },
            "面板渲染出错：",
            h("br"),
            text,
            h("br"),
            h("br"),
            h("span", { style: { opacity: 0.6 } }, "把这段文字发给助手即可定位。"),
          );
        }
        return this.props.children;
      }
    }

    /** 最外层壳：保证组件挂上后至少有一层容器。 */
    function PanelShell() {
      return h(
        "div",
        { style: { height: "100%", minHeight: 0, position: "relative" } },
        h(PanelBoundary, null, h(Panel, null)),
      );
    }

    function Panel() {
      ensureStyle();

      const [items, setItems] = useState([]);
      const [status, setStatus] = useState("loading");
      const [detail, setDetail] = useState("");
      const [active, setActive] = useState(null);
      const [job, setJob] = useState(null);
      const [showOriginal, setShowOriginal] = useState(false);
      const [metaOpen, setMetaOpen] = useState(false);
      const [copied, setCopied] = useState("");
      const [draft, setDraft] = useState(() => storedSource());
      const [draftToken, setDraftToken] = useState(() => storedToken());
      const alive = useRef(true);

      const load = useCallback(async () => {
        try {
          const response = await fetch(withSource(API + "/list"), { cache: "no-store" });
          if (!response.ok) {
            let message = "HTTP " + response.status;
            try {
              const payload = await response.json();
              if (payload && payload.error) message = payload.error;
            } catch {
              /* 保持状态码 */
            }
            throw new Error(message);
          }
          const payload = await response.json();
          if (!alive.current) return;
          setItems(Array.isArray(payload.items) ? payload.items : []);
          setStatus("ready");
          setDetail("");
        } catch (error) {
          if (!alive.current) return;
          setStatus("error");
          setDetail(String(error && error.message ? error.message : error));
        }
      }, []);

      // 必须定义在 load 之后：useCallback 的依赖数组会在渲染期求值，
      // 若 load 尚未初始化就会抛 "Cannot access 'load' before initialization"。
      const saveSource = useCallback(() => {
        const cleanSource = draft.replace(/\s+/g, "");
        const cleanToken = draftToken.replace(/\s+/g, "");
        try {
          localStorage.setItem(SOURCE_KEY, cleanSource);
          localStorage.setItem(TOKEN_KEY, cleanToken);
        } catch {
          /* 隐私模式下写不了，忽略 */
        }
        setDraft(cleanSource);
        setDraftToken(cleanToken);
        setStatus("loading");
        setDetail("");
        load();
      }, [draft, draftToken, load]);

      useEffect(() => {
        alive.current = true;
        load();
        const timer = setInterval(load, POLL_MS);
        return () => {
          alive.current = false;
          clearInterval(timer);
        };
      }, [load]);

      useEffect(() => {
        if (!active) {
          setJob(null);
          return;
        }
        let cancelled = false;
        fetch(withSource(API + "/j/" + active), { cache: "no-store" })
          .then((response) => (response.ok ? response.json() : {}))
          .then((payload) => {
            if (!cancelled) setJob(payload || {});
          })
          .catch(() => {
            if (!cancelled) setJob({});
          });
        return () => {
          cancelled = true;
        };
      }, [active]);

      const openAt = useCallback(
        (id) => {
          setShowOriginal(false);
          setMetaOpen(false);
          setActive(id);
        },
        [],
      );

      const activeIndex = active ? items.findIndex((entry) => entry.id === active) : -1;

      const step = useCallback(
        (delta) => {
          if (!items.length || activeIndex < 0) return;
          const next = (activeIndex + delta + items.length) % items.length;
          setShowOriginal(false);
          setMetaOpen(false);
          setActive(items[next].id);
        },
        [items, activeIndex],
      );

      // 折叠时只放短参数（种子太长会把按钮挤掉），展开后再补全
      const kv = [];
      if (job) {
        if (job.width) kv.push(h("span", { key: "wh" }, h("i", null, "尺寸"), job.width + "×" + job.height));
        if (job.steps) kv.push(h("span", { key: "st" }, h("i", null, "步数"), String(job.steps)));
        if (job.cfg) kv.push(h("span", { key: "cfg" }, h("i", null, "CFG"), String(job.cfg)));
        if (metaOpen) {
          if (job.seed) kv.push(h("span", { key: "sd" }, h("i", null, "种子"), String(job.seed)));
          if (job.sampler_name) kv.push(h("span", { key: "sp" }, h("i", null, "采样"), String(job.sampler_name)));
        }
      }

      /** 一键复制：提示词 + 负向 + 全部参数，直接能粘回生成器复用。 */
      const copyAll = useCallback(async () => {
        const lines = [];
        if (job && job.prompt) lines.push(String(job.prompt));
        if (job && job.negative_prompt) lines.push("", "Negative: " + job.negative_prompt);
        const facts = [];
        if (job && job.width) facts.push("尺寸 " + job.width + "×" + job.height);
        if (job && job.steps) facts.push("步数 " + job.steps);
        if (job && job.cfg) facts.push("CFG " + job.cfg);
        if (job && job.seed) facts.push("种子 " + job.seed);
        if (job && job.sampler_name) facts.push("采样 " + job.sampler_name);
        if (facts.length) lines.push("", facts.join(" · "));

        const text = lines.join("\n").trim();
        if (!text) {
          setCopied("无参数");
          setTimeout(() => setCopied(""), 1600);
          return;
        }

        let ok = false;
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            ok = true;
          }
        } catch {
          /* http 页面没有 clipboard API，走下面的回退 */
        }
        if (!ok) {
          try {
            const area = document.createElement("textarea");
            area.value = text;
            area.style.position = "fixed";
            area.style.top = "-1000px";
            area.style.opacity = "0";
            document.body.appendChild(area);
            area.select();
            ok = document.execCommand("copy");
            document.body.removeChild(area);
          } catch {
            ok = false;
          }
        }
        setCopied(ok ? "已复制" : "复制失败");
        setTimeout(() => setCopied(""), 1800);
      }, [job]);

      return h(
        "div",
        { className: "lg-root" },

        // 顶栏
        h(
          "div",
          { className: "lg-head" },
          h("span", { className: "lg-name" }, "电脑图库"),
          h(
            "span",
            {
              className:
                status === "error" ? "lg-badge err" : status === "loading" ? "lg-badge" : "lg-badge ok",
            },
            status === "error" ? "未连接" : status === "loading" ? "连接中" : items.length + " 张",
          ),
          h("button", { className: "lg-refresh", onClick: load, title: "刷新" }, h(RefreshIcon, null)),
        ),

        // 主体
        status === "error"
          ? h(
              "div",
              { className: "lg-center" },
              h("b", null, "连不上电脑图库"),
              h("code", null, detail || "请检查电脑上的图库服务是否在运行"),
              h("input", {
                className: "lg-field",
                type: "text",
                value: draft,
                placeholder: "http://10.0.0.5:8765",
                onChange: (event) => setDraft(event.target.value),
              }),
              h("input", {
                className: "lg-field",
                type: "password",
                value: draftToken,
                placeholder: "访问令牌（留空则用预置值）",
                onChange: (event) => setDraftToken(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === "Enter") saveSource();
                },
              }),
              h("button", { className: "lg-save", onClick: saveSource }, "保存并重试"),
              h("div", { className: "lg-hint" }, "地址和令牌会自动去掉多余空格。令牌留空即用内置默认值。"),
            )
          : h(
              "div",
              { className: "lg-body" },
              items.length === 0
                ? status === "loading"
                  ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((index) =>
                      h("div", { key: "sk" + index, className: "lg-skel" }),
                    )
                  : h(
                      "div",
                      { className: "lg-center" },
                      h("b", null, "还没有图"),
                      "在电脑上出一张，这里几秒后自己出现。",
                    )
                : items.map((item) =>
                    h(
                      "div",
                      {
                        key: item.id,
                        className: "lg-cell",
                        onClick: () => openAt(item.id),
                      },
                      h("img", {
                        src: withSource(API + "/t/" + item.id + ".jpg"),
                        loading: "lazy",
                        decoding: "async",
                        alt: "",
                        // 上游没有缩略图路由时（旧版 host），自动回退到原图
                        onError: (event) => {
                          const img = event.target;
                          if (!img || img.dataset.fallback) return;
                          img.dataset.fallback = "1";
                          img.src = withSource(API + "/i/" + item.id);
                        },
                      }),
                      h("span", { className: "t" }, ago(item.mtime)),
                    ),
                  ),
            ),

        // 大图
        active
          ? h(
              "div",
              { className: "lg-view" },
              h(
                "div",
                { className: "lg-vbar" },
                h("button", { className: "lg-back", onClick: () => setActive(null), title: "返回" }, "‹"),
                h(
                  "span",
                  { className: "lg-idx" },
                  (activeIndex >= 0 ? activeIndex + 1 : 1) + " / " + items.length,
                ),
                h(
                  "button",
                  {
                    className: "lg-orig",
                    onClick: () => setShowOriginal((value) => !value),
                  },
                  showOriginal ? "看缩略" : "看原图",
                ),
              ),
              h("button", { className: "lg-nav prev" + (metaOpen ? " open" : ""), onClick: () => step(-1) }, "‹"),
              h("button", { className: "lg-nav next" + (metaOpen ? " open" : ""), onClick: () => step(1) }, "›"),
              h(
                "div",
                { className: "lg-stage" + (metaOpen ? " open" : "") },
                h("img", {
                  src: withSource(
                    API +
                      (showOriginal ? "/i/" : "/t/") +
                      active +
                      (showOriginal ? "" : ".jpg"),
                  ),
                  alt: "",
                  onError: (event) => {
                    const img = event.target;
                    if (!img || img.dataset.fallback) return;
                    img.dataset.fallback = "1";
                    img.src = withSource(API + "/i/" + active);
                  },
                }),
              ),
              h(
                "div",
                { className: "lg-meta" + (metaOpen ? " open" : "") },
                h(
                  "div",
                  { className: "row" },
                  kv,
                  !kv.length && !job ? h("span", { style: { opacity: 0.55 } }, "读取参数…") : null,
                  job
                    ? h("button", { className: "lg-copy", onClick: copyAll }, copied || "复制")
                    : null,
                  job && job.prompt
                    ? h(
                        "button",
                        { className: "toggle", onClick: () => setMetaOpen((value) => !value) },
                        metaOpen ? "收起 ⌄" : "提示词 ›",
                      )
                    : null,
                ),
                metaOpen && job && job.prompt
                  ? h("div", { className: "prompt" }, String(job.prompt))
                  : null,
              ),
            )
          : null,
      );
    }

    function Icon(props) {
      const size = (props && props.size) || 16;
      return h(
        "svg",
        {
          width: size,
          height: size,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.8,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "aria-hidden": "true",
        },
        h("rect", { x: 3, y: 4, width: 18, height: 13, rx: 2 }),
        h("path", { d: "M3 13.5l4.2-3.6 3.4 3 3-2.4 4.4 3.8" }),
        h("circle", { cx: 8.2, cy: 8.4, r: 1.2 }),
        h("path", { d: "M7 20.5h10" }),
      );
    }

    // cordis 服务依赖：必须声明，否则 apply 会在 slots 就绪前被调用，
    // 面板注册直接失效（宿主里 qwen-studio 声明的是 ["slots","connection","remote"]）。
    const inject = ["slots"];

    function apply(ctx) {
      // 任何异常都不许抛回加载器：一个插件的面板挂掉，不该让整个 web boot 失败
      try {
        ensureStyle();
        ctx.slots.inject("main", () =>
          ctx.slots.register({ name: "main", key: "lan-gallery", inject: () => ({}) }, PanelShell),
        );
        ctx.slots.inject("sidebar.panellist", () =>
          ctx.slots.register(
            { name: "sidebar.panellist", id: "lan-gallery", order: 11, label: "电脑图库" },
            Icon,
          ),
        );
      } catch (error) {
        console.warn("[lan-gallery] panel registration failed:", error);
      }
    }

    exports.apply = apply;
    exports.inject = inject;
    // 仅供 test/render.mjs 直接调用组件函数体做运行期检查
    exports.__Panel = Panel;
    exports.__Shell = PanelShell;
    return module.exports;
  },
});
