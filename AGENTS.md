# Repository instructions

## Scope

阶段 0 只负责官方市场快照的采集、解析、文件存储与查询。除非任务明确要求，不要提前接入 SQLite、网页、通知或强化计算。

## Development

- 使用 Node.js 20 或更高版本，并提交 `package-lock.json`。
- 官方市场结构为 `marketData[itemHrid][enhancementLevel] = quote`；测试应使用固定样例，不依赖网络。
- 不要提交 `data/` 中的真实市场快照。
- 修改后运行 `npm run verify`。
- 路线图位于仓库根目录的 `ROADMAP.md`。
