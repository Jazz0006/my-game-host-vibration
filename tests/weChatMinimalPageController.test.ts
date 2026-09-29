import { describe, expect, it, vi } from "vitest";
import {
  WeChatMinimalPageController,
  type WeChatMinimalPageLike,
} from "../src/client/WeChatMinimalPageController.js";
import type {
  WeChatNativeClient,
  WeChatNativeClientListener,
  WeChatNativeClientView,
} from "../src/client/WeChatNativeClient.js";

type PlayerView = { mode: string };

class ClientFake implements WeChatNativeClient<PlayerView> {
  view: WeChatNativeClientView<PlayerView> = {
    screen: "resume-required",
    connectionStatus: "Idle",
    room: null,
    roomRevision: null,
    playerView: null,
    playerRevision: null,
  };
  listener: WeChatNativeClientListener<PlayerView> | null = null;
  startStoredCalls = 0;
  readonly hasStoredSession = vi.fn(() => true);
  readonly startSession = vi.fn();
  readonly createRoom = vi.fn(async () => ({
    roomId: "1234",
    gameType: "werewolf",
    playerId: "p1",
    resumeToken: "resume",
    name: "Host",
    seat: 1,
    isHost: true,
    revision: 0,
  }));
  readonly joinRoom = vi.fn(async () => ({
    roomId: "1234",
    gameType: "werewolf",
    playerId: "p2",
    resumeToken: "resume-2",
    name: "Guest",
    seat: 2,
    isHost: false,
    revision: 1,
  }));
  readonly clearStoredSession = vi.fn();
  readonly sendCommand = vi.fn(async () => ({ ok: true }));
  readonly dispose = vi.fn();

  getView(): WeChatNativeClientView<PlayerView> {
    return this.view;
  }

  subscribe(listener: WeChatNativeClientListener<PlayerView>): () => void {
    this.listener = listener;
    listener(this.view);
    return () => {
      this.listener = null;
    };
  }

  startStoredSession(): boolean {
    this.startStoredCalls += 1;
    return true;
  }

  emit(view: WeChatNativeClientView<PlayerView>): void {
    this.view = view;
    this.listener?.(view);
  }
}

describe("E3.6 minimal WeChat page controller", () => {
  it("binds native client view to page data and delegates session/command intentions", async () => {
    const client = new ClientFake();
    const updates: unknown[] = [];
    const page: WeChatMinimalPageLike<PlayerView> = {
      setData(data) {
        updates.push(data);
      },
    };
    const controller = new WeChatMinimalPageController(client, page);

    expect(controller.onLoad()).toBe(true);
    expect(client.startStoredCalls).toBe(1);
    expect(updates.at(-1)).toEqual({ client: client.view });

    const connected: WeChatNativeClientView<PlayerView> = {
      screen: "lobby",
      connectionStatus: "Connected",
      room: {
        roomId: "1234",
        gameType: "werewolf",
        viewer: { playerId: "p1", isHost: true, isGameModerator: false },
        gameModerator: { mode: "automatic" },
        players: [{ id: "p1", name: "Host", seat: 1, isHost: true }],
        gameStarted: false,
      },
      roomRevision: 3,
      playerView: { mode: "lobby" },
      playerRevision: 3,
    };
    client.emit(connected);
    expect(updates.at(-1)).toEqual({ client: connected });

    controller.startSession({
      roomId: "5678",
      playerId: "p9",
      resumeToken: "resume-9",
    });
    expect(client.startSession).toHaveBeenCalledWith({
      roomId: "5678",
      playerId: "p9",
      resumeToken: "resume-9",
    });

    await expect(controller.sendCommand("werewolf.startGame", {})).resolves.toEqual({ ok: true });
    expect(client.sendCommand).toHaveBeenCalledWith("werewolf.startGame", {});

    controller.onUnload();
    client.emit({ ...connected, screen: "game" });
    expect(updates.at(-1)).toEqual({ client: connected });
    expect(client.dispose).not.toHaveBeenCalled();
  });
});
