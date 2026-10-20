# CP15 — 功能与代码映射层验证记录

## 精确实现及 CI

- 基线 CP12：`a64c67bb7e111a2a8c2e2f1f7a30677e2a1051ea`。
- CP13 范围提交：`f31a6de83d61b2b43c732b4c6b310cecb05f5be0`。
- CP14 完整实现：`10c7ed1b3d5d6b2020a0029415f24cfad433e30f`。
- 实现 Git tree：`d3dd4e966e19192f6e9e60f574e248740b422085`。
- Verify #20：`39377521379`，completed/success。
- 实际 CI 合并测试提交：`4f6f7d54820dde6918b079df63f106ab1f89572e`。
- 当前分支 `feat/feature-code-mapping-r1`，PR #4，叠在 PR #3 上。

本验证文档为后续纯文档提交的一部分，不将其 HEAD 当作上述实现 CI 的受测对象；最终文档 HEAD 的 CI 会在 PR 单独核查。

| job | ID | 实际结果 |
| --- | --- | --- |
| unit (ubuntu-latest) | 118478888284 | Node 22.23.3；198 pass / 0 fail / 0 skip |
| unit (windows-latest) | 118478888482 | Node 22.23.3；195 pass / 0 fail / 3 既有 symlink 权限 skip |
| sample | 118478888109 | 固定样本、同输入对照和三组浏览器检查全部成功 |

npm ci --ignore-scripts 安装锁定 TypeScript 5.9.3。本轮增加 35 项单元/CLI 回归；Windows 跳过的不是新增映射用例。

## 离线交互与语义边界

Playwright 1.55.0 / Chromium 使用实际 file:// 导航。原证据/来源 30 项、原项目地图 24 项、新功能映射 32 项具名检查通过，均无浏览器异常或外部请求。

新增检查覆盖功能提案与多对多导航、原始候选及来源证据、必须填写编辑者/理由、接受后保留候选警告、列表与检查器同步、内存草稿提示、JSON 导出及重导入、错误导入保护、拒绝、新建及修改功能、原地图控制恢复、无 sidecar 空态、快照失效和禁止同名跳转、窄屏显示。

示例不是 AI 自动生成流程：examples/codex-monitor-feature-plan.json 是助手阅读源码后编写的有限提案。程序只定位固定样本的准确实体并核验引用一致性，不证明业务功能已经识别完整。没有让 agent 自行 accepted，没有把浏览器测试中的人工标签当作用户批准。

## 固定样本结果

- Codex-Monitor：`490d822a9593d8d4b78a9188dd0daa0ae791eaf6`。
- 当前图 snapshot：`18dbe44a94c58882d91a6cfb13b550f7a96ad37b7453e3d5336952e40f05776b`。
- 131 文件、2630 非文件实体、12978 显式调用点，0 编译诊断。
- 状态仍为 bound 2835 / candidate 1765 / unresolved 363 / external 8015。
- 3 功能、6 映射、4 个不同代码实体；current 6 / stale 0 / proposed 6 / accepted 0 / rejected 0。
- refresh 与 scanLocal 分别被两个功能共享，但没有生成任何功能依赖边。
- sourceResult → scan 的原候选和不完整来源警告保留。
- 快照不匹配负例使 6 条全部失效。

与 CP12 工具在同一个样本目录/类型依赖下比较，files/nodes/relations/coverage/diagnostics 全部 deepEqual。两个分析器安装路径可影响 snapshot，因此不宣称跨目录 snapshot 字符串相同；每份 sidecar 必须严格匹配自己的图。没有运行 Codex-Monitor 应用或业务测试，没有写入它的仓库。

## 下载与二次复核

| CI 产物 | artifact ID | ZIP SHA-256 |
| --- | --- | --- |
| checkpoint-source | 12244226251 | `853be6a54c3d31919194fc295a82ff2d522745171094cd583df223f62dffee8d` |
| codex-monitor-report | 12243877362 | `e1b4e7ad771a381d658f251974d496a4ce936225d37730d3ecd83f5f9bd4a85c` |

下载后两个 ZIP 哈希均已验证。提取的受测源码中，64 个文件与本地副本逐字节一致；README/architecture 的差异只是在本 CP15 才提交的文档补充，CP13 范围文档只存在于远端归档。应用、测试、脚本和工作流与已运行版本一致。

另核对了 HTML 内嵌 graph/feature JSON 与独立 JSON 完全一致，131 个嵌入源码的 SHA-256、6 个代码锚点和显式关系证据匹配。已打开 CI 的功能概览和关系审阅截图检查布局。

完整 CI 产物包含负例/兼容页面和 features-edited-test.json（浏览器测试导出的人工决策草稿）。给用户的试用包只保留原始 features.json/features.html、静态图、评估/对照、截图与本说明，排除测试草稿和负例页面。截图在测试执行人工修改之前生成。

源码归档保留 30 天；长期接手使用 Git 提交和检查点，不依赖下载链接或临时容器。当前性检查不是输入文件签名或防篡改认证。
