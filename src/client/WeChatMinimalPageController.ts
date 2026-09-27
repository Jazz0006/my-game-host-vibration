import type { ClientReconnectCredentials } from "../protocol/client/ClientProtocol.js";
import type {
  WeChatNativeClient,
  WeChatNativeClientView,
} from "./WeChatNativeClient.js";

export type WeChatMinimalPageData<TPlayerView = unknown> = {
  client: WeChatNativeClientView<TPlayerView>;
};

export type WeChatMinimalPageLike<TPlayerView = unknown> = {
  setData(data: WeChatMinimalPageData<TPlayerView>): void;
};

/**
 * Minimal native-page bridge for E3.6.
 *
 * The page renders the already-composed client view and forwards user
 * intentions. It never reads transport frames or implements game rules.
 */
export class WeChatMinimalPageController<TPlayerView = unknown> {
  private detach: (() => void) | null = null;

  constructor(
    private readonly client: WeChatNativeClient<TPlayerView>,
    private readonly page: WeChatMinimalPageLike<TPlayerView>,
  ) {}

  onLoad(): boolean {
    if (!this.detach) {
      this.detach = this.client.subscribe(view => {
        this.page.setData({ client: view });
      });
    }
    return this.client.startStoredSession();
  }

  onUnload(): void {
    this.detach?.();
    this.detach = null;
  }

  startSession(credentials: ClientReconnectCredentials): void {
    this.client.startSession(credentials);
  }

  sendCommand<TPayload>(type: string, payload: TPayload): Promise<unknown> {
    return this.client.sendCommand(type, payload);
  }
}
