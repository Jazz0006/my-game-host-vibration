# 微信小程序 UI shell + E3.7 真机验证

这个目录不是第二套客户端规则/runtime 实现。它目前仍是已完成 E3.7B 验收的现有狼人杀微信 shell；2026-09-29 已决定在 MG0 后演进为两个 game-specific 产品壳（`骏骏桌游-狼人` / `骏骏桌游-血染`），两者继续复用 `src/client/*` 的同一 shared runtime，而不是复制网络/恢复代码。当前目录在正式拆壳前同时承载两类开发用途：

- 产品 UI foundation：入口页、Lobby 方桌、房间管理等只负责 render / intention；
- E3.7 Diagnostics：把已经在 `src/client/*` 中完成的 E3.6 native composition 接到真实微信小程序运行时。

服务端 authoritative state、ClientSession、reconnect、secret calculation 和游戏规则仍由既有 owner 负责。

## 先构建

在仓库根目录执行：

```bash
npm run build:wechat
```

生成的 CommonJS runtime 位于 `miniprogram/runtime/`，属于构建产物，不提交 Git。

然后在微信开发者工具中导入**仓库根目录**。根目录的 `project.config.json` 已声明：

```text
miniprogramRoot = miniprogram/
```

默认 `appid` 是 `touristappid`，只用于降低本地导入门槛。进行预览/真机验证前，请在开发者工具中切换为你自己的**真实 AppID**。

## 真机网络前置条件

E3.7 的真实验证需要一个已部署且可通过公网 HTTPS/WSS 访问的 Cloudflare Worker。

至少确认：

- Worker 的 `/health` 可通过 HTTPS 访问；
- 小程序后台已配置对应的 **request 合法域名**；
- 小程序后台已配置对应的 **socket 合法域名**；
- 真机验证不要把“开发者工具里关闭域名校验”当作最终通过证据；
- 产品入口固定使用当前 production Worker：`https://my-game-host-vibration.jazz-zeng.workers.dev`；WebSocket 会由 transport 自动转换为 `wss://...`；
- product create/join 会通过 Worker HTTP bootstrap 获取 `roomId / playerId / resumeToken`，随后写入既有 `WeChatSessionCredentialStore` 并启动同一个 `ClientSession`；
- Diagnostics 仍允许手工输入一组真实 credentials，用于隔离验证 ticket / reconnect / lifecycle；
- 部署新的 Worker 代码后再做 create/join 真机验收；本地测试通过不等于 production Worker 已自动更新。

## UI foundation 预览

首页已经切换到产品入口骨架。开发阶段保留两个快捷入口：

- **预览方桌大厅**：使用明确标记的本地 preview data 检查方桌布局、主持位、Ready/震动概念和房间管理页面；其中现有跨游戏单选只是历史 UI prototype，不再代表目标产品行为，这些 preview 操作也不写入服务器。
- **E3.7 Diagnostics**：进入原来的真实 session / reconnect / semantic-command 验证壳。

E3.7B 已完成：真实 create/join/resume 与 authoritative public room projection 已接入产品入口，host `werewolf.startGame` 已接到既有 semantic command，并完成真实手机的双端同步、前后台恢复、飞行模式断网恢复、stored-session 恢复与 heavy vibration capability 验收。仍未接入的 Lobby authority 包括 Ready、reorder、moderator assignment、移交房主与踢人；这些操作继续只允许 preview 演示，不能在页面内伪造服务器状态。跨游戏选择不再列入待实现能力：未来由不同小程序产品壳在创建房间时固定 `gameType`。

## 开发者工具验证

1. 执行 `npm run build:wechat`。
2. 导入仓库根目录。
3. 确认产品首页、Lobby Preview 和 Settings 均能加载，控制台没有 module / require 错误。
4. 使用产品首页 **创建房间**，确认服务器返回 4 位 room code、客户端自动保存 credentials 并进入 Lobby。
5. 第二个客户端输入该 room code **加入房间**，确认两个客户端都收到新的 authoritative public room projection；页面不得手工拼接成员状态。
6. host 使用 **开始游戏** 验证 `werewolf.startGame` semantic command；普通玩家不应获得 host action。
7. 使用 **继续上次房间** 验证 storage -> ticket -> sync 恢复路径。
8. 需要隔离检查 ticket / private PlayerView / semantic command 时，再进入 **E3.7 Diagnostics**，手工输入 credentials。
9. Diagnostics 连接状态应经历 Connecting/Syncing 并最终进入 Connected，同时显示 public room projection 与 private PlayerView。
10. 需要验证具体夜间 action 时，在 Diagnostics 的 **Semantic command** 区输入稳定 command type 和 JSON payload；页面只转发 intention，不实现规则判断。

## 真机 foreground/background 验收

至少记录下面两条路径：

### A. socket 仍然存活

1. Connected 状态切到其他 App。
2. 返回小程序。
3. 预期：`WeChatSessionLifecycle` 触发 resync，不创建第二套本地 game state。
4. revision 只能保持或前进，不能倒退。

### B. socket 已失效

1. Connected 状态切后台。
2. 通过较长后台停留、网络切换或临时断网让 socket 失效。
3. 返回小程序。
4. 预期：Disconnected -> Reconnecting -> Syncing -> Connected。
5. 必须重新走 ticket exchange；长期 resumeToken 不应出现在 WebSocket URL。
6. 恢复后的 public room projection / private PlayerView 必须来自新的 authoritative sync。

同时验证：

- 真机 native heavy vibration capability 可明确感知；server-originated action-alert 的 semantic effect 链路由自动化 contract/integration tests 覆盖；
- semantic audio 若配置了可访问的音频 source，应保持 best-effort，不得影响 authoritative sync；
- stale old-socket callback 不得覆盖新 generation；该项已有专门自动化测试；
- 同 commandId retry 不得导致 revision 二次推进。

## E3.7 完成状态

**E3.7A + E3.7B 已于 2026-09-29 COMPLETE。**

真实设备证据包括：产品 create/join、双端 authoritative push、foreground/background 恢复、飞行模式断网恢复、stored-session 恢复，以及 heavy vibration capability。fake-`wx` integration tests 继续承担 stale-generation、same-commandId retry 与 semantic effect wiring 等自动化 contract evidence；两类证据不互相替代。
