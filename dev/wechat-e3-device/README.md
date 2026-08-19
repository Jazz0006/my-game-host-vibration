# E3.7 WeChat real-device harness

This directory is the minimal WeChat Mini Program used to validate the E3 client stack on physical devices. It is a diagnostic harness, not the production UI.

## Backend

The harness is preconfigured for:

```text
https://my-game-host-vibration.jazz-zeng.workers.dev
```

The page asks for `roomId`, `playerId`, and `resumeToken`. Credentials are saved only in the local Mini Program storage so they do not need to be committed to Git.

## Prepare the runtime

E3.1 is currently an independent stacked branch. Use a local validation branch containing E3.7 plus E3.1:

```bash
git fetch origin
git checkout e3-device-test
git merge origin/agent/e3-7-real-device-validation
git merge origin/agent/e3-1-wechat-lifecycle-boundary
npm ci
npm test
npm run prepare:wechat-device
```

`prepare:wechat-device` compiles the client runtime and copies `public/client-runtime/` into `miniprogram/client-runtime/`. The copied runtime is generated and ignored by Git.

If `WeChatSessionLifecycle.js` is missing, the script stops instead of producing a harness that cannot validate foreground/background recovery.

## Import into WeChat DevTools

Import this directory itself:

```text
dev/wechat-e3-device
```

`project.config.json` uses `touristappid` only as a repository-safe placeholder. Before Preview / Real Device Debugging, use your real Mini Program AppID in WeChat DevTools (the tool normally writes local project settings; `project.private.config.json` is ignored by Git).

The Cloudflare Worker host also needs to be accepted by the Mini Program request/WebSocket domain configuration for real-device networking. We will configure this interactively during device setup.

## Diagnostic page

The page displays:

- connection status;
- generation;
- authoritative revision;
- E3.6 screen;
- current seer targets when available;
- lifecycle/network logs.

Controls:

- **Start session** — starts the real `ClientSession` using the entered credentials;
- **Resync** — manually asks the synchronized session for authoritative state;
- **Reconnect** — manually starts a new generation after a real disconnect;
- **Test vibration** — calls the E3.7 WeChat effect capability binding on the physical device;
- seer target buttons appear only when the authoritative PlayerView is `seer_action`.

Automatic foreground/network recovery is wired through the real E3.1 `attachWeChatSessionLifecycle()` adapter.

## Security note

Do not commit real resume tokens. The harness stores them only with `wx.setStorageSync()` on the development device. Clear the E3 device-test storage in DevTools/WeChat when the test account is no longer needed.
