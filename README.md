# DSH OpenCode XD Bridge

[![npm](https://img.shields.io/npm/v/dsh-opencode-xdbridge?style=flat-square&label=npm&color=cb3837)](https://www.npmjs.com/package/dsh-opencode-xdbridge)
[![awesome · DSH plugin](https://awesome-dsh-plugin.com/badge.svg)](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
[![license](https://img.shields.io/github/license/XDTrees/dsh-opencode-xdbridge?style=flat-square)](LICENSE)

在 DeepSeek Harness 里使用 **OpenCode Zen 的免费模型**。

## 这是什么

把 [OpenCode](https://opencode.ai/) 的免费模型（big-pickle、LongCat、MiMo、Nemotron、Space Bunny 等）接进 DSH 的模型选择器，作为 `opencode-xdbridge` 分组使用，并在**设置 → OpenCode-XD** 里提供一个可视化的交互入口。

## 为什么必须这么做

OpenCode Zen 的免费模型有一个服务端门禁：

```
FreeTierError: OpenCode's free tier can only be used from within OpenCode
```

实测（2026-09-29）确认：

- **直连不行**：`https://opencode.ai/zen/v1/chat/completions` 直接请求返回 403。
- **改 User-Agent 不行**：试过 `opencode`、`opencode/1.18.33`、`Bun/1.2.0` 等 9 种写法，全部 403。判据不是 UA。
- **必须跑真正的 OpenCode 进程**：本机启动真实 `opencode serve` 后，同一批免费模型立刻可用。
- **权限策略是关键**：agent 的 `permission` 必须是 `{'*':'ask'}`；改成 `{'*':'deny'}` 或 `tools: {'*':false}` 会立刻变回 403。

所以本插件**不自造协议技巧**，而是：下载官方 OpenCode 二进制 → 在隔离环境里跑起来 → 在本地转成 OpenAI 兼容端点 → 注册给 DSH。

> 权限必须是 `ask` 意味着"每个本地操作都要审批"。插件在本地把**所有审批请求全部拒绝**，所以运行时看起来像正常 OpenCode 会话（门禁放行），但**本地一个动作都不会执行**。真正执行的是 DSH。

## 安装

**从 npm（推荐，最省事）**：

```sh
dsh plugin --profile <profile> add dsh-opencode-xdbridge
```

**从 GitHub 源码**：

```sh
dsh plugin --profile <profile> add github:XDTrees/dsh-opencode-xdbridge
```

或者手动链接（开发用）：

```powershell
# 1. 链接插件到 profile
New-Item -ItemType Junction -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-opencode-xdbridge" `
  -Target "D:\DSH\dsh-opencode-xdbridge"

# 2. 在 profile package.json 的 dsh.profile.bundles 里追加 "dsh-opencode-xdbridge"

# 3. 重启 DSH Desktop
```

首次启动会下载约 57 MB 的官方 OpenCode 运行时（只下载一次，缓存在数据目录）。

### 关于这次下载

下载的是 OpenCode 官方二进制（`opencode-windows-x64` 这个 npm 包，57.4 MB）。它必须存在，因为免费模型的门禁只认真实 OpenCode 进程发出的请求——插件自身只有 71 KB，不含模型代码。

下载被设计成**不会失败**，只会慢：

- **断点续传**：已下载的部分会保留，中断后重启从断点继续，而不是从头再来。
- **30 分钟总预算**：不再有单次请求的 5 分钟硬超时。
- **多源**：优先 npm 官方 registry，取不到或太慢时自动改用本仓库 GitHub Release 上的同名包。
- **完整性校验**：下载后比对 npm registry 发布的 sha512，不一致就丢弃重来——所以任何来源（包括镜像）都不可能让不同的代码被执行。

如果确实很慢，可以自己下载一次并指给它，插件会直接复制而不联网：

```sh
# 方式一：把已装好的 opencode 指给它
set OPENCODE_BINARY_PATH=C:\path\to\opencode.exe

# 方式二：指定一个下载源
set OPENCODE_XDBRIDGE_RUNTIME_URL=https://your-mirror/opencode-windows-x64-1.18.33.tgz
```

## 使用

重启后：

1. **模型选择器**里会出现 **OpenCode 免费模型** 分组（provider 为 `opencode-xdbridge`），直接选即可。
2. **设置 → OpenCode-XD** 是插件的交互面板（布局参考 OW Bridge 控制面板）。

可用的模型随上游变化，插件每次启动都会重新读取。

## 交互面板

设置页里这张卡片就是插件的控制台：

| 区域 | 作用 |
| --- | --- |
| 服务状态 | 状态点 + 一行当前状态（启动中 / 运行中 / 错误 / 重启中），错误时直接给「重试」 |
| 指标条 | 已发现 / 可用 / 待检测 / 不可用 四个计数 |
| 运行时信息 | OpenCode 版本、本地端点、数据目录 |
| 模型目录 | 每个模型一行：名称、**推荐用途**、能力徽章（推理 / 图片）、状态徽章、最近响应耗时 |
| 详情 | 点任意一行展开：推荐用途、上下文与输出上限、图片与工具能力、推理档位、最近一次调用的动作数 / 被拦截的本地尝试 / 转交的外部工具 |
| 操作 | **读取模型**（重新向上游取清单）、**检测全部**（逐个发真实请求验证）、**重启运行时** |

排序规则与 OW Bridge 一致：可用模型在前、待检测居中、不可用置底。

### 推荐用途是怎么来的

上游 OpenCode 的模型目录**只提供** `family`、`release_date`、上下文与输出上限、图片与推理能力、推理档位——**没有**「推荐用途」字段。所以这一行是本插件按**实测能力**整理的，不是抄来的宣传语：

- 每条说明都基于该模型真实上报的上下文窗口、输出上限、图片输入、推理档位；
- 目录里没收录的新模型会自动退回按能力生成的一句话（例如「100 万上下文 · 图片输入 · 支持推理」），不会留空。

要改文案，编辑 `src/client/index.js` 里的 `USE_NOTES`，然后 `npm run build`。

### 图标

导航行与页面标题使用同一个内联 SVG 标记（菱形 + 桥拱，呼应 OpenCode 与本插件的「桥」定位）。DSH 的 `settings.section` 契约不带图标字段，外壳对不认识的 id 一律画齿轮，所以导航图标是用 CSS mask 覆盖上去的（社区页面的通行做法）。

几个设计取舍：

- **检测是串行的**。并行探测会争抢同一份上游免费额度，让每次测量都更慢也更不可信。
- **检测会真的发请求**，所以消耗少量免费额度；只回文本、不产生动作的模型会按「可用 · 仅对话」发布，而不是判为失败。
- **读取模型与检测是两件事**。「读取」只问上游有哪些模型，是启动读取失败后的恢复路径；「检测」才验证模型是否真的能干活。
- **重启只换 OpenCode 进程**，provider 与本地端点保持不变，所以不会出现重复注册。
- 面板每 5 秒轮询一次状态，关掉设置页即停止。

### 失败是怎么区分的

一次检测失败并不等于「模型不能用」，所以失败被分成两类：

| 类别 | 含义 | 是否从选择器移除 |
| --- | --- | --- |
| **超时 / 限流 / 服务端错误** | 这一刻够不到（不稳定） | **否**，保留并标为「不稳定」 |
| **地区限制 / 鉴权失败 / 额度不足** | 确定性的拒绝 | 是，标为「不可用」 |

这个区分很重要：超时说不了模型本身的任何事，因为一次慢就把它从选择器里拿掉，等于把能用的模型也一起收走了。

每个模型每次检测最多尝试 2 次，**每次独立计时（90 秒）**——早期版本让两次尝试共用一个 60 秒预算，慢模型的重试还没跑就被掐断，于是把「只回文本」这种有效结论误报成超时。实测把预算分开之后，可用模型从 4 个恢复到 6 个。

检测失败**不会**让模型变成不可再检测：失败记录只影响它是否出现在选择器里，模型始终留在目录中，下一次「检测全部」会重新试。

## 配置

配置写在 profile 的 `settings.yaml` 里，命名空间 `opencode-xdbridge`：

```yaml
opencode-xdbridge:
  dataDir: D:\DSH-data\opencode-xdbridge   # 运行时/日志存放位置
  binaryPath: C:\path\to\opencode.exe     # 用已有的 OpenCode，不下载
  runtimeVersion: 1.18.33                 # 固定版本
  autoRefresh: true                       # 启动后重新读一次模型清单
```

| 字段 | 说明 | 默认 |
| --- | --- | --- |
| `dataDir` | 受管运行时、日志、状态目录 | `<DSH home>/opencode-xdbridge` |
| `binaryPath` | 使用已有的 OpenCode 二进制 | 自动下载官方版本 |
| `runtimeVersion` | 固定 OpenCode 版本 | 最新版 |
| `autoRefresh` | 启动 15 秒后重读一次免费模型清单 | `true` |

也可用环境变量 `OPENCODE_XDBRIDGE_DATA_DIR` 指定数据目录。

## 架构

```
DSH Harness
   │  (pi-ai provider "opencode-xdbridge")
   ▼
lib/adapter.js ──── pi-ai createProvider + openAICompletionsApi
   │
   ▼
lib/shim.js ─────── 127.0.0.1 随机端口，进程内随机密钥
   │                （OpenAI /v1/chat/completions ↔ JSON 信封）
   ▼
lib/backend.js ──── 会话管理、权限拦截、信封校验
   │
   ▼
lib/runtime.js ──── 隔离的 opencode serve（独立 XDG 根 + 随机密码）
   │
   ▼
OpenCode Zen 免费模型
```

| 文件 | 职责 |
| --- | --- |
| `lib/index.js` | 插件入口：编排启动顺序，注册 provider，挂载设置页路由 |
| `lib/platform.js` | 数据目录与平台包名 |
| `lib/runtime.js` | 下载、启动、监督隔离的 OpenCode 运行时 |
| `lib/shim.js` | 回环 OpenAI 兼容端点（安全边界所在） |
| `lib/backend.js` | 一次推理回合：会话、权限拦截、信封校验 |
| `lib/protocol.js` | OpenAI ↔ JSON 信封的双向转换与校验 |
| `lib/handoff.js` | 被拦截的本地动作 → 外部工具调用的映射 |
| `lib/probe.js` | 模型检测（真实请求 + 动作判定 + 一次重试） |
| `lib/adapter.js` | pi-ai provider 组装 |
| `lib/catalog.js` | 免费模型目录 + 每个模型的最近观测结果 |
| `lib/web-status.js` | 设置页的同源路由（状态 / 读取 / 检测 / 重启 / 详情） |
| `lib/status-paths.js` | 主机与浏览器两侧共享的路由常量与文档结构 |
| `src/client/index.js` | 设置页卡片（浏览器侧，手写 CJS） |
| `scripts/build-client.mjs` | 把卡片包成宿主要求的模块加载器格式 |

## 安全设计

- **隔离运行时**：独立的 XDG 根目录、随机服务密码、关闭自动更新/分享/项目配置；只转发常规系统与网络环境变量，**不读取也不写入**你自己 OpenCode 的配置、凭据和会话。
- **本地动作零执行**：运行时被配置为"每个操作都要审批"，而插件把**所有审批一律拒绝**。模型若试图本地执行，插件会尽量把该动作**转交**给 DSH 作为外部工具调用，否则明确拒绝并告知模型原因。
- **回环端点加固**：只监听 `127.0.0.1` 随机端口；校验 Host/Origin 必须是回环（防 DNS rebinding 与浏览器页面访问）；Bearer 常量时间比较；请求体上限 8 MB。
- **信封先校验后执行**：模型返回的 JSON 信封必须先通过校验才能变成工具调用，工具名与参数都必须在本轮允许的列表和 schema 之内。
- **只暴露免费模型**：只有当运行时报告的**每一个**计费维度都为 0 时，模型才会被列出。不可能悄悄花掉你的额度。

## 开发

```sh
npm run build        # 把 src/client/index.js 包成 lib/client.js
npm test             # 单元测试（37 项）+ 客户端 bundle 校验，无需网络
npm run test:smoke   # apply() 注册 + 真实 PiAiAdapter + 检测流程
npm run test:e2e     # 端到端（需 OPENCODE_XDBRIDGE_E2E=1）
```

单独跑：

```sh
node test/client-bundle.test.mjs        # 模拟宿主加载器，验证卡片注册与渲染
node test/client-declaration.test.mjs   # 用宿主自己的代码校验 dsh.client 声明
node test/apply-smoke.mjs               # 用桩 ctx 验证 apply() 注册与全部路由
node test/harness-smoke.mjs             # 通过真实 PiAiAdapter 走一次 stream()
node test/probe-smoke.mjs               # 真实跑一次模型检测
node test/profile-load-check.mjs        # 用 DSH 自己的 loader 校验 profile
```

> **改了 `src/client/index.js` 必须重新 `npm run build`**，否则 DSH 拿到的是旧的 `lib/client.js`。

集成测试会真实下载/使用官方 OpenCode 二进制并产生真实上游请求，因此默认关闭，需要 `OPENCODE_XDBRIDGE_E2E=1` 显式开启。

## 已知限制

- **依赖 OpenCode Zen 的免费额度**：模型清单与可用性由上游决定，随时可能变化。
- **首次启动要下载**：约 60 MB，之后复用缓存。
- **依赖 OpenCode 客户端接口**（不是官方开放 API），OpenCode 更新后插件可能需要跟着调整。
- 免费额度被上游限流时，请求会失败并报出上游原始错误。
- **包名含大写**：`dsh-opencode-xdbridge` 不符合 npm 的小写包名规范，因此只能本地链接安装，不能发布到 npm 用 `dsh plugin add` 安装。若需要 npm 分发，请把包名改成全小写。

## 致谢

- [OpenCode](https://opencode.ai/) —— 本插件运行并复用其官方二进制与本地服务接口。
- [louchi1984-coder/ow-bridge](https://github.com/louchi1984-coder/ow-bridge) —— 验证了"隔离 OpenCode + 本地 OpenAI 兼容端点 + 审批拦截"这一整体思路的可行性，其控制面板也是本插件设置页布局与交互逻辑的参考。本项目为独立实现，未复制其代码。

## 许可证

MIT
