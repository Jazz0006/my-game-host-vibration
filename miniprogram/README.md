# 微信小程序共享 shell 与双产品构建

> MG0D 状态：game-specific product shells。  
> 共享源码目录：`miniprogram/`。  
> 生成产品：`骏骏桌游-狼人` / `骏骏桌游-血染`。

`miniprogram/` 现在只是**唯一 shared shell source**，不再直接作为微信开发者工具项目导入，也不拥有固定 gameType。两个产品都复用同一份：

- `src/client/*` ClientSession / transport / reconnect / credential storage；
- `miniprogram/pages/*` 入口页、Lobby、Settings、Diagnostics；
- Cloudflare Worker + Durable Object room authority；
- identity recovery / room management / authoritative projection。

产品差异只由 `scripts/wechat-products.mjs` descriptor 注入：

| 产品 | gameType | 主持标签 | 当前开始游戏行为 |
| --- | --- | --- | --- |
| 骏骏桌游-狼人 | `werewolf` | 法官 | `werewolf.startGame` |
| 骏骏桌游-血染 | `botc` | 说书人 | BotC Setup 在 B0 接入，不发送狼人命令 |

Lobby 不再有 `selectedGame`、游戏单选或房间内 gameType 切换。

## 构建两个产品

在仓库根目录执行：

```bash
npm run build:wechat
```

构建会：

1. 从唯一的 `miniprogram/` shared source 复制两个生成型产品 shell；
2. 为每个产品写入固定 `product-config.js`；
3. 为两个产品分别生成 CommonJS client runtime bundle；
4. 生成各自的 `project.config.json`；
5. 自动验证两个工程都具备完整 shell 和 shared runtime。

生成目录属于构建产物，不提交 Git：

```text
wechat-build/
  werewolf/
    project.config.json
    miniprogram/
      product-config.js
      runtime/
      ...
  botc/
    project.config.json
    miniprogram/
      product-config.js
      runtime/
      ...
```

## 微信开发者工具导入

不要再导入仓库根目录。

狼人产品导入：

```text
wechat-build/werewolf
```

血染产品导入：

```text
wechat-build/botc
```

默认 AppID 仍为 `touristappid`，只用于本地开发。预览/真机前必须换成各自注册的小程序**真实 AppID**。

构建时也可以通过环境变量注入：

```text
WECHAT_WEREWOLF_APPID
WECHAT_BOTC_APPID
```

两个产品必须分别在微信小程序后台配置 production Worker 对应的：

- **request 合法域名**
- **socket 合法域名**

当前 Worker：

```text
https://my-game-host-vibration.jazz-zeng.workers.dev
```

WebSocket transport 会转换到对应的 `wss://` 地址。

## 产品入口与 Lobby

两个产品的入口页结构相同，但标题和 gameType 固定来自 product descriptor。

产品 create/join：

```text
product descriptor
  -> fixed gameType
  -> HTTP room bootstrap
  -> roomId / playerId / resumeToken
  -> shared WeChatSessionCredentialStore
  -> shared ClientSession
  -> shared Raw WebSocket / reconnect / sync
```

加入另一个产品类型的房间会收到明确 gameType mismatch，不会切换房间类型。

Lobby 中：

- 中央固定显示当前产品游戏名称；
- 狼人显示“法官”，BotC 显示“说书人”；
- `Automatic | Human(playerId)` moderator assignment 来自 authoritative room projection；
- Human Moderator 从外围 playerOrder 中移除，但仍是房间成员；
- Room Owner 与 Game Moderator 是独立权限；
- Human Moderator 获得游戏控制入口，Owner 保留房间管理/recovery；
- 不再显示跨游戏选择控件。

BotC shell 已可以 create/join/resume、显示 authoritative lobby、room management 与 moderator assignment，但 BotC gameplay/Setup 将在下一阶段 B0 接入。

## Diagnostics 与真机验证

Diagnostics 继续作为 shared runtime 的薄验证壳，可用于隔离检查：

- ticket exchange；
- reconnect / foreground/background；
- authoritative room/private state；
- semantic command；
- vibration / audio capability。

E3.7B 已完成真实设备证据：

- production create/join；
- 双端 authoritative push；
- foreground/background 恢复；
- 飞行模式断网恢复；
- stored-session 恢复；
- heavy vibration capability。

fake-`wx` tests 继续覆盖 stale-generation fencing、same-commandId retry 与 semantic effect wiring；它们不替代真实设备证据。

## 验收命令

```bash
npm run typecheck
npm test
```

`npm test` 的 pretest 会同时构建并验证两个微信产品 shell。
