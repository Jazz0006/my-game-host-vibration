import type { GameCommandContext } from "../../core/game/GameModule.js";
import type { GameState, Role } from "../../domain/game.js";
import {
  werewolfGameModule,
  type WerewolfCommand,
} from "../../games/werewolf/WerewolfGameModule.js";
import {
  executeWerewolfCommand,
  type RuntimeRoom,
  type WerewolfCommandOutcome,
} from "./roomBridge.js";

const commandDependencies = {
  random: {
    randomInt(maxExclusive: number) {
      return Math.floor(Math.random() * maxExclusive);
    },
    randomId() {
      return "unused-command-id";
    },
  },
};

function withActionId<T extends object>(command: T, actionId?: string): T & { actionId?: string } {
  return actionId === undefined ? command : { ...command, actionId };
}

// Transitional compatibility layer: preserve the current server handlers' return
// semantics while routing every game action through WerewolfGameModule.handleCommand().
function runStateCommand(
  state: GameState,
  playerId: string | undefined,
  isHost: boolean,
  command: WerewolfCommand,
): void {
  const context: GameCommandContext = playerId === undefined
    ? { isHost, now: Date.now() }
    : { playerId, isHost, now: Date.now() };
  werewolfGameModule.handleCommand(state, context, command, commandDependencies);
}

export function runPlayerCommand(
  room: RuntimeRoom,
  playerId: string,
  command: WerewolfCommand,
): WerewolfCommandOutcome {
  return executeWerewolfCommand(room, command, { playerId });
}

export function runHostCommand(
  room: RuntimeRoom,
  command: WerewolfCommand,
): WerewolfCommandOutcome {
  return executeWerewolfCommand(room, command, { isHost: true });
}

export function confirmRole(state: GameState, playerId: string, actionId?: string): boolean {
  const beforeCount = state.confirmedRolePlayerIds.length;
  runStateCommand(state, playerId, false, withActionId({ type: "confirmRole" } as const, actionId));
  return state.confirmedRolePlayerIds.length > beforeCount && state.phase === "night_start";
}

export function submitWolfTarget(
  state: GameState,
  playerId: string,
  targetPlayerId: string | null | undefined,
  actionId?: string,
): boolean {
  const beforeActionId = state.actionId;
  const command = targetPlayerId === undefined
    ? { type: "submitWolfTarget" } as const
    : { type: "submitWolfTarget", targetPlayerId } as const;
  runStateCommand(state, playerId, false, withActionId(command, actionId));
  return state.actionId !== beforeActionId;
}

export function submitGuardTarget(
  state: GameState,
  playerId: string,
  targetPlayerId: string | null | undefined,
  actionId?: string,
): boolean {
  const beforeActionId = state.actionId;
  const command = targetPlayerId === undefined
    ? { type: "submitGuardTarget" } as const
    : { type: "submitGuardTarget", targetPlayerId } as const;
  runStateCommand(state, playerId, false, withActionId(command, actionId));
  return state.actionId !== beforeActionId;
}

export function submitWitchAction(
  state: GameState,
  playerId: string,
  action: { useAntidote?: boolean; poisonTargetId?: string | null },
  actionId?: string,
): boolean {
  const beforeActionId = state.actionId;
  const command: WerewolfCommand = {
    type: "submitWitchAction",
    ...(action.useAntidote === undefined ? {} : { useAntidote: action.useAntidote }),
    ...(action.poisonTargetId === undefined ? {} : { poisonTargetId: action.poisonTargetId }),
    ...(actionId === undefined ? {} : { actionId }),
  };
  runStateCommand(state, playerId, false, command);
  return state.actionId !== beforeActionId;
}

export function submitSeerTarget(
  state: GameState,
  playerId: string,
  targetPlayerId: string | undefined,
  actionId?: string,
): Role {
  const command = targetPlayerId === undefined
    ? { type: "submitSeerTarget" } as const
    : { type: "submitSeerTarget", targetPlayerId } as const;
  runStateCommand(state, playerId, false, withActionId(command, actionId));
  return state.roles[state.seerTargetId!]!;
}

export function confirmSeerResult(
  state: GameState,
  playerId: string,
  actionId?: string,
): boolean {
  const beforeActionId = state.actionId;
  runStateCommand(state, playerId, false, withActionId({ type: "confirmSeerResult" } as const, actionId));
  return state.actionId !== beforeActionId;
}

export function submitHunterExecution(
  state: GameState,
  playerId: string,
  targetPlayerId: string | null | undefined,
  actionId?: string,
): boolean {
  const beforeActionId = state.actionId;
  const command = targetPlayerId === undefined
    ? { type: "submitHunterExecution" } as const
    : { type: "submitHunterExecution", targetPlayerId } as const;
  runStateCommand(state, playerId, false, withActionId(command, actionId));
  return state.actionId !== beforeActionId;
}

export function startNight(state: GameState): void {
  runStateCommand(state, undefined, true, { type: "startNight" });
}

export function startDayVote(state: GameState): void {
  runStateCommand(state, undefined, true, { type: "startDayVote" });
}

export function submitVote(
  state: GameState,
  playerId: string,
  targetId: string,
  actionId: string,
): boolean {
  const beforeVote = state.votes[playerId];
  runStateCommand(state, playerId, false, { type: "submitVote", targetId, actionId });
  return state.votes[playerId] !== beforeVote;
}

export function closeDayVote(state: GameState): "pk" | "no_kill" | string {
  runStateCommand(state, undefined, true, { type: "closeDayVote" });
  if (state.phase === "day_pk") return "pk";
  if (state.noKillToday) return "no_kill";
  return state.eliminatedTodayId ?? "no_kill";
}

export function beginNightStart(state: GameState): void {
  runStateCommand(state, undefined, true, { type: "beginNightStart" });
}
