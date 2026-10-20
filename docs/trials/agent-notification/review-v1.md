# 首轮作者自评（非独立模型评分）

Skill v1.0 冻结在 2bc979ce893cad2c30104aabc7040b3792774645。实际查询00-18已执行，原始输出保存在试跑包 queries/、commands.jsonl；本目录的proposal-v1.json只压缩了空白，内容与原始提案JSON等价。输入来自CP18 Verify #22固定Codex-Monitor图，snapshot 18dbe44a94c58882d91a6cfb13b550f7a96ad37b7453e3d5336952e40f05776b，sidecar revision9/baseDigest e255fe3f832e7cf5e650987afadd376a8862cf4cd44cc0d6c76851b0654fe35a。初稿2功能、5映射、4引文检查通过CLI check，但不等于语义满意。

- 有用性：基本通过。先解释桌面提醒与前台抑制而不是目录名称。
- 功能边界：需要修订。描述中的“点击”未区分动作按钮和正文；遗漏重复处理条件，读者须钻到第三条映射才看清。
- 证据：需要修订。首功能的两条quote都在显示函数，点击/动作的主要结果虽然读过源码却未在检查记录中覆盖。需要按主要承诺审阅，而不是满足最低每功能一正一反。
- 不确定性：需要修订。前台检测的来源第一页都是sources，尚未翻到stops。complete=false不能代替实际核查停止原因。
- 业务限制：前台检测异常放行应进入主描述；不能把包围注册的try/catch说成捕获所有后续异步错误。
- 成本：宽搜索混入tests/匿名函数；之后先限定生产目录，测试作为单独核验入口。

## 可恢复定位

显示函数 node:9858e7c407e3914c9797；点击 node:bfb0e7a4467dc6930035；动作 node:374a41c0488a69895235；分发 node:021d9a84c4fe2011462b；前台规则 node:6ca9280fabc03c880cf1。候选边 focus 为 edge:4c4d36ebb808e92b7114，isSessionForeground 为 edge:0bb95068ab0b594d2de1，acknowledge 为 edge:c0d7ad759792b2c8e88b。

下一步：Skill1.1增加claim table、不同动作对照、适用条件前置、关键candidate停止页核查；补读focus/gate分页，准确缩小业务承诺，再check/submit。不可把重复执行固定提案的CI叫独立模型测试。
