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
 * E1 audit of the production Socket.IO surface before E2 starts migrating the
 * Web client. Entries are inventory, not a promise that E1 rewrites every
 * handler. The important boundary is that every legacy event belongs to one of
 * the four stable protocol families instead of becoming a fifth transport API.
 */
export const LEGACY_SOCKET_IO_SURFACE: readonly LegacySocketSurfaceEntry[] = [
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

  { event: "room:state", direction: "server-to-client", family: "state", category: "delivery", protocolTarget: "state.room" },
  { event: "player:game-state", direction: "server-to-client", family: "state", category: "delivery", protocolTarget: "state.player" },
  { event: "session:replaced", direction: "server-to-client", family: "event", category: "session", protocolTarget: "session.replaced" },
  { event: "room:removed", direction: "server-to-client", family: "event", category: "room-management", protocolTarget: "room.removed" },
  { event: "room:closed", direction: "server-to-client", family: "event", category: "room-management", protocolTarget: "room.closed" },
  { event: "player:action-alert", direction: "server-to-client", family: "event", category: "delivery", protocolTarget: "player.actionAlert" },
  { event: "game:night-complete", direction: "server-to-client", family: "event", category: "werewolf-game", protocolTarget: "game.nightComplete" },
  { event: "game:over", direction: "server-to-client", family: "event", category: "werewolf-game", protocolTarget: "game.over" },
  { event: "game:aborted-to-lobby", direction: "server-to-client", family: "event", category: "recovery", protocolTarget: "game.abortedToLobby" },
  { event: "player:interaction-timeout-state", direction: "server-to-client", family: "event", category: "interaction-timeout", protocolTarget: "player.interactionTimeoutState" },
  { event: "player:interaction-timeout-error", direction: "server-to-client", family: "event", category: "interaction-timeout", protocolTarget: "player.interactionTimeoutError" },
  { event: "player:test-prompt", direction: "server-to-client", family: "event", category: "test-support" },
  { event: "player:test-prompt-state", direction: "server-to-client", family: "state", category: "test-support" },
] as const;
