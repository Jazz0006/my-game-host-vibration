# B0A Trouble Brewing Production Entry — Handoff (2026-09-30)

## Canonical live checkpoint

Repository: `Jazz0006/my-game-host-vibration`

Branch:

```text
agent/b0a-botc-trouble-brewing-module
```

Last committed HEAD before the current implementation work:

```text
1f1d0f9263202e29e63eb1195cdab3ea7af780df
```

Base `main` at branch start:

```text
834c01224de935ceb9860eb05a96147bbdb70eba
```

MG0 is COMPLETE. PR #99 / MG0D has already been merged.

Standing merge authorization remains active: accepted-scope PRs may be merged automatically once required checks are green, mergeability is clean, unresolved review threads are zero, and final scope has not drifted.

## Current route

```text
MG0 COMPLETE
  ↓
B0 BotC / Trouble Brewing production entry
  ├─ B0A module + setup/view contracts ← CURRENT
  ├─ B0B first-night / night sequencing
  └─ B0C+ information / storyteller intelligence slices
```

B0A must establish a real authoritative BotC game owner before first-night sequencing.

Do not prebuild a generic rules DSL.

Do not put Storyteller Intelligence / recommendation policy into authoritative BotC Rules or Information Engine state.

## Current uncommitted B0A implementation

The working tree intentionally contains in-progress production changes that must be preserved. Do not reset, discard, or overwrite them.

Modified:

```text
src/games/GameCatalog.ts
src/runtime/shared/gameClientStateProjection.ts
```

New:

```text
src/games/botc/BotcGameModule.ts
src/games/botc/TroubleBrewing.ts
src/protocol/client/BotcRoomClientProjection.ts
src/runtime/shared/botcClientRoomProjection.ts
```

The BotC owner directory itself was established by the committed branch checkpoint.

## B0A implementation already drafted

### Trouble Brewing metadata / setup

`src/games/botc/TroubleBrewing.ts` currently defines:

- all 22 Trouble Brewing characters;
- Townsfolk / Outsider / Minion / Demon categories;
- 5–15 non-Traveler base setup distributions;
- Baron setup mutation: +2 Outsiders / -2 Townsfolk;
- role lookup / role-id validation.

### Authoritative BotC module

`src/games/botc/BotcGameModule.ts` currently drafts:

- `BotcGameConfig` with Trouble Brewing script identity;
- canonical setup assignments with separate `actualRoleId` and `shownRoleId`;
- setup validation;
- role reveal state;
- player role-confirmation command;
- PlayerView / PublicView / ModeratorView.

Drunk setup semantics are explicitly modeled:

- actual role remains `drunk`;
- player must be shown a Townsfolk role;
- shown Townsfolk must not also be actually in play.

This is only setup/view truth. Drunk late-binding / information recommendation remains a later BotC slice and must not be folded into B0A.

### Integration drafted

- `GameCatalog` is being changed from BotC admission-only to a real `botcGameModule`;
- BotC initial config is becoming Trouble Brewing-specific;
- `BotcRoomClientProjection` and `botcClientRoomProjection` are being introduced;
- shared `gameClientStateProjection` is being expanded so BotC can emit real PlayerView / Moderator/Public room projections instead of lobby-only fallback.

## Current validation state

Current `npm run typecheck` is RED with one known type-boundary issue:

```text
src/runtime/cloudflare/CloudflareAuthoritativeStateDelivery.ts(22,9)
TS2379:
ClientStateEnvelope<BotcClientRoomProjection> |
ClientStateEnvelope<WerewolfClientRoomProjection>
is not assignable to a single Botc projection envelope generic.
```

This is a TypeScript union/generic inference issue at the game-neutral delivery boundary, not a known runtime semantic failure.

No B0A feature PR exists yet.

B0A-specific setup/projection tests still need to be added before the slice can be considered complete.

## Next actions

1. Re-check live branch / HEAD / working tree before editing.
2. Preserve all current uncommitted B0A files.
3. Fix the game-neutral authoritative-delivery generic boundary without reintroducing concrete game imports into shared transport code.
4. Add focused tests for:
   - the full 22-role Trouble Brewing catalog;
   - 5–15 setup counts;
   - Baron setup mutation;
   - Drunk actual/shown-role constraints;
   - illegal duplicate / category distributions;
   - PlayerView hides actual Drunk identity;
   - ModeratorView sees actual + shown assignments;
   - PublicView contains no secret assignments;
   - BotC lobby/game room projection dispatch.
5. Run `npm run typecheck`.
6. Run full `npm test`.
7. Only after GREEN, update this handoff/checkpoint to B0A COMPLETE, commit the production slice, push, create PR, run CI, and auto-merge if normal merge gates pass.
8. Then begin B0B first-night / night sequencing from fresh `main`.

## Authority / ownership reminders

- Room Owner != Game Moderator / Storyteller.
- Human Moderator is not a game participant and may see BotC moderator-secret views.
- Room Owner does not automatically receive BotC secret information.
- BotC authoritative rules/state belongs under `games/botc`.
- shared client/runtime/transport stays game-neutral.
- Storyteller Intelligence remains separate from authoritative Rules / Information Engine.
- Trouble Brewing is the first production BotC script.
