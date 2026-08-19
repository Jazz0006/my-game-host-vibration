import {
  createClientCommandEnvelope,
  type ClientReconnectCredentials,
} from "../../protocol/client/ClientProtocol.js";
import type { ClientConnectionContext } from "../runtime/ClientConnectionFSM.js";
import type { ClientSessionSnapshot } from "../runtime/ClientSession.js";
import { createWeChatClientSession } from "./WeChatClientSession.js";
import {
  attachWeChatClientEffects,
  type WeChatClientEffectOptions,
  type WeChatClientEffectsAttachment,
  type WeChatEffectsPlatform,
} from "./WeChatClientEffects.js";
import { sendWeChatCommandWithReconnectRetry } from "./WeChatCommandRetry.js";
import {
  type WeChatRealtimePlatform,
  type WeChatRealtimeTransportOptions,
} from "./WeChatRealtimeTransport.js";

export type WeChatWerewolfPlayerRef = {
  id: string;
  name: string;
  seat: number;
};

export type WeChatWerewolfAuthoritativeView = {
  phase: string;
  mode: string;
  roleName?: string;
  actionId?: string;
  targets?: WeChatWerewolfPlayerRef[];
  checkedPlayer?: WeChatWerewolfPlayerRef;
  checkedAlignment?: "werewolf" | "good";
};

export type WeChatWerewolfSliceScreen =
  | "connecting"
  | "lobby"
  | "waiting"
  | "seer-action"
  | "seer-result"
  | "unsupported";

export type WeChatWerewolfSliceViewModel = {
  screen: WeChatWerewolfSliceScreen;
  connectionStatus: string;
  revision: number | null;
  roleName?: string;
  actionId?: string;
  targets: WeChatWerewolfPlayerRef[];
  checkedPlayer?: WeChatWerewolfPlayerRef;
  checkedAlignment?: "werewolf" | "good";
};

export type WeChatWerewolfVerticalSliceOptions = {
  transport: WeChatRealtimeTransportOptions;
  effects?: WeChatClientEffectOptions;
  nextCommandId(): string;
};

export type WeChatWerewolfVerticalSlicePlatform = WeChatRealtimePlatform & WeChatEffectsPlatform;

export type WeChatWerewolfVerticalSlice = {
  start(): void;
  reconnect(): void;
  resync(): void;
  getConnectionState(): ClientConnectionContext;
  getViewModel(): WeChatWerewolfSliceViewModel;
  subscribe(listener: (viewModel: WeChatWerewolfSliceViewModel) => void): () => void;
  submitSeerTarget(targetPlayerId: string): Promise<unknown>;
  dispose(): void;
};

function asPlayerRef(value: unknown): WeChatWerewolfPlayerRef | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" || !record.id.trim() ||
    typeof record.name !== "string" ||
    !Number.isSafeInteger(record.seat)
  ) {
    return null;
  }
  return { id: record.id, name: record.name, seat: Number(record.seat) };
}

function parseAuthoritativeView(value: unknown): WeChatWerewolfAuthoritativeView | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.phase !== "string" || typeof record.mode !== "string") return null;

  const targets = Array.isArray(record.targets)
    ? record.targets.map(asPlayerRef).filter((target): target is WeChatWerewolfPlayerRef => target !== null)
    : undefined;
  const checkedPlayer = asPlayerRef(record.checkedPlayer);
  const checkedAlignment = record.checkedAlignment === "werewolf" || record.checkedAlignment === "good"
    ? record.checkedAlignment
    : undefined;

  return {
    phase: record.phase,
    mode: record.mode,
    ...(typeof record.roleName === "string" ? { roleName: record.roleName } : {}),
    ...(typeof record.actionId === "string" ? { actionId: record.actionId } : {}),
    ...(targets ? { targets } : {}),
    ...(checkedPlayer ? { checkedPlayer } : {}),
    ...(checkedAlignment ? { checkedAlignment } : {}),
  };
}

function projectViewModel(
  snapshot: ClientSessionSnapshot<unknown>,
): WeChatWerewolfSliceViewModel {
  const base = {
    connectionStatus: snapshot.connection.status,
    revision: snapshot.authoritativeState.revision,
    targets: [] as WeChatWerewolfPlayerRef[],
  };

  if (snapshot.connection.status !== "Connected") {
    return { ...base, screen: "connecting" };
  }

  const view = parseAuthoritativeView(snapshot.authoritativeState.envelope?.payload);
  if (!view) return { ...base, screen: "unsupported" };
  if (view.phase === "lobby" || view.mode === "lobby") {
    return { ...base, screen: "lobby" };
  }

  const common = {
    ...base,
    ...(view.roleName ? { roleName: view.roleName } : {}),
    ...(view.actionId ? { actionId: view.actionId } : {}),
  };

  if (view.mode === "seer_action") {
    return {
      ...common,
      screen: "seer-action",
      targets: view.targets ? view.targets.map(target => ({ ...target })) : [],
    };
  }

  if (view.mode === "seer_result") {
    return {
      ...common,
      screen: "seer-result",
      ...(view.checkedPlayer ? { checkedPlayer: { ...view.checkedPlayer } } : {}),
      ...(view.checkedAlignment ? { checkedAlignment: view.checkedAlignment } : {}),
    };
  }

  return { ...common, screen: "waiting" };
}

/**
 * E3.6 minimal native vertical slice.
 *
 * This controller is deliberately thinner than a real WeChat Page. It projects
 * the current private authoritative PlayerView into a tiny page model and wires
 * exactly one night action (seer target selection) back through the stable
 * client command protocol. It never computes phases, legal targets, role rules,
 * or reconnect state locally; those remain authoritative server/session data.
 */
export function createWeChatWerewolfVerticalSlice(
  platform: WeChatWerewolfVerticalSlicePlatform,
  credentials: ClientReconnectCredentials,
  options: WeChatWerewolfVerticalSliceOptions,
): WeChatWerewolfVerticalSlice {
  const session = createWeChatClientSession<unknown>(platform, credentials, options.transport);
  let effects: WeChatClientEffectsAttachment | null = null;
  let disposed = false;

  const ensureEffects = (): void => {
    if (effects || disposed) return;
    effects = attachWeChatClientEffects(session, platform, options.effects);
  };

  return {
    start() {
      if (disposed) throw new Error("WeChat werewolf slice is disposed");
      ensureEffects();
      session.start(credentials);
    },

    reconnect() {
      if (disposed) return;
      session.reconnect();
    },

    resync() {
      if (disposed) return;
      session.resync();
    },

    getConnectionState() {
      return session.getConnectionState();
    },

    getViewModel() {
      return projectViewModel(session.getSnapshot());
    },

    subscribe(listener) {
      return session.subscribe(snapshot => listener(projectViewModel(snapshot)));
    },

    async submitSeerTarget(targetPlayerId: string) {
      const target = targetPlayerId.trim();
      if (!target) throw new Error("targetPlayerId is required");

      const snapshot = session.getSnapshot();
      const view = parseAuthoritativeView(snapshot.authoritativeState.envelope?.payload);
      if (snapshot.connection.status !== "Connected" || view?.mode !== "seer_action") {
        throw new Error("seer action is not currently authoritative");
      }
      if (!view.actionId) throw new Error("authoritative seer actionId is missing");
      if (!view.targets?.some(candidate => candidate.id === target)) {
        throw new Error("target is not present in the authoritative seer target list");
      }

      const command = createClientCommandEnvelope(
        "werewolf.submitSeerTarget",
        { actionId: view.actionId, targetPlayerId: target },
        options.nextCommandId(),
      );
      return sendWeChatCommandWithReconnectRetry(session, command);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      effects?.detach();
      effects = null;
      session.dispose();
    },
  };
}