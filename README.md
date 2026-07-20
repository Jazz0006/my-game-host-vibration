# 无法官狼人杀助手

面向线下面杀的流程辅助系统。当前验证阶段只支持 Android 手机浏览器，玩家在夜间手持手机并保持页面在前台，通过私密震动接收行动提醒。

## 当前技术栈

- Node.js + TypeScript
- Express
- Socket.IO
- 静态 Web 玩家端

## 本地运行

```powershell
npm.cmd install
npm.cmd run dev
```

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

恢复成功时保留原座位和权限，不会创建重复玩家。同一身份仍有旧连接时，新连接会替换旧连接。当前房间和恢复凭据仅保存在服务器内存中，服务器进程重启后不会恢复。

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
