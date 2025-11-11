// scripts/energyplusValidation.js
//
// Lightweight validation utilities for EnergyPlus configuration & run readiness.
// These helpers are intentionally side-effect free and can be reused by
// energyplus.js, energyplusSidebar.js, and tests.

/**
 * @typedef {'error' | 'warning'} EnergyPlusIssueSeverity
 */

/**
 * @typedef {Object} EnergyPlusIssue
 * @property {EnergyPlusIssueSeverity} severity
 * @property {string} code
 * @property {string} message
 * @property {string} [hint]
 * @property {Object} [context]
 */

/**
 * Result of configuration validation.
 * @typedef {Object} EnergyPlusValidationResult
 * @property {boolean} ok
 * @property {EnergyPlusIssue[]} issues
 */

/**
 * Basic structural/configuration validation for IDF generation inputs.
 *
 * This is designed to:
 * - Guard against missing EPW when weather run periods are enabled.
 * - Surface missing constructions/materials/schedules as blocking issues when provided via diagnostics.
 * - Warn on geometry or HVAC/control gaps that are likely to cause problematic models.
 *
 * It accepts the same options shape that energyplus.js passes into buildEnergyPlusModel.
 *
 * @param {Object} options - Normalized options destined for buildEnergyPlusModel.
 * @param {Object} [diagnostics] - Optional diagnostics from buildEnergyPlusDiagnostics.
 * @returns {EnergyPlusValidationResult}
 */
export function validateEnergyPlusConfig(options = {}, diagnostics = null) {
    /** @type {EnergyPlusIssue[]} */
    const issues = [];

    const sim = options.simulationControl || {};
    const flags = sim.simulationControlFlags || {};
    const weatherFilePath = options.weatherFilePath || (options.weather && options.weather.epwPath) || null;

    // 1) Weather / EPW requirements
    if (flags.runWeatherRunPeriods) {
        if (!weatherFilePath) {
            issues.push({
                severity: 'error',
                code: 'EP_WEATHER_MISSING',
                message: 'No EPW weather file is configured while weather run periods are enabled.',
                hint: 'Open "Weather & Location" and set energyPlusConfig.weather.epwPath, or disable Run Weather Periods in Simulation Control.',
            });
        }
    }

    // Use diagnostics when available for richer checks
    if (diagnostics && typeof diagnostics === 'object') {
        const { constructions, materials, schedulesAndLoads, geometry, issues: diagIssues } = diagnostics;

        // 2) Constructions / Materials
        const missingCons = (constructions && constructions.missingConstructions) || [];
        const missingMats = (materials && materials.missingMaterials) || [];

        if (missingCons.length) {
            issues.push({
                severity: 'error',
                code: 'EP_CONSTRUCTION_MISSING',
                message: `Missing constructions referenced by geometry or defaults: ${missingCons.join(', ')}.`,
                hint: 'Use the Constructions panel to define these constructions or update references.',
                context: { missingConstructions: missingCons },
            });
        }
        if (missingMats.length) {
            issues.push({
                severity: 'error',
                code: 'EP_MATERIAL_MISSING',
                message: `Missing materials referenced by constructions: ${missingMats.join(', ')}.`,
                hint: 'Use the Materials panel to define these materials or adjust construction layers.',
                context: { missingMaterials: missingMats },
            });
        }

        // 3) Schedules & Loads
        const missingScheds = (schedulesAndLoads && schedulesAndLoads.missingSchedules) || [];
        const inconsistentLoads = (schedulesAndLoads && schedulesAndLoads.inconsistentLoads) || [];

        if (missingScheds.length) {
            issues.push({
                severity: 'warning',
                code: 'EP_SCHEDULE_MISSING',
                message: `Some schedules referenced by loads or controls are missing: ${missingScheds.join(', ')}.`,
                hint: 'Use the Schedules and Zone Loads panels to resolve missing schedule references.',
                context: { missingSchedules: missingScheds },
            });
        }

        if (Array.isArray(inconsistentLoads) && inconsistentLoads.length) {
            issues.push({
                severity: 'warning',
                code: 'EP_ZONELOADS_INCONSISTENT',
                message: 'One or more zone load definitions are incomplete or inconsistent.',
                hint: 'Open Zone Loads and Diagnostics to review detailed issues.',
                context: { inconsistentLoadsCount: inconsistentLoads.length },
            });
        }

        // 4) Geometry visibility
        const zoneCount =
            (geometry && geometry.totals && typeof geometry.totals.zones === 'number'
                ? geometry.totals.zones
                : null);

        if (zoneCount === 0) {
            issues.push({
                severity: 'warning',
                code: 'EP_NO_ZONES',
                message: 'No explicit zones detected. IDF generation will fall back to a single generic Zone_1.',
                hint: 'Define zones in the project to obtain meaningful multi-zone simulation results.',
            });
        }
    }

    // 5) Thermostats / IdealLoads sanity (lightweight)
    const thermostats = options.thermostats || [];
    const idealLoads = options.idealLoads || {};
    const hasIdealGlobal = !!idealLoads.global;
    const hasIdealPerZone = Array.isArray(idealLoads.perZone) && idealLoads.perZone.length > 0;
    const hasAnyThermostat = Array.isArray(thermostats) && thermostats.length > 0;

    if (flags.runWeatherRunPeriods && !(hasIdealGlobal || hasIdealPerZone)) {
        issues.push({
            severity: 'warning',
            code: 'EP_NO_IDEALLOADS',
            message: 'No IdealLoads configuration detected. Zones may be simulated without HVAC capacity constraints.',
            hint: 'Use the "Thermostats & IdealLoads" panel to define at least a global IdealLoads configuration.',
        });
    }

    if (flags.runWeatherRunPeriods && !hasAnyThermostat) {
        issues.push({
            severity: 'warning',
            code: 'EP_NO_THERMOSTATS',
            message: 'No thermostats configured. Zones may free-float without temperature setpoints.',
            hint: 'Configure thermostats (global or per-zone) for more realistic comfort and load results.',
        });
    }

    // 6) Integrate diagnostics.issues if present (pass-through with normalized shape)
    if (diagnostics && Array.isArray(diagnostics.issues)) {
        for (const i of diagnostics.issues) {
            if (!i || !i.severity || !i.message) continue;
            const severity = i.severity === 'error' ? 'error' : 'warning';
            issues.push({
                severity,
                code: i.code || (severity === 'error' ? 'EP_DIAG_ERROR' : 'EP_DIAG_WARNING'),
                message: i.message,
                hint: i.hint,
                context: i.context,
            });
        }
    }

    const ok = !issues.some((i) => i.severity === 'error');

    return { ok, issues };
}

/**
 * Simple validation for a proposed EnergyPlus run request.
 * This is UI-facing and used before calling the Electron bridge.
 *
 * @param {Object} params
 * @param {string|null} params.idfPath
 * @param {string|null} params.epwPath
 * @param {string|null} params.energyPlusPath
 * @param {string} [params.recipeId]
 * @returns {EnergyPlusValidationResult}
 */
export function validateEnergyPlusRunRequest(params = {}) {
    /** @type {EnergyPlusIssue[]} */
    const issues = [];

    const idfPath = params.idfPath || 'model.idf';
    const epwPath = params.epwPath || null;
    const exePath = params.energyPlusPath || null;
    const recipeId = params.recipeId || 'energyplus-run';

    // Require EPW for all shipped recipes to keep behavior explicit.
    if (!epwPath) {
        issues.push({
            severity: 'error',
            code: 'EP_RUN_MISSING_EPW',
            message: 'No EPW specified for EnergyPlus run.',
            hint: 'Select an EPW in the recipe panel or configure a project-level EPW in Weather & Location.',
        });
    }

    if (!exePath) {
        issues.push({
            severity: 'error',
            code: 'EP_RUN_MISSING_EXE',
            message: 'EnergyPlus executable path is required.',
            hint: 'Specify the EnergyPlus binary (e.g., /usr/local/EnergyPlus-23-2-0/energyplus).',
        });
    }

    // For clarity, ensure an IDF is specified
    if (!idfPath) {
        issues.push({
            severity: 'error',
            code: 'EP_RUN_MISSING_IDF',
            message: 'No IDF file specified for EnergyPlus run.',
            hint: 'Generate an IDF (model.idf) from the current Ray-Modeler project or select an existing IDF file.',
        });
    }

    // Reserve hook: recipes can add further checks in future
    if (recipeId === 'annual-energy-simulation') {
        // No extra constraints for now; IDF/EPW/exe are mandatory above.
    }

    const ok = !issues.some((i) => i.severity === 'error');
    return { ok, issues };
}

/**
 * Utility to format issues into a concise multi-line string for alerts or consoles.
 * @param {EnergyPlusIssue[]} issues
 * @param {number} [maxLines=5]
 * @returns {string}
 */
export function formatIssuesSummary(issues, maxLines = 5) {
    if (!Array.isArray(issues) || issues.length === 0) return '';
    const lines = issues.slice(0, maxLines).map((i) => {
        const prefix = i.severity === 'error' ? '[ERROR]' : '[WARN]';
        return `${prefix} ${i.message}`;
    });
    if (issues.length > maxLines) {
        lines.push(`…and ${issues.length - maxLines} more issue(s).`);
    }
    return lines.join('\n');
}

/**
 * Custom error type to propagate validation failures with structured issues.
 */
export class EnergyPlusValidationError extends Error {
    /**
     * @param {string} message
     * @param {EnergyPlusIssue[]} issues
     */
    constructor(message, issues) {
        super(message);
        this.name = 'EnergyPlusValidationError';
        this.issues = Array.isArray(issues) ? issues : [];
    }
}
