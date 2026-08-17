import type { WerewolfScriptDefinition } from "./ScriptDefinition.js";

export const CLASSIC_WEREWOLF_SCRIPTS: readonly WerewolfScriptDefinition[] = [
  {
    id: "classic-5",
    name: "经典5人局",
    roleDeck: ["werewolf", "seer", "witch", "villager", "villager"],
  },
  {
    id: "classic-8",
    name: "经典8人局",
    roleDeck: ["werewolf", "werewolf", "seer", "witch", "guard", "villager", "villager", "villager"],
  },
  {
    id: "classic-10",
    name: "经典10人局",
    roleDeck: ["werewolf", "werewolf", "werewolf", "seer", "witch", "guard", "hunter", "villager", "villager", "villager"],
  },
];

export function getClassicWerewolfScript(id: string): WerewolfScriptDefinition | undefined {
  return CLASSIC_WEREWOLF_SCRIPTS.find(script => script.id === id);
}
