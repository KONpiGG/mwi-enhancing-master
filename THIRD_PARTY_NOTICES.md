# Third-party data and implementation notices

The expected-value implementation in
`src/enhancing/calculator.ts` was written for this project and is intentionally separate from the
versioned records in `src/game-data/catalog.ts`.

## Milky Way Idle

- **Official marketplace snapshot** — `https://www.milkywayidle.com/game_data/marketplace.json`.
  The application reads the public hourly snapshot at run time. Compact fields and the nested
  `marketData[itemHrid][enhancementLevel]` layout are parsed locally; snapshots are not redistributed.
- **Official game data/client and Enhancing UI** — `https://www.milkywayidle.com/` and the public
  game-data responses loaded by that client. Item HRIDs/names, per-tier base success chances and
  experience records in catalog version `mwi-community-2025-02-09` are a small manually transcribed
  subset. Milky Way Idle names and data remain the property of its publisher.
- **Milky Way Idle Wiki, Enhancing** — `https://milkywayidle.wiki.gg/wiki/Enhancing`, consulted for
  the destructive-failure process and the Enhancing skill success bonus.

## Community implementations consulted

- **Milkonomy** — `https://github.com/Polokikiki/Milkonomy` (MIT, copyright 2025 luyuhao). The
  `v1.20260309.0` public game-data export supplies the generated enhanceable-item catalog, material
  costs, item levels and success-rate table. Its player-level success-ratio behavior is reproduced
  with attribution; server-side snapshot collection remains independent and never merges missing
  quotes with older data.
- **MWI Tools** — `https://github.com/holychikenz/MWIApi` (repository name and URL retained here for
  provenance). Its public calculator was used only as an independent behavioral comparison; no code
  was copied.

The exact provenance version is intentionally a catalog constant rather than part of the formula.
Before expanding the catalog, values must be re-exported from current official client data and the
version string and this notice must be updated. Live market data is never committed.
