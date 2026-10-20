# RepoGraphia

**以代码证据为基础的项目可视化与探索工具。**

先用程序化静态分析建立可追溯的代码关系，再逐步扩展到功能地图和人与 Agent 的开发协作。第一轮交付的是一个独立的命令行分析器和离线 HTML 审阅页面，不是 Codex-Monitor 的插件，也不要求接入任何模型。

开发接手从 [当前检查点](docs/CHECKPOINT.md) 开始：已完成阶段、验证版本、剩余工作和复现命令都记录在仓库中，不依赖聊天记录。

## 现在可以做什么

输入一个本地 TypeScript/JavaScript 项目，输出 `graph.json` 和一个可以直接打开的 `index.html`。

- **源码索引**：文件、函数、类、接口、方法、显式构造函数、匿名回调及它们的包含关系。
- **语义绑定**：使用 TypeScript Compiler API，处理跨文件导入、再导出、别名、词法遮蔽和重载实现。调用、继承、类型导入、JSX 引用、回调传入分别记录。
- **证据审阅**：每条关系附源码坐标、解析规则、原始片段和文件 SHA-256；未知目标不强行连线。
- **项目地图**：默认从目录整体结构开始，逐层进入目录、文件、函数和源码；有向聚合连接保留关系类型、候选状态及原始证据。
- **局部探索**：文件/符号导航、搜索、一跳关系图、状态筛选、节点/连线审阅、父子实体跳转、测试路径开关和缩放。
- **程序查询**：搜索、调用方/被调用方查询、限定深度的子图，明确返回候选边、未知边和截断边界。

这是可运行的 **静态代码探索与项目地图版本**。当前没有功能语义归纳、增量监控、跨语言完整分析、动态追踪或 Agent 任务调度。

## 安装与运行

需要 Node.js 22 或更高版本。分析器的 TypeScript 版本锁定为 5.9.3；首次安装需要下载依赖，分析和报告浏览不需要联网。

```sh
git clone https://github.com/yaelysia/RepoGraphia.git
cd RepoGraphia
npm ci --ignore-scripts
npm run build
```

假设 Codex-Monitor 和 RepoGraphia 位于同一父目录：

```sh
npm run analyze -- ../Codex-Monitor --out ./reports/codex-monitor --include-source
```

完成后在浏览器中打开 `reports/codex-monitor/index.html`，不需要启动服务器。上面的命令不会修改 Codex-Monitor，也不会运行它的启动脚本或测试。`--out` 必须在**被分析项目之外**。

自定义配置或分析其他项目：

```sh
node dist/cli.js analyze /path/to/project --out /path/to/report
node dist/cli.js analyze /path/to/project --project packages/app/tsconfig.json --out /path/to/report
```

Windows 路径可以使用 `D:/projects/example`，有空格时加引号。

优先使用被分析项目已有的 `tsconfig.json`，没有配置时使用默认 TS/JS 文件扫描。需要类型信息的项目应先在其自己的环境中安装依赖；RepoGraphia **不会自动安装或执行目标项目的依赖**。缺失依赖时保留编译诊断和未解析调用，不把解析降级隐藏起来。多项目引用暂不递归展开，请用 `--project` 指向叶项目。

## 如何理解四种状态

| 状态 | 含义 | 不能推出的结论 |
| --- | --- | --- |
| `bound` 静态绑定 | 编译器解析到对应的词法声明或显式结构关系 | 不证明代码实际执行或运行时目标唯一 |
| `candidate` 候选绑定 | 类型契约、成员声明或间接可调用值的候选依据 | 不是穷举了所有运行时实现 |
| `unresolved` 未解析 | 调用点存在，但未得到可导航的项目内实现绑定 | 不代表不存在调用关系 |
| `external` 外部边界 | 定位到索引范围之外的依赖或标准库声明 | 不代表已经分析了依赖实现 |

例如 `handler.execute()` 可能只绑定到接口中的 `execute` 声明；不会为了补齐图而擅自选择某个实现类。`register(callback)` 会记录“回调作为参数传入”，不会把它替换成“register 已调用 callback”。JSX 也单独标记为组件引用。

静态图不是程序运行轨迹，也不是完整的调用图证明。结构化规则解释是程序生成的，不依赖模型编造理由。

## R1 静态准确性补强（已完成）

R1 收尾新增 15 项正反例回归，修复三个具体问题：可变父类不再从候选关系被升级为确定继承；计算属性名中的调用不再计入方法体调用链；`satisfies` 包装后的函数/别名保留可解析的值关系，同时不抹掉可变值的不确定性。接口继承与实现声明明确标记为仅类型关系。

从规则版本 2 开始，报告元数据及页面显示 `analysisRevision`（当前为 4）。规则版本参与 snapshot 计算，避免相同源码在不同分析规则下被当成同一结果。旧版 schema-v1 报告缺少此字段时显示“未标注（旧报告）”，需要重新分析才能使用新规则；这不代表节点 ID 可以跨快照复用。

## 解析诊断与边界修正（分析规则 3）

“未解析”现在附带程序生成的原因：参数传入、解构值、可变变量/别名、未知属性、调用或 getter 返回值、已找到范围外声明、模块加载语法、无符号及暂未映射的声明。分类描述的是**已有证据**，不是自动判定程序出错或承诺某种修复一定有效。

- 直接绑定到标准库或依赖的变量/属性声明，标为 `external`。本地同名参数、可变别名不享用这项规则。**外部声明不等于实际执行过的外部实现。**
- 对象/类字段显式初始化的函数体以及属性别名，保留为 `candidate`，不把初始化值当作后续所有调用点的确定目标。getter 返回函数时，不将 getter 自身误连成那个函数的实现。
- 仓库内 `.d.ts/.d.mts` 等声明存在而实现未索引时，附声明坐标和文件哈希；不按文件名把声明猜接到 `.js/.mjs`。
- HTML 的“分析边界”顶部提供原因分组。点击分类查看每页 25 条记录，再点击记录定位所属实体与源码证据。分类统计覆盖整个选定程序（含测试），不会随文件导航的隐藏测试开关改变分母。

```sh
node dist/cli.js query reports/codex-monitor/graph.json diagnostics
node dist/cli.js query reports/codex-monitor/graph.json diagnostics parameter-value --limit 25 --offset 0
```

诊断概览复用 `src/diagnostics.ts`，示例每组最多 3 条；完整分类查询返回 `total`、原始关系证据和 `boundary.nextOffset`。老报告没有结构化原因时列为 `unclassified`，不从旧解释或名称反推新结论。规则 3 仍是可加字段的 schema v1，需要重新分析才能获得新结果。

规则 3 阶段增加 35 项回归。当时 CI 在**同一个固定样本及类型依赖目录**中运行当前工具和固定的规则 2 工具，检查源码哈希、调用点坐标集合均不变，再生成 `resolution-comparison.json`。把未知改为外部边界，与新增候选实现分开统计；不能通过删除调用点美化解析数量。具体受测版本和结果见检查点。

## 有限值来源追踪（分析规则 4）

对原本因为解构或参数而未解析的显式调用，补充有界、程序化的声明来源追踪：常量对象/数组字面量、嵌套解构、重命名、简写属性、跨文件别名，以及已索引直接调用/显式构造中的实参。可恢复的目标**一律保持 `candidate`**，不升级为 `bound`。

例如 `const { task } = { task: run }; task()` 可以沿初始化定位 `run`；`invoke(run)` 中的形参调用也可以保留 `run` 的传参来源。但没有找到的调用方、对象变更和动态分派仍未覆盖，不能把局部来源当成唯一运行时目标。

点击关系记录中的“值来源追踪”，展开来源路径，再点任意步骤查看准确源码与哈希，可返回原关系。没有可恢复目标时同样展示停止位置，例如 Hook/工厂返回值、getter、动态键、展开表达式、解构默认值、可变绑定或已写入参数。不会根据框架名或类型签名虚构返回函数。

每次追踪最多 12 层、64 个探索步骤、16 条来源路径、16 个停止位置；每个函数最多采纳 16 个直接调用点。超过预算显式设置 `truncated=true`，不隐藏截断。`evidence.valueOrigins.complete` 固定为 `false`：即使预算未耗尽，也不承诺调用方全集、对象状态、时序或路径可行性。解构默认值和 rest 暂停分析；普通参数默认值仅在已索引调用确实省略该实参时提供条件来源。

来源证据随既有 `callers/callees` 查询返回；默认查询仍不遍历候选，显式指定 `--include-candidates` 才纳入。旧报告没有来源字段时不反推补齐。规则 4 阶段 CI 以固定规则 3 为对照，使用同一源码/类型依赖并核对全部显式调用点。项目地图阶段则以 CP9（规则 4）为对照，要求文件、节点、关系、范围和诊断全部不变。

## 交互页面

新报告默认打开项目地图。选择目录节点后点击“进入目录”，逐层定位到文件，再打开已有函数与源码视图；“返回项目地图”保留上次目录位置。点击跨目录连接可分页审阅原始关系，每页 25 条；组内、范围外、无目标和未索引区域都有独立入口。目录名称只代表真实路径，不是 AI 归纳的业务功能。

画布默认最多 12 个子级节点、24 条聚合连接，支持增加预算；超限会明确显示，仍可通过左侧和下方列表继续探索。浏览器与 CLI 使用同一份纯投影逻辑，不修改原始代码图。完整解释与边界见 [项目地图说明](docs/project-map.md)。

在局部探索视图中，左侧从文件切换到函数/类，点击节点进入局部关系图；点击连线或下方关系记录，右侧展示具体依据。文件视图会聚合该文件内实体的关系，函数视图保留函数级归属。

默认隐藏按路径识别的测试文件；顶部统计仍覆盖整个选定程序。局部图中每侧最多展示 7 个邻接目标，同目标连线显示首条匹配记录；完整匹配记录在下方分页展示。界面始终标出图的截断情况，避免误认为屏幕上的几条线就是所有关系。

“分析边界”列出未索引源码、忽略目录、符号链接、编译诊断及当前分析能力限制。诊断列表最多展示前 100 条，完整数据保留在 JSON 中。

## 给程序和 Agent 使用

```sh
node dist/cli.js query reports/codex-monitor/graph.json map
node dist/cli.js query reports/codex-monitor/graph.json map src --kind import
node dist/cli.js query reports/codex-monitor/graph.json map-records . --from electron --to src --limit 25
node dist/cli.js query reports/codex-monitor/graph.json search scanLocal
node dist/cli.js query reports/codex-monitor/graph.json callees scanLocal --depth 2
node dist/cli.js query reports/codex-monitor/graph.json callers scanLocal --include-candidates
```

名称不唯一时明确报错，请从搜索结果复制节点 ID，而不是让工具猜选哪个同名函数。默认只遍历 `bound` 的显式调用/构造/模板调用，候选关系必须显式开启。回调传入、JSX、导入不混入函数调用链。

查询返回 `omittedRelations` 和 `boundary`，包含深度、数量预算、是否截断、是否还有关系，以及未装入结果节点集合的端点。查询没有返回路径并不证明运行时路径不存在。

## 可复现验证

```sh
npm test
```

自动化测试覆盖别名、跨文件重导出、重载、遮蔽、接口分派、动态值、回调归属、构造函数、JSX、未知依赖、证据坐标/哈希、查询边界、Windows 路径、配置范围、HTML 注入防护和只读输出约束。Windows CI 中需要创建符号链接权限的 3 项用例会明确跳过，其余照常执行；Linux 执行全部用例。

真实样本固定为：

```text
yaelysia/Codex-Monitor
490d822a9593d8d4b78a9188dd0daa0ae791eaf6
```

CI 在隔离目录读取这个提交、安装依赖时禁用生命周期脚本，校验三个实际跨文件调用绑定和 IPC 不误连规则，再用 Chromium 测试生成页面。不会运行 Codex-Monitor 的应用或业务测试。`codex-monitor-report` 构建产物包含 HTML、JSON、截图、原因汇总、新旧规则对照和带版本的验证摘要（legacy-test.html 仅是格式兼容夹具，不是旧版工具实测报告）。另有 `checkpoint-source` 保存实际测试 Git 树的源码归档，不包含凭据、依赖或未跟踪文件，保留 30 天。长期接手以 Git 提交和检查点文档为准，而不是依赖会过期的构建产物。

本地复现需要该提交的**独立副本**，不要为了复现而覆盖你正在开发的工作区：

```sh
node scripts/verify-sample.mjs /path/to/pinned/Codex-Monitor ./reports/codex-monitor
```

样本的关系数量和已通过的选定断言不等于全仓库精确率、召回率或功能正确率；这些指标尚未建立独立人工标注基准。

## 数据与安全边界

报告默认包含源码片段；`--include-source` 还会包含完整的已索引文件。**分享报告相当于分享其中的代码**，私有项目报告不应随意上传。报告没有外部资源或网络请求，源代码以文本显示，内嵌 JSON 经过转义并配合脚本哈希 CSP。

分析器只读取目标文件及类型/配置依赖，不执行目标代码、npm 脚本或插件，不注入 Hook、不修改目标仓库。Git 仅用于读取 HEAD 基线，不运行可能触发仓库自定义辅助程序的 `git status`；`dirty` 当前为 `null`，报告的实际内容身份以文件哈希和 snapshot 为准，HEAD 不能证明工作区无改动。

这是本地开发工具，不是用于不可信仓库的操作系统级沙箱。初次分析较大项目建议在开发副本中执行，并保留足够内存；目前是全量重建，没有增量分析或后台监控。

## 结构与后续方向

```text
src/project.ts  项目范围、配置、路径、编译器输入
src/analyze.ts  程序化关系提取与结构化证据
src/model.ts    JSON 数据模型
src/value-origins.ts 有界解构/直接实参来源与停止证据
src/query.ts    有界关系查询
src/diagnostics.ts 未解析原因汇总和分页证据
src/project-map.ts 共享目录投影、类型聚合与证据分页
src/feature-map.ts 功能/代码标注、引用校验与版本化修正
src/feature-cli.ts 标注创建、检查、修正和报告输出
src/report.ts  安全的离线报告生成
src/cli.ts     命令行入口
viewer/        无外部资源的 HTML/CSS/JS 审阅界面
tests/         分析准确性与边界回归
scripts/       固定真实样本和浏览器验证
```

项目地图已具备从整体到源码的审阅链路，功能与代码的显式映射和人工修正也已具备第一版。后续先完善标注审阅与跨快照迁移，再引入可选功能归纳、变更定位与 Agent 任务视图。详细约束见 [架构说明](docs/architecture.md)；开发约定见 [AGENTS.md](AGENTS.md)。

## 功能与代码映射（试验版）

现在可以在独立 JSON sidecar 中维护功能提案与代码的多对多关联，并在“功能映射”页沿着代码锚点查看原关系、源码和值来源。共享代码不会自动形成业务依赖。人工接受/拒绝与证据是否过期分别显示；候选和未知关系不会因接受而升级。

页面支持新建/修正功能、代码反向关联、人工评审、导入和导出；**编辑只是内存草稿，需导出 JSON 保存**，不会写回源码或原 HTML。没有 sidecar 时功能页为空。当前 Codex-Monitor 示例是助手编写的三个有限提案，不是自动识别或用户确认。

```sh
node dist/cli.js features init reports/codex-monitor/graph.json --out features.json
node dist/cli.js features check reports/codex-monitor/graph.json features.json
node dist/cli.js features render reports/codex-monitor/graph.json features.json --out feature-report.html
```

新命令拒绝覆盖已有文件。快照/规则/源码/锚点变化后，旧映射明确失效，禁止同名自动重绑定。数据语义、编辑命令及失效限制见 [功能映射说明](docs/feature-mapping.md)。
