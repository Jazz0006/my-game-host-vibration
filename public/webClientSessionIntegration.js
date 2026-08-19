(function installWebClientSessionIntegration(global) {
  "use strict";

  const CLIENT_RUNTIME_URL = "/client-runtime/client/browser/WebClientSession.js";
  const legacyEnterRoom = enterRoom;
  const legacyReturnToEntry = returnToEntry;
  const legacySetConnectionStatus = setConnectionStatus;

  let webClientSession = null;
  let unsubscribeClientSession = null;
  let pendingEntryResult = null;
  let activationId = 0;

  const runtimePromise = import(CLIENT_RUNTIME_URL);

  function activeCredentials(value) {
    if (!value || typeof value !== "object") return null;
    const roomId = typeof value.roomId === "string" ? value.roomId.trim() : "";
    const playerId = typeof value.playerId === "string" ? value.playerId.trim() : "";
    let resumeToken = typeof value.resumeToken === "string" ? value.resumeToken.trim() : "";

    if (!resumeToken && roomId && playerId) {
      const saved = readSession();
      if (saved?.roomId === roomId && saved?.playerId === playerId) {
        resumeToken = saved.resumeToken;
      }
    }

    return roomId && playerId && resumeToken
      ? { roomId, playerId, resumeToken }
      : null;
  }

  function roomIsVisible() {
    return !document.getElementById("room").classList.contains("hidden");
  }

  function teardownClientSession() {
    const session = webClientSession;
    webClientSession = null;
    unsubscribeClientSession?.();
    unsubscribeClientSession = null;
    pendingEntryResult = null;
    if (session?.getConnectionState().status !== "Disposed") session?.dispose();
  }

  function renderSessionSnapshot(session, snapshot) {
    if (session !== webClientSession) return;

    const status = snapshot.connection.status;
    if (status === "Connecting") {
      membershipActive = false;
      legacySetConnectionStatus("连接中……", "reconnecting");
      return;
    }

    if (status === "Syncing") {
      membershipActive = false;
      legacySetConnectionStatus("正在同步游戏状态……", "reconnecting");
      return;
    }

    if (status === "Connected") {
      membershipActive = true;
      resumeInProgress = false;
      sessionReplaced = false;
      document.getElementById("entry-error").textContent = "";
      setError("");

      if (!roomIsVisible()) {
        legacyEnterRoom(pendingEntryResult || {
          roomId: currentRoomId,
          playerId: currentPlayerId,
        });
      } else {
        legacySetConnectionStatus("已连接");
      }
      pendingEntryResult = null;

      const playerView = snapshot.authoritativeState.envelope?.payload;
      if (playerView && typeof playerView === "object") renderGameState(playerView);
      return;
    }

    if (status === "Disconnected") {
      membershipActive = false;
      if (currentRoomId) {
        legacySetConnectionStatus("网络连接中……", "reconnecting");
        setError("连接暂时中断，正在恢复身份并同步当前游戏状态");
      }
      queueMicrotask(() => {
        if (
          session === webClientSession &&
          session.getConnectionState().status === "Disconnected"
        ) {
          session.reconnect();
        }
      });
      return;
    }

    if (status === "Reconnecting") {
      membershipActive = false;
      legacySetConnectionStatus("网络连接中……", "reconnecting");
      return;
    }

    if (status === "Failed") {
      membershipActive = false;
      resumeInProgress = false;
      const message = snapshot.connection.failure?.message || "无法同步当前游戏状态，请刷新后重试";
      legacySetConnectionStatus("同步失败", "error");

      if (!roomIsVisible()) {
        clearSession();
        teardownClientSession();
        legacyReturnToEntry(message);
        if (!socket.connected) socket.connect();
      } else {
        setError(message);
      }
    }
  }

  async function activateClientSession(result) {
    const credentials = activeCredentials(result);
    if (!credentials) {
      legacyEnterRoom(result);
      return;
    }

    const myActivationId = ++activationId;
    const previous = webClientSession;
    if (previous) teardownClientSession();

    currentRoomId = credentials.roomId;
    currentPlayerId = credentials.playerId;
    pendingEntryResult = {
      ...result,
      roomId: credentials.roomId,
      playerId: credentials.playerId,
    };

    try {
      const { createWebClientSession } = await runtimePromise;
      if (myActivationId !== activationId) return;

      const session = createWebClientSession(socket);
      webClientSession = session;
      unsubscribeClientSession = session.subscribe(snapshot => {
        renderSessionSnapshot(session, snapshot);
      });
      session.start(credentials);
    } catch (error) {
      if (myActivationId !== activationId) return;
      resumeInProgress = false;
      const message = error instanceof Error && error.message
        ? error.message
        : "客户端运行时加载失败，请刷新后重试";
      clearSession();
      teardownClientSession();
      legacyReturnToEntry(message);
      if (!socket.connected) socket.connect();
    }
  }

  // app.js registers legacy socket lifecycle handlers before this integration
  // shim loads. E2.2 replaces only those handlers; room management and realtime
  // effects remain on their existing compatibility events for now.
  socket.off("connect");
  socket.off("disconnect");
  socket.off("connect_error");
  socket.off("player:game-state", renderGameState);

  setConnectionStatus = function clientSessionAwareConnectionStatus(message, kind = "") {
    if (
      message === "已连接" &&
      webClientSession &&
      webClientSession.getConnectionState().status !== "Connected"
    ) {
      return;
    }
    legacySetConnectionStatus(message, kind);
  };

  enterRoom = function clientSessionEnterRoom(result) {
    void activateClientSession(result);
  };

  resumeSession = function clientSessionResume(session) {
    if (resumeInProgress || membershipActive || sessionReplaced) return;
    resumeInProgress = true;
    document.getElementById("entry-error").textContent = "正在恢复上次房间并同步状态……";
    void activateClientSession(session);
  };

  returnToEntry = function clientSessionReturnToEntry(message) {
    activationId += 1;
    teardownClientSession();
    legacyReturnToEntry(message);
    queueMicrotask(() => {
      if (!socket.connected) socket.connect();
    });
  };

  runtimePromise.then(() => {
    const session = readSession();
    if (session && !sessionReplaced) resumeSession(session);
    else if (!socket.connected) socket.connect();
  }).catch(error => {
    resumeInProgress = false;
    const message = error instanceof Error && error.message
      ? error.message
      : "客户端运行时加载失败";
    legacyReturnToEntry(message);
    if (!socket.connected) socket.connect();
  });

  global.WebClientSessionIntegration = Object.freeze({
    runtimeUrl: CLIENT_RUNTIME_URL,
    getSession: () => webClientSession,
  });
})(globalThis);
