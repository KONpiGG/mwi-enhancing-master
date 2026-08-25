# MWI Enhancing Master

Milky Way Idle 市场采集与强化分析工具。当前版本先实现合规的**官方小时级市场采集 MVP**；它是后续历史数据库、强化计算、机会扫描、提醒和网页控制台的数据基础。

## 当前能力

- 请求官方 `marketplace.json`，校验时间戳与紧凑字段 `a`（最低卖价）、`b`（最高买价）、`p`（小时成交均价）、`v`（小时成交量）。
- 将字段转换为含义明确的内部结构，缺失报价使用 `null`，不会误当作零价。
- 按官方时间戳去重，以 gzip 保存原始语义快照，并通过临时文件重命名避免半写入文件。
- 查询最近快照中指定物品和强化等级。
- 测试完全使用固定样例，不请求游戏服务器。

本项目只读取官方公开快照，不会循环请求游戏订单簿。每条后续分析结果都必须携带数据时间戳；官方快照不能被描述为秒级实时行情。

## 环境与命令

需要 Node.js 20 或更高版本。

```bash
npm install
npm run verify
npm run collect
npm run query -- /items/healing_book 1
```

运行数据默认写入 `data/`（已被 Git 忽略）。可用 `MWI_DATA_DIR=/path/to/data` 修改位置。采集成功会明确输出 `stored`；相同官方时间戳再次采集则输出 `duplicate`。

## 数据布局

```text
data/
├── manifest.json
└── snapshots/
    └── 2026-08-25T12-00-00.000Z.json.gz
```

快照内每条报价包含 `itemHrid`、`enhancementLevel`、`ask`、`bid`、`hourlyAverage` 和 `hourlyVolume`。当前磁盘存储是阶段 0 的可审计输入，不代替路线图阶段 1 的 SQLite 历史查询层。

## 下一步

按 [ROADMAP.md](./ROADMAP.md) 推进 SQLite 历史数据层，然后才接入带版本号的强化数据和可解释计算。网页和通知不是当前 MVP 的边界。
