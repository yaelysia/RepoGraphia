# CP38 — M2 功能建设与增量修订

2026-10-22。用户明确授权推进 M2。开发分支 `feat/feature-incremental`，独立工作树 `RepoGraphia-m2`，最初从 M1 `0b54d17913af5e1b1df4d2111272fb40af385222` 创建。M1 输入顺序问题另在 CP37 修复，精确修复 HEAD 为 `b03dc111c7ecbeae866a711651ce416172d41259`；合入主分支与最新 CI 状态以 PR #12 为准，M2 最终需包含该修复。

## 已实现的可用切片

- 全项目粗图、围绕显式功能子树深入、按变化续分析三类固定任务；任务授权枚举文件、功能和关联，完整图供证据上下文查询。
- 外部 Agent 独立 `revisionProtocol: 1`：新增/修订功能、追加/替换关联、有理由的撤销、支持/限制引文与探索声明。
- `agent task overview/search/inspect/relation/check/submit`，新版 Skill 1.3 分流；原 append 协议保留。
- 只读引用核对独立于原人工决定及旧 assess/migration：逐条原 basis、精确锚点、完整静态邻域、候选/未知/预算信息；只对 matched 返回当前跳转。
- 新代码及没有当前有效映射的实体保留待探索。探索声明来自已应用提案的固定文件哈希，不能作为理解完成率。
- 持久化任务/提案、可读的迟到结果、整批人工应用/拒绝，以及代码/标注双基线核对。应用仍保留新关联待审，功能改义导致的 accepted→proposed 明确进入差异。
- 暗色「功能建设」左右工作台、分层范围与证据、保护地图草稿与保存 ACK、固定原基线证据跳转、重启恢复。

M2 不启动 Agent、目标程序、构建或测试，不推断修改者或执行进度。底层仍是已保存输入触发的完整重建；M3 的开发目标与功能结果综合审阅仍后续推进。

## 兼容与审计

原 CodeGraph/FeatureMap schema 和静态提取修订号不变。新增可选 `AnalysisInputs.configReads` 记录真实配置解析读取用途，纳入新捕获的输入摘要；源码扩展名不能掩盖配置身份。旧捕获保持原 digest 算法和磁盘核对，跨 snapshot 缺用途记录时为 unverified；M2 新分析的 snapshot 因输入证据增加而不同。已有工作区保留原图与标注，不直接把旧接受解释为当前批准。

manifest 仍为 schema 1，新增可选 `featureWork`；旧 M1 工作区可打开。固定 task/proposal 内容地址文件与 FeatureMap 版本先保存，再一次原子发布 manifest 中的决定/标注头/版本/视图。应用审计使用既有 `migration` history operation，`after.kind: feature-task-apply` 明确新事件类型，避免引入旧 validator 不识别的 operation。每个任务的 batchId 只能对应一份内容；重复相同内容导入幂等。

非顶层功能任务可保留其范围外原父级，但不能借此获得祖先写权限或把所选根移走。旧关联文件全部退出索引时，任务明确列出全索引发现范围，不生成无法重定位的空范围。独立审查发现同长度改名会复用 snapshot-local node ID；修订去重已改为同快照用 ID、跨快照用完整 file/hash/start/end/name/kind 锚点，允许新实体显式关联与旧项撤销，同时保留对精确旧拒绝项的防绕过规则。所有检查都不做同名重绑。

## 实际验证记录

环境：Linux、Node 22.18.0、锁定 TypeScript 5.9.3、Chromium 131（独立无头浏览器，真实 loopback 服务）。

- 新输入一致性 17 项、引用核对 23 项定向通过，0 失败/跳过。
- 新协议、CLI、真实 HTTP 首轮 30 项通过；之后增加了非顶层根与隐式审阅重置断言。
- M2 真实浏览器 **13 组通过**：固定范围/重复下载、草稿保护、整批应用、子功能深入、原决定保留、隐式退回待审、迟到提案、撤销、未归属新代码、390px、重启恢复 6 任务/5 提案。浏览器异常 0，外网请求 0。
- 原 M1 工作区浏览器 **14 组通过**；浏览器异常 0，外网请求 0。实际检查 desktop review、stale、comparison 和 mobile 截图，暗色/左右布局/换行符合预期。
- 持久化 **15 项**通过；最终输入检查在 manifest 临时文件 fsync 之后、唯一发布 rename 之前执行。失败注入验证写清单期间源码变化不会发布，重启后旧标注头和 pending 提案保留。
- snapshot-local ID 独立审查回归 **3 项通过**，含真实同长度改名正例及同/跨快照拒绝项防绕过负例。
- 最终完整套件 **464 通过 / 0 失败 / 0 跳过**；4 份修改的 viewer JS、Python 浏览器脚本语法和 `git diff --check` 通过。

上述完整本地套件尚未包含之后合入 CP37 时新增的 6 项比较脚本测试；合并基线后再执行完整套件。最终 Windows/Linux 与固定样本 CI 对精确 PR HEAD 独立核对；本地与旧提交结果不能替代。不得把正在运行的检查写成已通过。

## Skill 实际试跑

只给新上下文 Agent 合成固定任务包、仓库 Skill 和 CLI 路径，独立完成 overview、2 次 search、2 次 inspect、1 次 candidate relation 查询，保留 claim table、自评、首次提案和 TRIAL。首次 check/submit 成功：1 个已有功能修订、1 条新关联、3 条精确引文，`valid: true / applied: false / decision: proposed`。

试跑保留 `postMessage` 的 candidate/type-contract，明确 `requested` 仅是调用正常返回后的状态，不证明投递/展示，未猜测接收侧实现。冻结 header、首次草稿、proposal digest 和记录的六个输入哈希核对一致。它证明工作流可用，不是业务正确性的独立模型评测。之后仅澄清笔记目录与必须尚不存在的 submit 输出目录分开，格式/路由测试继续覆盖。

原始本地证据：`/tmp/repographia-m2-skill-forward-hNAcyM/skill-task-trial-wxbmdyem/`。浏览器最终产物位于 `/tmp/repographia-m2-feature-work-final-qa/`、`/tmp/repographia-m2-m1-regression-qa/`；完整单元日志 `/tmp/repographia-m2-full.log`。最终 PR 的 CI artifacts 提供持久跨平台验收与精确源码归档。生成报告、源码图、浏览器产物和用户上传内容不提交公共仓库。

## 接手与使用

先核对远端 master、M1/M2 PR 和本检查点后的提交。核心读 `src/feature-tasks.ts`、`src/feature-references.ts`、`src/workspace-feature-store.ts`、`src/workspace.ts`；用户流程读 [功能建设](../feature-tasks.md) 和 [持续工作区](../continuous-workspace.md)。

```sh
npm ci --ignore-scripts
npm run build
npm test
python scripts/check-feature-tasks.py reports/feature-tasks
python scripts/check-workspace.py reports/workspace
```

浏览器脚本需要已安装 Playwright/Chromium；本机受限环境使用已记录的 Node/Chromium 路径及只监听本机的测试权限。输出数据必须在被分析源码树之外。用户更新构建后用原 `workspace` 命令重开，打开新输出网址；在「功能建设」准备任务并下载，Agent 返回后导入 `revision.json`，不是旧追加流程的 features.json。
