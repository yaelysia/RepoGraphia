# CP42 — 修复 M3 CI 的动效节点定位，并补齐本地试用流程

2026-10-23，分支 `feat/development-review`，[PR #14](https://github.com/yaelysia/RepoGraphia/pull/14)。用户要求检查 M3 CI，有问题修复、全部通过后合入 master，并提供 M1/M2/M3 本地试用步骤。

## 已核对的失败与原因

实现 HEAD `fb2d430bfff80e58243709e7eb4a2aa6047c8f72`，tree `df94318a88d338218f5d7518ce85c175e1bb9e28`。[Verify #58](https://github.com/yaelysia/RepoGraphia/actions/runs/39881842205) 的实际结果：

| Job | 结果 |
| --- | --- |
| Linux `120180774759` | 511 单元全部通过；M1 等前序浏览器通过；M2 在 `accept_mapping` 点击功能卡片时 strict-mode 失败，M3 浏览器未执行 |
| Windows `120180775143` | 508 pass / 0 fail / 3 项既有符号链接权限 skip；全部浏览器 gate 通过，含 M1 14、M2 13、M3 18 组 |
| sample `120180775012` | 全部通过 |

功能导航会短暂保留 `.feature-motion-ghost` 作为旧场景视觉副本，其根已经设置 `inert`、`aria-hidden=true` 和 `pointer-events:none`，动效结束即删除。脚本的全局 `.feature-card[data-feature=...]` CSS 定位会在这段时间匹配当前卡片和视觉副本，造成两个匹配；可交互卡片实际只有一个。

## 修复与有区分度的回归

只修改 `scripts/check-feature-tasks.py` 的测试范围：统一卡片 helper，限定 `.feature-scene-layer:not(.feature-motion-ghost)`，原三处定位一起采用。没有改变产品界面、动效时长或分析语义。

新增浏览器回归通过真实面包屑点击产生副本，在该次点击的冒泡监听中暂停副本动画；确认原始 CSS 匹配两张、当前场景一张，副本不可交互且对辅助技术隐藏。副本仍在时实际点击当前节点，核对选中状态和说明，再恢复动画并等待副本自动删除。没有使用 `.first()`、强制点击、关闭动效或固定延时消除冲突。

旧 helper 配合这项回归稳定失败：连续查询仍返回两张。仅限定 helper 后，完整 M2 通过。这项验证直接覆盖 CI 的失败条件。

## 本地验收

Linux / Node **22.18.0** / TypeScript **5.9.3**；Playwright **1.55.0**、Chromium **140.0.7339.16**。

| 检查 | 结果 |
| --- | --- |
| `npm test`（含构建与全部单元） | **511 pass / 0 fail / 0 skip** |
| M2 真 loopback 浏览器 | **14 组通过**，原 13 组加动效重叠回归 |
| 浏览器异常／外网请求 | **0 / 0** |
| Git 空白、试用文档代码围栏与相对链接 | 通过 |

本地证据：`/tmp/repographia-m3-cp42-full.log`、`/tmp/repographia-m3-ci-motion-red.log`、`/tmp/repographia-m3-ci-motion-green.log`、`/tmp/repographia-m3-ci-motion-green/feature-task-checks.json`。临时路径可能清理，复现逻辑已保存在受版本控制的脚本中。本次没有执行目标项目、调用 Agent 或修改用户报告。

## 本地试用与接手

新增 [本地试用 M1、M2、M3](../m123-local-trial.md)，从 Windows 更新和启动工作区，到建立小批功能、固定开发起点、保存代码、按变化续分析、人工审阅、导出及重开恢复。README 增加入口；两处使用文档的导出名称与实际按钮「导出这次审阅」一致。旧离线标注继续使用原配对图；已有 M1/M2 工作区复用原输出目录。

接手先核对 PR 最新 HEAD 与其所有 CI job，不能把 #58 的 Windows 成功或本地结果当作修复后完整 CI。精确发布 HEAD/tree、修复后 CI、合并提交与合并后 master CI 记录在 PR 描述。用户已经授权全绿后合并；继续使用 master，不需要开发分支。
