# RepoGraphia

**以代码证据为基础的项目可视化与探索工具。**

先用程序化静态分析建立可追溯的代码关系，再逐步扩展到功能地图和人与 Agent 的开发协作。第一轮交付的是一个独立的命令行分析器和离线 HTML 审阅页面，不是 Codex-Monitor 的插件，也不要求接入任何模型。

## 现在可以做什么

输入一个本地 TypeScript/JavaScript 项目，输出 `graph.json` 和一个可以直接打开的 `index.html`。

- **源码索引**：文件、函数、类、接口、方法、显式构造函数、匿名回调及它们的包含关系。
- **语义绑定**：使用 TypeScript Compiler API，处理跨文件导入、再导出、别名、词法遮蔽和重载实现。调用、继承、类型导入、JSX 引用、回调传入分别记录。
- **证据审阅**：每条关系附源码坐标、解析规则、原始片段和文件 SHA-256；未知目标不强行连线。
- **交互探索**：文件/符号导航、搜索、一跳关系图、状态筛选、节点/连线审阅、父子实体跳转、测试路径开关和缩放。
- **程序查询**：搜索、调用方/被调用方查询、限定深度的子图，明确返回候选边、未知边和截断边界。

这是可运行的 **R1 静态探索版本**。当前没有功能语义归纳、增量监控、跨语言完整分析、动态追踪或 Agent 任务调度。

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

## 交互页面

左侧从文件切换到函数/类，点击节点进入局部关系图；点击连线或下方关系记录，右侧展示具体依据。文件视图会聚合该文件内实体的关系，函数视图保留函数级归属。

默认隐藏按路径识别的测试文件；顶部统计仍覆盖整个选定程序。图中每侧最多展示 7 个邻接目标，同目标连线显示首条匹配记录；完整匹配记录在下方分页展示。界面始终标出图的截断情况，避免误认为屏幕上的几条线就是所有关系。

“分析边界”列出未索引源码、忽略目录、符号链接、编译诊断及当前分析能力限制。诊断列表最多展示前 100 条，完整数据保留在 JSON 中。

## 给程序和 Agent 使用

```sh
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

CI 在隔离目录读取这个提交、安装依赖时禁用生命周期脚本，校验三个实际跨文件调用绑定和 IPC 不误连规则，再用 Chromium 测试生成页面。不会运行 Codex-Monitor 的应用或业务测试。`codex-monitor-report` 构建产物包含 HTML、JSON、截图和带版本的验证摘要。

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
src/query.ts    有界关系查询
src/report.ts  安全的离线报告生成
src/cli.ts     命令行入口
viewer/        无外部资源的 HTML/CSS/JS 审阅界面
tests/         分析准确性与边界回归
scripts/       固定真实样本和浏览器验证
```

后续优先补充可验证的静态分析规则和评测，再引入功能映射、变更定位与 Agent 任务视图。详细约束见 [架构说明](docs/architecture.md)；开发约定见 [AGENTS.md](AGENTS.md)。
