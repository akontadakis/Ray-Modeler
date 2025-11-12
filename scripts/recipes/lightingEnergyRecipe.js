import { registerRecipe, createValidationResult, addError, addWarning } from './RecipeRegistry.js';
import { generateScripts as legacyGenerateScripts } from '../scriptGenerator.js';

const RECIPE_ID = 'template-recipe-lighting-energy';

const inputSchema = {
  globalParams: {
    ab: { type: 'number' },
    ad: { type: 'number' },
    as: { type: 'number' },
    ar: { type: 'number' },
    aa: { type: 'number' },
    lw: { type: 'number' }
  },
  recipeParams: {
    'weather-file': { type: 'string' },
    'bsdf-open-file': { type: 'string', optional: true },
    'bsdf-closed-file': { type: 'string', optional: true },
    'installed-power': { type: 'number', optional: true },
    'room-area': { type: 'number', optional: true },
    'control-strategy': { type: 'string', optional: true }
    // Additional tuning parameters used by the legacy script can be surfaced here as needed.
  },
  requiredFiles: ['weather-file'],
  requiredResources: {
    needsSensorGrid: true
  }
};

const environment = {
  supportedEnvironments: ['electron-posix', 'electron-win', 'browser-instructions'],
  shells: ['bash'],
  dependencies: ['radiance', 'python3'],
  bashOnly: true
};

function validate(projectData, config) {
  const result = createValidationResult();

  if (!projectData.geometry || !projectData.geometry.room) {
    addError(
      result,
      'Lighting Energy: No room geometry found. Define geometry before running this recipe.'
    );
  }

  const simFiles = projectData.simulationFiles || {};
  const hasEpw =
    !!projectData.epwFileContent ||
    !!projectData.projectInfo?.epwFileName ||
    !!simFiles['weather-file'] ||
    !!config.recipe['weather-file'];

  if (!hasEpw) {
    addError(
      result,
      'Lighting Energy: Weather file is required. Please select an EPW file.'
    );
  }

  const sensorGrids = projectData.sensorGrids || {};
  const hasIllFloor =
    !!sensorGrids.illuminance?.floor?.enabled &&
    !!sensorGrids.illuminance.floor.spacing;

  if (!hasIllFloor) {
    addError(
      result,
      'Lighting Energy: Requires an illuminance floor sensor grid for control and analysis. Enable and configure it before running.'
    );
  }

  // BSDFs are optional depending on whether shading systems are modeled with BSDF.
  const bsdfOpen = simFiles['bsdf-open-file'] || config.recipe['bsdf-open-file'];
  const bsdfClosed = simFiles['bsdf-closed-file'] || config.recipe['bsdf-closed-file'];

  if ((bsdfOpen && !bsdfClosed) || (!bsdfOpen && bsdfClosed)) {
    addWarning(
      result,
      'Lighting Energy: Only one of bsdf-open-file / bsdf-closed-file is set. The legacy workflow expects a consistent BSDF pair if dynamic shading is modeled.'
    );
  }

  return result;
}

function generateScripts(projectData, config) {
  const { globalParams = {}, recipeOverrides = {} } = config._raw || {};
  const mergedSimParams = { ...globalParams, ...recipeOverrides };
  const legacyLike = { ...projectData, mergedSimParams };
  return legacyGenerateScripts(legacyLike, RECIPE_ID);
}

registerRecipe({
  id: RECIPE_ID,
  name: 'Recipe: Lighting Energy (Daylight Controls)',
  description: 'Estimates relative lighting energy savings based on annual illuminance results and control strategies.',
  category: 'analysis',
  inputSchema,
  environment,
  dependencies: [],
  // Expected outputs:
  // - Aggregated lighting control metrics compatible with 'lighting-energy'.
  resultTypes: ['lighting-energy'],
  validate,
  generateScripts
});
