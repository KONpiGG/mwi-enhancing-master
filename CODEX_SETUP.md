# Codex 接入说明

本项目已经准备好被 Codex CLI、IDE 扩展或 Codex 云端读取。仓库根目录的
`AGENTS.md` 会告诉 Codex 如何安装、测试和修改项目。

## 接入 Codex 云端

前提：`KONpiGG/mwi-enhancing-master` 已经创建并推送到 GitHub。

1. 在 Codex 中连接 GitHub，并授权访问该仓库。
2. 为 `KONpiGG/mwi-enhancing-master` 创建一个环境。
3. 选择 Node.js 20。
4. 设置初始化脚本：

   ```bash
   npm install
   ```

5. 可选的缓存维护脚本同样使用：

   ```bash
   npm install
   ```

6. 当前版本不需要环境变量或 Secret。
7. 普通开发和测试可以保持 Agent 网络访问关闭。只有需要调用真实市场采集器时，
   才为 Agent 开放 `www.milkywayidle.com`。

## 首次环境检查

创建环境后，可以先给 Codex 这个只读任务：

> 阅读根目录 AGENTS.md 和 ROADMAP.md，不修改代码。运行 npm run verify，并概括项目结构、当前
> MVP 边界以及建议的下一步。

如果验证成功，说明仓库、依赖安装和项目指令都已被正确读取。

## 本地 Codex

在仓库根目录启动 Codex。可以先检查项目指令是否加载：

```bash
codex --ask-for-approval never "概括当前项目指令和验证命令"
```

常用任务示例：

```text
先阅读 AGENTS.md 和 ROADMAP.md。为市场快照接入 SQLite，只实现存储层，
补充迁移与测试，不要开始强化利润计算。
```

```text
检查当前采集链路对官方字段缺失、超时、重复时间戳的处理，先报告风险，不修改代码。
```

## 网络与数据注意事项

- `npm run verify` 使用固定样例，不依赖实时网络。
- `npm run collect` 会请求官方市场接口并在 `data/snapshots/` 写入运行时快照。
- 真实快照、构建产物和本地环境文件均不应提交到 Git。
- 任何利润或练级结论都必须标注所使用的市场时间戳。
