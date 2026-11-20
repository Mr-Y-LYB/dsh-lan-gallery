# dsh-lan-gallery

在**手机上的 DeepSeek Harness** 侧栏里，直接看**电脑上出的图**。

一个包，两种角色：

| 角色 | 装在哪 | 做什么 |
|---|---|---|
| `source` | 电脑（DSH Desktop / `dsh web`） | 把本机创作图库对外提供：自己起一个 HTTP 服务，绑 `0.0.0.0`，手机才连得上 |
| `bridge` | 手机（DSH Go 等移动端 DSH） | 把电脑图库代理到自己的同源路径 `/api/lan-gallery/*`，侧栏多一项「电脑图库」 |

两种角色都由同一个包提供，用配置里的 `role` 切换（默认 `auto`：填了 `sourceUrl` 就是手机端，没填就是电脑端）。

## 为什么需要它

手机上那个 DSH 和电脑上的 DSH 是**两个独立实例**：

- 手机实例的图库在手机自己的文件系统里，跟电脑的 `~/.dsh/qwen-studio/images` 不是一份；
- 出图插件（如 `dsh-qwen-studio` / DSH-Spicy）的界面声明 `platform: "web"`，只往**网页界面**的侧栏注入面板，手机原生界面看不到；
- DSH 的 web 服务只绑 `127.0.0.1`，并且明确拒绝绑 `0.0.0.0`（源码原话：*binding every interface would expose remote code execution to the network*），还带 Host/Origin 栅栏与会话 cookie 的 authority 绑定 —— 手机直连必然 401。

所以正确做法不是"给手机再装一个出图插件"，而是**让手机的 DSH 去读电脑那份图库**。本插件就是这条链路：电脑端开一个只读的图库口，手机端在侧栏把它显示出来。

## 安全边界

- 图库服务**只读**：只认 `<32位十六进制>/image.png` 与 `job.json`，没有任何写操作。
- 支持访问令牌 `token`：电脑端校验 `x-gallery-token` 或 `?k=`，手机端自动带上。
- 电脑端默认绑 `0.0.0.0`，也就是**同一局域网内可达**。请务必设置 `token`，不要在公共 Wi-Fi 下长期开着。
- 手机端不直接跨域访问电脑，所有请求走同源 `/api/lan-gallery/*`，因此不受页面 CSP 限制。

## 安装

### 电脑端（DSH Desktop）

桌面版的 `desktop` profile 由 Electron 独占管理，**命令行装会被拒绝**（`profile "desktop" is managed exclusively by the Electron application`）。请在应用里装：

1. 侧栏 → **插件** → **添加插件**
2. 包名或地址填：`github:<你的用户名>/dsh-lan-gallery`
3. 安装后**彻底退出并重开** DeepSeek Harness（host 侧只在启动时挂载）

命令行安装只适用于 `web` profile：

```sh
dsh plugin --profile web add github:<你的用户名>/dsh-lan-gallery
```

### 手机端（DSH Go）

DSH Go 的插件页只认**市场索引**，没有"填包名/地址"的入口，所以要用**自定义索引源**：

1. `设置 › 插件 › 插件市场` → 底部「**添加索引源**」
2. 填入这个 JSON 的 URL（把主机换成运行图库服务的那台电脑）：

   ```
   http://26.72.39.30:8765/index.json
   ```

   也可以托管在 GitHub / jsDelivr 上，格式见仓库根目录的 `index.json`（遵循 `@deepseek-ai/dsh-plugin-market-index` 的 format 1）。
3. 添加后到「发现」页签，能看到「**电脑图库**」，点「安装到…」
4. 装完重启引擎

> 安装源是 `git+https://github.com/<owner>/<repo>.git#<commit>`，安装时手机会直接访问 GitHub，需要手机能连上 github.com。

## 配置

配置写在 profile 的 `cordis.patch.yml`。装完插件后追加：

> **开箱默认值**：包内 `cordis.patch.yml` 已经写好 `role: auto`。插件启动时判断——本机存在图库目录（`~/.dsh/qwen-studio/images`）就当**电脑端**（忽略下面这些手机端字段），否则当**手机端**。所以同一个包两端都装，不用改角色。
> 仓库里预填的 `sourceUrl` / `token` 是本机自用值，换设备或换网络时改这两行即可；如果不想用密码，把两边 `token` 都留空（那样同网任何设备都能读图库）。

### 电脑端

```yaml
- id: lan-gallery
  name: dsh-lan-gallery
  config:
    role: source
    port: 8765
    bind: "0.0.0.0"
    token: "换成你自己的随机串"
    # 默认读 ~/.dsh/qwen-studio/images，可改：
    # galleryDir: "C:/Users/you/.dsh/qwen-studio/images"
```

启动日志会打印实际监听地址（端口被占用会自动往后试 10 个）。

### 手机端

```yaml
- id: lan-gallery
  name: dsh-lan-gallery
  config:
    role: bridge
    sourceUrl: "http://10.253.77.216:8765"   # 换成你电脑的局域网地址
    token: "与电脑端完全一致"
    title: "电脑图库"
    order: 11
```

`order` 决定它排在侧栏面板列表的第几位（`dsh-qwen-studio` 的「创作」是 10）。

## 用法

装好并重启后：

1. 手机 DSH 侧栏 → **电脑图库**
2. 网格里是电脑图库的全部图，按时间倒序
3. 点任意一张看原图与生成参数（尺寸、步数、CFG、种子、提示词）
4. 电脑那边出一张新图，面板每 4 秒自动刷新，新图自己冒出来

## 接口

电脑端（`source`）与手机端（`bridge`）路径一致：

| 路径 | 说明 |
|---|---|
| `GET /api/lan-gallery/meta` | 探活，返回张数 |
| `GET /api/lan-gallery/list` | 图片列表 `{items:[{id,mtime,bytes}], now}` |
| `GET /api/lan-gallery/i/<id>` | 原图 PNG（带 ETag / 强缓存） |
| `GET /api/lan-gallery/j/<id>` | 生成参数摘要 |

直连电脑时也可以去掉前缀：`/api/list`、`/i/<id>`、`/j/<id>`。

## 已知限制

- **没有服务端缩略图**。为了零依赖（不引入 sharp / Pillow），网格直接取原图，靠 `loading="lazy"` 只加载可见的那几张。局域网下体验没问题；走 VPN 弱网时会偏慢。后续可以加可选缩略图。
- 面板是 web client 插件，**只在 DSH 的网页界面里出现**。DSH Go 的「原生界面」模式下看不到，需要切到网页模式。
- 依赖 DSH 的 `sidebar.panellist` 与 `main` 两个插槽。上游若改名，插件要跟着改。

## 冒烟测试

不需要 DSH 也能验：

```sh
node test/smoke.mjs    # 电脑端 source：7 项
node test/bridge.mjs   # 手机端 bridge 转发：4 项
```

## 故障排查

| 现象 | 原因 |
|---|---|
| 面板显示「连不上电脑图库」 | `sourceUrl` 不对，或电脑端没在监听，或防火墙挡了入站 |
| 手机浏览器/面板一直转圈 | 电脑端绑的是 `127.0.0.1` 而不是 `0.0.0.0` |
| 返回 403 | 两端 `token` 不一致 |
| 装完侧栏没有「电脑图库」 | 没有重启；或当前是原生界面而不是网页模式 |

Windows 上如果手机连不上，先在**以管理员身份**运行的终端里放行端口：

```powershell
netsh advfirewall firewall add rule name="dsh-lan-gallery" dir=in action=allow protocol=TCP localport=8765
```

## License

MIT
