type UnknownRecord = Record<string, unknown>;

export type BotcGamePresentationInput = {
  room: unknown;
  playerView: unknown;
  connectionStatus?: unknown;
  error?: unknown;
  selectedNightChoiceIds?: readonly string[];
  selectedRedHerringPlayerId?: string;
};

export type BotcNightChoiceOption = {
  id: string;
  name: string;
  selected: boolean;
};

export type BotcSpyGrimoireRow = {
  playerId: string;
  seat: number;
  name: string;
  roleName: string;
  shownRoleName: string;
  alive: boolean;
};

export type BotcGamePresentation = {
  phase: string;
  phaseLabel: string;
  connectionStatus: string;
  connectionLine: string;
  roleName: string;
  roleCategory: string;
  roleConfirmed: boolean;
  isSpectator: boolean;
  isNightWake: boolean;
  isNightWaiting: boolean;
  isDay: boolean;
  dayNominationOptions: BotcNightChoiceOption[];
  dayNominationId: string;
  dayNominatorName: string;
  dayNomineeName: string;
  dayYesVoterNames: string;
  dayVoteCount: number;
  dayVoteThreshold: number;
  dayHighVoteCount: number;
  dayBlockNomineeName: string;
  dayTiedAtHigh: boolean;
  myDayVoteYes: boolean;
  ghostVoteSpent: boolean;
  nightStepId: string;
  nightChoiceKey: string;
  nightChoiceOptions: BotcNightChoiceOption[];
  nightChoiceMinTargets: number;
  nightChoiceMaxTargets: number;
  nightChoiceSelectedCount: number;
  redHerringKey: string;
  redHerringOptions: BotcNightChoiceOption[];
  redHerringSelectedPlayerId: string;
  moderatorStepId: string;
  moderatorActorNames: string;
  minionDemonName: string;
  fellowMinionNames: string;
  demonMinionNames: string;
  demonBluffNames: string;
  privateInformationRoleName: string;
  privateInformationPlayerNames: string;
  privateInformationZeroLabel: string;
  privateInformationNumber: number | null;
  hasPrivateInformationNumber: boolean;
  privateInformationBooleanLabel: string;
  spyGrimoireRows: BotcSpyGrimoireRow[];
  spyGrimoireReminderLines: string[];
  confirmedRoles: number;
  playerCount: number;
  allConfirmed: boolean;
  statusLine: string;
  canConfirmRole: boolean;
  canSetRedHerring: boolean;
  canBeginFirstNight: boolean;
  canBeginOtherNight: boolean;
  canNominate: boolean;
  canSubmitDayVoteYes: boolean;
  canSubmitDayVoteNo: boolean;
  canCloseNomination: boolean;
  canCommitNightInformation: boolean;
  canAcknowledgeNightInformation: boolean;
  canCompleteNightStep: boolean;
  canSubmitNightChoice: boolean;
};

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function asFiniteNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function asRecordArray(value: unknown): UnknownRecord[] {
  return Array.isArray(value)
    ? value.map(asRecord).filter((item): item is UnknownRecord => item !== null)
    : [];
}

function roomPlayers(room: UnknownRecord | null): UnknownRecord[] {
  return room && Array.isArray(room.players)
    ? room.players.map(asRecord).filter((item): item is UnknownRecord => item !== null)
    : [];
}

function playerName(room: UnknownRecord | null, playerId: string): string {
  const player = roomPlayers(room).find(item => asString(item.id) === playerId);
  return player ? asString(player.name) || playerId : playerId;
}

function phaseLabel(phase: string): string {
  switch (phase) {
    case "role_reveal":
      return "身份确认";
    case "first_night":
      return "首夜";
    case "other_night":
      return "夜晚";
    case "day":
      return "白天";
    default:
      return "游戏";
  }
}

function connectionStatusLine(connectionStatus: string, error: string): string {
  if (error.trim()) return error.trim();
  switch (connectionStatus) {
    case "Connecting":
    case "Syncing":
      return "正在同步游戏状态…";
    case "Reconnecting":
      return "正在恢复连接并重新同步…";
    case "Disconnected":
      return "连接已断开，回到前台后会自动恢复。";
    case "Failed":
      return "连接失败，请返回后重试。";
    default:
      return "";
  }
}

function canControlGame(room: UnknownRecord | null): boolean {
  const viewer = asRecord(room?.viewer);
  if (!viewer) return false;
  const assignment = asRecord(room?.gameModerator);
  if (asString(assignment?.mode) === "human") {
    return Boolean(viewer.isGameModerator);
  }
  return Boolean(viewer.isHost);
}

function statusForView(
  playerView: UnknownRecord | null,
  allConfirmed: boolean,
  controller: boolean,
): string {
  if (!playerView) return "等待 authoritative PlayerView。";

  const phase = asString(playerView.phase);
  const mode = asString(playerView.mode);
  if (phase === "role_reveal") {
    if (mode === "spectator") {
      return allConfirmed
        ? "所有玩家已确认身份，可以开始首夜。"
        : "你是说书人；等待所有玩家确认自己的身份。";
    }
    if (Boolean(playerView.roleConfirmed) || mode === "waiting") {
      return allConfirmed
        ? "所有玩家已确认身份，等待进入首夜。"
        : "你已确认身份；请等待其他玩家。";
    }
    return "请记住自己的身份，然后点击确认。";
  }

  if (phase === "first_night" || phase === "other_night") {
    if (mode === "night_wake") {
      return asRecord(playerView.privateInformation)
        ? "请查看你的私密信息，确认记住后继续。"
        : "请睁眼，查看当前夜间信息或按说书人指示行动。";
    }
    if (mode === "spectator") {
      return controller
        ? "请主持当前夜间步骤；确认处理完成后推进下一步。"
        : "夜间进行中。";
    }
    return controller
      ? "夜间进行中；处理当前步骤后推进。"
      : "请闭眼等待，被唤醒时手机会提示。";
  }

  if (phase === "day") {
    return controller
      ? "天亮了。完成白天流程后可进入下一夜。"
      : "天亮了。等待白天流程。";
  }

  return "等待 authoritative PlayerView。";
}

function roleDisplayName(role: UnknownRecord | null): string {
  return role
    ? asString(role.nameZh) || asString(role.name) || asString(role.id)
    : "";
}

function spyGrimoirePresentation(privateInformation: UnknownRecord | null): {
  rows: BotcSpyGrimoireRow[];
  reminderLines: string[];
} {
  if (asString(privateInformation?.kind) !== "spy_grimoire") {
    return { rows: [], reminderLines: [] };
  }

  const playerRecords = asRecordArray(privateInformation?.players);
  const rows = playerRecords.map(player => {
    const actualRoleName = roleDisplayName(asRecord(player.actualRole));
    const shownRoleName = roleDisplayName(asRecord(player.shownRole));
    return {
      playerId: asString(player.playerId),
      seat: asNumber(player.seat),
      name: asString(player.name) || asString(player.playerId),
      roleName: actualRoleName,
      shownRoleName:
        shownRoleName && shownRoleName !== actualRoleName ? shownRoleName : "",
      alive: player.alive !== false,
    };
  });
  const nameByPlayerId = new Map(rows.map(row => [row.playerId, row.name] as const));
  const nameFor = (playerId: string): string =>
    nameByPlayerId.get(playerId) || playerId;

  const reminderLines: string[] = [];
  const reminders = asRecord(privateInformation?.reminders);
  const simpleReminders: Array<[string, string]> = [
    ["drunkPlayerId", "酒鬼"],
    ["poisonedPlayerId", "中毒"],
    ["butlerMasterPlayerId", "管家主人"],
    ["redHerringPlayerId", "红鲱鱼"],
  ];
  for (const [key, label] of simpleReminders) {
    const playerId = asString(reminders?.[key]);
    if (playerId) reminderLines.push(`${label}：${nameFor(playerId)}`);
  }

  for (const reminder of asRecordArray(reminders?.pairInformation)) {
    const abilityRoleName =
      roleDisplayName(asRecord(reminder.abilityRole)) ||
      asString(reminder.abilityRoleId);
    const recipientName = nameFor(asString(reminder.recipientPlayerId));
    if (asString(reminder.kind) === "pair") {
      const shownNames = asStringArray(reminder.shownPlayerIds)
        .map(nameFor)
        .join("、");
      const learnedRoleName = roleDisplayName(asRecord(reminder.learnedRole));
      reminderLines.push(
        `${abilityRoleName}（${recipientName}）：${shownNames} 中有 1 人是 ${learnedRoleName}`,
      );
    } else if (
      asString(reminder.kind) === "no_characters" &&
      asString(reminder.noCharacterCategory) === "outsider"
    ) {
      reminderLines.push(`${abilityRoleName}（${recipientName}）：本局没有外来者`);
    }
  }

  return { rows, reminderLines };
}

export function createBotcGamePresentation(
  input: BotcGamePresentationInput,
): BotcGamePresentation {
  const room = asRecord(input.room);
  const playerView = asRecord(input.playerView);
  const game = asRecord(room?.game);
  const confirmedRoles = asNumber(game?.confirmedRoles);
  const playerCount = asNumber(game?.playerCount);
  const allConfirmed = playerCount > 0 && confirmedRoles >= playerCount;
  const controller = canControlGame(room);
  const phase =
    asString(playerView?.phase) ||
    asString(game?.phase);
  const mode = asString(playerView?.mode);
  const isSpectator = mode === "spectator";
  const roleConfirmed = Boolean(playerView?.roleConfirmed);
  const viewer = asRecord(room?.viewer);
  const currentPlayerId = asString(viewer?.playerId);
  const moderator = asRecord(room?.gameModerator);
  const humanModeratorPlayerId =
    asString(moderator?.mode) === "human" ? asString(moderator?.playerId) : "";
  const participantPlayerIds = roomPlayers(room)
    .map(player => asString(player.id))
    .filter(playerId => playerId && playerId !== humanModeratorPlayerId);

  const dayVoting = asRecord(game?.dayVoting);
  const activeNomination = asRecord(dayVoting?.activeNomination);
  const usedNominatorPlayerIds = asStringArray(dayVoting?.usedNominatorPlayerIds);
  const usedNomineePlayerIds = asStringArray(dayVoting?.usedNomineePlayerIds);
  const spentGhostVotePlayerIds = asStringArray(dayVoting?.spentGhostVotePlayerIds);
  const deadPlayerIds = asStringArray(game?.deadPlayerIds);
  const dayYesVoterPlayerIds = asStringArray(activeNomination?.yesVoterPlayerIds);
  const dayNominationId = asString(activeNomination?.id);
  const dayNominatorPlayerId = asString(activeNomination?.nominatorPlayerId);
  const dayNomineePlayerId = asString(activeNomination?.nomineePlayerId);
  const isDay = phase === "day";
  const currentPlayerIsParticipant = participantPlayerIds.includes(currentPlayerId);
  const currentPlayerDead = deadPlayerIds.includes(currentPlayerId);
  const ghostVoteSpent = spentGhostVotePlayerIds.includes(currentPlayerId);
  const myDayVoteYes = dayYesVoterPlayerIds.includes(currentPlayerId);
  const dayBlockNomineePlayerId = asString(dayVoting?.blockNomineePlayerId);
  const canNominate =
    isDay &&
    dayVoting !== null &&
    !dayNominationId &&
    currentPlayerIsParticipant &&
    !currentPlayerDead &&
    !usedNominatorPlayerIds.includes(currentPlayerId);
  const dayNominationOptions = canNominate
    ? participantPlayerIds
        .filter(playerId => !usedNomineePlayerIds.includes(playerId))
        .map(playerId => ({
          id: playerId,
          name: playerName(room, playerId),
          selected: false,
        }))
    : [];

  const informationDecision = asRecord(game?.informationDecision);
  const nightStep = asRecord(playerView?.nightStep);
  const nightChoice = asRecord(nightStep?.choice);
  const allowedPlayerIds = asStringArray(nightChoice?.allowedPlayerIds);
  const selectedNightChoiceIds = (input.selectedNightChoiceIds ?? [])
    .filter(playerId => allowedPlayerIds.includes(playerId));
  const minTargets = asNumber(nightChoice?.minTargets);
  const maxTargets = asNumber(nightChoice?.maxTargets);
  const nightStepId = asString(nightStep?.id);
  const nightChoiceKey = allowedPlayerIds.length > 0
    ? nightStepId + ":" + allowedPlayerIds.join(",")
    : "";
  const nightChoiceOptions = allowedPlayerIds.map(playerId => ({
    id: playerId,
    name: playerName(room, playerId),
    selected: selectedNightChoiceIds.includes(playerId),
  }));

  const redHerringDecision = asRecord(game?.redHerringDecision);
  const redHerringPlayerIds = asStringArray(redHerringDecision?.candidatePlayerIds);
  const committedRedHerringPlayerId = asString(redHerringDecision?.selectedPlayerId);
  const requestedRedHerringPlayerId = asString(input.selectedRedHerringPlayerId);
  const redHerringSelectedPlayerId = redHerringPlayerIds.includes(
    requestedRedHerringPlayerId,
  )
    ? requestedRedHerringPlayerId
    : redHerringPlayerIds.includes(committedRedHerringPlayerId)
      ? committedRedHerringPlayerId
      : "";
  const redHerringKey = redHerringPlayerIds.length > 0
    ? redHerringPlayerIds.join(",") + ":" + committedRedHerringPlayerId
    : "";
  const redHerringOptions = redHerringPlayerIds.map(playerId => ({
    id: playerId,
    name: playerName(room, playerId),
    selected: playerId === redHerringSelectedPlayerId,
  }));

  const moderatorStep = asRecord(game?.nightStep);
  const moderatorActorNames = asStringArray(moderatorStep?.actorPlayerIds)
    .map(playerId => playerName(room, playerId))
    .join("、");

  const minionInfo = asRecord(playerView?.minionInfo);
  const demonInfo = asRecord(playerView?.demonInfo);
  const privateInformation = asRecord(playerView?.privateInformation);
  const learnedRole = asRecord(privateInformation?.learnedRole);
  const spyGrimoire = spyGrimoirePresentation(privateInformation);

  const connectionStatus = asString(input.connectionStatus);
  const connectionLine = connectionStatusLine(
    connectionStatus,
    asString(input.error),
  );

  const isNightWake = mode === "night_wake";
  const isNightWaiting =
    (phase === "first_night" || phase === "other_night") &&
    mode === "waiting";

  return {
    phase,
    phaseLabel: phaseLabel(phase),
    connectionStatus,
    connectionLine,
    roleName:
      asString(playerView?.roleNameZh) ||
      asString(playerView?.roleName),
    roleCategory: asString(playerView?.roleCategory),
    roleConfirmed,
    isSpectator,
    isNightWake,
    isNightWaiting,
    isDay,
    dayNominationOptions,
    dayNominationId,
    dayNominatorName: playerName(room, dayNominatorPlayerId),
    dayNomineeName: playerName(room, dayNomineePlayerId),
    dayYesVoterNames: dayYesVoterPlayerIds
      .map(playerId => playerName(room, playerId))
      .join("、"),
    dayVoteCount: dayYesVoterPlayerIds.length,
    dayVoteThreshold: asNumber(dayVoting?.threshold),
    dayHighVoteCount: asNumber(dayVoting?.highVoteCount),
    dayBlockNomineeName: playerName(room, dayBlockNomineePlayerId),
    dayTiedAtHigh: Boolean(dayVoting?.tiedAtHigh),
    myDayVoteYes,
    ghostVoteSpent,
    nightStepId,
    nightChoiceKey,
    nightChoiceOptions,
    nightChoiceMinTargets: minTargets,
    nightChoiceMaxTargets: maxTargets,
    nightChoiceSelectedCount: selectedNightChoiceIds.length,
    redHerringKey,
    redHerringOptions,
    redHerringSelectedPlayerId,
    moderatorStepId: asString(moderatorStep?.id),
    moderatorActorNames,
    minionDemonName: playerName(room, asString(minionInfo?.demonPlayerId)),
    fellowMinionNames: asStringArray(minionInfo?.fellowMinionPlayerIds)
      .map(playerId => playerName(room, playerId))
      .join("、"),
    demonMinionNames: asStringArray(demonInfo?.minionPlayerIds)
      .map(playerId => playerName(room, playerId))
      .join("、"),
    demonBluffNames: Array.isArray(demonInfo?.bluffRoles)
      ? demonInfo.bluffRoles
          .map(asRecord)
          .filter((role): role is UnknownRecord => role !== null)
          .map(roleDisplayName)
          .filter(Boolean)
          .join("、")
      : "",
    privateInformationRoleName: roleDisplayName(learnedRole),
    privateInformationPlayerNames: asStringArray(privateInformation?.shownPlayerIds)
      .map(playerId => playerName(room, playerId))
      .join("、"),
    privateInformationZeroLabel:
      asString(privateInformation?.kind) === "no_characters" &&
      asString(privateInformation?.noCharacterCategory) === "outsider"
        ? "本局没有外来者"
        : "",
    privateInformationNumber:
      asString(privateInformation?.kind) === "number"
        ? asFiniteNumberOrNull(privateInformation?.value)
        : null,
    hasPrivateInformationNumber:
      asString(privateInformation?.kind) === "number" &&
      asFiniteNumberOrNull(privateInformation?.value) !== null,
    privateInformationBooleanLabel:
      asString(privateInformation?.kind) === "boolean"
        ? privateInformation?.value === true
          ? "是"
          : privateInformation?.value === false
            ? "否"
            : ""
        : "",
    spyGrimoireRows: spyGrimoire.rows,
    spyGrimoireReminderLines: spyGrimoire.reminderLines,
    confirmedRoles,
    playerCount,
    allConfirmed,
    statusLine:
      connectionLine ||
      (isDay && dayNominationId
        ? `${playerName(room, dayNominatorPlayerId)} 提名 ${playerName(room, dayNomineePlayerId)}；当前 ${dayYesVoterPlayerIds.length} 票。`
        : statusForView(playerView, allConfirmed, controller)),
    canConfirmRole:
      phase === "role_reveal" &&
      mode === "role_reveal" &&
      !roleConfirmed,
    canSetRedHerring:
      controller &&
      phase === "role_reveal" &&
      redHerringDecision !== null &&
      Boolean(redHerringSelectedPlayerId),
    canBeginFirstNight:
      controller &&
      phase === "role_reveal" &&
      allConfirmed &&
      (redHerringDecision === null || Boolean(committedRedHerringPlayerId)),
    canBeginOtherNight:
      controller &&
      isDay &&
      !dayNominationId &&
      !dayBlockNomineePlayerId,
    canNominate,
    canSubmitDayVoteYes:
      isDay &&
      Boolean(dayNominationId) &&
      currentPlayerIsParticipant &&
      (!currentPlayerDead || !ghostVoteSpent),
    canSubmitDayVoteNo:
      isDay &&
      Boolean(dayNominationId) &&
      currentPlayerIsParticipant,
    canCloseNomination: controller && isDay && Boolean(dayNominationId),
    canCommitNightInformation:
      controller &&
      informationDecision !== null &&
      !Boolean(informationDecision.committed),
    canAcknowledgeNightInformation: privateInformation !== null,
    canCompleteNightStep:
      controller &&
      informationDecision === null &&
      (phase === "first_night" || phase === "other_night"),
    canSubmitNightChoice:
      allowedPlayerIds.length > 0 &&
      selectedNightChoiceIds.length >= minTargets &&
      selectedNightChoiceIds.length <= maxTargets,
  };
}
