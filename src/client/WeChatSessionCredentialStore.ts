import {
  createReconnectEnvelope,
  type ClientReconnectCredentials,
} from "../protocol/client/ClientProtocol.js";

export type WeChatStorageLike = {
  getStorageSync(key: string): unknown;
  setStorageSync(key: string, data: unknown): void;
  removeStorageSync(key: string): void;
};

export type WeChatSessionCredentialStoreOptions = {
  storageKey?: string;
};

const DEFAULT_STORAGE_KEY = "gamehost.client.session.v1";

export class WeChatSessionCredentialStore {
  private readonly storageKey: string;

  constructor(
    private readonly storage: WeChatStorageLike,
    options: WeChatSessionCredentialStoreOptions = {},
  ) {
    this.storageKey = options.storageKey?.trim() || DEFAULT_STORAGE_KEY;
  }

  load(): ClientReconnectCredentials | null {
    let value: unknown;
    try {
      value = this.storage.getStorageSync(this.storageKey);
    } catch {
      return null;
    }
    if (value === undefined || value === null) return null;

    try {
      return createReconnectEnvelope(value as ClientReconnectCredentials).credentials;
    } catch {
      return null;
    }
  }

  save(credentials: ClientReconnectCredentials): ClientReconnectCredentials {
    const normalized = createReconnectEnvelope(credentials).credentials;
    this.storage.setStorageSync(this.storageKey, { ...normalized });
    return { ...normalized };
  }

  clear(): void {
    try {
      this.storage.removeStorageSync(this.storageKey);
    } catch {
      // Local storage cleanup is best-effort; session authority remains server-side.
    }
  }
}
