// scripts/main.js

import { setupDOM, getDom, setupEventListeners, setupFloatingWindows, setupSidebar, updateAllLabels, setupThemeSwitcher, setupWelcomeScreen, updateViewpointFromSliders } from './ui.js';
import { setupScene, animate, scene } from './scene.js';
import { lightingManager } from './lighting.js';
import { setupSimulationSidebar } from './simulation.js';
import { updateScene } from './geometry.js';
import { initAiAssistant } from './ai-assistant.js';

/**
 * The main initialization function for the entire application.
 */
async function init() {
    console.log("Initializing Ray Modeler...");

    // 1. First, cache all DOM elements. This must happen before anything else.
    setupDOM();
    const dom = getDom();

    // 2. Second, create the 3D scene and renderer.
    setupScene(dom['render-container']);

    // 3. Now that the renderer exists, it's safe to set up event listeners.
    await setupEventListeners();

    // 4. Inject dependencies into the lighting manager.
    lightingManager.init(scene, dom);

    // 5. Now that the manager is initialized, set up its UI panel.
    lightingManager.setupPanel();

    // 6. Set up the rest of the UI components.
    setupWelcomeScreen();
    setupThemeSwitcher();
    setupFloatingWindows();
    setupSidebar();
    setupSimulationSidebar();
    initAiAssistant();
    
    // 7. Set all UI value labels to their initial state.
    updateAllLabels();

    // 8. Perform the initial creation of all 3D geometry.
    await updateScene();

    // 9. Manually synchronize the viewpoint camera to match the initial slider values.
    updateViewpointFromSliders();

    // 10. Start the render loop.
    animate();
    
    console.log("Initialization Complete.");
}

document.addEventListener('DOMContentLoaded', init);