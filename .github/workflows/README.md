# GitHub Actions

## `release.yml` — 打 tag 即发布到 npm

推送一个 `v*` tag，GitHub 就会把当前版本发布到 npm。

**它不需要任何 npm token、也不需要 2FA 验证码。** npm 通过 OIDC 信任这个
workflow，等效于「本人亲自发布」。

### 为什么用 OIDC（而不是 `npm publish --otp=`）

本机账号的 2FA 绑的是**安全密钥（passkey）**，而 npm 命令行的 `--otp`
只接受**认证器 6 位数字码**，两者不通用；npm 的暂存批准页面又没有网页入口。
Trusted Publishing 因此成为唯一无码可用的官方渠道。

### 首次启用要做的事

1. **npm 侧绑定**：npmjs.com → 该包 → Settings → **Trusted Publisher** →
   选 **GitHub Actions**，填：
   - Organization or user：`XDTrees`
   - Repository：`dsh-opencode-xdbridge`
   - Workflow filename：`release.yml`（只填文件名，不带路径，但要带 `.yml`）
   - Environment name：留空
   - Allowed actions：**至少保留 `npm stage publish`**；勾上 direct publish
     才能一步到位发布

2. **GitHub 侧**：确认仓库的 Actions 有写权限（默认有），然后推送一个 tag。

### 发布一个新版本

```powershell
cd D:\DSH\dsh-opencode-xdbridge
# 1. 改 package.json 的 version，并同步写 CHANGELOG
# 2. 提交
git add -A
git commit -m "release: x.y.z"
# 3. 打 tag 并推送 —— 这一步就会触发自动发布
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z
```

推送后到仓库的 **Actions** 页看进度，几十秒即可在 npm 上看到新版本。

> 注意：npm 的 staged publishing 策略下，若绑定页面只勾了 `npm stage publish`，
> 发布会停在暂存区等待批准。**建议把 direct publish 一并勾上**。

### 本插件不跑构建器

客户端 bundle 是手写 CJS（`src/client/index.js`），由
`scripts/build-client.mjs` 包一层，**产物 `lib/client.js` 随仓库提交**。
所以发布流程里没有 `tsdown`/`vite` 之类的构建步骤，只有一个「产物是否与
源码同步」的校验：改了 `src/client/index.js` 却没重新 `npm run build`，
发布会在那一步失败，而不是把旧界面发出去。
