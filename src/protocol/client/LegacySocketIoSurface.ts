export type LegacyProtocolFamily = "command" | "state" | "event" | "reconnect";
export type LegacySocketDirection = "client-to-server" | "server-to-client";

export type LegacySocketSurfaceEntry = {
  event: string;
  direction: LegacySocketDirection;
  family: LegacyProtocolFamily;
  category:
    | "session"
    | "room-management"
    | "recovery"
    | "werewolf-game"
    | "interaction-timeout"
    | "test-support"
    | "delivery";
  protocolTarget?: string;
};

/**
 * Inventory of the remaining production Socket.IO surface during E2 migration.
 * Every event belongs to one of the four stable protocol families instead of
 * becoming a fifth transport API.
 *
 * Stable Socket.IO delivery events are `client:command`, `client:sync-state`,
 * `client:state`, and `client:event`. E2.3 removes retired legacy entries from
 * this inventory as their production consumers disappear.
 */
export const LEGACY_SOCKET_IO_SURFACE: readonly LegacySocketSurfaceEntry[] = [
  { event: "client:command", direction: "client-to-server", family: "command", category: "delivery", protocolTarget: "command.envelope" },
  { event: "client:sync-state", direction: "client-to-server", family: "reconnect", category: "delivery", protocolTarget: "state.sync" },
  { event: "host:create-room", direction: "client-to-server", family: "command", category: "session" },
  { event: "player:join-room", direction: "client-to-server", family: "command", category: "session" },
  { event: "player:resume", direction: "client-to-server", family: "reconnect", category: "session", protocolTarget: "reconnect.resume" },
  { event: "host:create-identity-recovery", direction: "client-to-server", family: "command", category: "recovery" },
  { event: "player:claim-identity-recovery", direction: "client-to-server", family: "reconnect", category: "recovery", protocolTarget: "reconnect.claimRecovery" },
  { event: "host:start-game", direction: "client-to-server", family: "command", category: "werewolf-game" },
  { event: "host:move-player-seat", direction: "client-to-server", family: "command", category: "room-management" },
  { event: "player:update-name", direction: "client-to-server", family: "command", category: "room-management" },
  { event: "host:remove-player", direction: "client-to-server", family: "command", category: "room-management" },
  { event: "host:transfer-host", direction: "client-to-server", family: "command", category: "room-management" },
  { event: "host:leave-and-transfer", direction: "client-to-server", family: "command", category: "room-management" },
  { event: "host:close-room", direction: "client-to-server", family: "command", category: "room-management" },
  { event: "player:leave-room", direction: "client-to-server", family: "command", category: "room-management" },

  { event: "player:confirm-role", direction: "client-to-server", family: "command", category: "werewolf-game", protocolTarget: "werewolf.confirmRole" },
  { event: "player:submit-wolf-target", direction: "client-to-server", family: "command", category: "werewolf-game", protocolTarget: "werewolf.submitWolfTarget" },
  { event: "player:submit-witch-action", direction: "client-to-server", family: "command", category: "werewolf-game", protocolTarget: "werewolf.submitWitchAction" },
  { event: "player:submit-seer-target", direction: "client-to-server", family: "command", category: "werewolf-game", protocolTarget: "werewolf.submitSeerTarget" },
  { event: "player:confirm-seer-result", direction: "client-to-server", family: "command", category: "werewolf-game", protocolTarget: "werewolf.confirmSeerResult" },
  { event: "player:submit-guard-target", direction: "client-to-server", family: "command", category: "werewolf-game", protocolTarget: "werewolf.submitGuardTarget" },
  { event: "player:submit-hunter-execution", direction: "client-to-server", family: "command", category: "werewolf-game", protocolTarget: "werewolf.submitHunterExecution" },
  { event: "host:start-night", direction: "client-to-server", family: "command", category: "werewolf-game", protocolTarget: "werewolf.startNight" },
  { event: "player:submit-vote", direction: "client-to-server", family: "command", category: "werewolf-game", protocolTarget: "werewolf.submitVote" },
  { event: "host:close-voting", direction: "client-to-server", family: "command", category: "werewolf-game", protocolTarget: "werewolf.closeVoting" },
  { event: "host:begin-night-start", direction: "client-to-server", family: "command", category: "werewolf-game", protocolTarget: "werewolf.beginNightStart" },
  { event: "host:restart-game", direction: "client-to-server", family: "command", category: "werewolf-game" },
  { event: "host:resend-current-action", direction: "client-to-server", family: "command", category: "recovery" },

  { event: "host:get-interaction-timeout", direction: "client-to-server", family: "command", category: "interaction-timeout" },
  { event: "host:set-interaction-timeout", direction: "client-to-server", family: "command", category: "interaction-timeout" },
  { event: "host:abort-to-lobby", direction: "client-to-server", family: "command", category: "recovery" },
  { event: "player:extend-interaction-timeout", direction: "client-to-server", family: "command", category: "interaction-timeout" },

  { event: "host:send-test-prompt", direction: "client-to-server", family: "command", category: "test-support" },
  { event: "player:ack-test-prompt", direction: "client-to-server", family: "command", category: "test-support" },
  { event: "player:submit-test-choice", direction: "client-to-server", family: "command", category: "test-support" },

  { event: "client:state", direction: "server-to-client", family: "state", category: "delivery", protocolTarget: "state.player" },
  { event: "client:event", direction: "server-to-client", family: "event", category: "delivery", protocolTarget: "event.envelope" },
  { event: "room:state", direction: "server-to-client", family: "state", category: "delivery", protocolTarget: "state.room" },
  { event: "player:test-prompt", direction: "server-to-client", family: "event", category: "test-support" },
  { event: "player:test-prompt-state", direction: "server-to-client", family: "state", category: "test-support" },
] as const;