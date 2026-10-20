# RepoGraphia 当前检查点

## CP11 — 项目级地图纯投影与 CLI 已实现，页面待接入

日期：2026-10-20。分支 `feat/project-map-r1`，从 CP9 `3e70ed49d3e79414d7274f824552a3883661b6f8` 独立开发。旧 PR #2 仍未合并；新 PR 将以 `fix/r1-evidence-checkpoints` 为基线，不能把旧 PR 的成功当成本轮验证。

先读 AGENTS.md、docs/architecture.md、docs/checkpoints/CP10-project-map.md，再核对分支提交与 PR 状态。

### 已保存实现

`src/project-map.ts` 为纯投影工厂，按目录直接子级组织文件/目录，保留多候选去重、方向、类型、内部关系、范围外、无目标、缺失端点、隐藏测试及预算；不会改变源图。新增 map/map-records CLI，可分页获取原始关系证据。

28 项独立手写聚合正反例及 CLI 回归已加入 tests/project-map.test.mjs。包含同名节点、多目标、循环、缺失端点、未索引文件、筛选、预算、浏览器同源工厂与千节点边界。它们不是全仓库解析准确率评测。

### 实际验证

本地 Node 22.16.0 / TypeScript 5.8.3：npm test 159/159 通过（原 131 + 新增 28）。仅为辅助环境；尚未完成本分支锁定 TS 5.9.3 的 Windows/Linux CI，也未完成新项目地图浏览器验证。

### 剩余步骤

接入默认全局图、目录钻取、聚合关系证据与返回导航；补充真实源码标注夹具与浏览器测试；同输入核验提取规则与 CodeGraph 不变；完成锁定版本 CI 和 CP12。

运行：git switch feat/project-map-r1；npm ci --ignore-scripts；npm test。

查询：node dist/cli.js query /path/to/graph.json map；node dist/cli.js query /path/to/graph.json map-records . --from electron --to src --limit 25。

分析规则保持 4；投影版本为 1。没有 AI、动态执行、增量分析或 Codex-Monitor 写操作。所有已完成代码已提交远端；不要重做 CP9 的值来源规则。
