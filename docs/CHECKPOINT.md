# RepoGraphia 当前检查点

## CP15：功能与代码映射层第一版已验证

2026-10-20。仓库 `yaelysia/RepoGraphia`，工作分支 `feat/feature-code-mapping-r1`，PR #4；基线 CP12 `a64c67bb7e111a2a8c2e2f1f7a30677e2a1051ea`（PR #3）。先读 AGENTS.md、docs/feature-mapping.md、docs/architecture.md，再核对本检查点后的提交及 PR 状态。

完整实现：`10c7ed1b3d5d6b2020a0029415f24cfad433e30f`。Verify #20 `39377521379` 已完成 success；实际受测 PR 合并提交为 `4f6f7d54820dde6918b079df63f106ab1f89572e`。本 CP15 提交只更新文档，不改变该实现；最终文档 HEAD 的后续 CI 状态单独记录在 PR #4，不能冒用 #20。

当前 #4 叠在 #3 的 `feat/project-map-r1` 上，#3 叠在 #2 上。本轮未合并或改写这些基线，也未修改 Codex-Monitor。合并时应按依赖顺序处理，改变 PR 基线后重新核验；不要强推覆盖他人提交。

## 已完成能力

独立 FeatureMap JSON sidecar；显式多对多关联和理由；声明/关系锚点；审阅决策与证据当前性分离；严格快照失效；版本冲突与自述修改历史；CLI init/check/edit/render；功能页与源码/原关系/值来源/反向功能导航；人工修正、接受/拒绝和导入导出。

示例是助手编写的 3 个有限功能提案、6 条映射、4 个不同代码实体；全部为 agent/proposed，0 人工接受。界面编辑只有内存草稿，导出 JSON 后才能自行保存；不会写入原 HTML 或目标 Git。

原静态分析规则 4、CodeGraph schema 1、项目投影版本 1 保持不变。没有 AI 自动归纳、动态运行、Git Diff 或增量分析。

## 已核验结果

| 验证 | 实际结果 |
| --- | --- |
| Linux / Node 22.23.3 / 锁定 TS 5.9.3 | 198 pass，0 fail，0 skip |
| Windows / Node 22.23.3 / 锁定 TS 5.9.3 | 195 pass，0 fail，3 项既有符号链接权限 skip |
| 原有证据/来源浏览器检查 | 30 项通过，实际 file:// |
| 原有项目地图浏览器检查 | 24 项通过，实际 file:// |
| 新功能映射浏览器检查 | 32 项通过，实际 file://；无页面异常或外部请求 |
| 固定 Codex-Monitor | 3 功能/6 映射全部锚点匹配，候选警告保留；负例 6 条全部失效 |

本轮新增 35 项单元/CLI 回归。固定样本与 CP12 分析器共用源码及类型依赖目录，files/nodes/relations/coverage/diagnostics 全部 deepEqual；131 文件、2630 个非文件实体、12978 个显式调用点及 363 未解析没有变化。数量与通过的断言不是业务正确率。

精确 job、产物和复核边界见 `docs/checkpoints/CP15-validation.md`。长期接手使用 Git 提交，不依赖 30 天后过期的源码归档。

## 复现与接手

```sh
git fetch origin
git switch feat/feature-code-mapping-r1
npm ci --ignore-scripts
npm test
npm run analyze -- ../Codex-Monitor --out ./reports/codex-monitor --include-source
node dist/cli.js features init reports/codex-monitor/graph.json --out features.json
node dist/cli.js features check reports/codex-monitor/graph.json features.json
node dist/cli.js features render reports/codex-monitor/graph.json features.json --out feature-report.html
```

首次建立本地分支可用 `git switch --track origin/feat/feature-code-mapping-r1`。保留现有工作，不使用 reset/clean。features 写命令只创建新文件，已有同名输出将拒绝覆盖。

要复现三个样例，必须使用另一个独立样本副本，固定到 `490d822a9593d8d4b78a9188dd0daa0ae791eaf6`，按 CI 准备依赖类型后运行：

```sh
node scripts/verify-sample.mjs /path/to/pinned/Codex-Monitor ./reports/codex-monitor
node scripts/verify-feature-map.mjs ./reports/codex-monitor
python scripts/check-feature-map.py ./reports/codex-monitor
```

浏览器验证需要 Playwright 1.55.0/Chromium。不要运行样本应用或业务测试。CI 产物里的 `features-edited-test.json` 是浏览器测试草稿，不是用户确认；交付只使用原始 features.json（全部 proposed），排除测试草稿和负例页面。

## 明确边界与下一轮起点

当前性只表示标注引用与输入图的一致性，不证明业务语义或上传图数据真实性。作者和审阅历史是自述而非认证。人工接受不消除 candidate/unresolved/类型证据等警告。

本版整个 snapshot 变化都会使全部旧映射失效，即使被关联文件未变化；不自动迁移或按同名重绑定。功能定义变化会使此前接受的关联退回 proposed。跨快照迁移和细粒度失效仍待独立实现。

下一轮先收集这三个有限提案的审阅反馈，完善关联理由/角色/证据的修正及显式迁移流程，再评估可选 AI 提案接口。完整自动功能图、Git 变更和 Agent 任务路线仍未实现，不是本轮遗失工作。

全部应用实现已提交远端。当前临时容器本地为 Node 22.16.0 / TS 5.8.3 辅助测试；本页最终验证以锁定依赖的 CI 为准。
