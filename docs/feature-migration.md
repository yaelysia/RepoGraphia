# 显式跨快照迁移（CP17）

迁移输入是旧 CodeGraph、新 CodeGraph、已有 FeatureMap。它不是增量静态分析，不证明业务语义不变，也不按同名函数或源码相似度找新目标。旧图必须匹配标注的基线；不能用新图代替遗失的旧图。

## 计划与动作

`createFeatureMigrationApi(createFeatureMapApi())` 提供共享的纯 `plan` / `apply`。浏览器和 CLI 执行同一实现。计划分成：

- `reusable`：精确代码/关系锚点、源码哈希和已记录静态邻域一致，分析规则、编译器、配置路径及项目显示名一致。邻域包括嵌套实体、入/出边、端点文件哈希和完整值来源记录。仅表示可以复用引用，不是功能语义正确性证明。
- `needs-review`：文件、规则/编译器/配置或邻域变化，或旧引用自身已经失效。不得使用 carry。
- `unmatched`：缺少原文件、实体或关系锚点。不是证明代码被删除；偏移改变也可能使原 ID 消失。本版不自动重定位。

三个动作是 carry（仅 reusable）、replace（用户明确指定当前实体、关系、角色、理由）、defer（默认）。应用时重新计算计划，不信任上传的分类结果；检查 sourceRevision、from/to 完整基线和 expectedRevision。未知/重复动作、无效目标及无关关系证据导致整个操作失败，不产生部分修改。

所有迁入的 accepted 退回 proposed，即使源文件没变；rejected 保留。确认迁移只是确认引用的重新定位，不等于重新接受功能语义。缺省/暂缓映射保留原锚点和原始基线，继续显示失效，禁止错误源码跳转。后续可以显式修正或再迁移；再次迁移不能把更早的失效依据洗成当前证据。

## 文档版本

普通 create/init 仍生成 schema 1，兼容 CP15。schema 1/2 发生迁移后输出 **FeatureMap schema 2**；已有显式层级的 **schema 3 保持为 3**。每条 mapping 必须有自己的 `basis`，另保留文档的目标 basis。assess 同时核对文档基线和每条映射基线；不能只因某些映射已迁移就认为全部有效。

schema 2/3 的迁移历史记录包含旧/新 basis、映射和明确动作；旧历史保留，不递归复制历史本身。schema 3 的功能短说明、完整说明和父子关系原样保留，不随源码引用迁移自动拆分或合并。作者仍是自述身份，不提供认证或防篡改保证。旧阅读器会拒绝不支持的新版本，需要匹配的工具。仅查询或渲染旧 schema 1/2 不升级文档；显式写入 `summary`/`parentId` 的功能编辑才启用 schema 3。CodeGraph schema 1、分析规则 4、目录投影版本 1 均不变。

仍采用快照有效性规则，不自动实行文件级失效；细粒度比较仅用于生成显式迁移计划。默认数量/5 MiB 标注文档限制继续适用，完整历史导致超限时原子拒绝，不能丢弃旧证据来塞入预算。浏览器旧图导入上限 96 MiB；这不是操作系统级资源沙箱。

## CLI

```sh
node dist/cli.js features plan old-graph.json new-graph.json features.json --out migration-plan.json
node dist/cli.js features migrate old-graph.json new-graph.json features.json --patch migration-request.json --expected-revision 9 --author reviewer --actor-kind manual --out features-migrated.json
node dist/cli.js features check new-graph.json features-migrated.json
node dist/cli.js features render new-graph.json features-migrated.json --out migrated-report.html
```

请求必须包含 `sourceRevision`、`from`、`to`（从刚生成的计划复制）以及 `reason` 和 `actions`，例如 actions 为 `[{"id":"mapping-id","action":"carry"}]`。遗漏映射默认 defer。replace 项需提供 `id/action/nodeId/relationIds/role/rationale`；准确 ID 从新图查询结果手动选择，不能输入函数名冒充 ID。不得把整个计划原样当作请求。版本数字请用实际文档 revision，不照搬上面的 9。

plan/migrate 与其他 features 写命令一样只创建新文件，拒绝覆盖已有文件/链接。保留旧图和原 sidecar；有暂缓映射时 check 仍返回 2，不是整个迁移失败。相同 basis 不需要迁移；旧图不匹配则拒绝操作。

## 浏览器

在包含旧标注的新图报告中打开“功能映射 → 跨快照迁移”，导入对应的旧 graph.json。默认全部暂缓，每页25条。逐条选择复用、暂缓或手动替换（支持搜索当前实体后明确选中）。填写编辑者和理由，预览预计迁入/暂缓数量，再点击“确认迁移到内存草稿”。标注期间有变动会拒绝过期预览。

页面不会自动写入文件/Git，须导出 JSON 保存。原输入文件不修改。关联检查器也新增理由/角色/关系证据修正表单，复用原 edit API；修改后退回待审。

## 验证样例的区别

固定 Codex-Monitor 对照复用同份源代码与类型依赖，因分析器安装路径不同产生不同 snapshot，用于验证安装环境变化下的6条引用迁移；不把它宣称为实际业务代码变更。

另外的 `migration-fixture.html` 是实际写入、修改、删除了源码的独立小型夹具：1条可复用、2条需审阅（含依赖内容变化）、1条无匹配。它不是 Codex-Monitor 的新版本。浏览器测试导出的带 manual 标签文件是自动化测试草稿，不是用户接受；试用包应排除所有 *-test.json/负例页面。
