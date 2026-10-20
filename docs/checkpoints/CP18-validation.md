# CP18 — 显式功能标注迁移验证

## 精确对象

- 仓库：yaelysia/RepoGraphia，PR #5，分支 feat/feature-migration-r1。
- 基线：CP15 `206dd363dcc023a8ab88590878cdabb62b44fcd8`，当前 PR 暂以尚未合并的 #4 分支为目标。
- CP16：`b95fbecd956cf1938d8ca66299e0ad975a3b803f`。
- 完整实现：`720f879de257dcace22420e2a68654c9ad347fc8`。
- Git tree：`96bf6256659890bea3d982958db72883d7958821`。
- Verify #22：`39383214561`，已核验 completed/success。
- CI 实际测试 PR 合并提交：`e65adf7d2a52854e6ad2a39bf8f0b233aa05aee5`。

本 CP18 是随后添加的文档/帮助文字收尾；不将后续 HEAD 冒充前述测试提交。最终 HEAD 的新运行另记在 PR #5。

## 真实执行结果

| job | ID | 结果 |
| --- | --- | --- |
| unit (ubuntu-latest) | 118496871877 | 标准 npm test 232 pass / 0 fail / 0 skip |
| unit (windows-latest) | 118496871850 | 标准 npm test 229 pass / 0 fail / 3 既有符号链接权限 skip |
| sample | 118496871472 | 固定样本/迁移夹具/4 套浏览器检查及上传均成功 |

Node 22.23.3、锁定 TypeScript 5.9.3，npm ci --ignore-scripts。新增 34 项迁移正反例。各 viewer JavaScript 语法检查通过。

实际 file:// 浏览器：原源码/来源 30 项、目录地图 24 项、功能标注 32 项、新迁移 25 项，均无异常和外部请求。新检查覆盖旧图错误输入保护、1/2/1 分类、默认暂缓、角色/理由、明确替换、预览不改动、确认部分迁移、schema 2 导出/重导入、旧 basis 保留、失效禁止接受/跳转、代码图不变和窄屏。

## 两种不同样例

### 固定真实 Codex-Monitor，源代码未变

样本提交 `490d822a9593d8d4b78a9188dd0daa0ae791eaf6`。新旧分析器读取同一源码及类型依赖，files/nodes/relations/coverage/diagnostics 完全一致。131 文件、2630 非文件实体、12978 显式调用点、363 未解析、0 编译诊断保持不变，没有为了迁移重写关系。

旧 snapshot：`c8697f6dddde634827e435ac80b0a680223605e28c7a951f85645bac484780b4`。
新 snapshot：`18dbe44a94c58882d91a6cfb13b550f7a96ad37b7453e3d5336952e40f05776b`。

不同分析器安装路径导致 snapshot 不同；计划为 6 reusable / 0 needs-review / 0 unmatched。原始提案仍全 agent/proposed，没有生成用户接受。此案例不是实际业务改动或功能正确性评测。未修改 Codex-Monitor，也未运行其应用或业务测试。

### 独立小型源码，实际修改和删除

创建四个 TypeScript 文件并分析；将 changed.ts 的返回值 1 改为 2，删除 removed.ts，再重新分析。源码只供解析，不执行。预期独立给定：keep 可复用；change 需审阅；caller 自身未改但调用目标源码改变，需审阅；removed 原锚点不存在。

结果 1 reusable / 2 needs-review / 1 unmatched。该夹具不是 Codex-Monitor 的新版本。浏览器针对夹具确认部分迁移，验证未选择的记录继续失效和保留旧依据。人工身份标签均为自动化测试的自述，不能当成用户确认。

## 产物与复核

| 产物 | ID | ZIP SHA-256 |
| --- | --- | --- |
| checkpoint-source | 12246586650 | ba658608b424cd43aacb6e0790ea158d44e0813dc35c24090ac7f6b226fa7c95 |
| codex-monitor-report | 12246596867 | 7d5ae9a615ece0a338ec2ef41b9497c4917bfd0b58d53f478bdad3fd6d137758 |

下载 ZIP 后哈希均匹配；解包源码重建 Git tree 与远端实现 tree 一致。所有 CP17 应用和测试文件与本地逐字节一致，只有尚待最终提交的 README、架构、功能映射说明及 CLI 帮助文字不同。没有用本地辅助类型编译结果替换 CI 产物。

复核了所有 131 个内嵌源码哈希、实际新旧图的全部数据部分、features/migration/migration-fixture 三个 HTML 内嵌 JSON 与独立 JSON 的一致性，及三份原始提案全部 proposed。已打开实际 CI 迁移截图。

试用包保留 actual features.html、migration.html、独立 migration-fixture.html、对应新旧图和原始标注/计划以及说明；排除 *-test.json、负例和兼容 HTML，避免把自动浏览器的人工决策草稿交付为真实标注。

## 边界

可复用只表示精确静态引用及已记录邻域连续性。没有语义等价、运行完整性、输入图真实性或自述作者认证保证。没有同名/模糊重锚；偏移变化可导致 unmatched。迁入 accepted 必须重新审阅，rejected 保留；defer 保持自己的旧 basis，即使节点 ID 恰好未变化。历史及数量预算超限原子拒绝，不通过丢证据压缩。

本地 TS5.8.3 辅助结果为逐文件232通过、迁移25/原功能32浏览器通过，整套并行 npm test 在容器超时；最终跨平台结论来自 CI 标准命令。所有代码保存在远端，临时源码产物30天过期不影响从 Git 检查点接手。
