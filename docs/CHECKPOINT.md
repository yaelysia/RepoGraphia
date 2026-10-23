# RepoGraphia 当前检查点

## CP43：工作区离线导出保留逐条引用核对

2026-10-23，`fix/offline-reference-export`，基线 master `fac543b52dd46a68e624387f70ebd19acdd43c29`。用户在固定样本上完成 M1→M2→M3 后报告：工作区 10 条依据匹配，离线 HTML 却全部失效。已复现并修复导出缺失引用核对上下文的问题；冻结结果绑定所选代码与标注版本，保留原依据、人工决定、候选限制和严格 assess／迁移规则。代码节点、功能分页和详情统一展示；编辑、成功导入或迁移后撤销旧核对。

Linux / Node 24.19.0 / 锁定 TypeScript 5.9.3：完整 **518 pass / 0 fail / 0 skip**；新增导出浏览器 **14 组**、原 M2 浏览器 **14 组**通过，均无浏览器异常或外部请求。导出回归使用真实 loopback 下载，并在服务关闭后通过实际 `file://` 打开；红测已确认旧导出缺少核对结果。Windows/Linux/sample 的最终 CI、PR 和合并状态须按本轮远端 HEAD 核对，不能用本地结果代替。

先读 [CP43](checkpoints/CP43-workspace-reference-export.md)。升级构建后重开原工作区，选择相同代码和标注版本，重新“导出报告”即可复测，无需重跑 Agent。普通 `features render` 仍采用严格快照规则；旧 HTML 不会自动补齐工作区上下文。

## CP42：M3 CI 动效定位修复与本地试用教程

2026-10-23，`feat/development-review`，PR #14。实现 HEAD `fb2d430bfff80e58243709e7eb4a2aa6047c8f72` 的 Verify #58：Windows 全部通过（508 pass / 3 项既有符号链接权限 skip），sample 通过；Linux 511 单元通过，但 M2 浏览器脚本把短暂的不可交互动效副本与当前节点一起匹配，strict-mode 失败，之后的 M3 浏览器 gate 未运行。

已将测试定位限定为当前场景，新增真实导航产生副本、暂停其动效后仍点击当前节点的回归，先红后绿；保留产品动效。修复后的本地完整 **511 pass / 0 fail / 0 skip**，M2 浏览器 **14 组通过**，0 异常／外网。新增 [Windows 本地试用 M1 / M2 / M3](m123-local-trial.md)，按实际按钮串起任务包、外部 Codex、开发起点、保存代码、续分析、审阅与重开。

详情见 [CP42](checkpoints/CP42-m3-ci-motion-recovery.md)。本地通过后发布新的精确 HEAD；修复后的跨平台 CI、合并提交和 master 验证以 [PR #14](https://github.com/yaelysia/RepoGraphia/pull/14) 为准。用户已授权修复后全绿即合并，不要用 #58 的部分成功代替新 HEAD 的完整门禁。

## CP41：M3 开发过程与结果审阅完成本地验收

2026-10-23，`feat/development-review`。固定目标、功能级前后比较、范围外／未归属提示、独立人工审阅／外部核验自述、可靠保存和暗色左右开发审阅已接通。每条记录绑定实际前后代码与标注，新版本不继承旧结论，迟到响应和冲突保留草稿；源码／地图往返可保留同份比较的未保存记录。

Linux / Node 22.18.0 / TypeScript 5.9.3 完整 **511 pass / 0 fail / 0 skip**；新 M3 真浏览器 **18 组**、原 M1 **14 组**、原 M2 **13 组**通过，异常与外网请求均为 0。先读 [CP41](checkpoints/CP41-development-review-validation.md) 与 [开发审阅](development-review.md)。最终远端 HEAD/tree、跨平台 CI 及合并状态以本轮 PR 为准；本地通过不等于已合入 master。M2 合并后 Verify #57 已成功。

## CP40：M2 跨平台通过并已合并，M3 开发审阅开始

2026-10-23。M2 PR #13 的 Verify #56 全部通过：Linux 470 pass，Windows 467 pass / 3 项既有符号链接权限 skip，固定样本及两平台所有浏览器 gate 全绿。已合入 master `a89d60e5203e84b318e5033026c8402cdf588017`，merge tree 与受测 tree `7308d7ec319e1fc859b492ce1e2bca40a4954c82` 一致。

用户授权推进 M3，分支 `feat/development-review`：固定声明目标、功能级前后变化、未归属变化、独立的人工代码审阅与外部核验记录，以及暗色左右开发审阅界面。先读 [CP40](checkpoints/CP40-development-review-start.md) 和 [产品方向](product-direction.md)。M3 正在实施，后续验收与精确远端状态以新检查点/PR 为准；不要重做已完成的 M2。

## CP39：M2 合入修复基线后，完整本地验收通过

2026-10-22，`feat/feature-incremental` 已包含 CP38 功能建设与 CP37 输入顺序修复。Linux / Node 22.18.0 / 锁定 TypeScript 5.9.3：完整 **470 pass / 0 fail / 0 skip**；M2 真服务浏览器 **13 组**、原工作区 **14 组**、离线换行/CSP **6 夹具**均符合预期，0 浏览器异常/外网请求。Skill 1.3 的任务修订实际试跑已完成，旧追加流程保留。

先读 [CP39 验收与发布](checkpoints/CP39-feature-incremental-validation.md)、[CP38 实现](checkpoints/CP38-feature-incremental-implementation.md) 与 [功能建设使用说明](feature-tasks.md)。精确远端 HEAD/tree、M1/M2 的最终 CI 及合并状态以对应 PR 为准；接手先核对远端，不把本地验收写成跨平台已通过。M2 不启动 Agent，不自动接受功能关联，不改变旧 assess/migration。

## CP38：M2 功能建设与增量修订已完成本地验收

2026-10-22，分支 `feat/feature-incremental`。三类固定任务、外部 Agent 修订协议/CLI、Skill 1.3、逐原依据的只读引用核对、持久化提案与整批人工应用，以及暗色左右「功能建设」已接通。新增/改义关联保持待审，迟到结果保持可读但不能覆盖现状，未归属代码与探索声明分别展示；不启动 Agent，也不将底层完整重建称为局部增量提取。

Linux / Node 22.18.0 / TypeScript 5.9.3 完整单元 **464 通过 / 0 失败 / 0 跳过**；真实 loopback Chromium 的 M2 **13 组**、原工作区 **14 组**通过，均 0 浏览器异常/外网请求。M1 PR #12 的 CP37 输入顺序修复需合入最终 M2 基线（本地 project.ts 已包含等价修复），随后核对精确 PR HEAD 的 Windows/Linux/sample CI。先读 [CP38](checkpoints/CP38-feature-incremental-implementation.md)、[功能建设](feature-tasks.md)、[产品方向](product-direction.md)。本阶段尚未报告 M2 合并到 master。

## CP37：M1 跨平台单元通过，已修复样本暴露的输入顺序回归

2026-10-22。PR #12 实现 `0b54d17913af5e1b1df4d2111272fb40af385222` 的 Verify #53：Linux 与 Windows job 全部通过，固定样本的项目地图比较失败。已定位输入捕获读取器排序会改变 TypeScript 原始目录遍历，甚至影响触及预算时保留的候选；现已保持编译器原始返回顺序，仅排序捕获副本。另将样本校验改为完整关系事实多重集比较，排除快照内关系 ID/外层顺序，仍保留全部来源、预算、截断和重复数。

新增 3 个输入回归先红后绿；输入与比较脚本共 20 项定向检查通过。独立旧分析器与当前实现对同输入预算夹具的 files/nodes/原始 relations/coverage/diagnostics 全等。见 [CP37 修复记录](checkpoints/CP37-input-order-recovery.md)。修复后的全套与 CI 以 PR 最新 HEAD 为准，不能把 #53 的单元通过当成整个 M1 已通过。M2 已获用户授权，在独立 `feat/feature-incremental` 工作树推进，合并前同步此修复；原主工作树继续用于 M1 收尾。

## CP36：持续工作区 M1 已实现并完成本地验收

2026-10-22。分支 `feat/continuous-workspace`，基线为 PR #11 合并后的 `6f482f514965be44fb0a55c67d809f31aa5f3d56`。已实现绑定单项目的本机工作区、已保存文件自动核对与完整重建、代码/标注版本持久化、实际工作区任务起点、固定前后版本的代码变化比较，以及暗色工作台中的保存与版本切换。后台新图不会替换当前阅读或未应用表单，旧功能标注保留原依据；功能语义增量和外部 Agent 修订任务仍属于 M2。

本地 Linux / Node 22.18.0 / TypeScript 5.9.3：完整单元 **382 pass / 0 fail / 0 skip**；真实本机服务的 Chromium 工作区 **14 组通过**；原报告换行/CSP **6 个夹具符合预期**，浏览器异常与外网请求均为 0。恢复回归覆盖配置删除、数据损坏、死进程锁与并发获取、关闭后写入、失败发布后的孤儿快照。Windows/Linux CI 和固定样本验收需对本轮 PR 的实际 HEAD 单独核对，尚不能由本地结果代替。

先读 [持续工作区](continuous-workspace.md)、[CP36 实现与验收](checkpoints/CP36-continuous-workspace-implementation.md) 和 [产品方向](product-direction.md)。本次没有执行目标项目、调用模型或改写用户试跑数据。输入捕获升级会改变重新分析的 snapshot；原配对 graph/features 仍可离线重渲染，不能将旧标注冒充新工作区基线。接手先查远端最新 master、工作分支及 PR/CI，避免因对话中断重复开发。

## CP35：下一阶段方向已确定，持续工作区尚未实现

2026-10-22，用户明确项目目的是降低 vibe coding 理解成本，支持开发前理解、开发中审阅实际工作、开发后比对，让弱代码者保持掌控。选择围绕功能继续探索＋项目连续使用；底层代码图跟随工作区，上层功能图增量维护；内容先全项目粗图再深入；初版继续使用外部 Agent，界面启动后置。

先读 `docs/product-direction.md`、`docs/checkpoints/CP35-continuous-review-plan.md`。当前实现基线为 `9f214103abd9debda6cb3e4b615c68460cf8f381`，本计划分支 `docs/continuous-review-plan`；本次仅文档。M1 将补连续工作区、保存、自动重建、任务基线和代码变化比较；M2 补局部功能修订和任务交接。不要把当前全量重建称为增量提取，也不要用监听事件推断 Agent 意图。接手先核对最新 master 与计划 PR，原 UI 实现验收见 CP34。

## CP34：统一暗色工作台已完成跨平台验收

2026-10-22，项目地图与功能映射已统一为固定暗色工作台，保留一致顶栏、搜索、左右阅读区与跨模式状态；目录/文件节点重构、蓝紫光晕/点阵和明显有限动效完成。分支 `feat/unified-dark-workbench`，PR [#10](https://github.com/yaelysia/RepoGraphia/pull/10)。远端实现 HEAD `4b41d615421cfc89bcb36d7cb30007258fdf74b8` 的 [Verify #48](https://github.com/yaelysia/RepoGraphia/actions/runs/39741083588) 全部通过：Linux 332 pass；Windows 329 pass、3 项既有符号链接权限 skip；两平台各 69 项共享界面、48 项功能工作台、41 项关联代码场景和 6 个启动/CSP 夹具符合预期，固定真实样本各 gate 全绿。

先读 `docs/checkpoints/CP34-unified-dark-workbench-validation.md`、`docs/project-map.md`、`docs/feature-map-visual.md`。CP32/33 保留范围与实现过程。本检查点只更新验收文档；最终文档 HEAD 的 CI、合并提交及合并后 master CI 在 PR #10 描述中核对，不用 #48 代替。接手先核对远端最新 master 与 PR 状态，合并后直接使用 master；已有结果仅需使用原配对 graph.json/features.json 重渲染到新 HTML，无需重扫或重跑 Agent。

## CP33：统一暗色工作台已实现，等待跨平台 CI

2026-10-22，用户要求项目地图与功能映射共用一致暗色 UI，改善背景、颜色和切换动效。基线 master 为 `3eb50e0eae6c720a28b59adf5e2da3e3601bc4b0`（PR #9 已合并，Verify #47 全绿），开发分支 `feat/unified-dark-workbench`。共享暗色 shell、项目节点重构、背景/动效和跨模式状态恢复均已实现；本地 332 单元测试、新 shell 69 项、原工作台 48 项、场景 41 项、CSP 6 个夹具与公开样本原五套浏览器检查通过。精确环境、产物来源与最后一次响应式修正见 `docs/checkpoints/CP33-unified-dark-workbench-implementation.md`，范围计划保留在 CP32。下一步是本轮 PR 的 Windows/Linux 与固定样本 CI；不要用 CP31 或基线 #47 代替。

## CP31：极简功能工作台已完成跨平台验收

2026-10-22，用户选定的「极简工具」设计已接入正式离线渲染器：左图右阅读区、显式递归层级、搜索定位、状态恢复与进入/返回动效。开发分支 `feat/minimal-function-workbench`，PR [#9](https://github.com/yaelysia/RepoGraphia/pull/9)。实现 HEAD `039998876b722e35c22d7dd15c6cc05970842fbf` 的 [Verify #45](https://github.com/yaelysia/RepoGraphia/actions/runs/39728469228) 全部通过：Linux 332 pass；Windows 329 pass、3 项既有符号链接权限 skip；两平台各 48 项新工作台、41 项原场景及 6 组启动/CSP 检查通过，固定真实样本 gate 全绿。

先读 `docs/checkpoints/CP31-minimal-workbench-validation.md`、`docs/feature-map-visual.md`；CP28/29/30 保留设计、层级契约和实现过程。本检查点只新增验收/接手文档，不再改变实现；最终文档 HEAD 的 CI、合并提交和合并后 CI 另在 PR #9 描述中核对，不用 #45 代替。接手先核对远端最新 master 与 PR 状态；合并后直接使用 master，不重复开发。旧 schema 1/2 标注可直接重渲染，但不会自动获得未标注的子功能。以下 CP27 保留为上一阶段记录。

## CP27：功能节点、关联代码子图与分层审阅完成

2026-10-21。本轮实现与锁定版本的 Windows/Linux 验收已完成，PR #8。开发分支为 `feat/readable-feature-map`，基线 master 为 `470be6c73654991e0d43090a30f27ac428a7e8fc`。最终文档 HEAD、后续 CI 和合并结果记录在 PR #8 评论；接手先核对 PR/分支状态，合并后从 master 继续，不重复实现。

先读 AGENTS.md。本轮设计、实现和验收分别保存在 `docs/checkpoints/CP25-feature-readability-plan.md`、`CP26-feature-scene-implementation.md`、`CP27-feature-scene-validation.md`。阅读方式见 `docs/feature-map-visual.md`，安装及重渲染见 README。

## 精确已验证版本

- 完整实现/测试/使用文档 HEAD：`2752f30278eca07559a6c05a2a6687ddf043e767`。
- tree：`bf97f10041a8c3255186c7d93ed39bfb88df4bc2`。
- Verify #42：`39558742742`；实际 CI 合并测试提交：`ea5bfffbb11e35c1b01f3f2daf9adcead238e12e`。
- Linux job `119084649801`、Windows job `119084649570`、sample job `119084649926` 均 completed/success。
- 本 CP27 提交只更新接手/验收文档，不改变实现；它的最终 CI 单独核对，不用 #42 冒充。

## 已交付行为

紧凑功能节点 → 按入口/实现/支撑/测试分组的代码块 → 完整说明、源码和关系证据。默认支撑/测试折叠，数量可见；完整分页列表保留。方法显示真实词法上下文，原符号/ID 仍可查。源码和证据返回保留原功能及展开范围。

默认连线只表示显式功能映射；可选调用箭头只来自原图 call/construct/tag，候选仍是候选，折叠端点与数量预算明确披露。不推断功能依赖，不把分组当执行顺序。原编辑、审阅、迁移、导入/导出使用同一套模型。

没有改动静态分析规则、CodeGraph/FeatureMap schema、Skill、用户功能含义、审阅决定或 Codex-Monitor。用户未推送的 `codex/agent-trial-01` 不是远程依赖，未改写该分支。

## 实际验证

| 检查 | 结果 |
| --- | --- |
| Linux / Node 22.23.3 / 锁定 TS 5.9.3 | 308 pass / 0 fail / 0 skip |
| Windows / 同版本 | 305 pass / 0 fail / 3 项既有符号链接权限 skip |
| 新功能地图 Chromium | 两平台各 41 项通过，实际 file:// |
| 换行/CSP 启动回归 | 两平台各 4 正例 + 2 必须拦截的负例通过 |
| 固定真实样本与原五套浏览器回归 | 全部通过，含功能编辑、迁移、Agent 报告 |
| 用户实际 3 功能/39 映射重渲染 | 本地 21 检查通过；原图、说明、映射、决定与历史不变 |

用户产物检查与截图使用本地受限浏览器的字节保真 set_content；不是 CI 中执行用户项目，也不是独立的用户可用性/模型质量评测。上传源码/图/标注未提交仓库。源码归档与受测本地改动逐字节核对，Windows 产物 ZIP 哈希和 41 项检查记录也已复核。

## 安装与已有结果升级

PR #8 合并后，保留本地未提交修改，在工具目录更新 master：

```sh
git fetch origin
git switch master
git pull --ff-only origin master
npm ci --ignore-scripts
npm run build
```

已有 Agent 结果只需配对它原来使用的 graph.json 和 features.json，不需要重扫或重跑 Agent：

```sh
node dist/cli.js features render "./reports/codex-monitor-r1/graph.json" "./reports/agent-trial-result-01/features.json" --out "./reports/feature-map-v2.html"
```

输出文件必须不存在，已存在就换新名称。打开新 HTML 后点击「功能映射」。原 HTML 不会自动更新；不要手改 snapshot 让不匹配的数据通过。页面编辑仍需导出 JSON 保存。

## 接手边界

本轮实现已保存远端，不依赖助手临时目录。下一轮以实际使用反馈改进布局/文字层级，不为让图热闹而添加猜测关系。当前标题和说明仍是原标注内容；没有自动生成简称、自动筛选所谓关键函数、自由拖拽布局、全项目功能完备性或运行时顺序保证。需要新增能力时另建小范围分支并保存检查点。
