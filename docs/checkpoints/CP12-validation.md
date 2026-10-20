# CP12 — 项目级代码地图验证与交付

日期：2026-10-20。该阶段新增项目级展示与查询，不改变分析规则或目标项目。

## 精确版本和范围

- 实现 HEAD：`2027bf34f4cb15cc9799038a50e83470985e07b7`。
- 实现 tree：`57e760d2fc938960f3ae350156321571606a88f0`。
- 分支：`feat/project-map-r1`，PR #3，以 `fix/r1-evidence-checkpoints` 为基线。
- 对照 CP9：`3e70ed49d3e79414d7274f824552a3883661b6f8`。
- [Verify #18](https://github.com/yaelysia/RepoGraphia/actions/runs/39366761921)：三个 job 全部成功。
- CI 合并测试提交：`fc650164309ccf06d951e681043ca31db653f9bc`。
- 本记录随后作为纯文档提交加入；该文档 HEAD 的运行另在 PR 中确认，不与实现的验证来源混用。

## 锁定环境下的实际结果

| job | ID | 结果 |
| --- | --- | --- |
| unit (ubuntu-latest) | 118445253910 | Node 22.23.3 / TS 5.9.3，163 pass / 0 fail / 0 skip |
| unit (windows-latest) | 118445253920 | Node 22.23.3 / TS 5.9.3，160 pass / 0 fail / 3 skip |
| sample | 118445253787 | 同输入对照、30 项既有浏览器检查和 24 项项目地图检查通过 |

单元测试用 npm ci --ignore-scripts 安装锁定依赖，构建及两个 viewer JavaScript 语法检查通过。Windows 跳过的仍是三项既有符号链接权限用例，本轮新增 32 项全部运行。

新增测试包含 28 项手写聚合/CLI 正反例与 4 项源码分析到目录矩阵的独立预期。涵盖多候选去重、类型关系、同名符号、范围边界、未知目标、筛选、分页、对象原型键、空项目和千节点循环。独立预期不由被测投影生成。

浏览器为 Playwright 1.55.0 与其 Chromium，实际 file:// 导航，无页面异常、无外部请求。24 项项目检查包括 Python 独立核算根级矩阵、默认首页、目录/文件/函数钻取、聚合证据分页及返回、测试开关、关系筛选、键盘操作、未索引文件禁用跳转、增加画布预算与窄屏布局。旧 30 项证据/值来源/兼容性检查也保留。

## 真实样本与分析不变性

样本固定为 Codex-Monitor `490d822a9593d8d4b78a9188dd0daa0ae791eaf6`。两版工具共用同一个样本目录和同一次安装的类型依赖，不执行样本应用、业务测试或生命周期脚本，不向样本仓库提交修改。

与 CP9 逐项 deepEqual：files、nodes、relations、coverage、diagnostics 全部一致。两个报告的分析规则均为 4，131 个索引文件、2630 个非文件实体、12978 个显式调用点、31 个未索引源码、0 编译诊断。状态仍为 bound 2835、candidate 1765、unresolved 363、external 8015，状态转移为空。

当前 snapshot：`f713e3cc6d35a9dc4a9f35f7bf9ee3d7c8a86fb9633cb491f77e521082537011`。

CP9 对照 snapshot：`6cdddc6046ca896e61b07f127422dc27996315764ae6161afb2735f46e283281`。

两工具安装目录不同，编译器输入路径参与 snapshot，故字符串不必相等。每张投影严格引用自己输入图的 snapshot，不混用两图 ID，也不宣称跨编辑稳定身份或增量正确性。

## 新地图的实际表现

默认隐藏测试时，根级为 collector、electron、electron.vite.config.ts、scripts、src 五个真实路径分组；70 个可见索引文件、20 个可见未索引文件，顶部全项目统计仍包含测试。根级有两条聚合连接：electron → src 184 条原始关系、src → electron 3 条原始关系。这些计数包含不同类型的关系，不是纯函数调用或运行覆盖率。

组内关系、无目标关系、当前范围外及筛选边界由计数入口继续审阅，没有为了简化图而从原始数据中删除。初始画布最多 12 个节点和 24 条连接；进入 electron 的 42 个直接子级时会明确截断，列表及增加预算按钮提供继续探索的入口。没有把目录划分当成业务模块识别。

已查看实际 CI 的 preview-project.png 和 preview-directory.png。根级全局图、目录展开、文字及预算提示可读；较多子级仍使用确定性网格布局，复杂连线的语义布局或自由拖拽不在此版实现内。

## 产物完整性

| 原始产物 | artifact ID | ZIP SHA-256 |
| --- | --- | --- |
| checkpoint-source | 12239448221 | `71b130f8665b198dceabaf0de9ed7ac4b6388c8ab96fdec43a8b93fa5f63da19` |
| codex-monitor-report | 12240195414 | `1474b8cb30940904fa89dca49e98aea70aa4a752b425d65b2c8f273fdc00dee5` |

两份 ZIP 下载后实际校验哈希通过。源码 tar 的 Git PAX 指向上述合并测试提交；独立重建 tree 得到 `57e760d2fc938960f3ae350156321571606a88f0`，与远端一致。36 个代码、测试、脚本、CI 和 viewer 文件与本地受测版本逐字节一致。

报告含 HTML、原始图、project-map.json、关系状态对照、诊断汇总和实际截图。legacy-test.html 仅用于格式兼容测试，不是旧分析器重新生成的真实报告。分享报告等于分享其包含的源码。源码归档保留 30 天，长期接手依据是 Git 提交，不是临时产物 URL。

## 后续与接手

本轮无未提交产品代码。接手从 docs/CHECKPOINT.md 开始，核对 PR #2/#3 的最新状态；本阶段不自动合并。PR #2 合并后将 #3 改向 master 并重新核验。

下一阶段先定义功能层映射的证据模型与有限实例验收，同时扩大独立静态评测。当前没有 AI 功能归纳、动态执行、Git Diff、Agent 路线图或增量分析；这些不是此次遗失的工作。
