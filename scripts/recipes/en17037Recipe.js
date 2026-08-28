import { registerRecipe, createValidationResult, addError, addWarning } from './RecipeRegistry.js';
import { generateScripts as legacyGenerateScripts } from '../scriptGenerator.js';

const RECIPE_ID = 'template-recipe-en17037';

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
    // These MUST match the control ids in #template-recipe-en17037 (index.html)
    // and the keys scriptGenerator.js reads. The previous 'check-*' names existed
    // nowhere, so every compliance flag resolved to false and validate() was inert.
    'en17037-provision-toggle': { type: 'boolean', default: true },
    'en17037-view-toggle': { type: 'boolean', default: true },
    'en17037-sunlight-toggle': { type: 'boolean', default: true },
    'en17037-glare-toggle': { type: 'boolean', default: true },
    // Quantitative view-factor sub-check of the "View Out" pillar.
    'en17037-view-factor-toggle': { type: 'boolean', default: false },
    // Target performance levels (minimum / medium / high).
    'en17037-provision-level': { type: 'string' },
    'en17037-view-level': { type: 'string' },
    'en17037-sunlight-level': { type: 'string' },
    'en17037-glare-level': { type: 'string' },
    'en17037-sunlight-date': { type: 'string' }
  },
  requiredFiles: [],
  requiredResources: {
    // EN 17037 relies on underlying annual daylight and glare recipes.
    needsSensorGrid: true,
    needsView: true
  }
};

const environment = {
  supportedEnvironments: ['electron-posix', 'electron-win', 'browser-instructions'],
  shells: ['bash'],
  dependencies: [
    'radiance',
    'python3',
    // Underlying sub-recipes:
    'evalglare',
    'dcglare'
  ],
  bashOnly: true
};

function validate(projectData, config) {
  const result = createValidationResult();

  if (!projectData.geometry || !projectData.geometry.room) {
    addError(
      result,
      'EN 17037: No room geometry found. Define geometry before running this recipe.'
    );
  }

  const sensorGrids = projectData.sensorGrids || {};
  const hasFloorIllGrid =
    !!sensorGrids.illuminance?.floor?.enabled &&
    !!sensorGrids.illuminance.floor.spacing;

  const simFiles = projectData.simulationFiles || {};
  const hasEpw =
    !!projectData.epwFileContent ||
    !!projectData.projectInfo?.epwFileName ||
    !!simFiles['weather-file'];

  const flags = {
    daylight: !!config.recipe['en17037-provision-toggle'],
    viewOut: !!config.recipe['en17037-view-toggle'],
    sunlight: !!config.recipe['en17037-sunlight-toggle'],
    glare: !!config.recipe['en17037-glare-toggle']
  };

  // Require at least one check; otherwise nothing meaningful will run.
  if (!flags.daylight && !flags.viewOut && !flags.sunlight && !flags.glare) {
    addWarning(
      result,
      'EN 17037: No sub-checks enabled. Enable at least one of daylight provision, view out, sunlight exposure, or glare protection.'
    );
  }

  if (flags.daylight || flags.sunlight || flags.glare) {
    if (!hasEpw) {
      addError(
        result,
        'EN 17037: Weather file is required for daylight provision, sunlight exposure, or glare checks. Please select an EPW file.'
      );
    }
  }

  if (flags.daylight) {
    // The daylight-provision pillar delegates to the 3-phase recipe, whose
    // dctimestep run needs a Klems BSDF for the glazing. EN 17037 never checked
    // for one, so the package generated cleanly and then died minutes later at
    // 'Cannot open BSDF "../05_bsdf/window.xml"'.
    const hasBsdf = !!simFiles['bsdf-file'] || !!config.recipe['bsdf-file'];
    if (!hasBsdf) {
      addError(
        result,
        'EN 17037: The daylight provision check runs the 3-phase method, which requires a Klems BSDF XML for the window system (bsdf-file). Select one, or turn the daylight provision check off.'
      );
    }
    if (!hasFloorIllGrid) {
      addError(
        result,
        'EN 17037: Daylight provision check requires an illuminance floor grid. Enable and configure the floor grid before running.'
      );
    }
  }

  if (flags.glare) {
    const hasViewRays =
      !!simFiles['view_grid.ray'] ||
      !!simFiles['view-grid-file'] ||
      !!sensorGrids.view?.enabled;
    if (!hasViewRays) {
      addError(
        result,
        'EN 17037: Glare protection check requires a view grid / view rays. Enable the view grid to generate view_grid.ray before running.'
      );
    }
  }

  // View-out and sunlight-exposure checks mainly rely on geometry and EPW (for sunlight).
  // The precise geometric validation is handled in the legacy script; keep here conservative.
  if (flags.viewOut && !hasFloorIllGrid) {
    addWarning(
      result,
      'EN 17037: View-out check enabled. Ensure geometry and window configuration reflect the final design. No strict pre-check is applied here.'
    );
  }

  return result;
}

function generateScripts(projectData, config) {
  // This recipe is an orchestrator that delegates to the legacy implementation,
  // which in turn calls the appropriate underlying annual/glare recipes.
  const { globalParams = {}, recipeOverrides = {} } = config._raw || {};
  const mergedSimParams = { ...globalParams, ...recipeOverrides };

  const legacyLike = {
    ...projectData,
    mergedSimParams
  };

  return legacyGenerateScripts(legacyLike, RECIPE_ID);
}

registerRecipe({
  id: RECIPE_ID,
  name: 'Recipe: EN 17037 Daylight',
  description: 'Evaluates daylight provision according to EN 17037 using annual daylight results.',
  category: 'compliance',
  inputSchema,
  environment,
  dependencies: [],
  // Expected outputs:
  // - Assessment based on annual illuminance (.ill) → leverages 'annual-illuminance'.
  // - Any produced scalar grids are compatible with 'generic-scalar-grid'.
  resultTypes: ['annual-illuminance', 'generic-scalar-grid'],
  validate,
  generateScripts
});
