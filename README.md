# 线下多游戏主持台

面向线下聚会的多游戏流程辅助系统。狼人杀是当前正式开放游戏；标准三人斗地主已开放“测试版”创建入口，用于三台真机完整对局和恢复验证。

## 当前技术栈

- Node.js + TypeScript
- Express
- Socket.IO
- Node.js 内置 SQLite
- 静态 Web 玩家端

## 本地运行

```powershell
npm.cmd install
npm.cmd run dev
```

需要 Node.js 22.5 或更高版本。

打开 `http://localhost:3000`。健康检查地址为 `http://localhost:3000/health`。

如果另一个项目占用了 `3000` 端口，可以改用 `3001`：

```powershell
$env:PORT=3001
npm.cmd run dev
```

## 多玩家模拟器

模拟器会创建一个房主和若干机器人玩家，逐个验证定向提醒、玩家确认、选择提交以及私密事件没有发送给错误玩家。它验证的是服务器和实时通信流程，不会产生真实的手机震动。

先启动游戏服务器：

```powershell
$env:PORT=3001
npm.cmd run dev
```

保持该窗口运行，再打开第二个 PowerShell 窗口，在项目目录执行默认的 8 人模拟：

```powershell
npm.cmd run simulate
```

指定总人数或服务器地址：

```powershell
npm.cmd run simulate -- --players 12 --url http://127.0.0.1:3001
```

`--players` 包含房主，支持 2 到 20 人。运行成功时，每名机器人都应显示“收到 -> 确认 -> 提交”，最后输出私密提醒检查通过。

需要同时抽查真实手机时，先用手机正常加入房间，再运行模拟器会创建另一间独立测试房。当前版本暂不支持让机器人加入手机所在的已有房间。

## 对局实验室

开发环境提供可视化实验室。启动服务器后访问：

```text
http://localhost:3001/dev/lab
```

实验室支持：

- 输入真实房主创建的 6 位房间号。
- 每次添加一名独立 Socket.IO 虚拟玩家。
- 自定义虚拟玩家名称，并查看服务器分配的座位号。
- 查看已添加数量、在线数量和加入日志。

实验室不创建房间、不模拟房主，也不提供提醒操作、自动测试、主动断线或断线恢复。正式游戏行为会在狼人杀流程实现后再按实际规则扩展。

## 服务端断线恢复

房主创建房间或玩家加入房间成功后，acknowledgment 会额外返回 `resumeToken`。玩家页面会把 `roomId`、`playerId` 和 `resumeToken` 保存在浏览器本地；页面刷新或 Socket.IO 重新连接时自动调用：

```text
player:resume { roomId, playerId, resumeToken }
```

恢复成功时保留原座位、权限和私人游戏状态，不会创建重复玩家。同一身份仍有旧连接时，新连接会替换旧连接。

正式启动入口默认把房间快照和脱敏事件日志保存在 `data/gamehost.sqlite`。服务器重启后，玩家可继续使用原来的 `resumeToken` 恢复；恢复前所有已保存玩家统一视为离线。可以通过环境变量覆盖数据库位置：

```powershell
$env:ROOM_DB_PATH='D:\gamehost-data\gamehost.sqlite'
npm.cmd start
```

启动时会清理超过 7 天没有更新的房间；每个房间最多保留最近 1000 条事件。

当 `NODE_ENV=production` 时，`/dev/lab` 和实验室静态资源不会开放。

## 质量检查

```powershell
npm.cmd run typecheck
npm.cmd test
```

## 当前产品边界

- 仅用于玩家同处一室的线下面杀，不提供线上语音、聊天或远程对局。
- 当前阶段仅支持 Android，行动提醒完全依赖手机震动。
- 夜间要求玩家手持手机、页面保持前台，并在收到震动后尽快完成操作。
- iPhone、微信小程序、蓝牙耳机及后台提醒暂不在当前实施范围内。

详细设计见 [系统设计与实施文档](./无法官狼人杀助手_系统设计与实施文档.md)。
