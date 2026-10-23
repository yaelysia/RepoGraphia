# CP47 — M4.1 同数据树原型与布局复用确定

2026-10-23，分支 `feat/functional-tree-reading`。用户已授权开始 M4，优先完善功能树构造与阅读。

## 基线与范围

- M4 计划 PR #16 的 Verify run `39931415080` 已成功，随后合并到 master `0b43f1a945fc6a72a00d675df04acf7ca73ad78b`。
- 本切片保存纯布局模块、固定上游对照、手写冻结夹具和选型证据。正式 viewer、Skill 和提案分组的集成另在后续检查点记录。
- Archify 固定于 `25cf37080fc8b1dbe758a4efc3935b55f3327083`；实际提取其右向布局公式，原文件和完整 MIT 许可保留。没有安装 Archify 应用或引入运行时远程依赖。

## 已完成

`createFeatureTreeApi().layout()` 接受原 ID、显式父子关系及 DOM 测量宽高，返回右向列布局与包含线。支持多根、任意实际层级和迭代遍历。父节点超出分配跨度的上游边界有实际复现和修正；普通样例直接与固定原代码逐坐标比较。

新增 `tests/helpers/feature-tree-reading.mjs`：39 个功能、47 条映射、13 层链、20 个同级节点与不平衡旁支。它是明确手写的 UI 夹具，不是用户上传的试跑内容，不是动态执行轨迹。输入 JSON 可以交给旧、新 renderer，保证内容、依据、决定及历史相同。

实际中文 DOM 测量比较表明：全部收起时，全树预留空间后的可见高度为 1600.375 px，同列最大空白 1278.375 px；当前可见投影分别为 350 px 和 28 px。只展开 window 时两者的可见高度为 2737.5 px 与 728 px。选择只布局当前可见且包含祖先的投影，由相机锚点和有限位移动效补偿重排。完整测量来源、哈希、三组比较及适配边界见 [复用记录](../archify-tree-reuse.md)。

## 验证

Linux / Node 24.19.0 / 锁定 TypeScript 5.9.3：

- 纯布局直接检查 **10 / 10**：固定来源与许可、上游几何逐值比较、多根和原 ID、父卡重叠修正、长尺寸、宽深树、小数尺寸、输入不变、独立 realm、非法结构。
- 实际 Chromium 原型操作验证了递归展开、选择与聚焦分离；集成过程中发现的同范围历史覆盖和初始工具栏裁切已经修复，并纳入正式浏览器回归。完整 viewer 验收数与最终提交见下一检查点。
- 原 renderer 与 LICENSE 的 Git blob / SHA-256 固定；`.gitattributes` 对这两份参考保持 LF，嵌入注释比较单独兼容 LF / CRLF。
- `git diff --check` 通过。

本阶段没有运行外部 Agent 或用户项目，没有声称真实用户阅读效果或新 Skill 内容质量已经通过。Windows、完整工作台和 M4.3 属于集成门禁，不能由纯布局检查替代。

## 接手

本切片提交以该分支和后续 PR 的实际 HEAD 核对。继续集成时保留当前 viewer 工作，不重新设计布局，不把历史 CP46 的“尚未实现”当作当前状态。

```sh
git fetch origin
git log -3 --oneline origin/feat/functional-tree-reading
npm run build
node --test tests/feature-tree.test.mjs
node tests/helpers/feature-tree-reading.mjs reports/m4-reading
```

生成目录必须尚不存在。正式阅读和工作区回归通过后，保存 CP48 与实现提交；跨平台 CI 另核对精确 HEAD。
