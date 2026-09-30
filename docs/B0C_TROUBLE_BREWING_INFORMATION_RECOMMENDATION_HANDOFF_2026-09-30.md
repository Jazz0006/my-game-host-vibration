# B0C Trouble Brewing Rules / Information → Recommendation Handoff — 2026-09-30

## Canonical checkpoint

B0C1 implementation branch:

```text
agent/b0c1-botc-demon-info-boundary
```

Fresh live `main` at B0C1 entry:

```text
76bf10f624470d5393b499916b605d447852e719
```

B0A–B0B3 are complete. B0C is now the active BotC production-expansion milestone.

Standing merge authorization remains active: accepted-scope PRs may be merged automatically once exact-head, required checks, mergeability, unresolved-thread, and final-diff gates pass.

## Why B0C starts with Demon Info

The first B0C decision point is standard 7+ player Demon Info rather than Chef / Empath / Washerwoman / Librarian / Investigator.

Reason:

- official Demon Info has a real choice surface: the Demon learns the Minions and receives three good characters that are not in play as bluffs;
- Rules / Information can determine the entire legal candidate set from canonical setup truth;
- Storyteller Recommendation can later choose which three are strategically best without redefining legality;
- this first slice does not yet require Spy / Recluse registration, poisoning, drunken information malfunction, or numeric-neighbor semantics;
- it therefore exercises the desired ownership boundary with minimal rules ambiguity.

Official reference:

```text
https://wiki.bloodontheclocktower.com/Glossary
```

The official glossary states that standard Demon Info occurs on the first night for games with 7 or more players: the Demon learns the Minions and three good characters that are not in play.

## B0C ownership contract applied to Demon Info

```text
Canonical Setup / Truth
        ↓
TroubleBrewingInformation
  -> Demon player
  -> Minion players
  -> every rules-legal not-in-play good bluff candidate
        ↓
DemonBluffRecommendationRequest
  required:
    -> legalBluffRoleIds
    -> bluffCount = 3
  optional/enrichment:
    -> shownDrunkRoleId (current concrete example)
        ↓
Storyteller Recommendation policy
  -> NOT implemented in B0C1
        ↓
validated 3-role recommendation
        ↓
Game Engine authoritative commit
  -> NOT implemented in B0C1
```

The Recommendation owner is not allowed to invent extra legal candidates. Its returned result must be exactly three unique roles from the Rules / Information candidate set.

## Drunk shown-role boundary

The canonical setup distinguishes:

```text
actualRoleId = drunk
shownRoleId = some Townsfolk
```

For rules legality:

- `drunk` is actually in play;
- the Townsfolk identity shown to the Drunk is not the player's actual character and is therefore still a not-in-play character unless another player actually has it;
- consequently the shown Townsfolk remains in the Rules / Information legal bluff set.

Whether a recommendation should avoid that legal role to prevent an awkward claim collision is a recommendation-quality concern. B0C1 exposes `shownDrunkRoleId` only as optional enrichment and does not mutate the legal set.

This is an intentional example of the architecture rule:

```text
rules legality != recommendation quality
```

## B0C1 implemented scope

Production:

```text
src/games/botc/TroubleBrewingInformation.ts
src/games/botc/TroubleBrewingRecommendation.ts
```

Tests:

```text
tests/botcDemonInfoBoundary.test.ts
```

B0C1 provides:

- authoritative standard Demon Info fact derivation for 7+ player Trouble Brewing;
- exact Demon player derivation from canonical actual role;
- Minion player derivation from canonical actual roles;
- legal bluff candidates = Townsfolk / Outsiders whose actual character is not in play;
- explicit rejection of standard Demon Info below 7 players;
- a concrete `demon_bluffs` recommendation request contract;
- required context containing the immutable legal candidate set and `bluffCount = 3`;
- optional enrichment currently supporting the Drunk shown Townsfolk;
- validation that any recommendation returns exactly three unique roles from the legal candidate set.

B0C1 intentionally does **not** implement:

- bluff quality scoring/ranking;
- automatic selection of the three bluffs;
- human storyteller selection UI;
- Game Engine commit of the chosen bluffs;
- Demon PlayerView delivery;
- Spy / Recluse registration;
- poison / drunk false-information behavior;
- a generic BotC rules or recommendation DSL.

## Validation

```text
npm run typecheck
  PASS

npm test
  PASS
  129 test files
  528 tests

pretest
  Web client build PASS
  both WeChat product-shell build / verification PASS
```

## Next after B0C1 merge

B0C2 should complete the Demon Info vertical slice without collapsing the owners:

1. define the first concrete Storyteller Recommendation policy for choosing three legal Demon bluffs;
2. keep its input limited to the B0C1 request contract plus explicit optional/enrichment context;
3. validate the recommendation through the B0C1 legality guard;
4. let `BotcGameModule` commit the accepted bluff choice into canonical session state;
5. expose Minion identities + selected three bluff roles only to the Demon during the `demon_info` step and to the authoritative ModeratorView;
6. keep PublicView and non-Demon PlayerViews secret-safe;
7. do not yet expand into Washerwoman/Librarian/Investigator registration or poison/drunk misinformation.
