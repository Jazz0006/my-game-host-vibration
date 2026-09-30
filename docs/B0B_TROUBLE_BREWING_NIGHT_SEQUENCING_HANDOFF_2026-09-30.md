# B0B Trouble Brewing Night Sequencing Handoff — 2026-09-30

## Canonical checkpoint

B0B3 implementation branch:

```text
agent/b0b3-botc-ownership-live-progression
```

Fresh live `main` at B0B3 entry:

```text
59080d8c0bab66d540847e29a1cb2f4e314fb250
```

B0A merged through PR #100. B0B1 merged through PR #102. B0B2A merged through PR #103. B0B2B merged through PR #107. Mutable Git / PR / CI facts must still be rechecked live before any write.

Standing merge authorization remains active: accepted-scope PRs may be merged automatically once exact-head, required checks, mergeability, unresolved-thread, and final-diff gates pass.

## Authority / evidence for Trouble Brewing night order

B0B sequencing uses the canonical Trouble Brewing relative order represented by The Pandemonium Institute's official script schema:

- first night: `minioninfo -> demoninfo -> poisoner -> spy -> washerwoman -> librarian -> investigator -> chef -> empath -> fortuneteller -> butler`;
- other nights: `poisoner -> monk -> spy -> scarletwoman -> imp -> ravenkeeper -> undertaker -> empath -> fortuneteller -> butler`.

Reference:

```text
https://github.com/ThePandemoniumInstitute/botc-release/blob/main/script-schema.json
```

The official glossary confirms that standard Minion Info / Demon Info is given on the first night only in games with 7 or more players.

Reference:

```text
https://wiki.bloodontheclocktower.com/Glossary
```

B0B2 eligibility/trigger ownership is also constrained by official character/rules text:

- dead players normally lose their ability immediately;
- Ravenkeeper is an explicit death-trigger exception and wakes when they die at night;
- Undertaker wakes only when a player was executed and died that day;
- Scarlet Woman changes character immediately when a qualifying Demon death occurs, so this is not an ordinary recurring night action;
- ability text / immediate timing takes precedence over using the night sheet as a fake static execution engine.

References:

```text
https://wiki.bloodontheclocktower.com/Abilities
https://wiki.bloodontheclocktower.com/Ravenkeeper
https://wiki.bloodontheclocktower.com/Undertaker
https://wiki.bloodontheclocktower.com/Scarlet_Woman
```

## B0B decomposition

```text
B0B first-night / night sequencing ✅ COMPLETE
  ├─ B0B1 canonical order + first-night progression ✅ MERGED
  ├─ B0B2 later-night dynamic eligibility / progression ✅ COMPLETE
  │   ├─ B0B2A recurring / conditional eligibility planner ✅ MERGED
  │   └─ B0B2B immediate trigger / role-transition sequencing ✅ MERGED PR #107
  └─ B0B3 ownership hardening + live runtime progression / command integration ✅ COMPLETE
```

B0B3 is also the point where the BotC internal ownership contract becomes explicit: Setup Generation / Setup Contract, Canonical Session / Truth, Game Engine, Rules / Information Resolution, and Storyteller Recommendation are separate owners. B0C+ owns the Rules/Information and Recommendation slices, but those two layers must remain distinct from each other.

## B0B1 implemented scope

Production:

```text
src/games/botc/TroubleBrewingNightSequence.ts
src/games/botc/BotcGameModule.ts
```

Tests:

```text
tests/botcNightSequence.test.ts
```

B0B1 now provides:

- canonical Trouble Brewing first-night and other-night role-order constants;
- first-night sequence materialization from the authoritative B0A assignments;
- ordinary 5–6 player Minion Info / Demon Info suppression;
- 7+ player Minion Info then Demon Info actor resolution;
- Drunk sequencing by `shownRoleId`, while preserving `actualRoleId=drunk` only in authoritative/moderator state;
- moderator-only `beginFirstNight` and `completeNightStep` progression;
- deterministic transition `role_reveal -> first_night -> day 1`;
- direct transition to day when a legal 5–6 player setup has no first-night wake steps;
- PlayerView wakes only current actors and does not reveal `actorSource` / Drunk truth;
- ModeratorView receives the active authoritative night step;
- PublicView receives no active-step secret.

## Explicit B0B1 non-goals

Do not add these to B0B1:

- Poisoner target semantics or poison persistence;
- Washerwoman / Librarian / Investigator information selection;
- Chef / Empath number calculation;
- Fortune Teller target/result semantics or Red Herring selection;
- Butler master selection/vote enforcement;
- Spy Grimoire projection contents;
- Demon bluff selection;
- Storyteller recommendation / balancing policy;
- later-night conditional activation such as Ravenkeeper death timing or Undertaker execution dependency.

Those belong to later B0B/B0C slices according to ownership.

## Local validation

```text
npm run typecheck
  PASS

npm test
  PASS
  122 test files
  502 tests
```

The full test command also passed the Web client build and both WeChat product-shell build/verification steps.

## B0B2A implemented scope

Production:

```text
src/games/botc/TroubleBrewingNightSequence.ts
```

Tests:

```text
tests/botcOtherNightEligibility.test.ts
```

B0B2A adds a live other-night eligibility projection over authoritative facts rather than freezing a complete night plan:

- ordinary recurring roles wake only while alive;
- Ravenkeeper wakes only when that player died tonight, despite now being dead;
- Undertaker wakes only when a player was executed and died today;
- Drunk follows the same conditions for the Townsfolk they were shown;
- Scarlet Woman is intentionally excluded from ordinary recurring eligibility because a qualifying Demon death immediately changes the player's character;
- callers can re-evaluate eligibility after authoritative state changes, leaving room for B0B2B interrupt/role-transition semantics.

Local validation:

```text
npm run typecheck
  PASS

npm test
  PASS
  123 test files
  507 tests
```

The full test command also passed the Web client build and both WeChat product-shell build/verification steps.

## B0B2B implemented scope

Production:

```text
src/games/botc/TroubleBrewingNightSequence.ts
```

Tests:

```text
tests/botcNightRoleTransitions.test.ts
```

B0B2B accepts only role-transition facts that authoritative Trouble Brewing rules have already resolved. Sequencing owns their placement, not the decision that they occurred:

- a qualifying Scarlet Woman -> Imp transition emits a private role-change notification at the Scarlet Woman slot and then gives that player the subsequent Imp action;
- an Imp self-kill keeps the acting Imp's current action, then immediately emits the successor's Imp role-change notification;
- the successor created by an Imp self-kill does not receive a second Imp action that same night;
- Scarlet Woman -> Imp followed by that new Imp self-killing in the same night is represented as one Scarlet Woman notification, one Imp action, then one successor notification;
- transition references are validated against authoritative assignments and require an alive Minion successor for Imp self-kill;
- no information payload, poisoning truth/misinformation, registration decision or Storyteller recommendation is added here.

Local validation:

```text
npm run typecheck
  PASS

npm test
  PASS
  124 test files
  513 tests
```

The full test command also passed the Web client build and both WeChat product-shell build/verification steps.

## B0B3 implemented scope

B0B3 implementation is COMPLETE and fully GREEN.

Production ownership changes:

- `TroubleBrewingSetup.ts` now owns accepted setup validation/canonicalization; `BotcGameModule` no longer implements setup search/validation policy itself.
- `TroubleBrewingNightProgression.ts` owns the live other-night high-water-mark cursor and active-step snapshot.
- `BotcGameModule` adds moderator-only `beginOtherNight` and uses fresh authoritative facts after every completed step rather than indexing a frozen filtered list.
- newly eligible later steps such as Ravenkeeper can appear after the Imp action without replaying Poisoner/Monk/Imp.
- role-change notifications remain private to the actor and ModeratorView; PublicView remains secret-safe.
- resolved Scarlet Woman / Imp succession facts are committed back into canonical current role assignments when the night completes, so later nights retain the new Imp.
- other-night actor resolution skips dead former holders and selects the alive current character holder.
- no moderator-only arbitrary death/transition injection command was added.
- concrete ability effects, poison/drunk truth, registration and information generation remain outside sequencing.

Architecture checkpoint:

```text
Setup Generation / Setup Contract
  -> Canonical Session / Truth
  -> Game Engine
  -> Rules / Information Resolution
  -> Recommendation Context Builder
  -> Storyteller Recommendation
  -> chosen decision back to Game Engine
  -> authoritative commit
```

Validation:

```text
npm run typecheck
  PASS

npm test
  PASS
  128 test files
  524 tests

pretest
  Web client build PASS
  both WeChat product-shell build / verification PASS
```

## Next after B0B3 merge

B0C should begin with the concrete Trouble Brewing Rules / Information boundary before any recommendation ranking:

1. define one concrete information decision point and its authoritative required facts;
2. produce legal information candidates in Rules / Information Resolution;
3. keep Storyteller Recommendation as a separate read-only consumer of those candidates plus required/optional context;
4. let Game Engine commit the chosen result to Canonical Session / Truth;
5. do not introduce a generic BotC rules DSL or a monolithic "intelligence" module.
