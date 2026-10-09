# npm

包名 **`dsh-opencode-xdbridge`**（全小写——npm 不接受大写字母，界面显示名 `OpenCode-XD` / `OpenCode-XDbridge` 不受影响）。

- 包页：https://www.npmjs.com/package/dsh-opencode-xdbridge
- 仓库：https://github.com/XDTrees/dsh-opencode-xdbridge

## 已发布版本

| 版本 | 发布方式 | 说明 |
| --- | --- | --- |
| `0.1.0` | 本地手动（冷启动） | 首个版本 |

> **为什么第一个版本是手动发的**：未发布的包在 npm 上还不存在，因此**无法提前配置 Trusted Publisher**。
> 必须先在本地手动发一次让包「诞生」，之后才能绑定 OIDC 走自动发布。
> 详见 [`../docs/PUBLISHING.md`](../docs/PUBLISHING.md)。

## 发布方式：OIDC（不需要 token，也不需要验证码）

推一个 `v*` tag 就会触发 [`.github/workflows/release.yml`](../.github/workflows/release.yml)。

选 OIDC 而不是 `npm publish --otp=` 的原因：本机 2FA 绑的是 **passkey**，
而命令行的 `--otp` 只接受**认证器 6 位数字码**——两者不通用。Trusted Publishing 是唯一无码可用的官方渠道。

### 一次性绑定（若尚未完成）

npmjs.com → `dsh-opencode-xdbridge` → Settings → **Trusted Publisher** → GitHub Actions：

| 字段 | 值 |
| --- | --- |
| Organization or user | `XDTrees` |
| Repository | `dsh-opencode-xdbridge` |
| Workflow filename | `release.yml`（只填文件名，要带 `.yml`） |
| Environment name | 留空 |
| Allowed actions | 至少 `npm stage publish`；**建议一并勾上 direct publish** |

> 只勾 `npm stage publish` 的话，发布会停在暂存区等待批准，不会自动完成。

## 两个必须记住的坑

1. **必须显式覆盖 registry。** 本机 `~/.npmrc` 指向 `registry.npmmirror.com`（淘宝镜像），镜像只读，推上去必然失败。
   ```powershell
   npm publish --registry=https://registry.npmjs.org --access public
   ```
2. **`lib/client.js` 必须与 `src/client/index.js` 同步。** 客户端 bundle 是手写 CJS，产物随仓库提交。
   改了源码没重跑 `npm run build`，发布会**失败**——这是故意的，免得把旧界面发出去。

## 发布一个新版本

```powershell
cd D:\DSH\dsh-opencode-xdbridge
npm run build          # 改了 src/client/index.js 的话
# 1) 改 package.json 的 version，并在 CHANGELOG.md 写下同一版本号的小节
git add -A
git commit -m "release: x.y.z"
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z   # ← 这一步触发自动发布
```

推送后到仓库 **Actions** 页看进度，几十秒即可在 npm 上看到新版本。

> Release 的正文取自 `CHANGELOG.md` 中匹配当前版本号的那一节，所以版本号必须写在 CHANGELOG 里。
