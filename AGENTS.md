# Repository instructions

## Scope

当前工作已明确授权网页、真实玩家预设、Buff 推导、强化马尔可夫计算及赚钱/练级排行。仍不要接入 SQLite、通知、账号系统或部署设施。

## Development

- 使用 Node.js 20 或更高版本，并提交 `package-lock.json`。
- 官方市场结构为 `marketData[itemHrid][enhancementLevel] = quote`；测试应使用固定样例，不依赖网络。
- 不要提交 `data/` 中的真实市场快照。
- 修改后运行 `npm run verify`。
- 路线图位于仓库根目录的 `ROADMAP.md`。
