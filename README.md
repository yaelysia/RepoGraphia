# RepoGraphia

**把代码仓库变成可探索、可审阅的项目地图。**

RepoGraphia 是独立的本地工具：先用 TypeScript 编译器提取代码结构和关系，在持续工作区或离线 HTML 中探索；再由你使用的 Coding Agent 按 Skill 阅读证据、提出功能与代码的关联。你可以在开发前记录起点，开发中查看已保存代码的变化，开发后保留版本和审阅记录。每条关系都能追溯源码，候选、未知和分析范围不会被隐藏。

**日常使用只需 `master`，不需要切开发分支。** 当前是源码安装版，未发布 npm 包或桌面安装包；不要使用 `npm install -g repographia` 安装同名第三方包。

## 你可以做什么

| 目标 | 使用方式 |
| --- | --- |
| 看懂项目结构 | 目录地图 → 文件 → 函数/类 → 源码与关系证据 |
| 跟随代码更新 | 启动持续工作区，保存源码后自动核对并重建代码图 |
| 看本轮改了什么 | 固定开发目标与起点，先看功能说明及关联变化，再下钻文件、源码和关系 |
| 审阅开发结果 | 对本轮、功能、变化文件或验收点记录人工结论、外部核验结果和待确认项，保留固定前后版本 |
| 查调用关系 | 搜索实体、查看调用方/被调用方、展开候选值来源和未解析原因 |
| 按功能理解代码 | 让现有 Agent 使用随附 Skill，提出有源码依据的功能映射 |
| 审阅和纠正 | 在页面修改、接受或拒绝映射；持续工作区自动保存已应用的标注，离线报告导出 JSON 保存 |
| 代码变化后维护标注 | 对照新旧代码图，明确选择迁移、替换或暂缓 |

查看和更新代码图**不需要 AI 或 API Key**。持续工作区使用本机服务，离线 HTML 可直接打开。生成功能提案需要另一个能执行本地命令、读取文件的 Agent；RepoGraphia 不内置模型，也不会自动消耗模型额度。

## 1. 安装

准备 **Git、Node.js 22 或更高版本（含 npm）**。Windows PowerShell、macOS 或 Linux 终端均可执行：

```sh
git clone --branch master https://github.com/yaelysia/RepoGraphia.git
cd RepoGraphia
npm ci --ignore-scripts
npm run build
node dist/cli.js --help
```

首次安装需要联网下载锁定依赖。`npm run build` 生成 `dist/`，后续分析和 HTML 浏览都可以离线进行。安装时不要省略开发依赖，否则构建可能缺少 Node 类型声明；设置过生产模式时用 `npm ci --ignore-scripts --include=dev`。

Windows 遇到“无法加载 npm.ps1”时，可以在同一终端把命令中的 `npm` 换为 `npm.cmd`，无需为本工具放宽全局执行策略。

## 2. 开始使用

假设 RepoGraphia 和要分析的 Codex-Monitor 在同一个父目录下。以下命令都在 **RepoGraphia 目录**执行。

### 持续工作区：开发时跟随已保存代码

想把持续更新、功能建设和开发审阅连起来试一遍，先看 [Windows 本地试用 M1 / M2 / M3](docs/m123-local-trial.md)。

```sh
node dist/cli.js workspace "../Codex-Monitor" --out "../repographia-workspaces/codex-monitor"
```

打开终端输出的完整本机网址，保留末尾的 `#token=...`。终端保持运行；按 `Ctrl+C` 关闭。下次执行同一条命令，打开新输出的网址，就能恢复已保存的代码版本、标注和开发起点。

工作区默认只监听 `127.0.0.1`，自动选择空闲端口。`--out` 可以是新目录或该项目已有的工作区，必须在被分析项目之外；它绑定同一个项目路径和所选配置。指定子项目时加 `--project "packages/app/tsconfig.json"`，需要固定端口时加 `--port 4173`。

在页面点击 **「开始一轮开发」**，写下本轮目标，可补充明确关注的功能和验收点，然后建立起点，再交给你原本使用的 Coding Agent 编码。起点包含当时已经保存的未提交修改。保存代码后，工作区核对输入并完整重建代码图；点击 **「查看新代码版本」** 切换，在 **「开发审阅」** 查看功能层面的前后变化，按需要进入 **「代码变化」** 查看源码。后台更新会保留正在阅读的版本。

开发审阅把目标声明、代码事实、人工判断与外部核验结果分别保存。范围外变化和未归属代码提示你继续核对；旧功能关联的接受状态不会充当本轮验收。每条审阅绑定固定版本，新代码或新标注不会继承旧结论。操作与导出见 [开发过程与结果审阅](docs/development-review.md)。

已应用的功能标注自动保存到工作区；表单里还没点击应用的文字仍需先应用。遇到保存冲突可保留并导出草稿。每个代码版本包含完整的已索引源码，分享工作区或导出报告也会分享这些代码。

在 **「功能建设」** 准备项目粗图、围绕某个功能深入或按变化续分析的固定任务包，交给现有 Codex/Agent，导入返回的修订，逐项比较后整批应用。功能可按实际需要继续深入；新代码和需要复核的旧依据分别可见。

版本、保存与恢复见 [持续工作区使用说明](docs/continuous-workspace.md)；任务交接、当前引用状态与迟到提案处理见 [功能建设与增量修订](docs/feature-tasks.md)。底层代码图仍采用自动触发的完整重建。

### 离线报告：生成一份固定代码图

```sh
npm run analyze -- "../Codex-Monitor" --out "./reports/codex-monitor-r1" --include-source
```

成功后，直接用浏览器打开：

```text
RepoGraphia/reports/codex-monitor-r1/index.html
```

Windows PowerShell 也可运行：

```powershell
Start-Process "./reports/codex-monitor-r1/index.html"
```

分析其他项目，只需替换输入路径和输出目录：

```sh
node dist/cli.js analyze "D:/projects/my-app" --out "./reports/my-app-r1" --include-source
```

离线 `analyze` 的 **`--out` 必须是尚不存在的新目录，并且位于被分析项目之外。不要预先创建最后一级目录。** 再次分析时用 `my-app-r2` 等新名称，避免覆盖旧图、旧报告或通过硬链接意外改写源码；旧图也可能是后续迁移标注所需的依据。

每份报告包含：

| 文件 | 用途 |
| --- | --- |
| `index.html` | 可直接打开的离线交互页面 |
| `graph.json` | 同一快照的完整结构数据，供 CLI、Agent 和迁移使用 |

`--include-source` 会嵌入完整的已索引源码，便于 Agent 查证；省略时仍可浏览代码图，但只有源码节选，Agent 提案校验可能因缺少完整源码而拒绝。**分享带源码的报告，相当于分享其中的代码。**

### 项目配置与依赖

优先使用目标仓库根目录的 `tsconfig.json`；没有配置时扫描 TS/JS 文件。指定子项目：

```sh
node dist/cli.js analyze "../my-monorepo" --project "packages/app/tsconfig.json" --out "./reports/app-r1" --include-source
```

目标项目的类型依赖应在它自己的开发环境中准备好。RepoGraphia 不替目标执行安装、构建、测试或启动命令；缺少类型时会保留诊断和未解析信息。多 `tsconfig` 的项目目前需要分别分析，不能把一个叶项目的图当作整个 Monorepo 已覆盖。

## 3. 浏览和审阅

打开页面先看**项目地图**。项目地图、功能映射和源码阅读共用固定暗色工作台：墨蓝背景、蓝紫强调、细点阵画布，顶部模式按钮和搜索位置保持一致。目录和文件使用可读的节点，点选阅读，再通过独立按钮进入；画布支持拖动、缩放和适应。切换功能映射后返回，会保留项目目录、筛选、选中项及阅读位置。

「项目导航」按需打开，文件、函数/类和分析边界在其中切换；顶部搜索会打开对应结果。「项目概况」展开完整快照指标。点函数或关系记录查看源码、解析规则、哈希和候选来源。局部图及长列表有显示上限，界面会注明截断并提供继续探索入口。

**分析边界**列出未索引语言/文件、编译诊断和未解析原因。**功能映射**展示已有标注；新生成的代码图没有功能提案时，该页为空是正常的，不是分析失败。

### 功能地图的阅读方式

功能地图与项目地图保持相同暗色和布局，**左侧画布、右侧阅读区**，不会因系统浅色偏好变成白底。胶囊节点显示名称和一句解释；点选只打开说明，点击「进入功能」才进入它的下一层，深度由实际标注决定。路径栏可逐层返回，全局搜索和按需打开的功能树帮助定位；画布默认以 100% 显示，可拖动、缩放或点击「适应」。模式切换、目录与功能层级切换都有有限的横移与缩放动效，并遵循系统的减少动态效果设置；背景保持静止。

右侧按**说明、依据、审阅**分开阅读，完整描述默认折叠。查看「关联代码」后，代码仍按入口、实现、支撑和测试分组；支撑/测试默认折叠但数量可见，「全部关联」保留完整分页记录。功能层级连线仅表示显式包含关系；原图调用箭头需另行开启，候选仍用虚线。返回原层会恢复画布和展开状态，不从共享代码推断功能依赖。

已有 Agent 提案不必重新生成。更新并构建后，用原图和原标注渲染到新文件：

```sh
node dist/cli.js features render "./reports/codex-monitor-r1/graph.json" "./reports/agent-trial-result-01/features.json" --out "./reports/feature-workbench.html"
```

打开新 HTML 的「功能映射」。路径按实际报告调整，必须配对同一快照。详细交互和边界见 [功能地图阅读说明](docs/feature-map-visual.md)。

功能标注可显式提供 `summary`（一句解释）和 `parentId`（父功能），用于按实际深度探索功能组成；不会从共享代码猜测层级。新字段使用 FeatureMap schema 3，schema 1/2 的旧标注仍可直接读取和渲染。只浏览不会升级或改写文档；首次保存新字段时才升级，并保留原证据快照。Agent 提案协议仍为版本 1。

代码关系的四种状态：

| 状态 | 意义 |
| --- | --- |
| `bound` 静态绑定 | 已定位到相应声明或明确结构关系；不证明实际执行或运行时目标唯一 |
| `candidate` 候选 | 有类型、成员或有限值来源依据；不代表枚举了全部运行时实现 |
| `unresolved` 未解析 | 调用位置存在，但没有足够依据定位实现；不代表没有关系 |
| `external` 外部边界 | 定位到索引范围外的依赖/标准库声明；不代表分析了依赖实现 |

回调传入、JSX、导入与继承不会冒充普通函数调用。用户接受功能映射，也不会把它依赖的候选关系升级成确定事实。

## 4. 让 Agent 使用 Skill 生成功能提案

### 持续工作区：使用固定任务包

在「功能建设」生成并下载任务包，向 Codex 提供仓库内 Skill、CLI 和任务包的绝对路径。Skill **1.3** 会进入 `agent task overview/search/inspect/relation/check/submit` 流程。提交目录包含 `revision.json`、`review.json` 和 `receipt.json`；将 **`revision.json`** 导入工作区查看差异并决定是否应用。新增和改变的关联仍待审，不由 Agent 自行接受。

完整可复制任务和命令见 [功能建设说明](docs/feature-tasks.md#2-把任务交给现有-codex)。若 Skill 以前复制到用户目录，需要同步整个新版目录（含 references），或直接让 Codex 读取当前仓库内的路径。

### 离线追加流程：提供 Skill 路径

不需要先配置 MCP。向能执行本地命令的 Agent 提供以下任务，**将路径替换为你的绝对路径**：

```text
读取 <工具目录>/skills/repographia-function-map/SKILL.md，
按照其中的探索、反例检查、自评和检查点流程执行。

CLI：<工具目录>/dist/cli.js
代码图：<工具目录>/reports/codex-monitor-r1/graph.json
已有标注：无
输出目录：<工具目录>/reports/feature-run-1（新目录）

先选择一个有限的功能区域，提出 1–3 个有代码依据的功能划分。
保留支持依据、限制条件和未探索区域，不根据目录名猜功能。
只提交待审提案，不运行或修改目标项目，不代替我接受。
保存原始查询、提案、自评和 TRIAL.md，完成后给我报告路径。
```

已有人工标注时，将“已有标注：无”换为其 JSON 绝对路径，并要求所有查询、校验、提交都使用同一份 `--features`。**不要为了绕开旧决定而新建空标注。** 每批分析使用固定的 `graph.json`，不要边查边重新扫描或混用不同快照的 ID。

Agent 使用的命令入口是：

```sh
node dist/cli.js agent --help
```

它提供 `overview`、`search`、`inspect`、`relation`、`check`、`submit`。原始输出为 JSON，错误带修正提示；模型只负责语义和准确 ID，程序核验引用、哈希与源码引文。机器读取输出时使用 `node dist/cli.js`，不要把 npm 自身的日志当作 JSON。

提案成功提交后，会生成独立新目录，包含原始 `proposal.json`、派生 `features.json`、`assessment.json`、`index.html` 和最后写入的 `receipt.json`。**打开这份新目录的 HTML 才能看到新增功能**，原代码图 HTML 不会自动刷新。新映射只能是 `agent/proposed`，不会覆盖原功能或已接受/拒绝的映射。

### 可选：安装为 Codex 用户级 Skill

按 [Codex 官方 Skill 文档](https://developers.openai.com/codex/build-skills)，用户级目录为 `~/.agents/skills/`。在 RepoGraphia 目录复制**整个** Skill 文件夹，包括 `references/`：

Windows PowerShell：

```powershell
$dest = Join-Path $HOME ".agents/skills/repographia-function-map"
if (Test-Path $dest) { throw "Skill 已存在，请先备份或检查自定义改动，不直接覆盖。" }
New-Item -ItemType Directory -Force (Split-Path $dest) | Out-Null
Copy-Item "./skills/repographia-function-map" $dest -Recurse
```

macOS / Linux：

```sh
mkdir -p "$HOME/.agents/skills"
if [ ! -e "$HOME/.agents/skills/repographia-function-map" ]; then
  cp -R ./skills/repographia-function-map "$HOME/.agents/skills/"
else
  printf '%s\n' 'Skill 已存在，请先备份或检查改动，不直接覆盖。'
fi
```

在 Codex 中显式使用 `$repographia-function-map`，仍需提供工具、代码图和输出路径；Skill 本身不包含分析器或模型。宿主未识别时重启宿主，或直接使用上面的“读取 Skill 路径”方式。其他 Agent 的安装位置以各自文档为准；RepoGraphia 不会自动修改全局设置，也未保证自动触发率。

## 5. 保存标注，以及代码更新后的迁移

**持续工作区会自动保存已应用的标注。** 接受、拒绝或应用修正后，等顶部显示“标注已保存”。编辑表单中尚未应用的内容仍在页面内；保存冲突或连接中断时，先保留并导出草稿，核对后再重载。任务起点和历史标注保留原版本，只读查看。

**离线 HTML 的修改只在内存中。** 接受、拒绝或修正映射后，点击“导出标注 JSON”并保存下载文件；关闭页面不会自动写回 HTML、源码或 Git。工作区导出的离线报告也遵循这一规则。以后可以在页面导入该 JSON，或生成新报告：

```sh
node dist/cli.js features check "./reports/codex-monitor-r1/graph.json" "./features-reviewed.json"
node dist/cli.js features render "./reports/codex-monitor-r1/graph.json" "./features-reviewed.json" --out "./reports/features-reviewed.html"
```

`check` 退出码：`0` 引用匹配，`2` 含失效证据，`1` 格式或操作错误。引用匹配不等于业务含义正确。`render` 可以显示失效标注，但不会偷偷跳转到新版本的同名函数。文件输出同样拒绝覆盖已有路径。

代码改变后，保留旧图和旧标注，再生成或切换到新图。持续工作区保留原功能内容和人工决定，并额外显示当前引用“仍匹配／需要复核／无法定位／未能核对”；这是只读核对结果，不改写旧依据或自动接受新含义。需要修改功能或关联时，从「功能建设」准备修订任务。

原离线评估和显式迁移仍采用严格快照规则。可通过页面“跨快照迁移”导入旧图，逐条选择复用、重新指定或暂缓；也可先用 CLI 生成只读计划：

```sh
node dist/cli.js features plan "./reports/codex-monitor-r1/graph.json" "./reports/codex-monitor-r2/graph.json" "./features-reviewed.json" --out "./reports/migration-plan.json"
```

旧接受在明确迁移后退回待审，拒绝保留，暂缓项保留旧证据并继续失效。没有同名或模糊自动重绑。完整操作见 [迁移说明](docs/feature-migration.md)。

## 6. 更新到主分支最新版

在 RepoGraphia 目录先确认并保留自己的未提交修改，再执行：

```sh
git fetch origin
git switch master
git pull --ff-only origin master
npm ci --ignore-scripts
npm run build
node dist/cli.js agent --help
```

从旧开发分支切过来也用这组命令；不需要 `reset --hard` 或清理工作区。切换被本地修改阻止时，先提交或另行保存修改，不强制覆盖。

工具更新不会刷新旧 HTML；重新生成报告请用新 `--out` 路径。持续工作区需关闭旧服务，完成构建后以原命令重开，并使用新输出的网址。使用仓库内 Skill 路径会随 `git pull` 更新；已复制到用户目录的 Skill 则需先保留自定义改动，再手动同步整个目录。

本版将配置继承、源码和模块解析环境纳入新的输入身份规则（`inputRevision: 1`），重新分析会产生与旧版不同的快照 ID，即使源码未改。原先配对的 `graph.json` 和 `features.json` 仍可直接阅读或重新渲染，不会被改写，也无需重跑 Agent。新工作区的 `--features` 只接纳与首次分析图准确配对的标注，旧版标注需先按显式迁移流程处理。工作区绑定本机项目和配置路径，不把快照 ID 当作不同目录之间可互换的版本号。

M2 又在输入摘要中记录实际配置读取用途（`configReads`），因此从 M1 升级后首次重新分析也会产生新快照。已有工作区仍可重开，原任务、标注和历史图保留；缺少用途记录的旧图在跨版本引用核对中显示“未能核对”，不会把旧接受冒充当前依据。可从当前版本准备修订任务，或走已有显式迁移。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| 找不到 `dist/cli.js` | 在工具目录完成 `npm ci --ignore-scripts` 和 `npm run build`，确认不是在目标仓库执行 |
| 不认识 `agent` 命令 | 按上节更新到 master 并重新构建，避免使用旧分支或旧 dist |
| `Output directory already exists` / `EEXIST` | 离线输出使用新的报告目录或文件；持续工作区使用其原 `--out` 恢复，不能把普通报告目录当作工作区 |
| `Output must be outside...` | 将输出放在工具的 reports 或其他目标仓库之外的位置 |
| 无法解析模块、图中有很多未知关系 | 检查目标依赖和所选 tsconfig；在“分析边界”看实际诊断，不把未知当作不存在 |
| `SOURCE_REQUIRED` / 只有 excerpt | 用 `--include-source` 生成新图，然后从新快照开始探索 |
| `STALE_BASE` / `SNAPSHOT_CONFLICT` / `REVISION_CONFLICT` | 核对图与标注，必要时显式迁移；不要手改哈希或版本来绕过校验 |
| Agent 声称提交但没看到功能 | 工作区任务先导入输出目录的 `revision.json`，审阅后应用；原离线追加流程打开新目录的 `index.html`。两者都需有效 `receipt.json`，I/O 中断留下的目录不代表成功 |
| 浏览器刷新后编辑消失 | 离线报告需导出 JSON；持续工作区需应用表单并等到“标注已保存”，未应用表单不会恢复 |
| 工作区有新版本，地图没有自动切换 | 这是固定审阅版本的行为；完成或保存当前编辑后，点击“查看新代码版本” |
| 重开后无法连接旧网址 | 使用本次启动输出的完整网址；每次启动都会生成新凭据，自动端口也可能变化 |

## 验证、边界与开发文档

```sh
npm test
```

CI 使用锁定 TypeScript 5.9.3，运行 Linux/Windows 单元测试，以及真实离线 Chromium 的代码图、项目地图、功能映射、迁移和 Agent 报告检查。另在固定 Codex-Monitor 提交上做同输入对照，不运行目标应用。Agent 样例复播是协议/界面回归，**不是另一轮模型理解实验**；作者的实际 Skill 自用和修改记录见 [试跑记录](docs/trials/agent-notification/)。

持续工作区目前观察已保存的 TS/JS 项目输入，以完整重建跟随变化，并比较固定代码版本。文件进入/离开索引可能来自源码或分析范围变化，不等同于磁盘上的新增/删除；候选、未知、诊断和预算限制仍保留。

功能图支持局部引用核对和有范围约束的外部 Agent 修订；探索记录是 Agent 对固定文件版本的自述，不能当作完整理解率。目前不支持编辑器未保存内容、内置模型 API、MCP 服务、Agent 执行进度、真正局部增量提取、全项目自动功能识别保证、完整跨语言/跨进程调用图或动态追踪。Git HEAD 只作辅助版本信息，不代表工作区无修改；实际依据以保存的快照和内容哈希为准。代码变化和接受功能映射都不等同于测试通过或功能完成。

工具不执行目标代码，没有远程遥测。离线报告不发起网络请求，持续工作区只与本机服务通信。它不是用于敌对仓库的操作系统沙箱；源码/标注中的文本不是可信指令，任意文件写权限也不会被 Skill 或提案协议限制成隔离环境。

[持续工作区](docs/continuous-workspace.md) · [功能建设](docs/feature-tasks.md) · [产品方向与下一阶段计划](docs/product-direction.md) · [架构](docs/architecture.md) · [项目地图](docs/project-map.md) · [功能标注](docs/feature-mapping.md) · [Agent CLI](docs/agent-cli.md) · [开发约定](AGENTS.md) · [当前接手检查点](docs/CHECKPOINT.md)
