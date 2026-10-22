# CP34 — 统一暗色工作台跨平台验收

2026-10-22。用户要求项目代码地图与功能映射保持一致，改为固定暗色，恢复颜色与明显动效，并改善单调背景。分支 `feat/unified-dark-workbench`，PR [#10](https://github.com/yaelysia/RepoGraphia/pull/10)，master 基线 `3eb50e0eae6c720a28b59adf5e2da3e3601bc4b0`。CP32、CP33 分别保留范围计划与实现/本地验证，不改写历史检查点。

## 精确受测版本

- 远端完整实现 HEAD：`4b41d615421cfc89bcb36d7cb30007258fdf74b8`。
- 实现 tree：`1dbcc81161e787b6ec4582786b78aa026c396395`。发布时用 Git tree 核对，与本地实现提交 `3f1313d3d553c4f55519d3089ccc289e82e08a1c` 的文件逐字节一致；提交元数据不同不代表代码不同。
- [Verify #48](https://github.com/yaelysia/RepoGraphia/actions/runs/39741083588)，run `39741083588`，completed / success。
- 三个 job 的 checkout 日志均确认 PR 合并测试提交 `fa96f6784402ad19cf976ec344692ceb66991f62`，将上述实现 HEAD 合入上述 master 基线。
- Linux job `119698179603`、Windows job `119698179974`、sample job `119698179843` 均 completed / success。
- 三个 job 均使用 Node **22.23.3**、npm **10.9.9**；项目依赖锁定 TypeScript **5.9.3**。浏览器环境使用 Python 3.12 和 Playwright 1.55.0 安装的 Chromium。

本 CP34 提交只新增/更新验收文档，不改实现。最终文档 HEAD 的 CI、PR 合并提交及合并后 master CI 另在 PR #10 描述中核对，不能用 #48 冒充之后提交的测试。接手先核对远端最新 master 与 PR 状态；没有待挽救的未提交实现。

## 已交付行为

- 项目地图、功能映射与源码/证据共用稳定的工作台框架：永久主模式入口、搜索、工作区外框和右侧阅读区。项目概况与导航按需打开，切换不再同时改换顶栏、导航和列布局。
- 固定墨蓝背景、蓝紫强调色、静态光晕与细点阵，系统浅色偏好不会把功能映射变白。两图及详情、源码、证据使用同一套颜色和控件。
- 项目目录/文件使用名称优先的胶囊节点，类型、统计和边界分层显示。选择与进入是独立动作；支持上一层、默认 100% 可读字号、内部平移/滚动、缩放与适应。缩放工具条独立占据空间，不覆盖或裁切节点。
- 模式、目录及功能层级进入/返回有约 460 ms 的有限空间过渡，选中、展开和抽屉有对应反馈。快速反向操作取消旧动画；减少动态效果时直接完成，没有循环背景动画或模拟执行的流动箭头。
- 跨模式保留项目目录、搜索、筛选、选择、预算、缩放、关系分页与非零阅读滚动；功能层级、展开与来源返回状态继续保留。先保存旧视图，再应用新布局，避免关闭目标阅读区时把旧位置保存为零。
- 736 px 保持左右阅读；620 px 及以下使用可关闭的详情抽屉。窄屏显式进入新层会显示新地图，键盘进入目录后焦点留在新画布。

功能包含、代码映射、角色分组与原始调用仍有各自语义，不从共享代码推测功能依赖，不把分组当执行顺序。候选/未知/外部边界、预算与完整证据保留。没有改变分析规则、CodeGraph/FeatureMap 协议或 Skill，也没有执行目标应用、调用模型或改写用户数据。

## 实际跨平台结果

以下数量来自各 job 的完整 TAP 汇总与浏览器脚本 JSON 输出。

| 检查 | Linux | Windows |
| --- | --- | --- |
| 完整 Node 单元测试 | 332 pass / 0 fail / 0 skip | 329 pass / 0 fail / 3 skip |
| 新共享暗色工作台 | 69/69 | 69/69 |
| 原功能工作台 | 48/48 | 48/48 |
| 原关联代码场景 | 41/41 | 41/41 |
| 启动/换行/CSP | 6/6 符合预期 | 6/6 符合预期 |
| viewer JS 语法检查 | 全通过 | 全通过 |

Windows 三项既有跳过均为 `requires symlink privilege`：不遍历符号链接源码、保留已有符号链接输出、拒绝悬空符号链接输出。没有失败、取消或 todo；未移除既有语义断言。

浏览器直接打开 `file://`，不是 `set_content`；三套界面结果均为零浏览器异常、零外部网络请求。CSP 的 LF、CRLF、CR、mixed 四个正例正常启动，wrong-hash 和 tampered 两个负例按预期被阻止。

新 69 项专门覆盖系统浅/深偏好、文本对比、跨模式外框几何、真实动画/快速反转/减少动态效果、目录与功能状态恢复、目标详情关闭后的非零滚动恢复、原始证据、键盘焦点、1024/736/430 px 下两图工具按钮的完整边界与实际点击命中，以及导出数据不变。既有 48/41 项继续检验功能层级、角色分组、源码/证据返回、编辑、审阅和异常输入；不把夹具层数当作实际功能深度限制。

## 固定真实样本与产物

sample job 使用独立检出的固定 Codex-Monitor 样本和锁定分析器基线，静态分析、比较与各 gate 全部通过，没有运行目标应用。

| Sample 检查 | 实际结果 |
| --- | --- |
| viewer | 30/30 |
| project-map | 24/24 |
| feature-map | 32/32 |
| feature-migration | 25/25 |
| agent-report | 14/14 |
| 冻结 Agent 提案 replay | 13/13 |

冻结 replay 记录 `modelInvoked=false`、`preservedBase=true`、`unchangedGraph=true`。固定功能样本保持 3 个功能、6 条待审映射、0 条自动接受。这不是用户此前 3 个功能/39 条映射的试跑包；本轮没有冒称重新取得或复测该数据。

已核对以下 #48 artifacts 的 `head_sha` 都对应远端实现 HEAD：

| 产物 | Artifact ID |
| --- | --- |
| codex-monitor-report | `12409226627` |
| report-startup-Windows | `12409846069` |
| report-startup-Linux | `12409491452` |
| checkpoint-source | `12409581140` |

本地环境、历史公开 JSON 来源与视觉复查见 CP33。报告与截图只验证实现行为，不构成独立用户可用性评测。用户图片、源码、图、标注及生成报告没有提交公共仓库。

## 更新与接手

先核对 PR #10 的合并状态。合并后保留本地未提交修改，在 RepoGraphia 目录更新 master 并重渲染：

```sh
git switch master
git pull --ff-only origin master
npm run build
node dist/cli.js features render "./reports/codex-monitor-r1/graph.json" "./reports/agent-trial-result-01/features.json" --out "./reports/feature-workbench-dark.html"
```

Windows PowerShell 用 `Start-Process "./reports/feature-workbench-dark.html"` 打开。输出文件必须尚不存在，已有同名文件就换新名称；旧 HTML 不会自动更新。必须使用原先配对的 graph.json 和 features.json，只升级界面不需要重新扫描或重跑 Agent。原平面标注不会自动获得未标注的子功能；人工修改仍需导出标注 JSON 保存。

下一轮根据用户实际阅读体验继续优化，从最新 master 建小范围分支，按 AGENTS.md 保存每个验证阶段。交互说明见 `docs/project-map.md`、`docs/feature-map-visual.md` 和 README；不要重复实现本轮已合入的 UI。
