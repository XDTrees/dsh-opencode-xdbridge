# 插件商店收录

这个目录保存插件商店的**收录条目**——提交到
[`awesome-dsh-plugin/awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
的那个文件，在这里留一份，方便改描述时不用去翻 PR。

```
list/
├── README.md                              ← 你正在读的文件：收录机制与提交流程
├── XDTrees__dsh-opencode-xdbridge.yml     ← 提交用的条目（原样）
└── entry.md                               ← 条目各字段的含义与取值依据
```

## 收录是怎么发生的

**插件商店不直接收插件。** 它读的是这一个地址：

```
https://awesome-dsh-plugin.com/plugins.json
```

要出现在里面，只能往 `awesome-dsh-plugin/awesome-dsh-plugin` 仓库提 PR，
在 `data/plugins/` 下加**一个文件**：

```
data/plugins/<owner>__<repo>.yml
```

**文件名必须与仓库全名严格对应**，用两个下划线连接、大小写一致：

```
data/plugins/XDTrees__dsh-opencode-xdbridge.yml
        └──────┘  └──────────────────┘
          owner          repo
```

## 提交流程

不需要克隆那个仓库，直接在网页或 API 上建一个文件、开 PR 即可：

```powershell
# 1) 在 awesome-dsh-plugin 仓库上新建一个分支
gh api -X POST repos/awesome-dsh-plugin/awesome-dsh-plugin/git/refs `
  -f ref="refs/heads/add-dsh-opencode-xdbridge" `
  -f sha="<main 的当前 sha>"

# 2) 用本目录的条目文件在该分支上建文件
#    data/plugins/XDTrees__dsh-opencode-xdbridge.yml

# 3) 开 PR
gh pr create --repo awesome-dsh-plugin/awesome-dsh-plugin `
  --head add-dsh-opencode-xdbridge `
  --title "Add XDTrees/dsh-opencode-xdbridge" `
  --body "Adds OpenCode Zen free models to DeepSeek Harness."
```

## ⚠️ 提了 PR ≠ 收录成功

收录**需要维护者点合并**，而 PR 质量合格不代表对方会动手。

本项目 PR **#6129** 的现状：

| 项目 | 状态 |
| --- | --- |
| `state` | `open` |
| `merged` | `false` |
| `mergeable` | `true` |
| `mergeable_state` | `clean` |
| 检查 `Submission gate` | `completed / success` |
| 检查 `check` | `completed / success` |
| 评审 | 无 |
| 我方权限 | `pull: true`，**其余全为 false** |

GitHub 的 PR 页面会显示「所有检查都通过了」「变更可以净利落地合并」——
这些说的是 **PR 本身没问题**，不是说「已经收录」。页面上另一句「该分支尚未部署」
是指代码还停在分支上没进 main。

**因为我方对该仓库只有只读权限，GitHub 连合并按钮都不渲染**，
这不是操作漏了步骤，是权限决定的。唯一的办法是等维护者合并，或去 PR 下留言催办。

> 对照：同作者的 `dsh-workbuddy-xdpool` 走的是**完全相同**的步骤，
> 唯一差别就是那次维护者在 1 天内点了合并。

## 收录状态怎么看

```powershell
# 条目文件是否已进 main（404 = 还没收录）
curl.exe -s -o NUL -w "%{http_code}`n" `
  https://raw.githubusercontent.com/awesome-dsh-plugin/awesome-dsh-plugin/main/data/plugins/XDTrees__dsh-opencode-xdbridge.yml

# 线上目录里有没有本插件
curl.exe -s https://awesome-dsh-plugin.com/plugins.json | Select-String "dsh-opencode-xdbridge"
```

## 收录门槛（CI 会自动查）

- [x] 仓库声明了 `dsh.bundle` 与 `cordis.patch.yml`
- [x] 能用 `dsh plugin add` 装（已实测）
- [x] 仓库公开
- [x] 加了 `dsh-plugin` topic
- [x] 仓库创建满 24 小时

## 收录不影响安装

这是最容易被误认为「白做了」的一点：**商店只是个发现渠道。**

```powershell
dsh plugin add github:XDTrees/dsh-opencode-xdbridge
dsh plugin add dsh-opencode-xdbridge        # 或从 npm
```

两种装法**现在就能用**，跟商店收录与否无关。
