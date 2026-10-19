# RepoGraphia 当前检查点

接手先读本文件、AGENTS.md、docs/architecture.md，再检查此提交之后的分支和 PR #2。历史 CP3 记录仍在 docs/checkpoints/，不是本轮验证结果。

## CP5：规则 3、诊断查询和页面已实现；等待锁定版本 CI

- 分支 `fix/r1-evidence-checkpoints`，继续 PR #2；不写入 Codex-Monitor，不合并 master。
- 本轮起点 `165532b7eb8dbb7872ef2e725a6f960df5256868`，CP4 接手记录 `c99e143092dbe0bddffc56880641bd694d829c59`。
- 本 CP5 和实现/测试一起提交；精确实现 SHA 以包含本文件的 Git 提交及 PR 最新 HEAD 为准。

## 已完成

1. 每个未解析显式调用保留结构化原因，仓库内范围外声明附坐标/内容哈希。
2. 外部 var/属性声明正确标为声明边界；本地遮蔽/参数/可变别名不升级。
3. 对象和类字段函数初始化、属性别名提供候选；不把 getter 返回的函数误当 getter 自身。
4. 通用 CLI diagnostics 概览和按原因分页；HTML 共用诊断汇总，分类→分页记录→源码证据可点击。
5. analysisRevision=3；旧格式缺少原因时未分类；比较工具检查同一源码/调用点集合，防止删点美化数量。
6. CI 增加固定规则 2 分析器，与规则 3 共用同一个样本和已安装类型依赖，再输出 resolution-comparison.json。

## 实际验证（不是计划）

容器 Node 22.16.0 / TypeScript 5.8.3：原基线 57/57，通过本轮修改后的 92/92；0 失败，0 跳过。新边界/分类夹具最初 18 项中 15 项在旧实现上失败、3 项通过；补充 getter、诊断查询、对照检查后本轮合计新增 35 项测试。

容器 Chromium / Playwright 使用显式 --set-content（宿主限制 file://）：24 项有名称的页面检查通过，0 页面异常、0 外部请求；含分页、源码跳转和旧格式兼容。使用独立的 32-call fixture，不是 Codex-Monitor 的新结果。

**锁定 TypeScript 5.9.3 的 Windows/Linux 与真实样本 CI 尚未核验本 CP5；不能把本地结果或 CP3 的 Verify #10 当成本轮最终通过。**

## 接手命令

```sh
git fetch origin
git switch fix/r1-evidence-checkpoints
npm ci --ignore-scripts
npm test
npm run analyze -- ../Codex-Monitor --out ./reports/codex-monitor --include-source
node dist/cli.js query reports/codex-monitor/graph.json diagnostics
```

现有未提交工作先保留，不可 reset/clean。CI 样本必须在独立副本固定 `490d822a9593d8d4b78a9188dd0daa0ae791eaf6`，不得执行样本应用/业务测试。容器当前无法解析 npm/GitHub，辅助编译器不是锁定版本；最终使用连接器读取 CI。

## 下一步

检查包含 CP5 实现的 CI；修复真实失败后核对新旧计数、原因分布和截图，保存 CP6 精确受测 SHA/run/产物哈希。再更新 PR 和交付报告。未通过前不声称解析效果提升了多少。

动态分析、AI 功能归纳、增量分析、多项目遍历和 IPC 自动桥接仍未开始，不属于遗漏工作。
