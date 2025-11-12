import { registerRecipe, createValidationResult, addError } from './RecipeRegistry.js';
import { generateScripts as legacyGenerateScripts } from '../scriptGenerator.js';

const RECIPE_ID = 'template-recipe-facade-irradiation';

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
    'facade-selection': { type: 'string' }, // e.g. N,S,E,W,ALL or legacy-specific token
    'facade-offset': { type: 'number', optional: true },
    'facade-grid-spacing': { type: 'number', optional: true }
  },
  requiredFiles: ['weather-file'],
  requiredResources: {
    needsSensorGrid: false
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
      'Facade Irradiation: No room geometry found. Define geometry before running this recipe.'
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
      'Facade Irradiation: Weather file is required. Please select an EPW file.'
    );
  }

  const selection = (config.recipe['facade-selection'] || '').toString().toUpperCase();
  if (!selection) {
    addError(
      result,
      'Facade Irradiation: facade-selection is required (e.g. N, S, E, W, ALL).'
    );
  }

  const spacing = Number(config.recipe['facade-grid-spacing'] ?? 0);
  if (spacing !== 0 && (Number.isNaN(spacing) || spacing <= 0)) {
    addError(
      result,
      'Facade Irradiation: facade-grid-spacing must be a positive number if set.'
    );
  }

  const offset = Number(config.recipe['facade-offset'] ?? 0);
  if (Number.isNaN(offset)) {
    addError(
      result,
      'Facade Irradiation: facade-offset must be numeric.'
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
  name: 'Recipe: Facade Irradiation',
  description: 'Computes solar irradiation on facade elements over the year.',
  category: 'annual',
  inputSchema,
  environment,
  dependencies: [],
  // Expected outputs:
  // - Annual irradiation values on facade elements compatible with 'generic-scalar-grid'.
  resultTypes: ['generic-scalar-grid'],
  validate,
  generateScripts
});
