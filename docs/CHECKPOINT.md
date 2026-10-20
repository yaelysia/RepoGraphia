# RepoGraphia 当前检查点

接手先读本文件、AGENTS.md、docs/architecture.md，再核对 PR #2 最新 HEAD 和本检查点之后的提交。

## CP8：有限值来源追踪已实现，本地验证通过，等待锁定版本 CI

- 分支 `fix/r1-evidence-checkpoints`；PR #2；master 未合并。
- 本轮基线 CP6：`797ca3756d27dd699989840d27bd4b2a89144ce9`。
- CP7：`19c6563d402e66e5a4ee856eb995f397e22920f3`。
- 本文件随规则 4 实现提交；精确实现 SHA 以该 Git 提交为准。

新增有界、可复用的解构/直接参数来源追踪，程序化生成候选路径与停止原因。所有新增目标保持 candidate，默认查询不遍历。页面可展开步骤、审阅源码并返回原关系；旧报告不补造元数据。完整范围与实际验证见 docs/checkpoints/CP8-origins.md。

本地辅助环境 Node 22.16.0 / TypeScript 5.8.3：131/131 测试通过。本轮新增 39 项。独立页面夹具 30 项具名检查通过，无异常/外部请求，使用 --set-content。尚未核验包含本实现的锁定 TS 5.9.3 跨平台与 Codex-Monitor 同输入对照；不要拿 CP6 的结果当作当前通过。

## 接手命令

```sh
git fetch origin
git switch fix/r1-evidence-checkpoints
npm ci --ignore-scripts
npm test
npm run analyze -- ../Codex-Monitor --out ./reports/codex-monitor --include-source
```

先保留未提交工作，不得 reset/clean 用户工作区。严格 CI 样本固定 Codex-Monitor `490d822a9593d8d4b78a9188dd0daa0ae791eaf6`；规则 3 对照工具固定 CP6。样本和类型依赖必须是同一副本，不运行样本应用/业务测试。

## 下一步

检查当前实现 CI，修复真实失败后读取新旧状态转移、来源路径、停止原因和截图，再记录 CP9 精确版本、产物哈希与交付。没有已知未提交功能要从临时容器挽救。若有后续提交优先核对，不重复实现。

动态追踪、AI 功能归纳、增量、多项目遍历和自动 IPC/跨语言桥接仍未开始。不要猜测 Hook/工厂返回值，也不要把有限直接调用方当作完整运行时来源。
