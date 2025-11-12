import { registerRecipe, createValidationResult, addError, addWarning } from './RecipeRegistry.js';
import { generateScripts as legacyGenerateScripts } from '../scriptGenerator.js';

const RECIPE_ID = 'template-recipe-en-ugr';

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
    'ugr-limit': { type: 'number' }
  },
  requiredFiles: [],
  requiredResources: {
    needsView: true,
    needsFisheyeView: true
  }
};

const environment = {
  supportedEnvironments: ['electron-posix', 'electron-win', 'browser-instructions'],
  shells: ['bash'],
  dependencies: ['radiance', 'evalglare'],
  bashOnly: true
};

function validate(projectData, config) {
  const result = createValidationResult();

  if (!projectData.geometry || !projectData.geometry.room) {
    addError(result, 'EN 12464-1 UGR: No room geometry found. Define geometry before running this recipe.');
  }

  // Fisheye view is required for UGR HDR evaluation
  const simFiles = projectData.simulationFiles || {};
  const hasFisheyeVf =
    !!simFiles['viewpoint_fisheye.vf'] ||
    !!simFiles['viewpoint-fisheye-file'] ||
    (projectData.views && projectData.views.some(v => v.type === 'fisheye'));

  if (!hasFisheyeVf) {
    addError(
      result,
      'EN 12464-1 UGR: No fisheye viewpoint found. Create a fisheye view (viewpoint_fisheye.vf) before running this recipe.'
    );
  }

  const ugrLimit = config.recipe['ugr-limit'];
  if (ugrLimit !== undefined && ugrLimit !== null) {
    const n = Number(ugrLimit);
    if (Number.isNaN(n) || n <= 0 || n > 28) {
      addWarning(
        result,
        'EN 12464-1 UGR: ugr-limit is outside a typical range. Check that the specified limit is appropriate for the task area.'
      );
    }
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
  name: 'Recipe: EN 12464-1 UGR',
  description: 'Evaluates Unified Glare Rating (UGR) according to EN 12464-1 based on rendered HDR images.',
  category: 'compliance',
  inputSchema,
  environment,
  dependencies: [],
  // Expected outputs:
  // - Point-in-time glare evaluations compatible with 'evalglare-pit' (per-view HDR glare metrics).
  resultTypes: ['evalglare-pit'],
  validate,
  generateScripts
});
