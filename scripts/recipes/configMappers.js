// scripts/recipes/configMappers.js
//
// Shared config mapping and normalization utilities for Simulation Recipes.
//
// Goals:
// - Provide a single place where we:
//   - Resolve the "active" recipe selection from the Simulation UI state.
//   - Map simulationParameters (global + recipes[]) into the per-recipe config
//     objects expected by RecipeDefinitions.
// - Keep this module UI/DOM-light: it should operate primarily on the
//   already-aggregated simulationParameters structure and panel metadata.
// - Remain backwards compatible with legacy multi-recipe storage.
//
// NOTE:
// - This module does NOT touch the DOM directly except via panelElement
//   dataset/template attributes passed in from simulation.js/project.js.
// - RecipeDefinition.buildConfig implementations can delegate to these helpers
//   to avoid duplicating selection/normalization logic.

import { mergeParamsWithSchema } from './RecipeRegistry.js';

/**
 * Resolve the active recipe selection based on the current panel and
 * gathered simulation parameters.
 *
 * This function encodes the rule (single active recipe per generation run):
 * - Primary source: panelElement.dataset.templateId (the selected recipe ID).
 * - Fallback: #recipe-parameters-container.dataset.activeRecipeTemplate if present.
 * - Backward-compatible fallback: if no explicit selection is available,
 *   and simParams.recipes[] contains entries (from legacy projects),
 *   treat the FIRST entry as the active recipe.
 * - This function always returns at most ONE active recipe; multi-recipe
 *   batch generation is NOT supported here and should be implemented as
 *   a dedicated composite recipe if needed.
 *
 * @param {HTMLElement} panelElement - The simulation root/panel element.
 * @param {{ global?: Object, activeRecipe?: {templateId: string, values: Object}, recipes?: Array<{templateId: string, values: Object}> }} simParams
 * @returns {{ recipeId: string | null, values: Object | null }}
 */
export function getActiveRecipeSelection(panelElement, simParams) {
  const safeSim = simParams || { global: {}, recipes: [] };

  // 1) Prefer explicit activeRecipe if present (new canonical shape).
  if (safeSim.activeRecipe && safeSim.activeRecipe.templateId) {
    return {
      recipeId: safeSim.activeRecipe.templateId,
      values: safeSim.activeRecipe.values || null
    };
  }

  const recipes = Array.isArray(safeSim.recipes) ? safeSim.recipes : [];
  let explicitId = null;

  // 2) Next, prefer explicit selection from the current panel / container.
  if (panelElement) {
    if (panelElement.dataset && panelElement.dataset.templateId) {
      explicitId = panelElement.dataset.templateId;
    }

    const container = panelElement.querySelector
      ? panelElement.querySelector('#recipe-parameters-container')
      : null;

    if (!explicitId && container && container.dataset && container.dataset.activeRecipeTemplate) {
      explicitId = container.dataset.activeRecipeTemplate;
    }
  }

  // If we have an explicit id, find matching values in simParams.recipes.
  if (explicitId) {
    const match = recipes.find(r => r.templateId === explicitId);
    return {
      recipeId: explicitId,
      values: match && match.values ? match.values : null
    };
  }

  // 3) Backward-compatible fallback:
  // If no explicit selection metadata, but we have stored recipes,
  // treat the first as "active".
  if (recipes.length > 0) {
    const first = recipes[0];
    return {
      recipeId: first.templateId || null,
      values: first.values || null
    };
  }

  return { recipeId: null, values: null };
}

/**
 * Build a resolved config for a given RecipeDefinition using:
 * - global parameters
 * - recipe-specific overrides
 * - recipeDef.inputSchema
 * - simulationFiles where relevant
 *
 * This helper centralizes the precedence rule:
 * - recipe overrides > global > defaults
 *
 * It intentionally does NOT enforce required/semantic rules; that is
 * delegated to recipeDef.validate(projectData, config).
 *
 * @param {import('./RecipeRegistry.js').RecipeDefinition} recipeDef
 * @param {Object} projectData
 * @param {{ global?: Object, activeRecipe?: {templateId: string, values: Object}, recipes?: Array<{templateId: string, values: Object}> }} simParams
 * @param {Object} simulationFiles
 * @param {{ recipeId: string | null, values: Object | null }} activeSelection
 * @returns {{ globals: Object, recipe: Object, simulationFiles: Object, _raw: { globalParams: Object, recipeOverrides: Object } }}
 */
export function buildRecipeConfig(recipeDef, projectData, simParams, simulationFiles, activeSelection) {
  const safeSim = simParams || { global: {}, recipes: [] };
  const globalParams = safeSim.global || {};
  const allRecipes = Array.isArray(safeSim.recipes) ? safeSim.recipes : [];

  const targetId = recipeDef.id;
  let recipeOverrides = {};

  // 1) Prefer explicit active selection when it matches this recipe.
  if (activeSelection && activeSelection.recipeId === targetId && activeSelection.values) {
    recipeOverrides = activeSelection.values;
  } else {
    // 2) Backward-compatible: first stored recipe entry matching this templateId.
    const legacyMatch = allRecipes.find(r => r.templateId === targetId && r.values);
    if (legacyMatch && legacyMatch.values) {
      recipeOverrides = legacyMatch.values;
    }
  }

  const schema = recipeDef.inputSchema || {};
  const globals = mergeParamsWithSchema(globalParams, {}, schema.globalParams || {});
  const recipe = mergeParamsWithSchema(globalParams, recipeOverrides, schema.recipeParams || {});

  return {
    globals,
    recipe,
    simulationFiles: simulationFiles || {},
    _raw: { globalParams, recipeOverrides }
  };
}
