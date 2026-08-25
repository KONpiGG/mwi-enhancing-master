# MWI Enhancing Master

Milky Way Idle 市场采集与强化分析工具。当前版本提供一个可运行的强化机会排行榜，保留原有官方小时市场采集和命令行查询。

## 当前能力

- 请求官方 `marketplace.json`，遍历 `marketData[itemHrid][enhancementLevel]`，并校验时间戳与紧凑字段 `a`（最低卖价）、`b`（最高买价）、`p`（小时成交均价）、`v`（小时成交量）。
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
npm run dev
npm run collect
npm run query -- /items/healing_book 1
```

打开 <http://localhost:3000>，先点击“更新市场数据”，再设置玩家强化等级、排序和筛选条件。可用 `PORT=8080 npm run dev` 改端口。页面计算使用卖一买入、买一卖出；缺少任一必要报价的项目会被排除。点击表格行可查看逐层公式、成本和数据/公式版本。

运行数据默认写入 `data/`（已被 Git 忽略）。可用 `MWI_DATA_DIR=/path/to/data` 修改位置。采集成功会明确输出 `stored`；相同官方时间戳再次采集则输出 `duplicate`。

## 数据布局

```text
data/
├── manifest.json
└── snapshots/
    └── 2026-08-25T12-00-00.000Z.json.gz
```

快照内每条报价包含 `itemHrid`、`enhancementLevel`、`ask`、`bid`、`hourlyAverage` 和 `hourlyVolume`。当前磁盘存储是阶段 0 的可审计输入，不代替路线图阶段 1 的 SQLite 历史查询层。

## 当前限制

- v1 游戏目录是经过人工核对的最小子集，暂只覆盖治疗之书和翠绿斧的 +1 至 +5；来源和版本见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。扩充目录不需要修改计算公式。
- 结果是基于小时快照的期望值，不保证挂单数量足以按展示价格成交，也不包含市场手续费；成交量、价差和超过两小时的快照会显示风险。
- 当前不包含账号、通知、Docker、部署或历史数据库。
