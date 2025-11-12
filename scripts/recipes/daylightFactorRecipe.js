// scripts/recipes/daylightFactorRecipe.js
//
// Recipe definition for "Daylight Factor" (DF) analysis.
// Wraps the existing legacy implementation via RecipeRegistry without changing behavior.

import { registerRecipe, mergeParamsWithSchema, createValidationResult, addError, addWarning } from './RecipeRegistry.js';
import { generateScripts as legacyGenerateScripts } from '../scriptGenerator.js';

const RECIPE_ID = 'template-recipe-df';

const inputSchema = {
  globalParams: {
    ab: { type: 'number', source: 'global', default: 4 },
    ad: { type: 'number', source: 'global', default: 1024 },
    as: { type: 'number', source: 'global', default: 512 },
    ar: { type: 'number', source: 'global', default: 512 },
    aa: { type: 'number', source: 'global', default: 0.2 }
  },
  recipeParams: {
    'df-sky-type': {
      type: 'string',
      source: 'recipe',
      default: '-c',
      description: 'CIE sky type (-c for overcast, etc.)'
    },
    'df-ground-refl': {
      type: 'number',
      source: 'recipe',
      default: 0.2,
      description: 'Ground reflectance'
    },
    'df-irrad': {
      type: 'number',
      source: 'recipe',
      default: 55.866,
      description: 'Horizontal irradiance for 10,000 lux reference'
    }
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
  shells: ['bash', 'cmd'],
  dependencies: ['radiance'],
  bashOnly: false
};

/**
 * Validate config and project state for Daylight Factor recipe.
 *
 * Rules:
 * - Error if geometry/room is missing.
 * - Error if no illuminance sensor grid is enabled (DF requires grids).
 * - Error if DF parameters are invalid:
 *   - df-sky-type missing
 *   - df-ground-refl not in [0,1]
 *   - df-irrad not positive
 */
function validate(projectData, config) {
  const res = createValidationResult();

  // Geometry is a hard requirement
  if (!projectData || !projectData.geometry || !projectData.geometry.room) {
    addError(res, 'Geometry / room data is missing. Define the room before generating Daylight Factor scripts.');
  }

  // Sensor grid requirement for DF (hard requirement: DF without grids is meaningless)
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
        'No illuminance sensor grid is enabled. Configure at least one workplane grid before running the Daylight Factor recipe.'
      );
    }
  }

  // DF sky type
  const skyType = config.recipe['df-sky-type'];
  if (!skyType || typeof skyType !== 'string') {
    addError(res, 'Daylight Factor sky type (df-sky-type) is missing or invalid.');
  }

  // Ground reflectance
  const groundRefl = Number(config.recipe['df-ground-refl']);
  if (!Number.isFinite(groundRefl) || groundRefl < 0 || groundRefl > 1) {
    addError(res, 'Ground reflectance (df-ground-refl) must be a number between 0 and 1.');
  }

  // Reference irradiance
  const irrad = Number(config.recipe['df-irrad']);
  if (!Number.isFinite(irrad) || irrad <= 0) {
    addError(res, 'Horizontal irradiance (df-irrad) must be a positive number.');
  }

  return res;
}

/* validate implemented above */

function generateScripts(projectData, config) {
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

registerRecipe({
  id: RECIPE_ID,
  name: 'Recipe: Daylight Factor',
  description: 'Computes daylight factor on sensor grids under CIE overcast sky.',
  category: 'point-in-time',
  inputSchema,
  environment,
  dependencies: [],
  // Expected outputs:
  // - Scalar daylight factor grids compatible with 'generic-scalar-grid'.
  resultTypes: ['generic-scalar-grid'],
  validate,
  generateScripts
});
