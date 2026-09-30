# B0C Trouble Brewing Rules / Information → Recommendation Handoff — 2026-09-30

## Canonical checkpoint

B0C2 implementation branch:

```text
agent/b0c2-botc-demon-info-runtime
```

Fresh live `main` at B0C2 entry:

```text
f07a7549c89150c0e9af596d767455a798737ab7
```

B0A–B0B3 are complete. B0C is the active BotC production-expansion milestone. B0C1 merged through PR #109.

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

## B0C2 implemented scope

B0C2 completes the first Demon Info vertical slice while preserving the B0C1 owner boundary.

Recommendation:

- `recommendDemonBluffsBaselineV1` is an independent automatic Storyteller policy;
- it accepts only the B0C1 recommendation request plus injected randomness;
- if at least three alternatives exist, it avoids the Townsfolk role currently shown to the Drunk;
- otherwise it samples three distinct roles from the full rules-legal set;
- it always returns through the B0C1 legality validator;
- richer narrative / player-level / history scoring is intentionally deferred.

Game Engine / canonical state:

- moderator-only `setDemonBluffs` allows a human Storyteller to commit any legal three-role choice before the first night;
- a human choice is preserved and is not overwritten by automatic recommendation;
- if no manual choice exists, `beginFirstNight` invokes baseline V1 and commits the accepted result;
- canonical `demonInfo` stores the Demon player, Minion player IDs, accepted bluff roles and selection source;
- the Recommendation owner never writes state directly.

Privacy / delivery:

- during the active `demon_info` first-night step, only the canonical Demon PlayerView receives Minion IDs + the three committed bluff roles;
- non-Demon PlayerViews do not receive Demon Info;
- PublicView never receives Demon Info;
- authoritative ModeratorView may inspect the committed Demon Info;
- the Demon private payload disappears from PlayerView after `demon_info` is completed.

B0C2 still does **not** implement:

- advanced bluff-quality scoring;
- player-skill / game-history / evil-public-story context;
- Washerwoman / Librarian / Investigator information;
- Spy / Recluse registration;
- poisoning / drunken information malfunction;
- generic BotC rules or recommendation DSL.

## B0C2 validation

```text
npm run typecheck
  PASS

npm test
  PASS
  130 test files
  533 tests

pretest
  Web client build PASS
  both WeChat product-shell build / verification PASS
```

## Next after B0C2 merge

B0C3 should move to setup-information roles, beginning with an explicit Trouble Brewing registration seam rather than embedding registration exceptions in each role:

1. model the concrete Trouble Brewing registration alternatives needed by first-night setup-information roles;
2. keep actual canonical identity separate from possible registration;
3. start with one focused role path (Washerwoman) before batching Librarian / Investigator;
4. Rules / Information should generate the legal two-player / shown-character information candidates;
5. Recommendation should later choose among those legal candidates without deciding registration legality;
6. do not yet add poisoning/drunken misinformation until the truthful-information path is stable.
