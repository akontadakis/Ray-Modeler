// scripts/recipes/illuminanceRecipe.js
//
// Core recipe definition for "Illuminance Map" (point-in-time).
// Bridges between the generic RecipeRegistry and existing scriptGenerator logic,
// without changing behavior. This is the reference pattern for other recipes.

import { registerRecipe, mergeParamsWithSchema, createValidationResult, addError, addWarning } from './RecipeRegistry.js';
import { generateScripts as legacyGenerateScripts } from '../scriptGenerator.js';

/**
 * Recipe ID must match the template id used in HTML and simulation.js.
 */
const RECIPE_ID = 'template-recipe-illuminance';

const inputSchema = {
  globalParams: {
    // Radiance quality parameters (global)
    ab: { type: 'number', source: 'global', default: 4, description: 'Ambient bounces' },
    ad: { type: 'number', source: 'global', default: 1024, description: 'Ambient divisions' },
    as: { type: 'number', source: 'global', default: 512, description: 'Ambient super-samples' },
    ar: { type: 'number', source: 'global', default: 512, description: 'Ambient resolution' },
    aa: { type: 'number', source: 'global', default: 0.2, description: 'Ambient accuracy' },

    // Shared/project-level inputs
    'weather-file': {
      type: 'string',
      source: 'simulationFiles',
      required: false,
      description: 'Optional weather file (not strictly required for simple gensky-based illuminance).'
    }
  },

  recipeParams: {
    // Point-in-time date/time parameters (panel-specific)
    'pit-month': {
      type: 'number',
      source: 'recipe',
      default: 6,
      description: 'Month for analysis date'
    },
    'pit-day': {
      type: 'number',
      source: 'recipe',
      default: 21,
      description: 'Day for analysis date'
    },
    'pit-time': {
      type: 'string',
      source: 'recipe',
      default: '12:00',
      description: 'Time for analysis (HH:MM)'
    },

    // rtrace mode toggles (booleans stored in UI)
    'rtrace-mode-I': {
      type: 'boolean',
      source: 'recipe',
      default: true,
      description: 'Use -I for illuminance at sensor points'
    },
    'rtrace-h': { type: 'boolean', source: 'recipe', default: true },
    'rtrace-w': { type: 'boolean', source: 'recipe', default: true },
    'rtrace-u': { type: 'boolean', source: 'recipe', default: false }
  },

  requiredFiles: [],

  requiredResources: {
    needsSensorGrid: true,
    needsView: false,
    needsFisheyeView: false,
    needsOccupancySchedule: false,
    needsBSDF: false
  }
};

const environment = {
  supportedEnvironments: ['electron-posix', 'electron-win', 'browser-instructions'],
  // We have both .sh and .bat variants in the legacy implementation.
  shells: ['bash', 'cmd'],
  dependencies: ['radiance'],
  bashOnly: false
};

/**
 * Validate config and project state for Illuminance recipe.
 * Non-breaking: we warn in some cases where legacy behavior was permissive.
 *
 * Rules:
 * - Error if geometry/room is missing.
 * - Warn if no illuminance sensor grid enabled (scripts can still be generated).
 * - Error if PIT month/day/time are clearly invalid.
 */
function validate(projectData, config) {
  const result = createValidationResult();

  // Basic geometry presence (hard invariant)
  if (!projectData || !projectData.geometry || !projectData.geometry.room) {
    addError(result, 'Geometry / room data is missing. Define the room before generating illuminance scripts.');
  }

  // Sensor grid requirement (soft for this recipe → warning only)
  if (inputSchema.requiredResources.needsSensorGrid) {
    const hasFloorGrid =
      projectData &&
      projectData.sensorGrids &&
      projectData.sensorGrids.illuminance &&
      projectData.sensorGrids.illuminance.floor &&
      projectData.sensorGrids.illuminance.floor.enabled;

    if (!hasFloorGrid) {
      addWarning(
        result,
        'No illuminance sensor grid appears to be enabled; illuminance scripts may run but produce no useful .ill results.'
      );
    }
  }

  // Date/time sanity check
  const m = Number(config.recipe['pit-month']);
  const d = Number(config.recipe['pit-day']);
  const t = config.recipe['pit-time'];

  if (!m || m < 1 || m > 12) {
    addError(result, 'Invalid month for point-in-time illuminance (pit-month). Expected 1–12.');
  }
  if (!d || d < 1 || d > 31) {
    addError(result, 'Invalid day for point-in-time illuminance (pit-day). Expected 1–31.');
  }
  if (!t || !/^\d{1,2}:\d{2}$/.test(String(t))) {
    addError(result, 'Invalid time format for point-in-time illuminance (pit-time). Expected HH:MM.');
  }

  return result;
}

/**
 * Delegate to legacy generateScripts for now, to avoid behavior changes.
 * We pass through recipeType = RECIPE_ID as today.
 */
function generateScripts(projectData, config) {
  // For compatibility, keep using the existing entrypoint.
  // legacyGenerateScripts internally reads:
  // - projectData.projectInfo
  // - projectData.mergedSimParams
  //
  // To avoid a breaking change, we reconstruct mergedSimParams in-place
  // (globals + recipeOverrides) as before.
  const mergedSimParams = {
    ...(config._raw.globalParams || {}),
    ...(config._raw.recipeOverrides || {})
  };

  const legacyLikeProjectData = {
    ...projectData,
    mergedSimParams
  };

  return legacyGenerateScripts(legacyLikeProjectData, RECIPE_ID) || [];
}

// Register the recipe in the global registry.
registerRecipe({
  id: RECIPE_ID,
  name: 'Recipe: Point-in-time Illuminance',
  description: 'Generates point-in-time illuminance on sensor grids for a specified date and time.',
  category: 'point-in-time',
  inputSchema,
  environment,
  dependencies: [],
  // Expected outputs: scalar grid(s) of illuminance compatible with 'generic-scalar-grid'.
  resultTypes: ['generic-scalar-grid'],
  validate,
  generateScripts
});
