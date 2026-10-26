import type { BotcGameState } from "./BotcGameModule.js";
import { troubleBrewingRole } from "./TroubleBrewing.js";

export type BotcWinner = { team: "good" | "evil"; reason: "demon_dead" | "two_alive" | "saint_executed" };

export function troubleBrewingWinner(state: BotcGameState): BotcWinner | undefined {
  const alive = state.assignments.filter(item => !state.deadPlayerIds.includes(item.playerId));
  if (!alive.some(item => item.actualRoleId === "imp")) return { team: "good", reason: "demon_dead" };
  if (alive.length <= 2) return { team: "evil", reason: "two_alive" };
  return undefined;
}

/** Action-time death and succession, independent of public Dawn publication. */
export function resolveTroubleBrewingDeath(state: BotcGameState, playerId: string, cause: "imp" | "execution") {
  const deadPlayerIds = [...state.deadPlayerIds];
  const assignments = state.assignments.map(item => ({ ...item }));
  const roleTransitions = [...state.roleTransitions];
  if (deadPlayerIds.includes(playerId)) return { deadPlayerIds, assignments, roleTransitions, died: false };
  const victim = assignments.find(item => item.playerId === playerId);
  if (!victim) throw new Error("Death target is not a participant");
  const livingBefore = assignments.length - deadPlayerIds.length;
  deadPlayerIds.push(playerId);
  if (victim.actualRoleId === "imp") {
    const scarlet = assignments.find(item => item.actualRoleId === "scarlet_woman" &&
      !deadPlayerIds.includes(item.playerId) && state.poisonedPlayerId !== item.playerId);
    const successor = livingBefore >= 5 && scarlet ? scarlet : cause === "imp"
      ? assignments.find(item => !deadPlayerIds.includes(item.playerId) && troubleBrewingRole(item.actualRoleId).category === "minion")
      : undefined;
    if (successor) {
      successor.actualRoleId = "imp";
      successor.shownRoleId = "imp";
      roleTransitions.push(cause === "imp"
        ? { kind: "imp_self_kill_to_imp", previousImpPlayerId: playerId, newImpPlayerId: successor.playerId }
        : { kind: "scarlet_woman_to_imp", playerId: successor.playerId });
    }
  }
  return { deadPlayerIds, assignments, roleTransitions, died: true };
}

/** Healthy actual Imp/Soldier/Monk effects, with no invented player choice. */
export function resolveTroubleBrewingImpAttack(state: BotcGameState, actorPlayerId: string, targetPlayerId: string) {
  const actor = state.assignments.find(item => item.playerId === actorPlayerId);
  const target = state.assignments.find(item => item.playerId === targetPlayerId);
  if (!target) throw new Error("Imp target is not a participant");
  if (actor?.actualRoleId !== "imp" || state.poisonedPlayerId === actorPlayerId ||
    state.monkProtectedPlayerId === targetPlayerId ||
    (target.actualRoleId === "soldier" && state.poisonedPlayerId !== targetPlayerId)) return undefined;
  return resolveTroubleBrewingDeath(state, targetPlayerId, "imp");
}
