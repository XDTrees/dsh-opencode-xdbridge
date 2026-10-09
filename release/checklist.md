# 发新版本清单

按顺序做。**第一步没做就跳到第三步，发布会静默失败**，所以别跳。

## 1. 改代码

- [ ] `src/client/index.js` 改了吗？改了就跑 `npm run build`，**并提交 `lib/client.js`**。
      （CI 会校验二者是否同步，不同步直接失败。）
- [ ] 新增依赖了吗？插件目录 `node_modules` 用的是 junction 指向宿主共享副本，
      新依赖要在那里可用。

## 2. 改版本号与日志

- [ ] `package.json` 的 `version` 改成 `x.y.z`。
- [ ] `CHANGELOG.md` 加一节 `## x.y.z`。
      **这一节就是 GitHub Release 的正文**，所以必须写，且标题要与版本号完全对应。

## 3. 本地验证

- [ ] `npm test` — 应为 `fail 0`，并看到四个独立检查全过：
      `CLIENT BUNDLE OK` / `RENDER CHECK OK` / `CLIENT DECLARATION OK` / `PROXY DEFAULT CHECK OK`。
- [ ] 改了运行时/代理相关代码的话，再跑一遍真实请求：
      `node test/proxy-live.mjs`（应看到 `PROXY_OK`）。
      > 本机要先确认代理是活的：`Test-NetConnection 127.0.0.1 -Port 7897`。
      > Clash Verge 重启会有约 2 秒空窗，那期间任何网络操作都会失败。

## 4. 提交并打 tag

```powershell
git add -A
git commit -m "release: x.y.z"
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z
```

推送后到仓库 **Actions** 页确认 `Release` workflow 跑完。

## 5. 验证 npm 上的版本

```powershell
npm view dsh-opencode-xdbridge versions --registry=https://registry.npmjs.org
```

## 6. 商店收录（只在首次或改描述时需要）

条目已经准备好，放在 [`../list/`](../list/)。走法见 [`../list/README.md`](../list/README.md)。

> ⚠️ **商店收录需要别人点合并。** 提了 PR ≠ 收录成功。
> 本项目的 PR #6129 至今停在 `open`：检查全过、`mergeable_state: clean`，
> 但我方对该仓库**只有只读权限**，所以 GitHub 连合并按钮都不渲染。
> 收录只影响「别人能不能搜到你」，**不影响安装**——`dsh plugin add github:XDTrees/dsh-opencode-xdbridge` 现在就能用。

## 附：本机网络备忘

- 本机 `~/.npmrc` 的 registry 是淘宝镜像，**发布必须显式 `--registry=https://registry.npmjs.org`**。
- 插件自身的运行时下载**不走任何镜像**，只连 npm 官方 + 上述 GitHub Release。
- git 推送需要显式带代理：`git -c http.proxy=http://127.0.0.1:7897 push origin main`。
