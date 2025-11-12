// scripts/recipes/renderingRecipe.js
//
// Recipe definition for "Photorealistic Rendering" (point-in-time image).
// Adapts the existing legacy implementation via RecipeRegistry without changing behavior.

import { registerRecipe, mergeParamsWithSchema, createValidationResult, addError, addWarning } from './RecipeRegistry.js';
import { generateScripts as legacyGenerateScripts } from '../scriptGenerator.js';

const RECIPE_ID = 'template-recipe-rendering';

const inputSchema = {
  globalParams: {
    // Radiance quality parameters
    ab: { type: 'number', source: 'global', default: 4 },
    ad: { type: 'number', source: 'global', default: 1024 },
    as: { type: 'number', source: 'global', default: 512 },
    ar: { type: 'number', source: 'global', default: 512 },
    aa: { type: 'number', source: 'global', default: 0.2 }
  },
  recipeParams: {
    // Reuse PIT date/time controls
    'pit-month': { type: 'number', source: 'recipe', default: 6 },
    'pit-day': { type: 'number', source: 'recipe', default: 21 },
    'pit-time': { type: 'string', source: 'recipe', default: '12:00' },

    // Image resolution
    'rpict-x': { type: 'number', source: 'recipe', default: 1280 },
    'rpict-y': { type: 'number', source: 'recipe', default: 720 },

    // rpict quality parameters
    'rpict-ps': { type: 'number', source: 'recipe', default: 8 },
    'rpict-pt': { type: 'number', source: 'recipe', default: 0.05 },
    'rpict-pj': { type: 'number', source: 'recipe', default: 0.9 },

    // rpict boolean switches
    'rpict-i': { type: 'boolean', source: 'recipe', default: false },
    'rpict-dv': { type: 'boolean', source: 'recipe', default: false },
    'rpict-bv': { type: 'boolean', source: 'recipe', default: true },
    'rpict-w': { type: 'boolean', source: 'recipe', default: true }
  },
  requiredFiles: [],
  requiredResources: {
    needsSensorGrid: false,
    needsView: true,
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
 * Validate project state and normalized config for Rendering recipe.
 *
 * Rules:
 * - Error if geometry/room is missing.
 * - Error if image resolution is non-positive.
 * - Error if PIT month/day/time are clearly invalid.
 * - Warn (not error) if viewpoint is missing; legacy may fall back to defaults.
 */
function validate(projectData, config) {
  const res = createValidationResult();

  // Geometry is a hard requirement
  if (!projectData || !projectData.geometry || !projectData.geometry.room) {
    addError(res, 'Geometry / room data is missing. Define the room before generating rendering scripts.');
  }

  // Viewpoint: keep this as a warning to avoid breaking existing behavior.
  if (!projectData.viewpoint || !projectData.viewpoint['view-type']) {
    addWarning(
      res,
      'No explicit viewpoint configured; rendering scripts may fall back to defaults or produce unintended views.'
    );
  }

  // Date/time sanity
  const m = Number(config.recipe['pit-month']);
  const d = Number(config.recipe['pit-day']);
  const t = config.recipe['pit-time'];

  if (!m || m < 1 || m > 12) {
    addError(res, 'Invalid month for rendering (pit-month). Expected 1–12.');
  }
  if (!d || d < 1 || d > 31) {
    addError(res, 'Invalid day for rendering (pit-day). Expected 1–31.');
  }
  if (!t || !/^\d{1,2}:\d{2}$/.test(String(t))) {
    addError(res, 'Invalid time format for rendering (pit-time). Expected HH:MM.');
  }

  // Resolution sanity
  const rx = Number(config.recipe['rpict-x']);
  const ry = Number(config.recipe['rpict-y']);

  if (!rx || rx <= 0 || !Number.isFinite(rx)) {
    addError(res, 'Invalid image width (rpict-x). Must be a positive number.');
  }
  if (!ry || ry <= 0 || !Number.isFinite(ry)) {
    addError(res, 'Invalid image height (rpict-y). Must be a positive number.');
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
  name: 'Recipe: Renderings (Views)',
  description: 'Generates Radiance renderings (HDR/PNG) for configured views.',
  category: 'visualization',
  inputSchema,
  environment,
  dependencies: [],
  // Expected outputs:
  // - HDR images consumed directly by the HDR viewer (no structured grid type).
  // Kept empty here because these are not parsed via ResultsRegistry.
  resultTypes: [],
  validate,
  generateScripts
});
