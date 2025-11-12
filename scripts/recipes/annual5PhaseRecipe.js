import { registerRecipe, createValidationResult, addError, addWarning } from './RecipeRegistry.js';
import { generateScripts as legacyGenerateScripts } from '../scriptGenerator.js';

const RECIPE_ID = 'template-recipe-annual-5ph';

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
    'weather-file': { type: 'file', required: true },
    'bsdf-klems': { type: 'file', required: true },
    'bsdf-tensor': { type: 'file' } // optional / only if referenced by scripts
  },
  requiredFiles: ['weather-file', 'bsdf-klems'],
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
    addError(result, 'Annual 5-Phase: No room geometry found. Define geometry before running this recipe.');
  }

  // Require at least one illuminance grid (grid.pts is needed)
  const hasIllGrid =
    !!projectData.sensorGrids?.illuminance?.floor?.enabled ||
    !!projectData.sensorGrids?.illuminance?.walls ||
    !!projectData.sensorGrids?.illuminance?.ceiling;
  if (!hasIllGrid) {
    addError(result, 'Annual 5-Phase: No illuminance sensor grid defined. Enable a grid to generate sensor points.');
  }

  const simFiles = projectData.simulationFiles || {};
  const epw = simFiles['weather-file'] || config.recipe['weather-file'];
  const klems = simFiles['bsdf-klems'] || config.recipe['bsdf-klems'];

  if (!epw || !epw.name) {
    addError(result, 'Annual 5-Phase: Weather file is required. Please select an EPW file.');
  }
  if (!klems || !klems.name) {
    addError(result, 'Annual 5-Phase: Klems BSDF file is required. Select bsdf-klems.');
  }

  // If tensor BSDF is referenced in scripts, require it; here we warn instead of hard-failing to preserve behavior.
  const tensor = simFiles['bsdf-tensor'] || config.recipe['bsdf-tensor'];
  if (!tensor || !tensor.name) {
    addWarning(
      result,
      'Annual 5-Phase: No tensor BSDF specified (bsdf-tensor). If your 5-phase workflow expects a tensor BSDF for direct sun, please provide it.'
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
  name: 'Recipe: Annual Daylight (5-Phase)',
  description: 'High-accuracy annual daylight simulation using the 5-phase method.',
  category: 'annual',
  inputSchema,
  environment,
  dependencies: [],
  // Expected outputs: annual illuminance (.ill) compatible with 'annual-illuminance'.
  resultTypes: ['annual-illuminance'],
  validate,
  generateScripts
});
