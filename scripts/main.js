// scripts/main.js

import { setupEventListeners, getDom, setupFloatingWindows, setupSidebar, updateAllLabels, setupThemeSwitcher, setupWelcomeScreen } from './ui.js';
import { setupScene, animate, scene } from './scene.js';
import { lightingManager } from './lighting.js';
import { setupSimulationSidebar } from './simulation.js';
import { updateScene } from './geometry.js';
import { initAiAssistant } from './ai-assistant.js';

/**
 * The main initialization function for the entire application.
 */
function init() {
    console.log("Initializing Ray Modeler...");

    // 1. Set up core UI and get the `dom` object first.
    setupEventListeners();

    // 2. Now set up the welcome screen, which depends on the `dom` object.
    setupWelcomeScreen();

    // 3. Set up the Three.js scene and get the `scene` object.
    setupScene();

    // 4. Inject dependencies into the manager.
    lightingManager.init(scene, getDom());

    // 5. Now that the manager is initialized, set up its UI panel.
    lightingManager.setupPanel(); 
    setupThemeSwitcher();

    // 6. Set up the rest of the UI components.
    setupFloatingWindows();
    setupSidebar();
    setupSimulationSidebar();
    initAiAssistant(); // Initialize the AI assistant
    
    // 7. Set all UI value labels to their initial state.
    updateAllLabels();

    // 8. Perform the initial creation of all 3D geometry.
    updateScene();

    // 9. Start the render loop.
    animate();
    
    console.log("Initialization Complete.");
}

document.addEventListener('DOMContentLoaded', init);