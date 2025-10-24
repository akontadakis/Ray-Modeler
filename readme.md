# Ray Modeler △

> **Editor's Note:** This is a passion project that I've been developing for the past year, primarily as a learning exercise. It is not intended for commercial use but rather as a tool to help others explore, learn, and understand Radiance simulations and how they can improve building design.
> Please consider this a **beta version**. The intent is to improve it over time, but many features have not been extensively tested. If you run into a bug, your feedback would be greatly appreciated!

Ray Modeler is a desktop application providing a graphical user interface (GUI) for the Radiance Lighting Simulation Suite. Integrated with an AI Assistant, it streamlines daylighting and electric lighting analysis, from 3D modeling to simulation and results visualization.

![Ray Modeler Welcome Screen](./Pictures/welcome_screen.png)

## Table of Contents

- [Ray Modeler △](#ray-modeler-)
  - [Table of Contents](#table-of-contents)
  - [🚀 Getting Started](#-getting-started)
  - [✨ Core Capabilities](#-core-capabilities)
  - [🤖 AI Assistant (Helios)](#-ai-assistant-helios)
    - [AI-Powered Actions (Tool Use)](#ai-powered-actions-tool-use)
    - [Design Inspector](#design-inspector)
    - [Results Critique](#results-critique)
    - [Interactive Tutor](#interactive-tutor)
      - [Proactive Suggestions](#proactive-suggestions)
    - [Generative Design](#generative-design)
    - [API Key Configuration](#api-key-configuration)
    - [Getting Your API Key](#getting-your-api-key)
      - [Google Gemini API Key 🔑](#google-gemini-api-key-)
      - [OpenRouter API Key 🔑](#openrouter-api-key-)
      - [OpenAI API Key 🔑](#openai-api-key-)
      - [Anthropic API Key 🔑](#anthropic-api-key-)
  - [UI Walkthrough 💻](#ui-walkthrough-)
  - [📖 In-Depth Feature Guide](#-in-depth-feature-guide)
    - [📋 Scene Definition Panels](#-scene-definition-panels)
    - [📜 Simulation Modules (Recipes)](#-simulation-modules-recipes)
  - [Analysis Modules 📊](#analysis-modules-)
    - [Desktop Integration (Electron)](#desktop-integration-electron)
  - [🛠️ For Developers: Building from Source](#️-for-developers-building-from-source)
    - [Prerequisites](#prerequisites)
    - [Setup and Development](#setup-and-development)
    - [Building for Distribution](#building-for-distribution)
      - [Build for macOS 🍎](#build-for-macos-)
      - [Build for Windows 💻 (from any platform)](#build-for-windows--from-any-platform)
    - [Cross-Platform Building](#cross-platform-building)
  - [🛠️ Technology Stack](#️-technology-stack)
  - [License 📄](#license-)

## 🚀 Getting Started

To use Ray Modeler, you need a modern web browser and a local installation of the Radiance Lighting Simulation Suite. The desktop version (recommended) offers the best experience.

1. **Install Radiance**:
   Download and install [Radiance](https://www.radiance-online.org/) from the official website or the [NREL](https://github.com/NREL/Radiance) GitHub repository. Ensure the Radiance `bin` directory is in your system's PATH.

2. **Download Ray Modeler**:
   Download the latest release for your operating system (macOS or Windows) from the project's Releases page.

3. **Run the Application**:
   - *Windows*: Run the Ray Modeler Setup `.exe` installer.
   - *macOS*: Open the Ray Modeler `.dmg` and drag the application to your Applications folder.

**Security Warnings on First Launch**:

Because the app isn't code-signed, your OS might show a security warning. When a user on a Mac downloads and tries to open the unsigned app, they will be stopped by Gatekeeper, which will show a message like "Ray Modeler cannot be opened because the developer cannot be verified."

- **On Windows (SmartScreen)**: Click "**More info**", then click "**Run anyway**".

- **On macOS (Gatekeeper)**: **Right-click** (or Control-click) the app icon, select "**Open**" from the menu. A new dialog box will appear that is similar to the first one, but this time it will include an "**Open**" button. Clicking this will run the app. You only need to do this once. After the first successful launch, the app can be opened normally by double-clicking it.

## ✨ Core Capabilities

Ray Modeler is packed with features that automate and enhance the Radiance workflow:

- **Parametric Scene Modeling**: Define room dimensions, orientation, window-to-wall ratios (WWR), and shading devices like overhangs, light shelves, louvers, and roller shades.

- **Geometry Importer**: Import `.obj` models, with an interactive UI to tag surfaces (walls, floors, glazing) for simulation setup.

- **Context & Site Modeling**: Adding surrounding context, either through simple massing tools, topography from heightmaps, or by automatically fetching building data from OpenStreetMaps.

- **Interior Furniture Library**: Place simple furniture and partition objects from a pre-built library via drag-and-drop or import custom `.obj` assets..

- **Radiance Material Editor**: Configure standard Radiance materials (`plastic`, `metal`, `glass`) by adjusting properties like reflectance, specularity, and roughness. It also supports spectral data (`.dat`) files for advanced material definitions.

- **Advanced Glazing Systems**: Model glazing using simple transmittance values or incorporate complex fenestration data via Bidirectional Scattering Distribution Function (BSDF) `.xml` files. The application converts intuitive transmittance to physically-based transmissivity for simulations.

- **Interactive BSDF Viewer**: When a BSDF `.xml` file is loaded, the application can parse the Klems matrix and render an interactive 2D polar plot showing the angular distribution of transmitted light for any incident angle.

- **Electric Lighting Design**: Place and configure Radiance light source types (light, spotlight, glow, illum) or import luminaire data using `.ies` photometric files in individual or grid-based layouts.

- **IES Photometry Viewer**: In addition to a 2D polar plot, visualize luminaire distributions with an interactive 3D photometric web and view key metadata like lumens and wattage directly from the `.ies` file.

- **Daylighting Controls**: Simulate energy savings by implementing photosensor-controlled lighting systems with continuous, stepped, or off modes.

- **Daylighting Control Zone Visualization**: Instantly visualize which luminaires are controlled by which photosensors with color-coded 3D gizmos, providing immediate feedback on the daylighting strategy.

- **Automated Radiance Workflow**: Generates a complete, organized project folder structure (e.g., 01_geometry, 04_skies, 07_scripts) and populates it with geometry files, material definitions, sensor points, and executable run scripts for both Windows (`.bat`) and macOS/Linux (`.sh`).

- **First-Person View (FPV) Mode**: Enter the Radiance viewpoint camera directly to preview the exact perspective, fisheye, or parallel view that will be rendered for analysis.

- **Saved Camera Views ("Snapshots")**: Save and load specific camera positions and angles, complete with thumbnails, to quickly return to key perspectives during analysis.

- **Advanced Annual Analysis**: Generate and view temporal heatmaps, glare rose diagrams, and combined daylight/glare scatter plots to deeply understand annual performance.

- **Recipe-Based Simulation Engine**: Automate complex Radiance workflows with pre-configured "recipes." The application generates all necessary geometry files, material definitions, and executable run scripts (`.sh`, `.bat`) in a standardized project folder. Includes recipes for `IES LM-83 (sDA/ASE)`, `EN 17037`, and `EN 12464-1`.

- **Advanced Annual Methods**: Support for industry-standard annual simulation methods, including 3-Phase and 5-Phase Daylight Analysis.

- **Spectral Lighting Analysis**: A full implementation of the Lark methodology to run multi-channel simulations and calculate non-visual lighting metrics like melanopic and neuropic illuminance.

- **Automated Compliance Workflows**: Specialized recipes for checking compliance with major industry standards, including `IES LM-83 (sDA/ASE)`, `EN 17037 (Daylight in Buildings)`, and `EN 12464-1 (Light and lighting of work places)`.

- **Interactive HDR Image Analysis**: View High-Dynamic Range (HDR) renderings with exposure controls, toggle false-color luminance mode, and use a mouse-over probe to get exact cd/m² values. Detected glare sources can be overlaid directly onto the image for verification.

- **Live Sun Ray Tracing**: Visualize direct sun penetration in real-time. Trace a grid of rays from the sun's current position (calculated from the EPW file for any date/time) through glazing surfaces and see how they bounce around the interior, helping to quickly identify potential glare spots or assess daylight distribution.

- **File System Integration**: Using the File System Access API (or Electron's APIs), Ray Modeler can directly read from and save to a local project folder, enabling a seamless desktop-like experience.
  
- **AI Assistant (Helios)**: An integrated, context-aware AI chat powered by generative AI (Google Gemini, Anthropic, OpenAI, OpenRouter models) to help answer questions and directly manipulate the scene, run simulations, and control the UI using natural language commands.

- **Automated Report Generation**: Generate comprehensive HTML reports with a single click. The report includes project details, a 3D scene snapshot, key performance metrics (sDA, ASE, DGP), and all generated dashboard charts (UDI, Glare Rose), ready for printing or saving as a PDF.

- **Interactive Data Table**: Inspect raw simulation data in a sortable, filterable table. Click on any row to instantly highlight the corresponding sensor point in the 3D model, linking numerical data directly to its spatial context.

- **Daylight Autonomy Heatmaps**: Visualize annual performance not just as point-in-time illuminance, but also as Daylight Autonomy (DA), showing the percentage of occupied hours that each sensor point meets a specific illuminance threshold.

- **Climate Data Analysis**: Generate an interactive dashboard from the loaded EPW file, including a wind rose, solar radiation charts, and temperature profiles to better understand the site context.

- **Advanced Circadian Health Dashboard**: Analyze results from spectral simulations to calculate and visualize key circadian lighting metrics like Circadian Stimulus (CS), Equivalent Melanopic Lux (EML), and check for compliance with WELL building standards.

- **Keyboard Shortcuts**: Accelerate your workflow with keyboard shortcuts for common actions, such as `T` for Top View, `P` for Perspective, and `Ctrl+S` to save the project. A help modal (`?`) displays all available shortcuts.

- **Multi-View Layout (Quad View)**: Split the main viewport into four synchronized cameras (Perspective, Top, Front, Side) for comprehensive spatial awareness and precise object placement, a standard in professional 3D software.

- **Vegetation & Tree Modeling**: Add simple procedural trees and bushes from the Scene Elements library to your site. The vegetation canopy uses a Radiance `trans` material to accurately simulate its light-filtering effects, improving the realism of site-specific analyses.

## 🤖 AI Assistant (Helios)

The AI Assistant panel provides a chat interface to help you with your workflow. It understands the application's current state and can perform actions on your behalf using natural language commands.

---

### AI-Powered Actions (Tool Use)

Beyond answering questions, the assistant can directly manipulate the UI and query project data. This allows for a powerful natural language workflow. Its capabilities include:

- **Project Validation**: Ask it to `"validate my project for an annual glare simulation"` and it will check for common setup errors, such as a missing weather file or an incorrect viewpoint type, and report back any issues.
- **Advanced Scene Manipulation**:
  - **Shading**: `"Add a 0.5 meter deep overhang to the south wall."`
  - **Sensor Grids**: `"Enable a sensor grid on the floor with 0.75m spacing."`
  - **Daylighting**: `"Enable continuous daylighting controls with a setpoint of 500 lux."`
- **Simulation & Recipe Control**:
  - **Global Parameters**: `"Set the global ambient bounces to 5."`
  - **Recipe Configuration**: `"In the open illuminance recipe, change the time to 9:00 AM."`
- **Conversational Data Exploration & Comparison**:
  - **Data Query**: `"What is the average illuminance for the current results?"` or `"How many points are above 500 lux?"`
  - **Time Scrubbing**: `"Show me the results for the winter solstice at noon."`
  - **Dashboard Control**: `"Open the glare rose diagram."`
  - **Comparative Analysis**: `"Which of my two designs has better daylight uniformity?"` or `"Compare the sDA for both designs."`
- **File Management**:
  - **Load Results**: `"Load a results file into dataset A."`
  - **Clear Results**: `"Clear all loaded results data."`

### Design Inspector

The AI analyzes the entire project state to identify conflicting or suboptimal combinations of settings, explains the potential consequences, and offers a one-click fix.

> **AI Analysis:** "I've reviewed your project. Your wall reflectance is quite low (0.2), and you're only using 2 ambient bounces. This combination will likely result in an unrealistically dark rendering with noticeable splotches. I recommend increasing ambient bounces to 4 and wall reflectance to 0.5."
>
> **[Apply Fixes]**

### Results Critique

After a simulation completes, the AI can analyze the results, identify problems, and suggest specific, actionable design changes.

> **AI Analysis:** "The Daylight Glare Probability (DGP) is 0.47, which is considered 'Intolerable'. This is caused by low-angle sun from the west-facing window. To fix this, I suggest adding vertical louvers."
>
> **[Add Vertical Louvers]**

### Interactive Tutor

The AI can act as a tutor to guide new users through complex simulation workflows step-by-step, teaching them the process as they go.

> **User**: "How do I run a glare simulation?"
>
> **AI**: "Of course! To calculate DGP, we need a 180° fisheye view. Your current viewpoint is set to Perspective. Would you like me to change it for you?"
>
> **User**: "Yes"
>
> **AI**: *(Changes viewpoint)* "Great. Next, I'll open the DGP recipe panel for you." *(Opens recipe)* "Now you just need to click 'Generate Package' and run the simulation."

#### Proactive Suggestions

The AI Assistant monitors user actions and provides contextual, non-intrusive suggestions to guide the workflow and prevent common errors. These suggestions appear as dismissible chips in the UI. For example:

- After loading an **EPW weather file**, it will suggest opening an annual simulation recipe.
- If a material's **reflectance is set to an unusually high or low value**, it will warn that this may be physically unrealistic.
- If the user enables a **View Grid**, it will suggest opening the Imageless Annual Glare recipe.
- If the **DGP recipe is open but the viewpoint is not set to fisheye**, it will offer to correct the setting.

### Generative Design

Leverage the AI to perform automated, multi-step design tasks.

- **Scene Creation from Natural Language**: Instead of manually adjusting sliders, describe the space you want to build in plain English.

    > "Create a long office, 12 meters deep by 5 meters wide, with a 3-meter high ceiling. Put a large, continuous window across the entire south wall with a sill height of 0.8 meters. Add a 1-meter deep overhang above it and place two desks in the middle of the room."
- **Design Optimization**: Define a goal, constraints, and a design variable, and the assistant will orchestrate the entire workflow to find the best solution. For example:

    > "Find an overhang depth for the south wall between 0.5m and 2.0m that maximizes sDA while keeping ASE below 10%."

---

### API Key Configuration

The integrated AI Assistant requires an API key to function. It supports multiple providers for greater flexibility.

- **Expanded Provider Support**: Select between **OpenRouter**, **OpenAI**, **Google Gemini**, and **Anthropic**.
- **Provider-Specific Keys**: The application saves a separate API key for each provider, so you can switch between models without re-entering credentials.
- **AI Configuration**: A settings modal (⚙️ icon) allows you to select your preferred provider, choose from a list of popular models (e.g., Gemini 1.5 Pro, GPT-4o, Claude 3.5 Sonnet), and enter your API key.

---

### Getting Your API Key

#### Google Gemini API Key 🔑

You can get a free API key for the Gemini family of models from [Google AI Studio](https://aistudio.google.com/prompts/new_chat).

1. Go to the Google AI Studio website.
2. Sign in with your Google account.
3. Click the "`Get API key`" button, usually located in the top-left or top-right corner of the page.
4. A dialog will appear. Click "`Create API key`".
5. Your new API key will be generated and displayed.
6. Copy this key and paste it into the API Key field in the Ray Modeler AI settings.
*Note*: The Gemini API has a free tier with usage limits. Be sure to review Google's current pricing and terms of service.

#### OpenRouter API Key 🔑

OpenRouter provides access to a wide variety of models from different providers through a single API.

1. Go to the [OpenRouter.ai](https://openrouter.ai/) website and log in.
2. Click on your account icon in the top-right corner and select "`Keys`" from the dropdown menu.
3. Click the "`+ Create Key`" button. Give your key a name (e.g., "RayModeler") and click "`Create`".Your new API key will be generated.
4. Copy this key and paste it into the API Key field in the Ray Modeler AI settings.
*Note*: OpenRouter is a paid service. You will need to add credits to your account to use most models. To use some of the free models, you may need to adjust your privacy settings to allow your data to be used for model improvement.

#### OpenAI API Key 🔑

1. Go to the [OpenAI API keys](https://platform.openai.com/api-keys) page and log in.
2. Click the "`+ Create new secret key`" button.
3. Give your key a name (e.g., "RayModeler") and click "`Create secret key`".
4. Copy the generated key immediately and paste it into the API Key field in the Ray Modeler AI settings. You will not be able to view it again.

#### Anthropic API Key 🔑

1. Go to the [Anthropic Console](https://console.anthropic.com/) and log in.
2. Navigate to the "API Keys" section in your account settings.
3. Click the "`Create Key`" button.
4. Give the key a name and click "`Create Key`".
5. Copy the key and paste it into the API Key field in the Ray Modeler AI settings.

**Important**: Treat your API keys like passwords. Do not share them publicly or commit them to version control.

## UI Walkthrough 💻

The interface is designed around a logical workflow, guiding the user from setup to analysis.

![Ray Modeler Main UI](./Pictures/main_ui.png)
![Ray Modeler Main UI](./Pictures/main_ui_quad.png)
![Ray Modeler Panels](./Pictures/panels_ui.png)

- **3D Viewport (Center)**: This is the main interactive area where your 3D scene is displayed. You can navigate using standard orbit controls (mouse drag, scroll). The viewport can also be split into a **Quad View** layout, showing synchronized Perspective, Top, Front, and Side cameras for comprehensive spatial awareness.

- **Left Toolbar**: This is the primary command center for building your scene. It contains buttons to open floating panels for defining all aspects of the physical model, from **Project Setup** and **Dimensions** to **Simulation** and **Analysis** modules.

- **Top View Controls**: A quick-access toolbar to instantly switch between standard orthographic (Top, Front, etc.) and perspective camera views. It also includes the button to toggle the **Quad View** layout.

- **Bottom Toolbar (Bottom-Left)**: Provides quick access to global actions like saving/loading project files, viewing application information and keyboard shortcuts, and launching the AI Assistant.

- **Floating Panels**: All scene definition, simulation, and analysis tools open as independent floating windows. These panels can be dragged, resized, collapsed, and arranged anywhere on the screen, allowing you to create a workspace tailored to your needs.

- **AI Assistant Sidebar (Right)**: A dedicated, resizable sidebar that houses the conversational AI Assistant. This keeps the AI's powerful capabilities accessible without cluttering your modeling and analysis workflow.

## 📖 In-Depth Feature Guide

### 📋 Scene Definition Panels

The panels on the left toolbar are used to define the scene.

- **Project Setup**: This is the starting point for any analysis.

  - *Project Details*: Define project name, description, and building type.
  
  - *Radiance Path*: Specify the local installation path for the Radiance binaries. The application provides a helpful reminder and defaults based on your OS.
  
  - *Climate & Location*: Upload an (`.epw`) weather file to auto-populate location data or set latitude/longitude manually using an interactive map.
  
  - *Occupancy Schedule*: A utility to generate an 8760-hour occupancy schedule file (`.csv`) based on selected days of the week and occupied hours. This file can be used in annual glare and daylighting control simulations.

- **Dimensions**: Set the foundational geometry of the room.

  - *Geometry Mode*: Choose between **Parametric** (for the simple box model) or **Imported** (for complex models).
  
  - *Parametric Controls*: Set the **Width (X), Length (Z), Height (Y)** and rotate the entire room with the **Orientation** slider.
  
  - *Geometry Importer*: Import `.obj` models. Includes tools for automatic scaling and centering. After import, a **Surface Tagger** UI appears, allowing you to assign Radiance-relevant surface types (wall, floor, glazing, etc.) to each material from the original file.

- **Apertures & Shading**: Control openings and shading systems on a per-wall basis.

  - *Wall Selection*: Click on a wall in the 3D view to select it for editing. The selection can be locked to prevent accidental changes.
  
  - *Aperture Mode*: Define windows using either Window-to-Wall Ratio (WWR) or a Manual mode for precise control over width, height, and sill height.
  
  - *Shading Devices*: Each wall can have its own complex shading system, including:
  
    - Overhangs, Light Shelves, Louvers, and Roller Shades with detailed parametric controls.
    - **Imported OBJ**: Import a custom shading device from an `.obj` file, with in-scene controls for position, rotation, and scale.

- *Interactive Sun Ray Tracer*: Integrated directly into the wall selection workflow, this tool allows you to trace a specified number of rays from the sun's position for any date and time. It provides immediate visual feedback on sun penetration and internal reflections.

- **Artificial Lighting**: Add and configure electric light sources.

  - *Light Source Types*: Choose from standard Radiance primitives or upload an `.ies` file.
  
  - *Interactive IES Photometry Viewer*: When an `.ies` file is loaded, the application generates an interactive 2D polar plot and a **3D Photometric Web** to visualize the luminaire's distribution. Key data like total lumens, wattage, and efficacy are also displayed.

  - *Daylighting Controls*: Define up to two photosensors with 3D position and direction vectors to create distinct control zones.
  
  - *Interactive Control Zone Visualization*: A "Visualize Control Zones" toggle color-codes the 3D luminaire gizmos based on their assigned sensor, providing immediate feedback on the daylighting strategy.

- **Material Properties**: Define the surface characteristics of the room's parametric or imported geometry.
  
- **Sensor Grid**: Create measurement points for simulations.
  
- **Viewpoint**: Controls the specific camera view used by Radiance for generating renderings.

  - *FPV Mode*: Enter a first-person view to see exactly what Radiance will render.
  
  - *3D Gizmo*: A transform gizmo allows you to visually manipulate the camera's position and rotation.

  - *Saved Views ("Snapshots")*: A "Save Current View" button captures the camera's state. The UI displays a list of saved views with thumbnails, which can be clicked to instantly restore a perspective.

- **Scene Elements**: Add and manage non-architectural objects in the scene.

  - *Interior Furniture Library*: A panel with pre-built, low-polygon assets (desks, chairs, partitions) that can be dragged and dropped into the 3D scene.
  
  - *Context & Site Modeling*: Tools to model the surrounding environment for more accurate simulations.
    - **Simple Massing Tools**: Create and place simple 3D shapes (boxes, cylinders) to represent surrounding buildings.
    - **Topography Import**: Generate a ground plane with topography from a grayscale heightmap image.
    - **OpenStreetMaps Integration**: Automatically fetch building footprints and height data for a given location to generate a basic urban context.

### 📜 Simulation Modules (Recipes)

Each recipe in the Simulation Sidebar automates a specific Radiance workflow by generating scripts that call core commands like `oconv`, `rpict`, `rcontrib`, and `evalglare`. Global simulation parameters (`-ab`, `-ad`) can be set once and overridden per recipe.

- **Global Simulation Parameters**: Sets default Radiance parameters (e.g., `-ab`, `-ad`, `-aa`) that are inherited by all other recipes, ensuring consistency.

- **Illuminance Map**: A point-in-time calculation that produces illuminance (lux) values for each point in your sensor grid.

- **Photorealistic Rendering**: Creates a high-dynamic-range (HDR) image from the specified Viewpoint.

- **Daylight Glare Probability (DGP)**: Renders a 180° fisheye image and analyzes it for glare using `evalglare`.

- **Daylight Factor (DF)**: Calculates the ratio of internal to external illuminance under a standard CIE overcast sky.

- **Annual Daylight (3-Phase & 5-Phase)**: Generates scripts for advanced annual simulations using matrix-based methods.

- **Imageless Annual Glare**: An advanced recipe using `rcontrib` and `dcglare` to efficiently calculate an 8760-hour DGP profile.

- **Spectral Analysis (Lark)**: Implements the Lark methodology for multi-channel spectral simulations to calculate non-visual lighting metrics.

- **Compliance Recipes**: A suite of specialized recipes for checking compliance with major industry standards:
  - `IES LM-83 (sDA/ASE)`
  - `EN 17037 (Daylight in Buildings)`
  - `EN 12464-1 (Illuminance & UGR for Work Places)`

- **Lighting Energy Analysis**: Runs an annual simulation with daylighting controls to estimate energy consumption (kWh/year) and savings.

- **Façade Irradiation Analysis**: A recipe to calculate the total annual solar irradiation (in kWh/m²/year) on an exterior façade, essential for envelope design and assessing potential for building-integrated photovoltaics (BIPV).

- **Annual Solar Radiation Maps**: An annual simulation that calculates the cumulative solar radiation on interior surfaces, visualized as a heatmap. This is critical for understanding passive solar heating potential and predicting long-term material degradation.

## Analysis Modules 📊

The Analysis Sidebar uses a background Web Worker to parse various Radiance result files without freezing the interface. The application automatically detects the file type and enables the relevant visualization tools.

- **3D Visualization**: Illuminance data is mapped as a false-color grid onto the 3D model, with a customizable color scale and support for comparing two datasets.

- **Annual Metrics Dashboard**: For annual `.ill` files, this dashboard visualizes key metrics like Spatial Daylight Autonomy (sDA), Annual Sunlight Exposure (ASE), and Useful Daylight Illuminance (UDI).

- **Climate Analysis Dashboard**: When an EPW file is loaded, this dashboard provides interactive visualizations of the climate data, including a Wind Rose, Solar Radiation chart, and Annual Temperature chart.

- **Temporal Map**: After loading annual results, clicking on any sensor point in the 3D view generates a 24x365 heatmap showing the hour-by-hour illuminance profile for that specific point.

- **Glare Rose Diagram**: For annual `.dgp` files, this generates a polar chart showing the number of occupied hours that exceed a DGP threshold, organized by the sun's position.

- **Combined Daylight vs. Glare Plot**: When both annual illuminance and glare files are loaded, this scatter plot is available. Each point represents a sensor, plotting its percentage of useful daylight hours against its percentage of glare hours.

- **HDR Viewer**: Loads and displays rendered `.hdr` images with exposure controls, a false-color luminance mode, and a mouse-over probe to get exact cd/m² values.

- **Advanced Circadian Health Dashboard**: Visualizes results from spectral simulations, including key metrics like Circadian Stimulus (CS), Equivalent Melanopic Lux (EML), and checks for compliance with WELL building standards.

- **Automated Report Generation**: A "Generate Report" button compiles all project information, a 3D snapshot, key metrics, and all dashboard charts into a single, self-contained HTML file for printing or saving as a PDF.

### Desktop Integration (Electron)

Ray Modeler operates as an Electron-based desktop application, enabling direct interaction with your file system.

- **Standardized Project Folder**: When you save a project, the application creates a complete, organized folder structure on your local machine.

- **Simulation Console**: A built-in console window appears when you run a simulation, showing the live output from the Radiance processes and reporting the final exit code (success or failure).

## 🛠️ For Developers: Building from Source

You can run the application in a local development environment or build a distributable, single-click installer for macOS and Windows using `electron-builder`.

### Prerequisites

Before you begin, ensure you have the following installed on your system:

- **Node.js and npm**: [Download & Install Node.js](https://nodejs.org/en) (npm is included).
- **Git**: [Download & Install Git](https://git-scm.com/).

### Setup and Development

1. **Clone the Repository and Install Dependencies**

    ```bash
    # Clone the repository
    git clone [https://github.com/your-username/ray-modeler.git](https://github.com/your-username/ray-modeler.git)
    
    # Navigate into the project directory
    cd ray-modeler
    
    # Install the necessary npm packages
    npm install

    # Update the npm packages
    npm update
    ```

2. **Run the App in Development Mode**

    To run the full Electron application with all features (including file system access and simulation execution), use the start script:

    ```bash
    npm start
    ```

    This will launch the application in a development window with access to developer tools.

### Building for Distribution

The following commands use `electron-builder` to package the application into a distributable format. The final installer/application files will be located in the `dist/` directory.

#### Build for macOS 🍎

This command bundles the application into a standard `.dmg` disk image for macOS.

```bash
npm run build:mac
```

#### Build for Windows 💻 (from any platform)

This command creates NSIS installers (`.exe`) for both **x64** and **arm64** Windows architectures.

**Prerequisite for macOS/Linux users**: To build a Windows app on a non-Windows machine, you must have [Wine](https://www.winehq.org/) installed. You can install it easily with Homebrew:

```Bash
brew install --cask wine-stable
```

Once Wine is installed, run the build script:

```Bash
npm run build:win
```

This will generate two installers in the dist/ folder, for example: Ray Modeler Setup 1.1.0-x64.exe and Ray Modeler Setup 1.1.0-arm64.exe.

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
