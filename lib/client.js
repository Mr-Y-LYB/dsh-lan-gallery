/**
 * dsh-lan-gallery · client 侧
 *
 * 往侧栏面板列表里加一项「电脑图库」，点开就是电脑那边的图。
 * 所有请求都走同源 /api/lan-gallery/*，由 host 侧的 bridge 转发到电脑，
 * 所以不碰 CORS，也不碰页面 CSP。
 */

window.__ModuleLoader__.load({
  id: "dsh-lan-gallery",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const React = require("react");
    const h = React.createElement;
    const { useCallback, useEffect, useRef, useState } = React;

    const API = "/api/lan-gallery";
    const POLL_MS = 4000;
    const STYLE_ID = "dsh-lan-gallery-style";

    const CSS = `
      .lg-root{display:flex;flex-direction:column;height:100%;min-height:0;
        font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
      .lg-bar{display:flex;align-items:center;gap:8px;padding:10px 14px;
        border-bottom:1px solid color-mix(in srgb,currentColor 14%,transparent);flex:none}
      .lg-bar b{font-weight:600;font-size:13px}
      .lg-stat{margin-left:auto;font-size:11.5px;opacity:.62;font-variant-numeric:tabular-nums}
      .lg-btn{cursor:pointer;border-radius:6px;padding:3px 9px;font-size:11.5px;color:inherit;
        background:transparent;border:1px solid color-mix(in srgb,currentColor 22%,transparent)}
      .lg-grid{flex:1;min-height:0;overflow:auto;padding:10px;
        display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:6px;
        align-content:start;scrollbar-gutter:stable}
      .lg-cell{position:relative;aspect-ratio:3/4;border-radius:8px;overflow:hidden;cursor:pointer;
        background:color-mix(in srgb,currentColor 8%,transparent);
        border:1px solid color-mix(in srgb,currentColor 12%,transparent)}
      .lg-cell img{width:100%;height:100%;object-fit:cover;display:block}
      .lg-cell span{position:absolute;right:4px;bottom:3px;font-size:9.5px;color:#fff;
        background:#0009;border-radius:4px;padding:0 4px;backdrop-filter:blur(4px)}
      .lg-empty{padding:40px 18px;text-align:center;font-size:12.5px;opacity:.66;line-height:1.9}
      .lg-empty code{font-size:11.5px;opacity:.85}
      .lg-view{position:absolute;inset:0;z-index:30;display:flex;flex-direction:column;background:#000}
      .lg-view .top{display:flex;align-items:center;gap:8px;padding:8px 12px;color:#eee;font-size:12px;flex:none}
      .lg-view .top b{margin-right:auto;font-weight:600}
      .lg-view .top button{background:#ffffff1c;border:0;color:#fff;font-size:11.5px;padding:5px 10px;border-radius:6px;cursor:pointer}
      .lg-view .stage{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;overflow:hidden}
      .lg-view .stage img{max-width:100%;max-height:100%;object-fit:contain}
      .lg-view .meta{flex:none;max-height:38%;overflow:auto;padding:10px 14px 16px;font-size:11.5px;
        line-height:1.7;color:#b6b6bf;border-top:1px solid #ffffff14}
      .lg-view .meta i{opacity:.6;font-style:normal;margin-right:5px}
      .lg-view .meta p{margin:7px 0 0;white-space:pre-wrap;word-break:break-word}
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
      if (diff < 60) return diff + " 秒前";
      if (diff < 3600) return Math.round(diff / 60) + " 分钟前";
      if (diff < 86400) return Math.round(diff / 3600) + " 小时前";
      return Math.round(diff / 86400) + " 天前";
    }

    function Panel() {
      ensureStyle();

      const [items, setItems] = useState([]);
      const [status, setStatus] = useState("loading");
      const [detail, setDetail] = useState("");
      const [active, setActive] = useState(null);
      const [job, setJob] = useState(null);
      const alive = useRef(true);

      const load = useCallback(async () => {
        try {
          const response = await fetch(API + "/list", { cache: "no-store" });
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
        fetch(API + "/j/" + active, { cache: "no-store" })
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

      const meta = [];
      if (job) {
        if (job.width) meta.push(h("span", null, h("i", null, "尺寸"), job.width + "×" + job.height));
        if (job.steps) meta.push(h("span", null, h("i", null, "步数"), String(job.steps)));
        if (job.cfg) meta.push(h("span", null, h("i", null, "CFG"), String(job.cfg)));
        if (job.seed) meta.push(h("span", null, h("i", null, "种子"), String(job.seed)));
      }

      return h(
        "div",
        { className: "lg-root" },
        h(
          "div",
          { className: "lg-bar" },
          h("b", null, "电脑图库"),
          h(
            "button",
            { className: "lg-btn", onClick: load, title: "立即刷新" },
            "刷新",
          ),
          h(
            "span",
            { className: "lg-stat" },
            status === "loading" ? "连接中…" : status === "error" ? "连不上" : items.length + " 张",
          ),
        ),

        status === "error"
          ? h(
              "div",
              { className: "lg-empty" },
              "连不上电脑图库。",
              h("br"),
              h("code", null, detail || "请检查电脑端插件是否在跑"),
              h("br"),
              "在 cordis.patch.yml 里把 ",
              h("code", null, "sourceUrl"),
              " 填成电脑的局域网地址，例如 ",
              h("code", null, "http://10.0.0.5:8765"),
              "，并保证 ",
              h("code", null, "token"),
              " 与电脑端一致。",
            )
          : items.length === 0
            ? h(
                "div",
                { className: "lg-empty" },
                status === "loading" ? "正在读取…" : "电脑那边还没有图。",
                h("br"),
                "在电脑上出一张，这里几秒后自己出现。",
              )
            : h(
                "div",
                { className: "lg-grid" },
                items.map((item) =>
                  h(
                    "div",
                    {
                      key: item.id,
                      className: "lg-cell",
                      onClick: () => setActive(item.id),
                      title: item.id.slice(0, 8),
                    },
                    h("img", {
                      src: API + "/i/" + item.id,
                      loading: "lazy",
                      decoding: "async",
                      alt: "",
                    }),
                    h("span", null, ago(item.mtime)),
                  ),
                ),
              ),

        active
          ? h(
              "div",
              { className: "lg-view" },
              h(
                "div",
                { className: "top" },
                h("b", null, active.slice(0, 8)),
                h("button", { onClick: () => setActive(null) }, "关闭"),
              ),
              h(
                "div",
                { className: "stage" },
                h("img", { src: API + "/i/" + active, alt: "" }),
              ),
              h(
                "div",
                { className: "meta" },
                meta.length ? h("div", null, meta) : null,
                job && job.prompt ? h("p", null, String(job.prompt)) : null,
                !job ? h("span", { style: { opacity: 0.6 } }, "读取记录…") : null,
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

    function apply(ctx) {
      ensureStyle();
      ctx.slots.inject("main", () =>
        ctx.slots.register({ name: "main", key: "lan-gallery", inject: () => ({}) }, Panel),
      );
      ctx.slots.inject("sidebar.panellist", () =>
        ctx.slots.register(
          { name: "sidebar.panellist", id: "lan-gallery", order: 11, label: "电脑图库" },
          Icon,
        ),
      );
    }

    exports.apply = apply;
    return module.exports;
  },
});
