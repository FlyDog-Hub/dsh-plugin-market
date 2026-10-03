# 发布与版本号规则

本仓库用**最基础的 app 版本号规则**：人类可读的 `versionName` + 单调递增的 `versionCode`，
由 [scripts/release.ps1](../scripts/release.ps1) 生成，不手写、不猜。

## 1. 版本号规则

| 名称 | 形式 | 在哪里用 |
|---|---|---|
| `versionName` | `MAJOR.MINOR.PATCH`（严格 SemVer，不带 `v` 前缀） | `package.json` 的 `version`、Git 标签 `v<versionName>`、GitHub Release 标题 |
| `versionCode` | `MAJOR*10000 + MINOR*100 + PATCH`（单调递增整数） | `dist/version.json`、需要纯数字版本的宿主/渠道 |
| 构建标识 | `+<提交数>.<短哈希>` | 只写进发布说明与 `dist/version.json`，**不进入** `versionName` |

**递增规则**（从用户的视角判定，而不是从代码量）：

- `MAJOR`：破坏兼容——改了对外契约（端点、字段、错误码）、去掉了别人依赖的行为；
- `MINOR`：向后兼容的新功能（新页签、新能力、新环境变量）；
- `PATCH`：向后兼容的修复，包括安全修复与兼容性修复；
- 首个正式版本固定 `1.0.0`；
- 需要试用但仍未定稿时用预发布号 `1.1.0-rc.1` 这类形式，**不占用正式号段**；
- 已经发布过的版本号**永不重用、永不覆盖**（npm 也不允许覆盖），出错就往上加 PATCH。

为什么 `versionName` 保持严格 `MAJOR.MINOR.PATCH`、把构建信息放到别处：SemVer 规定构建元数据不参与优先级比较，
而 Git 标签、npm 版本、`dsh plugin add` 的解析都吃这个字符串——把提交哈希塞进去只会制造歧义。

## 2. 一次发布做什么

`scripts/release.ps1` 按固定顺序执行，任何一步失败就停，不会留下半个版本：

1. **读**：解析 `plugin-market/package.json` 的 `version` 并校验 SemVer 形状；
2. **门禁**（全绿才继续）：
   - `node --check` 过 host/client 每个 `lib/*.js`；
   - `package.json` 可解析，且 `dsh.bundle.patch` / `dsh.client.platform` / `exports["./client"]` 齐全；
   - `cordis.patch.yml` 存在且行 `name` 与包名一致；
   - 客户端 bundle 含 `__ModuleLoader__.load` 且 `id` 等于包名；
   - `verify/origin-guard.test.mjs`（来源判定矩阵）通过；
   - **发布面干净**：`plugin-market/`、`docs/`、`scripts/` 与根文件不能有未提交改动。
     其它路径（例如并行进行的 `verify/**` 验收脚本）有改动只警告、不阻塞——它们既不进发布物，
     也不进发布提交，把一场正在跑的验收当成发布阻塞没有意义。
3. **递增**：按 `-Bump` 写入新的 `version`；
4. **打包**：`pnpm pack` → `dist/dsh-plugin-market-<version>.tgz`，并写 `dist/version.json`
   （`version` / `versionCode` / 提交数 / 短哈希 / 构建时间）；
5. **发布**：`git commit` + `git tag -a v<version>` + `git push --follow-tags` +
   `gh release create v<version> dist/*.tgz`。

## 3. 用法

```powershell
# 首个版本：1.0.0（不递增，直接发）
pwsh -File scripts\release.ps1

# 之后每个版本按改动性质递增
pwsh -File scripts\release.ps1 -Bump patch      # 修复
pwsh -File scripts\release.ps1 -Bump minor      # 新功能
pwsh -File scripts\release.ps1 -Bump major      # 破坏兼容

# 只打包、不改版本、不提交、不发布（本地验证包装是否正确）
pwsh -File scripts\release.ps1 -LocalOnly

# 到打包为止，不推送也不建 Release
pwsh -File scripts\release.ps1 -SkipPush
```

**这台机器上必须带代理**：`github.com` 直连不通，`gh` 与 `git` 只认 `HTTPS_PROXY`：

```powershell
$env:HTTPS_PROXY='http://127.0.0.1:7890'; $env:HTTP_PROXY='http://127.0.0.1:7890'
```

## 4. 发布到 npm（可选，需要你自己的凭据）

GitHub Release 只解决「下载得到包」；要让别人 `dsh plugin --profile web add dsh-plugin-market`
直接装，需要发布到 npm。本机没有 npm 凭据，所以这一步要你来（或把你的 npm automation token 交给执行者）：

```powershell
# 1) 登录（浏览器方式；token 方式用 --auth-type=legacy + --token）
pnpm login
# 2) 发布（pack 出来的内容就是 registry 上的内容）
cd plugin-market
pnpm publish --access public --no-git-checks
```

发布前自查：

- `pnpm pack` 后的 tarball 只含 `package/` 下的 13 个文件（lib、assets、cordis.patch.yml、README×2、CHANGELOG、LICENSE、package.json）；
- `version` 没被占用：`pnpm view dsh-plugin-market version`（本仓库首次检查时该名字**未被占用**）；
- 名字一旦发布就属于你，改名前要重新发并保留旧版；
- 发布后建议立刻做一次真装：`dsh plugin --profile <新 profile> add dsh-plugin-market`，再启动宿主确认入口在侧边栏底部。
