// scripts/main.js

import { setupEventListeners, setupFloatingWindows, setupSidebar, updateAllLabels, setupThemeSwitcher, setupWelcomeScreen, updateViewpointFromSliders } from './ui.js';
import { setupDOM, getDom } from './dom.js';
import { setupScene, animate, scene } from './scene.js';
import { lightingManager } from './lighting.js';
import { setupSimulationSidebar } from './simulation.js';
import { updateScene } from './geometry.js';
import { initAiAssistant } from './ai-assistant.js';
import './optimizationEngine.js'; // Import engine
import './optimizationOrchestrator.js'; // Import orchestrator

/**
 * The main initialization function for the entire application.
 */
async function init() {
    try {
        console.log("Initializing Ray Modeler...");

        // 1. First, cache all DOM elements. This must happen before anything else.
        setupDOM();
        const dom = getDom();

        // 2. Second, create the 3D scene and renderer.
        setupScene(dom['render-container']);

        // 3. Initialize the lighting manager with its dependencies.
        lightingManager.init(scene, dom);

        // 4. Set up all UI components and event listeners.
        await setupCoreUI();

        // 5. Perform the initial creation of all 3D geometry.
        await updateScene();

        // 6. Manually synchronize the viewpoint camera to match the initial slider values.
        updateViewpointFromSliders();

        // 7. Start the render loop.
        animate();
        
        console.log("Initialization Complete.");
    } catch (error) {
        console.error("Application initialization failed:", error);
        // Optionally, display a user-friendly error message on the page
    }
}

async function setupCoreUI() {
    await setupEventListeners();
    setupWelcomeScreen();
    setupThemeSwitcher();
    setupFloatingWindows();
    setupSidebar();
    setupSimulationSidebar();
    lightingManager.setupPanel();
    initAiAssistant();
    updateAllLabels();
}

document.addEventListener('DOMContentLoaded', init);