import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { createBotcGamePresentation } from "../src/client/BotcGamePresentation.js";

function room(overrides: Record<string, unknown> = {}) {
  return {
    roomId: "1234",
    gameStarted: true,
    viewer: {
      playerId: "p1",
      isHost: true,
      isGameModerator: false,
    },
    gameModerator: { mode: "automatic" },
    players: [
      { id: "p1", name: "Alice", seat: 1 },
      { id: "p2", name: "Bob", seat: 2 },
      { id: "p3", name: "Carol", seat: 3 },
    ],
    game: {
      phase: "role_reveal",
      playerCount: 3,
      confirmedRoles: 2,
    },
    ...overrides,
  };
}

describe("PV-UI0 BotC shared game presentation", () => {
  it("projects role reveal semantics for both WeChat and Simulator renderers", () => {
    const presentation = createBotcGamePresentation({
      room: room(),
      playerView: {
        phase: "role_reveal",
        mode: "role_reveal",
        roleNameZh: "厨师",
        roleCategory: "townsfolk",
        roleConfirmed: false,
      },
      connectionStatus: "Connected",
    });

    expect(presentation).toMatchObject({
      phaseLabel: "身份确认",
      roleName: "厨师",
      roleCategory: "townsfolk",
      confirmedRoles: 2,
      playerCount: 3,
      allConfirmed: false,
      canConfirmRole: true,
      canBeginFirstNight: false,
      statusLine: "请记住自己的身份，然后点击确认。",
    });
  });

  it("projects pair information, zero-Outsider information, and player names without rule-specific UI branches", () => {
    const pair = createBotcGamePresentation({
      room: room({
        game: {
          phase: "first_night",
          playerCount: 3,
          confirmedRoles: 3,
          informationDecision: { committed: true },
        },
      }),
      playerView: {
        phase: "first_night",
        mode: "night_wake",
        roleNameZh: "调查员",
        nightStep: { id: "investigator", kind: "information" },
        privateInformation: {
          kind: "pair",
          learnedRole: { id: "scarlet_woman", nameZh: "猩红女巫" },
          shownPlayerIds: ["p2", "p3"],
        },
      },
      connectionStatus: "Connected",
    });

    expect(pair).toMatchObject({
      phaseLabel: "首夜",
      isNightWake: true,
      nightStepId: "investigator",
      privateInformationRoleName: "猩红女巫",
      privateInformationPlayerNames: "Bob、Carol",
      privateInformationZeroLabel: "",
      canAcknowledgeNightInformation: true,
      statusLine: "请查看你的私密信息，确认记住后继续。",
    });

    const zero = createBotcGamePresentation({
      room: room({
        game: {
          phase: "first_night",
          playerCount: 3,
          confirmedRoles: 3,
          informationDecision: { committed: true },
        },
      }),
      playerView: {
        phase: "first_night",
        mode: "night_wake",
        roleNameZh: "图书管理员",
        nightStep: { id: "librarian", kind: "information" },
        privateInformation: {
          kind: "no_characters",
          noCharacterCategory: "outsider",
        },
      },
    });

    expect(zero.privateInformationRoleName).toBe("");
    expect(zero.privateInformationZeroLabel).toBe("本局没有外来者");
    expect(zero.hasPrivateInformationNumber).toBe(false);

    const numericZero = createBotcGamePresentation({
      room: room({
        game: {
          phase: "first_night",
          playerCount: 3,
          confirmedRoles: 3,
          informationDecision: { committed: true },
        },
      }),
      playerView: {
        phase: "first_night",
        mode: "night_wake",
        roleNameZh: "厨师",
        nightStep: { id: "role:chef", kind: "role", roleId: "chef" },
        privateInformation: {
          kind: "number",
          abilityRoleId: "chef",
          value: 0,
        },
      },
    });

    expect(numericZero).toMatchObject({
      privateInformationRoleName: "",
      privateInformationPlayerNames: "",
      privateInformationZeroLabel: "",
      privateInformationNumber: 0,
      hasPrivateInformationNumber: true,
      canAcknowledgeNightInformation: true,
    });
  });

  it("projects target selection and controller actions from authoritative views", () => {
    const selection = createBotcGamePresentation({
      room: room({
        game: {
          phase: "first_night",
          playerCount: 3,
          confirmedRoles: 3,
        },
      }),
      playerView: {
        phase: "first_night",
        mode: "night_wake",
        nightStep: {
          id: "poisoner",
          choice: {
            minTargets: 1,
            maxTargets: 1,
            allowedPlayerIds: ["p2", "p3"],
          },
        },
      },
      selectedNightChoiceIds: ["p3"],
    });

    expect(selection.nightChoiceOptions).toEqual([
      { id: "p2", name: "Bob", selected: false },
      { id: "p3", name: "Carol", selected: true },
    ]);
    expect(selection.canSubmitNightChoice).toBe(true);

    const storyteller = createBotcGamePresentation({
      room: {
        ...room(),
        viewer: {
          playerId: "p1",
          isHost: false,
          isGameModerator: true,
        },
        gameModerator: { mode: "human", playerId: "p1" },
        game: {
          phase: "first_night",
          playerCount: 2,
          confirmedRoles: 2,
          nightStep: {
            id: "washerwoman",
            actorPlayerIds: ["p2"],
          },
          informationDecision: { committed: false },
        },
      },
      playerView: {
        phase: "first_night",
        mode: "spectator",
      },
    });

    expect(storyteller).toMatchObject({
      isSpectator: true,
      moderatorStepId: "washerwoman",
      moderatorActorNames: "Bob",
      canCommitNightInformation: true,
      canCompleteNightStep: false,
    });
  });

  it("keeps the Simulator phone viewer on the same shared presentation owner as WeChat", () => {
    const lab = fs.readFileSync("dev/labV2.js", "utf8");
    const wechat = fs.readFileSync("miniprogram/pages/game.js", "utf8");

    expect(lab).toContain("createBotcGamePresentation");
    expect(lab).toContain("/client-runtime/client/BotcGamePresentation.js");
    expect(wechat).toContain("createBotcGamePresentation");
    expect(wechat).toContain("../runtime/client/BotcGamePresentation.js");
    expect(lab).toContain("我知道自己的身份了");
    expect(lab).toContain("我记住这条信息了");
    expect(lab).toContain("privateInformationNumber");
    expect(wechat).toContain("privateInformationNumber");
  });
});
