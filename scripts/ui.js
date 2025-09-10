// scripts/ui.js

import { updateScene, axesObject, updateSensorGridColors, roomObject, shadingObject, sensorMeshes, wallSelectionGroup, highlightWall, clearWallHighlights, updateHighlightColor } from './geometry.js';
import { activeCamera, perspectiveCamera, orthoCamera, setActiveCamera, onWindowResize, controls, transformControls, sensorTransformControls, viewpointCamera, viewCamHelper, scene, updateLiveViewType, renderer, toggleFirstPersonView as sceneToggleFPV, isFirstPersonView as sceneIsFPV, fpvOrthoCamera } from './scene.js';
import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { project } from './project.js';
// The generateAndStoreOccupancyCsv function needs to be available to other modules like project.js
export { generateAndStoreOccupancyCsv };
import { resultsManager, palettes } from './resultsManager.js';
import { updateAnnualMetricsDashboard, clearAnnualDashboard, openTemporalMapForPoint, openGlareRoseDiagram, updateGlareRoseDiagram, openCombinedAnalysisPanel, updateCombinedAnalysisChart } from './annualDashboard.js';
import { initHdrViewer, openHdrViewer } from './hdrViewer.js';


// --- MODULE STATE ---
const dom = {}; // No longer exported directly
export function getDom() { return dom; } // Export a getter function instead

let updateScheduled = false;
export let selectedWallId = null;
let isWallSelectionLocked = false;

// Debounce utility to prevent rapid-fire updates from sliders
let debounceTimer;
function debounce(func, delay) {
    return function(...args) {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };
}

const debouncedScheduleUpdate = debounce(scheduleUpdate, 250); // 250ms delay

let map, tileLayer;
let maxZ = 100;

/**
* Generates an 8760-hour occupancy schedule CSV content based on UI controls
* and stores it in the project's simulation files.
*/
function generateAndStoreOccupancyCsv() {
    // Only generate if the feature is toggled on
    if (!dom['occupancy-toggle']?.checked) return;

    const startTime = parseFloat(dom['occupancy-time-range-start'].value);
    const endTime = parseFloat(dom['occupancy-time-range-end'].value);
    const fileName = dom['occupancy-schedule-filename'].value || 'occupancy.csv';

    const selectedDays = new Set();
    document.querySelectorAll('.occupancy-day:checked').forEach(checkbox => {
        selectedDays.add(parseInt(checkbox.value, 10)); // 0=Sun, 1=Mon, ..., 6=Sat
    });

    let csvContent = '';
    const baseDate = new Date('2023-01-01T00:00:00Z'); // Non-leap year

    for (let h = 0; h < 8760; h++) {
        const currentDate = new Date(baseDate);
        currentDate.setUTCHours(currentDate.getUTCHours() + h);

        const dayOfWeek = currentDate.getUTCDay();
        const hourOfDay = currentDate.getUTCHours();

        let occupied = 0;
        if (selectedDays.has(dayOfWeek)) {
            if (hourOfDay >= startTime && hourOfDay < endTime) {
                occupied = 1;
            }
        }
        csvContent += `${occupied}\n`;
    }

    project.addSimulationFile('occupancy-schedule', fileName, csvContent);
}

/**
* Updates the text display for the occupancy time range sliders.
* @param {Event} event The input event from the slider.
*/
export function updateOccupancyTimeRangeDisplay(event) {
    if (!dom['occupancy-time-range-display'] || !dom['occupancy-time-slider-container']) return;

    const startSlider = dom['occupancy-time-range-start'];
    const endSlider = dom['occupancy-time-range-end'];
    const container = dom['occupancy-time-slider-container'];

    const startTime = parseFloat(startSlider.value);
    const endTime = parseFloat(endSlider.value);

    // Prevent sliders from crossing
    if (startTime >= endTime) {
        if (event && event.target === startSlider) {
            endSlider.value = startTime;
        } else {
            startSlider.value = endTime;
        }
    }

    // Use the values again after potential correction
    const finalStartTime = parseFloat(startSlider.value);
    const finalEndTime = parseFloat(endSlider.value);

    dom['occupancy-time-range-display'].textContent = `${formatTime(finalStartTime)} - ${formatTime(finalEndTime)}`;

    const min = parseFloat(startSlider.min);
    const max = parseFloat(startSlider.max);
    const range = max - min;

    const startPercent = ((finalStartTime - min) / range) * 100;
    const endPercent = ((finalEndTime - min) / range) * 100;

    container.style.setProperty('--start-percent', `${startPercent}%`);
    container.style.setProperty('--end-percent', `${endPercent}%`);
}

/**
* NEW HELPER: Generic file reader and handler.
* @param {File} file - The file object from the input.
* @param {string} baseId - The stable, base ID for this input.
* @param {HTMLElement} [displayElement] - The optional span to show the filename.
*/
function handleFileSelection(file, baseId, displayElement) {
    if (!file) {
        project.addSimulationFile(baseId, null, null);
        if (displayElement) {
            displayElement.textContent = '';
            displayElement.title = '';
        }
        return;
    }

    if (displayElement) {
        displayElement.textContent = file.name;
        displayElement.title = file.name;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        project.addSimulationFile(baseId, file.name, e.target.result);
        showAlert(`File "${file.name}" loaded into project.`, 'File Loaded');
    };
    reader.onerror = () => {
        console.error("Error reading file:", file.name);
        showAlert(`Failed to read file: ${file.name}.`, 'File Read Error');
        project.addSimulationFile(baseId, null, null);
        if (displayElement) displayElement.textContent = 'Error reading file.';
    };
    reader.readAsText(file);
}

const glareHighlighter = {
    highlightedObject: null,
    originalMaterial: null,
    // A single, reusable material for highlighting glare sources
    highlightMaterial: new THREE.MeshBasicMaterial({
        color: 0xffff00, // Bright yellow
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85,
        depthTest: false // Ensure highlight is visible
    }),

    highlight(object) {
        this.clear(); // Clear previous highlight first

        if (!object || !object.material) return;
        
        // Don't highlight invisible objects or helpers
        if (!object.visible || object.type === 'CameraHelper' || object.type === 'LineSegments') return;

        this.highlightedObject = object;
        this.originalMaterial = object.material;
        object.material = this.highlightMaterial;
    },

    clear() {
        if (this.highlightedObject) {
            // Restore the original material if it exists
            if (this.originalMaterial) {
                this.highlightedObject.material = this.originalMaterial;
            }
            this.highlightedObject = null;
            this.originalMaterial = null;
        }
    },
    
    dispose() {
        this.highlightMaterial.dispose();
    }
};


/**
* This function uses the base ID of the input.
*/
export function setupFileListenersForPanel(panelElement) {
    const templateId = panelElement.dataset.templateId;
    const panelIdSuffix = panelElement.id.replace(`${templateId}-panel-`, '');

    panelElement.querySelectorAll('input[type="file"]').forEach(input => {
        let fileNameDisplay = panelElement.querySelector(`[data-file-display-for="${input.id}"]`);
        if (!fileNameDisplay) {
            fileNameDisplay = document.createElement('span');
            fileNameDisplay.className = 'text-sm text-gray-500 ml-4 truncate max-w-[150px]';
            fileNameDisplay.dataset.fileDisplayFor = input.id;
            input.parentElement.insertBefore(fileNameDisplay, input.nextSibling);
        }

        input.addEventListener('change', (event) => {
            const file = event.target.files[0];
            const baseId = input.id.replace(`-${panelIdSuffix}`, ''); // Get the stable base ID
            handleFileSelection(file, baseId, fileNameDisplay);
        });
    });
}

export function getNewZIndex() {
    maxZ++;
    return maxZ;
}

export function scheduleUpdate(id = null) {
    if (updateScheduled) return;
    updateScheduled = true;
    requestAnimationFrame(() => {
        updateScene(id);
        updateScheduled = false;
    });
}

// --- INITIALIZATION and EVENT LISTENERS ---
const wallDirections = ['n', 's', 'e', 'w'];
let windowModes = {'n': 'wwr', 's': 'wwr', 'e': 'wwr', 'w': 'wwr'};

function setupDOM() {
    // START: Replace the `ids` array in setupDOM() in ui.js
const ids = [
    // Global
    'theme-btn-light', 'theme-btn-dark', 'theme-btn-cyber', 'theme-switcher-container',
    'render-container', 'sidebar-wrapper', 'right-sidebar', 'analysis-sidebar',
    'welcome-screen', 'glow-canvas',
    'toggle-modules-btn', 'toggle-analysis-btn', 'generate-scene-button',
    'save-project-button', 'load-project-button', 'run-simulation-button', 'custom-alert', 
    'custom-alert-title', 'custom-alert-message', 'custom-alert-close',

    // Toolbars
    'left-toolbar', 'toggle-panel-project-btn', 'toggle-panel-dimensions-btn', 
    'toggle-panel-aperture-btn', 'toggle-panel-lighting-btn', 'toggle-panel-materials-btn', 
    'toggle-panel-sensor-btn', 'toggle-panel-viewpoint-btn', 'toggle-panel-view-options-btn',
    'view-controls', 'view-btn-persp', 'view-btn-ortho', 'view-btn-top', 'view-btn-front', 'view-btn-back', 'view-btn-left', 'view-btn-right',

    // Project Panel
    'project-name', 'project-desc', 'building-type',
    'upload-epw-btn', 'epw-file-name', 'epw-upload-modal', 'epw-modal-close', 'modal-file-drop-area', 'epw-file-input',
    'latitude', 'longitude', 'map', 'location-inputs-container', 'radiance-path',

    // Dimensions Panel
    'width', 'width-val', 'length', 'length-val', 'height', 'height-val', 'room-orientation', 'room-orientation-val',
    'surface-thickness', 'surface-thickness-val',

    // Apertures Panel (Frames)
    'frame-toggle', 'frame-controls', 'frame-thick', 'frame-thick-val',
    'frame-depth', 'frame-depth-val',
    

    // Materials Panel
    'wall-mat-type', 'floor-mat-type', 'ceiling-mat-type', 'frame-mat-type', 'shading-mat-type',
    'wall-refl', 'wall-refl-val', 'floor-refl', 'floor-refl-val', 'ceiling-refl', 'ceiling-refl-val', 
    'glazing-trans', 'glazing-trans-val',
    'wall-spec', 'wall-spec-val', 'floor-spec', 'floor-spec-val', 'ceiling-spec', 'ceiling-spec-val',
    'wall-rough', 'wall-rough-val', 'floor-rough', 'floor-rough-val', 'ceiling-rough', 'ceiling-rough-val',
    'frame-refl', 'frame-refl-val', 'frame-spec', 'frame-spec-val', 'frame-rough', 'frame-rough-val',
    'shading-rough-val', 'wall-color', 'floor-color', 'ceiling-color', 'frame-color', 'shading-color',
    'wall-mode-refl', 'wall-mode-srd', 'wall-refl-controls', 'wall-srd-controls', 'wall-srd-file',
    'floor-mode-refl', 'floor-mode-srd', 'floor-refl-controls', 'floor-srd-controls', 'floor-srd-file',
    'ceiling-mode-refl', 'ceiling-mode-srd', 'ceiling-refl-controls', 'ceiling-srd-controls', 'ceiling-srd-file',
    'bsdf-toggle', 'bsdf-controls',

    // Sensor Panel
    'illuminance-grid-color', 'view-grid-color', 'bsdf-file',
    'illuminance-grid-toggle', 'view-grid-toggle', 'illuminance-grid-controls', 
    'view-grid-controls', 'grid-floor-toggle', 'grid-ceiling-toggle', 'grid-north-toggle', 
    'grid-south-toggle', 'grid-east-toggle', 'grid-west-toggle', 'floor-grid-controls', 
    'ceiling-grid-controls', 'wall-grid-controls', 'floor-grid-spacing', 'floor-grid-spacing-val',
    'floor-grid-offset', 'floor-grid-offset-val', 'ceiling-grid-spacing', 'ceiling-grid-spacing-val',
    'ceiling-grid-offset', 'ceiling-grid-offset-val', 'wall-grid-spacing', 'wall-grid-spacing-val',
    'wall-grid-offset', 'wall-grid-offset-val','show-floor-grid-3d-toggle',
    
    // EN 12464-1 Task/Surrounding Grids
    'task-area-toggle', 'task-area-controls',
    'task-area-start-x', 'task-area-start-x-val', 'task-area-start-z', 'task-area-start-z-val',
    'task-area-width', 'task-area-width-val', 'task-area-depth', 'task-area-depth-val',
    'surrounding-area-toggle', 'surrounding-area-controls',
    'surrounding-area-width', 'surrounding-area-width-val',

    'show-view-grid-3d-toggle', 'view-grid-spacing', 'view-grid-spacing-val',
    'view-grid-offset', 'view-grid-offset-val', 'view-grid-directions', 
    'view-grid-start-vec-x', 'view-grid-start-vec-y', 'view-grid-start-vec-z',

    // Viewpoint Panel
    'view-type', 'mode-translate-btn', 'mode-rotate-btn', 'gizmo-toggle', 'fpv-toggle-btn',
    'view-pos-x', 'view-pos-x-val', 'view-pos-y', 'view-pos-y-val', 'view-pos-z', 'view-pos-z-val',
    'view-dir-x', 'view-dir-x-val', 'view-dir-y', 'view-dir-y-val', 'view-dir-z', 'view-dir-z-val',
    'view-fov', 'view-fov-val', 'view-dist', 'view-dist-val',

    // View Options Panel
    'proj-btn-persp', 'proj-btn-ortho',
    'transparent-toggle', 'ground-plane-toggle', 'world-axes-toggle', 'world-axes-size', 'world-axes-size-val',
    'h-section-toggle', 'h-section-controls', 'h-section-dist', 'h-section-dist-val',
    'v-section-toggle', 'v-section-controls', 'v-section-dist', 'v-section-dist-val',

    'occupancy-toggle', 'occupancy-controls', 'occupancy-schedule-filename',
    'occupancy-time-range-display', 'occupancy-time-slider-container',
    'occupancy-time-range-start', 'occupancy-time-range-end', 'generate-occupancy-btn',

    // Lighting Panel
    'panel-lighting', 'lighting-enabled-toggle', 'lighting-controls-wrapper', 'light-source-color', 'light-type-selector', 
    'light-geometry-section', 'light-geometry-selector', 'geometry-params-section', 'light-geometry-selector', 
    'geometry-params-section', 'geo-params-polygon', 'geo-params-sphere', 'geo-sphere-radius', 
    'geo-params-cylinder', 'geo-cylinder-radius', 'geo-cylinder-length', 
    'geo-params-ring', 'geo-ring-radius-in', 'geo-ring-radius-out', 
    'params-light', 'light-rgb-r', 'light-rgb-g', 'light-rgb-b', 
    'params-spotlight', 'spot-rgb-r', 'spot-rgb-g', 'spot-rgb-b', 
    'spot-cone-angle', 'spot-dir-x', 'spot-dir-y', 'spot-dir-z', 'spot-normalize-toggle', 
    'params-glow', 'glow-rgb-r', 'glow-rgb-g', 'glow-rgb-b', 
    'glow-behavior', 'glow-radius-input-container', 'glow-max-radius', 
    'params-illum', 'illum-rgb-r', 'illum-rgb-g', 'illum-rgb-b', 'illum-alt-material', 
    'params-ies', 'ies-file-input', 'ies-units', 'ies-multiplier', 
    'ies-lamp-type', 'ies-force-color-toggle', 'ies-color-override-inputs', 
    'ies-color-r', 'ies-color-g', 'ies-color-b', 'placement-mode-individual', 'placement-mode-grid', 
    'light-pos-x', 'light-pos-y', 'light-pos-z', 'light-rot-x', 'light-rot-y', 'light-rot-z', 
    'grid-layout-inputs', 'grid-rows', 'grid-cols', 'grid-row-spacing', 'grid-col-spacing',

    // Daylighting Controls
    'ies-photometry-viewer', 'ies-polar-plot-canvas', 'ies-info-display',
    'daylighting-enabled-toggle', 'daylighting-controls-wrapper', 'daylighting-control-type',
    'daylighting-setpoint', 'daylight-continuous-params', 'daylighting-min-power-frac',
    'daylighting-min-power-frac-val', 'daylighting-min-light-frac', 'daylighting-min-light-frac-val',
    'daylight-stepped-params', 'daylighting-steps', 'daylighting-availability-schedule',
    'daylight-sensor1-x', 'daylight-sensor1-x-val',
    'daylight-sensor1-y', 'daylight-sensor1-y-val',
    'daylight-sensor1-z', 'daylight-sensor1-z-val',
    'daylight-sensor-gizmo-toggle',
    'daylight-sensor1-dir-x', 'daylight-sensor1-dir-x-val',
    'daylight-sensor1-dir-y', 'daylight-sensor1-dir-y-val',
    'daylight-sensor1-dir-z', 'daylight-sensor1-dir-z-val',
    'daylight-sensor1-percent', 'daylight-sensor1-percent-val',

    // Results Panel
    'results-file-input-a', 'results-file-name-a', 'compare-mode-toggle', 'comparison-file-loader',
    'results-file-input-b', 'results-file-name-b', 'view-mode-selector', 'view-mode-a-btn',
    'view-mode-b-btn', 'view-mode-diff-btn', 'summary-stats-container', 'summary-a', 'summary-b',
    'results-min-val-a', 'results-avg-val-a', 'results-max-val-a', 'results-min-val-b',
    'results-avg-val-b', 'results-max-val-b', 'color-scale-section', 'standard-color-scale',
    'difference-color-scale', 'difference-legend', 'diff-legend-min-label', 'diff-legend-max-label',
    'results-dashboard', 'results-legend', 'legend-min-label', 'legend-max-label',
    'results-scale-min', 'results-scale-min-num',

    // Spectral Metrics Dashboard
    'spectral-metrics-dashboard', 'metric-photopic-val', 'metric-melanopic-val', 'metric-neuropic-val',

    // Info Panel & AI Assistant
    'info-button', 'panel-info',
    'ai-assistant-button', 'panel-ai-assistant', 'ai-chat-messages', 'ai-chat-form', 'ai-chat-input', 'ai-chat-send',
    'ai-settings-btn', 'ai-settings-modal', 'ai-settings-close-btn', 'ai-settings-form', 'ai-provider-select', 'ai-model-select', 'ai-api-key-input', 'openrouter-info-box',


    // Project Access Prompt
    'project-access-prompt', 'select-folder-btn', 'dismiss-prompt-btn',

    // Results Analysis Panel
    'stats-uniformity-val', 'highlight-min-btn', 'highlight-max-btn', 'clear-highlights-btn', 'heatmap-canvas',

    // Annual Time-Series Explorer
    'annual-time-series-explorer', 'time-series-chart', 'time-scrubber', 'time-scrubber-display',

    // HDR Viewer
    'view-hdr-btn', 'hdr-viewer-panel',

    // Glare Analysis
    'glare-analysis-dashboard', 'glare-dgp-val', 'glare-source-count', 
    'glare-source-list', 'clear-glare-highlight-btn',

    // Temporal Map
    'temporal-map-panel', 'temporal-map-point-id', 'temporal-map-canvas',

    // Annual Glare Rose
    'annual-glare-controls', 'glare-rose-btn', 'glare-rose-panel',
    'glare-rose-threshold', 'glare-rose-threshold-val', 'glare-rose-canvas',

    // Combined Analysis
    'combined-analysis-btn', 'combined-analysis-panel', 'combined-glare-threshold',
    'combined-glare-threshold-val', 'combined-analysis-canvas',

    'sensor-context-menu', 'set-viewpoint-here-btn',

    // Simulation Console
    'simulation-console-panel', 'simulation-output', 'simulation-status',

    // Aperture Panel
    'selected-wall-display', 'wall-select-lock-btn', 'lock-icon-unlocked', 'lock-icon-locked',

    // AI Proactive Suggestions
    'proactive-suggestion-container'
];


    ids.forEach(id => { const el = document.getElementById(id); if(el) dom[id] = el; });
    
    // Aperture panel IDs are generated dynamically
    wallDirections.forEach(dir => {
const controlIds = [
            `aperture-controls-${dir}`, `win-count-${dir}`, `win-count-${dir}-val`,
            `mode-wwr-btn-${dir}`, `mode-manual-btn-${dir}`, `wwr-controls-${dir}`, `manual-controls-${dir}`,
            `wwr-${dir}`, `wwr-${dir}-val`, `wwr-sill-height-${dir}`, `wwr-sill-height-${dir}-val`,
            `win-width-${dir}`, `win-width-${dir}-val`, `win-height-${dir}`, `win-height-${dir}-val`, `sill-height-${dir}`, `sill-height-${dir}-val`, `win-depth-pos-${dir}`, `win-depth-pos-${dir}-val`,
            `shading-${dir}-toggle`, `shading-controls-${dir}`, `shading-type-${dir}`, `shading-controls-overhang-${dir}`,
            `shading-controls-lightshelf-${dir}`, `shading-controls-louver-${dir}`, `overhang-dist-above-${dir}`, `overhang-dist-above-${dir}-val`,
            `overhang-tilt-${dir}`, `overhang-tilt-${dir}-val`, `overhang-depth-${dir}`, `overhang-depth-${dir}-val`, `overhang-thick-${dir}`, `overhang-thick-${dir}-val`, `overhang-extension-${dir}`, `overhang-extension-${dir}-val`,
            `lightshelf-placement-ext-${dir}`, `lightshelf-placement-int-${dir}`, `lightshelf-placement-both-${dir}`, `lightshelf-controls-ext-${dir}`,
            `lightshelf-controls-int-${dir}`, `lightshelf-dist-below-ext-${dir}`, `lightshelf-dist-below-ext-${dir}-val`, `lightshelf-tilt-ext-${dir}`,
            `lightshelf-tilt-ext-${dir}-val`, `lightshelf-depth-ext-${dir}`, `lightshelf-depth-ext-${dir}-val`, `lightshelf-thick-ext-${dir}`, `lightshelf-thick-ext-${dir}-val`, `lightshelf-dist-below-int-${dir}`,
            `lightshelf-dist-below-int-${dir}-val`, `lightshelf-tilt-int-${dir}`, `lightshelf-tilt-int-${dir}-val`, `lightshelf-depth-int-${dir}`, `lightshelf-depth-int-${dir}-val`, `lightshelf-thick-int-${dir}`, `lightshelf-thick-int-${dir}-val`,
            `louver-placement-ext-${dir}`, `louver-placement-int-${dir}`, `louver-slat-orientation-${dir}`, `louver-slat-width-${dir}`, `louver-slat-width-${dir}-val`,
            `louver-slat-sep-${dir}`, `louver-slat-sep-${dir}-val`, `louver-slat-thick-${dir}`, `louver-slat-thick-${dir}-val`, `louver-slat-angle-${dir}`,
            `louver-slat-angle-${dir}-val`, `louver-dist-to-glass-${dir}`, `louver-dist-to-glass-${dir}-val`,
            `shading-controls-roller-${dir}`,
            `roller-top-opening-${dir}`, `roller-top-opening-${dir}-val`,
            `roller-bottom-opening-${dir}`, `roller-bottom-opening-${dir}-val`,
            `roller-left-opening-${dir}`, `roller-left-opening-${dir}-val`,
            `roller-right-opening-${dir}`, `roller-right-opening-${dir}-val`,
            `roller-dist-to-glass-${dir}`, `roller-dist-to-glass-${dir}-val`,
            `roller-solar-trans-${dir}`, `roller-solar-trans-${dir}-val`,
            `roller-solar-refl-${dir}`, `roller-solar-refl-${dir}-val`,
            `roller-vis-trans-${dir}`, `roller-vis-trans-${dir}-val`,
            `roller-vis-refl-${dir}`, `roller-vis-refl-${dir}-val`,
            `roller-ir-emis-${dir}`, `roller-ir-emis-${dir}-val`,
            `roller-ir-trans-${dir}`, `roller-ir-trans-${dir}-val`,
            `roller-thickness-${dir}`, `roller-thickness-${dir}-val`,
            `roller-conductivity-${dir}`, `roller-conductivity-${dir}-val`,
        ];
        controlIds.forEach(id => { const el = document.getElementById(id); if (el) dom[id] = el; });
    });
}

/**
* Sets up a MutationObserver to automatically initialize controls
* for any floating window that is dynamically added to the DOM,
* such as simulation recipe panels.
*/
function observeAndInitDynamicPanels() {
    const container = document.getElementById('window-container');
    if (!container) {
        console.error("Window container not found for MutationObserver.");
        return;
    }

    const observer = new MutationObserver((mutationsList) => {
        for (const mutation of mutationsList) {
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach(node => {
                    // Check if the added node is an element and has the floating-window class
                    if (node.nodeType === 1 && node.classList.contains('floating-window')) {
                        initializePanelControls(node);
                    }
                });
            }
        }
    });

    observer.observe(container, { childList: true });
}

/**
* Clears any highlights on the sensor grid by reapplying the correct data-driven colors.
*/
export function clearSensorHighlights() {
    if (resultsManager.resultsData.length > 0) {
        // Find the most recent data set to re-apply. For annual results, this is the hourly data.
        const currentHour = dom['time-scrubber'] ? parseInt(dom['time-scrubber'].value, 10) : -1;
        let dataToDisplay = resultsManager.resultsData; // Default to average or point-in-time

        if (resultsManager.annualResultsData.length > 0 && currentHour >= 0) {
            dataToDisplay = resultsManager.getIlluminanceForHour(currentHour);
        }

        if(dataToDisplay) {
            updateSensorGridColors(dataToDisplay);
        }
    }
}

/**
* Highlights sensor points that correspond to the min or max value.
* @param {'min' | 'max'} type - The type of value to highlight.
*/
export function highlightSensorPoint(type) {
    if (resultsManager.resultsData.length === 0) {
        showAlert('No results data available to highlight.', 'Info');
        return;
    }

    const sensorGroup = scene.getObjectByName('sensorPoints');
    if (!sensorGroup || !sensorGroup.children || sensorGroup.children.length === 0) {
        console.warn('Sensor point group not found in the scene.');
        showAlert('Could not find sensor points in the 3D view.', 'Error');
        return;
    }

    // First, clear any existing highlights to ensure a clean state
    clearSensorHighlights();

    const targetValue = (type === 'min') ? resultsManager.stats.min : resultsManager.stats.max;

    // Find ALL indices that match the target value, in case of duplicates
    const indices = [];
    resultsManager.resultsData.forEach((value, index) => {
        if (value === targetValue) {
            indices.push(index);
        }
    });

    if (indices.length === 0) {
        console.warn(`Could not find index for ${type} value: ${targetValue}`);
        return;
    }

    const highlightColor = (type === 'min') ? 0x0000ff : 0xff0000; // Blue for min, Red for max

    indices.forEach(index => {
        if (index < sensorGroup.children.length) {
            const point = sensorGroup.children[index];
            // Clone material to not affect other points, then set color
            point.material = point.material.clone();
            point.material.color.setHex(highlightColor);
        }
    });
}

/**
* Adds a specific handler for the static BSDF file input.
*/
// This helper function updates the lock icon's appearance based on the state
function updateLockIcon() {
    const lockBtn = dom['wall-select-lock-btn'];
    if (!lockBtn) return;

    dom['lock-icon-unlocked']?.classList.toggle('hidden', isWallSelectionLocked);
    dom['lock-icon-locked']?.classList.toggle('hidden', !isWallSelectionLocked);
    lockBtn.classList.toggle('locked', isWallSelectionLocked);
}

/**
* Updates the Field of View (FOV) controls based on the selected camera view type.
* Hides FOV for parallel view, locks it for fisheye, and enables it otherwise.
* @param {string} viewType - The selected view type ('v', 'h', 'c', 'l', 'a').
*/
function updateFovControlsForViewType(viewType) {
    const fovSlider = dom['view-fov'];
    // Find the parent container of the FOV slider to hide it entirely for parallel view
    const fovContainer = fovSlider?.closest('.border-t.pt-4.space-y-4');

    if (!fovSlider || !fovContainer) return;

    const isFisheye = viewType === 'h' || viewType === 'a';
    const isParallel = viewType === 'l';

    // Hide the entire FOV control section for Parallel view, where it's not applicable.
    fovContainer.classList.toggle('hidden', isParallel);

    if (isFisheye) {
    // Lock FOV to 180 for Fisheye views
    if (fovSlider.value !== '180') {
    fovSlider.dataset.lastFov = fovSlider.value;
    }
    fovSlider.value = 180;
    fovSlider.disabled = true;
    } else if (!isParallel) {
    // For other views (Perspective, Cylindrical), ensure slider is enabled and restore previous value
    fovSlider.disabled = false;
    fovSlider.value = fovSlider.dataset.lastFov || 60;
    }

    // Only update the label and dispatch the event if the control is visible
    if (!isParallel) {
    updateValueLabel(dom['view-fov-val'], fovSlider.value, '°', 'view-fov');
    fovSlider.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Update the 3D scene's camera and effects
    updateLiveViewType(viewType);
}

export async function setupEventListeners() {
    setupDOM();

    // Add the event listener for the lock button
    dom['wall-select-lock-btn']?.addEventListener('click', () => {
        isWallSelectionLocked = !isWallSelectionLocked;
        updateLockIcon();
    });

    // The import from annualDashboard is updated to include the new functions
    const { openGlareRoseDiagram, updateGlareRoseDiagram } = await import('./annualDashboard.js');
    initHdrViewer(); // Initialize the HDR viewer
    observeAndInitDynamicPanels();

    Object.keys(dom).forEach(id => {
        const el = dom[id];
        if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT')) {
            // Exclude project info, file inputs, buttons, and sun path controls which are handled separately
           if (id.startsWith('project-') || id.includes('latitude') || id.includes('longitude') || id.includes('-btn') || el.type === 'file' || id.startsWith('solar-')) return;

            el.addEventListener('input', handleInputChange);
        }
    });

    if (dom['bsdf-file']) {
        dom['bsdf-file'].addEventListener('change', (event) => {
          handleFileSelection(event.target.files[0], 'bsdf-file');
      });
  }

    dom['view-type']?.addEventListener('change', (e) => updateFovControlsForViewType(e.target.value));
    dom['save-project-button']?.addEventListener('click', () => project.downloadProjectFile());
    dom['load-project-button']?.addEventListener('click', () => project.loadProject());
    dom['upload-epw-btn']?.addEventListener('click', () => {
        dom['epw-upload-modal'].style.zIndex = getNewZIndex();
        dom['epw-upload-modal'].classList.replace('hidden', 'flex');

    });

    dom['epw-modal-close']?.addEventListener('click', () => dom['epw-upload-modal'].classList.replace('flex', 'hidden'));

    setupPanelToggleButtons();
    dom['mode-translate-btn']?.addEventListener('click', () => setGizmoMode('translate'));
    dom['mode-rotate-btn']?.addEventListener('click', () => setGizmoMode('rotate'));
    dom['view-btn-persp']?.addEventListener('click', () => setCameraView('persp'));
    dom['view-btn-ortho']?.addEventListener('click', () => setCameraView('ortho'));
    dom['view-btn-top']?.addEventListener('click', () => setCameraView('top'));
    dom['view-btn-front']?.addEventListener('click', () => setCameraView('front'));
    dom['view-btn-back']?.addEventListener('click', () => setCameraView('back'));
    dom['view-btn-left']?.addEventListener('click', () => setCameraView('left'));
    dom['view-btn-right']?.addEventListener('click', () => setCameraView('right'));
    dom['frame-toggle']?.addEventListener('change', () => { dom['frame-controls']?.classList.toggle('hidden', !dom['frame-toggle'].checked); scheduleUpdate(); });
    dom['bsdf-toggle']?.addEventListener('change', () => { dom['bsdf-controls']?.classList.toggle('hidden', !dom['bsdf-toggle'].checked); });
    dom['gizmo-toggle']?.addEventListener('change', updateGizmoVisibility);
    dom['illuminance-grid-toggle']?.addEventListener('change', (e) => { dom['illuminance-grid-controls'].classList.toggle('hidden', !e.target.checked); scheduleUpdate(); });
    dom['view-grid-toggle']?.addEventListener('change', async (e) => {
        dom['view-grid-controls'].classList.toggle('hidden', !e.target.checked);
        scheduleUpdate();
        if (e.target.checked) {
            const { triggerProactiveSuggestion } = await import('./ai-assistant.js');
            triggerProactiveSuggestion('view_grid_enabled');
        }
    });
    dom['grid-floor-toggle']?.addEventListener('change', updateGridControls);
    dom['grid-ceiling-toggle']?.addEventListener('change', updateGridControls);
    dom['grid-north-toggle']?.addEventListener('change', updateGridControls);
    dom['grid-south-toggle']?.addEventListener('change', updateGridControls);
    dom['grid-east-toggle']?.addEventListener('change', updateGridControls);
    dom['grid-west-toggle']?.addEventListener('change', updateGridControls);
    
    // Listeners for EN 12464-1 grid controls
    dom['task-area-toggle']?.addEventListener('change', (e) => { dom['task-area-controls']?.classList.toggle('hidden', !e.target.checked); scheduleUpdate(); });
    dom['surrounding-area-toggle']?.addEventListener('change', (e) => { dom['surrounding-area-controls']?.classList.toggle('hidden', !e.target.checked); scheduleUpdate(); });
    
    dom['proj-btn-persp']?.addEventListener('click', () => setProjectionMode('perspective'));
    dom['proj-btn-ortho']?.addEventListener('click', () => setProjectionMode('orthographic'));

    dom['h-section-toggle']?.addEventListener('change', () => {
        dom['h-section-controls']?.classList.toggle('hidden', !dom['h-section-toggle'].checked);
        _updateLivePreviewVisibility();
        scheduleUpdate();
    });
    dom['v-section-toggle']?.addEventListener('change', () => {
        dom['v-section-controls']?.classList.toggle('hidden', !dom['v-section-toggle'].checked);
        _updateLivePreviewVisibility();
        scheduleUpdate();
    });

    // Date picker for the Live Section Preview
    flatpickr("#preview-date", {
        dateFormat: "M j",
        defaultDate: "Jun 21",
    });

    // Date picker for the EN 17037 Sunlight Exposure check
    flatpickr("#en17037-sunlight-date", {
        dateFormat: "M j",
        defaultDate: "Mar 21",
        minDate: "Feb 1",
        maxDate: "Mar 21"
    });

    dom['render-section-preview-btn']?.addEventListener('click', handleRenderPreview);

    dom['transparent-toggle']?.addEventListener('change', scheduleUpdate);
    dom['ground-plane-toggle']?.addEventListener('change', scheduleUpdate);
    dom['world-axes-toggle']?.addEventListener('change', scheduleUpdate);
    dom['fpv-toggle-btn']?.addEventListener('click', () => {
    const viewType = dom['view-type'].value;
    const fpvActive = sceneToggleFPV(viewType); // sceneToggleFPV now returns the state

    // Handle UI changes here, separated from scene logic
    const btnText = dom['fpv-toggle-btn']?.querySelector('span');
    if (btnText) {
        btnText.textContent = fpvActive ? 'Exit Viewpoint' : 'Enter Viewpoint';
    }
    if (fpvActive) {
        dom['fpv-toggle-btn']?.classList.replace('btn-primary', 'btn-secondary');
    } else {
        dom['fpv-toggle-btn']?.classList.replace('btn-secondary', 'btn-primary');
    }
});
    dom['custom-alert-close']?.addEventListener('click', hideAlert);

    // --- 3D Scene Interaction ---
    renderer.domElement.addEventListener('click', onSensorClick, false);
    renderer.domElement.addEventListener('contextmenu', onSensorRightClick, false);
    window.addEventListener('click', () => dom['sensor-context-menu']?.classList.add('hidden'));
    dom['set-viewpoint-here-btn']?.addEventListener('click', onSetViewpointHere);

    // --- Annual Glare Listeners ---
    dom['glare-rose-btn']?.addEventListener('click', () => {
        openGlareRoseDiagram();
    });
    dom['glare-rose-threshold']?.addEventListener('input', (e) => {
        if (dom['glare-rose-threshold-val']) {
            dom['glare-rose-threshold-val'].textContent = parseFloat(e.target.value).toFixed(2);
        }
        // Live update the chart if the panel is visible
        if (dom['glare-rose-panel'] && !dom['glare-rose-panel'].classList.contains('hidden')) {
            updateGlareRoseDiagram();
        }
    });

    // --- Combined Analysis Listeners ---
    dom['combined-analysis-btn']?.addEventListener('click', () => {
        openCombinedAnalysisPanel();
    });
    dom['combined-glare-threshold']?.addEventListener('input', (e) => {
        if (dom['combined-glare-threshold-val']) {
            dom['combined-glare-threshold-val'].textContent = parseFloat(e.target.value).toFixed(2);
        }
        if (dom['combined-analysis-panel'] && !dom['combined-analysis-panel'].classList.contains('hidden')) {
            updateCombinedAnalysisChart();
        }
    });

    // --- Results Panel Listeners ---
    dom['results-file-input-a']?.addEventListener('change', (e) => handleResultsFile(e.target.files[0], 'a'));
    dom['results-file-input-b']?.addEventListener('change', (e) => handleResultsFile(e.target.files[0], 'b'));
    dom['compare-mode-toggle']?.addEventListener('change', (e) => toggleComparisonMode(e.target.checked));

    // View mode buttons
    dom['view-mode-a-btn']?.addEventListener('click', () => setViewMode('a'));
    dom['view-mode-b-btn']?.addEventListener('click', () => setViewMode('b'));
    dom['view-mode-diff-btn']?.addEventListener('click', () => setViewMode('diff'));


    // --- HDR Viewer Button Listener ---
    dom['view-hdr-btn']?.addEventListener('click', () => {
        if (resultsManager.hdrResult) {
            // Also pass any available glare data from the active dataset
            const glareResult = resultsManager.getActiveGlareResult();
            openHdrViewer(resultsManager.hdrResult.texture, glareResult);
        }
});

const updateColorScaleAndViz = () => {
    if (!dom['results-scale-min'] || !dom['results-scale-max'] || !dom['results-palette']) return;
        const min = parseFloat(dom['results-scale-min'].value);
        const max = parseFloat(dom['results-scale-max'].value);
        const palette = dom['results-palette'].value;

        dom['results-scale-min-num'].value = min;
        dom['results-scale-max-num'].value = max;

        resultsManager.updateColorScale(min, max, palette);
        updateResultsLegend();
}

// Add listeners for the material reflectance mode buttons
    const materialTypes = ['wall', 'floor', 'ceiling']; // Expand this array to add spectral controls to other materials
        materialTypes.forEach(type => {
            const reflBtn = dom[`${type}-mode-refl`];
            const srdBtn = dom[`${type}-mode-srd`];
            const reflControls = dom[`${type}-refl-controls`];
            const srdControls = dom[`${type}-srd-controls`];
            const srdFileInput = dom[`${type}-srd-file`];

        reflBtn?.addEventListener('click', () => {
            reflBtn.classList.add('active');
            srdBtn.classList.remove('active');
            reflControls.classList.remove('hidden');
            srdControls.classList.add('hidden');
        });

        srdBtn?.addEventListener('click', () => {
            srdBtn.classList.add('active');
            reflBtn.classList.remove('active');
            srdControls.classList.remove('hidden');
            reflControls.classList.add('hidden');
        });

        srdFileInput?.addEventListener('change', (event) => {
            const baseId = `${type}-srd-file`; 
            handleFileSelection(event.target.files[0], baseId);
        });
    });

    setupAperturePanel();
    setupProjectPanel();
    window.addEventListener('resize', onWindowResize);
    renderer.domElement.addEventListener('click', onWallClick, false);

    if(dom['view-type']) updateLiveViewType(dom['view-type'].value);

    // Initial UI updates
    updateGridControls();
    updateOccupancyTimeRangeDisplay();

    // --- Occupancy Schedule Listeners ---
    dom['occupancy-toggle']?.addEventListener('change', (e) => {
        dom['occupancy-controls'].classList.toggle('hidden', !e.target.checked);
        if (!e.target.checked) {
            // When disabling, clear any previously generated schedule from the project
            project.addSimulationFile('occupancy-schedule', null, null);
        }
    });

    // The sliders should only update the UI display, not generate the file
    const occupancyRangeSliders = [dom['occupancy-time-range-start'], dom['occupancy-time-range-end']];
    occupancyRangeSliders.forEach(el => el?.addEventListener('input', (e) => updateOccupancyTimeRangeDisplay(e)));

    // The new button is now responsible for generation
    dom['generate-occupancy-btn']?.addEventListener('click', () => {
        generateAndStoreOccupancyCsv();
        showAlert('Occupancy schedule generated and saved to project.', 'Schedule Saved');
    });

    // --- Results Dashboard Button Listener ---
    dom['results-dashboard-btn']?.addEventListener('click', () => {
        const resultsPanel = dom['results-analysis-panel'];
        if (resultsPanel) {
            const isHidden = resultsPanel.classList.contains('hidden');
            if (isHidden) {
                if (resultsManager.resultsData.length > 0) {
                    resultsPanel.classList.remove('hidden');
                    updateResultsAnalysisPanel();
                    makeDraggable(resultsPanel, resultsPanel.querySelector('.window-header'));
                    makeResizable(resultsPanel, resultsPanel.querySelector('.resize-handle'));
                    ensureWindowInView(resultsPanel);
                } else {
                    showAlert('Please load a results file first.', 'No Data');
                }
            } else {
                resultsPanel.classList.add('hidden');
            }
        }
    });

    function updateResultsAnalysisPanel() {
        const stats = resultsManager.stats;
        dom['stats-min-val'].textContent = stats.min.toFixed(1);
        dom['stats-max-val'].textContent = stats.max.toFixed(1);
        dom['stats-avg-val'].textContent = stats.avg.toFixed(1);
        const uniformity = stats.min > 0 ? (stats.min / stats.avg).toFixed(2) : 'N/A';
        dom['stats-uniformity-val'].textContent = uniformity;

        const histogramCtx = dom['illuminance-histogram']?.getContext('2d');
        if (histogramCtx) {
            if (window.illuminanceHistogram) {
                window.illuminanceHistogram.destroy();
            }
            window.illuminanceHistogram = new Chart(histogramCtx, {
                type: 'bar',
                data: resultsManager.getHistogramData(),
                options: {
                    plugins: { legend: { display: false } },
                    scales: {
                        y: { beginAtZero: true, title: { display: true, text: 'Count' } },
                        x: { title: { display: true, text: 'Illuminance (lux)' } }
                    }
                }
            });
        }
        updateInteractiveLegend();
        render2DHeatmap();
    }

    function updateInteractiveLegend() {
        const canvas = dom['interactive-legend'];
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        const gradient = ctx.createLinearGradient(0, 0, width, 0);
        const palette = palettes[resultsManager.colorScale.palette] || palettes.viridis;
        palette.forEach((color, i) => {
            gradient.addColorStop(i / (palette.length - 1), color);
        });
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);

        dom['legend-min-val'].textContent = Math.round(resultsManager.colorScale.min);
        dom['legend-max-val'].textContent = Math.round(resultsManager.colorScale.max);
}

/**
* Renders a top-down 2D heatmap of the floor sensor grid.
*/
function render2DHeatmap() {
    const canvas = dom['heatmap-canvas'];
    const sensorGroup = scene.getObjectByName('sensorPoints');
    if (!canvas || !sensorGroup || resultsManager.resultsData.length === 0) {
        return;
    }

    const ctx = canvas.getContext('2d');
    const roomWidth = parseFloat(dom.width.value);
    const roomLength = parseFloat(dom.length.value);

    // Match canvas resolution to its display size for sharpness
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Find the bounding box of the floor points to calculate scaling
    const floorPoints = [];
    let dataIndex = 0;
    sensorGroup.children.forEach(mesh => {
        const tempMatrix = new THREE.Matrix4();
        for (let i = 0; i < mesh.count; i++) {
            mesh.getMatrixAt(i, tempMatrix);
            const pos = new THREE.Vector3().setFromMatrixPosition(tempMatrix);

            // We only want points near the floor (y ≈ 0 in room container space)
            // Use a small tolerance for floating point inaccuracies
            if (Math.abs(pos.y - parseFloat(dom['floor-grid-offset'].value)) < 0.01) {
                 floorPoints.push({
                    x: pos.x,
                    z: pos.z,
                    value: resultsManager.resultsData[dataIndex]
                });
            }
            dataIndex++;
        }
    });

    if (floorPoints.length === 0) return; // No floor points to draw

    const padding = 20; // Padding in pixels
    const canvasW = canvas.width - padding * 2;
    const canvasH = canvas.height - padding * 2;

    const scaleX = canvasW / roomWidth;
    const scaleY = canvasH / roomLength;
    const scale = Math.min(scaleX, scaleY);

    const offsetX = (canvas.width - roomWidth * scale) / 2;
    const offsetY = (canvas.height - roomLength * scale) / 2;

    const pointSize = parseFloat(dom['floor-grid-spacing'].value) * scale;

    floorPoints.forEach(point => {
        const canvasX = offsetX + point.x * scale;
        // Invert Z-axis because canvas Y is down, but room Z is forward
        const canvasY = offsetY + (roomLength - point.z) * scale;

        ctx.fillStyle = resultsManager.getColorForValue(point.value);
        // Draw a rectangle centered on the point's location
        ctx.fillRect(canvasX - pointSize / 2, canvasY - pointSize / 2, pointSize, pointSize);
    });
}

    // Link interactive legend sliders// Link interactive legend sliders
    const scaleMinSlider = dom['scale-min-input'];
    const scaleMaxSlider = dom['scale-max-input'];
    const scaleMinNum = dom['scale-min-input-num'];
    const scaleMaxNum = dom['scale-max-input-num'];

    function syncAndUpdateColorScale() {
        const min = parseFloat(scaleMinSlider.value);
        const max = parseFloat(scaleMaxSlider.value);
        resultsManager.updateColorScale(min, max, dom['results-palette'].value);
        updateSensorGridColors(resultsManager.resultsData);
        updateInteractiveLegend();
    }

    scaleMinSlider?.addEventListener('input', (e) => {
        scaleMinNum.value = e.target.value;
        syncAndUpdateColorScale();
    });
    scaleMaxSlider?.addEventListener('input', (e) => {
        scaleMaxNum.value = e.target.value;
        syncAndUpdateColorScale();
    });
    scaleMinNum?.addEventListener('change', (e) => {
        scaleMinSlider.value = e.target.value;
        syncAndUpdateColorScale();
    });
    scaleMaxNum?.addEventListener('change', (e) => {
        scaleMaxSlider.value = e.target.value;
    syncAndUpdateColorScale();
    });

    // --- Analysis Tools Listeners ---
    dom['highlight-min-btn']?.addEventListener('click', () => highlightSensorPoint('min'));
    dom['highlight-max-btn']?.addEventListener('click', () => highlightSensorPoint('max'));
    dom['clear-highlights-btn']?.addEventListener('click', clearSensorHighlights);

    // --- Time Scrubber Listener for Annual Results ---
    dom['time-scrubber']?.addEventListener('input', (e) => {
        const hour = parseInt(e.target.value, 10);
        updateTimeScrubberDisplay(hour);

    // --- Daylighting Sensor Gizmo Listener ---
    // The event handler now just triggers a scene update. The logic is consolidated in geometry.js.
    dom['daylight-sensor-gizmo-toggle']?.addEventListener('change', () => scheduleUpdate());

    promptForProjectDirectory();

    // --- Electron-Specific Listeners ---

    // Listen for the 'run-simulation-button' which is dynamically created
    document.body.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-action="run"]');
        if (button && project.dirHandle) {
            const panel = button.closest('.floating-window');
            const scriptName = panel.dataset.scriptName;
            if (!scriptName) {
                showAlert('Could not find the script name for this simulation.', 'Error');
                return;
            }

            // Show the console
            const consolePanel = dom['simulation-console-panel'];
            if (consolePanel) {
                consolePanel.classList.remove('hidden');
                consolePanel.style.zIndex = getNewZIndex();
                dom['simulation-output'].textContent = `Running ${scriptName} in ${project.dirHandle.name}... \n\n`;
                dom['simulation-status'].textContent = 'Status: Running...';
                dom['simulation-status'].classList.add('text-yellow-500');
                dom['simulation-status'].classList.remove('text-green-500', 'text-red-500');
            }

            // Use the Electron API to run the script
            window.electronAPI.runScript({ projectPath: project.dirHandle.name, scriptName });
        } else if (button && !project.dirHandle) {
            showAlert('Please select a project directory before running a simulation.', 'Error');
        }
    });

    // Listen for output from the running script
    if (window.electronAPI?.onScriptOutput) {
        window.electronAPI.onScriptOutput((data) => {
            if (dom['simulation-output']) {
                dom['simulation-output'].textContent += data;
                dom['simulation-output'].scrollTop = dom['simulation-output'].scrollHeight; // Auto-scroll
            }
        });
    }

    // Listen for when the script finishes
    if (window.electronAPI?.onScriptExit) {
        window.electronAPI.onScriptExit((code) => {
            if (dom['simulation-status']) {
                dom['simulation-output'].textContent += `\n--- Process finished with exit code ${code} ---`;
                dom['simulation-output'].scrollTop = dom['simulation-output'].scrollHeight;

                if (code === 0) {
                    dom['simulation-status'].textContent = 'Status: Success';
                    dom['simulation-status'].classList.add('text-green-500');
                    dom['simulation-status'].classList.remove('text-yellow-500', 'text-red-500');
                } else {
                    dom['simulation-status'].textContent = `Status: Failed (code ${code})`;
                    dom['simulation-status'].classList.add('text-red-500');
                    dom['simulation-status'].classList.remove('text-yellow-500', 'text-green-500');
                }
            }
        });
    }

    const hourlyData = resultsManager.getIlluminanceForHour(hour);
    if (hourlyData) {
        updateSensorGridColors(hourlyData);
    }
});
}

// --- UI LOGIC & EVENT HANDLERS ---
/**
* Toggles the visibility of an individual floating panel, allowing multiple
* panels to be open at once with a clear visual offset.
* @param {string} panelId The ID of the panel to toggle.
 * @param {string} btnId The ID of the button that controls the panel.
 */
export function togglePanelVisibility(panelId, btnId) {
    const panel = document.getElementById(panelId);
    const btn = document.getElementById(btnId);
    if (!panel || !btn) return;

    const isHidden = panel.classList.contains('hidden');

    if (isHidden) {
        // --- SHOW PANEL ---
        panel.classList.remove('hidden');
        panel.classList.remove('collapsed'); // Ensure panel is expanded when shown
        btn.classList.add('active');

        // Bring the panel to the front
        panel.style.zIndex = getNewZIndex();

        // Set initial position only once. A larger offset makes new windows feel more separate.
        if (!panel.dataset.positioned) {
            // Count how many panels are already open to calculate the new position
            const panelCount = document.querySelectorAll('#window-container > .floating-window:not(.hidden)').length;
            
            // Use panelCount - 1 because the current panel is already visible at this point.
            // A 40px offset provides a clear diagonal stagger for new panels.
            const offset = ((panelCount - 1) % 8) * 40;
            const xPos = 80 + offset;
            const yPos = 60 + offset;
            panel.style.transform = `translate3d(${xPos}px, ${yPos}px, 0)`;
            panel.dataset.positioned = 'true';
        }

        // Make sure the panel is within the viewport
        ensureWindowInView(panel);

        // Special case for the map in the project panel
        if (panelId === 'panel-project' && map) {
            setTimeout(() => map.invalidateSize(), 10);
        }
    } else {
        // --- HIDE PANEL ---
        panel.classList.add('hidden');
        btn.classList.remove('active');
    }
}

/**
* Sets up the click listeners for the new left toolbar buttons.
*/
function setupPanelToggleButtons() {
    const panelMap = {
        'toggle-panel-project-btn': 'panel-project',
        'toggle-panel-dimensions-btn': 'panel-dimensions',
        'toggle-panel-aperture-btn': 'panel-aperture',
        'toggle-panel-lighting-btn': 'panel-lighting',
        'toggle-panel-materials-btn': 'panel-materials',
        'toggle-panel-sensor-btn': 'panel-sensor',
        'toggle-panel-sensor-btn': 'panel-sensor',
        'toggle-panel-viewpoint-btn': 'panel-viewpoint',
        'toggle-panel-view-options-btn': 'panel-view-options',
        'info-button': 'panel-info',
        'ai-assistant-button': 'panel-ai-assistant' // Add the new mapping
        };

        for (const [btnId, panelId] of Object.entries(panelMap)) {
            const button = dom[btnId];
        if (button) {
             button.addEventListener('click', () => togglePanelVisibility(panelId, btnId));
        } else {
            console.warn(`Button with ID '${btnId}' not found in the DOM.`);
        }
    }
}

function setupAperturePanel() {
    wallDirections.forEach(dir => {
        const apertureControls = dom[`aperture-controls-${dir}`];
        const shadingToggle = dom[`shading-${dir}-toggle`];
        const shadingControls = dom[`shading-controls-${dir}`];

        // This listener toggles the shading-specific controls within a wall's section
        shadingToggle?.addEventListener('change', () => {
            shadingControls?.classList.toggle('hidden', !shadingToggle.checked);
            scheduleUpdate(`shading-${dir}-toggle`);
        });

        // Add listeners for the buttons and dropdowns that have unique logic
        dom[`mode-wwr-btn-${dir}`]?.addEventListener('click', () => setWindowMode(dir, 'wwr'));
        dom[`mode-manual-btn-${dir}`]?.addEventListener('click', () => setWindowMode(dir, 'manual'));
        dom[`shading-type-${dir}`]?.addEventListener('change', () => handleShadingTypeChange(dir));
        
        // Set the initial state for button groups and device-specific controls
        setupShadingPanelButtonGroups(dir);
        handleShadingTypeChange(dir, false); // `false` prevents an unnecessary scene update on load
    });
}

export function ensureWindowInView(win) {
    requestAnimationFrame(() => {
        const rect = win.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        let transformXAdjustment = 0;
        let transformYAdjustment = 0;

        // Check vertical position
        if (rect.bottom > viewportHeight) {
            transformYAdjustment = -(rect.bottom - viewportHeight + 20);
        } else if (rect.top < 0) {
            transformYAdjustment = -rect.top + 20;
        }

        // Check horizontal position
        if (rect.right > viewportWidth) {
            transformXAdjustment = -(rect.right - viewportWidth + 20);
        } else if (rect.left < 0) {
            transformXAdjustment = -rect.left + 20;
        }

        if (transformXAdjustment !== 0 || transformYAdjustment !== 0) {
            const currentTransform = getComputedStyle(win).transform;
            const matrix = currentTransform !== 'none' ? new DOMMatrix(currentTransform) : new DOMMatrix();
            const newX = matrix.m41 + transformXAdjustment;
            const newY = matrix.m42 + transformYAdjustment;
            win.style.transform = `translate3d(${newX}px, ${newY}px, 0)`;
        }
    });
}

/**
* Attaches all necessary event listeners (drag, resize, close, max, min) to a single panel.
* @param {HTMLElement} win The panel element to initialize.
*/
export function initializePanelControls(win) {
    if (win.dataset.controlsInitialized) return; // Prevent re-initialization

    const header = win.querySelector('.window-header');
    const collapseIcon = win.querySelector('.collapse-icon');
    const resizeHandles = win.querySelectorAll('.resize-handle-edge, .resize-handle-corner');
    const closeIcon = win.querySelector('.window-icon-close');
    const maxIcon = win.querySelector('.window-icon-max');

    // Bring to front on click
    win.addEventListener('mousedown', () => { maxZ++; win.style.zIndex = maxZ; }, true);

    // Collapse/Expand button
    if (collapseIcon) {
        collapseIcon.addEventListener('click', (e) => {
            e.stopPropagation();
            const isExpanding = win.classList.contains('collapsed');
            win.classList.toggle('collapsed');
            if (isExpanding) ensureWindowInView(win);
            if (win.id === 'panel-project' && !win.classList.contains('collapsed') && map) {
                setTimeout(() => map.invalidateSize(), 10);
            }
        });
    }

    // Close button
    if (closeIcon) {
        closeIcon.addEventListener('click', (e) => {
            e.stopPropagation();
            // Dynamically created panels (from templates) are removed entirely
            if (win.dataset.templateId) {
                win.remove();
            } 
            // Static, built-in panels are hidden and their toolbar button is deactivated
            else {
                win.classList.add('hidden');
                const panelMap = {
                    'panel-project': 'toggle-panel-project-btn',
                    'panel-dimensions': 'toggle-panel-dimensions-btn',
                    'panel-aperture': 'toggle-panel-aperture-btn',
                    'panel-lighting': 'toggle-panel-lighting-btn',
                    'panel-materials': 'toggle-panel-materials-btn',
                    'panel-sensor': 'toggle-panel-sensor-btn',
                    'panel-viewpoint': 'toggle-panel-viewpoint-btn',
                    'panel-view-options': 'toggle-panel-view-options-btn'
                };
                const btnId = panelMap[win.id];
                if (btnId && dom[btnId]) {
                    dom[btnId].classList.remove('active');
                }
            }
        });
    }

    // Maximize button
    if (maxIcon) {
        maxIcon.addEventListener('click', (e) => {
            e.stopPropagation();
            const isMaximized = win.classList.contains('maximized');
            if (isMaximized) {
                win.classList.remove('maximized');
                win.style.width = win.dataset.oldWidth || '';
                win.style.height = win.dataset.oldHeight || '';
                win.style.transform = win.dataset.oldTransform || '';
            } else {
                win.dataset.oldWidth = win.style.width;
                win.dataset.oldHeight = win.style.height;
                win.dataset.oldTransform = win.style.transform;
                win.classList.add('maximized');
            }
        });
    }

    // Make draggable and resizable
    if (header) makeDraggable(win, header);
    if (resizeHandles.length > 0) makeResizable(win, resizeHandles);

    win.dataset.controlsInitialized = 'true';
}

export function setupFloatingWindows() {
    const windows = document.querySelectorAll('.floating-window');
    windows.forEach(win => initializePanelControls(win));
}

export function makeDraggable(element, handle) {
    let initialX, initialY, xOffset = 0, yOffset = 0;
        handle.onmousedown = e => {
            if (e.target.closest('.window-controls') || e.target.classList.contains('resize-handle')) return;
            e.preventDefault();
            const transform = getComputedStyle(element).transform;
            const matrix = transform !== 'none' ? new DOMMatrix(transform) : new DOMMatrix();
            xOffset = matrix.m41; yOffset = matrix.m42;
            initialX = e.clientX - xOffset; initialY = e.clientY - yOffset;
            controls.enabled = false;
            document.onmouseup = () => { document.onmouseup = null; document.onmousemove = null; controls.enabled = true; };
            document.onmousemove = (e) => {
                e.preventDefault();
                if (element.classList.contains('maximized')) return;
                xOffset = e.clientX - initialX; yOffset = e.clientY - initialY;

            // Constrain the panel within the viewport
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const elementWidth = element.offsetWidth;
            const elementHeight = element.offsetHeight;

            // Clamp X and Y offsets
            const clampedX = Math.max(0, Math.min(xOffset, viewportWidth - elementWidth));
            const clampedY = Math.max(0, Math.min(yOffset, viewportHeight - elementHeight));

            element.style.transform = `translate3d(${clampedX}px, ${clampedY}px, 0)`;
        };
    };
}

export function makeResizable(element, handles) {
    handles.forEach(handle => {
        handle.onmousedown = function(e) {
            e.preventDefault();
            e.stopPropagation();

            if (element.classList.contains('maximized')) return;

            const initialMouseX = e.clientX;
            const initialMouseY = e.clientY;

            const style = window.getComputedStyle(element);
            const initialWidth = parseFloat(style.width);
            const initialHeight = parseFloat(style.height);

            const matrix = new DOMMatrix(style.transform);
            const initialTop = matrix.m42;
            const initialLeft = matrix.m41;

            const handleClasses = handle.className;
            const isTop = handleClasses.includes('top');
            const isRight = handleClasses.includes('right');
            const isBottom = handleClasses.includes('bottom');
            const isLeft = handleClasses.includes('left');

            controls.enabled = false;

            document.onmousemove = function(moveEvent) {
                const dx = moveEvent.clientX - initialMouseX;
                const dy = moveEvent.clientY - initialMouseY;

                let newWidth = initialWidth;
                let newHeight = initialHeight;
                let newTop = initialTop;
                let newLeft = initialLeft;

                // Read min dimensions from CSS for consistency
                const minWidth = parseFloat(style.minWidth) || 320;
                const minHeight = parseFloat(style.minHeight) || 240;

                if (isRight) {
                    newWidth = initialWidth + dx;
                }
                if (isLeft) {
                    newWidth = initialWidth - dx;
                }
                if (isBottom) {
                    newHeight = initialHeight + dy;
                }
                if (isTop) {
                    newHeight = initialHeight - dy;
                }

                if (newWidth >= minWidth && isLeft) {
                    newLeft = initialLeft + dx;
                }
                if (newHeight >= minHeight && isTop) {
                    newTop = initialTop + dy;
                }

                // Clamp to minimum size
                newWidth = Math.max(minWidth, newWidth);
                newHeight = Math.max(minHeight, newHeight);

                // Constrain position within viewport
                const viewportWidth = window.innerWidth;
                const viewportHeight = window.innerHeight;

                newLeft = Math.max(0, Math.min(newLeft, viewportWidth - newWidth));
                newTop = Math.max(0, Math.min(newTop, viewportHeight - newHeight));

                // Apply final styles
                element.style.width = newWidth + 'px';
                element.style.height = newHeight + 'px';
                element.style.transform = `translate3d(${newLeft}px, ${newTop}px, 0)`;
            };

            document.onmouseup = function() {
                document.onmousemove = null;
                document.onmouseup = null;
                controls.enabled = true;
            };
        };
    });
}

export function setupSidebar() {
    dom['toggle-modules-btn']?.addEventListener('click', () => dom['right-sidebar']?.classList.toggle('closed'));
    dom['toggle-analysis-btn']?.addEventListener('click', () => dom['analysis-sidebar']?.classList.toggle('closed'));
}

function setupProjectPanel() {
    setupEpwUploadModal();
    checkRadiancePath();

    if (dom.map && dom.latitude && dom.longitude) {
        map = L.map(dom.map, { zoomControl: false }).setView([40.7128, -74.0060], 13);
        
        const lightTiles = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
        const darkTiles = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
        
        // Set initial tiles based on current theme
        const initialTheme = document.documentElement.getAttribute('data-theme') || 'light';
        const initialTiles = initialTheme === 'dark' ? darkTiles : lightTiles;

        tileLayer = L.tileLayer(initialTiles, {
            attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 20
        }).addTo(map);

        L.control.zoom({ position: 'bottomright' }).addTo(map);
        const marker = L.marker(map.getCenter(), { draggable: true }).addTo(map);
        const updateInputsFromMap = (latlng) => {
            dom.latitude.value = latlng.lat.toFixed(4);
            dom.longitude.value = latlng.lng.toFixed(4);
        };
        marker.on('dragend', (e) => updateInputsFromMap(e.target.getLatLng()));
        const updateMapFromInputs = () => {
            const lat = parseFloat(dom.latitude.value), lon = parseFloat(dom.longitude.value);
            if (!isNaN(lat) && !isNaN(lon)) {
                const newLatLng = L.latLng(lat, lon);
                map.setView(newLatLng);
                marker.setLatLng(newLatLng);
            }
        };
        dom.latitude.addEventListener('change', updateMapFromInputs);
        dom.longitude.addEventListener('change', updateMapFromInputs);
        updateInputsFromMap(marker.getLatLng());
    }
}

function setupEpwUploadModal() {
    const dropArea = dom['modal-file-drop-area'];
    const fileInput = dom['epw-file-input'];
    const modal = dom['epw-upload-modal'];
    const fileNameDisplay = dom['epw-file-name'];

    if (!dropArea || !fileInput || !modal || !fileNameDisplay) return;

    const handleFiles = (files) => {
        if (files.length > 0 && files[0].name.toLowerCase().endsWith('.epw')) {
            const file = files[0];
            fileInput.files = files;
            fileNameDisplay.textContent = file.name;
            fileNameDisplay.title = file.name;

            const reader = new FileReader();
            reader.onload = async function(e) {
            try {
                const epwContent = e.target.result;
                await project.setEpwData(epwContent);

                const lines = epwContent.split('\n');
                const locationLine = lines.find(line => line.startsWith('LOCATION'));

                    if (locationLine) {
                        const parts = locationLine.split(',');
                        if (parts.length >= 8) { // Minimum check for lat/lon fields
                            const lat = parseFloat(parts[6]);
                            const lon = parseFloat(parts[7]);

                            if (!isNaN(lat) && !isNaN(lon)) {
                                dom.latitude.value = lat.toFixed(4);
                                dom.longitude.value = lon.toFixed(4);
                                dom.latitude.dispatchEvent(new Event('change')); // Triggers map update
                            } else {
                                throw new Error('Latitude or Longitude in LOCATION line is not a valid number.');
                            }
                        } else {
                            throw new Error('LOCATION line has an unexpected format.');
                        }
                    } else {
                        showAlert('EPW file loaded, but no LOCATION line was found. Please set the location on the map manually.', 'Notice');
                    }
                    modal.classList.replace('flex', 'hidden');
                    // START: Dispatch custom event
                    // This allows other modules to know that a new EPW has been loaded
                    dom['upload-epw-btn'].dispatchEvent(new CustomEvent('epwLoaded'));

                    if (dom['location-inputs-container']) dom['location-inputs-container'].style.display = 'block';
                    
                } catch (error) {
                    console.error("Error parsing EPW file:", error);
                    showAlert(`Failed to parse EPW file's location data. The file might be corrupt or malformed. Please set the location manually. \nError: ${error.message}`, "EPW Parsing Error");
                    modal.classList.replace('flex', 'hidden'); // Still hide modal on error
                }
            };
            reader.readAsText(file);
        } else {
            showAlert('Please upload a valid .epw file.');
        }
    };

    dropArea.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => handleFiles(fileInput.files));

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, e => { e.preventDefault(); e.stopPropagation(); }, false);
    });

    dropArea.addEventListener('dragenter', () => dropArea.classList.add('dragover'));
    dropArea.addEventListener('dragleave', () => dropArea.classList.remove('dragover'));

    dropArea.addEventListener('drop', (e) => {
        dropArea.classList.remove('dragover');
        handleFiles(e.dataTransfer.files);
    });
}

function setCameraView(view) {
    if (sceneIsFPV) sceneToggleFPV(dom['view-type'].value); // Exit FPV if active
    controls.enabled = true;

    const W = parseFloat(dom.width.value), L = parseFloat(dom.length.value), H = parseFloat(dom.height.value);
    const center = new THREE.Vector3(0, H / 2, 0);
    const rotationY = THREE.MathUtils.degToRad(parseFloat(dom['room-orientation'].value));
    setProjectionMode(view === 'persp' ? 'perspective' : 'orthographic', false);

    let cameraDistance = Math.max(W, L, H) * 3;
    let position;
    switch (view) {
        case 'top': position = new THREE.Vector3(0, cameraDistance, 0); break;
        case 'front': position = new THREE.Vector3(0, 0, cameraDistance); break;
        case 'back': position = new THREE.Vector3(0, 0, -cameraDistance); break;
        case 'left': position = new THREE.Vector3(-cameraDistance, 0, 0); break;
        case 'right': position = new THREE.Vector3(cameraDistance, 0, 0); break;
        default: position = new THREE.Vector3(cameraDistance * 0.7, cameraDistance * 0.7, cameraDistance * 0.7); break;
    }
    const rotatedCenter = center.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), rotationY);
    activeCamera.position.copy(rotatedCenter).add(position);
    controls.target.copy(rotatedCenter);

    if (activeCamera.isOrthographicCamera) {
        activeCamera.zoom = (1 / Math.max(W, L, H)) * 5;
        activeCamera.updateProjectionMatrix();
    }
    controls.update();
    document.querySelectorAll('#view-controls .btn').forEach(b => b.classList.remove('active'));
    if(dom[`view-btn-${view}`]) dom[`view-btn-${view}`].classList.add('active');
}

function handleInputChange(e) {
    const id = e.target.id;
    const val = e.target.value;
    const valEl = dom[`${id}-val`];
   if (valEl) {
        let unit = '';
        if (id.includes('width') || id.includes('length') || id.includes('height') || id.includes('dist') || id.includes('thick') || id.includes('depth') || id.includes('extension') || id.includes('sep') || id.includes('offset') || id.includes('spacing') || id.startsWith('view-pos') || id.startsWith('daylight-sensor')) unit = 'm';
        else if (id.startsWith('wwr-') && !id.includes('sill')) unit = '%';
        else if (id.includes('fov') || id.includes('orientation') || id.includes('tilt') || id.includes('angle')) unit = '°';
        updateValueLabel(valEl, val, unit, id);
    }
    debouncedScheduleUpdate(id);
}

/**
 * Configuration for formatting numeric values based on input ID patterns.
 * Rules are applied in order, and the first match is used.
 */
const FORMATTING_RULES = [
    { test: (id, unit) => unit === '%', format: (num) => `${Math.round(num * 100)}%` },
    { test: (id, unit) => unit === '°', format: (num) => `${Math.round(num)}°` },
    { test: (id) => id.includes('sunpath-scale') || id.includes('world-axes-size'), format: (num) => `${num.toFixed(1)}x` },
    { test: (id) => id.includes('sunpath-compass-thick'), format: (num) => `${num.toFixed(1)}px` },
    { test: (id) => id.includes('refl') || id.includes('spec') || id.includes('trans') || id.includes('rough') || id.startsWith('view-dir'), format: (num) => num.toFixed(2) },
    { test: (id) => id.includes('thick') || id.includes('sep'), format: (num) => `${num.toFixed(3)}m` },
    { test: (id) => id.includes('spacing') || id.includes('offset') || id.includes('dist') || id.includes('depth'), format: (num) => `${num.toFixed(2)}m` },
    { test: (id, unit) => unit === 'm', format: (num) => `${num.toFixed(1)}m` }
];

/**
* Updates the text content of a DOM element with a formatted value.
* @param {HTMLElement} element The DOM element to update.
* @param {string | number} value The raw value to format.
* @param {string} unit The unit string (e.g., 'm', '%', '°').
* @param {string} id The ID of the input element, used for specific formatting rules.
*/
export function updateValueLabel(element, value, unit, id) {
    if (!element) return;
    const num = parseFloat(value);
    if (isNaN(num)) {
        element.textContent = value;
        return;
    }

    for (const rule of FORMATTING_RULES) {
        if (rule.test(id, unit)) {
            element.textContent = rule.format(num);
            return;
        }
    }

    // Default format if no rules match
    element.textContent = `${num}`;
}

export function updateAllLabels() {
    Object.keys(dom).forEach(id => {
        const el = dom[id];
        const valEl = dom[`${id}-val`];
        if (el && valEl && (el.tagName === 'INPUT' || el.tagName === 'SELECT')) {
            const val = el.value;
            let unit = '';
            if (id.includes('width') || id.includes('length') || id.includes('height') || id.includes('dist') || id.includes('thick') || id.includes('depth') || id.includes('extension') || id.includes('sep') || id.includes('offset') || id.includes('spacing') || id.startsWith('view-pos')) unit = 'm';
            else if (id.startsWith('wwr-') && !id.includes('sill')) unit = '%';
            else if (id.includes('fov') || id.includes('orientation') || id.includes('tilt') || id.includes('angle')) unit = '°';
            updateValueLabel(valEl, val, unit, id);
        }
    });
}

export function validateInputs(changedId = null) {
    const H = parseFloat(dom.height.value);
    const W = parseFloat(dom.width.value);
    const L = parseFloat(dom.length.value);
    const surfaceThickness = parseFloat(dom['surface-thickness'].value);

    // Set constraints for Horizontal and Vertical section sliders
    if(dom['h-section-dist']) dom['h-section-dist'].max = H;
    if(dom['v-section-dist']) dom['v-section-dist'].max = W;

    // Set constraints for POSITION (vp) sliders to keep the camera inside the room
    if(dom['view-pos-x']) { dom['view-pos-x'].min = 0; dom['view-pos-x'].max = W; }
    if(dom['view-pos-y']) { dom['view-pos-y'].min = 0; dom['view-pos-y'].max = H; }
    if(dom['view-pos-z']) { dom['view-pos-z'].min = 0; dom['view-pos-z'].max = L; }

    // Set constraints for TARGET (vd) sliders to represent a unit vector component
    ['view-dir-x', 'view-dir-y', 'view-dir-z'].forEach(id => {
        if(dom[id]) {
            dom[id].min = -1;
            dom[id].max = 1;
            dom[id].step = 0.01;
        }
    });

    // Set constraints for Daylighting Sensor sliders
    if (dom['daylight-sensor1-x']) dom['daylight-sensor1-x'].max = W;
    if (dom['daylight-sensor1-z']) dom['daylight-sensor1-z'].max = L;
    if (dom['daylight-sensor1-y']) dom['daylight-sensor1-y'].max = H;

    wallDirections.forEach(dir => {
        const wallW = (dir === 'n' || 's') ? W : L;

        // Add guards to prevent errors if DOM elements are not ready
        const winWidthInput = dom[`win-width-${dir}`];
        if (winWidthInput) {
            winWidthInput.max = wallW;
            if (parseFloat(winWidthInput.value) > wallW) {
                winWidthInput.value = wallW;
            }
        }

        const winHeightInput = dom[`win-height-${dir}`];
        const sillHeightInput = dom[`sill-height-${dir}`];
        if (winHeightInput) winHeightInput.max = H;
        if (sillHeightInput) sillHeightInput.max = H;

        if (winHeightInput && sillHeightInput && (parseFloat(winHeightInput.value) + parseFloat(sillHeightInput.value) > H)) {
            if (changedId === `win-height-${dir}`) {
                sillHeightInput.value = Math.max(0, H - parseFloat(winHeightInput.value));
            } else {
                winHeightInput.value = Math.max(0, H - parseFloat(sillHeightInput.value));
            }
        }
        
        const wwrSillInput = dom[`wwr-sill-height-${dir}`];
        if (wwrSillInput) {
            const { wh: wwr_wh } = getWindowParamsForWall(dir.toUpperCase());
            wwrSillInput.max = Math.max(0, H - wwr_wh);
            if (parseFloat(wwrSillInput.value) > parseFloat(wwrSillInput.max)) {
                wwrSillInput.value = wwrSillInput.max;
            }
        }
        
        const overhangDistSlider = dom[`overhang-dist-above-${dir}`];
        if (overhangDistSlider) {
            const { wh, sh } = getWindowParamsForWall(dir.toUpperCase());
            const spaceAboveWindow = H - (sh + wh);
            overhangDistSlider.max = Math.max(0, spaceAboveWindow).toFixed(2);
            if (parseFloat(overhangDistSlider.value) > parseFloat(overhangDistSlider.max)) {
                overhangDistSlider.value = overhangDistSlider.max;
            }
        }
        
        const winCountInput = dom[`win-count-${dir}`];
        if (winCountInput) {
            const { ww: ww_for_count } = getWindowParamsForWall(dir.toUpperCase());
            const maxWindows = (ww_for_count > 0) ? Math.floor((wallW + 0.1) / (ww_for_count + 0.1)) : 1;
            winCountInput.max = Math.max(1, maxWindows);
            if (parseInt(winCountInput.value) > parseInt(winCountInput.max)) {
                winCountInput.value = winCountInput.max;
            }
        }

        const depthPosSlider = dom[`win-depth-pos-${dir}`];
        if (depthPosSlider) {
            depthPosSlider.max = surfaceThickness;
            if (parseFloat(depthPosSlider.value) > surfaceThickness) {
                depthPosSlider.value = surfaceThickness;
            }
        }
    });

    updateAllLabels();
}

export function getWindowParamsForWall(orientation) {
    const W = parseFloat(dom.width.value), L = parseFloat(dom.length.value), H = parseFloat(dom.height.value);
    const wallWidth = (orientation === 'N' || orientation === 'S') ? W : L;
    const dir = orientation.toLowerCase();
    const winCount = parseInt(dom[`win-count-${dir}`].value);
    const mode = windowModes[dir];
    const winDepthPos = parseFloat(dom[`win-depth-pos-${dir}`]?.value || 0);
    let ww, wh, sh;

   if (mode === 'wwr') {
        const wwr = parseFloat(dom[`wwr-${dir}`].value);
        sh = parseFloat(dom[`wwr-sill-height-${dir}`].value);
        const aspectRatio = 1.5, max_wh = H - sh;
        if (max_wh <= 0 || winCount <= 0 || wwr <= 0) return { ww: 0, wh: 0, sh, wallWidth, winCount, mode, winDepthPos };
        const totalWindowArea = wallWidth * H * wwr;
        const singleWindowArea = totalWindowArea / winCount;
        let ideal_wh = Math.sqrt(singleWindowArea / aspectRatio);
        if (ideal_wh > max_wh) {
            wh = max_wh;
            ww = singleWindowArea / wh;
        } else {
            wh = ideal_wh;
            ww = wh * aspectRatio;
        }
        const totalWidthForWindows = winCount * ww + Math.max(0, winCount - 1) * 0.1;
        if (totalWidthForWindows > wallWidth) {
            ww = (wallWidth - Math.max(0, winCount - 1) * 0.1) / winCount;
            wh = singleWindowArea / ww;
        }
        if (wh > max_wh) wh = max_wh;
        return { ww: Math.max(0, ww), wh: Math.max(0, wh), sh, wallWidth, winCount, mode, winDepthPos };
    } else {
        return { 
            ww: parseFloat(dom[`win-width-${dir}`].value),
            wh: parseFloat(dom[`win-height-${dir}`].value), 
            sh: parseFloat(dom[`sill-height-${dir}`].value), 
            wallWidth, winCount, mode, winDepthPos
        };
    }
}

export function getAllWindowParams() {
    const params = {};
    wallDirections.forEach(dir => {
        // The new logic always gets the parameters for every wall.
        // The geometry creation functions will check if winCount > 0 before creating apertures.
        params[dir.toUpperCase()] = getWindowParamsForWall(dir.toUpperCase());
    });
    return params;
}

export function getAllShadingParams() {
    const params = {};
    wallDirections.forEach(dir => {
        if (!dom[`shading-${dir}-toggle`]?.checked) return; // Use return to skip iteration

        const type = dom[`shading-type-${dir}`]?.value;
        if (!type || type === 'none') return;

        const shadeParams = { type };

        if (type === 'overhang') {
            shadeParams.overhang = {
                depth: parseFloat(dom[`overhang-depth-${dir}`]?.value || 0),
                tilt: parseFloat(dom[`overhang-tilt-${dir}`]?.value || 0),
                distAbove: parseFloat(dom[`overhang-dist-above-${dir}`]?.value || 0),
                extension: parseFloat(dom[`overhang-extension-${dir}`]?.value || 0),
                thick: parseFloat(dom[`overhang-thick-${dir}`]?.value || 0.01)
            };
        } else if (type === 'lightshelf') {
            shadeParams.lightshelf = {
                placeExt: dom[`lightshelf-placement-ext-${dir}`]?.classList.contains('active'),
                placeInt: dom[`lightshelf-placement-int-${dir}`]?.classList.contains('active'),
                placeBoth: dom[`lightshelf-placement-both-${dir}`]?.classList.contains('active'),
                depthExt: parseFloat(dom[`lightshelf-depth-ext-${dir}`]?.value || 0),
                depthInt: parseFloat(dom[`lightshelf-depth-int-${dir}`]?.value || 0),
                tiltExt: parseFloat(dom[`lightshelf-tilt-ext-${dir}`]?.value || 0),
                tiltInt: parseFloat(dom[`lightshelf-tilt-int-${dir}`]?.value || 0),
                distBelowExt: parseFloat(dom[`lightshelf-dist-below-ext-${dir}`]?.value || 0),
                distBelowInt: parseFloat(dom[`lightshelf-dist-below-int-${dir}`]?.value || 0),
                thickExt: parseFloat(dom[`lightshelf-thick-ext-${dir}`]?.value || 0.01),
                thickInt: parseFloat(dom[`lightshelf-thick-int-${dir}`]?.value || 0.01)
            };
        } else if (type === 'louver') {
            shadeParams.louver = {
                isExterior: dom[`louver-placement-ext-${dir}`]?.classList.contains('active'),
                isHorizontal: dom[`louver-slat-orientation-${dir}`]?.value === 'horizontal',
                slatWidth: parseFloat(dom[`louver-slat-width-${dir}`]?.value || 0),
                slatSep: parseFloat(dom[`louver-slat-sep-${dir}`]?.value || 0),
                slatThick: parseFloat(dom[`louver-slat-thick-${dir}`]?.value || 0.001),
                slatAngle: parseFloat(dom[`louver-slat-angle-${dir}`]?.value || 0),
                distToGlass: parseFloat(dom[`louver-dist-to-glass-${dir}`]?.value || 0),
            };
        } else if (type === 'roller') {
            shadeParams.roller = {
                topOpening: parseFloat(dom[`roller-top-opening-${dir}`]?.value || 0),
                bottomOpening: parseFloat(dom[`roller-bottom-opening-${dir}`]?.value || 0),
                leftOpening: parseFloat(dom[`roller-left-opening-${dir}`]?.value || 0),
                rightOpening: parseFloat(dom[`roller-right-opening-${dir}`]?.value || 0),
                distToGlass: parseFloat(dom[`roller-dist-to-glass-${dir}`]?.value || 0),
                solarTrans: parseFloat(dom[`roller-solar-trans-${dir}`]?.value || 0),
                solarRefl: parseFloat(dom[`roller-solar-refl-${dir}`]?.value || 0),
                visTrans: parseFloat(dom[`roller-vis-trans-${dir}`]?.value || 0),
                visRefl: parseFloat(dom[`roller-vis-refl-${dir}`]?.value || 0),
                irEmis: parseFloat(dom[`roller-ir-emis-${dir}`]?.value || 0),
                irTrans: parseFloat(dom[`roller-ir-trans-${dir}`]?.value || 0),
                thickness: parseFloat(dom[`roller-thickness-${dir}`]?.value || 0.001),
                conductivity: parseFloat(dom[`roller-conductivity-${dir}`]?.value || 0),
            };
        }

        params[dir.toUpperCase()] = shadeParams;
    
    });
    
    return params;
}

function setProjectionMode(mode, updateViewButtons = true) {
    const isPersp = mode === 'perspective';
    dom['proj-btn-persp'].classList.toggle('active', isPersp);
    dom['proj-btn-ortho'].classList.toggle('active', !isPersp);
    const oldCam = activeCamera;
    const newCam = isPersp ? perspectiveCamera : orthoCamera;
    if (oldCam !== newCam) {
        newCam.position.copy(oldCam.position);
        newCam.rotation.copy(oldCam.rotation);
        newCam.zoom = oldCam.zoom;
        setActiveCamera(newCam);
        newCam.updateProjectionMatrix();
        onWindowResize();
    }
    if (updateViewButtons) {
        document.querySelectorAll('#view-controls .btn').forEach(b => b.classList.remove('active'));
        if (isPersp) dom['view-btn-persp'].classList.add('active');
    }
}


export function updateViewpointFromSliders() {
    // The sliders are now the single source of truth for updating the camera's state.
    const roomW = parseFloat(dom.width.value);
    const roomL = parseFloat(dom.length.value);

    // 1. Get Position from Sliders (in room coordinates, origin at corner)
    const pos = new THREE.Vector3(
        parseFloat(dom['view-pos-x'].value),
        parseFloat(dom['view-pos-y'].value),
        parseFloat(dom['view-pos-z'].value)
    );

    // 2. Get Direction from Sliders
    const dir = new THREE.Vector3(
        parseFloat(dom['view-dir-x'].value),
        parseFloat(dom['view-dir-y'].value),
        parseFloat(dom['view-dir-z'].value)
    );

    // 3. Convert room-corner coordinates to world coordinates (centered room)
    const worldPos = new THREE.Vector3(pos.x - roomW / 2, pos.y, pos.z - roomL / 2);

    // 4. Calculate the target point in world space
    const target = new THREE.Vector3().addVectors(worldPos, dir.normalize());

    // 5. Update the 3D viewpoint camera
    viewpointCamera.position.copy(worldPos);
    viewpointCamera.lookAt(target);
    viewpointCamera.fov = parseFloat(dom['view-fov'].value);
    viewpointCamera.far = parseFloat(dom['view-dist'].value);
    viewpointCamera.updateProjectionMatrix();
    viewCamHelper.update();
}

export function updateViewpointFromGizmo() {
    // This function now only READS from the gizmo/camera state to update the UI.
    const roomW = parseFloat(dom.width.value);
    const roomH = parseFloat(dom.height.value);
    const roomL = parseFloat(dom.length.value);
    const worldPos = viewpointCamera.position;

    // 1. Clamp world position to keep the gizmo inside the room boundaries
    worldPos.x = THREE.MathUtils.clamp(worldPos.x, -roomW / 2, roomW / 2);
    worldPos.y = THREE.MathUtils.clamp(worldPos.y, 0, roomH);
    worldPos.z = THREE.MathUtils.clamp(worldPos.z, -roomL / 2, roomL / 2);
    viewpointCamera.position.copy(worldPos); // Apply clamp

    // 2. Convert from world coordinates (centered) back to slider coordinates (corner origin)
    const sliderPos = new THREE.Vector3(
        worldPos.x + roomW / 2,
        worldPos.y,
        worldPos.z + roomL / 2
    );

    // 3. Get the camera's direction vector to update the direction sliders
    const direction = new THREE.Vector3();
    viewpointCamera.getWorldDirection(direction);

    // 4. Update UI Sliders without firing their 'input' events to prevent a loop
    dom['view-pos-x'].value = sliderPos.x.toFixed(2);
    dom['view-pos-y'].value = sliderPos.y.toFixed(2);
    dom['view-pos-z'].value = sliderPos.z.toFixed(2);
    dom['view-dir-x'].value = direction.x.toFixed(2);
    dom['view-dir-y'].value = direction.y.toFixed(2);
    dom['view-dir-z'].value = direction.z.toFixed(2);

    // 5. Manually refresh all text labels to reflect the new slider values
    updateAllLabels();
}

export function updateGizmoVisibility() {
    if (!transformControls || !viewCamHelper || !dom['gizmo-toggle']) return;
    const isVisible = dom['gizmo-toggle'].checked;
    transformControls.visible = isVisible;
    transformControls.enabled = isVisible;
    viewCamHelper.visible = isVisible;
}

export function setWindowMode(dir, mode, triggerUpdate = true) {
    windowModes[dir] = mode;
    dom[`mode-wwr-btn-${dir}`].classList.toggle('active', mode === 'wwr');
    dom[`mode-manual-btn-${dir}`].classList.toggle('active', mode !== 'wwr');
    dom[`wwr-controls-${dir}`].classList.toggle('hidden', mode !== 'wwr');
    dom[`manual-controls-${dir}`].classList.toggle('hidden', mode === 'wwr');
    if (triggerUpdate) scheduleUpdate(`mode-${dir}`);
}

function setGizmoMode(mode) {
    transformControls.setMode(mode);
    dom['mode-translate-btn'].classList.toggle('active', mode === 'translate');
    dom['mode-rotate-btn'].classList.toggle('active', mode !== 'translate');
}

function updateGridControls() {
    dom['floor-grid-controls'].classList.toggle('hidden', !dom['grid-floor-toggle'].checked);
    dom['ceiling-grid-controls'].classList.toggle('hidden', !dom['grid-ceiling-toggle'].checked);
    const wallsChecked = ['north', 'south', 'east', 'west'].some(dir => dom[`grid-${dir}-toggle`].checked);
    dom['wall-grid-controls'].classList.toggle('hidden', !wallsChecked);
    scheduleUpdate();
}

export function handleShadingTypeChange(dir, triggerUpdate = true) {
    const type = dom[`shading-type-${dir}`]?.value;
    if (type === undefined) return;
    ['overhang', 'lightshelf', 'louver', 'roller'].forEach(t => {
    const controlEl = dom[`shading-controls-${t}-${dir}`];
    if (controlEl) controlEl.classList.toggle('hidden', type !== t);
    });
    if(scene && triggerUpdate) {
       scheduleUpdate('shading-type');
    }
}

function setupShadingPanelButtonGroups(dir) {
    const lsBtns = { ext: dom[`lightshelf-placement-ext-${dir}`], int: dom[`lightshelf-placement-int-${dir}`], both: dom[`lightshelf-placement-both-${dir}`] };
    Object.keys(lsBtns).forEach(key => {
        if (!lsBtns[key]) return;
        lsBtns[key].addEventListener('click', () => {
            Object.values(lsBtns).forEach(btn => btn?.classList.remove('active'));
            lsBtns[key].classList.add('active');
            dom[`lightshelf-controls-ext-${dir}`].classList.toggle('hidden', key === 'int');
            dom[`lightshelf-controls-int-${dir}`].classList.toggle('hidden', key === 'ext');
            scheduleUpdate();
        });
    });
    const louverBtns = { ext: dom[`louver-placement-ext-${dir}`], int: dom[`louver-placement-int-${dir}`] };
    Object.keys(louverBtns).forEach(key => {
        if (!louverBtns[key]) return;
        louverBtns[key].addEventListener('click', () => {
            Object.values(louverBtns).forEach(btn => btn?.classList.remove('active'));
            louverBtns[key].classList.add('active');
            scheduleUpdate();
        });
    });
}

/**
* Provides a one-time reminder to check the Radiance installation path.
*/
function checkRadiancePath() {
    if (!dom['radiance-path']) return;

    const isWindows = navigator.platform.toUpperCase().indexOf('WIN') !== -1;
    const defaultPath = isWindows ? 'C:/Radiance' : '/usr/local/radiance';

    const radianceInput = dom['radiance-path'];
    radianceInput.placeholder = `e.g., ${defaultPath}`;

    // This check now serves as a one-time reminder rather than a file system check.
    if (!radianceInput.value && !localStorage.getItem('radiancePathAcknowledged')) {
        const message = `Please confirm the <b>Radiance Installation Path</b> is set correctly in the Project Setup panel.
                         <br><br>
                         The default path for your operating system is typically <code>${defaultPath}</code>.
                         If Radiance is installed elsewhere, please enter the correct path.
                         <br><br>
                         If you need to install Radiance, you can download it from the 
                         <a href="https://www.radiance-online.org/" target="_blank" class="text-[--primary-color] underline">official website</a> or the 
                         <a href="https://github.com/NREL/Radiance" target="_blank" class="text-[--primary-color] underline">NREL GitHub repository</a>.
                         <br><br>
                         <button id="ack-radiance-path" class="btn btn-secondary btn-sm mt-2">Don't show this again</button>`;

        showAlert(message, 'Reminder: Set Radiance Path');

        // Add a one-time listener to the acknowledgement button inside the alert
        const ackButton = document.getElementById('ack-radiance-path');
        if (ackButton) {
            ackButton.addEventListener('click', () => {
                localStorage.setItem('radiancePathAcknowledged', 'true');
                hideAlert();
            }, { once: true });
        }
    }
}

/**
* Shows a prompt asking the user to select a project directory if one hasn't been chosen.
*/
function promptForProjectDirectory() {
    // We use localStorage to remember if the user dismissed the prompt.
    if (project.dirHandle || localStorage.getItem('projectPromptDismissed') === 'true') {
        dom['project-access-prompt']?.classList.add('hidden');
        return;
    }

    const promptEl = dom['project-access-prompt'];
    if (promptEl) {
        promptEl.classList.remove('hidden');

        dom['select-folder-btn']?.addEventListener('click', async () => {
            await project.requestProjectDirectory();
            // The project method will hide the prompt on success.
        });

        dom['dismiss-prompt-btn']?.addEventListener('click', () => {
            promptEl.classList.add('hidden');
            localStorage.setItem('projectPromptDismissed', 'true');
        });
    }
}

export function showAlert(message, title = "Notification") {
    dom['custom-alert-title'].textContent = title;
    dom['custom-alert-message'].innerHTML = message;
    dom['custom-alert'].style.zIndex = getNewZIndex();
    dom['custom-alert'].classList.replace('hidden', 'flex');
}

function hideAlert() {
    dom['custom-alert'].classList.replace('flex', 'hidden');
}

/**
* Toggles the visibility and state of the comparative analysis UI.
* @param {boolean} enabled - Whether to enable or disable the mode.
*/
function toggleComparisonMode(enabled) {
    dom['comparison-file-loader']?.classList.toggle('hidden', !enabled);

    if (!enabled) {
        // When disabling, clear dataset B and hide related UI elements
        resultsManager.clearDataset('b');
        dom['results-file-name-b'].textContent = '';
        dom['results-file-input-b'].value = ''; // Clear file input
        dom['summary-b']?.classList.add('hidden');
        dom['view-mode-b-btn']?.classList.add('hidden');
        dom['view-mode-diff-btn']?.classList.add('hidden');

        // Switch back to view A if another view was active
        setViewMode('a');
    }
}

/**
* Sets the active view mode for the 3D visualization and dashboard.
* @param {'a' | 'b' | 'diff'} mode - The view mode to activate.
*/
function setViewMode(mode) {
    resultsManager.activeView = mode;

    // Update button active states
    ['a', 'b', 'diff'].forEach(m => {
        dom[`view-mode-${m}-btn`]?.classList.toggle('active', m === mode);
    });

    // Update the 3D visualization with the appropriate data
    const activeData = resultsManager.getActiveData();
    if (activeData) {
        updateSensorGridColors(activeData);
    }

    // Refresh the entire results dashboard to show the correct stats and legends
    updateResultsDashboard();
}

/**
* Gathers all parameters from the Sensor Grid UI panel.
* @returns {object|null} An object with grid parameters, or null if the panel doesn't exist.
*/
export function getSensorGridParams() {
    if (!dom['illuminance-grid-toggle']) return null;
    
    const floorIlluminanceParams = dom['grid-floor-toggle']?.checked
        ? {
            isTaskArea: dom['task-area-toggle']?.checked,
            task: {
                x: parseFloat(dom['task-area-start-x']?.value),
                z: parseFloat(dom['task-area-start-z']?.value),
                width: parseFloat(dom['task-area-width']?.value),
                depth: parseFloat(dom['task-area-depth']?.value),
            },
            hasSurrounding: dom['surrounding-area-toggle']?.checked,
            surroundingWidth: parseFloat(dom['surrounding-area-width']?.value),
        }
        : null;

    return {
        illuminance: {
            enabled: dom['illuminance-grid-toggle'].checked && (
                dom['grid-floor-toggle']?.checked || dom['grid-ceiling-toggle']?.checked ||
                dom['grid-north-toggle']?.checked || dom['grid-south-toggle']?.checked ||
                dom['grid-east-toggle']?.checked || dom['grid-west-toggle']?.checked
            ),
            showIn3D: dom['show-floor-grid-3d-toggle']?.checked,
            color: dom['illuminance-grid-color']?.value
        },
        view: {
            enabled: dom['view-grid-toggle'].checked,
            showIn3D: dom['show-view-grid-3d-toggle']?.checked,
            color: dom['view-grid-color']?.value,
            spacing: parseFloat(dom['view-grid-spacing']?.value),
            offset: parseFloat(dom['view-grid-offset']?.value),
            numDirs: parseInt(dom['view-grid-directions']?.value, 10),
            startVec: [
                parseFloat(dom['view-grid-start-vec-x']?.value),
                parseFloat(dom['view-grid-start-vec-y']?.value),
                parseFloat(dom['view-grid-start-vec-z']?.value)
            ]
        }
    };
}

/**
* Sets up the theme switcher functionality for multiple themes.
*/
export function setupThemeSwitcher() {
    const lightBtn = dom['theme-btn-light'];
    const darkBtn = dom['theme-btn-dark'];
    const cyberBtn = dom['theme-btn-cyber'];
    const htmlEl = document.documentElement;

    const lightTilesUrl = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
    const darkTilesUrl = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

    // Function to apply a theme
    const applyTheme = (theme) => {
        htmlEl.setAttribute('data-theme', theme);

        // Hide all buttons first
        lightBtn.style.display = 'none';
        darkBtn.style.display = 'none';
        cyberBtn.style.display = 'none';

        let sceneBgColor, mapTilesUrl;

        // Determine which button to show and what assets to use based on the CURRENT theme
        if (theme === 'dark') {
            darkBtn.style.display = 'flex'; // Show dark theme icon
            sceneBgColor = '#212121';
            mapTilesUrl = darkTilesUrl;
        } else if (theme === 'cyber') {
            cyberBtn.style.display = 'flex'; // Show cyber theme icon
            sceneBgColor = '#030d22';
            mapTilesUrl = darkTilesUrl;
        } else { // 'light' theme
            lightBtn.style.display = 'flex'; // Show light theme icon
            sceneBgColor = '#E9E9EF';
            mapTilesUrl = lightTilesUrl;
        }

        // Apply theme to map and scene
        if (tileLayer) tileLayer.setUrl(mapTilesUrl);
        if (scene) scene.background = new THREE.Color(sceneBgColor);

        // Update the 3D highlight color to match the new theme
        updateHighlightColor();

        // Re-render Mermaid diagrams with the new theme
        if (typeof mermaid !== 'undefined' && mermaid.run) {
          document.querySelectorAll('.mermaid[data-processed="true"]').forEach(el => {
            });
            
            const style = getComputedStyle(document.documentElement);
            mermaid.initialize({
                startOnLoad: false,
                theme: 'base',
                fontFamily: 'Inter, sans-serif',
                themeVariables: {
                    background: style.getPropertyValue('--panel-bg').trim(),
                    primaryColor: style.getPropertyValue('--btn-secondary-bg').trim(),
                    primaryTextColor: style.getPropertyValue('--text-primary').trim(),
                    primaryBorderColor: style.getPropertyValue('--text-primary').trim(),
                    lineColor: style.getPropertyValue('--text-secondary').trim(),
                    textColor: style.getPropertyValue('--text-primary').trim(),
                    fontSize: '14px',
                }
            });
            mermaid.run({
                nodes: document.querySelectorAll('.mermaid')
            });
        }
        localStorage.setItem('theme', theme);


        // Trigger a full scene update to apply new theme colors to JS-created objects
        // like the North Arrow and to re-calculate the sun paths with the new theme colors.
        updateScene();

    };

    // Event Listeners for the cycle (these remain the same)
    // Clicking the current theme's icon switches to the next one
    lightBtn.addEventListener('click', () => applyTheme('dark'));
    darkBtn.addEventListener('click', () => applyTheme('cyber'));
    cyberBtn.addEventListener('click', () => applyTheme('light'));

    // Initial theme check on page load
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    if (savedTheme) {
        applyTheme(savedTheme);
    } else if (prefersDark) {
        applyTheme('dark');
    } else {
        applyTheme('light');
    }
}

/**
* Formats a time value (0-23.75) into a HH:MM string.
* This is a helper function to avoid repeating formatting logic.
* @param {number} time - The time in hours (e.g., 14.5 for 14:30).
* @returns {string} The formatted time string "HH:MM".
*/
function formatTime(time) {
    if (isNaN(time)) return "--:--";
    const hours = Math.floor(time);
    const minutes = Math.round((time - hours) * 60);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

let timeSeriesChart = null;

/**
* Clears all UI elements related to results visualization.
*/
export function clearAllResultsDisplay() {
    // Clear all previous results visualizations from all panels
    if (dom['results-dashboard']) dom['results-dashboard'].classList.add('hidden');
    if (dom['glare-analysis-dashboard']) dom['glare-analysis-dashboard'].classList.add('hidden');
    if (dom['view-hdr-btn']) dom['view-hdr-btn'].classList.add('hidden');
    if (dom['annual-glare-controls']) dom['annual-glare-controls'].classList.add('hidden');
    if (dom['glare-rose-panel']) dom['glare-rose-panel'].classList.add('hidden');
    if (dom['results-file-name-a']) dom['results-file-name-a'].textContent = '';
    if (dom['results-file-name-b']) dom['results-file-name-b'].textContent = '';
    if (dom['results-file-input-a']) dom['results-file-input-a'].value = '';
    if (dom['results-file-input-b']) dom['results-file-input-b'].value = '';

    clearAnnualDashboard();
    clearTimeSeriesExplorer();
    updateSpectralMetricsDashboard(null); // Clear the spectral dashboard

    // Explicitly clear any 3D sensor grid visualization from previous results
    glareHighlighter.clear();
    updateSensorGridColors(null);
}

/**
* Handles the loading and processing of a results file.
* @param {File} file The results file selected by the user.
*/
async function handleResultsFile(file, key) {
    if (!file) return;

    const fileNameDisplay = dom[`results-file-name-${key}`];
    if (fileNameDisplay) fileNameDisplay.textContent = `Loading ${file.name}...`;
    const isHdrFile = file.name.toLowerCase().endsWith('.hdr');

    clearAllResultsDisplay();

    if (isHdrFile) {
        const loader = new RGBELoader();
        const url = URL.createObjectURL(file);

        loader.load(url, (texture) => {
        resultsManager.setHdrResult(texture, file.name);
        if (fileNameDisplay) fileNameDisplay.textContent = file.name;
        if (dom['view-hdr-btn']) dom['view-hdr-btn'].classList.remove('hidden');
        showAlert(`HDR Image "${file.name}" loaded successfully.`, 'File Loaded');
        URL.revokeObjectURL(url);
    }, undefined, (error) => {
        console.error("An error occurred loading the HDR file:", error);
        showAlert(`Failed to load HDR file: ${file.name}. See console for details.`, 'File Load Error');
        if (fileNameDisplay) fileNameDisplay.textContent = "Failed to load.";
    });

    } else {
    // Handle .ill and other text-based results files
    try {
        const { key: loadedKey } = await resultsManager.loadAndProcessFile(file, key);

        if (resultsManager.hasAnnualData(loadedKey)) {
            const { project } = await import('./project.js');
            const scheduleFile = project.simulationFiles['occupancy-schedule'];
            await resultsManager.calculateLightingMetrics(loadedKey, null, scheduleFile);
      }

        if (fileNameDisplay) fileNameDisplay.textContent = file.name;

        updateSpectralMetricsDashboard(loadedKey); // Update the spectral dashboard


    // After loading, check for annual data to update relevant dashboards
    if (resultsManager.hasAnnualData(loadedKey)) {
        const metrics = resultsManager.calculateAnnualMetrics(loadedKey, {});
        const lightingMetrics = resultsManager.datasets[loadedKey].lightingMetrics;
        updateAnnualMetricsDashboard(metrics, lightingMetrics);
        updateTimeSeriesExplorer();
    } else {
        clearAnnualDashboard();
        clearTimeSeriesExplorer();
    }

    // Show summary for dataset B if it was just loaded
    if (loadedKey === 'b' && dom['summary-b']) {
        dom['summary-b'].classList.remove('hidden');
    }

    // If both datasets are loaded, enable comparison buttons
    if (resultsManager.datasets.a && resultsManager.datasets.b) {
        dom['view-mode-b-btn']?.classList.remove('hidden');
        dom['view-mode-diff-btn']?.classList.remove('hidden');
    }

    // Set the view to the newly loaded dataset and update everything
                    setViewMode(loadedKey);
                    if (dom['results-dashboard']) dom['results-dashboard'].classList.remove('hidden');

                    // --- TRIGGER PROACTIVE SUGGESTIONS ---
                    import('./ai-assistant.js').then(({ triggerProactiveSuggestion }) => {
                        if (resultsManager.hasAnnualData(loadedKey)) {
                            triggerProactiveSuggestion('annual_illuminance_loaded');
                        }
                        if (resultsManager.hasAnnualGlareData(loadedKey)) {
                            triggerProactiveSuggestion('annual_glare_loaded');
                        }
                    });

                    // Show annual glare controls if that data type was loaded
    if (resultsManager.hasAnnualGlareData(loadedKey)) {
        if (dom['annual-glare-controls']) dom['annual-glare-controls'].classList.remove('hidden');
    }

    // Check if both data types are now loaded to show the combined analysis button
    const hasIll = resultsManager.hasAnnualData('a') || resultsManager.hasAnnualData('b');
    const hasDgp = resultsManager.hasAnnualGlareData('a') || resultsManager.hasAnnualGlareData('b');
    if (hasIll && hasDgp) {
        if(dom['combined-analysis-btn']) dom['combined-analysis-btn'].style.display = 'block';
    } else {
        if(dom['combined-analysis-btn']) dom['combined-analysis-btn'].style.display = 'none';
    }


    } catch (error) {
        console.error(`Failed to handle results file for dataset ${key}:`, error);
        if (fileNameDisplay) fileNameDisplay.textContent = "Failed to load.";
    }
    }
}

/**
* Updates the results dashboard with stats and a histogram.
* @param {object} stats - The statistics object from resultsManager.
*/
function updateResultsDashboard() {
    const statsA = resultsManager.datasets.a?.stats;
    const statsB = resultsManager.datasets.b?.stats;
    const activeStats = resultsManager.getActiveStats();
    const activeView = resultsManager.activeView;
    const activeGlareResult = resultsManager.getActiveGlareResult();

    // Decide what to show: grid results or glare analysis
    const hasGridData = activeStats && activeStats.count > 0;
    const hasGlareData = activeGlareResult && activeGlareResult.sources && activeGlareResult.sources.length > 0;

    dom['results-dashboard'].classList.toggle('hidden', !hasGridData);
    dom['glare-analysis-dashboard'].classList.toggle('hidden', !hasGlareData);

    if (hasGlareData) {
        populateGlareSourceList(activeGlareResult);
    } else {
        glareHighlighter.clear(); // Clear any old highlights if new file is not glare
    }

    // If there's no grid data, stop here.
    if (!hasGridData) return;

    // Update summary stats for A
    if (statsA) {
        dom['results-min-val-a'].textContent = statsA.min.toFixed(1);
        dom['results-avg-val-a'].textContent = statsA.avg.toFixed(1);
        dom['results-max-val-a'].textContent = statsA.max.toFixed(1);
    }

    // Update summary stats for B
    if (statsB) {
        dom['results-min-val-b'].textContent = statsB.min.toFixed(1);
        dom['results-avg-val-b'].textContent = statsB.avg.toFixed(1);
        dom['results-max-val-b'].textContent = statsB.max.toFixed(1);
    }

    // Show/hide color scales
    const isDiffView = activeView === 'diff';
    dom['standard-color-scale']?.classList.toggle('hidden', isDiffView);
    dom['difference-color-scale']?.classList.toggle('hidden', !isDiffView);

    if (isDiffView) {
        updateDifferenceLegend();
    } else if (activeStats) {
        // Update standard scale sliders and legend
        dom['results-scale-min'].max = activeStats.max;
        dom['results-scale-max'].max = activeStats.max;
        dom['results-scale-min'].value = activeStats.min;
        dom['results-scale-max'].value = activeStats.max;
        dom['results-scale-min-num'].value = activeStats.min.toFixed(1);
        dom['results-scale-max-num'].value = activeStats.max.toFixed(1);
        updateResultsLegend();
    }

    // Update Histogram
    const ctx = dom['results-histogram']?.getContext('2d');
    if (!ctx) return;

    if (resultsManager.histogramChart) {
        resultsManager.histogramChart.destroy();
    }

    resultsManager.histogramChart = new Chart(ctx, {
        type: 'bar',
        data: resultsManager.getHistogramData(),
        options: {
            plugins: {
                legend: { display: false },
                tooltip: { enabled: true }
            },
            scales: {
                y: { beginAtZero: true, title: { display: true, text: 'Sensor Count' } },
                x: { title: { display: true, text: 'Illuminance (lux)' } }
            }
        }
    });
}

/**
* Draws the color gradient legend on its canvas.
*/
function updateResultsLegend() {
    const canvas = dom['results-legend'];
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    const palette = palettes[resultsManager.colorScale.palette] || palettes.viridis;

    palette.forEach((color, i) => {
        gradient.addColorStop(i / (palette.length - 1), color);
    });

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    dom['legend-min-label'].textContent = Math.round(resultsManager.colorScale.min);
    dom['legend-max-label'].textContent = Math.round(resultsManager.colorScale.max);
}

/**
* Draws the color gradient legend for the difference map.
*/
function updateDifferenceLegend() {
    const canvas = dom['difference-legend'];
    if (!canvas) return;

    const stats = resultsManager.differenceData.stats;
    if (!stats) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    const palette = palettes.diverging;

    palette.forEach((color, i) => {
        gradient.addColorStop(i / (palette.length - 1), color);
    });

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

const maxAbs = Math.max(Math.abs(stats.min), Math.abs(stats.max));
dom['diff-legend-min-label'].textContent = `-${maxAbs.toFixed(0)}`;
dom['diff-legend-max-label'].textContent = `+${maxAbs.toFixed(0)}`;
}

/**
* Handles clicks on the 3D scene to detect clicks on sensor points.
* @param {MouseEvent} event The click event.
*/
function onSensorClick(event) {
    // Only proceed if annual data is loaded and a panel isn't being dragged
    if (!resultsManager.hasAnnualData('a') || event.target.closest('.floating-window .window-header')) {
        return;
    }

    const pointer = new THREE.Vector2();
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, activeCamera);

    const intersects = raycaster.intersectObjects([wallSelectionGroup], true);

    if (intersects.length > 0) {
        const intersection = intersects[0];
        const mesh = intersection.object;
        const instanceId = intersection.instanceId;

        // Calculate the global index of the clicked sensor
        let baseIndex = 0;
        for (const sensorMesh of sensorMeshes) {
            if (sensorMesh === mesh) {
                break;
            }
            baseIndex += sensorMesh.count;
        }

        const finalIndex = baseIndex + instanceId;
        openTemporalMapForPoint(finalIndex);
    }
}

/**
 * Projects a 2D pixel coordinate from a fisheye image into the 3D scene to find a glare source.
 * @param {object} pixelPos - The {x, y} coordinate of the glare source from the report.
 * @param {number} [imageWidth=1500] - The width of the source fisheye image.
 * @param {number} [imageHeight=1500] - The height of the source fisheye image.
 */
function projectGlareSource(pixelPos, imageWidth, imageHeight) {
    // Fallback to default dimensions if not provided, enhancing robustness.
    const effectiveWidth = imageWidth || 1500;
    const effectiveHeight = imageHeight || 1500;

    if (!viewpointCamera) {
        showAlert('Viewpoint camera is not available for projection.', 'Error');
        return;
    }

    // --- 1. Convert 2D fisheye pixel coordinate to a 3D direction vector ---
    const centerX = effectiveWidth / 2;
    const centerY = effectiveHeight / 2;
    const r_max = effectiveWidth / 2; // Radius of the 180-degree circle

    const Px = pixelPos.x - centerX;
    // Invert Y because image coords are top-down, but NDC/camera space is bottom-up.
    const Py = -(pixelPos.y - centerY);

    const r = Math.sqrt(Px * Px + Py * Py);
    if (r > r_max) {
        console.warn("Glare source coordinate is outside the fisheye image circle.");
        return; // Don't cast a ray for points outside the view
    }

    // For a standard Radiance fisheye view ('vth'), the angle is linearly proportional to the radius.
    const theta = (r / r_max) * (Math.PI / 2); // Angle from the forward vector (0 to 90 degrees)
    const phi = Math.atan2(Py, Px);            // Azimuthal angle in the image plane

    // Convert from spherical coordinates to a Cartesian vector in the camera's local space.
    // The camera in Three.js looks down its negative Z axis.
    const direction = new THREE.Vector3();
    direction.x = Math.sin(theta) * Math.cos(phi);
    direction.y = Math.sin(theta) * Math.sin(phi);
    direction.z = -Math.cos(theta);

    // --- 2. Transform the local direction vector into world space ---
    direction.applyQuaternion(viewpointCamera.quaternion);

    // --- 3. Perform the Raycast ---
    const raycaster = new THREE.Raycaster(viewpointCamera.position, direction);
    const objectsToIntersect = [roomObject, shadingObject];
    const intersects = raycaster.intersectObjects(objectsToIntersect, true);

    if (intersects.length > 0) {
        // Find the first non-wireframe intersection
        const firstHit = intersects.find(hit => hit.object.type !== 'LineSegments');
        
        if (firstHit) {
            glareHighlighter.highlight(firstHit.object);
            showAlert(`Glare source projected onto scene geometry.`, 'Highlight');
        } else {
            showAlert('Glare source ray only intersected with wireframes.', 'Projection Miss');
            glareHighlighter.clear();
        }
    } else {
        showAlert('Glare source ray did not intersect with any scene geometry.', 'Projection Miss');
        glareHighlighter.clear();
    }
}

/**
* Populates the UI with a list of clickable glare sources from a report.
* @param {object} glareResult - The parsed glare result object from resultsManager.
*/
function populateGlareSourceList(glareResult) {
    const list = dom['glare-source-list'];
    if (!list || !glareResult || !glareResult.sources) return;

    // Update summary values - adapt for UGR or DGP
    const isUgr = glareResult.ugr !== null;
    dom['glare-metric-label'].textContent = isUgr ? 'UGR' : 'DGP';
    dom['glare-val'].textContent = isUgr ? glareResult.ugr.toFixed(2) : glareResult.dgp.toFixed(5);
    dom['glare-source-count'].textContent = glareResult.sources.length;

    // Clear previous list
    list.innerHTML = '';
    glareHighlighter.clear();

    // Create and append new list items
    glareResult.sources.forEach((source, index) => {
        const li = document.createElement('li');
        li.className = 'p-2 rounded cursor-pointer hover:bg-[--grid-color] transition-colors';
        li.innerHTML = `<div class="flex justify-between items-center">
                          <span>Source ${index + 1} (L: ${source.L.toFixed(0)} cd/m²)</span>
                          <span class="text-xs text-[--text-secondary]">Ev: ${source.Ev.toFixed(0)}</span>
                        </div>`;
        
        li.addEventListener('click', () => {
            // Remove active class from all other items
            list.querySelectorAll('li').forEach(item => item.classList.remove('active-glare-source'));
            // Add active class to the clicked item
            li.classList.add('active-glare-source');
        // Pass dimensions from the glare result object, falling back to defaults.
        projectGlareSource(source.pos, glareResult.imageWidth, glareResult.imageHeight);
    });

    list.appendChild(li);
    });
}

/**
* Updates the spectral metrics dashboard with averaged values from loaded results.
* @param {'a' | 'b' | null} key - The dataset key to display, or null to clear.
*/
function updateSpectralMetricsDashboard(key) {
    const dashboard = dom['spectral-metrics-dashboard'];
    if (!dashboard) return;

    const dataset = key ? resultsManager.datasets[key] : null;
    const spectralData = dataset?.spectralResults;

    // Check if there is any spectral data to display
    const hasData = spectralData && (spectralData.photopic || spectralData.melanopic || spectralData.neuropic);

    if (!hasData) {
        dashboard.classList.add('hidden');
        return;
    }

    // Helper to calculate average and update DOM
    const updateMetric = (metricType, elementId) => {
        const dataArray = spectralData[metricType];
        const element = dom[elementId];
        if (element) {
            if (dataArray && dataArray.length > 0) {
                const sum = dataArray.reduce((a, b) => a + b, 0);
                const avg = sum / dataArray.length;
                element.textContent = avg.toFixed(1);
            } else {
                element.textContent = '--';
            }
        }
    };

    updateMetric('photopic', 'metric-photopic-val');
    updateMetric('melanopic', 'metric-melanopic-val');
    updateMetric('neuropic', 'metric-neuropic-val');

    dashboard.classList.remove('hidden');
}

dom['clear-glare-highlight-btn']?.addEventListener('click', () => {
        glareHighlighter.clear();
        if(dom['glare-source-list']) {
            dom['glare-source-list'].querySelectorAll('li').forEach(item => item.classList.remove('active-glare-source'));
        }
    });

/** Handles right-click events on the 3D scene to show a context menu on sensor points.
* @param {MouseEvent} event The contextmenu event.
*/
function onSensorRightClick(event) {
    // Hide the menu first to handle cases where it's already open
    dom['sensor-context-menu'].classList.add('hidden');

    // Only show the menu if there's results data loaded
    if (resultsManager.getActiveData() === null || resultsManager.getActiveData().length === 0) {
    return;
    }

    event.preventDefault();

    const pointer = new THREE.Vector2();
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, activeCamera);

    const intersects = raycaster.intersectObjects(sensorMeshes);

    if (intersects.length > 0) {
    // Use the closest intersection, which is standard practice.
    // intersects[0] is the object closest to the camera that was hit by the ray.
    const intersection = intersects[0];
    const menu = dom['sensor-context-menu'];

    // Store the exact world coordinate of the click on the sensor
    menu.dataset.point = JSON.stringify(intersection.point);

    // Position and show the menu
    menu.style.left = `${event.clientX}px`;
    menu.style.top = `${event.clientY}px`;
    menu.classList.remove('hidden');
    }
}

/**
 * Helper to update a viewpoint slider's value, its text label, and dispatch an event.
 * @param {string} id - The base ID of the slider (e.g., 'view-pos-x').
 * @param {number} value - The new numeric value for the slider.
 */
function _updateViewpointSliderAndDispatch(id, value) {
    const slider = dom[id];
    if (!slider) return;

    slider.value = value.toFixed(2);
    
    const valEl = dom[`${id}-val`];
    if (valEl) {
        const unit = id.startsWith('view-pos') ? 'm' : '';
        updateValueLabel(valEl, slider.value, unit, id);
    }
    
    // Dispatch an 'input' event to ensure all related logic (like 3D updates) is triggered.
    slider.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
* Handles the click event for the "Set Viewpoint Here" button in the context menu.
*/
function onSetViewpointHere() {
    const menu = dom['sensor-context-menu'];
    const pointString = menu.dataset.point;
    if (!pointString) return;

    menu.classList.add('hidden'); // Hide the menu after clicking

    const worldPoint = JSON.parse(pointString);
    const roomW = parseFloat(dom.width.value);
    const roomH = parseFloat(dom.height.value);
    const roomL = parseFloat(dom.length.value);

    // 1. Calculate the new camera position in world coordinates (slightly above the sensor)
    // A common eye height for a seated person is ~1.2m. Assuming workplane is 0.8m,
    // we add 0.4m to the sensor's y position.
    const newCameraPosWorld = new THREE.Vector3(worldPoint.x, worldPoint.y + 0.4, worldPoint.z);

    // 2. Calculate the target: the center of the room's height.
    const roomCenterWorld = new THREE.Vector3(0, roomH / 2, 0);

    // 3. Calculate the new direction vector
    const newDirection = new THREE.Vector3().subVectors(roomCenterWorld, newCameraPosWorld).normalize();

    // 4. Convert the new camera world position to slider coordinates (corner-based)
    const newCameraPosSlider = {
    x: newCameraPosWorld.x + roomW / 2,
    y: newCameraPosWorld.y,
    z: newCameraPosWorld.z + roomL / 2
    };

    // 5. Update the UI sliders, which will in turn dispatch events to update the 3D scene
    _updateViewpointSliderAndDispatch('view-pos-x', newCameraPosSlider.x);
    _updateViewpointSliderAndDispatch('view-pos-y', newCameraPosSlider.y);
    _updateViewpointSliderAndDispatch('view-pos-z', newCameraPosSlider.z);

    _updateViewpointSliderAndDispatch('view-dir-x', newDirection.x);
    _updateViewpointSliderAndDispatch('view-dir-y', newDirection.y);
    _updateViewpointSliderAndDispatch('view-dir-z', newDirection.z);

    // 6. Ensure the viewpoint panel is visible so the user sees the changes
     const viewpointPanel = document.getElementById('panel-viewpoint');
    if (viewpointPanel && viewpointPanel.classList.contains('hidden')) {
        togglePanelVisibility('panel-viewpoint', 'toggle-panel-viewpoint-btn');
    } else if (viewpointPanel) {
        // If already visible, just bring it to the front
        viewpointPanel.style.zIndex = getNewZIndex();
    }
}

/**
* Sets up the welcome screen with an interactive raycasting field effect.
*/
export function setupWelcomeScreen() {
    const welcomeScreen = document.getElementById('welcome-screen');
    const canvas = document.getElementById('glow-canvas');
    if (!welcomeScreen || !canvas) return;

    const ctx = canvas.getContext('2d');
    let animationFrameId;

    // --- Raycasting System State ---
    let boundaries = [];
    const rays = [];
    const mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

    // --- Helper Classes ---
    class Boundary {
        constructor(x1, y1, x2, y2) {
            this.a = { x: x1, y: y1 };
            this.b = { x: x2, y: y2 };
        }
    }

    class Ray {
        constructor(angle) {
            this.dir = { x: Math.cos(angle), y: Math.sin(angle) };
        }

        // Standard line-line intersection algorithm
        cast(wall, origin) {
            const x1 = wall.a.x;
            const y1 = wall.a.y;
            const x2 = wall.b.x;
            const y2 = wall.b.y;

            const x3 = origin.x;
            const y3 = origin.y;
            const x4 = origin.x + this.dir.x;
            const y4 = origin.y + this.dir.y;

            const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
            if (den === 0) {
                return null; // Lines are parallel
            }

            const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
            const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / den;

            if (t > 0 && t < 1 && u > 0) {
                const pt = {
                    x: x1 + t * (x2 - x1),
                    y: y1 + t * (y2 - y1)
                };
                return pt;
            }
            return null;
        }
    }

    // --- Core Functions ---
    function initScene() {
        boundaries = [];
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;

        // Create boundaries around the screen edges
        boundaries.push(new Boundary(0, 0, w, 0));
        boundaries.push(new Boundary(w, 0, w, h));
        boundaries.push(new Boundary(0, h, w, h));
        boundaries.push(new Boundary(0, 0, 0, h));

        // Create a few random internal boundaries for more visual interest
        for (let i = 0; i < 4; i++) {
            const x1 = Math.random() * w;
            const y1 = Math.random() * h;
            const x2 = Math.random() * w;
            const y2 = Math.random() * h;
            boundaries.push(new Boundary(x1, y1, x2, y2));
        }

        // Create the rays (one for every degree)
        if (rays.length === 0) {
            for (let a = 0; a < 360; a += 1.5) {
                rays.push(new Ray(a * Math.PI / 180));
            }
        }
    }

    function resizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);
        initScene(); // Re-initialize boundaries for the new size
    }

    function onMouseMove(e) {
        mouse.x = e.clientX;
        mouse.y = e.clientY;
    }

    function animateRaycast() {
        const theme = document.documentElement.getAttribute('data-theme') || 'light';
        let bgColor, rayColor, hitColor;

        if (theme === 'dark') {
            bgColor = '#212121';
            rayColor = 'rgba(224, 224, 224, 0.1)';
            hitColor = 'rgba(224, 224, 224, 0.8)';
        } else if (theme === 'cyber') {
            bgColor = '#030d22';
            rayColor = 'rgba(77, 139, 238, 0.2)';
            hitColor = '#00f6ff';
        } else { // light
            bgColor = '#E9E9EF';
            rayColor = 'rgba(52, 52, 52, 0.1)';
            hitColor = 'rgba(52, 52, 52, 0.7)';
        }

        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);

        for (const ray of rays) {
            let closestPoint = null;
            let record = Infinity;

            for (const wall of boundaries) {
                const pt = ray.cast(wall, mouse);
                if (pt) {
                    const d = Math.hypot(pt.x - mouse.x, pt.y - mouse.y);
                    if (d < record) {
                        record = d;
                        closestPoint = pt;
                    }
                }
            }

            if (closestPoint) {
                // Draw the ray from the mouse to the hit point
                ctx.strokeStyle = rayColor;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(mouse.x, mouse.y);
                ctx.lineTo(closestPoint.x, closestPoint.y);
                ctx.stroke();

                // Draw the bright particle at the hit point
                ctx.fillStyle = hitColor;
                ctx.beginPath();
                ctx.arc(closestPoint.x, closestPoint.y, 3, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        animationFrameId = requestAnimationFrame(animateRaycast);
    }

    function hideWelcomeScreen() {
        welcomeScreen.style.opacity = '0';
        setTimeout(() => {
            welcomeScreen.style.display = 'none';
            cancelAnimationFrame(animationFrameId);
            window.removeEventListener('mousemove', onMouseMove);
            if (resizeObserver) resizeObserver.disconnect();
        }, 500); // Match CSS transition
    }

    // --- Setup ---
    const resizeObserver = new ResizeObserver(() => resizeCanvas());
    resizeObserver.observe(welcomeScreen);

    window.addEventListener('mousemove', onMouseMove);
    welcomeScreen.addEventListener('click', hideWelcomeScreen, { once: true });

    resizeCanvas(); // Initial setup
    animateRaycast();
}

/**
* Handles a click on the main renderer canvas to select/deselect walls.
* @param {MouseEvent} event The click event.
*/
function onWallClick(event) {
    // Prevent selection when interacting with gizmos
    if (transformControls.dragging || sensorTransformControls.dragging) {
        return;
    }

    const pointer = new THREE.Vector2();
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, activeCamera);
    const intersects = raycaster.intersectObjects(wallSelectionGroup.children, true);
    const wallIntersect = intersects.find(i => i.object.userData.isSelectableWall === true);

    if (wallIntersect) {
        let targetGroup = wallIntersect.object.parent;
        while (targetGroup && !targetGroup.userData.canonicalId) {
            targetGroup = targetGroup.parent;
        }

        if (!targetGroup) return;

        const newWallId = targetGroup.userData.canonicalId;

        if (isWallSelectionLocked) {
            if (newWallId === selectedWallId) {
                // If clicking the SAME locked wall, unlock it.
                isWallSelectionLocked = false;
                updateLockIcon();
            } else {
                // If clicking a NEW wall while locked, select it but KEEP THE LOCK.
                handleWallSelection(targetGroup, false); // `false` prevents the lock from resetting.
            }
        } else {
            // If UNLOCKED, select any new wall and reset the lock state (default behavior).
            if (newWallId !== selectedWallId) {
                handleWallSelection(targetGroup, true);
            }
        }
    } else {
        // Clicked on empty space, which respects the lock state.
        handleWallDeselection();
    }
}

/**
* Manages the logic for selecting a new wall.
* @param {THREE.Group} wallGroup - The group object of the wall that was clicked.
*/
function handleWallSelection(wallGroup, resetLock = true) {
    selectedWallId = wallGroup.userData.canonicalId;
    // The geometry function `highlightWall` will clear any previous highlight.
    const wallMesh = wallGroup.children.find(c => c.isMesh && c.userData.isSelectableWall);
    if (wallMesh) {
        highlightWall(wallMesh);
    }
    showApertureControlsFor(selectedWallId);

    // Only reset the lock state if instructed to do so
    if (resetLock) {
        isWallSelectionLocked = false;
        updateLockIcon();
    }
}

/**
* Manages the logic for deselecting the current wall.
*/
function handleWallDeselection() {
    if (isWallSelectionLocked) return; // Prevent deselection if locked
    if (selectedWallId) {
        selectedWallId = null;
        clearWallHighlights();
        showApertureControlsFor(null);
    }
}

/**
* Updates the "Apertures & Shading" panel to show controls for the selected wall.
* @param {string|null} id - The canonical ID ('n', 's', 'e', 'w') of the wall, or null to hide all.
*/
function showApertureControlsFor(id) {
    const wallNames = { n: 'North', s: 'South', e: 'East', w: 'West' };

    // Hide all wall control panels first
    wallDirections.forEach(dir => {
        const controls = dom[`aperture-controls-${dir}`];
        if (controls) {
            controls.classList.add('hidden');
        }
    });

    // Show or hide the lock button depending on whether a wall is selected
    dom['wall-select-lock-btn']?.classList.toggle('hidden', !id);

    if (id && dom[`aperture-controls-${id}`]) {
        // Show the specific panel for the selected wall
        dom[`aperture-controls-${id}`].classList.remove('hidden');
        dom['selected-wall-display'].textContent = `${wallNames[id]} Wall`;
    } else {
        // If no ID, reset the display text and ensure the lock is off
        dom['selected-wall-display'].textContent = 'None';
        isWallSelectionLocked = false;
        updateLockIcon();
    }
}

/**
* Shows or hides the live preview section based on whether any section cut is active.
* @private
*/
function _updateLivePreviewVisibility() {
    const hEnabled = dom['h-section-toggle']?.checked;
    const vEnabled = dom['v-section-toggle']?.checked;
    dom['live-preview-section']?.classList.toggle('hidden', !hEnabled && !vEnabled);
}

/**
* Handles the click event for the 'Render Preview' button.
* Orchestrates the live rendering process and displays the result.
*/
async function handleRenderPreview() {
    if (!project.epwFileContent) {
        showAlert('Please load an EPW weather file in the Project Setup panel before rendering a preview.', 'Weather Data Missing');
        return;
    }
    if (!window.electronAPI) {
        showAlert('Live preview rendering is only available in the Electron desktop application.', 'Feature Not Available');
        return;
    }

    const btn = dom['render-section-preview-btn'];
    const btnSpan = btn.querySelector('span');
    const originalText = btnSpan.textContent;
    btn.disabled = true;
    btnSpan.textContent = 'Rendering...';

    try {
        const { runLivePreviewRender } = await import('./project.js');
        const result = await runLivePreviewRender();

        if (result && result.hdrPath) {
            const { openHdrViewer } = await import('./hdrViewer.js');
            const { RGBELoader } = await import('three/examples/jsm/loaders/RGBELoader.js');

            const loader = new RGBELoader();
            // In Electron, we can load from a file path directly if the main process makes it accessible
            // or returns the data. Assuming the backend returns a loadable path or data URL.
            loader.load(result.hdrPath, (texture) => {
                openHdrViewer(texture);
            }, undefined, (err) => {
                console.error("Failed to load rendered HDR:", err);
                showAlert('Could not load the rendered preview image.', 'Error');
            });
        } else {
            showAlert('Live preview rendering failed. Check the console for details.', 'Render Failed');
        }
    } catch (error) {
        console.error("Error during live preview:", error);
        showAlert(`An error occurred: ${error.message}`, 'Error');
    } finally {
        btn.disabled = false;
        btnSpan.textContent = originalText;
    }
}

/**
 * Gathers the current viewpoint parameters and formats them into a Radiance .vf file content string.
 * @param {boolean} [forceFisheye=false] - If true, overrides the UI settings to generate a 180° fisheye view.
 * @returns {string|null} The content for the .vf file or null if view elements are not found.
 */
export function getViewpointFileContent(forceFisheye = false) {
    const dom = getDom();
    if (!dom['view-pos-x'] || !dom['view-dir-x']) return null;

    const vp = `${dom['view-pos-x'].value} ${dom['view-pos-z'].value} ${dom['view-pos-y'].value}`;
    const vd = `${dom['view-dir-x'].value} ${dom['view-dir-z'].value} ${dom['view-dir-y'].value}`;
    const vu = "0 0 1"; // Z-up in Radiance

    if (forceFisheye) {
        return `rview -vth -vh 180 -vv 180 -vp ${vp} -vd ${vd} -vu ${vu}`;
    }

    const viewType = dom['view-type'].value;
    const fov = dom['view-fov'].value;

    switch(viewType) {
        case 'h': return `rview -vth -vh 180 -vv 180 -vp ${vp} -vd ${vd} -vu ${vu}`;
        case 'a': return `rview -vta -vh 180 -vv 180 -vp ${vp} -vd ${vd} -vu ${vu}`;
        case 'c': return `rview -vtc -vh 360 -vv 180 -vp ${vp} -vd ${vd} -vu ${vu}`;
        case 'l': return `rview -vtl -vh ${fov} -vv ${fov} -vp ${vp} -vd ${vd} -vu ${vu}`;
        case 'v':
        default:
            return `rview -vtv -vh ${fov} -vv ${fov} -vp ${vp} -vd ${vd} -vu ${vu}`;
    }
}

/**
 * Displays a proactive suggestion chip in the UI.
 * The chip is interactive and self-dismisses after a timeout.
 * @param {string} htmlContent - The inner HTML for the suggestion, which may contain <strong data-action="..."> tags.
 */
export function displayProactiveSuggestion(htmlContent) {
    const container = dom['proactive-suggestion-container'];
    if (!container) return;

    const chip = document.createElement('div');
    chip.className = 'proactive-suggestion-chip ui-panel !p-3 !pr-10 relative pointer-events-auto animate-fade-in-up';

    const content = document.createElement('p');
    content.className = 'text-sm';
    content.innerHTML = htmlContent;
    chip.appendChild(content);

    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '&times;';
    closeBtn.className = 'absolute top-1 right-1 w-6 h-6 flex items-center justify-center text-lg text-[--text-secondary] hover:text-[--text-primary]';
    closeBtn.ariaLabel = 'Dismiss suggestion';
    closeBtn.onclick = () => {
        chip.style.opacity = '0';
        setTimeout(() => chip.remove(), 300);
    };
    chip.appendChild(closeBtn);

    // Make actions clickable
    content.querySelectorAll('strong[data-action]').forEach(actionEl => {
        actionEl.classList.add('suggestion-action');
        actionEl.onclick = async () => {
            const action = actionEl.dataset.action;
            if (action.startsWith('open_recipe:')) {
                const recipeType = action.split(':')[1];
                const { openRecipePanelByType } = await import('./simulation.js');
                const templateId = `template-recipe-${recipeType}`;
                openRecipePanelByType(templateId);
            } else {
                switch (action) {
                    case 'open_results_dashboard':
                        dom['results-dashboard-btn']?.click();
                        break;
                    case 'show_temporal_map_info':
                        showAlert('To view a temporal map, right-click on any sensor point in the 3D view after loading annual results.', 'Temporal Map');
                        break;
                    case 'open_glare_rose':
                        openGlareRoseDiagram();
                        break;
                }
            }
            closeBtn.click(); // Close the chip after action is taken
        };
    });

    container.appendChild(chip);

    // Auto-dismiss after 15 seconds
    setTimeout(() => {
        // Check if the chip is still in the DOM before trying to remove it
        if (chip.parentElement) {
            closeBtn.click();
        }
    }, 15000);
}