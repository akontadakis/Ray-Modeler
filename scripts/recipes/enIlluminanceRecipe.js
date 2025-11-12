import { registerRecipe, createValidationResult, addError } from './RecipeRegistry.js';
import { generateScripts as legacyGenerateScripts } from '../scriptGenerator.js';

const RECIPE_ID = 'template-recipe-en-illuminance';

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
    // This recipe primarily reuses global Radiance params and generated task/surrounding grids.
    // If you add dedicated UI fields for EN 12464-1 thresholds, define them here.
  },
  requiredFiles: [],
  requiredResources: {
    needsSensorGrid: true
  }
};

const environment = {
  supportedEnvironments: ['electron-posix', 'electron-win', 'browser-instructions'],
  shells: ['bash'],
  dependencies: ['radiance', 'rcalc', 'total', 'bc'],
  bashOnly: true
};

function validate(projectData) {
  const result = createValidationResult();

  if (!projectData.geometry || !projectData.geometry.room) {
    addError(
      result,
      'EN 12464-1 Illuminance: No room geometry found. Define geometry before running this recipe.'
    );
  }

  // This workflow expects task_grid.pts and surrounding_grid.pts generated in 08_results.
  const simFiles = projectData.simulationFiles || {};
  const hasTaskGrid =
    !!simFiles['task-grid-file'] ||
    !!simFiles['task_grid.pts'] ||
    false; // rely on generated files; we only know presence via simulation package outputs, so be conservative

  const hasSurroundGrid =
    !!simFiles['surrounding-grid-file'] ||
    !!simFiles['surrounding_grid.pts'] ||
    false;

  // We cannot reliably see generated grid files in projectData.simulationFiles before writing,
  // so we instead enforce that an illuminance floor grid is configured.
  const hasFloorGrid =
    !!projectData.sensorGrids?.illuminance?.floor?.enabled &&
    !!projectData.sensorGrids.illuminance.floor.isTaskArea;

  if (!hasFloorGrid) {
    addError(
      result,
      'EN 12464-1 Illuminance: Task-area floor grid must be enabled and configured. ' +
        'Enable the floor grid and define a task area before running this recipe.'
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
  name: 'Recipe: EN 12464-1 Illuminance',
  description: 'Checks maintained illuminance levels against EN 12464-1 requirements.',
  category: 'compliance',
  inputSchema,
  environment,
  dependencies: [],
  // Expected outputs:
  // - Point-in-time / maintained illuminance grids compatible with 'generic-scalar-grid'.
  resultTypes: ['generic-scalar-grid'],
  validate,
  generateScripts
});
