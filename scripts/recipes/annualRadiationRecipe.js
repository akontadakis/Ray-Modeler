import { registerRecipe, createValidationResult, addError } from './RecipeRegistry.js';
import { generateScripts as legacyGenerateScripts } from '../scriptGenerator.js';

const RECIPE_ID = 'template-recipe-annual-radiation';

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
    'weather-file': { type: 'string' }
  },
  requiredFiles: ['weather-file'],
  requiredResources: {
    needsSensorGrid: true
  }
};

const environment = {
  supportedEnvironments: ['electron-posix', 'electron-win', 'browser-instructions'],
  shells: ['bash'],
  dependencies: ['radiance'],
  bashOnly: true
};

function validate(projectData, config) {
  const result = createValidationResult();

  if (!projectData.geometry || !projectData.geometry.room) {
    addError(
      result,
      'Annual Radiation: No room geometry found. Define geometry before running this recipe.'
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
      'Annual Radiation: Weather file is required. Please select an EPW file.'
    );
  }

  const sensorGrids = projectData.sensorGrids || {};
  const hasIllGrid =
    !!sensorGrids.illuminance?.floor?.enabled ||
    !!sensorGrids.illuminance?.ceiling?.enabled ||
    !!sensorGrids.illuminance?.walls;

  if (!hasIllGrid) {
    addError(
      result,
      'Annual Radiation: Requires at least one illuminance sensor grid (floor / ceiling / walls). Enable and configure a grid before running.'
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
  name: 'Recipe: Annual Radiation (3-Phase)',
  description: 'Computes annual solar radiation on sensor grids using a 3-phase-like method.',
  category: 'annual',
  inputSchema,
  environment,
  dependencies: [],
  // Expected outputs: scalar grids / annual series compatible with generic-scalar-grid.
  resultTypes: ['generic-scalar-grid'],
  validate,
  generateScripts
});
