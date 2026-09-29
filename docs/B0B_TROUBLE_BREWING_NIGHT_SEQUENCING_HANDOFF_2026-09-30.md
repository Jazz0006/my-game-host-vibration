# B0B Trouble Brewing Night Sequencing Handoff — 2026-09-30

## Canonical checkpoint

Branch:

```text
agent/b0b-botc-first-night-sequencing
```

Fresh live `main` at B0B entry:

```text
e852ec91fc601eff90d996eb859b50296a8bf1c6
```

B0A merged through PR #100. Mutable Git / PR / CI facts must still be rechecked live before any write.

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

## B0B decomposition

```text
B0B first-night / night sequencing
  ├─ B0B1 canonical order + first-night progression ✅ LOCAL GREEN
  ├─ B0B2 later-night dynamic eligibility / progression ← NEXT AFTER B0B1 MERGE
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

## B0B2 next scope

After B0B1 is merged from a clean fresh `main`:

1. model the minimal state needed to determine later-night eligibility without creating a generic rules DSL;
2. consume the canonical other-night order already established by B0B1;
3. handle living/dead eligibility plus conditional slots such as Scarlet Woman, Ravenkeeper, and Undertaker;
4. preserve poisoned/drunk wake behavior while leaving information truth/misinformation to B0C;
5. keep Room Owner distinct from Game Moderator/Storyteller;
6. add focused tests, then full `typecheck + npm test`;
7. merge automatically when normal gates pass.
