import { describe, expect, it } from "vitest";
import {
  normalizeRoomCode,
  resolveRoomStub,
  type DurableObjectNamespaceLike,
  type DurableObjectStubLike,
} from "../src/runtime/cloudflare/roomRouting.js";

class FakeNamespace implements DurableObjectNamespaceLike {
  private readonly stubs = new Map<string, DurableObjectStubLike>();

  getByName(name: string): DurableObjectStubLike {
    const existing = this.stubs.get(name);
    if (existing) return existing;

    const stub: DurableObjectStubLike = {
      fetch: async () => Response.json({ name }),
    };
    this.stubs.set(name, stub);
    return stub;
  }
}

describe("D2.1 Cloudflare room routing", () => {
  it("normalizes the existing four-digit room contract", () => {
    expect(normalizeRoomCode(" 1234 ")).toBe("1234");
    expect(() => normalizeRoomCode("123")).toThrow("roomCode must be exactly 4 digits");
    expect(() => normalizeRoomCode("12ab")).toThrow("roomCode must be exactly 4 digits");
  });

  it("routes the same room code to the same Durable Object stub", () => {
    const namespace = new FakeNamespace();
    expect(resolveRoomStub(namespace, "1234")).toBe(resolveRoomStub(namespace, "1234"));
  });

  it("routes different room codes to different Durable Object stubs", () => {
    const namespace = new FakeNamespace();
    expect(resolveRoomStub(namespace, "1234")).not.toBe(resolveRoomStub(namespace, "5678"));
  });
});
