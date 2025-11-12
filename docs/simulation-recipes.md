# Simulation Recipes Architecture

This document describes how Simulation Recipes are modeled, persisted, and executed in Ray-Modeler.

## 1. Core concepts

### 1.1 Single active recipe per run

A Simulation Recipe run is:

- Inputs:
  - Project state (geometry, materials, lighting, grids, viewpoints, etc.)
  - Global simulation parameters
  - One selected Simulation Recipe configuration
- Output:
  - A coherent package in the standard directory structure:
    - 01_geometry, 02_materials, 03_views, 04_skies, 05_bsdf,
      06_octrees, 07_scripts, 08_results, 09_images,
      10_schedules, 11_files, 12_topography
  - One or more `RUN_*.sh` / `.bat` scripts for that recipe

Multi-recipe/batch flows, if needed, must be implemented as explicit
“composite recipes”, not by implicitly iterating over many configs.

### 1.2 Separation of responsibilities

Key modules:

- `scripts/simulation.js`
  - UI layer for Simulation Recipes.
  - Manages:
    - Recipe dropdown (`#recipe-selector`)
    - Sidebar recipe container (`#recipe-parameters-container`)
    - Legacy floating windows for backward compatibility
    - Run button behavior (using runtime environment metadata)
- `scripts/project.js`
  - Aggregates project data (`gatherAllProjectData`).
  - Collects simulation parameters (`gatherSimulationParameters`).
  - Orchestrates:
    - Validation
    - Script generation
    - File writing (`generateSimulationPackage`, `downloadProjectFile`)
- `scripts/recipes/RecipeRegistry.js`
  - Central registry of recipes.
  - Defines the `RecipeDefinition` contract.
  - Provides helpers:
    - `registerRecipe`
    - `getRecipeById`
    - `mergeParamsWithSchema`
    - validation result helpers
- `scripts/recipes/configMappers.js`
  - Canonical mapping:
    - `simulationParameters` + active selection
    - → recipe config object used by RecipeDefinitions
  - Encodes precedence:
    - recipe overrides > globals > defaults
- `scripts/recipes/runtimeEnvironment.js`
  - Detects runtime (Electron/browser, OS).
  - Computes:
    - Whether a recipe can be auto-run
    - Whether only manual instructions should be shown
- `scripts/scriptGenerator.js`
  - Legacy script generation engine.
  - Currently used behind adapters in RecipeDefinitions.

The design goal is:
- Recipes are pure definitions.
- UI reads/writes a neutral model.
- Project orchestrates validation + persistence.
- Script generation is pluggable behind the recipe layer.

---

## 2. Data model

### 2.1 simulationParameters shape

`project.gatherSimulationParameters()` produces:

```js
{
  global: { ... },
  activeRecipe?: {
    templateId: string,
    values: { [key: string]: any }
  },
  recipes: Array<{
    templateId: string,
    values: { [key: string]: any }
  }>
}
```

Notes:

- `global`:
  - Values read from the global simulation parameters panel.
- `activeRecipe`:
  - Canonical single active recipe for the sidebar dropdown flow.
  - Values are taken from `#recipe-parameters-container` when present.
- `recipes`:
  - Backward-compatible array.
  - When the sidebar is used:
    - `activeRecipe` is mirrored as the first entry:
      - Any old entries with the same templateId are removed.
      - Then `{ templateId, values }` is unshifted.

Legacy floating windows:

- Any `.floating-window[data-template-id^="template-recipe-"]`
  still contribute entries in `recipes[]` for compatibility.

### 2.2 Active recipe resolution

`getActiveRecipeSelection(panelElement, simParams)`:

Priority:

1) If `simParams.activeRecipe` exists:
   - Use `{ templateId, values }` from it.
2) Else, if `panelElement` and:
   - `panelElement.dataset.templateId` or
   - `#recipe-parameters-container.dataset.activeRecipeTemplate`
   matches a recipe in `simParams.recipes`:
   - Use that.
3) Else, if `simParams.recipes[0]` exists:
   - Use the first entry (legacy fallback).
4) Else:
   - `{ recipeId: null, values: null }`.

`buildRecipeConfig(recipeDef, projectData, simParams, simulationFiles, activeSelection)`:

- Reads:
  - `globalParams = simParams.global || {}`
  - `recipeOverrides`:
    - From `activeSelection` when matching `recipeDef.id`, or
    - First `recipes[]` entry with this `templateId` (legacy).
- Applies schema:
  - `globals = mergeParamsWithSchema(globalParams, {}, schema.globalParams)`
  - `recipe = mergeParamsWithSchema(globalParams, recipeOverrides, schema.recipeParams)`
- Returns:
  - `{ globals, recipe, simulationFiles, _raw: { globalParams, recipeOverrides } }`

This ensures:
- One active config per recipe per run.
- Stable precedence and compatibility.

---

## 3. RecipeDefinition contract

Definitions live under `scripts/recipes/*Recipe.js`
and are registered via `registerRecipe`.

Key fields:

- `id: string`
  - Must match HTML template ID, e.g. `'template-recipe-illuminance'`.
- `name: string`
  - Human-readable label.
- `description?: string`
  - Short explanation (can be surfaced in UI).
- `category?: string`
  - E.g. `'point-in-time'`, `'annual'`, `'compliance'`, etc.

### 3.1 Input schema

`inputSchema` describes what the recipe reads:

```js
inputSchema: {
  globalParams?: { [key: string]: ParamSpec },
  recipeParams?: { [key: string]: ParamSpec },
  requiredFiles?: string[],
  requiredResources?: {
    needsSensorGrid?: boolean,
    needsView?: boolean,
    needsBSDF?: boolean,
    // etc.
  }
}
```

`ParamSpec` (simplified):

```js
{
  type?: 'string' | 'number' | 'boolean' | 'enum',
  required?: boolean,
  default?: any,
  enumValues?: string[],
  description?: string
}
```

Conventions:

- Keys in `globalParams` and `recipeParams` are the base IDs used in the UI,
  BEFORE any panel-specific suffixing (configMappers uses base IDs).
- `requiredFiles` refers to keys in `project.simulationFiles`.

### 3.2 Environment metadata

Used by runtime environment gating:

```js
environment: {
  supportedEnvironments?: Array<'electron-posix' | 'electron-win' | 'browser-instructions'>,
  shells?: Array<'bash' | 'cmd'>,
  dependencies?: string[],   // e.g. ['radiance', 'python3']
  bashOnly?: boolean         // if true, no cmd/.bat auto-run on Windows
}
```

This is consulted by:

- `getRecipeExecutionSupport` in `runtimeEnvironment.js`
- `initializePanelLogic` “Run” handler in `simulation.js`

Auto-run behavior:

- Electron + supported OS:
  - `canAutoRun = true` → use `electronAPI.runScript`.
- Browser:
  - `canAutoRun = false`, `instructionsOnly = true`:
    - UI shows `_showBrowserRunInstructions` with the correct script name.
- Unsupported combos:
  - `canAutoRun = false`, `instructionsOnly` may be false or true depending on metadata.
  - Reasons are shown to the user.

### 3.3 Behavior functions

Each recipe implements:

- `validate(projectData, config) → { errors: string[], warnings: string[] }`
  - Pure, no side effects.
  - Uses:
    - `projectData` (geometry, materials, sensor grids, etc.)
    - `config` from `buildRecipeConfig`.
  - Only adds:
    - Errors for conditions that make scripts unusable.
    - Warnings for soft issues (missing recommended data, etc.).

- `generateScripts(projectData, config) → ScriptSpec[]`
  - Pure.
  - Currently:
    - Often reconstructs `mergedSimParams` from `config._raw`
      and calls legacy `generateScripts(projectData, recipeId)`.
  - Returns:
    - `{ fileName, content }[]`.

No DOM, no Electron, no direct filesystem access here.

---

## 4. Execution flow

High-level path for a run:

1) User selects a recipe in the Simulation sidebar.
2) UI:
   - Injects recipe template into `#recipe-parameters-container`.
   - Sets `dataset.activeRecipeTemplate`.
3) `project.generateSimulationPackage(panelElement)`:
   - Calls `gatherAllProjectData()`:
     - Includes `simulationParameters` from `gatherSimulationParameters()`
       with `global`, `activeRecipe`, `recipes[]`.
   - For registry-based recipes:
     - Resolves active selection via `getActiveRecipeSelection`.
     - Builds config via `buildRecipeConfig`.
     - Runs `recipeDef.validate`.
       - On errors: show structured alert, abort.
       - On warnings: log; continue.
     - Calls `recipeDef.generateScripts`.
   - For others:
     - Calls legacy `generateScripts`.
   - Writes:
     - Geometry/materials/views/grids/etc.
     - Scripts into `07_scripts`.
     - `make_executable.sh`.
4) Run button:
   - Uses `getRuntimeEnvironment` + `getRecipeExecutionSupport`.
   - If `canAutoRun`:
     - Uses `electronAPI.runScript`.
   - Else:
     - Shows manual instructions.

---

## 5. Persistence and loading

### 5.1 Saving (downloadProjectFile)

- Before serializing:
  - If `simulationParameters.activeRecipe` exists:
    - Normalize `recipes[]` so that:
      - Active recipe is first entry.
- Write:
  - `${projectName}.json` with:
    - `simulationParameters.global`
    - `simulationParameters.activeRecipe` (if present)
    - `simulationParameters.recipes` (normalized)
    - Other project data.

### 5.2 Loading (loadProject + applySettings + recreateSimulationPanels)

- `loadProject`:
  - Reads project JSON.
  - Restores `simulationFiles`, EPW, and other resources.
  - Calls `applySettings`.

- `applySettings`:
  - Restores:
    - Project info, geometry, materials, lighting, grids, etc.
  - For Simulation Recipes:
    - Calls:
      - `recreateSimulationPanels(settings.simulationParameters, project.simulationFiles, ui)`.

- `recreateSimulationPanels`:
  - Clears:
    - Legacy floating recipe panels.
    - Sidebar recipe container + selection.
  - Recreates global panel (legacy).
  - Determines active recipe:
    - Prefer `simSettings.activeRecipe`.
    - Else first entry in `simSettings.recipes` (legacy).
  - Restores active recipe into:
    - Dropdown (`#recipe-selector`).
    - Sidebar container (`#recipe-parameters-container`):
      - Clones template.
      - Initializes logic + file listeners.
      - Applies saved values.
      - Updates "Generate Package" label.
  - Optionally recreates additional legacy floating panels from `recipes[]` beyond the active one.

This guarantees:
- The UI on load matches the saved active recipe.
- The same configuration will be used by the RecipeRegistry-based generation.

---

## 6. How to add or update a recipe

1) Create a recipe module:
   - `scripts/recipes/myNewRecipe.js`

2) Define and register:

```js
import { registerRecipe, mergeParamsWithSchema, createValidationResult, addError, addWarning } from './RecipeRegistry.js';
import { generateScripts as legacyGenerateScripts } from '../scriptGenerator.js';

const RECIPE_ID = 'template-recipe-my-new';

registerRecipe({
  id: RECIPE_ID,
  name: 'Recipe: My New Workflow',
  description: 'Short description here.',
  category: 'point-in-time', // or annual/compliance/etc.
  inputSchema: {
    globalParams: { /* ... */ },
    recipeParams: { /* ... */ },
    requiredFiles: [/* ... */],
    requiredResources: { /* ... */ }
  },
  environment: {
    supportedEnvironments: ['electron-posix', 'electron-win', 'browser-instructions'],
    shells: ['bash', 'cmd'],
    dependencies: ['radiance']
  },
  validate(projectData, config) {
    const v = createValidationResult();
    // addError(v, '...'); addWarning(v, '...');
    return v;
  },
  generateScripts(projectData, config) {
    // For now, adapt to legacy generator:
    const mergedSimParams = {
      ...config._raw.globalParams,
      ...config._raw.recipeOverrides
    };
    const legacyProjectData = { ...projectData, mergedSimParams };
    return legacyGenerateScripts(legacyProjectData, RECIPE_ID);
  }
});
```

3) Wire UI:
   - Add `<template id="template-recipe-my-new">` in HTML with `.window-content`.
   - Add entry in `availableModules` in `simulation.js` (until fully registry-driven).
   - Ensure input IDs match `inputSchema` base keys.

4) Done:
   - The recipe participates in:
     - Validation
     - Persistence
     - Environment-aware Run
     - Active recipe mapping

---

This documentation reflects the current implemented architecture after Phases 0–6 and provides the contract and mental model needed to safely extend and maintain Simulation Recipes without requiring reading through all the implementation details.
