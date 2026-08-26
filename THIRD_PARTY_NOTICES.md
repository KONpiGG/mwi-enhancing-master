# Third-party data and implementation notices

## Milkonomy

This project ports the enhancement transition model and player-preset/Buff data model from
[Milkonomy](https://github.com/Polokikiki/Milkonomy), fixed at commit
`febe90f14f7ea1e51937cc888f6f6e1907c58fff`.

Ported/adapted sources:

- `src/calculator/enhance.ts` → `src/enhancing/calculator.ts` (state transitions, protection usage, ingredient structure)
- `src/pinia/stores/player.ts` and `src/pages/dashboard/components/ActionConfig.vue` → `src/enhancing/preset.ts` (preset shape)
- `src/common/apis/player/index.ts` → `src/enhancing/preset.ts` and `src/enhancing/calculator.ts` (Buff and level-ratio derivation)
- `src/pages/enhancer/index.vue` → `evaluateProtectionStrategies()` (all protection thresholds and minimum-cost selection)

Milkonomy is MIT licensed. Copyright (c) 2025 luyuhao. The complete license text is retained in
`LICENSE.Milkonomy`.

## Milky Way Idle

- Official marketplace snapshot: `https://www.milkywayidle.com/game_data/marketplace.json`. Snapshots are
  fetched at runtime and are not redistributed.
- The generated catalog is derived from Milkonomy's `v1.20260309.0` public game-data export. Milky Way
  Idle names and game data remain the property of its publisher.

The market collector is original to this repository. Missing quotes are never filled with zero or older data.
