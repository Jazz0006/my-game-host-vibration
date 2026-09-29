import type {
  IdentityRecoveryState,
  IdentityRecoveryStateRepository,
} from "../shared/IdentityRecoveryService.js";
import type { DurableObjectStorageLike } from "./CloudflareRoomSnapshotRepository.js";

const IDENTITY_RECOVERY_KEY = "room:identity-recovery:v1";

/** Durable Object persistence for game-neutral identity recovery grants. */
export class CloudflareIdentityRecoveryRepository implements IdentityRecoveryStateRepository {
  constructor(private readonly storage: DurableObjectStorageLike) {}

  load(): Promise<IdentityRecoveryState | undefined> {
    return this.storage.get<IdentityRecoveryState>(IDENTITY_RECOVERY_KEY);
  }

  save(state: IdentityRecoveryState): Promise<void> {
    return this.storage.put(IDENTITY_RECOVERY_KEY, state);
  }

  async clear(): Promise<void> {
    await this.storage.delete(IDENTITY_RECOVERY_KEY);
  }
}
