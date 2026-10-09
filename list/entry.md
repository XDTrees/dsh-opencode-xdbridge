# 条目字段说明

条目文件是 [`XDTrees__dsh-opencode-xdbridge.yml`](./XDTrees__dsh-opencode-xdbridge.yml)，
内容与已提交的 PR #6129 **完全一致**。改描述时改这里，然后把同一份内容更新到 PR。

## 字段

| 字段 | 值 | 依据 |
| --- | --- | --- |
| `url` | `https://github.com/XDTrees/dsh-opencode-xdbridge` | 仓库地址。商店据此把条目对回仓库，也是 `dsh plugin add github:…` 的写法来源 |
| `name` | `XDTrees/dsh-opencode-xdbridge` | 与文件名 `<owner>__<repo>` 一致，便于核对 |
| `category` | `model` | 从商店允许的 21 个取值里选的。本插件的作用是接入一组模型 provider，所以选 `model`（同作者的 `dsh-workbuddy-xdpool` 也归在这一类） |
| `description.en` | 英文一句话 | 见下 |
| `description.zh` | 中文一句话 | 见下 |

## category 的可选值

商店只接受这 21 个之一，写错会被 CI 拦下：

```
agi  ui  usage  theme  model  identity  session  memory  tools  wsl
browser  vision  voice  docs  skill  workflow  git  notify  dev
security  remote  market  fun
```

## 描述怎么写

一句话说清「**装了这个能干什么**」，不写实现细节。当前版本刻意覆盖了三点：

1. 接入的是 **OpenCode Zen 的免费模型**（说清资源来源）
2. 以**一组 provider** 的形式进 DSH（说清接入形态）
3. 有**设置页可逐个检测**（这是本插件区别于纯配置方案的地方）

中文版与英文版**信息量对齐**，不是直译式的一句话，两边都说满。

## 改描述的流程

1. 改这个目录里的 `XDTrees__dsh-opencode-xdbridge.yml`
2. 到 PR #6129 更新同一个文件（或关掉重开一个 PR）
3. 提交到本仓库，让这里的副本与线上保持同步
