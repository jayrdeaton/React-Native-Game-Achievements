# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

# @tastic/achievements

Achievement and stats engine for local-multiplayer React Native games — a generic tiered achievement catalog evaluated as pure predicates over whatever stats shape a game defines, per-profile unlock namespacing, AsyncStorage-backed persistence with a self-healing re-sweep, and the outcome-record/streak primitives a game's own funnel composes.

Headless by design: nothing here renders. The achievements *screen* is built from `@tastic/hud`'s `BaseStatsScreen`/`StatSection`/`StatRow`/`AchievementRow`, which take precomputed values (`badgeColor`, `unlockedLabel`, `progress`) and hold no opinion about how they were derived. This package is the deriving half. The two are deliberately not merged — see the extraction rationale below.

Part of the `@tastic`/`@rific` package ecosystem. Not yet published to npm.

## Commands

```bash
npm run build        # tsup, outputs CJS + ESM + types to dist/
npm run build:watch  # tsup --watch
npm run lint         # ESLint
npm run fix          # ESLint --fix
npm test             # Jest (101 tests)
npm run test:watch   # Jest in watch mode
npm run typecheck    # TypeScript type check (tsc --noEmit)
npm run verify       # lint + test + typecheck + build, in that order
```

Always run `npm run lint` before finishing any task.

## Release

Tag-based, using npm trusted publishing (OIDC, no token required):

```bash
npm run release:patch   # npm version patch && git push --follow-tags (or release:minor / release:major)
```

`preversion` runs `npm ci && npm run verify` first. The `publish.yml` workflow fires on `v*` tags and delegates to the shared reusable workflow (`infinitetoken/Workflows/.github/workflows/npm-publish.yml@v1`) with `id-token: write` permission for OIDC trusted publishing.

## Why a separate package (not folded into hud or profile)

- **`@tastic/hud`** is self-described as a *"visual component kit"*, and its peer set is UI-only and heavy (Paper, Skia, Reanimated, `@rific/auto-paper`, `@rific/feedback-press`, `@rific/updater`). Folding persistence and predicate evaluation in would drag all of that onto anything wanting just the engine.
- **`@tastic/profile`** documents itself as *"deliberately blind to any app-specific fields (control scheme, stats)"* — twice, in `types.ts` and `ProfilesManager.tsx`. Putting a stats engine there directly contradicts its stated boundary. It also depends *on* hud, so the dependency direction is wrong.
- The actual coupling to profile is one `string` id (`unlockedKey`'s `profileId`). Neither package imports the other.

## Architecture

```
src/
  index.ts                  - all public exports
  types.ts                  - ACHIEVEMENT_TIERS/AchievementTier, ACHIEVEMENT_TIER_COLORS, AchievementScope, AchievementDefinition<TStats>, UnlockedAchievementsState
  outcomeRecord.ts          - OutcomeRecord (played/wins/losses/draws) + resultFor/applyResult/applyResultToBucket, and the bucket summaries (getWinRate, getMostPlayedKey, getBestWinRateKey, getMaxWinsInAnyBucket, countBucketsWithAWin)
  streaks.ts                - WinStreakState/applyWinStreak, DayStreakState/applyDayPlayed, localDateString/previousDateString
  tieredFamily.ts           - tieredFamily() bronze/silver/gold generator, progressToward()
  achievementEngine.ts      - evaluateUnlockedIds, newlyUnlocked, unlockedKey/parseUnlockedKey, isAchievementUnlocked, achievementUnlockedAt, removeProfileUnlocks
  achievementsValidation.ts - DEFAULT_UNLOCKED_ACHIEVEMENTS, isValidUnlockedAchievements
  storage.ts                - AchievementsStorage interface + resolveStorage (lazy, optional AsyncStorage)
  useAchievements.ts        - the persistence hook: load + self-healing backfill + recordOutcome/resetAll/removeProfile
  __tests__/
    fixtures.ts             - TestStats/TEST_CATALOG/applyTestOutcome — a miniature consumer, exercising the exact composition pattern the README documents
    achievementEngine.test.ts, achievementsValidation.test.ts, outcomeRecord.test.ts, storage.test.ts, streaks.test.ts, tieredFamily.test.ts, useAchievements.test.ts
```

Generalized from LightCycles' own `src/constants/achievements.ts`, `src/utils/achievementEngine.ts`, `src/utils/statsEngine.ts` and `src/hooks/useGameStats.tsx`. LightCycles' `StatsState` was used only as an *example* of a game-supplied shape — deliberately not copied, since its `vsCpu`/`twoPlayer`/`colors` fields are LightCycles-specific.

## Key design decisions

- **No `StatsState` in this package.** `AchievementDefinition<TStats>` is generic and nothing here ever inspects `TStats`. What a game tracks varies too much to share; what's identical is the bookkeeping (an outcome record, a win streak, a day streak) and the machinery (evaluation, namespacing, persistence).
- **`applyDayPlayed` never returns its argument**, even on the same-day no-op path — it always builds a fresh object with exactly its own four fields. `prev` is typed structurally, so the README's `{...stats, ...applyDayPlayed(stats)}` composition passes the *whole* stats object in; returning it verbatim spread every other field back over itself and silently reverted the round just recorded. This was caught by the test fixture's own funnel and is guarded by a dedicated test in `streaks.test.ts`.
- **Two storage keys, not one blob** (`<namespace>.stats` / `<namespace>.achievements`), so a corrupt or rejected stats blob can't take unlock history down with it.
- **AsyncStorage is an optional peer**, resolved lazily inside `resolveStorage` rather than imported at module scope — same pattern as `@tastic/profile`'s `expo-modules-core` bridge. That's what keeps importing this package from throwing under Jest's plain-Node environment. Absent, it falls back to a no-op store: the game runs, it just doesn't persist.
- **`scope: 'device'` achievements are skipped entirely under profile evaluation**, so a device-only achievement can never produce a bogus `profileId:` key — callers can treat "in this set" as immediately eligible for a profile-scoped `unlockedKey` with no further scope-checking.
- **`isAchievementUnlocked` does not fall back to the device-wide key for a profile.** A profile that hasn't earned something reads as locked even if someone else on the device has.
- **Options are read through a ref inside the hook's callbacks**, so a host passing an inline catalog or closure doesn't get a new `recordOutcome` identity every render, and the one-shot load effect never re-runs.

## Public API

From `src/index.ts` — see the README for usage of each.

- Types/constants: `AchievementDefinition`, `AchievementTier`, `AchievementScope`, `ACHIEVEMENT_TIERS`, `ACHIEVEMENT_TIER_COLORS`, `UnlockedAchievementsState`
- Records/buckets: `OutcomeRecord`, `RoundResult`, `DEFAULT_OUTCOME_RECORD`, `resultFor`, `applyResult`, `applyResultToBucket`, `getWinRate`, `DEFAULT_MIN_SAMPLE`, `getMostPlayedKey`, `getBestWinRateKey`, `getMaxWinsInAnyBucket`, `countBucketsWithAWin`
- Streaks: `WinStreakState`, `DEFAULT_WIN_STREAK`, `applyWinStreak`, `DayStreakState`, `DEFAULT_DAY_STREAK`, `applyDayPlayed`, `localDateString`, `previousDateString`
- Catalog: `tieredFamily`, `TieredFamilyOptions`, `TieredThresholds`, `progressToward`
- Engine: `evaluateUnlockedIds`, `newlyUnlocked`, `unlockedKey`, `parseUnlockedKey`, `isAchievementUnlocked`, `achievementUnlockedAt`, `removeProfileUnlocks`
- Validation: `DEFAULT_UNLOCKED_ACHIEVEMENTS`, `isValidUnlockedAchievements`
- Persistence: `useAchievements`, `UseAchievementsOptions`, `UseAchievementsResult`, `RecordOutcomeResult`, `AchievementsStorage`

## Peer Dependencies

- `react` >=19.0.0 — required (only `useAchievements` needs it; the engine is plain functions)
- `@react-native-async-storage/async-storage` >=1.18.0 — **optional** (`peerDependenciesMeta`), lazily required; also carried in `devDependencies` to satisfy the shared config's `package-json/specify-peers-locally` rule

No React Native, Paper, Skia or Reanimated peers — nothing here renders.

## Testing

- Framework: Jest (`@infinitetoken/jest-config/react-native`), jsdom environment
- 101 tests across 7 suites; no `__mocks__/` directory is needed (nothing imports a native module eagerly — `storage.test.ts` uses `jest.isolateModules` + `jest.doMock` to exercise both the resolved and absent AsyncStorage paths)
- Coverage (measured 2026-09-02): **99.55 / 95.09 / 89.06 / 100** (statements/branches/functions/lines), against the shared preset's 70% floor — no local `coverageThreshold` override
- `src/__tests__/fixtures.ts` is a miniature consumer of the whole package (its own `TestStats`, catalog and `applyTestOutcome` funnel), so the tests exercise the exact composition the README documents rather than a synthetic shape

## Code Style

Enforced by ESLint + Prettier, run `npm run lint` before finishing any task. Single quotes, no semicolons, no trailing commas, print width 1000; `simple-import-sort` on imports/exports; `package-json/order-properties` and `sort-collections` on `package.json` itself.

`tsconfig.json` is `extends: "@infinitetoken/tsconfig/react-native"` with `include: ["src"]`, no local compiler-option overrides (no `exclude` needed — there's no `src/__mocks__`). `eslint.config.cjs` and `jest.config.cjs` are both bare one-line re-exports of the shared presets, with no options. `tsup.config.cjs` is `require('@infinitetoken/tsconfig/tsup/lib')()`.
