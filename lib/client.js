/**
 * dsh-lan-gallery · client 侧（Material Design 3 布局）
 *
 * 往侧栏面板列表里加一项「电脑图库」，点开就是电脑那边的图。
 * 所有请求都走同源 /api/lan-gallery/*，由 host 侧的 bridge 转发到电脑。
 *
 * 样式约束：DSH Go 内置 WebView 很旧，**不能用** grid / aspect-ratio /
 * color-mix / inset / flex-gap。这里全部用绝对定位 + float + padding-bottom，
 * 配色写死成 MD3 深色主题的十六进制值。
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

    /* ---------------- Material Design 3 · 深色主题 ---------------- */
    const CSS = `
      .lg-root{position:relative;height:100%;min-height:0;overflow:hidden;
        background:#141218;color:#E6E0E9;
        font:14px/1.5 "Roboto","Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif;
        -webkit-font-smoothing:antialiased}

      /* ---- Top app bar ---- */
      .lg-head{position:absolute;top:0;left:0;right:0;height:64px;z-index:20;
        background:#1B1B1F;padding:0 8px 0 16px;box-sizing:border-box;
        display:-webkit-box;display:flex;-webkit-box-align:center;align-items:center}
      .lg-name{font-size:20px;font-weight:500;letter-spacing:.01em;color:#E6E0E9}
      .lg-badge{margin-left:10px;font-size:11px;font-weight:500;line-height:18px;height:18px;
        padding:0 8px;border-radius:9px;background:#4F378B;color:#EADDFF}
      .lg-badge.err{background:#93000A;color:#FFDAD6}
      .lg-badge.wait{background:#36343B;color:#CAC4D0}
      .lg-act{width:48px;height:48px;border-radius:50%;background:transparent;border:0;
        color:#CAC4D0;cursor:pointer;margin-left:auto;padding:0;
        display:-webkit-box;display:flex;-webkit-box-align:center;align-items:center;
        -webkit-box-pack:center;justify-content:center}
      .lg-act:active{background:rgba(208,188,255,.14)}

      /* ---- 网格 ---- */
      .lg-body{position:absolute;top:64px;left:0;right:0;bottom:0;overflow-y:auto;
        -webkit-overflow-scrolling:touch;padding:8px 8px 88px;box-sizing:border-box}
      .lg-cell{position:relative;display:block;float:left;width:31.5%;margin:0 2.75% 2.75% 0;
        height:0;padding-bottom:42%;border-radius:12px;overflow:hidden;
        background:#2B2930;cursor:pointer}
      .lg-cell:nth-child(3n){margin-right:0}
      .lg-cell img{position:absolute;top:0;left:0;width:100%;height:100%;
        object-fit:cover;display:block}
      .lg-cell .t{position:absolute;left:5px;bottom:5px;font-size:10px;line-height:16px;
        padding:0 6px;border-radius:8px;background:rgba(0,0,0,.62);color:#E6E0E9}
      @media(min-width:560px){
        .lg-cell{width:23.1%;padding-bottom:30.8%}
        .lg-cell:nth-child(3n){margin-right:2.75%}
        .lg-cell:nth-child(4n){margin-right:0}
      }

      /* ---- 骨架 ---- */
      .lg-skel{position:relative;display:block;float:left;width:31.5%;margin:0 2.75% 2.75% 0;
        height:0;padding-bottom:42%;border-radius:12px;background:#211F26;
        -webkit-animation:lgp 1.4s ease-in-out infinite;animation:lgp 1.4s ease-in-out infinite}
      .lg-skel:nth-child(3n){margin-right:0}
      @-webkit-keyframes lgp{0%,100%{opacity:.45}50%{opacity:.9}}
      @keyframes lgp{0%,100%{opacity:.45}50%{opacity:.9}}

      /* ---- FAB ---- */
      .lg-fab{position:absolute;right:16px;bottom:16px;width:56px;height:56px;z-index:15;
        border-radius:16px;border:0;background:#4F378B;color:#EADDFF;cursor:pointer;padding:0;
        -webkit-box-shadow:0 4px 12px rgba(0,0,0,.4);box-shadow:0 4px 12px rgba(0,0,0,.4);
        display:-webkit-box;display:flex;-webkit-box-align:center;align-items:center;
        -webkit-box-pack:center;justify-content:center}
      .lg-fab:active{background:#634F9B}

      /* ---- 空态 / 错误 ---- */
      .lg-center{position:absolute;top:50%;left:0;right:0;padding:0 24px;box-sizing:border-box;
        -webkit-transform:translateY(-50%);transform:translateY(-50%);
        text-align:center;font-size:14px;line-height:1.7;color:#CAC4D0}
      .lg-center b{display:block;font-size:18px;font-weight:500;color:#E6E0E9;margin-bottom:8px}
      .lg-center code{font-size:12px;color:#938F99;word-break:break-all}
      .lg-field{display:block;width:100%;box-sizing:border-box;margin-top:12px;
        padding:14px 16px;border-radius:12px;font-size:14px;color:#E6E0E9;
        background:#211F26;border:1px solid #938F99;outline:none}
      .lg-save{display:block;width:100%;box-sizing:border-box;margin-top:12px;padding:14px;
        border-radius:20px;font-size:14px;font-weight:500;color:#381E72;background:#D0BCFF;
        border:0;cursor:pointer}
      .lg-hint{margin-top:12px;font-size:12px;color:#938F99;line-height:1.6}

      /* ---- 大图 ---- */
      .lg-view{position:absolute;top:0;left:0;right:0;bottom:0;z-index:50;background:#0B0A0D}
      .lg-vbar{position:absolute;top:0;left:0;right:0;height:64px;z-index:3;
        background:rgba(27,27,31,.96);padding:0 4px;box-sizing:border-box;
        display:-webkit-box;display:flex;-webkit-box-align:center;align-items:center}
      .lg-icon{width:48px;height:48px;border-radius:50%;background:transparent;border:0;
        color:#E6E0E9;font-size:22px;line-height:1;cursor:pointer;padding:0;
        display:-webkit-box;display:flex;-webkit-box-align:center;align-items:center;
        -webkit-box-pack:center;justify-content:center}
      .lg-icon:active{background:rgba(230,224,233,.12)}
      .lg-icon.danger{color:#FFB4AB}
      .lg-idx{position:absolute;left:50%;-webkit-transform:translateX(-50%);
        transform:translateX(-50%);font-size:13px;color:#CAC4D0}
      .lg-orig{margin-left:auto;margin-right:4px;font-size:12px;font-weight:500;
        color:#381E72;background:#D0BCFF;border:0;border-radius:16px;padding:8px 16px;
        cursor:pointer;white-space:nowrap}

      .lg-stage{position:absolute;top:64px;left:0;right:0;bottom:64px;padding:8px;
        box-sizing:border-box;overflow:hidden;
        display:-webkit-box;display:flex;-webkit-box-align:center;align-items:center;
        -webkit-box-pack:center;justify-content:center;
        -webkit-transition:bottom .25s ease;transition:bottom .25s ease}
      .lg-stage.open{bottom:45%}
      /* 只有一个 img：缩略图 -> 原图 靠切 src 完成，不存在两层错位 */
      .lg-stage img{max-width:100%;max-height:100%;display:block;border-radius:8px;
        -webkit-user-select:none;user-select:none}
      .lg-nav{position:absolute;top:64px;bottom:64px;width:22%;z-index:2;border:0;padding:0;
        background:transparent;color:rgba(230,224,233,.22);font-size:26px;cursor:pointer;
        -webkit-transition:bottom .25s ease;transition:bottom .25s ease}
      .lg-nav.open{bottom:45%}
      .lg-nav.prev{left:0}
      .lg-nav.next{right:0}

      /* ---- MD3 对话框（替代原生 confirm） ---- */
      .lg-scrim{position:absolute;top:0;left:0;right:0;bottom:0;z-index:80;
        background:rgba(0,0,0,.62);padding:24px;box-sizing:border-box;
        display:-webkit-box;display:flex;-webkit-box-align:center;align-items:center;
        -webkit-box-pack:center;justify-content:center}
      .lg-dialog{width:100%;max-width:330px;background:#2B2930;border-radius:28px;
        padding:24px;box-sizing:border-box;
        -webkit-box-shadow:0 8px 28px rgba(0,0,0,.5);box-shadow:0 8px 28px rgba(0,0,0,.5)}
      .lg-dialog h3{margin:0 0 14px;font-size:20px;font-weight:500;color:#E6E0E9;line-height:1.4}
      .lg-dialog p{margin:0 0 22px;font-size:14px;line-height:1.6;color:#CAC4D0}
      .lg-dialog .acts{text-align:right;font-size:0}
      .lg-dialog .acts button{background:transparent;border:0;font-size:14px;font-weight:500;
        padding:10px 16px;border-radius:20px;cursor:pointer;color:#D0BCFF;margin-left:6px}
      .lg-dialog .acts button.danger{color:#FFB4AB}
      .lg-dialog .acts button:active{background:rgba(208,188,255,.12)}

      /* ---- Bottom sheet ---- */
      .lg-meta{position:absolute;left:0;right:0;bottom:0;height:64px;overflow:hidden;
        background:#211F26;border-top-left-radius:20px;border-top-right-radius:20px;
        -webkit-transition:height .25s ease;transition:height .25s ease}
      .lg-meta.open{height:45%}
      .lg-meta .row{height:63px;padding:0 16px;overflow:hidden;white-space:nowrap;
        display:-webkit-box;display:flex;-webkit-box-align:center;align-items:center;
        font-size:12px;color:#CAC4D0}
      .lg-meta .row i{font-style:normal;color:#938F99;margin-right:5px}
      .lg-meta .row span{margin-right:14px}
      .lg-copy{-webkit-box-flex:0;flex:none;margin-left:auto;font-size:12px;font-weight:500;
        cursor:pointer;color:#381E72;background:#D0BCFF;border:0;border-radius:16px;
        padding:8px 14px;white-space:nowrap}
      .lg-meta .toggle{-webkit-box-flex:0;flex:none;font-size:12px;font-weight:500;
        color:#D0BCFF;background:transparent;border:0;padding:10px 0 10px 12px;cursor:pointer}
      /* 用绝对定位代替 calc()：旧 WebView 对 calc 支持不可靠 */
      .lg-meta .prompt{position:absolute;top:63px;left:0;right:0;bottom:0;
        overflow-y:auto;box-sizing:border-box;-webkit-overflow-scrolling:touch;
        padding:4px 16px 24px;font-size:13px;line-height:1.75;color:#CAC4D0;
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

    function RefreshIcon({ size = 22 }) {
      return h(
        "svg",
        {
          width: size, height: size, viewBox: "0 0 24 24", fill: "none",
          stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round",
        },
        h("path", { d: "M20 11a8 8 0 10-2.3 5.7" }),
        h("path", { d: "M20 4v7h-7" }),
      );
    }

    function TrashIcon({ size = 22 }) {
      return h(
        "svg",
        {
          width: size, height: size, viewBox: "0 0 24 24", fill: "none",
          stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round",
        },
        h("path", { d: "M4 7h16" }),
        h("path", { d: "M10 11v6M14 11v6" }),
        h("path", { d: "M6 7l1 13h10l1-13" }),
        h("path", { d: "M9 7V4h6v3" }),
      );
    }

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
                font: "13px/1.7 -apple-system,sans-serif",
                color: "#FFB4AB",
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
      const [showOriginal, setShowOriginal] = useState(true);
      const [metaOpen, setMetaOpen] = useState(false);
      const [copied, setCopied] = useState("");
      const [viewSrc, setViewSrc] = useState("");
      const [confirming, setConfirming] = useState(false);
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

      // 必须定义在 load 之后：useCallback 的依赖数组会在渲染期求值。
      const saveSource = useCallback(() => {
        const cleanSource = draft.replace(/\s+/g, "");
        const cleanToken = draftToken.replace(/\s+/g, "");
        try {
          localStorage.setItem(SOURCE_KEY, cleanSource);
          localStorage.setItem(TOKEN_KEY, cleanToken);
        } catch {
          /* 隐私模式下写不了 */
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

      /**
       * 大图加载：同一个 <img> 先显示缩略图，原图预加载完成后切换 src。
       * 不用两层元素——旧 WebView 里两层会各算各的尺寸，最终并排显示。
       */
      useEffect(() => {
        if (!active) {
          setViewSrc("");
          return;
        }
        setViewSrc(withSource(API + "/t/" + active + ".jpg"));
        if (!showOriginal) return;
        let cancelled = false;
        const pre = new Image();
        pre.onload = () => {
          if (!cancelled) setViewSrc(withSource(API + "/i/" + active));
        };
        pre.src = withSource(API + "/i/" + active);
        return () => {
          cancelled = true;
        };
      }, [active, showOriginal]);

      const openAt = useCallback((id) => {
        setShowOriginal(true);
        setMetaOpen(false);
        setCopied("");
        setActive(id);
      }, []);

      const activeIndex = active ? items.findIndex((entry) => entry.id === active) : -1;

      const step = useCallback(
        (delta) => {
          if (!items.length || activeIndex < 0) return;
          const next = (activeIndex + delta + items.length) % items.length;
          setShowOriginal(true);
          setMetaOpen(false);
          setActive(items[next].id);
        },
        [items, activeIndex],
      );

      /** 删除：先弹 MD3 确认框，确认后才真正调用接口。 */
      const removeActive = useCallback(() => {
        if (active) setConfirming(true);
      }, [active]);

      const doDelete = useCallback(async () => {
        if (!active) return;
        setConfirming(false);
        try {
          const response = await fetch(withSource(API + "/d/" + active), {
            method: "DELETE",
          });
          if (!response.ok) throw new Error("HTTP " + response.status);
          setActive(null);
          setItems((list) => list.filter((entry) => entry.id !== active));
        } catch (error) {
          setCopied("删除失败");
          setTimeout(() => setCopied(""), 1800);
        }
      }, [active]);

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
          /* http 页面没有 clipboard API */
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

        h(
          "div",
          { className: "lg-head" },
          h("span", { className: "lg-name" }, "电脑图库"),
          h(
            "span",
            {
              className:
                status === "error"
                  ? "lg-badge err"
                  : status === "loading"
                    ? "lg-badge wait"
                    : "lg-badge",
            },
            status === "error" ? "未连接" : status === "loading" ? "连接中" : items.length + " 张",
          ),
        ),

        status === "error"
          ? h(
              "div",
              { className: "lg-center" },
              h("b", null, "连不上电脑图库"),
              h("code", null, detail || "检查电脑上的图库服务是否在运行"),
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
                placeholder: "访问令牌（可留空）",
                onChange: (event) => setDraftToken(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === "Enter") saveSource();
                },
              }),
              h("button", { className: "lg-save", onClick: saveSource }, "保存并重试"),
              h("div", { className: "lg-hint" }, "地址和令牌会自动去掉多余空格。"),
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
                      { key: item.id, className: "lg-cell", onClick: () => openAt(item.id) },
                      h("img", {
                        src: withSource(API + "/t/" + item.id + ".jpg"),
                        loading: "lazy",
                        decoding: "async",
                        alt: "",
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

        status === "error"
          ? null
          : h(
              "button",
              { className: "lg-fab", onClick: load, title: "刷新" },
              h(RefreshIcon, { size: 24 }),
            ),

        active
          ? h(
              "div",
              { className: "lg-view" },
              h(
                "div",
                { className: "lg-vbar" },
                h("button", { className: "lg-icon", onClick: () => setActive(null) }, "‹"),
                h(
                  "span",
                  { className: "lg-idx" },
                  (activeIndex >= 0 ? activeIndex + 1 : 1) + " / " + items.length,
                ),
                h(
                  "button",
                  { className: "lg-orig", onClick: () => setShowOriginal((value) => !value) },
                  showOriginal ? "省流" : "高清",
                ),
                h(
                  "button",
                  { className: "lg-icon danger", onClick: removeActive, title: "删除" },
                  h(TrashIcon, null),
                ),
              ),
              h("button", { className: "lg-nav prev" + (metaOpen ? " open" : ""), onClick: () => step(-1) }, "‹"),
              h("button", { className: "lg-nav next" + (metaOpen ? " open" : ""), onClick: () => step(1) }, "›"),
              h(
                "div",
                {
                  className: "lg-stage" + (metaOpen ? " open" : ""),
                  // 提示词展开时，点图片区域即可收起（不用去找那个小按钮）
                  onClick: () => {
                    if (metaOpen) setMetaOpen(false);
                  },
                },
                viewSrc ? h("img", { src: viewSrc, alt: "" }) : null,
              ),
              h(
                "div",
                { className: "lg-meta" + (metaOpen ? " open" : "") },
                h(
                  "div",
                  { className: "row" },
                  kv,
                  !kv.length && !job ? h("span", { style: { opacity: 0.55 } }, "读取参数…") : null,
                  job ? h("button", { className: "lg-copy", onClick: copyAll }, copied || "复制") : null,
                  job && job.prompt
                    ? h(
                        "button",
                        { className: "toggle", onClick: () => setMetaOpen((value) => !value) },
                        metaOpen ? "收起" : "提示词",
                      )
                    : null,
                ),
                metaOpen && job && job.prompt ? h("div", { className: "prompt" }, String(job.prompt)) : null,
              ),
            )
          : null,

        // MD3 对话框：替代原生 confirm（原生弹窗无法改样式）
        confirming
          ? h(
              "div",
              {
                className: "lg-scrim",
                onClick: (event) => {
                  if (event.target === event.currentTarget) setConfirming(false);
                },
              },
              h(
                "div",
                { className: "lg-dialog" },
                h("h3", null, "删除这张图？"),
                h("p", null, "会移到电脑图库的回收目录，之后可以恢复。"),
                h(
                  "div",
                  { className: "acts" },
                  h("button", { onClick: () => setConfirming(false) }, "取消"),
                  h("button", { className: "danger", onClick: doDelete }, "删除"),
                ),
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
          width: size, height: size, viewBox: "0 0 24 24", fill: "none",
          stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round",
          "aria-hidden": "true",
        },
        h("rect", { x: 3, y: 4, width: 18, height: 13, rx: 2 }),
        h("path", { d: "M3 13.5l4.2-3.6 3.4 3 3-2.4 4.4 3.8" }),
        h("circle", { cx: 8.2, cy: 8.4, r: 1.2 }),
        h("path", { d: "M7 20.5h10" }),
      );
    }

    const inject = ["slots"];

    function apply(ctx) {
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
    exports.__Panel = Panel;
    exports.__Shell = PanelShell;
    return module.exports;
  },
});
