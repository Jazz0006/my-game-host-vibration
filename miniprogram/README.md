# 微信小程序 UI shell + E3.7 真机验证

这个目录不是第二套客户端规则/runtime 实现。它现在同时承载两类薄壳：

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
- 页面里的 Worker Base URL 使用 `https://...`，WebSocket 会由 transport 自动转换为 `wss://...`；
- 已有一组真实的 `roomId / playerId / resumeToken`，E3.7 不在客户端复制 room creation/session authority。

## UI foundation 预览

首页已经切换到产品入口骨架。开发阶段保留两个快捷入口：

- **预览方桌大厅**：使用明确标记的本地 preview data 检查方桌布局、游戏单选、主持位、Ready/震动概念和房间管理页面；这些 preview 操作不写入服务器。
- **E3.7 Diagnostics**：进入原来的真实 session / reconnect / semantic-command 验证壳。

当前 UI foundation 故意还没有伪造 create/join、reorder、moderator assignment 或 room-management authority；相应 command/projection owner 明确后再接线。

## 开发者工具验证

1. 执行 `npm run build:wechat`。
2. 导入仓库根目录。
3. 确认产品首页、Lobby Preview 和 Settings 均能加载，控制台没有 module / require 错误。
4. 从首页进入 **E3.7 Diagnostics**。
5. 输入 Worker Base URL 和已有 session credentials。
6. 点击 **Connect / Replace Session**。
7. 观察连接状态应经历 Connecting/Syncing 并最终进入 Connected。
8. 确认页面同时显示 public room projection 和 private PlayerView。
9. host 可用 **Start Werewolf Game** 验证 lifecycle command。
10. 需要验证具体夜间 action 时，在 **Semantic command** 区输入稳定 command type 和 JSON payload；页面只转发 intention，不实现规则判断。

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

- action-alert 能触发真机震动；
- semantic audio 若配置了可访问的音频 source，应保持 best-effort，不得影响 authoritative sync；
- stale old-socket callback 不得覆盖新 generation；
- 同 commandId retry 不得导致 revision 二次推进。

## E3.7 完成标准

只有在开发者工具和至少一台真机上记录了真实结果后，E3.7 才可以标记 COMPLETE。

fake-`wx` integration test 是自动化 contract evidence，不等于真实设备证据。
