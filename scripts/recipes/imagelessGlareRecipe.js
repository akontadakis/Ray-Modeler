import { registerRecipe, createValidationResult, addError, addWarning } from './RecipeRegistry.js';
import { generateScripts as legacyGenerateScripts } from '../scriptGenerator.js';

const RECIPE_ID = 'template-recipe-imageless-glare';

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
    'occupancy-schedule': { type: 'file' },
    'glare-threshold': { type: 'number' },
    'glare-autonomy-target': { type: 'number' }
  },
  requiredFiles: ['weather-file'],
  requiredResources: {
    needsView: true
  }
};

const environment = {
  supportedEnvironments: ['electron-posix', 'electron-win', 'browser-instructions'],
  shells: ['bash'],
  dependencies: ['radiance', 'dcglare'],
  bashOnly: true
};

function validate(projectData, config) {
  const result = createValidationResult();

  if (!projectData.geometry || !projectData.geometry.room) {
    addError(result, 'Imageless Glare: No room geometry found. Define geometry before running this recipe.');
  }

  // Requires view rays file for imageless glare (view_grid.ray)
  const simFiles = projectData.simulationFiles || {};
  const hasViewRays =
    !!simFiles['view_grid.ray'] ||
    !!simFiles['view-rays-file'] ||
    (projectData.sensorGrids?.view && projectData.sensorGrids.view.enabled);

  if (!hasViewRays) {
    addError(
      result,
      'Imageless Glare: No view rays file found. Enable and generate a view grid to create view_grid.ray before running this recipe.'
    );
  }

  // Required EPW
  const epw = simFiles['weather-file'] || config.recipe['weather-file'];
  if (!epw || !epw.name) {
    addError(result, 'Imageless Glare: Weather file is required. Please select an EPW file.');
  }

  // Thresholds sanity (do not fail unless clearly nonsense)
  const thr = config.recipe['glare-threshold'];
  if (thr !== undefined && thr !== null && (Number.isNaN(thr) || thr <= 0 || thr >= 1)) {
    addWarning(
      result,
      'Imageless Glare: glare-threshold is outside (0,1). Using extreme thresholds may make results meaningless.'
    );
  }

  const gaTarget = config.recipe['glare-autonomy-target'];
  if (gaTarget !== undefined && gaTarget !== null && (Number.isNaN(gaTarget) || gaTarget <= 0 || gaTarget > 100)) {
    addWarning(
      result,
      'Imageless Glare: glare-autonomy-target should be a percentage in (0,100]. Check your input.'
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
  name: 'Recipe: Imageless Glare',
  description: 'Estimates glare metrics using sensor grids and simplified imageless approaches.',
  category: 'analysis',
  inputSchema,
  environment,
  dependencies: [],
  // Expected outputs:
  // - Point-in-time or derived glare metrics compatible with 'evalglare-pit' / scalar grids.
  // (Kept conservative; update if/when imageless pipeline writes annual .dgp/.ga.)
  resultTypes: ['evalglare-pit', 'generic-scalar-grid'],
  validate,
  generateScripts
});
