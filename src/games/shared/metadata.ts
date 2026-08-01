export type GameKind = "werewolf" | "doudizhu" | "clocktower";

export type GameAvailability = "available" | "development" | "coming_soon";

export type GameMetadata = {
  kind: GameKind;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  availability: GameAvailability;
  statusLabel?: string;
};

export const GAME_METADATA: readonly GameMetadata[] = [
  {
    kind: "werewolf",
    name: "狼人杀",
    description: "无须法官的线下狼人杀流程助手",
    minPlayers: 5,
    maxPlayers: 12,
    availability: "available",
  },
  {
    kind: "doudizhu",
    name: "斗地主",
    description: "标准三人斗地主",
    minPlayers: 3,
    maxPlayers: 3,
    availability: "available",
    statusLabel: "测试版",
  },
  {
    kind: "clocktower",
    name: "血染钟楼",
    description: "带自动说书人的暗流涌动",
    minPlayers: 7,
    maxPlayers: 12,
    availability: "coming_soon",
  },
];

export function isGameKind(value: unknown): value is GameKind {
  return GAME_METADATA.some(game => game.kind === value);
}
