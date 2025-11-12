import { registerRecipe, createValidationResult, addError, addWarning } from './RecipeRegistry.js';
import { generateScripts as legacyGenerateScripts } from '../scriptGenerator.js';

const RECIPE_ID = 'template-recipe-dgp';

const inputSchema = {
  globalParams: {
    ab: { type: 'number' },
    ad: { type: 'number' },
    as: { type: 'number' },
    ar: { type: 'number' },
    aa: { type: 'number' }
  },
  recipeParams: {
    'pit-month': { type: 'number', required: true },
    'pit-day': { type: 'number', required: true },
    'pit-time': { type: 'string', required: true },
    'dgp-x-res': { type: 'number' },
    'dgp-y-res': { type: 'number' },
    'evalglare-c': { type: 'boolean' },
    'evalglare-d': { type: 'boolean' },
    'evalglare-t': { type: 'boolean' }
  },
  requiredFiles: [],
  requiredResources: {
    needsView: true,
    needsFisheyeView: true
  }
};

const environment = {
  supportedEnvironments: ['electron-posix', 'electron-win', 'browser-instructions'],
  shells: ['bash', 'cmd'],
  dependencies: ['radiance', 'evalglare']
};

function validate(projectData, config) {
  const result = createValidationResult();

  if (!projectData.geometry || !projectData.geometry.room) {
    addError(result, 'No room geometry found. Define geometry before running the DGP recipe.');
  }

  const viewFiles = projectData.simulationFiles || {};
  const hasFisheye =
    !!viewFiles['viewpoint_fisheye.vf'] ||
    !!viewFiles['viewpoint_fisheye-file'] ||
    (projectData.views && projectData.views.some(v => v.type === 'fisheye'));

  if (!hasFisheye) {
    addWarning(
      result,
      'No fisheye viewpoint detected. Ensure a fisheye view (viewpoint_fisheye.vf) is defined for accurate glare analysis.'
    );
  }

  const m = config.recipe['pit-month'];
  const d = config.recipe['pit-day'];
  const t = config.recipe['pit-time'];

  if (!(m >= 1 && m <= 12)) {
    addError(result, 'DGP: Invalid month. Set pit-month between 1 and 12.');
  }
  if (!(d >= 1 && d <= 31)) {
    addError(result, 'DGP: Invalid day. Set pit-day between 1 and 31.');
  }
  if (!t || !/^\d{1,2}:\d{2}$/.test(String(t))) {
    addError(result, 'DGP: Invalid time. Use HH:MM (24h) format for pit-time.');
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
  name: 'Recipe: Annual Glare (DGP)',
  description: 'Runs evalglare over annual HDR frames or imageless pipeline to produce DGP-based glare metrics.',
  category: 'annual',
  inputSchema,
  environment,
  dependencies: [],
  // Expected outputs:
  // - Annual DGP grids/series compatible with 'annual-glare-dgp' descriptor.
  resultTypes: ['annual-glare-dgp'],
  validate,
  generateScripts
});
