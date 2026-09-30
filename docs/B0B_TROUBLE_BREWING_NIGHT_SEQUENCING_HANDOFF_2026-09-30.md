# B0B Trouble Brewing Night Sequencing Handoff — 2026-09-30

## Canonical checkpoint

Current implementation branch:

```text
agent/b0b2b-botc-trigger-role-transition-sequencing
```

Fresh live `main` at B0B2B entry:

```text
14c71aac18eb7c7e29f0c6f6050fdc695809fe63
```

B0A merged through PR #100. B0B1 merged through PR #102. B0B2A merged through PR #103. Mutable Git / PR / CI facts must still be rechecked live before any write.

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
B0B first-night / night sequencing
  ├─ B0B1 canonical order + first-night progression ✅ MERGED
  ├─ B0B2 later-night dynamic eligibility / progression ← CURRENT
  │   ├─ B0B2A recurring / conditional eligibility planner ✅ MERGED
  │   └─ B0B2B immediate trigger / role-transition sequencing ✅ LOCAL GREEN
  └─ B0B3 live runtime progression / command integration ← NEXT AFTER MERGE
```

B0C remains the owner of concrete information payload generation and Storyteller Intelligence boundaries.

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

## B0B3 next scope

After B0B2B is merged from fresh live `main`:

1. integrate other-night sequencing into `BotcGameModule` without indexing into a pre-filtered frozen list;
2. use a stable canonical cursor / completed-step identity so live facts can be re-evaluated after each action;
3. allow newly eligible later steps such as Ravenkeeper to appear after an earlier night action changes authoritative state;
4. expose role-change notifications only to their actor and authoritative moderator view; PublicView remains secret-safe;
5. keep role-action semantics and concrete information generation outside the sequencing runtime until their owning slices exist;
6. avoid temporary moderator-only "inject arbitrary death/transition" commands that would become production technical debt;
7. add focused progression/privacy tests, then full `typecheck + npm test`;
8. merge automatically when normal gates pass.
