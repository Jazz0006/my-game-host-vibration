import { describe, expect, it } from "vitest";
import {
  WeChatSessionCredentialStore,
  type WeChatStorageLike,
} from "../src/client/WeChatSessionCredentialStore.js";

class MemoryStorage implements WeChatStorageLike {
  readonly values = new Map<string, unknown>();

  getStorageSync(key: string): unknown {
    return this.values.get(key);
  }

  setStorageSync(key: string, data: unknown): void {
    this.values.set(key, structuredClone(data));
  }

  removeStorageSync(key: string): void {
    this.values.delete(key);
  }
}

describe("E3.6 WeChat session credential store", () => {
  it("persists normalized room-scoped reconnect credentials only", () => {
    const storage = new MemoryStorage();
    const store = new WeChatSessionCredentialStore(storage);

    store.save({
      roomId: " 1234 ",
      playerId: " p1 ",
      resumeToken: " secret ",
    });

    expect(storage.values.get("gamehost.client.session.v1")).toEqual({
      roomId: "1234",
      playerId: "p1",
      resumeToken: "secret",
    });
    expect(store.load()).toEqual({
      roomId: "1234",
      playerId: "p1",
      resumeToken: "secret",
    });
  });

  it("treats malformed storage as unavailable credentials and supports explicit clear", () => {
    const storage = new MemoryStorage();
    storage.values.set("gamehost.client.session.v1", {
      roomId: "1234",
      playerId: "",
      resumeToken: "secret",
    });
    const store = new WeChatSessionCredentialStore(storage);

    expect(store.load()).toBeNull();

    store.save({ roomId: "1234", playerId: "p1", resumeToken: "secret" });
    store.clear();
    expect(store.load()).toBeNull();
    expect(storage.values.has("gamehost.client.session.v1")).toBe(false);
  });
});
