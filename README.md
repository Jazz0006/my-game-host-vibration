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
