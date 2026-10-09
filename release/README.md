# 发布与收录

这个目录存放「对外发布」用到的材料：npm 上的包、GitHub Release，以及插件商店的收录条目。

```
release/
├── README.md              ← 你正在读的文件：流程总览
├── npm.md                 ← npm 包信息与已发布版本记录
├── github-release.md      ← GitHub Release（运行时二进制兜底源）
└── checklist.md           ← 发新版本时的逐步清单
```

插件商店的收录条目在隔壁的 [`../list/`](../list/)。

## 三条互不相同的发布通道

发新版本时容易把这三件事混成一件，它们其实各自独立、各自会失败：

| 通道 | 做什么 | 由什么触发 | 失败表现 |
| --- | --- | --- | --- |
| **npm** | 让 `dsh plugin add dsh-opencode-xdbridge` 能装 | 推 `v*` tag → GitHub Actions（OIDC） | 装插件时报版本不存在 |
| **GitHub Release** | 运行时二进制（57 MB）的备用下载源 | 手动，用维护者本人身份 | 跨境慢网下载变慢，但不致命 |
| **插件商店** | 让别人在商店里搜到你 | 往 `awesome-dsh-plugin` 提 PR，**等维护者合并** | 商店搜不到，但不影响安装 |

**关键区别**：前两条自己能控制；**第三条需要别人点合并**。提了 PR 不等于收录。

## 完整流程

见 [`checklist.md`](./checklist.md)。
