# RepoGraphia 当前检查点

## CP18：显式跨快照迁移已实现并通过验证

2026-10-20；分支 `feat/feature-migration-r1`，PR #5，基于 CP15 `206dd363dcc023a8ab88590878cdabb62b44fcd8` / PR #4。先读 AGENTS.md、docs/feature-migration.md、docs/feature-mapping.md，再核对本检查点后的提交和 PR 状态。#5 暂叠在 #4 上，上游 #2/#3/#4 仍按依赖顺序处理；本轮没有合并或覆盖它们，也没有修改 Codex-Monitor。

## 精确检查点

- CP16 范围：`b95fbecd956cf1938d8ca66299e0ad975a3b803f`。
- CP17 完整实现：`720f879de257dcace22420e2a68654c9ad347fc8`。
- 实现 Git tree：`96bf6256659890bea3d982958db72883d7958821`。
- Verify #22：`39383214561`，三个 job 全部 completed/success。
- CI 实际合并测试提交：`e65adf7d2a52854e6ad2a39bf8f0b233aa05aee5`。

本 CP18 收尾提交更新文档及 CLI 帮助文字，不改动迁移逻辑或测试；最终 HEAD 的 CI 单独记录在 PR #5，不借用 #22 的状态，不为记录最后一个 SHA 递归提交检查点。

## 现在可以做什么

共享纯 plan/apply；精确锚点、源码哈希和已记录静态邻域比较；可复用/需审阅/无匹配三类；显式 carry/replace/defer；双基线和版本检查；FeatureMap schema 2 每映射独立 basis；旧依据保留；旧接受退回待审，拒绝保留。CLI 与浏览器使用同一套规则。

页面支持导入旧图、选择当前准确实体、预览、明确确认、暂缓保持失效及 JSON 导出。原功能关联现在可以通过表单修正理由、角色及显式关系证据。所有编辑只是内存草稿，不会自动保存到源文件、HTML 或 Git。

普通新建依旧为 FeatureMap schema 1，迁移输出 schema 2；CP15 或更早工具不支持新格式。CodeGraph schema 1、分析规则 4、目录投影 1 没有改变。accepted 不是业务正确性证明，也不消除 candidate/unknown 等警告。

## 锁定 CI 已核验结果

| 检查 | 结果 |
| --- | --- |
| Linux / Node 22.23.3 / TypeScript 5.9.3 | 标准 npm test：232 pass，0 fail，0 skip |
| Windows / Node 22.23.3 / TypeScript 5.9.3 | 标准 npm test：229 pass，0 fail；3 项既有符号链接权限 skip |
| 既有源码/项目地图/功能浏览器 | 30 + 24 + 32 项通过，实际 file:// |
| 新迁移浏览器 | 25 项通过，实际 file://；无异常、无外部请求 |
| 固定样本同输入对照 | files/nodes/relations/coverage/diagnostics 全部一致 |

本轮新增 34 项单元/CLI 回归。固定样本的 6 条功能提案均可复用引用，但仅验证同一源码因工具安装目录变化产生的新快照，不是业务代码变更。独立小型源码实际修改/删除验证为 1 可复用、2 需审阅、1 无匹配，其中包含调用方自身未改而依赖内容变化的反例。

下载后已核验产物 ZIP 哈希、精确源码 Git tree、131 个源码哈希、HTML 内嵌图/标注与独立 JSON 一致性，并打开真实 CI 截图。详细 job、产物 ID 和范围见 `docs/checkpoints/CP18-validation.md`。

## 复现与接手

```sh
git fetch origin
git switch feat/feature-migration-r1
npm ci --ignore-scripts
npm test
node dist/cli.js features plan old-graph.json new-graph.json features.json --out migration-plan.json
```

首次本地跟踪使用 `git switch --track origin/feat/feature-migration-r1`；保留现有工作，不得 reset/clean。迁移必须保留对应旧图和旧标注；请求格式及实际 revision 用法见 `docs/feature-migration.md`。`features migrate` 只创建新文件；存在暂缓项时 `features check` 返回 2，这是失效披露，不是整个迁移没有完成。

## 当前边界及下一轮起点

第一版没有同名、模糊或自动重定位。原 ID 因源码偏移变化而丢失也会列为无匹配，不能直接当作代码已删除。静态邻域比较不是业务等价证明，未录入图的运行关系仍不覆盖。默认仍按快照失效，只有明确迁移后选定标注才引用新快照，暂缓标注继续保留旧 basis。

全部实现及测试已经提交远端，没有未提交功能需要从临时环境挽救。下一轮先检查 PR #5 的最新验证/审阅与依赖状态，再在本映射协议上评估可选的 AI 提案导入入口：提案需准确代码证据、不能自我接受、不得覆盖既有人工决定。自动生成完整功能图、Git Diff、动态运行、增量分析和 Agent 任务路线仍未实现。

本地辅助环境是 Node 22.16.0 / TS 5.8.3：各测试文件分别 232 通过，但整套并行 npm test 曾超时；未放宽测试、未强制退出以掩盖它。最终依据是上述 CI 标准命令成功。源码归档有 30 天期限，长期恢复依靠 Git 提交与检查点，而非临时文件或会过期的下载地址。
