# Gemini Code Assistant Context

## Project Overview

This project, "Ray Modeler," is a desktop application for macOS and Windows that provides a graphical user interface (GUI) for the Radiance Lighting Simulation Suite. It is built using Electron, which wraps a web-based front-end created with vanilla JavaScript, HTML, and CSS (utilizing TailwindCSS for styling). The application leverages Three.js for interactive 3D visualization of architectural scenes.

The core purpose of the application is to simplify and automate the entire daylighting and electric lighting analysis workflow. It allows users to parametrically model 3D scenes, import complex geometry, configure materials, design lighting systems, and run various Radiance simulations. The application also features an integrated AI assistant to provide guidance and automate tasks.

The UI is designed around a system of floating panels that can be dragged, resized, and collapsed, allowing for a flexible user workspace.

### Key Architectural Points:

*   **`electron.js` (Main Process):** Manages the application lifecycle, native dialogs, and inter-process communication (IPC). It handles file system operations (saving/loading projects, running simulation scripts) on behalf of the renderer process.
*   **Renderer Process (Frontend):**
    *   **`index.html`**: The single-page entry point for the user interface.
    *   **`scripts/main.js`**: The main JavaScript entry point that initializes all frontend modules in a specific sequence: DOM caching, 3D scene setup, UI event listeners, and initial geometry creation.
    *   **`scripts/dom.js`**: Caches all necessary DOM elements into a single object on startup for efficient access throughout the application.
    *   **`scripts/ui.js`**: Manages all user interface elements, including the floating window system, a comprehensive keyboard shortcut manager, and all event listeners that trigger updates in other modules.
    *   **`scripts/scene.js`**: Encapsulates all Three.js logic. This includes setting up multiple cameras (perspective, orthographic, and quad-view), controls (`OrbitControls` for navigation, `TransformControls` for object manipulation), and post-processing effects like the Fisheye shader.
    *   **`scripts/geometry.js`**: Responsible for creating and updating all 3D meshes. It uses `THREE.Group` objects (`roomObject`, `shadingObject`, etc.) to organize the scene graph and procedurally generates geometry based on UI parameters.
    *   **`scripts/project.js`**: Handles the logic for saving and loading the entire project state. It gathers all parameters from the DOM, bundles them into a single `.json` file, and can also restore the application state from such a file.
    
    *   **`scripts/simulation.js`**: Acts as the UI coordinator for the simulation engine. It manages the "Simulation Modules" panel, dynamically loading UI templates based on the selected recipe from the `RecipeRegistry`.
    *   **`scripts/recipes/`**: Contains the modular recipe engine.
        *   **`RecipeRegistry.js`**: The central registry and source of truth for all simulation recipes. Defines contracts (`RecipeDefinition`) and manages recipe registration.
        *   **`runtimeEnvironment.js`**: Handles environment detection (OS, shell availability) for recipes.
        *   **`*Recipe.js`**: Individual recipe modules (e.g., `illuminanceRecipe.js`, `annual3PhaseRecipe.js`) that implement specific simulation logic, input validation, and script generation.

    *   **`scripts/agent-core.js`**: Implements the core AI Agent logic, including the Reason-Act-Observe loop and a `MemoryManager` for long-term persistence (user preferences, project facts) via `localStorage`.
    *   **`scripts/ai-assistant.js`**: Connects the core Agent to the UI. It defines the specific "tools" (functions) the AI can call to interact with the application (e.g., modifying scene parameters, running simulations).

    *   **`scripts/results/`**:
        *   **`ResultsRegistry.js`**: A central registry for typed analysis results. It defines result types, file matching patterns, storage strategies, and visualization hints, decoupling result identification from processing logic.

    *   **`scripts/AperturePanelUI.js`**: Manages the specific UI logic for the "Apertures & Shading" panel, including wall selection, sun ray tracing toggles, and orientation-specific shading controls.
    *   **`scripts/annualDashboard.js`**: Manages the creation and updates of various charts and dashboards for annual simulations.
    *   **`scripts/hdrViewer.js`**: Provides a viewer for High Dynamic Range (HDR) images, with exposure and false color controls.
    *   **`scripts/knowledgeBase.js`**: Loads and searches a local knowledge base for the AI assistant.
    *   **`scripts/lighting.js`**: Manages the artificial lighting systems, including IES file parsing and visualization.
    *   **`scripts/mogaOptimizer.js`**: Implements a Multi-Objective Genetic Algorithm (NSGA-II) for optimization tasks.
    *   **`scripts/optimizationEngine.js`**: Contains the core genetic algorithm for optimization tasks.
    *   **`scripts/optimizationOrchestrator.js`**: Manages the optimization process, linking the UI, the genetic algorithm, and the simulation runs.
    *   **`scripts/parsingWorker.js`**: A web worker for parsing large simulation result files without blocking the main UI thread.
    *   **`scripts/radiance.js`**: Contains functions to generate Radiance-specific file content (`.rad`, `.vf`, etc.).
    *   **`scripts/reportGenerator.js`**: Generates a self-contained HTML report of the project and simulation results.
    *   **`scripts/resultsManager.js`**: Manages loading, processing, and statistical analysis of simulation results, utilizing the `ResultsRegistry` to identify and handle different data types.
    *   **`scripts/scriptGenerator.js`**: Generates the shell scripts (`.sh`, `.bat`) for running Radiance simulations, delegating specific script content generation to the active recipe.
    *   **`scripts/sidebar.js`**: Manages the docking and undocking behavior of the sidebars.
    *   **`scripts/sunTracer.js`**: Implements the sun ray tracing visualization.

## Building and Running

The project uses `npm` for dependency management and `electron-builder` for creating distributable application packages.

*   **Install Dependencies:**
    ```bash
    npm install
    ```

*   **Run in Development Mode:**
    This command starts the Electron application with developer tools accessible.
    ```bash
    npm start
    ```

*   **Build for Distribution:**
    The following commands package the application into distributable installers (`.dmg` for macOS, `.exe` for Windows) in the `dist/` directory.
    *   **Build for macOS:**
        ```bash
        npm run build:mac
        ```
    *   **Build for Windows:**
        ```bash
        npm run build:win
        ```

## Development Conventions

*   **Code Style:** The project uses vanilla JavaScript with ES6 modules (`import`/`export`). The code is well-structured, with a clear separation of concerns between UI, 3D scene management, and application logic.
*   **UI:** The user interface is built with floating panels that can be moved, resized, and collapsed. UI elements are defined in `index.html` and managed in `scripts/ui.js` and specific UI classes (e.g., `AperturePanelUI`).
*   **State Management:** The application state (scene parameters, material properties, etc.) is primarily managed through the DOM. The `project.js` module gathers this state from the UI inputs to save and load projects.
*   **3D:** All 3D rendering is handled by the Three.js library. The main 3D objects are grouped into `THREE.Group` instances (e.g., `roomObject`, `shadingObject`) in `scripts/geometry.js` and added to the main scene in `scripts/scene.js`.
*   **File System Access:** Due to the security model of the renderer process, all file system interactions are brokered through the Electron main process via IPC channels defined in `electron.js` and `preload.js`. The main process provides handlers for opening dialogs (`dialog:openDirectory`), saving project files (`fs:saveProject`), and running simulation scripts (`run-script`, `run-script-headless`, `run-simulations-parallel`).
*   **Simulation Workflow (Recipe-Based):**
    1.  The user configures the scene using the UI panels.
    2.  The user selects a "recipe" from the Simulation Modules panel (populated by `RecipeRegistry`).
    3.  `simulation.js` renders the specific parameters for that recipe into the UI.
    4.  When "Generate Package" is clicked, the recipe's `generateScripts` function (in `scripts/recipes/*`) is called via `scriptGenerator.js`.
    5.  The resulting scripts (`.sh`, `.bat`) and Radiance input files (`.rad`, `.vf`, `.pts`) are saved to the standardized folder structure.
    6.  When "Run Simulation" is clicked, an IPC call is made to `electron.js` to execute the script.