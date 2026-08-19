import { describe, expect, it } from "vitest";
import { LEGACY_SOCKET_IO_SURFACE } from "../src/protocol/client/LegacySocketIoSurface.js";

const DEV_TEST_EVENTS = [
  "host:send-test-prompt",
  "player:ack-test-prompt",
  "player:submit-test-choice",
  "player:test-prompt",
] as const;

describe("E2.3 dev/test-only Socket.IO classification", () => {
  it("marks every remaining test-support entry as an explicit dev/test-only exception", () => {
    const testSupport = LEGACY_SOCKET_IO_SURFACE.filter(
      entry => entry.category === "test-support",
    );

    expect(testSupport.map(entry => entry.event).sort()).toEqual([...DEV_TEST_EVENTS].sort());
    expect(testSupport.every(entry => entry.scope === "dev-test")).toBe(true);
  });

  it("does not classify production protocol or room surfaces as dev/test-only", () => {
    const devTest = LEGACY_SOCKET_IO_SURFACE.filter(entry => entry.scope === "dev-test");

    expect(devTest.every(entry => entry.category === "test-support")).toBe(true);
    expect(
      LEGACY_SOCKET_IO_SURFACE.find(entry => entry.event === "client:event")?.scope,
    ).toBeUndefined();
    expect(
      LEGACY_SOCKET_IO_SURFACE.find(entry => entry.event === "client:state")?.scope,
    ).toBeUndefined();
    expect(
      LEGACY_SOCKET_IO_SURFACE.find(entry => entry.event === "room:state")?.scope,
    ).toBeUndefined();
  });

  it("keeps the raw test prompt event outside the stable production protocol target map", () => {
    const prompt = LEGACY_SOCKET_IO_SURFACE.find(
      entry => entry.event === "player:test-prompt",
    );

    expect(prompt).toMatchObject({
      direction: "server-to-client",
      family: "event",
      category: "test-support",
      scope: "dev-test",
    });
    expect(prompt?.protocolTarget).toBeUndefined();
  });

  it("does not inventory the retired test prompt state event", () => {
    expect(
      LEGACY_SOCKET_IO_SURFACE.some(entry => entry.event === "player:test-prompt-state"),
    ).toBe(false);
  });
});
