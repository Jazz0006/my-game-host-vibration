# B0A Trouble Brewing Production Entry — Handoff (2026-09-30)

## Canonical live checkpoint

Repository: `Jazz0006/my-game-host-vibration`

Branch:

```text
agent/b0a-botc-trouble-brewing-module
```

Continuation checkpoint before B0A source completion:

```text
dba279aae7f92ae3462dcbd9b2242bbdb0bcbbf9
```

At that checkpoint the local branch and same-name remote branch matched exactly. Mutable Git/PR/CI state must still be rechecked live.

MG0 is COMPLETE. PR #99 / MG0D has already been merged.

Standing merge authorization remains active: accepted-scope PRs may be merged automatically once required checks are green, mergeability is clean, unresolved review threads are zero, and final scope has not drifted.

## Current route

```text
MG0 COMPLETE
  ↓
B0 BotC / Trouble Brewing production entry
  ├─ B0A module + setup/view contracts ✅ COMPLETE
  ├─ B0B first-night / night sequencing ← NEXT
  └─ B0C+ information / storyteller intelligence slices
```

B0A has established the real authoritative BotC setup/view owner required before first-night sequencing.

Do not prebuild a generic rules DSL.

Do not put Storyteller Intelligence / recommendation policy into authoritative BotC Rules or Information Engine state.

## B0A implementation scope

The completed B0A slice owns these production changes:

```text
src/games/GameCatalog.ts
src/games/botc/BotcGameModule.ts
src/games/botc/TroubleBrewing.ts
src/protocol/client/BotcRoomClientProjection.ts
src/protocol/client/ClientRawWebSocketProtocol.ts
src/runtime/shared/botcClientRoomProjection.ts
src/runtime/shared/gameClientStateProjection.ts
```

The Raw WebSocket protocol change is limited to preserving a union of game-specific state-envelope payloads at the game-neutral delivery boundary; Cloudflare delivery itself does not import concrete game types.

## B0A implementation completed

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

### Integration completed

- `GameCatalog` now registers a real `botcGameModule`;
- BotC initial config is Trouble Brewing-specific;
- `BotcRoomClientProjection` and `botcClientRoomProjection` own BotC lobby/public/moderator room projection;
- shared `gameClientStateProjection` dispatches active BotC PlayerView / Moderator/Public room projections instead of the former lobby-only fallback;
- game-neutral Raw WebSocket state framing accepts the resulting BotC/Werewolf projection union without concrete game imports in Cloudflare delivery.

## Validation state

B0A local acceptance is GREEN:

```text
npm run typecheck
  PASS

npm test
  PASS
  121 test files
  497 tests
```

The full test command also completed the Web client build and both WeChat product-shell build/verification steps.

Focused B0A coverage now includes:

- all 22 Trouble Brewing roles;
- every 5–15 non-Traveler base setup distribution;
- Baron +2 Outsider / -2 Townsfolk mutation;
- Drunk actual/shown-role constraints;
- duplicate and illegal category-distribution rejection;
- PlayerView hiding actual Drunk identity;
- ModeratorView actual + shown assignment visibility;
- PublicView secret exclusion;
- BotC lobby and active-game projection dispatch through the shared seam.

## Merge closure / next milestone

Use the standing merge authorization: commit the reviewed B0A slice, push, create/refresh its PR, require clean mergeability / zero unresolved review threads / required CI GREEN, and merge without a separate authorization when those gates pass.

After merge, begin B0B first-night / night sequencing from fresh live `main`.

## Authority / ownership reminders

- Room Owner != Game Moderator / Storyteller.
- Human Moderator is not a game participant and may see BotC moderator-secret views.
- Room Owner does not automatically receive BotC secret information.
- BotC authoritative rules/state belongs under `games/botc`.
- shared client/runtime/transport stays game-neutral.
- Storyteller Intelligence remains separate from authoritative Rules / Information Engine.
- Trouble Brewing is the first production BotC script.
