# CP9 — 有限值来源追踪的验证与交付

记录日期：2026-10-20。继续 PR #2，分支 `fix/r1-evidence-checkpoints`；Codex-Monitor 只读，master 未合并。

## 精确版本

- 已验证实现：`aa250c3a5738d2e67b8947c5376fa41b5b739e29`，analysisRevision=4。
- 实现 Git tree：`334f074660b229158465de427664d56077c2f303`。
- Verify #15：`39354200746`，completed/success。
- CI 合并测试提交：`3b14447b7a3a5d255f3393e1c129b676b9ba475e`。
- 固定样本：Codex-Monitor `490d822a9593d8d4b78a9188dd0daa0ae791eaf6`。
- 规则 3 对照：RepoGraphia `797ca3756d27dd699989840d27bd4b2a89144ce9`。

来源：[Verify #15](https://github.com/yaelysia/RepoGraphia/actions/runs/39354200746)。本检查点随后提交；最终文档/诊断说明 HEAD 的 CI 另在 PR 评论记录，不冒用 #15。

## 测试结果

| 任务 | job ID | 结果 |
| --- | --- | --- |
| unit (ubuntu-latest) | 118405132778 | 131 pass / 0 fail / 0 skip |
| unit (windows-latest) | 118405132852 | 128 pass / 0 fail / 3 skip |
| sample | 118405132412 | 固定样本、同输入对照、30 项 Chromium 检查通过 |

Node 22.23.3；通过 npm ci --ignore-scripts 安装锁定 TypeScript 5.9.3。新增 39 项测试均执行，Windows 仅跳过既有符号链接权限用例。新用例覆盖跨文件/重载/this 参数、解构、实参、构造参数属性、可变值、写入、回调、循环、预算及证据完整性。

浏览器日志明确为 Playwright 1.55.0、Chromium 140.0.7339.16、navigation=file，30 项具名检查，无跳过、异常或外部请求。新增来源路径展开、源码位置/哈希、返回原关系、未知边界与旧报告不补造来源的检查。

本地辅助 Node 22.16.0 / TypeScript 5.8.3 的 131/131 和独立夹具 set-content 页面验证已在 CP8 记录，不代替上述锁定版本 CI。

## 同输入效果

两版在 CI 中使用同一个样本及同一次安装的类型依赖。比较器核验相同编译器、131 个已索引文件哈希和全部 12978 个显式调用点坐标。

| 状态 | 规则 3 | 规则 4 |
| --- | ---: | ---: |
| bound | 2835 | 2835 |
| candidate | 1729 | 1765 |
| unresolved | 399 | 363 |
| external | 8015 | 8015 |

唯一状态转移是 36 条 unresolved → candidate，没有删除调用点、增加 bound 或重分类 external。36 个调用点均为原 parameter-value，位于非测试路径；候选来源允许包括索引内测试初始化，不能因此宣称生产运行目标已确定。

规则 3 snapshot：`1e633238801c4faba8371146aa473188dfbe21643d6b7d58b1cc6619c09b6afe`。

规则 4 snapshot：`f713e3cc6d35a9dc4a9f35f7bf9ee3d7c8a86fb9633cb491f77e521082537011`。

131 个文件、2630 个非文件实体、31 个未索引源码文件、0 编译诊断不变。上述数量不是精确率、召回率或运行覆盖率；本轮没有独立人工标注全部关系。

### 一个实际来源链

`electron/collector.ts:190` 的 `sourceResult` 内部 `scan()` 原来未知。现在按编译器符号身份回到第 186 行形参，再检查第 237、254、264 行的直接 sourceResult 调用，得到三个箭头函数声明候选：第 238 行包装 scanLocal，第 254 行包装 SSH readRemote，第 264 行包装 WSL readRemote。

已查看这些调用与参数的实际源码、对应来源路径和目标正文。三条路径都保留 open-callers：并不排除其他调用方，也不说明某次 sourceResult 执行同时或必然选择这些实现。调用 owner 仍是 sourceResult，不改造成外层直接调用这些函数。

## 未知与预算仍然明确

286 个调用点尝试来源探索：36 条得到候选，250 条仍未知。12 条候选来源因每个目标最多 16 个已索引直接调用点而截断；它们仍有 caller-budget/open-callers，不伪装成完整列表。剩余 250 条没有预算截断，但同样 complete=false。

| 剩余原因 | 数量 |
| --- | ---: |
| binding-pattern | 224 |
| out-of-scope-declaration | 35 |
| returned-callable | 28 |
| parameter-value | 26 |
| unmapped-declaration | 16 |
| property-value | 13 |
| missing-symbol | 9 |
| dynamic-import | 8 |
| mutable-value | 4 |
| 合计 | 363 |

解构规则在正反例中受测，但这个样本的 224 条解构调用没有被强行补齐。Hook/工厂调用结果不按名称推断，成员动态分派和未知外部调用方也未模拟。参数来源是上下文不敏感的语法/声明来源，不是路径可行性、对象实例或完整点指向分析。

## 下载后独立完整性核验

| CI 产物 | artifact ID | ZIP SHA-256 |
| --- | --- | --- |
| checkpoint-source | 12234915460 | `018011087960a344022561c2d9948132f4c6e097c910be789f7e5c7e11deb1f2` |
| codex-monitor-report | 12233809161 | `50002daa39153dce9739f69d9e20a4c3a4248c5245be3a59a64dc7ac16127afc` |

实际下载校验两份 ZIP 哈希。源码归档的 15 个修改文件与本地受测文件逐字节一致；独立重建完整 Git tree 得到上述实现树，PAX comment 指向 CI 合并提交。

对实际 graph.json 核验了 131 个内嵌文件内容哈希、2761 个节点和 15362 条关系 ID/父级/端点，以及全部关系的源码范围、片段和哈希。新增来源中的 1381 个路径/停止位置均能在嵌入文件找到，并逐一核对 UTF-16 范围、行列及片段哈希。来源 target 与关系 targets 一致，探索数量符合预算。重算状态与原因数量，与 summary/对照完全一致；HTML 内嵌图和诊断汇总也与独立 JSON 一致。

这证明产物内部一致，不证明所有候选语义关系都已人工确认。已打开真实 CI 的来源审阅截图；legacy-test.html 仅是格式兼容夹具，不是另一次旧版分析。产物不包含工具对目标项目的写入或运行结果。

## 本次收尾的小修正

复核时发现通用参数诊断仍写着“未做跨调用点参数值传播”，与已实现的有限追踪容易混淆。CP9 将参数/解构诊断改成描述“当前证据未提供可导航目标，若附来源追踪则查看停止原因与预算”。只改展示说明，不改原因代码、关系、状态、来源或预算，analysisRevision 保持 4。辅助环境重新执行 131 项测试全部通过；包含这项说明修正的最终 HEAD 仍须核对其自己的 CI，结果记入 PR。

## 接手

读取 docs/CHECKPOINT.md，然后核对 PR 最新 HEAD/合并状态。本轮实现全部在远端，报告可直接离线打开。源码归档保留 30 天，长期恢复使用 Git 提交。下一轮优先扩充独立标注正反例和来源审阅体验，不为了减少未知而擅自增加框架返回值猜测、动态运行或无限全程序求解。
