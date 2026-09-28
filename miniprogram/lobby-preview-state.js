const PREVIEW_GAMES = [
  { id: "werewolf", label: "狼人杀", moderatorLabel: "法官" },
  { id: "botc", label: "血染钟楼", moderatorLabel: "说书人" },
];

function createPreviewLobby(roomCode) {
  const participants = [
    { id: "p1", name: "Jazz", isOwner: true, ready: true, connected: true },
    { id: "p2", name: "Alex", isOwner: false, ready: true, connected: true },
    { id: "p3", name: "Ming", isOwner: false, ready: false, connected: true },
    { id: "p4", name: "Amy", isOwner: false, ready: false, connected: true },
    { id: "p5", name: "Tom", isOwner: false, ready: false, connected: true },
    { id: "p6", name: "Leo", isOwner: false, ready: true, connected: true },
    { id: "p7", name: "Ben", isOwner: false, ready: true, connected: true },
    { id: "p8", name: "Rae", isOwner: false, ready: false, connected: true },
  ];

  return {
    roomCode: String(roomCode || "6284"),
    ownerId: "p1",
    currentPlayerId: "p1",
    participants,
    playerOrder: participants.map(participant => participant.id),
    selectedGame: "botc",
    moderatorAssignment: { type: "automatic" },
  };
}

module.exports = {
  PREVIEW_GAMES,
  createPreviewLobby,
};
