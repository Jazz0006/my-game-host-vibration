export type InteractionMode = "single" | "group";

export type InteractionWakePolicy = {
  vibrate: boolean;
  audioCue?: string;
};

export type InteractionCompletionPolicy =
  | { type: "single_submission" }
  | { type: "any_actor_submission" }
  | { type: "explicit_confirmation" };

export type InteractionStatus = "pending" | "active" | "completed";

/**
 * Platform-neutral description of a player interaction.
 *
 * The game layer describes who should act and how they should be woken.
 * Browser, WeChat, Android, Socket.IO, and future Cloudflare runtimes decide
 * how to deliver and render that interaction.
 */
export type PendingInteraction<TKind extends string = string> = {
  id: string;
  kind: TKind;
  actorPlayerIds: string[];
  mode: InteractionMode;
  wakePolicy: InteractionWakePolicy;
  completionPolicy: InteractionCompletionPolicy;
  status: InteractionStatus;
};

export type PlayerInteractionView<TKind extends string = string> = Pick<
  PendingInteraction<TKind>,
  "id" | "kind" | "mode" | "wakePolicy" | "completionPolicy" | "status"
>;

export function interactionForPlayer<TKind extends string>(
  interaction: PendingInteraction<TKind> | undefined,
  playerId: string,
): PlayerInteractionView<TKind> | undefined {
  if (!interaction?.actorPlayerIds.includes(playerId)) return undefined;
  const { actorPlayerIds: _actorPlayerIds, ...playerView } = interaction;
  return playerView;
}
