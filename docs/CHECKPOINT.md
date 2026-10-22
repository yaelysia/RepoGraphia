# RepoGraphia 当前检查点

## 当前进行中：CP30 极简功能工作台已实现，等待跨平台 CI

2026-10-22，用户已选择「极简工具」设计并授权正式落地。当前分支 `feat/minimal-function-workbench`，远端 master 基线已核对为 `d277ab5d6cdf03e40f7d6fdfafc810ae51e5c939`。先读 `docs/checkpoints/CP30-minimal-workbench-implementation.md`、CP29 层级契约和 CP28 计划。左图右阅读区、递归层级、搜索定位、状态恢复和动效已接入正式渲染器；本地 332 项单元测试、160 项真实浏览器检查及 6 组启动/CSP 检查通过。Windows/Linux Node 22 CI 和固定样本 gate 待核对，尚未合入。以下 CP27 保留为已合入的上一阶段记录。

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
