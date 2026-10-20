# RepoGraphia 当前检查点

## CP12 实现已提交，等待最终锁定 CI

日期：2026-10-20。分支 `feat/project-map-r1`，PR #3，基线是 PR #2 的 `fix/r1-evidence-checkpoints`。PR #2 尚未合并，不得用本 PR 直接覆盖 master；#2 合并后需要改向 master 并重新核验。

起点 CP9：3e70ed49d3e79414d7274f824552a3883661b6f8。
CP10 计划：c7635d1cb612efc2c278eb3dc3815e2dba67f92c。
CP11 纯投影与 CLI：e24317fa4bae3b4e3f5bac83ffddbfaf5d5a9963；Verify #17 (39364691832) 已成功，但不能替代本次新 UI 的验证。

先读 AGENTS.md、docs/architecture.md、docs/project-map.md，并核对本分支在检查点后的提交。

### 本次保存的完整实现

默认项目级地图、目录钻取、文件/函数/源码跳转、聚合关系分页及返回、范围外/未解析/未索引/测试/预算提示。浏览器和 CLI 共用 src/project-map.ts 纯投影；新增 viewer/project-map-view.js 和 project-map.css。分析器及模型版本保持 4，投影版本 1。

32 项新增单元/标注回归（28 聚合/CLI + 4 独立真实源码矩阵）；新项目浏览器脚本与既有 30 项浏览器检查分别运行。CI 对照固定 CP9，明确要求提取出的 files/nodes/relations/coverage/diagnostics 完全不变。

### 已实际完成的本地辅助验证

Node 22.16.0 / TS 5.8.3：163/163 单元测试通过。Playwright 1.57.0 / 系统 Chromium，set-content：24 项项目检查 + 30 项既有检查通过，无异常及外部请求。file:// 被容器策略阻止，不能以辅助结果冒充 CI 的真实 file://。

### 下一步

核对这个完整实现提交的 Linux/Windows/固定样本 CI；如有失败修复而不是放宽断言。检查实际项目截图与原始报告，再保存 CP12 验证记录，更新 PR #3 为可审阅。不得因为已经有 CP11 成功记录就跳过新页面验证。

运行：git switch feat/project-map-r1；npm ci --ignore-scripts；npm test；npm run analyze -- ../Codex-Monitor --out ./reports/codex-monitor --include-source。

所有已完成代码在远端；本阶段不做动态执行、AI 功能归纳、Git 变更映射或增量索引，Codex-Monitor 只读。下一阶段在项目地图可用的基础上再定义功能层映射的证据模型与验收，不先追求清零未知调用。
