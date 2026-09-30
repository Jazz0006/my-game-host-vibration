# B0C Trouble Brewing Rules / Information → Recommendation Handoff — 2026-09-30

## Canonical checkpoint

B0C3A implementation branch:

```text
agent/b0c3a-botc-registration-washerwoman
```

Fresh live `main` at B0C3A entry:

```text
08dfc328c238f8d293ea20ce2efaf4399ff9d738
```

B0A–B0B3 are complete. B0C is the active BotC production-expansion milestone. B0C1 merged through PR #109 and B0C2 merged through PR #110.

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

## B0C3A registration authority

Official Trouble Brewing rules establish the concrete registration cases required by setup-information roles:

- Washerwoman: start knowing that one of two players is a particular Townsfolk;
- Spy: may register as good and as a Townsfolk or Outsider; the official Spy page includes a Washerwoman example where the Spy registers as Ravenkeeper;
- Recluse: may register as evil and as a Minion or Demon.

References:

```text
https://wiki.bloodontheclocktower.com/Washerwoman
https://wiki.bloodontheclocktower.com/Spy
https://wiki.bloodontheclocktower.com/Recluse
```

The implementation therefore keeps registration contextual and separate from canonical identity:

```text
canonical actualRoleId
        ↓
TroubleBrewingRegistration
  -> actual registration
  -> Spy good-character alternatives
  -> Recluse evil-character alternatives
        ↓
TroubleBrewingInformation
  -> legal truthful information candidates
```

A registration option never mutates `actualRoleId`.

The Drunk is intentionally different: a Drunk shown Empath is still actually the Drunk and does **not** gain an Empath registration identity merely because of `shownRoleId`.

## B0C3A implemented scope

Production:

```text
src/games/botc/TroubleBrewingRegistration.ts
src/games/botc/TroubleBrewingInformation.ts
```

Tests:

```text
tests/botcWasherwomanInformation.test.ts
```

B0C3A provides:

- concrete Trouble Brewing character-registration alternatives;
- ordinary players register as their actual character;
- Spy additionally has every Trouble Brewing Townsfolk / Outsider as a legal contextual character registration;
- Recluse additionally has every Trouble Brewing Minion / Demon as a legal contextual character registration;
- Drunk `shownRoleId` is not treated as registration;
- truthful Washerwoman candidates contain a learned Townsfolk plus two distinct shown players;
- an actual Townsfolk can make the information true;
- Spy may make the information true by registering as a Townsfolk that is not actually in play;
- a Drunk shown as the learned Townsfolk may still be the wrong player, but is not a truthful matching player;
- only Townsfolk character identities are emitted for Washerwoman;
- identical player-visible information is represented once, with all legal registration resolutions grouped underneath it, so registration multiplicity does not accidentally become Recommendation weight.

B0C3A intentionally does **not** implement:

- automatic Washerwoman candidate ranking;
- human Storyteller candidate selection;
- canonical commit of the selected Washerwoman information;
- Washerwoman PlayerView delivery;
- Librarian / Investigator information;
- poisoning / drunken false information.

## B0C3A validation

```text
npm run typecheck
  PASS

npm test
  PASS
  131 test files
  539 tests

pretest
  Web client build PASS
  both WeChat product-shell build / verification PASS
```

## Route status after B0C3A

B0C3A is retained as a completed rules/information foundation, but direct continuation into B0C3B is no longer the current NEXT.

2026-09-30 product-route correction:

- backend BotC rules/recommendation maturity is ahead of the real playable client path;
- B0C3B Washerwoman recommendation/commit work is therefore **DEFERRED AS MAINLINE**;
- deeper Librarian / Investigator / poison-drunk recommendation work is also deferred;
- when the playable path first needs Washerwoman information, the implementation may use the simplest rules-legal baseline over the B0C3A candidate set rather than blocking on recommendation quality;
- the independent Recommendation Engine boundary remains intact and will be improved later.

Current NEXT is:

```text
SIM-0 Simulator Lab V2 foundation
-> BotC Playable Vertical Slice
```

Detailed current route:

`docs/SIMULATOR_FIRST_BOTC_PLAYABLE_VERTICAL_SLICE_ROUTE_2026-09-30.md`

The original B0C3B design below remains valid future work, but no longer determines execution order:

1. define a Washerwoman Recommendation request over the distinct legal information candidates;
2. implement an independent policy without hard-coding registration rules into it;
3. provide a moderator-only human selection/commit path;
4. let Game Engine store the accepted visible information plus chosen legal registration resolution for traceability;
5. deliver visible information only to the actual Washerwoman during `role:washerwoman` and to ModeratorView;
6. keep PublicView and all other PlayerViews secret-safe;
7. keep Drunk/poisoned misinformation in its own Rules/Information malfunction layer.
