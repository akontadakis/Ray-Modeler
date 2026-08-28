import { registerRecipe, createValidationResult, addError, addWarning } from './RecipeRegistry.js';
import { generateScripts as legacyGenerateScripts } from '../scriptGenerator.js';

const RECIPE_ID = 'template-recipe-spectral-9ch';

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
    'spectral-month': { type: 'number' },
    'spectral-day': { type: 'number' },
    'spectral-time': { type: 'string' },
    'spectral-dni': { type: 'number', optional: true },
    'spectral-dhi': { type: 'number', optional: true },
    'spectral-sun-spd': { type: 'string' },
    'spectral-sky-spd': { type: 'string' },
    'wall-srd-file': { type: 'string', optional: true },
    'floor-srd-file': { type: 'string', optional: true },
    'ceiling-srd-file': { type: 'string', optional: true }
  },
  requiredFiles: [
    'spectral-sun-spd',
    'spectral-sky-spd'
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

function _toDecimalHour(value) {
  if (value == null || value === '') return NaN;
  const str = String(value);
  const match = str.match(/^(\d{1,2}):(\d{2})$/);
  if (match) {
    const h = Number(match[1]);
    const m = Number(match[2]);
    if (m > 59) return NaN;
    return h + m / 60;
  }
  const num = Number(str);
  return Number.isFinite(num) ? num : NaN;
}

function validate(projectData, config) {
  const result = createValidationResult();

  if (!projectData.geometry || !projectData.geometry.room) {
    addError(
      result,
      'Spectral Analysis (9-Channel): No room geometry found. Define geometry before running this recipe.'
    );
  }

  const sensorGrids = projectData.sensorGrids || {};
  const hasIllFloor =
    !!sensorGrids.illuminance?.floor?.enabled &&
    !!sensorGrids.illuminance.floor.spacing;

  if (!hasIllFloor) {
    addError(
      result,
      'Spectral Analysis (9-Channel): Requires an illuminance floor grid for spectral evaluation. Enable and configure it before running.'
    );
  }

  const simFiles = projectData.simulationFiles || {};

  const sunSpd =
    simFiles['spectral-sun-spd'] ||
    simFiles[config.recipe['spectral-sun-spd']] ||
    config.recipe['spectral-sun-spd'];

  const skySpd =
    simFiles['spectral-sky-spd'] ||
    simFiles[config.recipe['spectral-sky-spd']] ||
    config.recipe['spectral-sky-spd'];

  if (!sunSpd) {
    addError(
      result,
      'Spectral Analysis (9-Channel): a solar SPD file is required.'
    );
  }
  if (!skySpd) {
    addError(
      result,
      'Spectral Analysis (9-Channel): a sky SPD file is required.'
    );
  }

  const month = Number(config.recipe['spectral-month']);
  const day = Number(config.recipe['spectral-day']);
  // The panel uses an <input type="time"> (HH:MM). Older configs may hold a
  // decimal hour. Accept both and normalise to decimal hours.
  const time = _toDecimalHour(config.recipe['spectral-time']);
  if (!Number.isFinite(month) || month < 1 || month > 12) {
    addError(result, 'Spectral Analysis (9-Channel): month must be between 1 and 12.');
  }
  if (!Number.isFinite(day) || day < 1 || day > 31) {
    addError(result, 'Spectral Analysis (9-Channel): day must be between 1 and 31.');
  }
  if (!Number.isFinite(time) || time < 0 || time > 24) {
    addError(result, 'Spectral Analysis (9-Channel): time must be a valid HH:MM value between 00:00 and 24:00.');
  }

  // Warn if SRD materials are referenced but not present.
  ['wall-srd-file', 'floor-srd-file', 'ceiling-srd-file'].forEach(key => {
    const ref = config.recipe[key];
    if (ref && !simFiles[key] && !simFiles[ref]) {
      addWarning(
        result,
        `Spectral Analysis (9-Channel): ${key} is set but the referenced SRD file is not found in simulation files.`
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
  name: 'Recipe: Spectral Analysis (9-Channel) / Circadian',
  description: 'Runs the 9-channel spectral pipeline to compute circadian metrics.',
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
