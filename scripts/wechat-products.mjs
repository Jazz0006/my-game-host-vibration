export const WECHAT_PRODUCTS = [
  {
    id: "werewolf",
    gameType: "werewolf",
    appName: "骏骏桌游-狼人",
    gameLabel: "狼人杀",
    moderatorLabel: "法官",
    projectName: "junjun-boardgame-werewolf",
    startCommand: "werewolf.startGame",
  },
  {
    id: "botc",
    gameType: "botc",
    appName: "骏骏桌游-血染",
    gameLabel: "血染钟楼",
    moderatorLabel: "说书人",
    projectName: "junjun-boardgame-botc",
    startCommand: "botc.startGame",
    confirmRoleCommand: "botc.confirmRole",
    beginFirstNightCommand: "botc.beginFirstNight",
    completeNightStepCommand: "botc.completeNightStep",
    gamePage: "/pages/game",
  },
];

export function wechatProductById(id) {
  const product = WECHAT_PRODUCTS.find(item => item.id === id);
  if (!product) throw new Error(`Unknown WeChat product: ${id}`);
  return product;
}
