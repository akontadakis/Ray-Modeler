// scripts/energyplus.js

import { getDom } from './dom.js';
import { project } from './project.js';
import { buildEnergyPlusModel, buildEnergyPlusDiagnostics } from './energyplusModelBuilder.js';
import { validateEnergyPlusConfig, EnergyPlusValidationError } from './energyplusValidation.js';
import { getConfig } from './energyplusConfigService.js';

const dom = getDom();

function initializeEnergyPlus() {
    console.log('EnergyPlus module initialized');
    setupEventListeners();
}

/**
 * Wire EnergyPlus-specific UI controls.
 * Expects:
 *  - A button with id="generate-idf-btn" OR [data-action="generate-idf"]
 */
function setupEventListeners() {
    const generateBtn =
        dom['generate-idf-btn'] ||
        document.querySelector('[data-action="generate-idf"]');

    if (generateBtn) {
        generateBtn.addEventListener('click', async () => {
            try {
                await generateAndStoreIdf();
                alert('EnergyPlus IDF generated from current project and added to project files.');
            } catch (err) {
                if (err && err.name === 'EnergyPlusValidationError' && Array.isArray(err.issues)) {
                    console.error('EnergyPlus IDF validation failed:', err.issues);
                    const first = err.issues.find(i => i.severity === 'error') || err.issues[0];
                    alert(
                        (first ? first.message + '\n\n' : '') +
                        'Open the EnergyPlus Diagnostics panel for details.'
                    );
                } else {
                    console.error('Failed to generate EnergyPlus IDF:', err);
                    alert('Failed to generate EnergyPlus IDF. Check console for details.');
                }
            }
        });
    }
}

/**
 * Collects basic options from project / UI and generates an IDF via buildEnergyPlusModel,
 * then stores it using the central project API.
 */
async function generateAndStoreIdf() {
    if (!project) {
        throw new Error('Project module not available.');
    }

    const { config } = getConfig(project);

    const sim = config.simulationControl;
    const weather = config.weather;

    const options = {
        // Legacy-style flattened fields (kept for builder/backward compatibility)
        buildingName: sim.building.name,
        location: undefined, // Location from EPW/custom; meta.location deprecated
        timestep: sim.timestep.timestepsPerHour,
        runPeriod: sim.runPeriod,
        northAxis: sim.building.northAxis,
        terrain: sim.building.terrain,
        weatherFilePath: weather.epwPath,

        // Extended configuration from normalized config
        materials: config.materials,
        constructions: config.constructions,
        schedules: config.schedules,
        loads: config.zoneLoads,
        defaults: config.defaults,
        idealLoads: config.idealLoads,
        thermostats: config.thermostats,
        daylighting: config.daylighting,

        // Canonical normalized blocks
        simulationControl: sim,
        weather,

        // Advanced / extended EnergyPlus configuration blocks
        sizing: config.sizing,
        outdoorAir: config.outdoorAir,
        naturalVentilation: config.naturalVentilation,
        shading: config.shading,
    };

    // Optional: attempt to reuse diagnostics when available to avoid duplicate work.
    // If diagnostics generation fails we continue with structural checks only.
    let diagnostics = null;
    try {
        diagnostics = await generateEnergyPlusDiagnostics();
    } catch (e) {
        console.debug('EnergyPlus: diagnostics unavailable during IDF validation', e);
    }

    // Run structured validation before building the IDF.
    const validation = validateEnergyPlusConfig(options, diagnostics || undefined);
    if (!validation.ok) {
        throw new EnergyPlusValidationError(
            'EnergyPlus configuration validation failed. Resolve the reported issues before generating the IDF.',
            validation.issues
        );
    }

    const idfContent = buildEnergyPlusModel(options);

    // Store in simulation files so other modules (sidebar, runners) can reference it
    project.addSimulationFile('model.idf', 'model.idf', idfContent);

    return idfContent;
}

/**
 * Generate a diagnostics summary (no file writes) describing how the current
 * project + energyPlusConfig would map into EnergyPlus objects.
 *
 * Used by the EnergyPlus Diagnostics / IDF Preview panel.
 */
async function generateEnergyPlusDiagnostics() {
    if (!project) {
        throw new Error('Project module not available.');
    }

    const { meta, config } = getConfig(project);
    const sim = config.simulationControl;
    const weather = config.weather;

    const options = {
        buildingName:
            sim.building.name ||
            meta.name ||
            meta.projectName ||
            'OfficeBuilding',

        weather,
        timestep: sim.timestep.timestepsPerHour,
        northAxis: sim.building.northAxis,
        terrain: sim.building.terrain,
        weatherFilePath: weather.epwPath,

        materials: config.materials,
        constructions: config.constructions,
        schedules: config.schedules,
        loads: config.zoneLoads,
        defaults: config.defaults,
        idealLoads: config.idealLoads,
        thermostats: config.thermostats,
        daylighting: config.daylighting,

        // Advanced / extended EnergyPlus configuration blocks
        sizing: config.sizing,
        outdoorAir: config.outdoorAir,
        naturalVentilation: config.naturalVentilation,
        shading: config.shading,
    };

    return buildEnergyPlusDiagnostics(options);
}

export { initializeEnergyPlus, generateAndStoreIdf, generateEnergyPlusDiagnostics };
