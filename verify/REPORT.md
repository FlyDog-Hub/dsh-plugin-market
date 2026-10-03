# 插件市场验收报告（task-3）

- **结论：通过。最终一轮 47 条断言全绿（PASS=47 FAIL=0），运行 id `verify-20261003-214407`。**
- 被测对象：`E:\AI\DeepSeek Harness\Dsh\plugin-market`（`dsh-plugin-market` v1.0.0，host `lib/index.js` + `lib/catalog.js` + `lib/http.js`，client `lib/client.js`）
- 验收者：`market-verifier`（独立验收，未修改 `plugin-market/**`）
- 契约依据：`docs/API-CONTRACT.md`（§5 断言清单 + §1/§2/§3 契约条款）、`docs/TEAM-BRIEF.md`
- 本次验收的 5 条实现缺陷/偏差结论、7 条工具缺陷、以及全部原始证据见下文各节。

---

## 1. 结论摘要

| 项 | 值 |
|---|---|
| 最终运行 id | `verify-20261003-214407` |
| 断言结果 | **PASS 47 / FAIL 0**（退出码 0） |
| 被测代码冻结点 | `catalog-npm.js` 21:29:37、`catalog.js` 21:30:10、`index.js` 21:30:14（Lead 复核），均早于本轮开始时间 21:44:07；`README.md`/`README.zh.md` 在 21:36 被队友更新过，属文档改动，不影响 lib 断言 |
| 独立 DSH_HOME | `E:\AI\DeepSeek Harness\Dsh\_verify\dshhome`（真实 `C:\Users\28062\.dsh` 全程只读） |
| 临时 profile | `_verify\dshhome\profiles\marketcheck`（另有 `chaincheck` / `drill` / `mk1` / `probe1` 为探路遗留） |
| 本轮端口 | `2056, 16748, 59459, 59479`（boot1-4 宿主）＋ fixture 动态端口；**结束全部释放，残留占用 0** |
| 真实抓取耗时 | 冷启动 **550 ms**，count=4412，source=`npm:dsh-plugin-catalog@2026.1003.4803 (registry.npmmirror.com)` |
| 断言自检 | `selfcheck.ps1` 通过：错误响应上 15/15 条市场断言全部 FAIL；boot 图好/坏两向 A2/A3 符合预期 |

**遗留风险 3 项**（不阻塞安装，详见 §9）：真实浏览器渲染未断言；官方 URL 兜底最坏 30s；`updateAvailable` 的版本比较只用 fixture 注入值验证过（真实目录里没有对照用的已装包）。

---

## 2. 环境与真实命令（全部实测，非推断）

| 项 | 实测值 |
|---|---|
| dsh CLI | `D:\Software\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd` |
| 版本 | `dsh --version` → `0.2.0-rc.2` |
| 宿主 Node | `...\runtime\primary-runtime\dependencies\node\bin\node.exe` → `v24.21.0`（undici 7.29.1） |
| 宿主 shell | **Windows PowerShell 5.1.29671.1000**（`pwsh` 不存在，`pwsh` 工具实际跑的是 5.1） |
| profile 与 DSH_HOME | `--profile <name>` 解析为 `$DSH_HOME\profiles\<name>`；**`DSH_HOME` 环境变量被完整尊重** → 用它把整套验收关进 `_verify\` |

真实命令用法（写进交付物，用户可照抄复现）：

```powershell
# 1) 从 shipped web 模板建独立 profile，--dump-config 让它建完即退、不真起宿主
$env:DSH_HOME = 'E:\AI\DeepSeek Harness\Dsh\_verify\dshhome'
dsh --from-default-profile web --profile marketcheck --dump-config
#    产物：package.json（bundles = @deepseek-ai/dsh-base, @deepseek-ai/dsh-web-app）
#          cordis.patch.yml / cordis.yml / pnpm-workspace.yaml；无 node_modules

# 2) 装插件（pnpm 11.7.0 透传，本地目录落成 link: 依赖）
dsh plugin --profile marketcheck add "E:\AI\DeepSeek Harness\Dsh\plugin-market"

# 3) 起宿主（--port 0 也可让 OS 挑；--no-open 避免弹浏览器）
cmd /c call "…\bin\dsh.cmd" --profile "marketcheck" --port 1539 --no-open 1>out.log 2>err.log

# 4) 首页鉴权 URL 只从启动日志取（不要猜 token）：
#    http://127.0.0.1:<端口>/?token=<43 字符>
```

三条关键机制（踩过才知道，务必记住）：

1. **`DSH_HOME` 必须每次调用都设**。每次 `pwsh` 都是新进程；漏设会让 CLI 落到真实 `.dsh`。本报告的所有 `dsh` 调用都在 `psi.EnvironmentVariables['DSH_HOME']` 里显式注入。
2. **鉴权是「带 token 的 URL → 303 → Set-Cookie → 带 cookie 取文档」**。HTTP 客户端必须自带 cookie 容器，否则重定向后丢 cookie，首页返回 401。无 token 直连 `/` 返回 **401**（负向对照，证明鉴权确实生效）。
3. **客户端 bundle 路由 `/plugins/??<id>/client.js&rev=<rev>` 按 `pathname+search` 精确查表**：rev 必须取自**同一次 boot** 的 `__DSH_BOOT__`；跨次复用旧 rev 会 404；给它追加 `&token=` 也会 404（键不匹配）。

---

## 3. 断言表

编号约定：`A*` = 契约 §5 与我的补充，`E*` = Lead 指定的额外断言。

| # | 断言 id | 命令（复现用） | 预期 | 实际 | 结论 |
|---|---|---|---|---|---|
| 1 | `A0` | `Get-Content "E:\AI\DeepSeek Harness\Dsh\plugin-market\package.json" -Raw \| ConvertFrom-Json` | JSON 可解析；name=dsh-plugin-market | name=dsh-plugin-market version=1.0.0 | **PASS** |
| 2 | `A10` | `node --check "E:\AI\DeepSeek Harness\Dsh\plugin-market\lib\index.js"` | 两者 exit=0 | host exit=0；client exit=0 | **PASS** |
| 3 | `A9` | `Select-String -Path "E:\AI\DeepSeek Harness\Dsh\plugin-market\lib\client.js" -Pattern 'eval\(','new Function\(' -AllMatches` | eval( 0；new Function( 0；__ModuleLoader__.load >=1；id\s*:\s*["']dsh-plugin-market["'] >=1 | eval(=0 newFunction(=0 ModuleLoaderLoad=1 idMatch=1 clientBytes=103816 | **PASS** |
| 4 | `A0b` | `dsh plugin --profile marketcheck add "E:\AI\DeepSeek Harness\Dsh\plugin-market"` | dsh.profile.bundles 含 dsh-plugin-market；node_modules\dsh-plugin-market 存在 | 安装 exit=True；bundles=[@deepseek-ai/dsh-base, @deepseek-ai/dsh-web-app, dsh-plugin-market, @feiyang666/dsh-usage-plugin]；node_modules\dsh-… | **PASS** |
| 5 | `E1` | `Get-Content "E:\AI\DeepSeek Harness\Dsh\_verify\dshhome\profiles\marketcheck\package.json" -Raw` | bundles 含 dsh-plugin-market；node_modules\dsh-plugin-market\cordis.patch.yml 存在且非空 | bundles=[@deepseek-ai/dsh-base, @deepseek-ai/dsh-web-app, dsh-plugin-market, @feiyang666/dsh-usage-plugin]；cordis.patch.yml 存在=True；长度=537 | **PASS** |
| 6 | `A1` | `/c call "D:\Software\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" --profile "marketcheck" --port 59459 --no-open 1>"E:\AI\DeepSeek…` | 端口就绪；日志 FAILED 行 0；无被测包相关报错；无模块解析失败 | ready=True FAILED行=0 被测包报错行=0 模块解析失败行=0 | **PASS** |
| 7 | `E4` | `GET http://127.0.0.1:59457/__reset` | status=200；ok:true；manager.available=true；catalog 为 null；期间 fixture 请求计数 +0 | status=200 ok=True manager.available=True catalog=null fixture请求数=0（期望 0） | **PASS** |
| 8 | `A2` | `GET <启动日志里的鉴权 URL>  →  解析 globalThis["__DSH_BOOT__"]  →  entries[] 中找 id === 'dsh-plugin-market'` | 存在该 entry；url 形如 plugins/??dsh-plugin-market/client.js&rev=…（契约写绝对 /plugins/…，实测为文档相对，两种都接受） | httpStatus=200 htmlLen=35348 shape=globalThis["__DSH_BOOT__"] entries=67 batches=3 entry=found url=plugins/??dsh-plugin-market/client.js&… | **PASS** |
| 9 | `A3` | `GET http://127.0.0.1:59459/plugins/??dsh-plugin-market/client.js&rev=595c001c1b5f` | HTTP 200；正文含 __ModuleLoader__.load 且含 id:"dsh-plugin-market" | status=200 bytes=110971 hasModuleLoaderLoad=True hasId=True | **PASS** |
| 10 | `A3b` | `GET http://127.0.0.1:59459/plugins/??dsh-plugin-market/client.js&rev=595c001c1b5f  →  [System.Text.Encoding]::UTF8.GetString(原始字节)  →  搜索…` | 解码后包含「插件市场」；且不含替换字符 U+FFFD（中文未变乱码） | utf8DecodedBytes=110971 contains插件市场=True U+FFFD个数=0 | **PASS** |
| 11 | `A4a` | `GET http://127.0.0.1:59459/plugin-market/status` | HTTP 200；ok:true；含 plugin/host/manager/catalog 四个字段；Content-Type: application/json；plugin.name=dsh-plugin-market；plug… | status=200 ok=True 缺字段=[] catalog=null(冷启动，符合契约 §2.1)  plugin.name=dsh-plugin-market plugin.version=1.0.0 manager.available=True host.dsh… | **PASS** |
| 12 | `A4b` | `GET http://127.0.0.1:59459/plugin-market/catalog?query=dsh&pageSize=5` | HTTP 200；ok:true；含 catalog/page/categories/items；page.pageSize=5；items 数 ≤ 5；Content-Type: application/json | status=200 ok=True 缺字段=[] page.page=1 page.pageSize=5 page.total=4200 items=5 categories=23 catalog.count=4412 | **PASS** |
| 13 | `A4c` | `GET http://127.0.0.1:59459/plugin-market/installed` | HTTP 200；ok:true；含 bundles/plugins；bundles 里能找到 name=dsh-plugin-market | status=200 ok=True 缺字段=[] bundles=12 含市场自身=1 plugins=188 | **PASS** |
| 14 | `A5a` | `POST http://127.0.0.1:59459/plugin-market/install  Content-Type: application/json  body={"name":"evil/not-in-catalog-pkg","spec":"evil-no…` | HTTP 403；error.code=cross-origin | status=403 error.code=cross-origin | **PASS** |
| 15 | `A5b` | `GET http://127.0.0.1:59459/plugin-market/install` | HTTP 405；error.code=method-not-allowed；响应头 Allow 含 POST | status=405 error.code=method-not-allowed Allow=POST | **PASS** |
| 16 | `A6` | `POST http://127.0.0.1:59459/plugin-market/install  Origin=http://127.0.0.1:59459  body={"name":"evil/not-in-catalog-pkg","spec":"evil-not…` | HTTP 400；error.code=not-in-catalog（安全约束：只允许装目录内插件） | status=400 error.code=not-in-catalog message=这个插件不在目录里，已拒绝安装。 hint=市场只允许安装目录内的插件；先刷新目录再试。 | **PASS** |
| 17 | `A7` | `POST http://127.0.0.1:59459/plugin-market/remove  Origin=http://127.0.0.1:59459  body={"name":"dsh-plugin-market"}` | HTTP 400；error.code=not-allowed；message 给出终端替代命令 | status=400 error.code=not-allowed message=市场不能卸载自己，请在终端执行 dsh plugin --profile marketcheck remove dsh-plugin-market | **PASS** |
| 18 | `A8a` | `GET http://127.0.0.1:59459/plugin-market/catalog ; Start-Sleep 2 ; GET http://127.0.0.1:59459/plugin-market/catalog` | 两次 catalog.fetchedAt 相同且非空（TTL 10 分钟内不应重新抓取） | status#1=200 fetchedAt#1=2026-10-03T13:44:16.650Z ; status#2=200 fetchedAt#2=2026-10-03T13:44:16.650Z | **PASS** |
| 19 | `A8b` | `POST http://127.0.0.1:59459/plugin-market/refresh  Origin=http://127.0.0.1:59459` | HTTP 200；ok:true；fetchedAt 与刷新前紧邻一次（fa2）不同且非空 | status=200 ok=True fetchedAt#3=2026-10-03T13:44:19.231Z（刷新前紧邻 fa2=2026-10-03T13:44:16.650Z，更早 fa1=2026-10-03T13:44:16.650Z） | **PASS** |
| 20 | `A14a` | `POST http://127.0.0.1:59459/plugin-market/install  headers=Origin  body={"name":"evil/not-in-catalog-pkg","spec":"evil-not-in-catalog-pkg…` | 不返回 403 cross-origin；应继续走到 400 not-in-catalog | status=400 error.code=not-in-catalog | **PASS** |
| 21 | `A14b` | `POST http://127.0.0.1:59459/plugin-market/install  headers=Sec-Fetch-Site  body={"name":"evil/not-in-catalog-pkg","spec":"evil-not-in-cat…` | 不返回 403 cross-origin；应继续走到 400 not-in-catalog | status=400 error.code=not-in-catalog | **PASS** |
| 22 | `A14c` | `POST http://127.0.0.1:59459/plugin-market/install  Origin: http://evil.example  body={"name":"evil/not-in-catalog-pkg","spec":"evil-not-i…` | HTTP 403；error.code=cross-origin | status=403 error.code=cross-origin | **PASS** |
| 23 | `A12` | `GET http://127.0.0.1:59459/plugin-market/definitely-not-a-route` | HTTP 404；error.code=not-found | status=404 error.code=not-found | **PASS** |
| 24 | `A13` | `POST http://127.0.0.1:59459/plugin-market/install  70000 字节 name 字段` | HTTP 400；error.code=bad-request | status=400 error.code=bad-request | **PASS** |
| 25 | `A15` | `POST http://127.0.0.1:59459/plugin-market/toggle  Content-Type: application/x-www-form-urlencoded  Origin=http://127.0.0.1:59459  body=na…` | HTTP 400；error.code=bad-request（同源已放行，所以失败原因必须是 Content-Type） | status=400 error.code=bad-request | **PASS** |
| 26 | `E6` | `GET http://127.0.0.1:59457/__count   # 此前走过 A4b 首次 /catalog、A8a 两次 /catalog、A8b 一次 /refresh` | count == 2（首次抓取 1 + refresh 1；期间所有 /catalog 均命中缓存） | fixture 请求计数=2（期望 2） | **PASS** |
| 27 | `E5-local` | `GET http://127.0.0.1:59459/plugin-market/catalog` | HTTP 200；ok:true；catalog.count 在 4412±0；catalog 含 count/updated/fetchedAt/source/stale；categories 非空；items[0] 含 id/na… | status=200 ok=True catalog.count=4412（期望 4412±0）catalog 缺字段=[] source=http://127.0.0.1:59457/plugins.json updated=2026-10-01 stale=False … | **PASS** |
| 28 | `A11` | `node "E:\AI\DeepSeek Harness\Dsh\verify\adversarial-host.mjs" "E:\AI\DeepSeek Harness\Dsh\plugin-market\lib\index.js"` | exit=0；apply 不抛；/status 报 manager.available=false；/installed 返回空集合；安装类 POST 报 manager-unavailable | exit=0 | **PASS** |
| 29 | `A2` | `GET <启动日志里的鉴权 URL>  →  解析 globalThis["__DSH_BOOT__"]  →  entries[] 中找 id === 'dsh-plugin-market'` | 存在该 entry；url 形如 plugins/??dsh-plugin-market/client.js&rev=…（契约写绝对 /plugins/…，实测为文档相对，两种都接受） | httpStatus=200 htmlLen=35348 shape=globalThis["__DSH_BOOT__"] entries=67 batches=3 entry=found url=plugins/??dsh-plugin-market/client.js&… | **PASS** |
| 30 | `A3` | `GET http://127.0.0.1:59479/plugins/??dsh-plugin-market/client.js&rev=595c001c1b5f` | HTTP 200；正文含 __ModuleLoader__.load 且含 id:"dsh-plugin-market" | status=200 bytes=110971 hasModuleLoaderLoad=True hasId=True | **PASS** |
| 31 | `A3b` | `GET http://127.0.0.1:59479/plugins/??dsh-plugin-market/client.js&rev=595c001c1b5f  →  [System.Text.Encoding]::UTF8.GetString(原始字节)  →  搜索…` | 解码后包含「插件市场」；且不含替换字符 U+FFFD（中文未变乱码） | utf8DecodedBytes=110971 contains插件市场=True U+FFFD个数=0 | **PASS** |
| 32 | `E8-low` | `GET http://127.0.0.1:59479/plugin-market/installed  →  bundles[] 中 name=@feiyang666/dsh-usage-plugin` | 该 bundle 的 latest=1.0.0，updateAvailable=false | 找到=True 已装版本=1.18.0 latest=1.0.0 updateAvailable=False（期望 false） | **PASS** |
| 33 | `E8-market` | `GET http://127.0.0.1:59479/plugin-market/installed  →  bundles[] 中筛选 market === true` | 恰好 1 条 market:true，且其 name === dsh-plugin-market | market:true 条数=1 name=dsh-plugin-market | **PASS** |
| 34 | `A2` | `GET <启动日志里的鉴权 URL>  →  解析 globalThis["__DSH_BOOT__"]  →  entries[] 中找 id === 'dsh-plugin-market'` | 存在该 entry；url 形如 plugins/??dsh-plugin-market/client.js&rev=…（契约写绝对 /plugins/…，实测为文档相对，两种都接受） | httpStatus=200 htmlLen=35348 shape=globalThis["__DSH_BOOT__"] entries=67 batches=3 entry=found url=plugins/??dsh-plugin-market/client.js&… | **PASS** |
| 35 | `A3` | `GET http://127.0.0.1:16748/plugins/??dsh-plugin-market/client.js&rev=595c001c1b5f` | HTTP 200；正文含 __ModuleLoader__.load 且含 id:"dsh-plugin-market" | status=200 bytes=110971 hasModuleLoaderLoad=True hasId=True | **PASS** |
| 36 | `A3b` | `GET http://127.0.0.1:16748/plugins/??dsh-plugin-market/client.js&rev=595c001c1b5f  →  [System.Text.Encoding]::UTF8.GetString(原始字节)  →  搜索…` | 解码后包含「插件市场」；且不含替换字符 U+FFFD（中文未变乱码） | utf8DecodedBytes=110971 contains插件市场=True U+FFFD个数=0 | **PASS** |
| 37 | `E8-high` | `GET http://127.0.0.1:16748/plugin-market/installed  →  bundles[] 中 name=@feiyang666/dsh-usage-plugin` | 该 bundle 的 latest=9.9.9，updateAvailable=true | 找到=True 已装版本=1.18.0 latest=9.9.9 updateAvailable=True（期望 true） | **PASS** |
| 38 | `E8-market` | `GET http://127.0.0.1:16748/plugin-market/installed  →  bundles[] 中筛选 market === true` | 恰好 1 条 market:true，且其 name === dsh-plugin-market | market:true 条数=1 name=dsh-plugin-market | **PASS** |
| 39 | `A2` | `GET <启动日志里的鉴权 URL>  →  解析 globalThis["__DSH_BOOT__"]  →  entries[] 中找 id === 'dsh-plugin-market'` | 存在该 entry；url 形如 plugins/??dsh-plugin-market/client.js&rev=…（契约写绝对 /plugins/…，实测为文档相对，两种都接受） | httpStatus=200 htmlLen=35348 shape=globalThis["__DSH_BOOT__"] entries=67 batches=3 entry=found url=plugins/??dsh-plugin-market/client.js&… | **PASS** |
| 40 | `A3` | `GET http://127.0.0.1:2056/plugins/??dsh-plugin-market/client.js&rev=595c001c1b5f` | HTTP 200；正文含 __ModuleLoader__.load 且含 id:"dsh-plugin-market" | status=200 bytes=110971 hasModuleLoaderLoad=True hasId=True | **PASS** |
| 41 | `A3b` | `GET http://127.0.0.1:2056/plugins/??dsh-plugin-market/client.js&rev=595c001c1b5f  →  [System.Text.Encoding]::UTF8.GetString(原始字节)  →  搜索「…` | 解码后包含「插件市场」；且不含替换字符 U+FFFD（中文未变乱码） | utf8DecodedBytes=110971 contains插件市场=True U+FFFD个数=0 | **PASS** |
| 42 | `E7-fetch` | `Measure-Command { GET http://127.0.0.1:2056/plugin-market/catalog }   # 该宿主 boot 后第一次 /catalog` | HTTP 200；ok:true；端到端耗时 < 3000ms | status=200 耗时=550ms source=npm:dsh-plugin-catalog@2026.1003.4803 (registry.npmmirror.com) count=4412 | **PASS** |
| 43 | `E5` | `GET http://127.0.0.1:2056/plugin-market/catalog` | HTTP 200；ok:true；catalog.count 在 4412±50；catalog 含 count/updated/fetchedAt/source/stale；categories 非空；items[0] 含 id/n… | status=200 ok=True catalog.count=4412（期望 4412±50）catalog 缺字段=[] source=npm:dsh-plugin-catalog@2026.1003.4803 (registry.npmmirror.com) upd… | **PASS** |
| 44 | `E5-env` | `node "E:\AI\DeepSeek Harness\Dsh\verify\lib\netdiag.mjs" "https://awesome-dsh-plugin.com/plugins.json" 120000` | 耗时 > 15000ms 或直接失败 ⇒ 502 catalog-unavailable 是源可达性/超时预算问题，不是路由逻辑问题 | ok=True ms=32368 bytes=5298280（契约单次预算 15000ms） | **PASS** |
| 45 | `E9` | `记录本次跑过的每条 --profile 目标（profile 初始化 / 两次 dsh plugin add / 4 次 dsh web 启动）` | 所有 --profile 目标均为 marketcheck；不出现 desktop 或 web；DSH_HOME 指向 _verify 内的独立目录 | 调用次数=6 目标集合=[marketcheck] 命中 desktop/web=0 DSH_HOME=E:\AI\DeepSeek Harness\Dsh\_verify\dshhome | **PASS** |
| 46 | `E9-info-pkg` | `Get-FileHash "C:\Users\28062\.dsh\profiles\desktop\package.json" -Algorithm SHA256   # 前后各一次` | 记录前后哈希与内容，供 Lead 复核；本条不作通过判据（该 profile 同时被 GUI 会话持有） | before=6413CC433FE384E38979E4AFBA5A8208B753DADC526DDFC47A370120CCAB8AA3 after=6413CC433FE384E38979E4AFBA5A8208B753DADC526DDFC47A370120CCA… | **PASS** |
| 47 | `E9-info` | `Get-FileHash "C:\Users\28062\.dsh\profiles\desktop\cordis.patch.yml" -Algorithm SHA256   # 前后各一次` | 记录前后哈希与内容差异，供 Lead 按内容定性；本条不作通过判据 | before=29C08D0FDAD957860DC55F2B7159884D8C823819EF0911C8D22843A7424DA125 after=29C08D0FDAD957860DC55F2B7159884D8C823819EF0911C8D22843A7424… | **PASS** |

### 3.1 Lead 指定 10 条的对应关系

| Lead 要求 | 对应断言 id | 结果 |
|---|---|---|
| 1 安装断言（bundles 含包 + `cordis.patch.yml` 存在） | `A0b` + `E1` | PASS |
| 2 boot graph 含 entry 且真 GET 到脚本 | `A2` + `A3` | PASS（4 次 boot 各测一遍） |
| 3 bundle UTF-8 解码含「插件市场」 | `A3b` | PASS，U+FFFD 个数 0 |
| 4 `/status` 冷启动 `manager.available=true`、`catalog=null`、零网络抓取 | `E4` | PASS（用 fixture 计数器实测抓取次数 = 0） |
| 5 `/catalog` 真实抓取内容 | `E5` + `E5-local` + `E7-fetch` | PASS，count=4412，23 个分类，items[0] 字段齐全 |
| 6 缓存行为 | `A8a` + `A8b` + `E6` | PASS（`E6` 用请求计数证明整轮只抓 2 次） |
| 7 越权与错误路径 | `A5a` `A5b` `A6` `A7` `A12` `A13` `A15` `A14a/b/c` | PASS |
| 8 `updateAvailable` 双向 + `market:true` | `E8-low` `E8-high` `E8-market` | PASS |
| 9 不碰真实 profile | `E9` | PASS（改为断言「我的调用目标」而非哈希相等，理由见 §7） |
| 10 收尾释放 | 每次 run 的 cleanup 段 | PASS，4/4 端口释放，残留占用 0 |

### 3.2 `E4` / `E6` 的证据强度（比 Lead 预设的退路更强）

Lead 允许「无法观测抓取次数就退而求其次」。实际可观测：把 `DSHM_REGISTRY_URL` 指向本地计数 fixture，用 `/__count` 直接读真实请求数。

- `E4`：`/__reset` → `GET /status` → `/__count`。结果 `{"count":0}`，即**冷启动零网络抓取**，同时 `catalog=null`。
- `E6`：整轮 §5.4–§5.8 结束后 `/__count` = `{"count":2}`。期望值推导：`A4b` 首次 `/catalog` 触发 1 次抓取；`A8a` 两次 `/catalog` 命中缓存；`A8b` 一次 `/refresh` 触发第 2 次。**缓存没有被任何一次多余请求击穿。**

### 3.3 每个 4xx/5xx 断言都有双客户端交叉复核

所有带错误码的断言，正文同时由 `System.Net.HttpWebRequest`（主）与 `curl.exe`（独立第二实现）各读一遍并写入证据。例：

```
A6 主探针：status=400 error.code=not-in-catalog message=这个插件不在目录里，已拒绝安装。 hint=市场只允许安装目录内的插件；先刷新目录再试。
A6 curl  ：status=400 body={"ok":false,"error":{"code":"not-in-catalog","message":"这个插件不在目录里，已拒绝安装。","hint":"市场只允许安装目录内的插件；先刷新目录再试。"}}
```

这样「错误码是空的」只可能是实现没给，不可能是工具没读到。

---

## 4. 首轮 10 条失败的逐条定性

首轮（run `verify-20261003-211745`）29 PASS / 10 FAIL。逐条定性与复核结果如下 —— **8 条是我的工具 bug，1 条是我的断言过期，1 条是真实缺陷**。

| 断言 id | 首轮现象 | 判定 | 原始证据 | 修正后结果 |
|---|---|---|---|---|
| `A4a` | `ok=True 缺字段=[catalog]`，status=200 | **我的断言过期** | 契约 §2.1 规定冷启动 `catalog` 必须是 `null`（首屏不发网络请求）。我把「值为 null」当成「字段缺失」 | PASS：`catalog=null(冷启动，符合契约 §2.1)` |
| `A5a` | `status=403 error.code=` | **我的工具 bug** | PS 5.1 `Invoke-WebRequest` 在 4xx 时抛异常且响应流已被读走/释放，`$_.Exception.Response.GetResponseStream()` 只能得到空正文；`ErrorDetails.Message` 在 5.1 不可靠 | PASS：`error.code=cross-origin`（主探针与 curl 一致） |
| `A5b` | `status=405 error.code= Allow=POST` | 同上 | 头读到了、正文没读到 → 定位到「只有正文路径坏了」 | PASS：`error.code=method-not-allowed` |
| `A6` | `status=400 error.code= message=` | 同上 | — | PASS：`error.code=not-in-catalog` + 中文 message/hint |
| `A7` | `status=400 error.code= message=` | 同上 | — | PASS：`error.code=not-allowed` + 给出终端替代命令 |
| `A12` | `status=404 error.code=` | 同上 | — | PASS：`error.code=not-found` + 可用接口清单 |
| `A13` | `status=400 error.code=` | 同上 | — | PASS：`error.code=bad-request` |
| `A14c` | `status=403 error.code=` | 同上 | 对照：`A14a/A14b` 首轮 **PASS**（它们只需判「不是 cross-origin」，不读正文）—— 正好反证故障点在「读 4xx 正文」 | PASS：`error.code=cross-origin` |
| `A15` | `status=400 error.code=` | 同上 | — | PASS：`error.code=bad-request` |
| `E5` | `status=502`，`source` 空，count 空 | **真实缺陷（源可达性）** | 官方源 `awesome-dsh-plugin.com` 直连：`E5-env` 实测 **32368–93075 ms**（契约 §3 单次预算 15s、重试 1 次共 30s）→ 必然 502。@lead 实测 npmmirror 289 ms | 已由 task-6 修复（源顺序 npmmirror → npmjs → 官方）；修复后 PASS，`E7-fetch`=550 ms |

> 说明：`A5a` 这 8 条的**状态码首轮就是对的**（403/405/400/404），只有正文读不到。这正是「工具没读到」与「实现没给」的唯一区分点，也是我后来给每条错误断言都加 curl 交叉复核的原因。

---

## 5. 工具缺陷与修正

验收报告承认测量工具的缺陷，比只报 29/39 更有价值。共发现并修掉 7 条，每条都写「怎么发现 / 怎么修 / 修后结论」。

### 5.1 `AppendAllText 非法字符` —— 根因是 PowerShell 动态作用域，不是路径内容

- **怎么发现**：chain drill 跑到 A2 时整轮中断：`使用"3"个参数调用"AppendAllText"时发生异常:"路径中具有非法字符。"`。Lead 初判为「把含 `?`/`&`/`:` 的内容当路径追加了」。
- **真实根因**（我复核后推翻初判）：**PowerShell 是动态作用域，脚本块里的变量按「调用时的调用栈」解析，而不是定义处**。断言函数 `EmitBoot` 有一个参数 `$Evidence`，而我的收集器脚本块里引用了证据路径变量 `$evidence`——变量名大小写不敏感，于是 `$evidence` 被解析成参数 `$Evidence`，即**断言文本**，再去当文件路径 → 非法字符。
  - 直接证据：首轮崩溃前 A0/A9/A10/A1 的 `Add-Evidence` 都成功（它们不经过 `EmitBoot`），只有经 `EmitBoot` 的 A2 崩。
- **怎么修**：(1) 断言函数参数改名为 `$EvidenceText`，不再与 `$evidence` 同名；(2) 证据路径统一用 `$script:evidencePath` 显式限定作用域；(3) `Add-Evidence` 加路径校验，失败只记警告、**绝不允许证据记录本身弄死整轮验收**。
- **修后结论**：证据文件完整写入，47 条断言的原始输出全部落盘。

### 5.2 PS 5.1 的 `Invoke-WebRequest` 读不到 4xx 正文

- **怎么发现**：9 条断言 `error.code` 全空，但状态码全对。
- **怎么修**：`Invoke-HttpProbe` 整体改用 `System.Net.HttpWebRequest`（异常路径下 `WebException.Response` 的流是完整可读的），二进制读取后自行 UTF-8 解码（不依赖响应头 charset，顺带把中文乱码风险测实）；并新增 `Invoke-CurlProbe`，所有错误码断言附 `curl.exe` 独立复核。
- **修后结论**：8 条全部转绿且两个客户端正文一致。

### 5.3 `A4a` 断言漂移（契约 §2.1 已改）

- **怎么发现**：`/status` 报 `缺字段=[catalog]`，但同一轮 `E4` 明确要求冷启动 `catalog=null`——两条断言自相矛盾。
- **怎么修**：新增 `Test-PropExists` 区分「字段不存在」与「字段值为 null」；`A4a` 改为「`catalog` 字段必须存在，值为 `null` 或含 `source/count/updated/fetchedAt/stale` 的对象」。
- **修后结论**：PASS，且契约两种状态都被覆盖。

### 5.4 我在修 5.2 时自己引入的回归：丢 cookie 导致首页 401

- **怎么发现**：改用 `HttpWebRequest` 后，`A2/A3/A3b` 由 PASS 变 FAIL，`httpStatus=401`。
- **怎么修**：`HttpWebRequest` 不像 `Invoke-WebRequest` 会自动建 cookie 容器；显式 `$req.CookieContainer = New-Object System.Net.CookieContainer`，重定向后 cookie 才能带到文档请求。
- **修后结论**：首页 200、boot 图可解析、无 token 仍 401。

### 5.5 `curl.exe` 交叉复核自己把 JSON 正文改坏了

- **怎么发现**：`A6`/`A7` 的 curl 复核返回 `bad-request`（"请求体不是合法的 JSON"），与主探针的 `not-in-catalog`/`not-allowed` 不一致。原因：PS 5.1 往 `curl.exe` 传含引号/大括号的 JSON 字符串时命令行引号被剥掉。
- **怎么修**：正文写入临时文件，用 `--data-binary @<file>` 传递；两个临时文件都在 `finally` 里清理。
- **修后结论**：curl 与主探针正文逐字一致（`A6`/`A7`/`A13`/`A15` 已复核）。**如果没修，这条「独立复核」反而会制造假证据。**

### 5.6 一批 PowerShell 5.1 特有的坑（都已修）

| 坑 | 症状 | 修法 |
|---|---|---|
| `write` 出来的是 LF-only，5.1 按 ANSI 解码无 BOM 的 UTF-8 | 中文注释末尾字节吞掉 `\n`，注释吃掉下一行 → 解析失败 | 所有 `.ps1` 统一加 UTF-8 BOM 并归一化 CRLF（`lib/add-bom.ps1`，附 `ParseFile` 零错误校验） |
| `ProcessStartInfo.ArgumentList` / `.Environment` 在 .NET Framework 不存在 | 起宿主直接失败 | 改用 `Arguments` 字符串 + `EnvironmentVariables` |
| `.cmd` 不能被 `CreateProcess` 直接执行 | — | 统一 `cmd.exe /c call "<x.cmd>" … 1>out 2>err` |
| `[string]$Body = $null` 不给值时是 `''` | GET 会被附上空正文 → `无法发送具有此谓词类型的内容正文` | 判 `IsNullOrEmpty` |
| `Set-StrictMode -Version Latest` 下裸取 `.Response` | 非 WebException 上抛 `PropertyNotFoundException`，把 4xx 探测变成工具崩溃 | 类型判断 + 沿 `InnerException` 链查找 |
| `return @()` 被展开成「无输出」 | 调用方拿到 `$null`，`.Count` 崩 | `Get-ArrayProp` 用 `return ,@()` |
| `$args` 是自动变量 | wrapper 里 `$args = @()` 赋值无效，`-SkipLive` 被当成 `-PluginDir` 的值 | 改用 `$forward` |
| `$Profile` / `$Evidence` 等与自动变量、被调用方参数同名 | 见 5.1 | 命名规避 + `$script:` 限定 |

### 5.7 断言自检（selfcheck）证明断言本身可信

`verify/selfcheck.ps1` 把同一套断言函数指向**故意违反契约的 stub**，并断言：

1. 15 条市场断言**全部 FAIL**（不能有「意外 PASS」——那说明断言无效）；
2. boot 图「好/坏」两向：A2/A3/A3b 必须一绿一红；
3. **FAIL 要有道理**：`A6` 必须读到 `error.code=cross-origin`、`A14c` 必须读到 `internal`，且 curl 复核正文里也有同样的码。

这三条里第 3 条是补强——**没有它，首轮那 9 条「因为读不到正文而 FAIL」会被自检误判为「断言有效」**。selfcheck 现为 PASS。

自检还抓出两个真问题：`A8b` 原先与「最早一次」而非「紧邻上一次」的 `fetchedAt` 比较（假阳性，已改为与 `fa2` 比较）；boot 断言里 `'…' + $AssertId + '"'` 在**参数模式**下 `+` 不是运算符，参数错位导致 `[bool]$Pass` 收到字符串（已加括号）。

---

## 6. E5 从 FAIL 到 PASS

保留原始失败记录，不粉饰。

**失败记录（run `verify-20261003-211745` / `213010`）**

```
E5 预期: HTTP 200；ok:true；catalog.count 在 4412±50；categories 非空；items[0] 字段齐全
E5 实际: status=502 ok= catalog.count= categories=1 items=1 source=
```

**根因（两条独立证据）**

1. `E5-env`：`node netdiag.mjs https://awesome-dsh-plugin.com/plugins.json 120000` → `ok=True ms=32368 bytes=5298280`；另一轮 `ms=93075`。契约 §3 单次预算 `AbortSignal.timeout(15000)` + 重试 1 次 = 30s 总预算，**必然超时** → `502 catalog-unavailable` 是**契约内正确的降级行为**，不是路由逻辑错误。
2. 对照：同一台机器用 PowerShell（走系统代理 `127.0.0.1:7890`）9.8s 可下载；Node 直连 57–93s。@lead 另测 npmmirror 289 ms。

**修复（task-6，已落地）**：源顺序改为 npmmirror → npmjs → 官方 URL；`DSHM_REGISTRY_URL` 非空则只用它。

**修复后（run `verify-20261003-214407`）**

```
E7-fetch: status=200 耗时=550ms source=npm:dsh-plugin-catalog@2026.1003.4803 (registry.npmmirror.com) count=4412
E5      : status=200 ok=True catalog.count=4412 catalog 缺字段=[] source=npm:dsh-plugin-catalog@2026.1003.4803
          updated=2026-10-01 stale=False categories=23 items=24
E5-env  : ok=True ms=32368（官方源直连仍然超预算 → 保留该条断言，作为「为什么需要镜像优先」的常驻证据）
```

`E5-env` 保留并**期望 PASS**，语义是「Node 直连官方源超过契约预算」——它证明镜像优先不是可选优化而是必需。`E5`（真实源 200 + 内容齐全）与 `E5-local`（未改动的 4412 条快照，不注入、count 严格 =4412）同时绿，说明内容正确性不依赖网络路径运气。

---

## 7. 真实 profile（desktop）—— 我改了什么，别人改了什么

**E9 的断言被重新设计过**，这一点必须先说清：

- 最初写成「验收前后 desktop `package.json` / `cordis.patch.yml` SHA256 一致」。**这是竞态断言，无效**：真实 `desktop` profile 同时被运行中的 GUI 与 Lead 会话持有，验收窗口内确实被外部改动过。
- 改为断言**可归因于我自己的事实**：本次每一条 `dsh` 调用都指向自建 profile。实测 `调用次数=6 目标集合=[marketcheck] 命中 desktop/web=0 DSH_HOME=E:\...\_verify\dshhome`。代码层还有硬约束：`Invoke-DshPlugin` 遇到 `Profile=desktop|web` 直接 throw。
- 前后指纹降级为信息性记录（`E9-info-pkg` / `E9-info`），如实呈现，不作通过判据。

**真实 desktop profile 在验收窗口内的变化（外部会话所为，非本工具）**

| 时间 | 文件 | 变化 | 归因证据 |
|---|---|---|---|
| 21:31:48 | `cordis.patch.yml` 933B → 1429B | 新增 `llm-pi-ai`（provider `xiaomi`，`apiKeyEnv: XIAOMI_API_KEY`）与 `permission`（presets + `defaultPreset: workspace-write`）两条 setting | 内容是设置形状（provider/preset），不是插件安装形状；`.plugin-manager\logs` 在 20:39:34 之后**没有**新增 `operation-*` |
| 21:32:25 | `cordis.yml` 45453→45433B、`pnpm-lock.yaml`、`node_modules`、`.plugin-manager` | 出现 `operation-HWxeu3` → 有一次真实 plugin-manager 操作 | 该 operation 目录非我创建；我本轮所有 plugin 操作都在 `_verify\dshhome` |
| 21:38:35 | `package.json` 441B → 419B | **移除** `@feiyang666/dsh-usage-plugin` 依赖与 bundle 行；**加入** `@deepseek-ai/dsh-experimental-voice-input-bundle`、`@deepseek-ai/dsh-experimental-schedule-bundle` | 时间点落在我的 Boot#3 与 Boot#4 之间；该操作需要 GUI/Lead 会话发起；`dsh-plugin-market` **未**出现（task-4 尚未执行） |

**SHA256 记录（供 Lead 安装前复核）**

| 文件 | 我第一次取到 | 最终取到 | 说明 |
|---|---|---|---|
| `desktop\package.json` | `A93EF6A5CAFDE6EEFCEE453BA60B4A254EC73800E49D7C6B4305484EA6FEA541`（441B，含 usage 依赖） | `6413CC433FE384E38979E4AFBA5A8208B753DADC526DDFC47A370120CCAB8AA3`（419B，已换 bundle） | 变化由外部会话造成，见上表 |
| `desktop\cordis.patch.yml` | `6732274A026DAE9720C12B98905BE09DF1A1BC04B05BA15CB144D8568FECF04C` → 21:31:48 后 `29C08D0FDAD957860DC55F2B7159884D8C823819EF0911C8D22843A7424DA125` | `29C08D0FDAD957860DC55F2B7159884D8C823819EF0911C8D22843A7424DA125`（1429B，最后两轮未再变） | 同上 |

**真实 DSH_HOME 的 profile 目录**：只有 `desktop` 与 `web`（探路时误建的 `__nonexistent__` 与 desktop 下 0 字节的 `operation-b6F62n` 已在 21:02 清理，并向 Lead 报告）。

---

## 8. 未覆盖项 / 已知偏差

| 项 | 说明 |
|---|---|
| **未在真实浏览器里断言渲染结果** | 我验证到「bundle 被 boot 图引用、可 200 取到、按 UTF-8 解码中文完整、无 `eval(`/`new Function(`、含正确 `id`」为止。侧边栏底部入口的实际渲染/选中态/窄屏行为未断言 —— 那需要 Lead 的整窗截图核对（task-4）。 |
| 官方 URL 兜底最坏 ~30s | 契约 §3 的 15s×2 预算下，若镜像与 npmjs 同时不可用，用户会等满 30s 才看到 `catalog-unavailable`。这是契约规定值，不是实现偏差；作为风险记录。 |
| `updateAvailable` 只用注入值验证 | 真实目录里没有 `@feiyang666/dsh-usage-plugin`（唯一 feiyang 命中是别人的 `dsh-settings-drawer`），所以两个方向都用 fixture 注入版本（1.0.0 / 9.9.9 vs 已装 1.18.0）验证。逻辑正确性已验证，但**未用真实目录里的真实版本差**验证过。 |
| `install` / `remove` / `toggle` 的成功路径未端到端跑 | 契约 §5 只要求错误路径（403/405/400）。成功安装会真的改 profile 并跑 pnpm，影响面大，未在本轮触发；`A6` 已证明「目录外 spec 被拒」这一安全约束有效。 |
| `POST /install` 的 `pendingBuilds` 确认流未验证 | 需要真实触发构建脚本批准，未构造。 |
| `host.dsh` 取值为空 | `A4a` 实测 `host.dsh=`（空串）。契约 §2.1 允许 `ctx.get('profileContext')` → `DSH_VERSION` → `null` 的取值顺序；本轮宿主两者都没有，故为空。不影响 §5 断言，但记录为观察值。 |

---

## 9. 交付物与复现方式

### 9.1 交付物清单

| 路径 | 作用 |
|---|---|
| `scripts/verify-market.ps1` | **入口**：`-SelfCheck` / `-SkipLive` / `-SkipAdversarial` / `-KeepHosts` / `-PluginDir` |
| `verify/verify-market.ps1` | 验收编排：4 次 boot（fixture 未注入 / 注入低版本 / 注入高版本 / 真实源） |
| `verify/selfcheck.ps1` | 断言自检：错误 stub 上全红 + boot 图好/坏两向 + 交叉复核一致性 |
| `verify/lib/Common.ps1` | 工具库：找空闲端口、起/杀宿主、鉴权 URL、`__DSH_BOOT__` 解析、HTTP 探针（HttpWebRequest + curl 双实现）、断言框架、证据记录 |
| `verify/lib/BootChecks.ps1` | §5.2/§5.3 + UTF-8 编码断言（A2/A3/A3b） |
| `verify/lib/MarketChecks.ps1` | §5.4–§5.8 + 越权/错误路径（A4a…A15） |
| `verify/lib/ExtraChecks.ps1` | Lead 指定的 E1/E4/E5/E8 |
| `verify/lib/stub-server.mjs` | 故意违反契约的 stub（wrong-market / boot 好图坏图） |
| `verify/lib/catalog-fixture.mjs` | 受控目录源：只读 4412 条快照 + 请求计数 + 可注入版本 |
| `verify/lib/netdiag.mjs` | Node 直连目录源的耗时测量 |
| `verify/adversarial-host.mjs` | 假 cordis ctx（无 `pluginManager`）驱动 host 半，断言不抛未捕获异常 |
| `verify/lib/add-bom.ps1` | 给 .ps1 加 UTF-8 BOM + CRLF 并做零错误解析校验 |
| `verify/drill-boot.ps1` | 起宿主/取鉴权/抓首页的链路演练（与实现无关） |
| `verify/REPORT.md` | 本报告 |
| `_verify/logs/verify-20261003-214407.evidence.log` | **最终轮全部原始输出**（每条断言的命令/预期/实际/正文） |
| `_verify/logs/verify-20261003-214407.summary.json` | 机器可读断言结果 |
| `_verify/dshhome/profiles/marketcheck` | 临时 profile（独立 DSH_HOME 内） |

### 9.2 复现命令

```powershell
cd 'E:\AI\DeepSeek Harness\Dsh'

# 断言自检（快，不联网）——应先跑这个，确认测量工具可信
pwsh -File scripts/verify-market.ps1 -SelfCheck

# 完整验收（4 次 boot；含真实源，约 3–5 分钟）
pwsh -File scripts/verify-market.ps1

# 离线版（跳过真实源那一段）
pwsh -File scripts/verify-market.ps1 -SkipLive
```

### 9.3 运行历史（含被修正的失败轮，供审计）

| 运行 id | 结果 | 说明 |
|---|---|---|
| `verify-20261003-211325` | 6/6（phase=chain） | 用已装 usage 插件演练测量链路 |
| `verify-20261003-211639` | 中断 | 我的工具 bug：fixture 端口参数顺序不匹配 |
| `verify-20261003-211745` | 29 PASS / 10 FAIL | 首轮；10 条失败定性见 §4 |
| `verify-20261003-213010` | 31 PASS / 13 FAIL | 修完 4xx 正文后；新暴露丢 cookie 回归 + A2/A3/A3b 401 |
| `verify-20261003-213248` | 45 PASS / 0 FAIL | 修完 cookie 后 |
| `verify-20261003-213545` | 46 PASS / 0 FAIL | 加 `E7-fetch` |
| `verify-20261003-213818` | 45 PASS / 1 FAIL | `E9` 因外部会话改写 desktop `package.json` 而红 → 促使 `E9` 重新设计（§7） |
| **`verify-20261003-214407`** | **47 PASS / 0 FAIL** | **最终轮** |
| `selfcheck-20261003-212959` / `213804` | PASS | 断言自检（含「FAIL 要有道理」补强） |

---

## 10. 收尾状态

| 项 | 状态 |
|---|---|
| 后台宿主进程 | 4/4 已 `taskkill /T /F`；`Get-NetTCPConnection -State Listen` 对 `2056/16748/59459/59479` 及历轮全部端口（2725、17435、53952、64768、3631、2540、44801、32586、59370）复核 **listen=0** |
| fixture / stub Node 进程 | 全部随 `Stop-NodeServer` 结束，无遗留 |
| 临时 profile 路径 | `_verify\dshhome\profiles\{marketcheck, chaincheck, drill, mk1, probe1}` |
| 对照插件副本 | `_verify\vendor\dsh-usage-plugin`（从 desktop `node_modules` 复制，只读用途） |
| 真实 `C:\Users\28062\.dsh` | 只读访问（取 SHA256 与 operation 目录清单）；`desktop` 的两处变化均为外部会话所为，见 §7 |
| `plugin-market/**` | **未修改**（本轮所有写操作在 `verify/**`、`scripts/verify-market.ps1`、`_verify/**`） |
