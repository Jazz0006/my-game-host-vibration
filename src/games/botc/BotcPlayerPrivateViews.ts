import type { GameViewContext } from "../../core/game/GameModule.js";
import {
  troubleBrewingRole,
  type TroubleBrewingRoleId,
} from "./TroubleBrewing.js";
import type {
  TroubleBrewingDemonInfoFacts,
  TroubleBrewingNightInformationResult,
  TroubleBrewingNumericInformationAbilityRoleId,
  TroubleBrewingPairInformationAbilityRoleId,
} from "./TroubleBrewingInformation.js";

export type BotcMinionInfoView = {
  demonPlayerId: string;
  fellowMinionPlayerIds: string[];
};

export type BotcDemonInfoView = {
  minionPlayerIds: string[];
  bluffRoles: Array<{
    id: TroubleBrewingRoleId;
    name: string;
    nameZh: string;
  }>;
};

export type BotcRoleView = {
  id: TroubleBrewingRoleId;
  name: string;
  nameZh: string;
};

export type BotcSpyGrimoirePairReminderView =
  | {
      kind: "pair";
      abilityRoleId: TroubleBrewingPairInformationAbilityRoleId;
      abilityRole: BotcRoleView;
      recipientPlayerId: string;
      learnedRole: BotcRoleView;
      shownPlayerIds: [string, string];
    }
  | {
      kind: "no_characters";
      abilityRoleId: "librarian";
      abilityRole: BotcRoleView;
      recipientPlayerId: string;
      noCharacterCategory: "outsider";
    };

export type BotcSpyGrimoireView = {
  players: Array<{
    playerId: string;
    name: string;
    seat: number;
    actualRole: BotcRoleView;
    shownRole: BotcRoleView;
    alive: boolean;
  }>;
  reminders: {
    drunkPlayerId?: string;
    poisonedPlayerId?: string;
    butlerMasterPlayerId?: string;
    redHerringPlayerId?: string;
    pairInformation: BotcSpyGrimoirePairReminderView[];
  };
};

export type BotcPrivateInformationView =
  | {
      kind: "pair";
      abilityRoleId: TroubleBrewingPairInformationAbilityRoleId;
      learnedRole: BotcRoleView;
      shownPlayerIds: [string, string];
    }
  | {
      kind: "no_characters";
      abilityRoleId: "librarian";
      noCharacterCategory: "outsider";
    }
  | {
      kind: "number";
      abilityRoleId: TroubleBrewingNumericInformationAbilityRoleId;
      value: number;
    }
  | {
      kind: "boolean";
      abilityRoleId: "fortune_teller";
      value: boolean;
    }
  | ({
      kind: "spy_grimoire";
      abilityRoleId: "spy";
    } & BotcSpyGrimoireView);

function roleView(roleId: TroubleBrewingRoleId): BotcRoleView {
  const role = troubleBrewingRole(roleId);
  return {
    id: role.id,
    name: role.name,
    nameZh: role.nameZh,
  };
}

export function createBotcMinionInfoView(
  facts: TroubleBrewingDemonInfoFacts,
  playerId: string,
): BotcMinionInfoView | undefined {
  if (!facts.minionPlayerIds.includes(playerId)) return undefined;
  return {
    demonPlayerId: facts.demonPlayerId,
    fellowMinionPlayerIds: facts.minionPlayerIds.filter(
      minionPlayerId => minionPlayerId !== playerId,
    ),
  };
}

export function createBotcDemonInfoView(
  info:
    | {
        minionPlayerIds: readonly string[];
        bluffRoleIds: readonly TroubleBrewingRoleId[];
      }
    | undefined,
): BotcDemonInfoView | undefined {
  if (!info) return undefined;
  return {
    minionPlayerIds: [...info.minionPlayerIds],
    bluffRoles: info.bluffRoleIds.map(roleView),
  };
}

function playerMetadata(
  context: GameViewContext,
  playerId: string,
): { name: string; seat: number } {
  const player = context.players.find(item => item.id === playerId);
  if (!player) {
    throw new Error("BotC private view references a player missing from view context");
  }
  return { name: player.name, seat: player.seat };
}

function spyGrimoirePrivateView(
  result: Extract<TroubleBrewingNightInformationResult, { kind: "spy_grimoire" }>,
  context: GameViewContext,
): BotcPrivateInformationView {
  return {
    kind: "spy_grimoire",
    abilityRoleId: "spy",
    players: result.players.map(player => ({
      playerId: player.playerId,
      ...playerMetadata(context, player.playerId),
      actualRole: roleView(player.actualRoleId),
      shownRole: roleView(player.shownRoleId),
      alive: player.alive,
    })),
    reminders: {
      ...(result.reminders.drunkPlayerId
        ? { drunkPlayerId: result.reminders.drunkPlayerId }
        : {}),
      ...(result.reminders.poisonedPlayerId
        ? { poisonedPlayerId: result.reminders.poisonedPlayerId }
        : {}),
      ...(result.reminders.butlerMasterPlayerId
        ? { butlerMasterPlayerId: result.reminders.butlerMasterPlayerId }
        : {}),
      ...(result.reminders.redHerringPlayerId
        ? { redHerringPlayerId: result.reminders.redHerringPlayerId }
        : {}),
      pairInformation: result.reminders.pairInformation.map(reminder =>
        reminder.kind === "pair"
          ? {
              ...reminder,
              abilityRole: roleView(reminder.abilityRoleId),
              shownPlayerIds: [...reminder.shownPlayerIds] as [string, string],
              learnedRole: roleView(reminder.learnedRoleId),
            }
          : {
              ...reminder,
              abilityRole: roleView(reminder.abilityRoleId),
            },
      ),
    },
  };
}

export function createBotcPrivateInformationView(
  result: TroubleBrewingNightInformationResult,
  context: GameViewContext,
): BotcPrivateInformationView {
  if (result.kind === "no_characters") {
    return {
      kind: "no_characters",
      abilityRoleId: result.abilityRoleId,
      noCharacterCategory: result.noCharacterCategory,
    };
  }
  if (result.kind === "number") {
    return {
      kind: "number",
      abilityRoleId: result.abilityRoleId,
      value: result.value,
    };
  }
  if (result.kind === "boolean") {
    return {
      kind: "boolean",
      abilityRoleId: result.abilityRoleId,
      value: result.value,
    };
  }
  if (result.kind === "spy_grimoire") {
    return spyGrimoirePrivateView(result, context);
  }

  return {
    kind: "pair",
    abilityRoleId: result.abilityRoleId,
    learnedRole: roleView(result.learnedRoleId),
    shownPlayerIds: [...result.shownPlayerIds] as [string, string],
  };
}
