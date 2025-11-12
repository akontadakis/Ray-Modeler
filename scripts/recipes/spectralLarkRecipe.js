import { registerRecipe, createValidationResult, addError, addWarning } from './RecipeRegistry.js';
import { generateScripts as legacyGenerateScripts } from '../scriptGenerator.js';

const RECIPE_ID = 'template-recipe-spectral-lark';

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
    'lark-month': { type: 'number' },
    'lark-day': { type: 'number' },
    'lark-time': { type: 'number' },
    'lark-dni': { type: 'number', optional: true },
    'lark-dhi': { type: 'number', optional: true },
    'lark-sun-spd': { type: 'string' },
    'lark-sky-spd': { type: 'string' },
    'wall-srd-file': { type: 'string', optional: true },
    'floor-srd-file': { type: 'string', optional: true },
    'ceiling-srd-file': { type: 'string', optional: true }
  },
  requiredFiles: [
    'lark-sun-spd',
    'lark-sky-spd'
  ],
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
      'Spectral Lark: No room geometry found. Define geometry before running this recipe.'
    );
  }

  const sensorGrids = projectData.sensorGrids || {};
  const hasIllFloor =
    !!sensorGrids.illuminance?.floor?.enabled &&
    !!sensorGrids.illuminance.floor.spacing;

  if (!hasIllFloor) {
    addError(
      result,
      'Spectral Lark: Requires an illuminance floor grid for spectral evaluation. Enable and configure it before running.'
    );
  }

  const simFiles = projectData.simulationFiles || {};

  const sunSpd =
    simFiles['lark-sun-spd'] ||
    simFiles[config.recipe['lark-sun-spd']] ||
    config.recipe['lark-sun-spd'];

  const skySpd =
    simFiles['lark-sky-spd'] ||
    simFiles[config.recipe['lark-sky-spd']] ||
    config.recipe['lark-sky-spd'];

  if (!sunSpd) {
    addError(
      result,
      'Spectral Lark: lark-sun-spd (solar SPD file) is required.'
    );
  }
  if (!skySpd) {
    addError(
      result,
      'Spectral Lark: lark-sky-spd (sky SPD file) is required.'
    );
  }

  const month = Number(config.recipe['lark-month']);
  const day = Number(config.recipe['lark-day']);
  const time = Number(config.recipe['lark-time']);
  if (!Number.isFinite(month) || month < 1 || month > 12) {
    addError(result, 'Spectral Lark: lark-month must be between 1 and 12.');
  }
  if (!Number.isFinite(day) || day < 1 || day > 31) {
    addError(result, 'Spectral Lark: lark-day must be between 1 and 31.');
  }
  if (!Number.isFinite(time) || time < 0 || time > 24) {
    addError(result, 'Spectral Lark: lark-time must be between 0 and 24 (decimal hours).');
  }

  // Warn if SRD materials are referenced but not present.
  ['wall-srd-file', 'floor-srd-file', 'ceiling-srd-file'].forEach(key => {
    const ref = config.recipe[key];
    if (ref && !simFiles[key] && !simFiles[ref]) {
      addWarning(
        result,
        `Spectral Lark: ${key} is set but the referenced SRD file is not found in simulation files.`
      );
    }
  });

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
  name: 'Recipe: Spectral Lark / Circadian',
  description: 'Runs the Lark toolkit or equivalent spectral pipeline to compute circadian metrics.',
  category: 'analysis',
  inputSchema,
  environment,
  dependencies: [],
  // Expected outputs:
  // - circadian_summary.json → 'circadian-summary'
  // - circadian_per_point.csv → 'circadian-per-point'
  resultTypes: ['circadian-summary', 'circadian-per-point'],
  validate,
  generateScripts
});
