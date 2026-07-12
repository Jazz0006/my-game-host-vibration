import { describe, expect, it } from "vitest";
import { acknowledgePrompt, createTestPrompt, submitPrompt } from "../src/domain/testPrompt.js";

describe("test prompt lifecycle", () => {
  it("moves from sent to acknowledged to submitted", () => {
    const sent = createTestPrompt("player-1");
    const acknowledged = acknowledgePrompt(sent);
    const submitted = submitPrompt(acknowledged, "选项一");

    expect(sent.status).toBe("sent");
    expect(acknowledged.status).toBe("acknowledged");
    expect(submitted).toMatchObject({ status: "submitted", choice: "选项一" });
  });

  it("rejects a choice before acknowledgement", () => {
    expect(() => submitPrompt(createTestPrompt("player-1"), "选项一")).toThrow();
  });
});
