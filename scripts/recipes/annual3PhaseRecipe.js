// scripts/recipes/annual3PhaseRecipe.js
//
// Recipe definition for "Annual Daylight (3-Phase)".
// Wraps the existing legacy implementation via RecipeRegistry without changing behavior.
//
// NOTE:
// The legacy flow for template-recipe-annual-3ph in scriptGenerator.js:
// - Generates matrix generation scripts (3ph matrices).
// - Generates annual simulation script using those matrices.
// This adapter keeps that behavior intact while formalizing inputs.

import { registerRecipe, mergeParamsWithSchema, createValidationResult, addError, addWarning } from './RecipeRegistry.js';
import { generateScripts as legacyGenerateScripts } from '../scriptGenerator.js';

const RECIPE_ID = 'template-recipe-annual-3ph';

const inputSchema = {
  globalParams: {
    // High-quality defaults commonly used for matrix generation.
    ab: { type: 'number', source: 'global', default: 7 },
    ad: { type: 'number', source: 'global', default: 4096 },
    as: { type: 'number', source: 'global', default: 2048 },
    ar: { type: 'number', source: 'global', default: 1024 },
    aa: { type: 'number', source: 'global', default: 0.1 },
    lw: { type: 'number', source: 'global', default: 1e-4 }
  },
  // Note:
  // - Weather/BSDF references are modeled via requiredFiles + simulationFiles,
  //   not as free-form recipeParams, to stay faithful to current UI/legacy behavior.
  recipeParams: {},
  requiredFiles: ['weather-file', 'bsdf-file'],
  requiredResources: {
    needsSensorGrid: true,
    needsView: false,
    needsFisheyeView: false,
    needsOccupancySchedule: false,
    needsBSDF: true
  }
};

const environment = {
  supportedEnvironments: ['electron-posix', 'electron-win', 'browser-instructions'],
  shells: ['bash', 'cmd'],
  dependencies: ['radiance', 'python3'],
  bashOnly: false
};

/**
 * Validate config and project state for Annual 3-Phase recipe.
 *
 * Rules (conservative, non-breaking):
 * - Error if geometry/room is missing.
 * - Error if no illuminance sensor grid is enabled (annual metrics require grids).
 * - Error if no EPW weather file.
 * - Error if no BSDF file when required.
 * - Warn if Python3/Radiance dependencies may be missing (informational only).
 */
function validate(projectData, config) {
  const res = createValidationResult();

  // Geometry requirement
  if (!projectData || !projectData.geometry || !projectData.geometry.room) {
    addError(res, 'Geometry / room data is missing. Define the room before running the Annual 3-Phase recipe.');
  }

  // Sensor grid requirement
  if (inputSchema.requiredResources.needsSensorGrid) {
    const hasGrid =
      projectData &&
      projectData.sensorGrids &&
      projectData.sensorGrids.illuminance &&
      projectData.sensorGrids.illuminance.floor &&
      projectData.sensorGrids.illuminance.floor.enabled;

    if (!hasGrid) {
      addError(
        res,
        'No illuminance sensor grid is enabled. Configure at least one grid. Annual 3-Phase metrics require sensor points.'
      );
    }
  }

  // Weather file presence
  const hasWeatherFromFiles =
    config.simulationFiles &&
    config.simulationFiles['weather-file'] &&
    config.simulationFiles['weather-file'].name;
  const hasWeatherFromConfig = !!config.recipe['weather-file'];
  if (!hasWeatherFromFiles && !hasWeatherFromConfig) {
    addError(
      res,
      'Annual 3-Phase recipe requires a weather EPW file (weather-file). Please select an EPW file in the Simulation Files panel.'
    );
  }

  // BSDF file presence
  const hasBsdfFromFiles =
    config.simulationFiles &&
    config.simulationFiles['bsdf-file'] &&
    config.simulationFiles['bsdf-file'].name;
  const hasBsdfFromConfig = !!config.recipe['bsdf-file'];
  if (inputSchema.requiredResources.needsBSDF && !hasBsdfFromFiles && !hasBsdfFromConfig) {
    addError(
      res,
      'Annual 3-Phase recipe requires a BSDF XML file (bsdf-file) for the window system. Please select a BSDF file.'
    );
  }

  // Environment/toolchain hints (warnings only; runtime env checked elsewhere)
  addWarning(
    res,
    'Ensure Radiance and Python3 are installed and available in your PATH. Annual 3-Phase scripts depend on these tools.'
  );

  return res;
}

/* validate implemented above */

function generateScripts(projectData, config) {
  // Maintain legacy behavior:
  // reconstruct mergedSimParams from raw global + recipe overrides.
  const mergedSimParams = {
    ...(config._raw.globalParams || {}),
    ...(config._raw.recipeOverrides || {})
  };

  const legacyLikeProjectData = {
    ...projectData,
    mergedSimParams
  };

  // Delegate to legacy generator. For template-recipe-annual-3ph, this
  // creates both matrix generation and annual simulation scripts plus
  // required Python post-processing script.
  return legacyGenerateScripts(legacyLikeProjectData, RECIPE_ID) || [];
}

registerRecipe({
  id: RECIPE_ID,
  name: 'Recipe: Annual Daylight (3-Phase)',
  description: 'Generates 3-phase matrices and annual illuminance results using EPW and BSDF.',
  category: 'annual',
  inputSchema,
  environment,
  dependencies: [],
  // Expected outputs:
  // - Annual illuminance (.ill) consumed as 'annual-illuminance' by ResultsRegistry.
  resultTypes: ['annual-illuminance'],
  validate,
  generateScripts
});
