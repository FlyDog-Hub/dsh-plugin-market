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

## 4. 分发路径

### 4.1 从 GitHub Release 附件直接安装（今天就能用，已验证）

```powershell
dsh plugin --profile web add https://github.com/Winnie-0721/dsh-plugin-market/releases/download/v1.0.0/dsh-plugin-market-1.0.0.tgz
```

`dsh plugin add` 的 spec 解析接受 `.tgz` URL（`parseInstallSpec` 的 tarball 形状），
上面这条命令在全新 profile 上实测：**10.6 秒装完、bundle 已激活、`node_modules` 里有包**。
这条路径不需要任何 npm 账号，也是本仓库当前唯一可用的「按名字以外」的分发方式。

### 4.2 发布到 npm：**名字已被占用，不能直接用 `dsh-plugin-market`**

`dsh-plugin-market` 在 npm 上属于**另一个项目**（实测）：

| 项 | 值 |
|---|---|
| latest | `1.3.0`（共 4 个版本，首发 2026-08-14） |
| maintainer | `fireguo`（hjrluobo2h@qq.com） |
| repository | `https://github.com/veloce-ailab/dsh-plugin-market` |
| description | Plugin market foundation with a standalone Web configuration editor for DeepSeek Harness |

两条后果：

1. **不能发布**：`pnpm publish` 会被 registry 以 `403 you do not have permission` 拒绝；
2. **同机会撞行**：本包的 bundle 名就是 `dsh-plugin-market`。如果有人同时装了那个包，profile 里会出现两个同名
   bundle → Loader 组合失败。要共存，必须先改名。

**可选方案**（发布前的名字可用性均已实测，见下表）：

| 方案 | 名字 | npm 可用性 | 代价 |
|---|---|---|---|
| A. 加 scope | `@winnie-0721/dsh-plugin-market` | 可用（需要你拥有该 scope） | 改 `package.json` 的 `name` → 安装身份变化 → 按 §1 的规则属于破坏兼容，要 `-Bump major` |
| B. 换非 scoped 名 | `dsh-plugin-market-lite` / `dsh-market-x` / `dsh-market-rebuild` / `winnie-dsh-market` / `dshmarket2` | 均可用 | 同上 |
| C. 只走 4.1 | 保持 `dsh-plugin-market` | — | 不能按名字装；与那个包同机冲突的风险仍在（文档需显著提示） |

改名要同时改这几处（漏一处就会在运行时露出来）：`plugin-market/package.json` 的 `name`、
`cordis.patch.yml` 的行 `name`、`lib/client.js` 里 `__ModuleLoader__.load({ id })`、
`lib/index.js` 的 `PLUGIN_NAME`、README/文档里的安装命令，以及**已安装 profile 的重新安装**
（`dsh plugin remove` 旧名 → `add` 新名）。改完用 `scripts/release.ps1 -Bump major` 发新版本号。

### 4.3 真要发 npm 时的检查单

```powershell
pnpm login                                   # 或 pnpm config set //registry.npmjs.org/:_authToken=<token>
cd plugin-market
pnpm publish --access public --no-git-checks
```

- 发布前确认名字可用：`https://registry.npmjs.org/<name>` 返回 404；
- `pnpm pack` 后的 tarball 只含 `package/` 下的 13 个文件（lib、assets、cordis.patch.yml、README×2、CHANGELOG、LICENSE、package.json）；
- 版本号不可重用、不可覆盖——发错了只能往上加；
- 发布后立刻真装一次：`dsh plugin --profile <新 profile> add <name>` 或直接 `add <tarball URL>`，启动宿主确认侧边栏底部入口还在。
