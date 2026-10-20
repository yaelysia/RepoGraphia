# RepoGraphia 当前检查点

接手先读本文件、AGENTS.md、docs/architecture.md，再核对 PR #2 最新 HEAD、CI 和后续提交。历史记录位于 docs/checkpoints/，不要把旧检查点的待办重复实现。

## CP9：规则 4 已完成锁定版本验证与真实样本审阅

- 日期：2026-10-20。
- 分支：`fix/r1-evidence-checkpoints`，PR #2，未合并 master。
- master 基线：`3987fb218bdcff4973329c0d13fcc1ea9a341b52`。
- 本轮起点 CP6：`797ca3756d27dd699989840d27bd4b2a89144ce9`；CP7：`19c6563d402e66e5a4ee856eb995f397e22920f3`。
- 完整规则 4 实现 CP8：`aa250c3a5738d2e67b8947c5376fa41b5b739e29`。
- 已验证 Verify #15：`39354200746`，completed/success；实际 CI 合并测试提交 `3b14447b7a3a5d255f3393e1c129b676b9ba475e`。
- 本 CP9 提交补充验证记录，并修正两条诊断说明的过时措辞；不改关系提取、状态、来源追踪或预算。最终 HEAD 的 CI 单独记在 PR，避免递归修改检查点。

## 本轮交付

有界的解构/直接实参来源追踪；候选附可点击的源码路径、文件哈希、未知停止原因和预算。默认查询仍不遍历候选。旧报告不补造元数据。所有实现均已提交远端，无需从临时容器恢复功能代码。

锁定 TypeScript 5.9.3 / Node 22.23.3：Linux 131 通过，0 失败；Windows 128 通过，0 失败，3 项既有符号链接权限用例跳过。Chromium file:// 的 30 项具名检查通过，无异常或外部请求。

同一个 Codex-Monitor 样本和依赖目录中，规则 3 → 4 的全部 12978 个调用点及 131 个文件哈希一致：bound 2835 不变，external 8015 不变，candidate 1729 → 1765，unresolved 399 → 363。36 个新增候选调用点均位于非测试路径，但候选来源可能含测试初始化；不能推断为生产运行目标。

286 条来源探索中，36 条有候选，250 条仍未知；12 条候选结果明确因调用点预算截断。224 条解构调用在该样本上仍未解析，参数类从 62 降至 26；没有猜测 Hook/工厂返回值。

详细版本、产物校验、源码实例和限制见 `docs/checkpoints/CP9-validation.md`。

## 接手与本地运行

```sh
git fetch origin
git switch fix/r1-evidence-checkpoints
npm ci --ignore-scripts
npm test
npm run analyze -- ../Codex-Monitor --out ./reports/codex-monitor --include-source
```

没有本地分支时使用 `git switch --track origin/fix/r1-evidence-checkpoints`。保留未提交工作，不得 reset/clean 用户工作区。Node 22+；打开 reports/codex-monitor/index.html 即可浏览，不需服务器。

严格复现使用独立副本：Codex-Monitor 固定 `490d822a9593d8d4b78a9188dd0daa0ae791eaf6`；规则 3 对照工具固定 CP6。两版必须使用同一份源码及类型依赖，不执行样本应用或业务测试。

## 下一轮起点

先检查 PR #2 的最新审阅/合并状态及最终 CP9 CI，不重做本轮修复。优先建立更多独立标注的关系正反例，并审阅候选来源中生产/测试路径和预算的使用体验，再决定下一条静态规则；不要为降低 363 这个数字进入无限全程序求解。

动态分析、AI 功能归纳、增量、多项目遍历与自动 IPC/跨语言桥接仍未启动。规则 4 是上下文不敏感的声明来源探索，不是可行执行路径证明或完整运行时目标集合。
