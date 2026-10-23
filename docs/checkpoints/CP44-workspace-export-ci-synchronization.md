# CP44 — 导出浏览器回归等待确切选中版本

2026-10-23（Asia/Shanghai），分支 `fix/offline-reference-export`，PR [#15](https://github.com/yaelysia/RepoGraphia/pull/15)。生产修复见 [CP43](CP43-workspace-reference-export.md)，本阶段只修复其浏览器检查的异步同步条件并增强退出诊断。

## CI 发现的问题

CP43 远端 HEAD 为 `a262c304fb845b235c53e5ea61b27b694eceb3a3`，tree 为 `1be434aeede02b39888daef96c6600f979c2b71e`。[Verify #61](https://github.com/yaelysia/RepoGraphia/actions/runs/39911847913) 的 CI 合并提交为 `95713d557e4dc74127faf87a02aecbab1ac977fb`，tree 与实现相同。

- Windows job 与固定样本 job 全部成功。
- Linux 单元 **518 pass / 0 fail / 0 skip**，此前启动/CSP、场景、工作台、共享界面、M1 和 M2 浏览器 gate 通过。
- 新导出浏览器脚本在第一条 PASS 前失败于“更新后的 snapshot 应与原标注快照不同”；后续 M3 gate 因此未执行。

`refresh_selected()` 点击“查看新代码版本”后，原先只等待“标注已载入”及启动提示不存在。这两个条件在旧 iframe 中已经成立，因此在报告异步载入期间可能读取旧 `graph-data`。这次 CI 失败尚未执行导出结果的一致性检查，不能解释为引用核对导出失败或整个功能已通过。

## 同步修复

在本次更新完成、出现新版本按钮后，先读取并固定 `/api/state` 返回的 `latestSnapshot` 与标注 digest。点击切换后，等待 iframe 内 `graph-data.project.snapshot` 精确等于固定值，再检查就绪状态并读取数据。后续引用核对 API 使用相同的代码与标注版本。

保留两次真实源码变化的新旧版本断言、实际关系 ID 变化断言、导出内容比对以及服务退出码必须为 0 的要求。没有用固定延时、延长等待上限或跳过断言来消除失败。

## 本地定向验证

环境与 CP43 相同：Linux、Node 24.19.0、锁定 TypeScript 5.9.3、Python 3.12、Playwright 1.55.0 / Chromium 1187。

最终脚本连续两次完整导出浏览器均为 **14 组通过**，浏览器异常 **0**、外部请求 **0**，服务退出码 **0**。覆盖真实 loopback 下载、关闭服务后实际 `file://`、候选关系、13 功能分页、原标注与决定保持，以及编辑、导入和迁移后的旧核对撤销。

首次定向运行通过了两次新版本及导出检查，但在服务退出断言处失败。旧断言未记录退出码或 stderr，无法据此判断是测试环境还是服务问题。本轮仅为该断言补充真实退出码与 stderr；两次完整复核均通过，未据此声称修复了另一个服务退出问题。后续若复现，应使用新增诊断继续定位，不能放宽成功退出要求。

本阶段不改变生产源码。完整单元的实际结果见前述精确 HEAD 的 Linux CI；新提交仍需通过完整 Windows/Linux 与固定样本门禁。

## 发布与接手

先核对 PR #15 的最新 HEAD、最终 Verify 与 master，避免重新开发 CP43。不能用失败的 #61 或本地结果替代新 HEAD 的跨平台门禁。最终测试提交、tree、合并状态在 PR 描述中记录。

定向复核命令：

```sh
npm run build
python scripts/check-workspace-export.py reports/workspace-export
```

用户复测仍按 [本地试用第 7 节](../m123-local-trial.md#7-核对工作区和离线报告一致)：升级构建工具，使用原项目与工作区路径重新启动，选择同一对代码及标注版本后重新导出。原 HTML 不会自行更新，待审决定保持待审，无需重跑 Agent。
