# 发布到 npm

> 这份文档记录**首次发布**时踩过的坑，适合当背景读。
> 日常发版的逐步操作在 [`../release/checklist.md`](../release/checklist.md)，
> 发布通道/Release/商店收录的说明在 [`../release/`](../release/) 与 [`../list/`](../list/)。

## 现状

包名 **`dsh-opencode-xdbridge`** 已注册，已发布版本 **`0.1.0`**。

发布通道采用 **npm Trusted Publishing（OIDC）**：GitHub Actions 打 tag 即发布，
不需要在仓库里存任何 npm token，也不需要两步验证码。

## ⚠️ 关键限制：新包必须先手动发布一次

**未发布的包在 npm 上还不存在，因此无法提前配置 Trusted Publisher。**
所以顺序是固定的（首次发布时已按此执行）：

```
第 1 步（一次性）：本地手动发布 → 包在 npm 上诞生
第 2 步（一次性）：在 npm 上为它绑定 Trusted Publisher
第 3 步（以后每次）：打 v* tag → GitHub Actions 自动发布
```

### 第 1 步：本地手动发布

本机 `~/.npmrc` 里的 `//registry.npmjs.org/:_authToken` 已失效（实测 401），
需要先重新登录。因为本机 2FA 绑的是 **passkey**（命令行 `--otp` 只认认证器
6 位数字码，两者不通用），请用**浏览器登录**方式：

```powershell
# 1) 确认走官方 registry（本机默认是淘宝镜像，发布必须覆盖）
npm config get registry
#    若不是 https://registry.npmjs.org/ ，下面每条命令都要带 --registry

# 2) 浏览器登录（会用 passkey 完成 2FA）
npm login --auth-type=web --registry=https://registry.npmjs.org

# 3) 确认身份
npm whoami --registry=https://registry.npmjs.org

# 4) 首次发布
cd D:\DSH\dsh-opencode-xdbridge
npm publish --registry=https://registry.npmjs.org --access public
```

> 若 `npm login` 仍卡在 OTP，可改用 npm 网站创建 **Granular Access Token**
> （勾 Read and write、勾 Bypass 2FA 的 publish 权限），然后：
> `npm config set //registry.npmjs.org/:_authToken <新token> --location=user`

### 第 2 步：绑定 Trusted Publisher

包发布成功后，到 npmjs.com 配置：

**npmjs.com → 搜索 `dsh-opencode-xdbridge` → 进入包页 → Settings →
Trusted Publisher → 选 GitHub Actions**，填：

| 字段 | 值 |
| --- | --- |
| Organization or user | `XDTrees` |
| Repository | `dsh-opencode-xdbridge` |
| Workflow filename | `release.yml` |
| Environment name | 留空 |
| Allowed actions | 至少保留 `npm stage publish`；**建议一并勾上 direct publish** |

> 只勾 `npm stage publish` 的话，发布仍会停在暂存区等待批准。想一步到位就勾上 direct publish。

### 第 3 步：以后每次发版

```powershell
cd D:\DSH\dsh-opencode-xdbridge
# 1) 改 package.json 的 version，并同步写 CHANGELOG.md
# 2) 提交
git add -A
git commit -m "release: x.y.z"
# 3) 打 tag 并推送 —— 这一步触发自动发布
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z
```

推送后到仓库 **Actions** 页看进度，几十秒即可在 npm 上看到新版本。

## 关于本机的网络

本机 `~/.npmrc` 的 registry 是 `registry.npmmirror.com`（淘宝镜像），
**发布时必须显式覆盖为官方** `https://registry.npmjs.org`，否则会推到镜像
（镜像只读，会失败）。

插件自身的运行时下载**已经直连 npm 官方**（`registry.npmjs.org`），
不使用任何镜像。

## 本插件不跑构建器

客户端 bundle 是手写 CJS（`src/client/index.js`），由
`scripts/build-client.mjs` 包一层，产物 `lib/client.js` **随仓库提交**。
所以发布流程里没有 `tsdown`/`vite` 之类的构建步骤，只有一个
「产物是否与源码同步」的校验：改了 `src/client/index.js` 却没重新
`npm run build`，发布会在那一步失败，而不是把旧界面发出去。
