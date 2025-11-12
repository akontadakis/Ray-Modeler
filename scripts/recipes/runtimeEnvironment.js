// scripts/recipes/runtimeEnvironment.js
//
// Runtime environment detection and execution support helpers for Simulation Recipes.
// This file is UI-facing (used from simulation.js) but does NOT touch Electron main/fs directly.

/**
 * Detect the current runtime environment in a coarse but stable way.
 * @returns {{ kind: 'electron-posix' | 'electron-win' | 'browser', os: 'win' | 'mac' | 'linux' | 'unknown', hasElectron: boolean, canRunShell: boolean }}
 */
export function getRuntimeEnvironment() {
  const hasElectron = typeof window !== 'undefined' && !!window.electronAPI;

  let os = 'unknown';
  const platform = (navigator && navigator.platform) || '';
  const ua = (navigator && navigator.userAgent) || '';

  if (/Win/i.test(platform) || /Win/i.test(ua)) {
    os = 'win';
  } else if (/Mac/i.test(platform) || /Mac/i.test(ua)) {
    os = 'mac';
  } else if (/Linux/i.test(platform) || /X11/i.test(ua)) {
    os = 'linux';
  }

  let kind = 'browser';
  if (hasElectron) {
    if (os === 'win') {
      kind = 'electron-win';
    } else if (os === 'mac' || os === 'linux') {
      kind = 'electron-posix';
    } else {
      // Fallback: still treat as browser-instructions only
      kind = 'electron-posix';
    }
  }

  // In this app, if Electron is present we assume the main process can run scripts.
  const canRunShell = hasElectron;

  return { kind, os, hasElectron, canRunShell };
}

/**
 * Compute whether a recipe can be auto-run in the current environment, or if it
 * should be instructions-only.
 *
 * @param {import('./RecipeRegistry.js').RecipeDefinition | null} recipeDef
 * @param {{ kind: 'electron-posix' | 'electron-win' | 'browser', os: 'win' | 'mac' | 'linux' | 'unknown', hasElectron: boolean, canRunShell: boolean }} runtimeEnv
 * @returns {{ canAutoRun: boolean, instructionsOnly: boolean, reasons: string[] }}
 */
export function getRecipeExecutionSupport(recipeDef, runtimeEnv) {
  if (!recipeDef) {
    return {
      canAutoRun: false,
      instructionsOnly: false,
      reasons: ['Unknown recipe; falling back to legacy behavior.']
    };
  }

  const { environment } = recipeDef;
  const reasons = [];

  // Default stance
  let canAutoRun = false;
  let instructionsOnly = false;

  // Browser: no direct script execution, only instructions if supported.
  if (runtimeEnv.kind === 'browser') {
    const supportsBrowserInstructions = environment.supportedEnvironments.includes('browser-instructions');
    if (supportsBrowserInstructions) {
      instructionsOnly = true;
      reasons.push('Running scripts is not available in the browser. Use the generated scripts from a terminal.');
    } else {
      instructionsOnly = false;
      reasons.push('This recipe does not support running in the browser environment.');
    }
    return { canAutoRun, instructionsOnly, reasons };
  }

  // Electron environments
  const isPosix = runtimeEnv.kind === 'electron-posix';
  const isWin = runtimeEnv.kind === 'electron-win';

  // Check if recipe supports this environment kind.
  const supportsElectronPosix = environment.supportedEnvironments.includes('electron-posix');
  const supportsElectronWin = environment.supportedEnvironments.includes('electron-win');

  if (isPosix && supportsElectronPosix) {
    canAutoRun = runtimeEnv.canRunShell;
  } else if (isWin && supportsElectronWin) {
    canAutoRun = runtimeEnv.canRunShell;
  } else {
    reasons.push('This recipe is not marked as supported for the current OS in auto-run mode.');
  }

  // bashOnly semantics: if recipe is flagged bashOnly and we are on Windows, we cannot reliably auto-run.
  if (environment.bashOnly && isWin) {
    canAutoRun = false;
    instructionsOnly = true;
    reasons.push('This recipe currently only generates bash (.sh) scripts; run them via WSL/Git Bash manually.');
  }

  // If we still cannot auto-run but environment allows instructions, fall back to instructions-only.
  if (!canAutoRun) {
    const supportsInstructions =
      environment.supportedEnvironments.includes('browser-instructions') ||
      supportsElectronPosix ||
      supportsElectronWin;
    if (supportsInstructions && reasons.length > 0) {
      instructionsOnly = true;
    }
  }

  return { canAutoRun, instructionsOnly, reasons };
}
