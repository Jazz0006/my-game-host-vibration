import { describe, expect, it } from "vitest";
import {
  CLIENT_PROTOCOL_VERSION,
  type ClientReconnectCredentials,
} from "../src/protocol/client/ClientProtocol.js";
import {
  createClientVibrateEffectEvent,
} from "../src/protocol/client/ClientEffects.js";
import {
  createWeChatWerewolfVerticalSlice,
  type WeChatRequestOptions,
  type WeChatSocketTaskLike,
  type WeChatWerewolfVerticalSlicePlatform,
} from "../src/client/wechat/index.js";

class FakeSocket implements WeChatSocketTaskLike {
  readonly sent: string[] = [];
  private openListener: (() => void) | null = null;
  private closeListener: ((result?: { code?: number; reason?: string }) => void) | null = null;
  private errorListener: ((error: unknown) => void) | null = null;
  private messageListener: ((result: { data: unknown }) => void) | null = null;

  onOpen(listener: () => void): void { this.openListener = listener; }
  onClose(listener: (result?: { code?: number; reason?: string }) => void): void {
    this.closeListener = listener;
  }
  onError(listener: (error: unknown) => void): void { this.errorListener = listener; }
  onMessage(listener: (result: { data: unknown }) => void): void { this.messageListener = listener; }
  send(options: { data: string; success?(): void; fail?(error: unknown): void }): void {
    this.sent.push(options.data);
    options.success?.();
  }
  close(): void { this.closeListener?.({ code: 1000, reason: "closed" }); }

  emitOpen(): void { this.openListener?.(); }
  emitMessage(frame: unknown): void {
    this.messageListener?.({ data: JSON.stringify(frame) });
  }
  emitError(error: unknown): void { this.errorListener?.(error); }
}

class FakePlatform implements WeChatWerewolfVerticalSlicePlatform {
  readonly socket = new FakeSocket();
  readonly vibrateShortCalls: Array<{ type?: "heavy" | "medium" | "light" }> = [];

  request(options: WeChatRequestOptions): unknown {
    options.success({
      statusCode: 200,
      data: { ok: true, ticket: "ticket-1", expiresAt: 999999 },
    });
    return {};
  }

  connectSocket(): WeChatSocketTaskLike { return this.socket; }

  vibrateShort(options?: { type?: "heavy" | "medium" | "light" }): unknown {
    this.vibrateShortCalls.push(options ?? {});
    return undefined;
  }
}

const credentials: ClientReconnectCredentials = {
  roomId: "1234",
  playerId: "seer-player",
  resumeToken: "resume-secret",
};

function stateEnvelope(payload: unknown) {
  return {
    protocolVersion: CLIENT_PROTOCOL_VERSION,
    kind: "state" as const,
    scope: "player" as const,
    roomId: credentials.roomId,
    playerId: credentials.playerId,
    payload,
  };
}

function pushState(revision: number, payload: unknown) {
  return {
    protocolVersion: CLIENT_PROTOCOL_VERSION,
    kind: "push",
    type: "client:state",
    payload: { revision, envelope: stateEnvelope(payload) },
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("E3.6 minimal WeChat werewolf vertical slice", () => {
  it("runs lobby -> wake effect -> seer action -> ACK -> authoritative seer result", async () => {
    const platform = new FakePlatform();
    let commandSequence = 0;
    const slice = createWeChatWerewolfVerticalSlice(platform, credentials, {
      transport: { baseUrl: "https://game.example.test" },
      nextCommandId: () => `cmd-${++commandSequence}`,
    });

    expect(slice.getViewModel().screen).toBe("connecting");
    slice.start();
    await flush();
    platform.socket.emitOpen();

    const syncRequest = JSON.parse(platform.socket.sent[0]!) as { requestId: string };
    platform.socket.emitMessage({
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "response",
      requestId: syncRequest.requestId,
      ok: true,
      payload: {
        revision: 1,
        envelope: stateEnvelope({ phase: "lobby", mode: "lobby" }),
      },
    });
    await flush();

    expect(slice.getViewModel()).toMatchObject({
      screen: "lobby",
      connectionStatus: "Connected",
      revision: 1,
    });

    platform.socket.emitMessage({
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "push",
      type: "client:event",
      payload: createClientVibrateEffectEvent([100], { reason: "seer-action" }),
    });
    expect(platform.vibrateShortCalls).toHaveLength(1);

    platform.socket.emitMessage(pushState(2, {
      phase: "night_seer",
      mode: "seer_action",
      roleName: "预言家",
      actionId: "night-1-seer",
      targets: [
        { id: "p2", name: "Alice", seat: 2 },
        { id: "p3", name: "Bob", seat: 3 },
      ],
    }));

    expect(slice.getViewModel()).toEqual({
      screen: "seer-action",
      connectionStatus: "Connected",
      revision: 2,
      roleName: "预言家",
      actionId: "night-1-seer",
      targets: [
        { id: "p2", name: "Alice", seat: 2 },
        { id: "p3", name: "Bob", seat: 3 },
      ],
    });

    const submitPromise = slice.submitSeerTarget("p3");
    await flush();
    const commandRequest = JSON.parse(platform.socket.sent[1]!) as {
      requestId: string;
      type: string;
      payload: {
        commandId: string;
        type: string;
        payload: { actionId: string; targetPlayerId: string };
      };
    };

    expect(commandRequest.type).toBe("client:command");
    expect(commandRequest.payload).toEqual({
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "command",
      commandId: "cmd-1",
      type: "werewolf.submitSeerTarget",
      payload: {
        actionId: "night-1-seer",
        targetPlayerId: "p3",
      },
    });

    platform.socket.emitMessage({
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "response",
      requestId: commandRequest.requestId,
      ok: true,
      payload: {
        outcome: { kind: "stateChanged" },
        replayed: false,
        revision: 3,
      },
    });
    await expect(submitPromise).resolves.toMatchObject({ replayed: false, revision: 3 });

    platform.socket.emitMessage(pushState(3, {
      phase: "night_seer",
      mode: "seer_result",
      roleName: "预言家",
      actionId: "night-1-seer",
      checkedPlayer: { id: "p3", name: "Bob", seat: 3 },
      checkedAlignment: "werewolf",
    }));

    expect(slice.getViewModel()).toEqual({
      screen: "seer-result",
      connectionStatus: "Connected",
      revision: 3,
      roleName: "预言家",
      actionId: "night-1-seer",
      targets: [],
      checkedPlayer: { id: "p3", name: "Bob", seat: 3 },
      checkedAlignment: "werewolf",
    });

    slice.dispose();
  });

  it("refuses targets that are absent from the authoritative target list", async () => {
    const platform = new FakePlatform();
    const slice = createWeChatWerewolfVerticalSlice(platform, credentials, {
      transport: { baseUrl: "https://game.example.test" },
      nextCommandId: () => "cmd-invalid",
    });

    slice.start();
    await flush();
    platform.socket.emitOpen();
    const syncRequest = JSON.parse(platform.socket.sent[0]!) as { requestId: string };
    platform.socket.emitMessage({
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "response",
      requestId: syncRequest.requestId,
      ok: true,
      payload: {
        revision: 5,
        envelope: stateEnvelope({
          phase: "night_seer",
          mode: "seer_action",
          actionId: "night-2-seer",
          targets: [{ id: "p2", name: "Alice", seat: 2 }],
        }),
      },
    });
    await flush();

    await expect(slice.submitSeerTarget("p99")).rejects.toThrow(
      "target is not present in the authoritative seer target list",
    );
    expect(platform.socket.sent).toHaveLength(1);

    slice.dispose();
  });
});
