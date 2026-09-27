import type { ClientRoomProjection } from "../protocol/client/ClientRoomProjection.js";
import {
  createClientCommandEnvelope,
  type ClientReconnectCredentials,
} from "../protocol/client/ClientProtocol.js";
import { ClientSession } from "./runtime/ClientSession.js";
import {
  attachWeChatClientEffects,
  type WeChatClientEffectOptions,
  type WeChatClientEffectPlatform,
} from "./WeChatClientEffects.js";
import {
  WeChatRealtimeTransport,
  type WeChatPlatformLike,
  type WeChatRealtimeTransportOptions,
} from "./WeChatRealtimeTransport.js";
import {
  WeChatSessionCredentialStore,
  type WeChatSessionCredentialStoreOptions,
  type WeChatStorageLike,
} from "./WeChatSessionCredentialStore.js";
import {
  attachWeChatSessionLifecycle,
  type WeChatAppLifecycleLike,
} from "./WeChatSessionLifecycle.js";

export type WeChatNativeApi =
  WeChatPlatformLike &
  WeChatClientEffectPlatform &
  WeChatStorageLike &
  WeChatAppLifecycleLike;

export type WeChatNativeClientScreen =
  | "resume-required"
  | "connecting"
  | "lobby"
  | "game"
  | "disconnected"
  | "error"
  | "disposed";

export type WeChatNativeClientView<TPlayerView = unknown> = {
  screen: WeChatNativeClientScreen;
  connectionStatus: ReturnType<ClientSession<TPlayerView>["getConnectionState"]>["status"];
  room: ClientRoomProjection | null;
  roomRevision: number | null;
  playerView: TPlayerView | null;
  playerRevision: number | null;
  error?: string;
};

export type WeChatNativeClientListener<TPlayerView = unknown> = (
  view: WeChatNativeClientView<TPlayerView>,
) => void;

export type WeChatNativeClientOptions = {
  baseUrl: string;
  storageKey?: string;
  audioSources?: WeChatClientEffectOptions["audioSources"];
  requestIdFactory?: () => string;
  commandIdFactory?: () => string;
  requestTimeoutMs?: number;
  commandRetries?: number;
};

export type WeChatNativeClient<TPlayerView = unknown> = {
  getView(): WeChatNativeClientView<TPlayerView>;
  subscribe(listener: WeChatNativeClientListener<TPlayerView>): () => void;
  startStoredSession(): boolean;
  startSession(credentials: ClientReconnectCredentials): void;
  clearStoredSession(): void;
  sendCommand<TPayload>(
    type: string,
    payload: TPayload,
  ): Promise<unknown>;
  dispose(): void;
};

function screenFor<TPlayerView>(
  session: ClientSession<TPlayerView>,
  room: ClientRoomProjection | null,
): WeChatNativeClientScreen {
  switch (session.getConnectionState().status) {
    case "Idle":
      return "resume-required";
    case "Connecting":
    case "Syncing":
    case "Reconnecting":
      return "connecting";
    case "Connected":
      return room?.gameStarted ? "game" : "lobby";
    case "Disconnected":
      return "disconnected";
    case "Failed":
      return "error";
    case "Disposed":
      return "disposed";
  }
}

function cloneRoom(room: ClientRoomProjection | null): ClientRoomProjection | null {
  if (!room) return null;
  return {
    ...room,
    viewer: { ...room.viewer },
    players: room.players.map(player => ({ ...player })),
  };
}

export function createWeChatNativeClient<TPlayerView = unknown>(
  api: WeChatNativeApi,
  options: WeChatNativeClientOptions,
): WeChatNativeClient<TPlayerView> {
  const transportOptions: WeChatRealtimeTransportOptions = {
    baseUrl: options.baseUrl,
    ...(options.requestIdFactory === undefined
      ? {}
      : { requestIdFactory: options.requestIdFactory }),
    ...(options.requestTimeoutMs === undefined
      ? {}
      : { requestTimeoutMs: options.requestTimeoutMs }),
    ...(options.commandRetries === undefined
      ? {}
      : { commandRetries: options.commandRetries }),
  };
  const transport = new WeChatRealtimeTransport<TPlayerView>(api, transportOptions);
  const session = new ClientSession<TPlayerView>(transport);
  const credentialStoreOptions: WeChatSessionCredentialStoreOptions =
    options.storageKey === undefined ? {} : { storageKey: options.storageKey };
  const credentials = new WeChatSessionCredentialStore(api, credentialStoreOptions);
  const listeners = new Set<WeChatNativeClientListener<TPlayerView>>();
  let commandSequence = 0;
  const commandIdFactory = options.commandIdFactory ??
    (() => `wechat-command-${Date.now()}-${++commandSequence}`);
  let disposed = false;

  const effectOptions: WeChatClientEffectOptions = options.audioSources === undefined
    ? {}
    : { audioSources: options.audioSources };
  const detachEffects = attachWeChatClientEffects(session, api, effectOptions);
  const detachLifecycle = attachWeChatSessionLifecycle(session, api);

  let currentView: WeChatNativeClientView<TPlayerView> = {
    screen: "resume-required",
    connectionStatus: "Idle",
    room: null,
    roomRevision: null,
    playerView: null,
    playerRevision: null,
  };

  const publish = () => {
    const connection = session.getConnectionState();
    const roomState = session.getRoomState();
    const playerState = session.getAuthoritativeState();
    const room = roomState.envelope?.payload ?? null;

    currentView = {
      screen: screenFor(session, room),
      connectionStatus: connection.status,
      room: cloneRoom(room),
      roomRevision: roomState.revision,
      playerView: playerState.envelope?.payload ?? null,
      playerRevision: playerState.revision,
      ...(connection.failure?.message
        ? { error: connection.failure.message }
        : connection.status === "Failed"
          ? { error: connection.failure?.code ?? "client session failed" }
          : {}),
    };

    for (const listener of listeners) listener(getView());
  };

  const detachSession = session.subscribe(() => publish());
  const detachRoom = session.subscribeRoomState(() => publish());

  function getView(): WeChatNativeClientView<TPlayerView> {
    return {
      ...currentView,
      room: cloneRoom(currentView.room),
    };
  }

  return {
    getView,

    subscribe(listener) {
      listeners.add(listener);
      listener(getView());
      return () => {
        listeners.delete(listener);
      };
    },

    startStoredSession() {
      if (disposed || session.getConnectionState().status !== "Idle") return false;
      const stored = credentials.load();
      if (!stored) return false;
      session.start(stored);
      return true;
    },

    startSession(value) {
      if (disposed) throw new Error("WeChat native client is disposed");
      const normalized = credentials.save(value);
      session.start(normalized);
    },

    clearStoredSession() {
      credentials.clear();
    },

    sendCommand(type, payload) {
      if (disposed) return Promise.reject(new Error("WeChat native client is disposed"));
      return session.send(createClientCommandEnvelope(type, payload, commandIdFactory()));
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      detachLifecycle();
      detachEffects();
      detachRoom();
      detachSession();
      session.dispose();
      listeners.clear();
      currentView = {
        ...currentView,
        screen: "disposed",
        connectionStatus: "Disposed",
      };
    },
  };
}

declare const wx: WeChatNativeApi;

export function createWeChatNativeClientFromGlobal<TPlayerView = unknown>(
  options: WeChatNativeClientOptions,
): WeChatNativeClient<TPlayerView> {
  return createWeChatNativeClient<TPlayerView>(wx, options);
}
