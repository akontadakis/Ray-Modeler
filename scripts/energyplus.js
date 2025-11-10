// scripts/energyplus.js

import { getDom } from './dom.js';
import { project } from './project.js';
import { buildEnergyPlusModel } from './energyplusModelBuilder.js';

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
                console.error('Failed to generate EnergyPlus IDF:', err);
                alert('Failed to generate EnergyPlus IDF. Check console for details.');
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

    // Try to pull any existing metadata we might have
    const meta = (project.getMetadata && project.getMetadata()) || project.metadata || {};

    const ep = meta.energyPlusConfig || meta.energyplus || {};

    const options = {
        buildingName: meta.name || meta.projectName || 'Ray-Modeler Building',
        location: meta.location || undefined,
        timestep: ep.timestep,
        runPeriod: ep.runPeriod,
        northAxis: ep.northAxis,
        terrain: ep.terrain,
        weatherFilePath: ep.weatherFilePath,
        // Extended configuration for materials / constructions / schedules / loads / ideal loads / thermostats
        materials: ep.materials,
        constructions: ep.constructions,
        schedules: ep.schedules,
        loads: ep.zoneLoads,
        defaults: ep.defaults,
        idealLoads: ep.idealLoads,
        thermostats: ep.thermostats,
    };

    const idfContent = buildEnergyPlusModel(options);

    // Store in simulation files so other modules (sidebar, runners) can reference it
    project.addSimulationFile('model.idf', 'model.idf', idfContent);

    return idfContent;
}

export { initializeEnergyPlus, generateAndStoreIdf };
