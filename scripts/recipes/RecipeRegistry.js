// scripts/recipes/RecipeRegistry.js
//
// Canonical registry and interfaces for Simulation Recipes.
// This file is the single source of truth for recipe metadata and contracts.
//
// NOTE:
// - Keep this file UI-agnostic: no direct DOM access.
// - Keep this file environment-agnostic: no direct window/electron usage.
// - scriptGenerator.js and UI code should depend on this registry,
//   not the other way around.

/**
 * @typedef {'electron-posix' | 'electron-win' | 'browser-instructions'} EnvironmentId
 * @typedef {'bash' | 'cmd'} ShellId
 * @typedef {'radiance' | 'python3' | 'accelerad'} ToolId
 */

/**
 * @typedef {Object} ParamSpec
 * @property {'string' | 'number' | 'boolean' | 'enum'} type
 * @property {'global' | 'recipe' | 'projectInfo' | 'simulationFiles'=} source
 * @property {boolean=} required
 * @property {any=} default
 * @property {string[]=} enumValues
 * @property {string=} description
 */

/**
 * @typedef {Object} RecipeEnvironmentSpec
 * @property {EnvironmentId[]} supportedEnvironments
 * @property {ShellId[]} shells
 * @property {ToolId[]} dependencies
 * @property {boolean=} bashOnly - If true, no first-class .bat support is guaranteed.
 */

/**
 * @typedef {Object} RecipeInputSchema
 * @property {Object.<string, ParamSpec>} globalParams
 * @property {Object.<string, ParamSpec>} recipeParams
 * @property {string[]=} requiredFiles - Keys in project.simulationFiles expected by this recipe.
 * @property {Object=} requiredResources
 * @property {boolean=} requiredResources.needsSensorGrid
 * @property {boolean=} requiredResources.needsView
 * @property {boolean=} requiredResources.needsFisheyeView
 * @property {boolean=} requiredResources.needsOccupancySchedule
 * @property {boolean=} requiredResources.needsBSDF
 */

/**
 * @typedef {Object} ValidationResult
 * @property {string[]} errors
 * @property {string[]} warnings
 */

/**
 * @typedef {Object} ScriptSpec
 * @property {string} fileName
 * @property {string} content
 */

/**
 * @typedef {Object} RecipeDefinition
 * @property {string} id                    - Template id, e.g. 'template-recipe-illuminance'
 * @property {string} name                  - Human-readable name used in UI
 * @property {string} description
 * @property {string} category              - e.g. 'point-in-time', 'annual', 'compliance', etc.
 * @property {RecipeInputSchema} inputSchema
 * @property {RecipeEnvironmentSpec} environment
 * @property {string[]=} dependencies       - Other recipe IDs this one logically depends on
 * @property {string[]=} [resultTypes]      - ResultRegistry type IDs this recipe is expected to produce
 * @property {(projectData: any, config: any) => ValidationResult} validate
 *           - Validate inputs and environment; must be side-effect free
 * @property {(projectData: any, config: any) => ScriptSpec[]} generateScripts
 *           - Generate scripts; pure function. No DOM, no fs, no electron.
 *
 * NOTE:
 * - Config objects passed into validate()/generateScripts() are constructed by
 *   the central helpers in configMappers.js (getActiveRecipeSelection +
 *   buildRecipeConfig). Individual recipes MUST treat validate/generateScripts
 *   as pure functions over that config and MUST NOT read from the DOM.
 */

/**
 * Internal registry store.
 * @type {Map<string, RecipeDefinition>}
 */
const recipes = new Map();

/**
 * Register a recipe definition.
 * This is intentionally simple; call from dedicated recipe definition modules.
 * @param {RecipeDefinition} def
 */
export function registerRecipe(def) {
  if (!def || !def.id) {
    throw new Error('Recipe definition must include an id');
  }
  if (recipes.has(def.id)) {
    console.warn(`Recipe with id "${def.id}" is already registered. Overwriting.`);
  }
  recipes.set(def.id, def);
}

/**
 * Get a recipe by id.
 * @param {string} id
 * @returns {RecipeDefinition | null}
 */
export function getRecipeById(id) {
  return recipes.get(id) || null;
}

/**
 * Get all registered recipes.
 * @returns {RecipeDefinition[]}
 */
export function getAllRecipes() {
  return Array.from(recipes.values());
}

/**
 * Helper: merge global and recipe-specific params with explicit precedence.
 *
 * Precedence:
 *  - recipeOverrides[key] (from active recipe UI)
 *  - globalParams[key]    (from global panel)
 *  - fallback             (from ParamSpec.default)
 *
 * This does not perform schema validation; individual recipes should call this
 * and then run validate().
 *
 * @param {Object} globalParams
 * @param {Object} recipeOverrides
 * @param {Object.<string, ParamSpec>} schema
 * @returns {Object} resolved
 */
export function mergeParamsWithSchema(globalParams, recipeOverrides, schema) {
  const resolved = {};
  const g = globalParams || {};
  const r = recipeOverrides || {};

  Object.entries(schema || {}).forEach(([key, spec]) => {
    let value;

    // Precedence: recipe-specific -> global -> default
    if (Object.prototype.hasOwnProperty.call(r, key) && r[key] !== undefined && r[key] !== null && r[key] !== '') {
      value = r[key];
    } else if (Object.prototype.hasOwnProperty.call(g, key) && g[key] !== undefined && g[key] !== null && g[key] !== '') {
      value = g[key];
    } else if ('default' in spec) {
      value = spec.default;
    } else {
      value = undefined;
    }

    // Basic type normalization (non-strict; detailed checks in validate()).
    if (value !== undefined && value !== null) {
      switch (spec.type) {
        case 'number':
          value = typeof value === 'number' ? value : parseFloat(value);
          break;
        case 'boolean':
          if (typeof value !== 'boolean') {
            value = value === 'true' || value === true;
          }
          break;
        case 'enum':
          // Do not auto-fix; validate() should flag invalid values.
          break;
        case 'string':
        default:
          value = String(value);
          break;
      }
    }

    resolved[key] = value;
  });

  return resolved;
}

/**
 * Helper to create a baseline ValidationResult.
 * @returns {ValidationResult}
 */
export function createValidationResult() {
  return { errors: [], warnings: [] };
}

/**
 * Helper to add an error to a ValidationResult.
 * @param {ValidationResult} result
 * @param {string} message
 */
export function addError(result, message) {
  if (message) {
    result.errors.push(String(message));
  }
}

/**
 * Helper to add a warning to a ValidationResult.
 * @param {ValidationResult} result
 * @param {string} message
 */
export function addWarning(result, message) {
  if (message) {
    result.warnings.push(String(message));
  }
}

// INITIAL CORE RECIPE PLACEHOLDERS
// --------------------------------
// The concrete recipes (illuminance, rendering, DF, annual-3ph, etc.) are
// registered from separate modules (e.g. recipes/illuminanceRecipe.js) that
// import { registerRecipe } and hook into existing scriptGenerator primitives.
//
// Config objects are constructed by configMappers.js. Validation and script
// generation MUST be implemented as pure functions over those config objects.
