# CP6 — 规则 3 验证与可审阅产物

记录日期：2026-10-20（UTC+08:00）。本阶段核验 CP5 的真实 CI，审阅分析变化并持久化交接信息；不修改分析器行为，`ANALYSIS_REVISION` 保持 3。

## 1. 精确版本与验证来源

- 实现 HEAD：`09ca6d38e1e68b8a831d69b5899676840b7dbc00`。
- 实现 tree：`f8f58425639e0858fdcc34e849809dbef752c918`。
- 分支：`fix/r1-evidence-checkpoints`，PR #2。
- master 基线：`3987fb218bdcff4973329c0d13fcc1ea9a341b52`，本阶段未合并或改写。
- Verify #12：`39282138269`，总运行 completed/success。
- CI checkout：PR 合并测试提交 `9398d0687cad83006400d68dce033c26ca875484`。
- 固定 Codex-Monitor：`490d822a9593d8d4b78a9188dd0daa0ae791eaf6`。
- 固定规则 2 对照工具：`165532b7eb8dbb7872ef2e725a6f960df5256868`。

来源：[Verify #12](https://github.com/yaelysia/RepoGraphia/actions/runs/39282138269)，[PR #2](https://github.com/yaelysia/RepoGraphia/pull/2)。后续 CP6 文档提交不是 #12 的测试对象，其最终 HEAD 的 CI 另记在 PR 评论中，避免递归修改检查点。

## 2. 实际测试

| 任务 | job ID | 结果 |
| --- | --- | --- |
| unit (ubuntu-latest) | 118158373688 | 92 pass / 0 fail / 0 skip |
| unit (windows-latest) | 118158373470 | 89 pass / 0 fail / 3 skip |
| sample | 118158373721 | 固定样本、规则对照、24 项 Chromium 检查通过 |

两个单元测试平台均使用 Node 22.23.3，通过 `npm ci --ignore-scripts` 安装锁定依赖，TypeScript 5.9.3。3 项 Windows 跳过是原有需要符号链接权限的用例；本轮新增 35 项均执行。构建与 viewer JavaScript 语法检查也通过。

sample 日志明确记录 Playwright 1.55.0、Chromium 140.0.7339.16、`navigation=file`、24 个具名检查、0 跳过、无浏览器异常及外部请求。包含分类、25 条分页预算、前后页、源码跳转、旧报告兼容和窄屏布局。

部分 jobs 汇总响应在本次读取时仍显示 queued/in_progress；随后取到的完整日志已包含所有测试和清理成功、产物上传成功，且总 run 为 success。本记录依据这些完整结果，不把单个过期状态摘要当成失败或无限重试的理由。

## 3. 同输入的新旧结果

CI 的两版分析器共用同一个样本目录及同一次安装的类型依赖。比较器确认相同编译器版本、131 个已索引文件的内容哈希、12978 个显式调用点的完整坐标集合。节点/关系 ID 是快照内标识，不直接跨规则比较。

| 状态 | 规则 2 | 规则 3 | 变化 |
| --- | ---: | ---: | ---: |
| bound | 2835 | 2835 | 0 |
| candidate | 1723 | 1729 | +6 |
| unresolved | 2755 | 399 | -2356 |
| external | 5665 | 8015 | +2350 |
| 显式调用点总数 | 12978 | 12978 | 0 |

两种状态转移分别是 `unresolved → external` 2350 条、`unresolved → candidate` 6 条。没有通过删除调用点美化分母，也没有新增 bound 调用。外部边界重分类只说明编译器声明来源被正确识别，不是新增了项目实现目标或测得了准确率提升。

规则 2 snapshot：`7a5307bc97a8a384b01590ff5946cb91ae5686bc626d9ac75568a197f822450f`。

规则 3 snapshot：`cc57327b01cc1c5c3da0d841846476a8136ff673fe8ad0550255a20bdddd945e`。

两个报告均为 131 个文件、2630 个非文件实体、31 个未索引源码文件、0 编译诊断。样本脚本保留跨文件 `collect → refresh`、`scanLocal`、`inferStatus` 和 IPC 不误连等选定断言；没有执行样本应用或业务测试。

### 6 条新增候选的源码复核

全部位于 `tests/tray-performance.test.ts`，不是新增生产代码调用覆盖。已检查报告内同一文件的 fixture 返回对象及对应箭头函数：

| 调用表达式 | 调用行 | 候选初始化行 |
| --- | ---: | ---: |
| ctx.unread | 87 | 69 |
| ctx.working | 88 | 70 |
| ctx.mute | 103 | 69 |
| ctx.opacity | 108 | 70 |
| ctx.visible | 111 | 71 |
| ctx.resident | 114 | 71 |

这些目标保持 candidate；未声称属性在运行时未被修改、返回值唯一或实际发生过调用。另与早先规则 2 产物逐条核对了这 6 个调用点：所涉文件哈希一致、旧状态为 unresolved。该局部复核不替代上面的同依赖完整 CI 对照。

## 4. 剩余未解析分类

| reason | 总数 | 其中测试路径 |
| --- | ---: | ---: |
| binding-pattern | 224 | 12 |
| parameter-value | 62 | 6 |
| out-of-scope-declaration | 35 | 22 |
| returned-callable | 28 | 16 |
| unmapped-declaration | 16 | 16 |
| property-value | 13 | 13 |
| missing-symbol | 9 | 9 |
| dynamic-import | 8 | 7 |
| mutable-value | 4 | 4 |
| 合计 | 399 | 105 |

全部 399 个未解析调用都有结构化原因，没有未分类项。测试路径是既定文件名/目录规则，不是对生产重要性的语义判断。224 条解构与 62 条参数合计 286 条，作为下一轮有限值来源分析的调查入口；不要把“原因已知”误当成“目标可确定”。

## 5. 下载后产物完整性与页面复核

| 原始 CI 产物 | artifact ID | ZIP SHA-256 |
| --- | --- | --- |
| checkpoint-source | 12201546007 | `66df868d6834f66f22a67b0b23df40507e24699386256db072f12f5145375d68` |
| codex-monitor-report | 12202040239 | `37f1e3bf1b2113f8b4919868d0caf49cb7ec20271f7b7c2331272dbe22ec12d8` |

两份 ZIP 均已下载并实际校验上述哈希。源码归档解压后在独立目录重建 Git tree，结果为 `f8f58425639e0858fdcc34e849809dbef752c918`，与远端实现树完全一致；归档中的 Git PAX 记录指向上述 CI 合并测试提交。

对下载的 graph.json 另外执行了程序化完整性检查：131 个嵌入文件内容哈希一致；2761 个节点和 15362 条关系 ID 唯一、父级/端点有效；所有关系的文件哈希、UTF-16 源码区间和 excerpt 一致。重算调用状态及原因数量，与 coverage、诊断汇总和对照结果吻合。HTML 内嵌 graph/诊断数据与独立 JSON 完全相同。

该检查是产物一致性验证，不证明每条语义关系正确；没有人工逐条确认全部 2350 条外部重分类。已查看实际 CI 页面截图和诊断截图。下载报告中 `legacy-test.html` 是缺少新版元数据的兼容性测试文件，不是另一次旧版分析生成的真实报告。

本地又以 Node 22.16.0 检查上述 JSON；没有重新安装依赖、重跑静态分析或声称本地完成锁定版本单元测试。页面辅助复核使用 Playwright 1.57.0 与系统 Chromium：file:// 被宿主策略阻止后，使用脚本已有 `--set-content` 模式，24 项检查通过、无异常及外部请求。这个辅助结果与 CI 的 Playwright 1.55.0/file:// 验证分开记录。

## 6. 交付与后续

CP6 仅提交当前接手入口和本验证记录；规则 3 实现已在 CP5 完整保存，没有未提交产品代码。报告从 CI 获取，包含 HTML、图数据、诊断摘要、同输入对照和真实截图；未把大型源码报告提交到工具仓库。

PR #2 保留开放审阅，master 未合并。下一轮先研究解构值/参数值来源的有限静态追踪，定义正反例及停止条件，再决定规则范围；动态追踪、AI 功能归纳、增量、多项目遍历及自动跨进程桥接继续不在当前交付范围。长期接手依靠 Git 提交和检查点，不能依赖会过期的 CI 归档或临时下载 URL。
