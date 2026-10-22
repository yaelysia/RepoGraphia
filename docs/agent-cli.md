# Agent CLI + 功能归纳 Skill

这一层面向可执行本地命令的 Agent，不启动 MCP 服务，不调用模型 API，也不执行目标项目。实现复用 CodeGraph、目录投影、FeatureMap 校验和离线报告。模型负责语义提案，程序只核验引用与原始引文。

## 接入

需要 Node 22+、已构建的 RepoGraphia，以及一个带完整源码的 graph.json。先使用既有 analyze 在目标外部的新目录生成快照；已有报告可直接用，不应每查询一次重新分析。带源码报告与提案含私有代码，保存/分享按源码处理。

Skill 位于 `skills/repographia-function-map/`。可复制整个目录到所用 Agent 支持的 Skill 目录；也可以在任务中明确要求读取这个 SKILL.md 并遵循，不依赖自动触发。复制后不能只拷主文件而漏掉 references。这里没有自动修改用户全局配置，也没有验证各宿主的自动触发率。

给 Agent 的任务示例：

> 读取 /path/to/RepoGraphia/skills/repographia-function-map/SKILL.md。工具入口为 /path/to/RepoGraphia/dist/cli.js，分析图为 /path/to/reports/graph.json，现有标注为 /path/to/features.json。先分析我指定的功能区域，输出可审阅提案，不覆盖原标注。探索输出保存到一个新目录；保留查询记录、自评与接手检查点。

先 `node dist/cli.js agent --help`。CLI 支持 overview/search/inspect/relation/check/submit。每次操作都使用同一份图和同一 --features，具体格式见 Skill 的 references/protocol.md。Skill 1.2 在既有作者自用工作流上增加显式父子功能与短说明，不代表新增独立模型评测。

## 能力与约束

- 结构化输出：成功JSON在stdout，错误JSON在stderr并退出1；错误含code/message/hint。可读命令可以 --out NEW-FILE，保存原始输出。未提供sidecar时创建独立空标注基线。
- 有界探索：列表分页1..50；源码按UTF-16分页1..16000字符；单次输出最多96KiB，超限报错而非静默丢证据。原始图最多128MiB，提案/sidecar最多5MiB。源码、关系与成员列表有独立游标，不能混淆。预算是当前产品限制，不是覆盖率。
- 无推测引用：精确实体/关系ID，源码哈希核验，缺完整源码不允许提案。程序自动生成锚点，不让模型手写哈希或偏移。原始引用和引文匹配仍不能证明模型理解正确或真正读过代码。
- 提案通道只能追加：不能review、替换功能或现有关联；重复ID、同一父功能内重复标题、同功能同代码对均拒绝（包含已拒绝映射）。不能通过更换映射ID/角色覆盖原决定，但不声称能够识别一切改名或重新分组后的语义重复。
- 提案固定基线：snapshot/规则/编译器/config、expectedRevision、完整原标注文档摘要都必须匹配。不能只改snapshot继续套用旧结论。部分迁移schema2/3中原有暂缓映射仍保留旧basis及失效。
- 显式层级：proposal协议仍为1，feature可选填`parentId`和最多200字符的`summary`；存在任一字段时派生FeatureMap升级为3。父功能可来自已有标注或本批次，批次顺序不限；缺父、自指和环均拒绝。父子关系仅表示包含，不推断依赖/执行顺序。每个新父功能和子功能都需要自己的映射和support/limit检查，不能借用父级或子级的证据通过提交。
- 每个功能至少一条support和一条limit引文；Skill进一步要求覆盖每个主要行为承诺，最低结构要求不等于质量标准。身份由工具写为agent/proposed，人工标签不是OS安全隔离。
- 新输出目录含 proposal.json、features.json、assessment.json、index.html 和最后写入的 receipt.json。校验/渲染全部成功后才创建目录；无效批次不产生部分输出。I/O中断可能留下不完整目录，没有receipt就不能算成功；不覆盖它，选择新目录重试。

## 本轮实际自用

记录在 `docs/trials/agent-notification/`。输入为固定 Codex-Monitor 的既有CI图和3个初始采集提案。作者按照冻结Skill1.0实际调用CLI，提出非采集区域的2功能/5映射初稿；格式检查通过但自评发现点击动作区分、关键条件位置、主要承诺检查不足。Skill1.1补上claim table、动作对照、适用条件前置和关键candidate停止页核查。补读后形成2功能/7映射/13引文的修订稿，原3功能6映射未变。没有调用另外的模型、没有代替用户接受。

CI的scripts/verify-agent.mjs只对固定输入复播这份作者提案，检查源码文件哈希、精确ID与引文，再生成真实离线报告；它不是第二次模型试跑。源码/图保持不变。scripts/check-agent-report.py检查展示和证据跳转，不衡量语义召回率。

当前结果适合作为一个有限区域的初始审阅地图。仍需不同仓库和不同模型的盲测，不能用这一次自评宣布“弱模型也能可靠生成全项目功能图”。

## 格式依据

采用 Agent Skills 的 SKILL.md + references 渐进加载组织，不依赖实验性allowed-tools权限语法：
- https://agentskills.io/specification
- https://developers.openai.com/codex/skills

工具校验、Skill方法和模型能力是不同层。不要把Skill内容当成安全权限控制或程序测试通过的证明。
