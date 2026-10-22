# 功能层级与代码映射

本层是 CodeGraph 之上的**可审阅语义标注**，不是静态分析器自动证明的业务功能。没有模型调用，不会根据目录名、共同依赖或函数名称自动建立功能。`examples/codex-monitor-feature-plan.json` 是助手编写的三个有限提案，全部 actorKind=agent、decision=proposed；不是用户确认、全仓库功能识别或业务测试结果。

## 数据与正确性边界

`FeatureMap` 独立保存为 JSON sidecar，不写入目标项目，也不改变 CodeGraph schema/分析规则 4/项目投影版本 1。普通新建仍为 schema 1；显式迁移后至少为 schema 2，每条映射有独立 basis。schema 3 增加作者明确填写的功能层级和短说明。新工具兼容三种格式，旧工具会拒绝不支持的版本。

- features：稳定的标注 ID、名称、完整说明和待确认问题；schema 3 可包含 `summary`（非空、最多 200 字符的一句说明）和 `parentId`（父功能准确 ID）。ID 由标注作者维护，不等于跨源码编辑稳定的代码 ID。
- mappings：多对多功能/代码关联，角色为 entry、implementation、support、test。test 只表示映射到测试代码，不表示执行过测试。每条映射必须有自己的理由及精确代码锚点；关系证据可选，缺少时明确显示“仅声明证据”。
- code：实体 ID、文件、文件 SHA-256、UTF-16 起止偏移、类型及名字。文件级映射不自动分配给文件内全部函数，不沿调用图扩散。
- evidence：显式关系 ID、坐标/文件哈希、from/targets、kind/status/typeOnly/rule。原关系必须触及对应代码实体（文件锚点允许该文件内端点），不接受无关关系来充当依据。类型/导入/回调不会被改称调用；candidate、unknown、external 与值来源不完整/截断均保留。
- basis：原始分析 snapshot、analysisRevision、compilerVersion、config。**第一版严格绑定整个快照**；任一变化都使旧映射失效，即使目标文件没有改变。没有增量失效、自动重锚或同名匹配。生成时间改变不失效。旧报告规则版本缺失时不得推定为当前规则。
- decision：proposed / accepted / rejected，与 current/失效完全分离。accepted 是作者申报的人工选择，不代表功能语义被程序证明，更不将候选调用变成 bound。导入文件、作者身份和历史均不提供认证、签名或防篡改保证。

系统校验的是**引用一致性**而不是语义真实性；`current=true` 不表示已经独立审计了上传图数据。更换或伪造整份图/标注不能靠该字段获得“证明”。共享代码不会制造功能间依赖边。无映射功能和待确认问题继续显示。

## 显式功能层级

省略 `parentId` 的功能位于顶层；有 `parentId` 的功能是指定父功能的直接组成。该关系只表示作者声明的**包含**，不表示调用、依赖或执行顺序。角色分组、代码目录和共享实体都不会自动变成父子功能。父功能也不会自动继承子功能的代码映射或审阅决定。

层级按实际数据逐层深入，没有固定层数上限。文档必须形成单父、无环的森林；不存在的父 ID、自指和任意位置的环均被拒绝。单次 CLI/浏览器编辑时父功能必须已经存在；Agent 的同批提案允许子功能排在父功能前，接收器会先核对全批层级，再按父先子后落入编辑历史。同级显示顺序沿用输入顺序，不表示重要性。

旧 schema 1/2 的渲染和查询不升级数据。第一次通过 `feature` 编辑写入 `summary` 或 `parentId` 时，返回的草稿才升级为 schema 3，并给原有映射补上其**原来的** basis；部分迁移的旧 basis 不会被换成当前快照。完整说明、原历史和已有其他功能的决定保持原样。清空可选字段时省略该属性；不要写空字符串或 `null`。已经升级的文档不会自动降级。

`summary` 由标注作者填写，不能为了短而去掉影响适用性的条件。完整 `description` 继续保存触发、行为、限制与排除项。未填写短说明的旧功能可以预览原说明并打开全文；展示截断不会改写标注。

## 编辑与版本

`createFeatureMapApi()` 是 CLI 和浏览器共用的纯工厂，提供 create、validate、assess、forNode、edit，以及 `hierarchy(features)`。层级索引提供 `children(parentId = null)`、`path(id)`（根到自身）、`descendants(id)`（不含自身），采用迭代遍历。edit 需要 expectedRevision、actor、actorKind、at、reason，返回新对象，不修改输入。允许创建/修改功能、显式新增/替换代码关联、接受/拒绝/退回待审。

修改映射目标、理由或角色后决策重置为 proposed。修改功能含义会将关联的 accepted 映射全部退回 proposed（rejected 保留），避免把旧接受挪用给新含义。每次修改 revision+1，并保存操作、主体和前后值；历史仅是本地可读记录。agent 不能通过 edit 自行 accepted；人工与 agent 标签均为自述而非安全权限边界。

拒绝不会删除记录，但会从当前代码反向映射排除。过期映射保留旧理由、锚点、审阅状态和失效原因，禁止接受或打开当前同名源码；也不允许在过期 basis 内偷偷加入新锚点。可以保留旧图并使用显式迁移向导，逐条复用、替换或暂缓；暂缓的 schema 2/3 映射继续保留旧 basis 并失效。详见 [跨快照迁移](feature-migration.md)。

文档最多 1000 个功能、10000 个映射/编辑记录、每映射 100 条关系证据，验证序列化长度限 5 MiB 字符；浏览器导入另外限制 5 MiB 文件。画布分批显示当前层级功能，完整功能可搜索定位；映射按 25 条展开。所有预算是产品边界，不是业务覆盖率，也不是层级深度限制。

## 浏览器

“功能映射”页和现有项目/文件/函数页并存。选择功能 → 选择映射 → 查看原关系或源码；源码检查器提供当前显式功能的反向入口。支持新建/修改功能说明与问题、从代码添加关联、接受/拒绝映射、JSON 导入/导出。

编辑必须填写自述编辑者及理由。**页面修改只在内存中**；导出请求不等于文件已保存，更不会写回原 HTML/Git。需要保留导出的 JSON，下次重新导入或用 CLI 重新渲染。导入替换未导出草稿需要确认；错误导入保留原草稿。页面内添加代码关联初始只附声明证据；关联检查器的修正表单可以显式更换准确实体 ID、角色、理由及关系 ID，复用与 CLI 相同的 mapping 操作。

## CLI

从已经生成的同一个 graph.json 开始，可避免重复扫描后误混快照：

```sh
node dist/cli.js features init reports/codex-monitor/graph.json --out features.json
node dist/cli.js features check reports/codex-monitor/graph.json features.json
node dist/cli.js features render reports/codex-monitor/graph.json features.json --out feature-report.html
```

check 对失效映射返回退出码 2，对格式错误返回 1；render 允许显示失效标注但禁止错误导航。features 写命令仅写用户指定的**新文件**，以 wx 拒绝覆盖已有文件（含软/硬链接）；请将标注和报告放在目标源码目录外。它们不需要也不会访问原项目工作区。

创建或改名功能的 edit.json：

```json
{"reason":"定义需要审阅的功能范围","operation":{"op":"feature","feature":{"id":"collection","title":"会话采集","description":"有限范围的初始提案","questions":["远程链路尚未标注"]}}}
```

```sh
node dist/cli.js features edit graph.json features.json --patch edit.json --expected-revision 0 --author reviewer --actor-kind manual --out features-r1.json
```

显式关联使用同一命令，operation 改为：

```json
{"op":"mapping","id":"collection-entry","featureId":"collection","nodeId":"从 graph.json 搜索结果复制准确 ID","role":"entry","rationale":"说明为何该实体支撑此功能","relationIds":[]}
```

评审 operation 为 `{"op":"review","id":"collection-entry","decision":"accepted"}`。更换当前关系目标时复用 mapping ID 并提供新 nodeId/role/rationale/relationIds，保留修改前记录。expectedRevision 必须匹配当前标注文档，不可拿图的 schemaVersion 代替。

普通 analyze 也可提供 `--features features.json`；与新扫描结果不匹配时不会自动迁移标注。没有提供 sidecar 的报告功能页为空，绝不复用上一次浏览器编辑。

## 验收

固定样本只做 3 个 agent 提案、6 条映射、4 个不同代码实体；2 个实体分别被两个功能共享。`sourceResult → scan` 的候选来源用于检验“不确定性向上传递”，不是为演示新增绑定。另一报告将 snapshot 改为不匹配值，只作为失效测试，不替换原图。

单元正反例与浏览器测试校验多对多、无映射、拒绝/过期排除、规则/编译器/源码/实体/关系失效、编辑版本冲突、含义修改退回待审、导入失败保护、导出重导入、脚本注入防护。既有静态提取及目录投影继续运行完整回归和同输入对照。

层级测试覆盖 1000 层可达、任意位置的环、父 ID 缺失、迁移后旧 basis 保留、Agent 乱序父子批次及独立证据要求。层级通过验证仍不证明功能划分正确；现有平面标注不会自动生成更细的功能。

