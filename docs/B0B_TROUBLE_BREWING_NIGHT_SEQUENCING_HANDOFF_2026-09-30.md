# B0B Trouble Brewing Night Sequencing Handoff — 2026-09-30

## Canonical checkpoint

Current implementation branch:

```text
agent/b0b2-botc-other-night-sequencing
```

Fresh live `main` at B0B2 entry:

```text
2095c8b6beb42e95fc7a21ae5473d061dc9af379
```

B0A merged through PR #100. B0B1 merged through PR #102. Mutable Git / PR / CI facts must still be rechecked live before any write.

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
  │   ├─ B0B2A recurring / conditional eligibility planner ✅ LOCAL GREEN
  │   └─ B0B2B immediate trigger / role-transition sequencing ← NEXT AFTER MERGE
  └─ B0B3 runtime command/interaction wiring if still required after B0B2
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

## B0B2B next scope

After B0B2A is merged from fresh live `main`:

1. model the minimum concrete Trouble Brewing role-transition facts needed by sequencing;
2. support immediate Demon-death transitions without turning the night sheet into a generic rules DSL;
3. cover Scarlet Woman becoming Imp after a qualifying Demon death;
4. preserve the Imp self-kill rule that a newly created Imp does not attack again that same night;
5. ensure death-trigger steps such as Ravenkeeper can enter the remaining night flow after earlier actions change state;
6. keep information payloads, poisoning truth/misinformation, registration decisions and Storyteller recommendations outside sequencing;
7. add focused tests, then full `typecheck + npm test`;
8. merge automatically when normal gates pass.
