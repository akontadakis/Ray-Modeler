import { registerRecipe, createValidationResult, addError, addWarning } from './RecipeRegistry.js';
import { generateScripts as legacyGenerateScripts } from '../scriptGenerator.js';

const RECIPE_ID = 'template-recipe-sda-ase';

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
    'bsdf-open-file': { type: 'file', required: true },
    'bsdf-closed-file': { type: 'file', required: true },
    'blinds-threshold-lux': { type: 'number' },
    'blinds-trigger-percent': { type: 'number' }
  },
  requiredFiles: ['weather-file', 'bsdf-open-file', 'bsdf-closed-file'],
  requiredResources: {
    needsSensorGrid: true
  }
};

const environment = {
  supportedEnvironments: ['electron-posix', 'electron-win', 'browser-instructions'],
  shells: ['bash'], // complex bash workflow; BAT is stub/limited
  dependencies: ['radiance', 'python3'],
  bashOnly: true
};

function validate(projectData, config) {
  const result = createValidationResult();

  if (!projectData.geometry || !projectData.geometry.room) {
    addError(result, 'sDA/ASE: No room geometry found. Define geometry before running this recipe.');
  }

  // Require at least one illuminance sensor grid
  const hasIllGrid =
    !!projectData.sensorGrids?.illuminance?.floor?.enabled ||
    !!projectData.sensorGrids?.illuminance?.walls ||
    !!projectData.sensorGrids?.illuminance?.ceiling;
  if (!hasIllGrid) {
    addError(result, 'sDA/ASE: No illuminance sensor grid defined. Enable a grid in the Sensor Grid panel.');
  }

  // Required files: EPW + BSDFs (open/closed)
  const simFiles = projectData.simulationFiles || {};
  const epw = simFiles['weather-file'] || config.recipe['weather-file'];
  const bsdfOpen = simFiles['bsdf-open-file'] || config.recipe['bsdf-open-file'];
  const bsdfClosed = simFiles['bsdf-closed-file'] || config.recipe['bsdf-closed-file'];

  if (!epw || !epw.name) {
    addError(result, 'sDA/ASE: Weather file is required. Please select an EPW file.');
  }
  if (!bsdfOpen || !bsdfOpen.name) {
    addError(result, 'sDA/ASE: BSDF (open state) is required. Select bsdf-open-file.');
  }
  if (!bsdfClosed || !bsdfClosed.name) {
    addError(result, 'sDA/ASE: BSDF (closed state) is required. Select bsdf-closed-file.');
  }

  // Check that 3-phase matrices are likely present; if not, warn (do not hard fail to preserve legacy behavior).
  const hasMatrices =
    !!simFiles['view-mtx'] ||
    !!simFiles['daylight-mtx'] ||
    (projectData.simulationFiles && Object.keys(projectData.simulationFiles).some(k => k.includes('matrices')));
  if (!hasMatrices) {
    addWarning(
      result,
      'sDA/ASE: This workflow assumes 3-Phase matrices (view.mtx, daylight.mtx) have been generated. ' +
        'Run the "Annual Daylight (3-Phase)" recipe first or ensure equivalent matrices exist.'
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
  name: 'Recipe: sDA & ASE (LM-83)',
  description:
    'Computes sDA and ASE using 3-Phase matrices with dynamic shading based on blinds thresholds from LM-83.',
  category: 'annual',
  inputSchema,
  environment,
  validate,
  generateScripts
});
