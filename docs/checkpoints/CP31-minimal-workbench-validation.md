# CP31 — 极简功能工作台跨平台验收

2026-10-22。用户选择「极简工具」设计并授权正式落地。分支 `feat/minimal-function-workbench`，PR [#9](https://github.com/yaelysia/RepoGraphia/pull/9)，master 基线 `d277ab5d6cdf03e40f7d6fdfafc810ae51e5c939`。历史 CP28、CP29、CP30 分别记录范围、显式层级契约和实现，本检查点不改写这些历史记录。

## 精确受测版本

- 远端完整实现 HEAD：`039998876b722e35c22d7dd15c6cc05970842fbf`。
- tree：`ccac4a7ffe2a70b0899af6b7cd7ddea494e53aa9`，与本地受测实现逐字节一致。
- [Verify #45](https://github.com/yaelysia/RepoGraphia/actions/runs/39728469228)，run `39728469228`，completed / success。
- CI 实际检出的 PR 合并测试提交：`e8931e3807910389d5cf57696a25a34c9e16b4f6`，将上述实现 HEAD 合入上述 master 基线。
- Linux job `119657770370`、Windows job `119657769680`、sample job `119657769960` 均 completed / success。
- 三个 job 均使用 Node **22.23.3**、npm **10.9.9**；项目依赖锁定 TypeScript **5.9.3**。浏览器环境使用 Python 3.12、Playwright 1.55.0 安装的 Chromium。

本 CP31 提交只新增/更新验收文档。最终文档 HEAD 的 CI、PR 合并结果及合并后 master CI 单独记录在 PR #9 描述中，不能用 #45 冒充之后提交的测试。接手先核对 PR 和最新 master；实现已经保存，不存在待挽救的未提交实现。

## 已交付行为

- 中性浅/深色、胶囊节点、名称加一句解释；桌面左侧画布、右侧说明/依据/审阅。长描述和文件操作按需展开；窄屏使用可关闭的右侧阅读抽屉。
- 点选与进入是独立动作。显式 `parentId` 表示功能包含关系，可按实际深度继续进入；不另设固定的一层/两层限制。路径栏、父级返回、全局搜索和按需打开的功能树帮助定位。
- 初始画布保持 100% 可读字号，可平移、缩放、适应。镜头、同级显示范围、代码展开、列表分页、调用开关、选中映射和滚动按层/功能保留；源码和证据返回恢复原阅读状态。
- 进入/返回约 460 ms 的横移与缩放，代码展开/收起约 330/280 ms；支持减少动态效果，快速往返不会残留动画或失效选择。
- FeatureMap schema 3 增加可选 `summary` / `parentId`，校验缺失父级、自引用和循环；旧 schema 1/2 直接兼容，浏览不改写。迁移保留原映射 basis、层级和历史。Agent proposal 协议仍为 1，支持同批显式父子功能。
- 保留编辑、审阅、导入/导出、迁移、完整关联列表和原始证据。修复无实质编辑因对象键序变化撤销人工接受，以及修改父功能后返回旧层恢复失效选择的问题。

包含连线不表示调用、功能依赖或执行顺序；角色分组也不表示运行顺序。原始调用箭头仍需显式开启，候选保留虚线。没有改动 CodeGraph 或分析规则，没有从共享代码推测层级。

## 实际跨平台结果

| 检查 | Linux | Windows |
| --- | --- | --- |
| 完整 Node 单元测试 | 332 pass / 0 fail / 0 skip | 329 pass / 0 fail / 3 skip |
| 新功能工作台浏览器检查 | 48/48 | 48/48 |
| 原关联代码场景浏览器检查 | 41/41 | 41/41 |
| 启动/换行/CSP | 6/6 | 6/6 |
| viewer JS 语法检查 | 全通过 | 全通过 |

Windows 三项跳过均为既有 `requires symlink privilege`：不遍历符号链接源码、保留已有符号链接输出、拒绝悬空符号链接输出。没有新增失败或删除原检查。

浏览器检查实际打开 `file://`，不是 `set_content`；无浏览器异常、无外网请求。CSP 的 LF、CRLF、CR、mixed 四组正常启动；wrong-hash 和 tampered 两组按预期被阻止。工作台检查包含连续五层进入、同级第 20 项搜索定位、返回状态恢复、无实质编辑、显式换父级、循环导入拒绝、HTML 形状文本、减少动态效果，以及 1024/736/430px 布局。层级单元测试另覆盖 1000 个节点的链，不以浏览器示例层数作为深度限制。

## 固定真实样本

sample job 对独立检出的固定 Codex-Monitor 样本及锁定分析器基线执行静态分析和比较，所有 gate 通过；没有执行目标应用。

| Sample 浏览器/协议检查 | 实际结果 |
| --- | --- |
| 原 viewer | 30/30 |
| project-map | 24/24 |
| feature-map | 32/32 |
| feature-migration | 25/25 |
| agent-report | 14/14 |
| 冻结 Agent 提案 replay | 13/13 |

冻结 replay 明确记录 `modelInvoked=false`、`preservedBase=true`、`unchangedGraph=true`。固定功能样本保持 3 个功能、6 条待审映射、0 条自动接受；这不是用户之前 3 个功能/39 条映射的试跑包。本轮未重新取得或冒称复测该用户试跑包。

已核对 #45 产物的 `head_sha` 均对应受测实现 HEAD：

| 产物 | Artifact ID |
| --- | --- |
| codex-monitor-report | `12404266459` |
| report-startup-Windows | `12404067546` |
| report-startup-Linux | `12403943595` |
| checkpoint-source | `12404003343` |

本地验证及复用历史 JSON 的来源见 CP30。截图/浏览器夹具只验证实现行为，不构成独立用户可用性或功能语义准确率评测。没有调用模型，也没有把用户上传源码、图、标注或报告提交公共仓库；生成产物位于忽略的 `reports/`。

## 更新与恢复工作

先核对 PR #9 是否已合并。合并后，保留本地未提交修改，在 RepoGraphia 目录执行：

```sh
git switch master
git pull --ff-only origin master
npm run build
node dist/cli.js features render "./reports/codex-monitor-r1/graph.json" "./reports/agent-trial-result-01/features.json" --out "./reports/feature-workbench.html"
```

在 Windows PowerShell 用 `Start-Process "./reports/feature-workbench.html"` 打开新报告，再点击「功能映射」。输出文件必须尚不存在，已有同名文件就换一个新名称。原 HTML 不会自动更新。

必须使用原先配对的 graph.json 和 features.json；只是升级界面不需要重扫或重跑 Agent。旧平面标注显示为顶层功能；更深层级需要明确标注父功能，可通过页面编辑或支持新字段的提案提供，不会自动虚构。页面人工修改仍需导出标注 JSON 保存。

下一轮以用户实际阅读体验为依据，不重新开展设计选型。需要继续开发时，从最新 master 建小范围分支，按 AGENTS.md 保存每个验证阶段和检查点。交互说明见 `docs/feature-map-visual.md`，层级协议见 CP29，后续具体优化尚待用户体验反馈。
