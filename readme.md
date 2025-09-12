# Ray Modeler △

> **Editor's Note:** This is a passion project that I've been developing for the past year, primarily as a learning exercise. It is not intended for commercial use but rather as a tool to help others explore, learn, and understand Radiance simulations and how they can improve building design.
> Please consider this a **beta version**. The intent is to improve it over time, but many features have not been extensively tested. If you run into a bug, your feedback would be greatly appreciated!

Ray Modeler is a web-based graphical user interface for the Radiance Lighting Simulation Suite. It streamlines the entire daylighting and electric lighting analysis workflow, from parametric 3D modeling to simulation script generation and advanced results visualization.

Designed for lighting designers, architects, and building science researchers, Ray Modeler provides an intuitive, interactive environment to model, simulate, and analyze lighting performance in single-zone spaces without needing to write Radiance code manually.

| Welcome Screen |
| :---: |
| ![Ray Modeler Welcome Screen](/Users/a.kontadakis/Documents/Dev/Ray-Modeler/Pictures/welcome_screen.png) |

## Table of Contents

- [Ray Modeler △](#ray-modeler-)
  - [Table of Contents](#table-of-contents)
  - [✨ Core Capabilities](#-core-capabilities)
  - [🚀 Getting Started](#-getting-started)
  - [🤖 AI Assistant](#-ai-assistant)
    - [API Key Configuration](#api-key-configuration)
    - [Getting Your API Key](#getting-your-api-key)
  - [UI Walkthrough 💻](#ui-walkthrough-)
  - [📖 In-Depth Feature Guide](#-in-depth-feature-guide)
    - [📋 Scene Definition Panels](#-scene-definition-panels)
    - [📜 Simulation Modules (Recipes)](#-simulation-modules-recipes)
  - [Analysis Modules 📊](#analysis-modules-)
    - [Desktop Integration (Electron)](#desktop-integration-electron)
  - [🛠️ For Developers: Building from Source](#️-for-developers-building-from-source)
    - [Prerequisites](#prerequisites)
    - [Build for macOS 🍎](#build-for-macos-)
    - [Build for Windows 💻](#build-for-windows-)
    - [Cross-Platform Building](#cross-platform-building)
  - [🛠️ Technology Stack](#️-technology-stack)
  - [License 📄](#license-)

## ✨ Core Capabilities

Ray Modeler is packed with features that automate and enhance the Radiance workflow:

- **Parametric Scene Modeling**: Visually define room dimensions, orientation, window-to-wall ratios (WWR), and complex shading devices like overhangs, light shelves, louvers, and roller shades.

- **Radiance Material Editor**: Configure standard Radiance materials (`plastic`, `metal`, `glass`) by adjusting properties like reflectance, specularity, and roughness. It also supports spectral data (`.dat`) files for advanced material definitions.

- **Advanced Glazing Systems**: Model glazing using simple transmittance values or incorporate complex fenestration data via Bidirectional Scattering Distribution Function (BSDF) `.xml` files. The application correctly converts intuitive transmittance to physically-based transmissivity for simulations.

- **Electric Lighting Design**: Place and configure multiple Radiance light source types (light, spotlight, glow, illum) or import real-world luminaire data using IES photometric files in individual or grid-based layouts.

- **Daylighting Controls**: Simulate energy savings by implementing photosensor-controlled lighting systems with continuous, stepped, or off modes.
  
- **Automated Radiance Workflow**: Generates a complete, organized project folder structure (e.g., 01_geometry, 04_skies, 07_scripts) and populates it with geometry files, material definitions, sensor points, and executable run scripts for both Windows (`.bat`) and macOS/Linux (`.sh`).

- **First-Person View (FPV) Mode**: Enter the Radiance viewpoint camera directly to preview the exact perspective, fisheye, or parallel view that will be rendered for analysis.

- **Advanced Annual Analysis**: Generate and view temporal heatmaps, glare rose diagrams, and combined daylight/glare scatter plots to deeply understand annual performance.

- **Recipe-Based Simulation Engine**: Automate complex Radiance workflows with pre-configured "recipes." The application generates all necessary geometry files, material definitions, and executable run scripts (`.sh`, `.bat`) in a standardized project folder.

- **Advanced Annual Methods**: Support for industry-standard annual simulation methods, including 3-Phase and 5-Phase Daylight Analysis.

- **Spectral Lighting Analysis**: A full implementation of the Lark methodology to run multi-channel simulations and calculate non-visual lighting metrics like melanopic and neuropic illuminance.

- **Automated Compliance Workflows**: Specialized recipes for checking compliance with major industry standards, including `IES LM-83 (sDA/ASE)`, `EN 17037 (Daylight in Buildings)`, and `EN 12464-1 (Light and lighting of work places)`.

- **Interactive HDR Image Analysis**: View High-Dynamic Range (HDR) renderings with exposure controls, toggle false-color luminance mode, and use a mouse-over probe to get exact cd/m² values. Detected glare sources can be overlaid directly onto the image for verification.

- **File System Integration**: Using the File System Access API (or Electron's APIs), Ray Modeler can directly read from and save to a local project folder, enabling a seamless desktop-like experience.
  
- **AI Assistant**: An integrated, context-aware AI chat powered by generative AI (Google Gemini or models via OpenRouter) that can answer questions and directly manipulate the scene, run simulations, and control the UI using natural language commands.

## 🚀 Getting Started

To use Ray Modeler, you will need a modern web browser and a local installation of the Radiance Lighting Simulation Suite.
The desktop version provides the most seamless experience.

1. **Install Radiance**:
   Download and install [Radiance](https://www.radiance-online.org/) from the official website or the [NREL](https://github.com/NREL/Radiance) GitHub repository. Ensure the Radiance `bin` directory is in your system's PATH.

2. **Download Ray Modeler**:
   Download the latest release for your operating system (macOS or Windows) from the project's Releases page.

3. **Run the Application**:
   - *Windows*: Run the Ray Modeler Setup X.X.X.exe installer.
   - *macOS*: Open the Ray Modeler-X.X.X.dmg and drag the application to your Applications folder.

Security Warnings on First Launch:

Because the application is not yet code-signed, your operating system will likely show a security warning. When a user on a Mac downloads and tries to open the unsigned app, they will be stopped by Gatekeeper, which will show a message like "Ray Modeler cannot be opened because the developer cannot be verified."

- **On Windows (SmartScreen)**: Click "**More info**", then click "**Run anyway**".

- **On macOS (Gatekeeper)**: **Right-click** (or Control-click) the app icon, select "**Open**" from the menu. A new dialog box will appear that is similar to the first one, but this time it will include an "**Open**" button. Clicking this will run the app. You only need to do this once. After the first successful launch, the app can be opened normally by double-clicking it.

## 🤖 AI Assistant

The AI Assistant panel provides a chat interface to help you with your workflow. It understands the application's current state and can perform actions on your behalf using natural language commands.

- **Context-Aware Chat**: Ask questions about Radiance, lighting concepts, or your current project setup. The AI analyzes your scene's parameters to provide tailored advice.

- **AI-Powered Actions (Tool Use)**: Beyond answering questions, the assistant can directly manipulate the UI. Ask it to change settings, run simulations, or analyze results.

- **Scene & Project Management**: Modify nearly any parameter in the scene. Ask it to `"Change the room width to 5 meters"`, `"set the wall reflectance to 0.6"` or `"save the project"`..

- **Simulation Control**: Control the entire simulation workflow. You can instruct it to `"Open the illuminance recipe"`, `"run the rendering simulation"`, `"show me the average illuminance"`.

- **3D Viewport & UI Control**: Manipulate the interface and visualization. For example: `"change the view to 'top',"` `"move the viewpoint camera to the center of the room,"` `"highlight the sensor with the maximum value,"` or `"close the dimensions panel"`.

### API Key Configuration

The integrated AI Assistant requires an API key to function. It can be configured to use Google Gemini or any model available through OpenRouter.

- **AI Configuration**: A settings modal allows you to select your preferred AI provider, choose from a list of models (e.g., Gemini 2.5 Pro, GPT-5, Claude 3.7 Sonnet), and **enter your own API key for access**.

### Getting Your API Key

Google Gemini API Key 🔑:

You can get a free API key for the Gemini family of models from [Google AI Studio](https://aistudio.google.com/prompts/new_chat).

1. Go to the Google AI Studio website.

2. Sign in with your Google account.

3. Click the "`Get API key`" button, usually located in the top-left or top-right corner of the page.

4. A dialog will appear. Click "`Create API key`".

5. Your new API key will be generated and displayed.

6. Copy this key and paste it into the API Key field in the Ray Modeler AI settings.

*Note*: The Gemini API has a free tier with usage limits. Be sure to review Google's current pricing and terms of service.

OpenRouter API Key 🔑:

OpenRouter provides access to a wide variety of models from different providers through a single API.

1. Go to the [OpenRouter.ai](https://openrouter.ai/) website and log in.

2. Click on your account icon in the top-right corner and select "`Keys`" from the dropdown menu.

3. Click the "`+ Create Key`" button. Give your key a name (e.g., "RayModeler") and click "`Create`".Your new API key will be generated.

4. Copy this key and paste it into the API Key field in the Ray Modeler AI settings.

*Note*: OpenRouter is a paid service. You will need to add credits to your account to use most models. To use some of the free models, you may need to adjust your privacy settings to allow your data to be used for model improvement.

**Important**: Treat your API keys like passwords. Do not share them publicly or commit them to version control.

## UI Walkthrough 💻

The interface is designed around a logical workflow, guiding the user from setup to analysis.

| Main Interface |
| :---: |
| ![Ray Modeler Main UI](/Users/a.kontadakis/Documents/Dev/Ray-Modeler/Pictures/main_ui.png) |

- **3D Viewport (Center)**: The main interactive area where the 3D scene is displayed. You can navigate the scene using standard orbit controls (mouse drag, scroll).
  
- **Left Toolbar**: Contains buttons to access panels for defining all aspects of the physical scene, from project location to material properties.
  
- **Top View Controls**: A quick-access toolbar to switch between standard orthographic (Top, Front, etc.) and perspective camera views.
  
- **Bottom Toolbar (Bottom-Left)**: Provides quick access to save/load project files, view application information, and open the AI Assistant.
  
- **Right Sidebar (Simulation & Analysis)**: This dual-purpose sidebar allows you to set up simulation recipes and later load the results for visualization and analysis.

## 📖 In-Depth Feature Guide

### 📋 Scene Definition Panels

The panels on the left toolbar are used to define the scene.

- **Project Setup**: This is the starting point for any analysis.

  - *Project Details*: Define project name, description, and building type.
  
  - *Radiance Path*: Specify the local installation path for the Radiance binaries. The application provides a helpful reminder and defaults based on your OS.
  
  - *Climate & Location*: Upload an (`.epw`) weather file to auto-populate location data or set latitude/longitude manually using an interactive map.
  
  - *Occupancy Schedule*: A utility to generate an 8760-hour occupancy schedule file (`.csv`) based on selected days of the week and occupied hours. This file can be used in annual glare and daylighting control simulations.

- **Dimensions**: Set the foundational geometry of the room.

  - *Width (X), Length (Z), Height (Y)*: Sliders to control the room's interior dimensions.
  
  - *Orientation*: A slider to rotate the entire room, affecting its solar exposure relative to North.
  
- **Apertures & Shading**: Control openings and shading systems on a per-wall basis.

  - *Wall Selection*: Click on a wall in the 3D view to select it for editing. The selection can be locked to prevent accidental changes.
  
  - *Aperture Mode*: Define windows using either Window-to-Wall Ratio (WWR) or a Manual mode for precise control over width, height, and sill height.
  
  - *Shading Devices*: Each wall can have its own complex shading system, including:
  
    - Overhangs: With controls for depth, tilt, thickness, and extension.
  
    - Light Shelves: Can be placed externally, internally, or both, with independent controls for each.
  
    - Louvers: Can be horizontal or vertical, with controls for slat dimensions, spacing, angle, and distance to glass.
  
    - Roller Shades: Defined with detailed physical properties for simulation (transmittance, reflectance, emissivity, etc.) and placement controls.

- **Artificial Lighting**: Add and configure electric light sources.

  - *Light Source Types*: Choose from standard Radiance primitives (light, spotlight, glow, illum) or upload an .ies file for a specific luminaire.
  
  - *Geometry*: Define the light source shape (Polygon, Sphere, Cylinder, Ring).
  
  - *Placement*: Place lights individually or arrange them automatically in a grid with defined row/column spacing.
  
  - *Daylighting Controls*: Define a daylighting sensor with a specific position and direction, and set control parameters (setpoint, continuous/stepped dimming, etc.) for energy simulations.

- **Material Properties**: Define the surface characteristics of the room.

  - *Surface Selection*: Tabs for Walls, Floor, Ceiling, Frames, and Shading devices.
  
  - *Material Type*: Choose between Plastic, Glass, or Metal.
  
  - *Reflectance Mode*: Define reflectance using a simple grayscale value or an advanced spectral data file (`.dat`).
  
  - *Parameters*: Adjust reflectance, specularity, and roughness for each material.
  
  - *Glazing*: Control the visual transmittance of the glass. For advanced simulations, you can attach a BSDF XML file.

- **Sensor Grid**: Create measurement points for simulations.

  - *Illuminance Grid*: Generates a grid of points on any selected surface (walls, floor, ceiling) with a defined spacing and offset. These points are used for illuminance map and annual daylight simulations.
  
  - *View Grid*: Generates a grid of points on a horizontal plane, with multiple view directions at each point. This is used for imageless annual glare analysis.
  
  - *3D Visualization*: Both grid types can be toggled for visibility in the 3D viewport.

- **Viewpoint**: Controls the specific camera view used by Radiance for generating renderings (`rpict`) and glare images (`evalglare`).

  - *View Type*: Select from Perspective, Fisheye, Cylindrical, Parallel, or Angular Fisheye.
  
  - *FPV Mode*: Enter a first-person view to see exactly what Radiance will render from the camera's position.
  
  - *3D Gizmo*: A transform gizmo allows you to visually manipulate the camera's position and rotation directly in the 3D scene.

- **View Options**: Adjust the live 3D preview for better inspection.

  - *Transparency*: Make all surfaces semi-transparent to see inside the model.
  
  - *Section Cuts*: Enable horizontal or vertical clipping planes to create live section views of the interior.
  
  - *Live Preview*: When a section cut is active, you can render a real-time preview of that view using the loaded weather data (Electron version only).

### 📜 Simulation Modules (Recipes)

Each recipe in the Simulation Sidebar automates a specific Radiance workflow by generating scripts that call core commands like `oconv`, `rpict`, `rcontrib`, and `evalglare`. Global simulation parameters (`-ab`, `-ad`) can be set once and overridden per recipe.

- **Global Simulation Parameters**: Sets default Radiance parameters (e.g., `-ab`, `-ad`, `-aa`) that are inherited by all other recipes, ensuring consistency. Each recipe panel allows for overriding these globals. [Ambient Calculation-Crash Course](https://share.google/zPsplY69eNWSAJlJB), [Radiance Primer](https://share.google/xgioEptLWbUZt87Sm).

- **Illuminance Map**: A point-in-time calculation that produces illuminance (lux) values for each point in your sensor grid.

- **Photorealistic Rendering**: Creates a high-dynamic-range (HDR) image from the specified Viewpoint. [The RADIANCE Lighting Simulation and Rendering System](https://www.radiance-online.org/learning/tutorials).

- **Daylight Glare Probability (DGP)**: Renders a 180° fisheye image and analyzes it for glare using evalglare, producing a DGP value and a detailed report on glare sources.

- **Daylight Factor (DF)**: Calculates the ratio of internal to external illuminance under a standard CIE overcast sky.

- **Annual Daylight (3-Phase)**: Generates scripts to run rcontrib to create the View, Daylight, and Sky matrices and then uses dctimestep to perform the final annual calculation.

- **Annual Daylight (5-Phase)**: An extended version of the 3-Phase method for higher accuracy with complex fenestration by precisely modeling direct sun contributions.

- **Imageless Annual Glare**: An advanced recipe using rcontrib and dcglare to efficiently calculate an 8760-hour DGP profile for the defined view grid, enabling Glare Autonomy (GA) calculations.

- **Spectral Analysis (Lark)**: Implements the [Lark v3.0](https://faculty.washington.edu/inanici/Lark/Lark_home_page.html) methodology for 3-channel and 9-channel spectral simulations, producing spectral irradiance and HDR images from spectral data files (`.spd`, `.dat`).

- **sDA & ASE (LM-83)**: A dedicated recipe that runs the full IES LM-83 workflow for calculating Spatial Daylight Autonomy (sDA) and Annual Sun Exposure (ASE), including the simulation of dynamic blind operation based on direct sunlight.

- **EN 17037 Compliance (Daylight in Buildings)**: A comprehensive recipe that automates the four core checks for the European daylighting standard: Daylight Provision, Exposure to Sunlight, View Out, and Protection from Glare.

  - *Daylight Provision*: Runs a full annual simulation and uses a Python helper script to check illuminance targets against daylight hours derived from the EPW file.
  
  - *Sunlight Exposure*: Runs a point-in-time raytracing analysis for a specific day to calculate the duration of direct sun access.
  
  - *View Out*: Generates a fisheye image for manual verification.
  
  - *Protection from Glare*: Runs the Imageless Annual Glare recipe and uses a Python helper script to check results against the standard's threshold.

- **EN 12464-1 Illuminance & UGR**: Two separate recipes to verify lighting quality in work places.

  - The Illuminance recipe calculates maintained illuminance (Em) and uniformity (U0​) on the Task and Surrounding grids.
  
  - The UGR recipe uses evalglare to calculate the Unified Glare Rating from the observer's viewpoint.

## Analysis Modules 📊

The Analysis Sidebar uses a background Web Worker to parse various Radiance result files without freezing the interface. The application automatically detects the file type and enables the relevant visualization tools.

- **3D Visualization**: Illuminance data (`.txt`, `.ill`) is mapped as a false-color grid onto the 3D model. The color scale and palette are fully customizable. A comparison mode allows for visualizing the difference between two datasets.

- **Annual Metrics Dashboard**: For annual `.ill` files, this dashboard visualizes key climate-based metrics like Spatial Daylight Autonomy (sDA) and Annual Sunlight Exposure (ASE), and a stacked bar chart detailing the percentages of Useful Daylight Illuminance (UDI).

- **Temporal Map**: After loading annual results, clicking on any sensor point in the 3D view generates a 24x365 heatmap showing the hour-by-hour illuminance profile for that specific point throughout the year.

- **Glare Rose Diagram**: For annual `.dgp` files, this generates a polar chart showing the number of occupied hours that exceed a DGP threshold, organized by the sun's position in the sky.

- **Combined Daylight vs. Glare Plot**: When both annual illuminance and glare files are loaded, this scatter plot is available. Each point represents a sensor, plotting its percentage of useful daylight hours against its percentage of glare hours.

- **HDR Viewer**: Loads and displays rendered .hdr images. Features include exposure controls, a false-color mode based on luminance, a mouse-over probe to get exact cd/m² values, and an overlay for detected glare sources.

- **Spectral Metrics Dashboard**: When results from the Lark spectral recipe are loaded, this dashboard displays space-averaged values for key non-visual lighting metrics, including Photopic Illuminance (lux), Melanopic EDI (m-EDI lux), and Neuropic Irradiance (W/m²).

### Desktop Integration (Electron)

Ray Modeler operates as an Electron-based desktop application, enabling direct interaction with your file system.

- **Standardized Project Folder**: When you save a project, the application creates a complete, organized folder structure on your local machine:

  - `01_geometry/`
  
  - `02_materials/`
  
  - `03_views/`
  
  - `04_skies/`
  
  - `05_bsdf/`

  - `07_scripts/`
  
  - `08_results/`

  - `10_schedules/` (For occupancy and lighting control schedules)

  - `11_files/`(For IES, spectral data, etc.)

  - `project_name.json` (The master project settings file)

- **Simulation Console**: A built-in console window appears when you run a simulation, showing the live output from the Radiance processes and reporting the final exit code (success or failure).

## 🛠️ For Developers: Building from Source

You can build a distributable, single-click installer for macOS and Windows distribution using `electron-builder`.

### Prerequisites

Before you begin, ensure you have the following installed on your system:

- **Node.js and npm**: [Download & Install Node.js](https://nodejs.org/en) (npm is included).

- **Git**: [Download & Install Git](https://git-scm.com/).

1. **Project Setup**

Clone the repository and install the necessary development dependencies.

```Bash
# Clone the Repository
git clone https://github.com/your-username/ray-modeler.git

cd ray-modeler

# Install Dependencies
npm install

# Update
npm update
```

2. **Running in Development Mode**

To run the application locally in a browser (without Electron features), serve the files from a local web server.

```Bash
# Using Python 3
python -m http.server

# Or with Node.js live-server
npm install -g live-server
live-server
```

*Open in Browser*:

Navigate to (<http://localhost:8000>) (or the address provided by your server) in your web browser.

To run the full Electron application for development:

```Bash
npm start
```

3. **Building for Distribution**

The following commands use `electron-builder` to package the application into a distributable format. Output files will be in the `dist/` directory.

### Build for macOS 🍎

This command creates a `.dmg` disk image, which is the standard for distributing Mac applications.

1. Run the Mac build script:

```bash
npm run build:mac
```

This creates a `.dmg` disk image and a `.app` bundle in the `dist/` folder.

### Build for Windows 💻

This command creates an NSIS installer (`.exe`), which guides users through the installation process.

```Bash
npm run build:win
```

This creates an NSIS installer (.exe) and an unpacked portable version in the dist/ folder.

*Note on Cross-Platform Building*:

While possible, it's recommended to build for a target platform on that same platform.

### Cross-Platform Building

While it's recommended to build for a specific platform on that platform (e.g., build for Windows on a Windows machine), `electron-builder` supports cross-platform compilation with some setup:

- **Building for Windows on macOS/Linux**: Requires installing **Wine**.

- **Building for macOS on Windows/Linux**: Requires a macOS machine for code signing, so it's not practically feasible.

- **Building for Linux on macOS/Windows**: Can be done directly.

For detailed instructions on cross-platform builds, please refer to the [electron-builder documentation](https://www.electron.build/multi-platform-build).

## 🛠️ Technology Stack

- **3D Rendering**: [Three.js](https://threejs.org/)

- **Lighting Simulation Engine**: [Radiance](https://www.radiance-online.org/)

- **Data Visualization**: [Chart.js](https://www.chartjs.org/)

- **Mapping**: [Leaflet](https://leafletjs.com/)

- **UI Framework**: [Vanilla JS](http://vanilla-js.com/), HTML5, [CSS3 with TailwindCSS utilities](https://tailwindcss.com/)

- **Desktop App**: [Electron](https://www.electronjs.org/) (optional, for direct script execution)

## License 📄

This project is licensed under the [MIT](https://opensource.org/license/mit) License - also see the LICENSE file for details.
