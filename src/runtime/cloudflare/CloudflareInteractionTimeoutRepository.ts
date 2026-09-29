import type {
  InteractionTimeoutState,
} from "../shared/interactionTimeoutPolicy.js";
import {
  DEFAULT_INTERACTION_TIMEOUT_SECONDS,
  normalizeInteractionTimeoutSeconds,
} from "../shared/interactionTimeoutPolicy.js";
import type { DurableObjectStorageLike } from "./CloudflareRoomSnapshotRepository.js";

export type InteractionTimeoutCommandResult =
  | { ok: true; kind: "config"; timeoutSeconds: number }
  | {
      ok: true;
      kind: "extended";
      deadlineAt: number;
      canExtend: boolean;
    }
  | { ok: false; message: string };

export type InteractionTimeoutCommandReceipt = {
  key: string;
  result: InteractionTimeoutCommandResult;
};

export type CloudflareInteractionTimeoutState = {
  timeoutSeconds: number;
  active?: InteractionTimeoutState;
  receipts: InteractionTimeoutCommandReceipt[];
};

const STATE_KEY = "room:interaction-timeout:v1";
const RECEIPT_LIMIT = 128;

function normalizedState(
  stored: Partial<CloudflareInteractionTimeoutState> | undefined,
): CloudflareInteractionTimeoutState {
  return {
    timeoutSeconds: normalizeInteractionTimeoutSeconds(
      stored?.timeoutSeconds ?? DEFAULT_INTERACTION_TIMEOUT_SECONDS,
    ),
    ...(stored?.active === undefined
      ? {}
      : {
          active: {
            ...stored.active,
            actorPlayerIds: [...stored.active.actorPlayerIds],
          },
        }),
    receipts: (stored?.receipts ?? []).map(receipt => ({
      key: receipt.key,
      result: { ...receipt.result },
    })),
  };
}

export class CloudflareInteractionTimeoutRepository {
  constructor(private readonly storage: DurableObjectStorageLike) {}

  async load(): Promise<CloudflareInteractionTimeoutState> {
    return normalizedState(
      await this.storage.get<CloudflareInteractionTimeoutState>(STATE_KEY),
    );
  }

  save(state: CloudflareInteractionTimeoutState): Promise<void> {
    return this.storage.put(STATE_KEY, normalizedState(state));
  }

  async clear(): Promise<boolean> {
    return this.storage.delete(STATE_KEY);
  }

  findReceipt(
    state: CloudflareInteractionTimeoutState,
    key: string,
  ): InteractionTimeoutCommandResult | undefined {
    return state.receipts.find(receipt => receipt.key === key)?.result;
  }

  rememberReceipt(
    state: CloudflareInteractionTimeoutState,
    key: string,
    result: InteractionTimeoutCommandResult,
  ): void {
    state.receipts = state.receipts.filter(receipt => receipt.key !== key);
    state.receipts.push({ key, result: { ...result } });
    if (state.receipts.length > RECEIPT_LIMIT) {
      state.receipts.splice(0, state.receipts.length - RECEIPT_LIMIT);
    }
  }
}
