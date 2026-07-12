export type TestPrompt = {
  id: string;
  targetPlayerId: string;
  status: "sent" | "acknowledged" | "submitted";
  choice?: string;
};

export function createTestPrompt(targetPlayerId: string): TestPrompt {
  return {
    id: crypto.randomUUID(),
    targetPlayerId,
    status: "sent",
  };
}

export function acknowledgePrompt(prompt: TestPrompt): TestPrompt {
  if (prompt.status === "submitted") return prompt;
  return { ...prompt, status: "acknowledged" };
}

export function submitPrompt(prompt: TestPrompt, choice: string): TestPrompt {
  if (prompt.status !== "acknowledged") {
    throw new Error("Prompt must be acknowledged before submission");
  }
  return { ...prompt, status: "submitted", choice };
}
