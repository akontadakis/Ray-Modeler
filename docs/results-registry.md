# ResultsRegistry: Results Platform Model

This document defines the ResultsRegistry-based architecture for the results platform: how parsed outputs from simulations and analysis files are identified, stored, and consumed by the UI (dashboards, HDR viewer, reports).

Goals

- Centralize knowledge of:
  - What result types exist.
  - How to recognize them.
  - How they are stored in `resultsManager`.
  - Which visualizations consume them.
- Make adding new metrics predictable and low-risk:
  - One registry entry instead of many ad-hoc conditionals.
- Preserve full backward compatibility with existing UI and data structures.

Core components

1) ResultsRegistry (scripts/results/ResultsRegistry.js)

- Maintains an ordered list of ResultDescriptors.
- Provides:
  - `findDescriptor(fileName, workerResult)`:
    - Chooses the first descriptor whose `match` returns true.
    - Falls back to `generic-scalar-grid` if none match.
  - `register(descriptor)` for extensions.
  - `descriptors` for inspection/debugging.

ResultDescriptor schema (simplified):

- id: stable string ID (e.g. `annual-illuminance`).
- label: human-readable name.
- filePatterns (optional): array of regexes for quick filename checks.
- match(fileName, workerResult): boolean.
  - Must be robust and cheap; combines filename hints and parsed shape.
- schema (optional, documentation):
  - fields: map of fieldName -> description (expected shape).
  - dependsOn: other result type IDs this one conceptually depends on.
- storage:
  - target: where this result logically lives:
    - 'dataset'  → `resultsManager.datasets[key]`
    - 'global'   → top-level (e.g. `resultsManager.climateData`)
    - 'epRun'    → `resultsManager.energyPlusRuns`
    - 'none'     → no direct storage (rare)
  - apply(resultsManager, datasetKey, workerResult, { fileName }):
    - Performs the actual write into `resultsManager`.
    - Must be side-effect free outside of its scope and avoid UI-specific logic.
- visualizations (optional):
  - Array of string IDs naming consumers (e.g. `annual-false-color`, `glare-rose`).
  - Informational only; no imports from visualization modules.

2) ResultsManager integration (scripts/resultsManager.js)

Key changes:

- Imports registry:

  - `import { ResultsRegistry } from './results/ResultsRegistry.js';`

- `_processWorkerResult(result, fileName, key)`:

  - Uses `ResultsRegistry.findDescriptor(fileName, result)` to determine type.
  - If descriptor found and has `storage.apply`:
    - Executes `descriptor.storage.apply(this, key, result, { fileName })`.
  - On failure or missing descriptor:
    - Falls back to `_processGenericResult(...)`.
  - This keeps legacy behavior intact while moving type logic into descriptors.

- `_processGenericResult(result, fileName, key)`:

  - Conservative fallback:
    - Sets `dataset.fileName` if empty.
    - Uses `result.annualData` and/or `result.data` when available.
    - Only fills specialized fields (glare, circadian, etc.) if currently unset.
  - Ensures unknown result shapes do not crash the app.

- Typed helpers:

  - `hasResult(key, typeId)`:
    - Normalized check for core result types:
      - `annual-illuminance`, `annual-direct-illuminance`,
        `annual-glare-dgp`, `annual-glare-ga`,
        `evalglare-pit`, `circadian-summary`, `circadian-per-point`,
        `lighting-energy`, `epw-climate`, `ep-results`.
    - For dataset-based types, inspects `this.datasets[key]`.
    - For global types, uses `climateData` and `getLatestSuccessfulEnergyPlusRun()`.

  - `getResult(key, typeId)`:
    - Returns a read-only view tailored to the type:
      - `annual-illuminance` → `{ annualData, data, units }`
      - `annual-direct-illuminance` → `{ annualDirectData, units }`
      - `annual-glare-dgp` / `annual-glare-ga` → `{ annualGlareResults: { dgp|ga } }`
      - `evalglare-pit` → `glareResult`
      - `circadian-summary` → `circadianMetrics`
      - `circadian-per-point` → `spectralResults`
      - `lighting-energy` → `lightingEnergyMetrics`
      - `epw-climate` → `climateData`
      - `ep-results` → latest EnergyPlus run object

  - Backwards-compatible wrappers:

    - `hasAnnualData(key)`:
      - Now calls `hasResult(key, 'annual-illuminance')`.
    - `hasAnnualGlareData(key)`:
      - Still checks `annualGlareResults` keys; compatible with registry-driven writes.

3) Standard result types (as of now)

The following types are pre-registered in `ResultsRegistry.js`:

1) annual-illuminance

- Source:
  - `.ill` files (non `_direct.ill`) with `result.annualData`.
- Storage:
  - `datasets[key].annualData`
  - `datasets[key].data` (point-wise annual averages if not provided)
  - `datasets[key].units = 'lux'`
- Consumers:
  - 3D false-color
  - Temporal maps
  - sDA/ASE/UDI metrics
  - Combined daylight vs glare scatter.

2) annual-direct-illuminance

- Source:
  - `*_direct.ill` with `result.annualData`.
- Storage:
  - `datasets[key].annualDirectData`
- Depends on:
  - `annual-illuminance` for UDI, sDA/ASE correctness.
- Consumers:
  - ASE (direct-only) in annual metrics.

3) annual-glare-dgp

- Source:
  - `.dgp` files where `result.annualGlareResults.dgp` exists.
- Storage:
  - `datasets[key].annualGlareResults.dgp`
  - `datasets[key].glareMetric = 'dgp'` (if unset)
- Consumers:
  - Glare rose
  - Combined daylight vs glare.

4) annual-glare-ga

- Source:
  - `.ga` files with `result.annualGlareResults.ga`.
- Storage:
  - `datasets[key].annualGlareResults.ga`
  - `datasets[key].glareMetric = 'ga'` (if no metric set).
- Consumers:
  - Same as DGP where applicable (label appropriately).

5) evalglare-pit

- Source:
  - Evalglare point-in-time output with `result.glareResult` but no `annualGlareResults`.
- Storage:
  - `datasets[key].glareResult`
- Consumers:
  - HDR viewer overlays.

6) circadian-summary

- Source:
  - JSON summary with `result.circadianMetrics`.
- Storage:
  - `datasets[key].circadianMetrics`
- Consumers:
  - Circadian dashboard
  - Report generator circadian section.

7) circadian-per-point

- Source:
  - Per-point CSV with `result.perPointCircadianData`.
- Storage:
  - `datasets[key].spectralResults`
  - Optionally `datasets[key].data = Photopic_lux` if empty.
- Consumers:
  - Circadian dashboard (point-level views).

8) lighting-energy

- Source:
  - Daylight-linked lighting energy post-processing with `result.lightingEnergyMetrics`.
- Storage:
  - `datasets[key].lightingEnergyMetrics`
- Consumers:
  - Lighting energy dashboard
  - Report lighting summary.

9) epw-climate

- Source:
  - `.epw` input.
- Storage:
  - `resultsManager.climateData` (set upstream; descriptor documents contract).
- Consumers:
  - Wind rose, solar radiation, temperature charts.

10) ep-results

- Source:
  - Parsed EnergyPlus outputs (`energyPlusSummary`, `energyPlusErrors` etc.).
- Storage:
  - `resultsManager.energyPlusRuns` via `_integrateEnergyPlusResult` (if implemented).
- Consumers:
  - EnergyPlus dashboard
  - Report EP section.

11) generic-scalar-grid

- Fallback type.
- Source:
  - Any `result` with `result.data` as array (or bare array).
- Storage:
  - `datasets[key].data`
  - `datasets[key].stats` via `_calculateStats` (triggered in `loadAndProcessFile`).
- Consumers:
  - Basic false-color visualization.

How consumers should use this

Short-term (non-breaking):

- Existing code continues to use:
  - `resultsManager.datasets.a/b`
  - `hasAnnualData`, `hasAnnualGlareData`, etc.
- New code should:
  - Prefer `hasResult(key, typeId)` to check availability.
  - Prefer `getResult(key, typeId)` to consume data in a type-safe manner.

Examples:

- Annual dashboard UDI panel:

  - Before:
    - Check `hasAnnualData('a')`.
  - Now (preferred):
    - `if (resultsManager.hasResult('a', 'annual-illuminance')) { ... }`.

- Glare rose:

  - Use:
    - `resultsManager.hasAnnualGlareData('a')` (backwards-compatible).
  - Internally glare data is populated by:
    - `annual-glare-dgp` or `annual-glare-ga` descriptors.

- Combined daylight vs glare:

  - Uses:
    - Both `annual-illuminance` and `annual-glare-*` via underlying fields.
  - Type pairing rules are documented in code comments.

- Report generator:

  - For an EnergyPlus section:
    - `if (resultsManager.hasResult(null, 'ep-results')) { const run = resultsManager.getResult(null, 'ep-results'); ... }`
  - For climate:
    - `if (resultsManager.hasResult(null, 'epw-climate')) { const climate = resultsManager.getResult(null, 'epw-climate'); ... }`

Extending the registry (adding new metrics)

To add a new result type:

1) Identify:

- How files are named (patterns).
- What the parsingWorker returns (shape).

2) Create a descriptor in ResultsRegistry:

- Example for a hypothetical annual radiation result:

  - id: 'annual-radiation'
  - filePatterns: [/\.rad\.annual\.csv$/i]
  - match: check both filename and `result.annualData` shape.
  - storage.apply:
    - Write to `datasets[key].annualRadiationData` (new field)
    - Optionally compute `datasets[key].data` if this metric is selected for display.
  - visualizations: ['annual-radiation-map', 'radiation-dashboard']

3) Optionally expose typed helpers:

- In `resultsManager.hasResult` and `getResult`, add cases for `annual-radiation`.

4) Consume from UI:

- Dashboards or views check `hasResult(key, 'annual-radiation')` and use `getResult(key, 'annual-radiation')`.

Design notes

- Registry is intentionally not tightly coupled to Chart.js, THREE, or DOM:
  - Visualization layers depend on typed data, not on file formats.
- `ResultsRegistry` is additive:
  - If it fails to classify something, `_processGenericResult` maintains legacy behavior.
- `resultsManager` remains the single integration point:
  - Workers never write directly to UI.
  - Views never guess file formats; they depend on normalized fields or registry helpers.
