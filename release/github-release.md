# GitHub Release

Release 在本项目里**不是**给插件用的，而是给**运行时二进制**做兜底下载源用的。

## 已发布

| Tag | 资产 | 大小 | 用途 |
| --- | --- | --- | --- |
| `runtime-1.18.33` | `opencode-windows-x64-1.18.33.tgz` | 57.4 MB | 下载器备用源 |

下载地址：

```
https://github.com/XDTrees/dsh-opencode-xdbridge/releases/download/runtime-1.18.33/opencode-windows-x64-1.18.33.tgz
```

## 为什么需要它

插件启动时会下载 OpenCode 官方运行时（`opencode.exe`，解压后 172 MB）。
下载器按 **官方 npm registry 优先、这个 Release 兜底**的顺序尝试，
两者都支持 Range 断点续传，可互相接续同一个文件的下载。

该资产已验证与 npm 官方包**逐字节相同**（首尾各 1 KB 比对一致，大小 60196031 字节一致，
支持 `206 Partial Content`），所以走哪条路拿到的都是同一个二进制。

## 为什么 Release 用维护者手动建，而不是 CI 自动建

`release.yml` 里留了建 Release 的步骤，但**默认关闭**，原因只有一个：**身份**。

CI 只能用 `GITHUB_TOKEN`，用它建出来的 Release 作者会固定显示成 `github-actions[bot]`。
本项目的 Release 都用维护者本人身份建，所以这一步是手动的。

手动创建：

```powershell
cd D:\DSH\dsh-opencode-xdbridge
gh release create runtime-<版本> `
  --title "OpenCode runtime <版本>" `
  --notes "OpenCode 官方运行时二进制，作为插件下载器的备用源。" `
  <资产文件路径>
```

## 升级运行时版本时

上游版本号变化（例如 1.18.33 → 1.18.34）**不会**让旧 Release 失效——插件会向
数据目录里已有的二进制复用，下载器也优先用已有的那份。
新增一个版本只是为了多一条兜底路径，不影响已装好的用户。

`lib/runtime.js` 里的 `runtimeSources()` 是唯一维护下载源列表的地方。
