# Gemini Code-Aware Context: Ray Modeler

This document provides a comprehensive overview of the Ray Modeler project, its architecture, and development conventions to guide AI-assisted development.

## 1. Project Overview

**Ray Modeler** is a desktop application for macOS and Windows that provides a graphical user interface (GUI) for the [Radiance Lighting Simulation Suite](https://www.radiance-online.org/). It is designed to streamline the entire daylighting and electric lighting analysis workflow, from 3D modeling to simulation and results visualization.

The application is built as an [Electron](https://www.electronjs.org/) app, using web technologies for its interface and backend logic.

### Core Technologies

- **Application Framework:** Electron
- **UI and Logic:** Vanilla JavaScript (ES Modules)
- **3D Rendering:** Three.js
- **Data Visualization:** Chart.js

### Architecture

The project follows a standard Electron architecture with a main process and a renderer process.

1. **Main Process (`electron.js`):**
    - Written in Node.js.
    - Manages the application lifecycle and creates the main browser window.
    - Acts as the backend, handling all interactions with the operating system.
    - Exposes APIs to the renderer process for tasks like file system access (reading/writing files, opening dialogs) and executing external processes (running Radiance simulation scripts).
    - Communication with the renderer is handled securely via a preload script (`preload.js`) and Electron's IPC (Inter-Process Communication) mechanism.

2. **Renderer Process (`index.html`, `scripts/`):**
    - This is the frontend of the application, running in a Chromium browser window.
    - `index.html` is the main HTML file.
    - All frontend logic is written in modern, modular JavaScript located in the `scripts/` directory.
    - `scripts/main.js` is the primary entry point for the renderer process.
    - The UI is built with vanilla HTML, CSS, and JavaScript, with a heavy emphasis on dynamic DOM manipulation.
    - Three.js is used to create and manage the interactive 3D viewport.

## 2. Building and Running

The project uses `npm` for dependency management and running scripts.

- **Install Dependencies:**

    ```bash
    npm install
    ```

- **Run in Development Mode:**
    This command starts the Electron application with developer tools accessible.

    ```bash
    npm start
    ```

- **Build for Distribution:**
    These commands use `electron-builder` to package the application into distributable installers. The output is placed in the `dist/` directory.
  - **For macOS (.dmg):**

    ```bash
    npm run build:mac
    ```

  - **For Windows (.exe):**

    ```bash
    npm run build:win
    ```

## 3. Development Conventions

### File Structure

- `electron.js`: The Electron main process entry point. Handles file system operations, script execution, and window management.
- `preload.js`: The bridge between the Electron main process and the renderer process, exposing backend functionality securely.
- `index.html`: The main HTML document for the UI.
- `styles.css`: The primary stylesheet for the application.
- `scripts/`: Contains all frontend JavaScript modules.
  - `main.js`: The main entry point for the renderer process. Initializes all other modules.
  - `dom.js`: Caches DOM element selectors for performance and central access.
  - `ui.js`: A large, critical module that manages all UI interactions, floating windows, event listeners, keyboard shortcuts, and panel logic.
  - `scene.js`: Manages the core Three.js scene, cameras, lights, controls, and render loop.
  - `geometry.js`: Handles the creation, modification, and updating of 3D objects (the room, shading devices, etc.) in the scene.
  - `project.js`: Manages project state, including saving and loading project files.
  - `simulation.js`: Manages the "Simulation Modules" (recipes) sidebar and logic for generating simulation scripts.
  - `radiance.js`: Contains helper functions related to generating Radiance-specific file content.
  - `ai-assistant.js`: Powers the integrated AI chat functionality.
  - `resultsManager.js`: Handles loading, parsing, and visualizing simulation results.

### Code Style

- The project is written in **modern Vanilla JavaScript** using ES modules (`import`/`export`).
- Asynchronous operations are handled with `async/await`.
- The code is highly modular, with responsibilities separated into different files within the `scripts/` directory.
- There is no enforced linter, but the code generally follows standard JavaScript conventions with descriptive variable and function names.

### State Management

State is managed decentrally across several key modules:

- **UI State:** Primarily managed within `scripts/ui.js`.
- **Project Data:** The `project` object, exported from `scripts/project.js`, holds the canonical state of the user's scene definition (dimensions, materials, lighting, etc.).
- **3D Scene State:** Managed by modules like `scene.js` and `geometry.js`.
- Updates flow between modules via direct function calls. For example, a user interaction in `ui.js` will call a function in `geometry.js` to update a 3D object, which is then rendered by the loop in `scene.js`.

### Backend Communication

- All "backend" operations (like saving a file or running a simulation) are initiated from the renderer process (frontend).
- The renderer calls functions exposed on the `window.electronAPI` object, which is defined in `preload.js`.
- These functions send IPC messages to the main process (`electron.js`).
- The main process listens for these messages, performs the requested action (e.g., `exec('child_process')` to run a script), and sends back results or status updates (like console output) to the renderer.
