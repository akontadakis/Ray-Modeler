// scripts/ui.js

import { updateScene, axesObject, updateSensorGridColors, roomObject, shadingObject, sensorMeshes, wallSelectionGroup, highlightWall, clearWallHighlights, updateHighlightColor, furnitureObject, addFurniture, updateFurnitureColor, resizeHandlesObject, contextObject } from './geometry.js';

import { activeCamera, perspectiveCamera, orthoCamera, setActiveCamera, onWindowResize, controls, transformControls, sensorTransformControls, viewpointCamera, scene, updateLiveViewType, renderer, toggleFirstPersonView as sceneToggleFPV, isFirstPersonView as sceneIsFPV, fpvOrthoCamera, updateViewpointFromUI, setGizmoVisibility, setUpdatingFromSliders, isUpdatingCameraFromSliders, setGizmoMode } from './scene.js';
import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { project } from './project.js';
// The generateAndStoreOccupancyCsv function needs to be available to other modules like project.js
export { generateAndStoreOccupancyCsv };
import { resultsManager, palettes } from './resultsManager.js';
import { initHdrViewer, openHdrViewer } from './hdrViewer.js';


// --- MODULE STATE ---
const dom = {}; // No longer exported directly
export function getDom() { return dom; } // Export a getter function instead

let updateScheduled = false;
let isResizeMode = false;
let draggedHandle = null;
let pointerDownPosition = new THREE.Vector2();
let initialDimension = { width: 0, length: 0, height: 0 };
let intersectionPoint = new THREE.Vector3();
let dragPlane = new THREE.Plane();
export let selectedWallId = null;
let isWallSelectionLocked = false;
const suggestionMemory = new Set(); // Prevents spamming suggestions during a session
let tableData = []; // Holds data for the interactive table
let savedViews = []; // Holds the saved camera view "snapshots"
let currentSort = { column: 'id', direction: 'asc' }; // Default sort state
let parsedBsdfData = null; // Holds parsed BSDF data to avoid re-parsing

// --- START: Added state for Task Area Visualizer ---
let taskAreaCtx, taskAreaCanvas;
let isDraggingTaskArea = false;
let isResizingTaskArea = false;
let resizeHandle = null; // e.g., 'br', 'tl', 'bl', 'tr'
let dragStartPos = { x: 0, y: 0 };
let initialTaskRect = { x: 0, z: 0, w: 0, d: 0 };
const HANDLE_SIZE = 8; // Size of resize handles in pixels
// --- END: Added state for Task Area Visualizer ---

// --- START: Added state for Daylighting Zone Visualizer ---
let zoneCtx, zoneCanvas;
let isDraggingZoneDivider = false;
// --- END: Added state for Daylighting Zone Visualizer ---

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
        if (baseId === 'bsdf-file') {
            dom['view-bsdf-btn']?.classList.add('hidden');
            parsedBsdfData = null; // Clear cached data
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
        if (baseId === 'bsdf-file') {
            dom['view-bsdf-btn']?.classList.remove('hidden');
            parsedBsdfData = null; // Clear cached data
        }
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

export function setupDOM() {
const ids = [
    // Global
    'theme-btn-light', 'theme-btn-dark', 'theme-btn-cyber', 'theme-btn-cafe58', 'theme-switcher-container',
    'render-container', 'sidebar-wrapper', 'right-sidebar', 'analysis-sidebar',
    'welcome-screen', 'glow-canvas',
    'toggle-modules-btn', 'toggle-analysis-btn', 'generate-scene-button',
    'save-project-button', 'load-project-button', 'run-simulation-button', 'custom-alert', 
    'custom-alert-title', 'custom-alert-message', 'custom-alert-close',

    // Toolbars
    'left-toolbar', 'toggle-panel-project-btn', 'toggle-panel-dimensions-btn', 
    'toggle-panel-aperture-btn', 'toggle-panel-lighting-btn', 'toggle-panel-materials-btn',
    'toggle-panel-sensor-btn', 'toggle-panel-viewpoint-btn', 'toggle-panel-scene-btn',
    'view-controls', 'view-btn-persp', 'view-btn-ortho', 'view-btn-top', 'view-btn-front', 'view-btn-back', 'view-btn-left', 'view-btn-right',

    // Scene Elements Panel
    'panel-scene-elements', 'asset-library', 'transform-controls-section',
    'gizmo-mode-translate', 'gizmo-mode-rotate', 'gizmo-mode-scale',
    'obj-pos-x', 'obj-pos-y', 'obj-pos-z', 'obj-pos-x-val', 'obj-pos-y-val', 'obj-pos-z-val',
    'obj-rot-y', 'obj-rot-y-val', // We now only have a single rotation slider for simplicity
    'obj-scale-uniform', 'obj-scale-uniform-val',

    // Project Panel
    'project-name', 'project-desc', 'building-type',
    'project-name', 'project-desc', 'building-type',
    'upload-epw-btn', 'epw-file-name', 'epw-upload-modal', 'epw-modal-close', 'modal-file-drop-area', 'epw-file-input',
    'latitude', 'longitude', 'map', 'location-inputs-container', 'radiance-path',

    // Dimensions Panel
    'width', 'width-val', 'length', 'length-val', 'height', 'height-val', 'elevation', 'elevation-val', 'room-orientation', 'room-orientation-val',
    'resize-mode-toggle', 'resize-mode-info',
    'surface-thickness', 'surface-thickness-val',
    'mode-parametric-btn', 'mode-import-btn', 'parametric-controls', 'import-controls',
    'import-obj-file', 'import-scale', 'import-center-toggle', 'load-model-btn',

    // Apertures Panel (Frames)
    'frame-toggle', 'frame-controls', 'frame-thick', 'frame-thick-val',
    'frame-depth', 'frame-depth-val',
    

    // Materials Panel
    'wall-mat-type', 'floor-mat-type', 'ceiling-mat-type', 'frame-mat-type', 'shading-mat-type', 'furniture-mat-type',
    'wall-refl', 'wall-refl-val', 'floor-refl', 'floor-refl-val', 'ceiling-refl', 'ceiling-refl-val', 'furniture-refl', 'furniture-refl-val',
    'glazing-trans', 'glazing-trans-val',
    'wall-spec', 'wall-spec-val', 'floor-spec', 'floor-spec-val', 'ceiling-spec', 'ceiling-spec-val', 'furniture-spec', 'furniture-spec-val',
    'wall-rough', 'wall-rough-val', 'floor-rough', 'floor-rough-val', 'ceiling-rough', 'ceiling-rough-val', 'furniture-rough', 'furniture-rough-val',
    'frame-refl', 'frame-refl-val', 'frame-spec', 'frame-spec-val', 'frame-rough', 'frame-rough-val',
    'shading-rough-val', 'wall-color', 'floor-color', 'ceiling-color', 'frame-color', 'shading-color',
    'wall-mode-refl', 'wall-mode-srd', 'wall-refl-controls', 'wall-srd-controls', 'wall-srd-file',
    'floor-mode-refl', 'floor-mode-srd', 'floor-refl-controls', 'floor-srd-controls', 'floor-srd-file',
    'ceiling-mode-refl', 'ceiling-mode-srd', 'ceiling-refl-controls', 'ceiling-srd-controls', 'ceiling-srd-file',
    'bsdf-toggle', 'bsdf-controls', 'view-bsdf-btn', 'bsdf-viewer-panel', 'bsdf-info-display', 
    'bsdf-incident-angle-select', 'bsdf-polar-plot-canvas',

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
    'task-area-visualizer-container', 'task-area-canvas',
    'task-area-start-x', 'task-area-start-x-val', 'task-area-start-z', 'task-area-start-z-val',
    'task-area-width', 'task-area-width-val', 'task-area-depth', 'task-area-depth-val',
    'surrounding-area-toggle', 'surrounding-area-controls', 'surrounding-area-width', 'surrounding-area-width-val',

    'show-view-grid-3d-toggle', 'view-grid-spacing', 'view-grid-spacing-val',
    'view-grid-offset', 'view-grid-offset-val', 'view-grid-directions',
    'view-grid-start-vec-x', 'view-grid-start-vec-y', 'view-grid-start-vec-z',

    // Viewpoint Panel
    'panel-viewpoint', 'view-type', 'fpv-toggle-btn', 'gizmo-toggle',
    'view-pos-x', 'view-pos-x-val', 'view-pos-y', 'view-pos-y-val', 'view-pos-z', 'view-pos-z-val',
    'view-dir-x', 'view-dir-x-val', 'view-dir-y', 'view-dir-y-val', 'view-dir-z', 'view-dir-z-val',
    'view-fov', 'view-fov-val', 'view-dist', 'view-dist-val',

    // View Options Panel
    'transparent-toggle', 'transparency-controls', 'surface-opacity', 'surface-opacity-val', 'ground-plane-toggle', 'world-axes-toggle', 'world-axes-size', 'world-axes-size-val',
    'h-section-toggle', 'h-section-controls', 'h-section-dist', 'h-section-dist-val',
    'v-section-toggle', 'v-section-controls', 'v-section-dist', 'v-section-dist-val',
    'live-preview-section', 'preview-date', 'preview-time', 'render-section-preview-btn',
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
    'lighting-power-section', 'lighting-spec-section',

    // Daylighting Controls
    'ies-photometry-viewer', 'ies-polar-plot-canvas', 'ies-info-display',
    'luminaire-wattage', 'lpd-display',
    'luminaire-wattage', 'lpd-display',
    'daylighting-enabled-toggle', 'daylighting-controls-wrapper', 'daylighting-control-type', 'daylighting-visualize-zones-toggle',
    'daylighting-zoning-strategy-controls', 'daylighting-zone-strategy-rows', 'daylighting-zone-strategy-cols',
    'daylight-sensor-count',
    'daylighting-setpoint', 'daylight-continuous-params', 'daylighting-min-power-frac', 'daylighting-min-power-frac-val', 'daylighting-min-light-frac', 'daylighting-min-light-frac-val',
    'daylight-stepped-params', 'daylighting-steps', 'daylighting-availability-schedule',
    'daylight-sensor-controls-container', 'daylight-sensor-1-controls', 'daylight-sensor-2-controls',
    'daylight-sensor1-x', 'daylight-sensor1-x-val', 'daylight-sensor1-y', 'daylight-sensor1-y-val',
    'daylight-sensor1-z', 'daylight-sensor1-z-val',
    'daylight-sensor1-gizmo-toggle',
    'daylight-sensor2-gizmo-toggle',
    'daylight-sensor1-dir-x', 'daylight-sensor1-dir-x-val',
    'daylight-sensor1-dir-y', 'daylight-sensor1-dir-y-val',
    'daylight-sensor1-dir-z', 'daylight-sensor1-dir-z-val',
    'daylight-sensor1-percent', 'daylight-sensor1-percent-val',
    'daylight-sensor2-x', 'daylight-sensor2-x-val',
    'daylight-sensor2-y', 'daylight-sensor2-y-val',
    'daylight-sensor2-z', 'daylight-sensor2-z-val',
    'daylight-sensor2-dir-x', 'daylight-sensor2-dir-x-val',
    'daylight-sensor2-dir-y', 'daylight-sensor2-dir-y-val',
    'daylight-sensor2-dir-z', 'daylight-sensor2-dir-z-val',
    'daylight-sensor2-percent', 'daylight-sensor2-percent-val',
    'daylighting-zone-visualizer-container', 'daylighting-zone-canvas',

    // EN 12464-1 Specific
    'maintenance-factor', 'maintenance-factor-val',
    'light-source-ra', 'light-source-tcp',

    // Results Panel
    'results-file-input-a', 'results-file-name-a', 'compare-mode-toggle', 'comparison-file-loader',
    'results-file-input-b', 'results-file-name-b', 'view-mode-selector', 'view-mode-a-btn',
    'view-mode-b-btn', 'view-mode-diff-btn', 'summary-stats-container', 'summary-a', 'summary-b',
    'results-min-val-a', 'results-avg-val-a', 'results-max-val-a', 'results-min-val-b',
    'results-avg-val-b', 'results-max-val-b', 'color-scale-section', 'standard-color-scale',
    'difference-color-scale', 'difference-legend', 'diff-legend-min-label', 'diff-legend-max-label',
    'results-dashboard', 'results-legend', 'legend-min-label', 'legend-max-label',
    'results-scale-min', 'results-scale-min-num',

    // Data Table
    'data-table-btn', 'data-table-panel', 'data-table-filter-input',
    'results-data-table', 'data-table-head', 'data-table-body',

    // Spectral Metrics Dashboard
    'spectral-metrics-dashboard', 'metric-photopic-val', 'metric-melanopic-val', 'metric-neuropic-val',

    // Info Panel & AI Assistant
    'info-button', 'panel-info',
    'ai-assistant-button', 'panel-ai-assistant', 'ai-chat-messages', 'ai-chat-form', 'ai-chat-input', 'ai-chat-send',
    'ai-mode-chat', 'ai-mode-inspector', 'run-inspector-btn', 'ai-inspector-results',
    'ai-settings-btn', 'ai-settings-modal', 'ai-settings-close-btn', 'ai-settings-form', 'ai-provider-select', 'ai-model-select', 'ai-api-key-input', 'openrouter-info-box',

    // Project Access Prompt
    'project-access-prompt', 'select-folder-btn', 'dismiss-prompt-btn',

    // Results Analysis Panel
    'stats-uniformity-val', 'highlight-min-btn', 'highlight-max-btn', 'clear-highlights-btn', 'heatmap-canvas',
    'heatmap-controls-container', 'heatmap-mode-selector', 'da-threshold-controls', 'da-threshold-slider', 'da-threshold-val',

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
    'proactive-suggestion-container',

    'generate-report-btn',

    // Climate Analysis Dashboard
    'climate-analysis-controls', 'climate-dashboard-btn', 'climate-analysis-panel',
    'wind-rose-canvas', 'solar-radiation-canvas', 'temperature-chart-canvas',

    // Lighting Energy Dashboard
    'lighting-energy-dashboard', 'lpd-val', 'energy-val', 'energy-savings-val',

    // Circadian Dashboard
    'circadian-metrics-dashboard', 'cs-gauge', 'cs-value', 'eml-value', 'cct-value', 'well-compliance-checklist',

    // Metric Selector for 3D View
    'metric-selector-container', 'metric-selector',

    // Sun Ray Tracing
    'sun-ray-trace-section', 'sun-ray-date', 'sun-ray-time', 'sun-ray-count',
    'sun-ray-count-val', 'sun-ray-bounces', 'sun-ray-bounces-val',
    'sun-rays-visibility-toggle', 'trace-sun-rays-btn',
    'sun-ray-info-display', 'sun-altitude-val', 'sun-azimuth-val', 'sun-dni-val', 'sun-dhi-val',
    'sun-ray-tracing-toggle-n', 'sun-ray-tracing-toggle-s', 'sun-ray-tracing-toggle-e', 'sun-ray-tracing-toggle-w',

    // Saved Views
    'save-view-btn', 'saved-views-list',

    // Context & Site Modeling
    'context-mode-none', 'context-mode-osm', 'context-mode-massing', 'context-mode-topo',
    'osm-controls', 'osm-radius', 'osm-radius-val', 'fetch-osm-data-btn', 'context-visibility-toggle',
    'massing-controls', 'add-massing-block-btn',

    // Enhanced Massing Controls
    'massing-shape', 'massing-width', 'massing-width-val', 'massing-depth', 'massing-depth-val',
    'massing-height', 'massing-height-val', 'massing-radius', 'massing-radius-val',
    'massing-pos-x', 'massing-pos-x-val', 'massing-pos-y', 'massing-pos-y-val', 'massing-pos-z', 'massing-pos-z-val',
    'massing-count', 'massing-count-val', 'massing-spacing', 'massing-spacing-val',
    'massing-pattern', 'create-massing-blocks-btn', 'clear-massing-blocks-btn',
    'massing-info', 'massing-count-display', 'massing-volume-display',
    'topo-controls', 'topo-heightmap-file', 'topo-plane-size', 'topo-plane-size-val', 'topo-vertical-scale', 'topo-vertical-scale-val',
    'context-material-controls', 'context-mat-type', 'context-refl', 'context-refl-val',

    // Enhanced Massing Controls
    'massing-shape', 'massing-width', 'massing-width-val', 'massing-depth', 'massing-depth-val',
    'massing-height', 'massing-height-val', 'massing-radius', 'massing-radius-val',
    'massing-pos-x', 'massing-pos-x-val', 'massing-pos-y', 'massing-pos-y-val', 'massing-pos-z', 'massing-pos-z-val',
    'massing-count', 'massing-count-val', 'massing-spacing', 'massing-spacing-val',
    'massing-pattern', 'create-massing-blocks-btn', 'clear-massing-blocks-btn',
    'massing-info', 'massing-count-display', 'massing-volume-display',

    // Context Object Management
    'context-object-management', 'context-object-search', 'context-object-filter',
    'select-all-objects', 'clear-selection', 'invert-selection',
    'context-object-list', 'bulk-delete', 'bulk-copy', 'bulk-change-material', 'bulk-select-by-type',
    'context-object-properties', 'object-info-display', 'obj-name', 'obj-type', 'obj-position',
    'obj-dimensions', 'obj-volume', 'delete-single-object', 'copy-single-object', 'focus-object',

    // Enhanced Massing Controls
    'massing-shape', 'massing-width', 'massing-width-val', 'massing-depth', 'massing-depth-val',
    'massing-height', 'massing-height-val', 'massing-radius', 'massing-radius-val',
    'massing-pos-x', 'massing-pos-x-val', 'massing-pos-y', 'massing-pos-y-val', 'massing-pos-z', 'massing-pos-z-val',
    'massing-count', 'massing-count-val', 'massing-spacing', 'massing-spacing-val',
    'massing-pattern', 'create-massing-blocks-btn', 'clear-massing-blocks-btn',
    'massing-info', 'massing-count-display', 'massing-volume-display',

    // Context Object Management
    'context-object-management', 'context-object-search', 'context-object-filter',
    'select-all-objects', 'clear-selection', 'invert-selection',
    'context-object-list', 'bulk-delete', 'bulk-copy', 'bulk-change-material', 'bulk-select-by-type',
    'context-object-properties', 'object-info-display', 'obj-name', 'obj-type', 'obj-position',
    'obj-dimensions', 'obj-volume', 'delete-single-object', 'copy-single-object', 'focus-object'
];

    ids.forEach(id => { const el = document.getElementById(id); if(el) dom[id] = el; });
    
    // Aperture panel IDs are generated dynamically
    wallDirections.forEach(dir => {
    const controlIds = [
            `aperture-controls-${dir}`, `win-count-${dir}`, `win-count-${dir}-val`,
            `mode-wwr-btn-${dir}`, `mode-manual-btn-${dir}`, `wwr-controls-${dir}`, `manual-controls-${dir}`,
            `wwr-${dir}`, `wwr-${dir}-val`, `wwr-sill-height-${dir}`, `wwr-sill-height-${dir}-val`,
            `win-width-${dir}`, `win-width-${dir}-val`, `win-height-${dir}`, `win-height-${dir}-val`, `sill-height-${dir}`, `sill-height-${dir}-val`, `win-depth-pos-${dir}`, `win-depth-pos-${dir}-val`, `win-depth-pos-${dir}-manual`, `win-depth-pos-${dir}-val-manual`,
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

/**
* Updates the visibility of the viewpoint gizmo based on the toggle's state.
*/
function updateGizmoVisibility() {
    setGizmoVisibility(dom['gizmo-toggle'].checked);
}

// --- START: New functions for Task Area Visualizer ---
/**
* Updates the task area sliders based on interactions with the 2D canvas.
* @param {object} rect - An object with {x, z, w, d} for the task area.
*/
function updateSlidersFromCanvas(rect) {
    const W = parseFloat(dom.width.value);
    const L = parseFloat(dom.length.value);

    // Clamp values to prevent the rectangle from going out of the room's bounds
    const clampedW = Math.max(0.1, Math.min(rect.w, W));
    const clampedD = Math.max(0.1, Math.min(rect.d, L));
    const clampedX = Math.max(0, Math.min(rect.x, W - clampedW));
    const clampedZ = Math.max(0, Math.min(rect.z, L - clampedD));

    // To prevent an infinite event loop, temporarily remove the 'input' listener
    // that calls the draw function again.
    const sliders = [dom['task-area-start-x'], dom['task-area-start-z'], dom['task-area-width'], dom['task-area-depth']];
    sliders.forEach(s => s.removeEventListener('input', drawTaskAreaVisualizer));

    dom['task-area-start-x'].value = clampedX.toFixed(1);
    dom['task-area-start-z'].value = clampedZ.toFixed(1);
    dom['task-area-width'].value = clampedW.toFixed(1);
    dom['task-area-depth'].value = clampedD.toFixed(1);

    // Manually trigger updates for the UI labels and the 3D scene
    updateAllLabels();
    scheduleUpdate();

    // Restore the event listeners after the current execution stack clears
    setTimeout(() => {
        sliders.forEach(s => s.addEventListener('input', drawTaskAreaVisualizer));
    }, 0);
}

/**
* Draws the room outline and the task area rectangle on the 2D canvas.
*/
function drawTaskAreaVisualizer() {
    if (!taskAreaCtx || !dom['task-area-toggle']?.checked) return;

    const container = dom['task-area-visualizer-container'];
    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    taskAreaCanvas.width = rect.width * dpr;
    taskAreaCanvas.height = rect.height * dpr;
    taskAreaCtx.scale(dpr, dpr);

    const W = parseFloat(dom.width.value);
    const L = parseFloat(dom.length.value);

    const { x, z, w, d } = getTaskAreaValues();

    const padding = 10;
    const canvasW = taskAreaCanvas.clientWidth - padding * 2;
    const canvasH = taskAreaCanvas.clientHeight - padding * 2;

    const scale = Math.min(canvasW / W, canvasH / L);

    const roomDrawW = W * scale;
    const roomDrawH = L * scale;
    const offsetX = (taskAreaCanvas.clientWidth - roomDrawW) / 2;
    const offsetY = (taskAreaCanvas.clientHeight - roomDrawH) / 2;

    taskAreaCtx.clearRect(0, 0, taskAreaCanvas.clientWidth, taskAreaCanvas.clientHeight);

    // Draw room outline
    taskAreaCtx.strokeStyle = 'var(--text-secondary)';
    taskAreaCtx.lineWidth = 1;
    taskAreaCtx.strokeRect(offsetX, offsetY, roomDrawW, roomDrawH);

    // Draw task area
    const taskDrawX = offsetX + x * scale;
    const taskDrawY = offsetY + z * scale;
    const taskDrawW = w * scale;
    const taskDrawH = d * scale;

    taskAreaCtx.fillStyle = 'rgba(59, 130, 246, 0.3)';
    taskAreaCtx.fillRect(taskDrawX, taskDrawY, taskDrawW, taskDrawH);
    taskAreaCtx.strokeStyle = 'rgba(59, 130, 246, 0.8)';
    taskAreaCtx.lineWidth = 2;
    taskAreaCtx.strokeRect(taskDrawX, taskDrawY, taskDrawW, taskDrawH);

    // Draw resize handles
    taskAreaCtx.fillStyle = 'rgba(59, 130, 246, 1)';
    const handleOffset = HANDLE_SIZE / 2;
    taskAreaCtx.fillRect(taskDrawX - handleOffset, taskDrawY - handleOffset, HANDLE_SIZE, HANDLE_SIZE); // top-left
    taskAreaCtx.fillRect(taskDrawX + taskDrawW - handleOffset, taskDrawY - handleOffset, HANDLE_SIZE, HANDLE_SIZE); // top-right
    taskAreaCtx.fillRect(taskDrawX - handleOffset, taskDrawY + taskDrawH - handleOffset, HANDLE_SIZE, HANDLE_SIZE); // bottom-left
    taskAreaCtx.fillRect(taskDrawX + taskDrawW - handleOffset, taskDrawY + taskDrawH - handleOffset, HANDLE_SIZE, HANDLE_SIZE); // bottom-right
}

/**
* Helper to get current task area values from the sliders.
*/
function getTaskAreaValues() {
    return {
        x: parseFloat(dom['task-area-start-x'].value),
        z: parseFloat(dom['task-area-start-z'].value),
        w: parseFloat(dom['task-area-width'].value),
        d: parseFloat(dom['task-area-depth'].value)
    };
}

/**
* Helper to get all metrics needed for canvas calculations.
*/
function getCanvasMetrics(e) {
    const container = dom['task-area-visualizer-container'];
    const W = parseFloat(dom.width.value);
    const L = parseFloat(dom.length.value);
    const padding = 10;
    const canvasW = e.target.clientWidth - padding * 2;
    const canvasH = e.target.clientHeight - padding * 2;
    const scale = Math.min(canvasW / W, canvasH / L);
    const roomDrawW = W * scale;
    const roomDrawH = L * scale;
    const offsetX = (e.target.clientWidth - roomDrawW) / 2;
    const offsetY = (e.target.clientHeight - roomDrawH) / 2;
    return { ...getTaskAreaValues(), W, L, scale, offsetX, offsetY, container };
}

/**
* Handles the mouse down event on the task area canvas to initiate dragging or resizing.
*/
function onTaskAreaMouseDown(e) {
    const { x, z, w, d, scale, offsetX, offsetY } = getCanvasMetrics(e);

    const handleHalf = HANDLE_SIZE / 2;
    const taskDrawX = offsetX + x * scale;
    const taskDrawY = offsetY + z * scale;
    const taskDrawW = w * scale;
    const taskDrawH = d * scale;

    if (e.offsetX > taskDrawX - handleHalf && e.offsetX < taskDrawX + handleHalf && e.offsetY > taskDrawY - handleHalf && e.offsetY < taskDrawY + handleHalf) resizeHandle = 'tl';
    else if (e.offsetX > taskDrawX + taskDrawW - handleHalf && e.offsetX < taskDrawX + taskDrawW + handleHalf && e.offsetY > taskDrawY - handleHalf && e.offsetY < taskDrawY + handleHalf) resizeHandle = 'tr';
    else if (e.offsetX > taskDrawX - handleHalf && e.offsetX < taskDrawX + handleHalf && e.offsetY > taskDrawY + taskDrawH - handleHalf && e.offsetY < taskDrawY + taskDrawH + handleHalf) resizeHandle = 'bl';
    else if (e.offsetX > taskDrawX + taskDrawW - handleHalf && e.offsetX < taskDrawX + taskDrawW + handleHalf && e.offsetY > taskDrawY + taskDrawH - handleHalf && e.offsetY < taskDrawY + taskDrawH + handleHalf) resizeHandle = 'br';
    else resizeHandle = null;

    if (resizeHandle) {
        isResizingTaskArea = true;
    } else if (e.offsetX > taskDrawX && e.offsetX < taskDrawX + taskDrawW && e.offsetY > taskDrawY && e.offsetY < taskDrawY + taskDrawH) {
        isDraggingTaskArea = true;
    }

    if(isDraggingTaskArea || isResizingTaskArea) {
        dragStartPos = { x: e.offsetX, y: e.offsetY };
        initialTaskRect = { x, z, w, d };
    }
}

/**
* Handles the mouse move event to update the rectangle and cursor style.
*/
function onTaskAreaMouseMove(e) {
    const metrics = getCanvasMetrics(e);
    const { scale, offsetX, offsetY, container } = metrics;

    const taskDrawX = offsetX + metrics.x * scale;
    const taskDrawY = offsetY + metrics.z * scale;
    const taskDrawW = metrics.w * scale;
    const taskDrawH = metrics.d * scale;
    const handleHalf = HANDLE_SIZE / 2;

    if ((e.offsetX > taskDrawX - handleHalf && e.offsetX < taskDrawX + handleHalf && e.offsetY > taskDrawY - handleHalf && e.offsetY < taskDrawY + handleHalf) || (e.offsetX > taskDrawX + taskDrawW - handleHalf && e.offsetX < taskDrawX + taskDrawW + handleHalf && e.offsetY > taskDrawY + taskDrawH - handleHalf && e.offsetY < taskDrawY + taskDrawH + handleHalf)) container.style.cursor = 'nwse-resize';
    else if ((e.offsetX > taskDrawX + taskDrawW - handleHalf && e.offsetX < taskDrawX + taskDrawW + handleHalf && e.offsetY > taskDrawY - handleHalf && e.offsetY < taskDrawY + handleHalf) || (e.offsetX > taskDrawX - handleHalf && e.offsetX < taskDrawX + handleHalf && e.offsetY > taskDrawY + taskDrawH - handleHalf && e.offsetY < taskDrawY + taskDrawH + handleHalf)) container.style.cursor = 'nesw-resize';
    else if (e.offsetX > taskDrawX && e.offsetX < taskDrawX + taskDrawW && e.offsetY > taskDrawY && e.offsetY < taskDrawY + taskDrawH) container.style.cursor = 'move';
    else container.style.cursor = 'crosshair';

    if (!isDraggingTaskArea && !isResizingTaskArea) return;

    const dx = (e.offsetX - dragStartPos.x) / scale;
    const dy = (e.offsetY - dragStartPos.y) / scale;
    let newRect = { ...initialTaskRect };

    if (isDraggingTaskArea) {
        newRect.x = initialTaskRect.x + dx;
        newRect.z = initialTaskRect.z + dy;
    } else if (isResizingTaskArea) {
        if (resizeHandle.includes('l')) { newRect.x = initialTaskRect.x + dx; newRect.w = initialTaskRect.w - dx; }
        if (resizeHandle.includes('r')) { newRect.w = initialTaskRect.w + dx; }
        if (resizeHandle.includes('t')) { newRect.z = initialTaskRect.z + dy; newRect.d = initialTaskRect.d - dy; }
        if (resizeHandle.includes('b')) { newRect.d = initialTaskRect.d + dy; }
    }
    updateSlidersFromCanvas(newRect);
    drawTaskAreaVisualizer();
}

/**
* Handles the mouse up event to end the drag/resize operation.
*/
function onTaskAreaMouseUp() {
    isDraggingTaskArea = false;
    isResizingTaskArea = false;
    resizeHandle = null;
    const container = dom['task-area-visualizer-container'];
    if (container) container.style.cursor = 'move';
}

/**
* Sets up all event listeners for the task area visualizer.
*/
function setupTaskAreaVisualizer() {
    taskAreaCanvas = dom['task-area-canvas'];
    if (!taskAreaCanvas) return;
    taskAreaCtx = taskAreaCanvas.getContext('2d');

    const inputsToWatch = ['width', 'length', 'task-area-start-x', 'task-area-start-z', 'task-area-width', 'task-area-depth'];
    inputsToWatch.forEach(id => {
        dom[id]?.addEventListener('input', drawTaskAreaVisualizer);
    });

    dom['task-area-toggle']?.addEventListener('change', () => {
        if(dom['task-area-toggle'].checked) {
            drawTaskAreaVisualizer();
        }
    });

    taskAreaCanvas.addEventListener('mousedown', onTaskAreaMouseDown);
    taskAreaCanvas.addEventListener('mousemove', onTaskAreaMouseMove);
    taskAreaCanvas.addEventListener('mouseup', onTaskAreaMouseUp);
    taskAreaCanvas.addEventListener('mouseleave', onTaskAreaMouseUp); 

    new ResizeObserver(drawTaskAreaVisualizer).observe(dom['task-area-visualizer-container']);
}

// --- END: New functions for Task Area Visualizer ---

export async function setupEventListeners() {
    // Add the event listener for the lock button
    dom['wall-select-lock-btn']?.addEventListener('click', () => {
        isWallSelectionLocked = !isWallSelectionLocked;
        updateLockIcon();
    });

    // The import from annualDashboard is updated to include the new functions
    initHdrViewer(); // Initialize the HDR viewer
    observeAndInitDynamicPanels();

    // Geometry Mode Switcher
    dom['mode-parametric-btn']?.addEventListener('click', () => switchGeometryMode('parametric'));
    dom['mode-import-btn']?.addEventListener('click', () => switchGeometryMode('import'));
    dom['load-model-btn']?.addEventListener('click', handleModelImport);


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
    dom['view-btn-persp']?.addEventListener('click', () => setCameraView('persp'));
    dom['view-btn-ortho']?.addEventListener('click', () => setCameraView('ortho'));
    dom['view-btn-top']?.addEventListener('click', () => setCameraView('top'));
    dom['view-btn-front']?.addEventListener('click', () => setCameraView('front'));
    dom['view-btn-back']?.addEventListener('click', () => setCameraView('back'));
    dom['view-btn-left']?.addEventListener('click', () => setCameraView('left'));
    dom['view-btn-right']?.addEventListener('click', () => setCameraView('right'));
    dom['frame-toggle']?.addEventListener('change', () => { dom['frame-controls']?.classList.toggle('hidden', !dom['frame-toggle'].checked); scheduleUpdate(); });
    dom['bsdf-toggle']?.addEventListener('change', async (e) => {
        const isEnabled = e.target.checked;
        dom['bsdf-controls']?.classList.toggle('hidden', !isEnabled);
        if (isEnabled) {
            const { triggerProactiveSuggestion } = await import('./ai-assistant.js');
            triggerProactiveSuggestion('bsdf_enabled');
        }
    });
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
    dom['task-area-toggle']?.addEventListener('change', async (e) => {
        const isEnabled = e.target.checked;
        dom['task-area-controls']?.classList.toggle('hidden', !isEnabled);
        // A surrounding area is only logical if a task area is defined.
        dom['surrounding-area-toggle'].disabled = !isEnabled;
        if (!isEnabled) {
            // Uncheck and hide surrounding controls if task area is disabled
            dom['surrounding-area-toggle'].checked = false;
            dom['surrounding-area-toggle'].dispatchEvent(new Event('change'));
        }
        scheduleUpdate();

        if (isEnabled) {
            const { triggerProactiveSuggestion } = await import('./ai-assistant.js');
            triggerProactiveSuggestion('task_area_enabled');
        }
    });
    dom['surrounding-area-toggle']?.addEventListener('change', (e) => {
        dom['surrounding-area-controls']?.classList.toggle('hidden', !e.target.checked);
        scheduleUpdate();
    });

    // Add dynamic validation to keep the task area inside the room
    const taskAreaSliders = ['task-area-start-x', 'task-area-start-z', 'task-area-width', 'task-area-depth'];
    taskAreaSliders.forEach(id => {
        dom[id]?.addEventListener('input', () => validateInputs(id));
    });

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
        defaultDate: "Mar 21",
        minDate: "Feb 1",
        maxDate: "Mar 21"
    });

    // Date picker for the Sun Ray Tracer
    flatpickr("#sun-ray-date", {
        dateFormat: "M j",
        defaultDate: "Jun 21"
    });

    dom['render-section-preview-btn']?.addEventListener('click', handleRenderPreview);
    dom['trace-sun-rays-btn']?.addEventListener('click', handleSunRayTrace);

    // Add listeners for the new sun ray tracing toggles in the aperture panel
    ['n', 's', 'e', 'w'].forEach(dir => {
        dom[`sun-ray-tracing-toggle-${dir}`]?.addEventListener('change', handleSunRayToggle);
    });

    dom['sun-rays-visibility-toggle']?.addEventListener('change', async (e) => {
        const { toggleSunRaysVisibility } = await import('./sunTracer.js');
        toggleSunRaysVisibility(e.target.checked);
    });

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
                // When exiting FPV, update gizmo visibility based on the checkbox.
                setGizmoVisibility(dom['gizmo-toggle'].checked);
        }
    });

    setupTaskAreaVisualizer(); // Initialize the new visualizer
    setupDaylightingZoneVisualizer(); // Initialize the new zone visualizer

    dom['custom-alert-close']?.addEventListener('click', hideAlert);
    dom['gizmo-toggle']?.addEventListener('change', (e) => setGizmoVisibility(e.target.checked));


    // --- 3D Scene Interaction ---
    renderer.domElement.addEventListener('click', onSensorClick, false);
    renderer.domElement.addEventListener('contextmenu', onSensorRightClick, false);
    window.addEventListener('click', () => dom['sensor-context-menu']?.classList.add('hidden'));
    dom['set-viewpoint-here-btn']?.addEventListener('click', onSetViewpointHere);

    // --- Annual Glare Listeners ---
    dom['glare-rose-btn']?.addEventListener('click', async () => {
        const { openGlareRoseDiagram } = await import('./annualDashboard.js');
        openGlareRoseDiagram();
    });
    dom['glare-rose-threshold']?.addEventListener('input', async (e) => {
        if (dom['glare-rose-threshold-val']) {
            dom['glare-rose-threshold-val'].textContent = parseFloat(e.target.value).toFixed(2);
        }
        // Live update the chart if the panel is visible
        if (dom['glare-rose-panel'] && !dom['glare-rose-panel'].classList.contains('hidden')) {
            const { updateGlareRoseDiagram } = await import('./annualDashboard.js');
            updateGlareRoseDiagram();
        }
    });

    // --- Combined Analysis Listeners ---
    dom['combined-analysis-btn']?.addEventListener('click', async () => {
        const { openCombinedAnalysisPanel } = await import('./annualDashboard.js');
        openCombinedAnalysisPanel();
    });
    dom['combined-glare-threshold']?.addEventListener('input', async (e) => {
        if (dom['combined-glare-threshold-val']) {
            dom['combined-glare-threshold-val'].textContent = parseFloat(e.target.value).toFixed(2);
        }
        if (dom['combined-analysis-panel'] && !dom['combined-analysis-panel'].classList.contains('hidden')) {
            const { updateCombinedAnalysisChart } = await import('./annualDashboard.js');
            updateCombinedAnalysisChart();
        }
    });
    
    // --- Climate Analysis Listener ---
    dom['climate-dashboard-btn']?.addEventListener('click', async () => {
        const { openClimateAnalysisDashboard } = await import('./annualDashboard.js');
        openClimateAnalysisDashboard();
    });

    // --- Results Panel Listeners ---
    dom['results-file-input-a']?.addEventListener('change', (e) => handleResultsFile(e.target.files[0], 'a'));
    dom['results-file-input-b']?.addEventListener('change', (e) => handleResultsFile(e.target.files[0], 'b'));
    dom['compare-mode-toggle']?.addEventListener('change', (e) => toggleComparisonMode(e.target.checked));

    // View mode buttons
    dom['view-mode-a-btn']?.addEventListener('click', () => setViewMode('a'));
    dom['view-mode-b-btn']?.addEventListener('click', () => setViewMode('b'));
    dom['view-mode-diff-btn']?.addEventListener('click', () => setViewMode('diff'));

    dom['metric-selector']?.addEventListener('change', (e) => {
        resultsManager.setActiveMetricType(e.target.value);
        updateSensorGridColors(resultsManager.getActiveData());
        updateResultsDashboard();
        populateDataTable(); // Update table when metric changes
    });

    // --- Interactive Data Table Listeners ---
  dom['data-table-body']?.addEventListener('click', (e) => {
      const row = e.target.closest('tr');
      if (row && row.dataset.pointIndex !== undefined) {
          const index = parseInt(row.dataset.pointIndex, 10);
          highlightSensorByIndex(index);

          // Highlight the clicked row in the table
          dom['data-table-body'].querySelectorAll('tr').forEach(r => r.classList.remove('active'));
          row.classList.add('active');
      }
  });

  dom['data-table-head']?.addEventListener('click', (e) => {
      const th = e.target.closest('th');
      if (th && th.dataset.column) {
          const column = th.dataset.column;
          if (currentSort.column === column) {
              currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
          } else {
              currentSort.column = column;
              currentSort.direction = 'asc';
          }
          populateDataTable(); // Re-sort and re-populate the table
      }
  });

  dom['data-table-filter-input']?.addEventListener('input', filterDataTable);

    // --- HDR Viewer Button Listener ---
    dom['view-hdr-btn']?.addEventListener('click', () => {
        if (resultsManager.hdrResult) {
            // Also pass any available glare data from the active dataset
            const glareResult = resultsManager.getActiveGlareResult();
                openHdrViewer(resultsManager.hdrResult.texture, glareResult);
            }
    });

    dom['generate-report-btn']?.addEventListener('click', async () => {
        const { reportGenerator } = await import('./reportGenerator.js');
        reportGenerator.generate();
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
    _setupAssetLibraryDragDrop();
    window.addEventListener('resize', onWindowResize);
    dom['resize-mode-toggle']?.addEventListener('change', (e) => {
        isResizeMode = e.target.checked;
        dom['resize-mode-info'].classList.toggle('hidden', !isResizeMode);
        scheduleUpdate(); // Rebuild scene to show/hide handles
    });
    renderer.domElement.addEventListener('pointerdown', onPointerDown, false);
    renderer.domElement.addEventListener('pointermove', onPointerMove, false);
    renderer.domElement.addEventListener('pointerup', onPointerUp, false);

    if(dom['view-type']) updateLiveViewType(dom['view-type'].value);

   // --- Gizmo Mode Listeners ---
    dom['gizmo-mode-translate']?.addEventListener('click', () => setGizmoMode('translate'));
    dom['gizmo-mode-rotate']?.addEventListener('click', () => setGizmoMode('rotate'));
    dom['gizmo-mode-scale']?.addEventListener('click', () => setGizmoMode('scale'));

    // Listeners for the new transform sliders with real-time feedback
    const transformSliders = ['obj-pos-x', 'obj-pos-y', 'obj-pos-z', 'obj-rot-y', 'obj-scale-uniform'];
    transformSliders.forEach(id => {
        const slider = dom[id];
        const label = dom[`${id}-val`];
        if (slider && label) {
            slider.addEventListener('input', () => {
                let unit = '';
                if (id.startsWith('obj-pos')) unit = 'm';
                else if (id.startsWith('obj-rot')) unit = '°';
                
                updateValueLabel(label, slider.value, unit, id);
                _updateObjectFromTransformSliders();
            });
        }
    });
    
    // Listener for updates from the transform gizmo in the 3D scene
    renderer.domElement.addEventListener('transformGizmoChange', (e) => {
        if (e.detail.object) {
            _updateTransformSlidersFromObject(e.detail.object);
        }
    });


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
                    makeResizable(resultsPanel, resultsPanel.querySelectorAll('.resize-handle-edge, .resize-handle-corner'));
                    ensureWindowInView(resultsPanel);
                } else {
                    showAlert('Please load a results file first.', 'No Data');
                }
            } else {
                resultsPanel.classList.add('hidden');
            }
        }
    });

    dom['heatmap-mode-selector']?.addEventListener('change', () => {
    const isDaMode = dom['heatmap-mode-selector'].value === 'da';
    dom['da-threshold-controls']?.classList.toggle('hidden', !isDaMode);
    render2DHeatmap();
    });

    dom['da-threshold-slider']?.addEventListener('input', (e) => {
        const val = e.target.value;
        if (dom['da-threshold-val']) {
            dom['da-threshold-val'].textContent = `${val} lux`;
        }
        render2DHeatmap();
    });

    function updateResultsAnalysisPanel() {
        const stats = resultsManager.stats;
        dom['stats-min-val'].textContent = stats.min.toFixed(1);
        dom['stats-max-val'].textContent = stats.max.toFixed(1);
        dom['stats-avg-val'].textContent = stats.avg.toFixed(1);
        const uniformity = stats.min > 0 ? (stats.min / stats.avg).toFixed(2) : 'N/A';
        dom['stats-uniformity-val'].textContent = uniformity;

        // Show/hide heatmap mode controls based on annual data availability
        const hasAnnual = resultsManager.hasAnnualData(resultsManager.activeView);
        const heatmapControls = dom['heatmap-controls-container'];
        if (heatmapControls) {
            heatmapControls.classList.toggle('hidden', !hasAnnual);
            // Reset to illuminance mode if annual data is not available or cleared
            if (!hasAnnual) {
                dom['heatmap-mode-selector'].value = 'illuminance';
                dom['da-threshold-controls'].classList.add('hidden');
            } else {
                // Ensure DA controls are visible/hidden based on current selection
                const isDaMode = dom['heatmap-mode-selector'].value === 'da';
                dom['da-threshold-controls']?.classList.toggle('hidden', !isDaMode);
            }
        }

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
async function render2DHeatmap() {
    const canvas = dom['heatmap-canvas'];
    const sensorGroup = scene.getObjectByName('sensorPoints');
    if (!canvas || !sensorGroup) {
    return;
    }

    // Determine which data to render based on the heatmap mode selector
    const mode = dom['heatmap-mode-selector']?.value || 'illuminance';
    let heatmapData;

    if (mode === 'da' && resultsManager.hasAnnualData(resultsManager.activeView)) {
    const threshold = parseFloat(dom['da-threshold-slider'].value);
    heatmapData = await resultsManager.calculateDaylightAutonomy(threshold);
    } else {
    heatmapData = resultsManager.getActiveData();
    }

    if (!heatmapData || heatmapData.length === 0) {
    const ctxClear = canvas.getContext('2d');
    ctxClear.clearRect(0, 0, canvas.width, canvas.height);
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
                value: heatmapData[dataIndex]
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

        const color = (mode === 'da')
            ? resultsManager.getColorForValue(point.value, 0, 100)
            : resultsManager.getColorForValue(point.value);

        ctx.fillStyle = color;
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
    sensorTransformControls.addEventListener('dragging-changed', (event) => {
        // Only update the UI when the user has finished dragging the gizmo.
        if (event.value === false) {
            if (!sensorTransformControls.object) return;

            const controlledObject = sensorTransformControls.object;
            const isSensor1 = controlledObject.name === 'daylightingSensor1';
            const isSensor2 = controlledObject.name === 'daylightingSensor2';

            if (!isSensor1 && !isSensor2) return;

            const W = parseFloat(dom.width.value);
            const L = parseFloat(dom.length.value);
            const sensorIndex = isSensor1 ? 1 : 2;
            const finalPosition = controlledObject.position;

            // Convert from the scene's corner-based coordinate system to the slider's center-based system.
            const sliderX = finalPosition.x - W / 2;
            const sliderZ = finalPosition.z - L / 2;

            // Update the slider values with the final position.
            if (dom[`daylight-sensor${sensorIndex}-x`]) dom[`daylight-sensor${sensorIndex}-x`].value = sliderX.toFixed(2);
            if (dom[`daylight-sensor${sensorIndex}-y`]) dom[`daylight-sensor${sensorIndex}-y`].value = finalPosition.y.toFixed(2);
            if (dom[`daylight-sensor${sensorIndex}-z`]) dom[`daylight-sensor${sensorIndex}-z`].value = sliderZ.toFixed(2);

            // Manually update the text labels next to the sliders.
            updateAllLabels();

            // Programmatically trigger an 'input' event on one of the sliders.
            // This is crucial to notify the rest of the application (e.g., updateScene) of the change.
            if (dom[`daylight-sensor${sensorIndex}-x`]) {
                dom[`daylight-sensor${sensorIndex}-x`].dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
    });

    promptForProjectDirectory();

    // Defer initial state settings until the 3D scene is fully initialized.
    dom['render-container'].addEventListener('sceneReady', () => {
        // Set the camera helper's visibility based on the default checkbox state.
        setGizmoVisibility(dom['gizmo-toggle'].checked);
        }, { once: true }); // The event should only fire once.

        // --- AI Settings Modal ---
        _setupAiSettingsModal();

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
    dom['view-bsdf-btn']?.addEventListener('click', openBsdfViewer);

    // --- Saved Views Listeners ---
    setupContextControls();
    dom['save-view-btn']?.addEventListener('click', saveCurrentView);
    dom['saved-views-list']?.addEventListener('click', (e) => {
        const target = e.target;
        const viewItem = target.closest('.saved-view-item');
        const deleteBtn = target.closest('.delete-view-btn');

        if (deleteBtn && viewItem && viewItem.dataset.index) {
            e.stopPropagation(); // Prevent applying view when deleting
            deleteSavedView(parseInt(viewItem.dataset.index, 10));
        } else if (viewItem && viewItem.dataset.index) {
            applySavedView(parseInt(viewItem.dataset.index, 10));
        }
    });
}

// --- UI LOGIC & EVENT HANDLERS ---

/**
* Populates and shows the 3D view metric selector based on available spectral data.
* @param {object} spectralData - The spectral results object from the results manager.
*/
function updateMetricSelector(spectralData) {
    const selector = dom['metric-selector'];
    const container = dom['metric-selector-container'];
    if (!selector || !container) return;

    selector.innerHTML = '';

    const metricMap = {
        'illuminance': 'Illuminance (lux)',
        'Photopic_lux': 'Photopic Illuminance (lux)',
        'EML': 'Equivalent Melanopic Lux (EML)',
        'CS': 'Circadian Stimulus (CS)',
        'CCT': 'Correlated Color Temperature (CCT)'
    };

    for (const key in spectralData) {
    if (metricMap[key]) {
    const option = document.createElement('option');
        option.value = key;
        option.textContent = metricMap[key];
        selector.appendChild(option);
        }
    }

    if (selector.options.length > 0) {
        container.classList.remove('hidden');
        selector.value = resultsManager.activeMetricType || 'illuminance';
    } else {
        container.classList.add('hidden');
    }
}

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

        // Force re-initialization by removing the flag
        delete panel.dataset.controlsInitialized;

        initializePanelControls(panel);

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

// --- Delegated Event Listeners for All Floating Panels ---
    document.body.addEventListener('click', (e) => {
        const collapseBtn = e.target.closest('.collapse-icon');
        if (collapseBtn) {
            const win = collapseBtn.closest('.floating-window');
            if (win) {
                e.stopPropagation();
                handlePanelCollapse(win);
                return; // Stop further processing
            }
        }

        const maxBtn = e.target.closest('.window-icon-max');
        if (maxBtn) {
            const win = maxBtn.closest('.floating-window');
            if (win) {
                e.stopPropagation();
                handlePanelMaximize(win);
                return; // Stop further processing
            }
        }
    });

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
        'toggle-panel-viewpoint-btn': 'panel-viewpoint',
        'toggle-panel-scene-btn': 'panel-scene-elements',
        'info-button': 'panel-info',
        'ai-assistant-button': 'panel-ai-assistant'
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
    const content = win.querySelector('.window-content');
    const resizeHandles = win.querySelectorAll('.resize-handle-edge, .resize-handle-corner');
    const closeIcon = win.querySelector('.window-icon-close');
    const maxIcon = win.querySelector('.window-icon-max');

    // Bring to front on click
    win.addEventListener('mousedown', () => { maxZ++; win.style.zIndex = maxZ; }, true);

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
                    'panel-scene-elements': 'toggle-panel-scene-btn',
                    'panel-info': 'info-button',
                    'panel-ai-assistant': 'ai-assistant-button'
                };
                const btnId = panelMap[win.id];
                if (btnId && dom[btnId]) {
                    dom[btnId].classList.remove('active');
                }
            }
        });
    }

    if (header) makeDraggable(win, header);




    if (resizeHandles.length > 0) makeResizable(win, resizeHandles);

    win.dataset.controlsInitialized = 'true';
}

/**
 * Handles the logic for minimizing (collapsing) and expanding a floating panel.
 * @param {HTMLElement} win The floating window element.
 */
function handlePanelCollapse(win) {
    const header = win.querySelector('.window-header');
    const content = win.querySelector('.window-content');
    const resizeHandles = win.querySelectorAll('.resize-handle-edge, .resize-handle-corner');
    if (!header || !content) return;

    const isCollapsed = win.classList.contains('collapsed');

    if (isCollapsed) {
        // ACTION: EXPAND (UN-MINIMIZE)
        win.classList.remove('collapsed');
        content.style.display = '';
        resizeHandles.forEach(h => h.style.display = '');
        win.style.height = win.dataset.preCollapseHeight || '';
        win.style.minHeight = win.dataset.preCollapseMinHeight || '';
        if (win.id === 'panel-project' && map) {
            setTimeout(() => map.invalidateSize(), 10);
        }
    } else {
        // ACTION: COLLAPSE (MINIMIZE)
        win.dataset.preCollapseHeight = getComputedStyle(win).height;
        win.dataset.preCollapseMinHeight = win.style.minHeight;

        win.classList.add('collapsed');
        content.style.display = 'none';
        resizeHandles.forEach(h => h.style.display = 'none');
        win.style.height = `${header.offsetHeight}px`;
        win.style.minHeight = '0px';
    }
}

/**
 * Handles the logic for maximizing and restoring a floating panel.
 * @param {HTMLElement} win The floating window element.
 */
function handlePanelMaximize(win) {
    const container = document.getElementById('window-container');
    if (!container) return;

    const isMaximized = win.classList.contains('maximized');

    if (isMaximized) {
        // --- ACTION: RESTORE ---
        if (win.classList.contains('collapsed')) {
            win.classList.remove('collapsed');
            win.querySelector('.window-content').style.display = '';
            win.querySelectorAll('.resize-handle-edge, .resize-handle-corner').forEach(h => h.style.display = '');
        }

        win.classList.remove('maximized');
        win.style.width = win.dataset.oldWidth || '';
        win.style.height = win.dataset.oldHeight || '';
        win.style.transform = win.dataset.oldTransform || '';
        win.style.minHeight = win.dataset.oldMinHeight || '';

    } else {
        // --- ACTION: MAXIMIZE ---
        if (win.classList.contains('collapsed')) {
            handlePanelCollapse(win); // Un-collapse it first
        }

        const computedStyle = getComputedStyle(win);
        win.dataset.oldWidth = computedStyle.width;
        win.dataset.oldHeight = computedStyle.height;
        win.dataset.oldTransform = win.style.transform;
        win.dataset.oldMinHeight = win.style.minHeight;

        win.classList.add('maximized');

        const newWidth = container.clientWidth / 2;
        const newHeight = container.clientHeight * 0.9;
        const newX = container.clientWidth - newWidth;
        const newY = 0;

        win.style.width = `${newWidth}px`;
        win.style.height = `${newHeight}px`;
        win.style.transform = `translate3d(${newX}px, ${newY}px, 0)`;
    }
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
            
            if (transform === 'none') {
                // If not positioned by transform, use offsetLeft/Top as the starting point.
                // This correctly handles newly created panels positioned by standard CSS.
                xOffset = element.offsetLeft;
                yOffset = element.offsetTop;
            } else {
                // If already transformed, read the position from the matrix.
                const matrix = new DOMMatrix(transform);
                xOffset = matrix.m41;
                yOffset = matrix.m42;
            }
            
            initialX = e.clientX - xOffset; initialY = e.clientY - yOffset;
            controls.enabled = false;
            document.onmouseup = () => { document.onmouseup = null; document.onmousemove = null; controls.enabled = true; };
            document.onmousemove = (e) => {
                e.preventDefault();
                if (element.classList.contains('maximized')) return;

                // Once dragging begins, ensure transform is the sole positioning method going forward.
                if (element.style.top || element.style.left) {
                    element.style.top = '';
                    element.style.left = '';
                }
                
              xOffset = e.clientX - initialX; yOffset = e.clientY - initialY;

            // Constrain the panel within its container using viewport-relative coordinates for robustness
            const container = element.parentElement;
            const containerRect = container.getBoundingClientRect();
            const elementWidth = element.offsetWidth;
            const elementHeight = element.offsetHeight;

            // The desired 'left' position of the element in viewport coordinates is containerRect.left + xOffset
            // We clamp this desired viewport position to stay within the container's bounds.
            const minLeftEdge = containerRect.left;
            const maxLeftEdge = containerRect.right - elementWidth;
            const desiredLeftEdge = containerRect.left + xOffset;
            const clampedLeftEdge = Math.max(minLeftEdge, Math.min(desiredLeftEdge, maxLeftEdge));

            // Convert the clamped viewport position back to a transform value (relative to the container)
            const finalX = clampedLeftEdge - containerRect.left;

            // For vertical clamping, we can still use the simpler method against the viewport height
            const clampedY = Math.max(0, Math.min(yOffset, window.innerHeight - elementHeight));

            element.style.transform = `translate3d(${finalX}px, ${clampedY}px, 0)`;
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

                // Constrain position within the container
                const container = element.parentElement;
                const maxX = container.clientWidth - newWidth;
                const maxY = window.innerHeight - newHeight;

                newLeft = Math.max(0, Math.min(newLeft, maxX));
                newTop = Math.max(0, Math.min(newTop, maxY));

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
                
                // Also parse the file for climate analysis
                await resultsManager.loadAndProcessFile(file, 'a');
                dom['climate-analysis-controls']?.classList.remove('hidden');

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

                    _updateLivePreviewVisibility();

                    // Trigger proactive suggestion for annual analysis
                    const { triggerProactiveSuggestion } = await import('./ai-assistant.js');
                    triggerProactiveSuggestion('epw_loaded');

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
    console.log(`setCameraView called with view: ${view}`);

    // Validate inputs
    if (!dom.width || !dom.length || !dom.height || !dom['room-orientation']) {
        console.error('Missing required DOM elements for camera positioning');
        showAlert('Room dimensions not properly set. Please check the Dimensions panel.', 'Error');
        return;
    }

    const W = parseFloat(dom.width.value);
    const L = parseFloat(dom.length.value);
    const H = parseFloat(dom.height.value);

    console.log(`Room dimensions: W=${W}, L=${L}, H=${H}`);

    // Validate room dimensions
    if (isNaN(W) || isNaN(L) || isNaN(H) || W <= 0 || L <= 0 || H <= 0) {
        console.error(`Invalid room dimensions: W=${W}, L=${L}, H=${H}`);
        showAlert('Invalid room dimensions. Please check the Dimensions panel.', 'Error');
        return;
    }

    // Check if controls are available
    if (!controls) {
        console.error('Controls not initialized');
        showAlert('3D scene not ready. Please wait for the scene to load.', 'Error');
        return;
    }

    try {
        // Exit FPV if active
        if (sceneIsFPV) {
            console.log('Exiting FPV mode');
            sceneToggleFPV(dom['view-type'].value);
        }

        controls.enabled = true;
        console.log('Controls enabled');

        const rotationY = THREE.MathUtils.degToRad(parseFloat(dom['room-orientation'].value));
        console.log(`Room rotation: ${rotationY} radians`);

        setProjectionMode(view === 'persp' ? 'perspective' : 'orthographic', false);

        let cameraDistance = Math.max(W, L, H) * 2.5; // Adjusted distance for a better fit
        console.log(`Camera distance: ${cameraDistance}`);

        let position;

        // Reset camera's UP vector for standard views before calculating new orientation
        activeCamera.up.set(0, 1, 0);

        switch (view) {
            case 'top':
                position = new THREE.Vector3(0, cameraDistance, 0);
                // For a top-down view, the "up" direction for the camera must be redefined
                // to be towards the back of the scene (-Z in local camera space).
                activeCamera.up.set(0, 0, -1);
                console.log('Set to top view');
                break;
            case 'front':
                position = new THREE.Vector3(0, 0, cameraDistance);
                console.log('Set to front view');
                break;
            case 'back':
                position = new THREE.Vector3(0, 0, -cameraDistance);
                console.log('Set to back view');
                break;
            case 'left':
                position = new THREE.Vector3(-cameraDistance, 0, 0);
                console.log('Set to left view');
                break;
            case 'right':
                position = new THREE.Vector3(cameraDistance, 0, 0);
                console.log('Set to right view');
                break;
            default: // 'persp' and 'ortho' general views
                position = new THREE.Vector3(cameraDistance * 0.7, cameraDistance * 0.7, cameraDistance * 0.7);
                console.log('Set to perspective/ortho view');
                break;
        }

        // Rotate both the camera position and its 'up' vector by the room's orientation
        const rotationQuaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotationY);
        position.applyQuaternion(rotationQuaternion);
        activeCamera.up.applyQuaternion(rotationQuaternion);

        const worldCenter = new THREE.Vector3(0, H / 2, 0);
        activeCamera.position.copy(worldCenter).add(position);
        controls.target.copy(worldCenter);

        console.log(`Camera position: ${activeCamera.position.x.toFixed(2)}, ${activeCamera.position.y.toFixed(2)}, ${activeCamera.position.z.toFixed(2)}`);
        console.log(`Camera target: ${controls.target.x.toFixed(2)}, ${controls.target.y.toFixed(2)}, ${controls.target.z.toFixed(2)}`);

        if (activeCamera.isOrthographicCamera) {
            activeCamera.zoom = (1 / Math.max(W, L, H)) * 5;
            activeCamera.updateProjectionMatrix();
            console.log(`Orthographic camera zoom: ${activeCamera.zoom}`);
        }

        controls.update();
        console.log('Controls updated successfully');

        // Update button states
        document.querySelectorAll('#view-controls .btn').forEach(b => b.classList.remove('active'));
        const targetButton = dom[`view-btn-${view}`];
        if (targetButton) {
            targetButton.classList.add('active');
            console.log(`Activated button: view-btn-${view}`);
        } else {
            console.warn(`Button not found: view-btn-${view}`);
        }

        console.log(`setCameraView completed successfully for view: ${view}`);
    } catch (error) {
        console.error('Error in setCameraView:', error);
        showAlert(`Error changing view: ${error.message}`, 'Error');
    }
}

async function handleInputChange(e) {
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

    // Add specific handler for viewpoint sliders to update the gizmo in real-time
    if (id.startsWith('view-pos-') || id.startsWith('view-dir-') || id === 'view-fov' || id === 'view-dist') {
        updateViewpointFromSliders();
    }

    // Check for unrealistic reflectance values, but only suggest once per session.
    if (id.includes('-refl') && !suggestionMemory.has('unrealistic_reflectance')) {
        const numVal = parseFloat(val);
        if (numVal < 0.1 || numVal > 0.85) {
            const { triggerProactiveSuggestion } = await import('./ai-assistant.js');
            triggerProactiveSuggestion('unrealistic_reflectance');
            suggestionMemory.add('unrealistic_reflectance'); // Remember we've shown this
        }
    }

    // Check for low ambient bounces in any recipe panel
    const qualityPresetPanel = e.target.closest('.floating-window');
    if (qualityPresetPanel && id.startsWith('ab') && !suggestionMemory.has('low_ambient_bounces')) {
        if (parseInt(val, 10) < 2) {
            const { triggerProactiveSuggestion } = await import('./ai-assistant.js');
            triggerProactiveSuggestion('low_ambient_bounces');
            suggestionMemory.add('low_ambient_bounces');
        }
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
    { test: (id) => id.includes('refl') || id.includes('spec') || id.includes('trans') || id.includes('rough') || id.startsWith('view-dir') || id.includes('-percent'), format: (num) => num.toFixed(2) },
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
            if ((id.includes('width') || id.includes('length') || id.includes('height') || id.includes('dist') || id.includes('thick') || id.includes('depth') || id.includes('extension') || id.includes('sep') || id.includes('offset') || id.includes('spacing') || id.startsWith('view-pos') || id.startsWith('daylight-sensor')) && !id.includes('-percent')) unit = 'm';
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
    if (dom['h-section-dist']) dom['h-section-dist'].max = H;
    if (dom['v-section-dist']) dom['v-section-dist'].max = W;

    // Set constraints for POSITION (vp) sliders to keep the camera inside the room
    if (dom['view-pos-x']) {
        dom['view-pos-x'].min = 0;
        dom['view-pos-x'].max = W;
    }
    if (dom['view-pos-y']) {
        dom['view-pos-y'].min = 0;
        dom['view-pos-y'].max = H;
    }
    if (dom['view-pos-z']) {
        dom['view-pos-z'].min = 0;
        dom['view-pos-z'].max = L;
    }

    // Set constraints for TARGET (vd) sliders to represent a unit vector component
    ['view-dir-x', 'view-dir-y', 'view-dir-z'].forEach(id => {
        if (dom[id]) {
            dom[id].min = -1;
            dom[id].max = 1;
            dom[id].step = 0.01;
        }
    });

    // Set constraints for Daylighting Sensor sliders using a centered coordinate system
    for (let i = 1; i <= 2; i++) {
        if (dom[`daylight-sensor${i}-x`]) {
            dom[`daylight-sensor${i}-x`].min = -W / 2;
            dom[`daylight-sensor${i}-x`].max = W / 2;
        }
        if (dom[`daylight-sensor${i}-z`]) {
            dom[`daylight-sensor${i}-z`].min = -L / 2;
            dom[`daylight-sensor${i}-z`].max = L / 2;
        }
        if (dom[`daylight-sensor${i}-y`]) dom[`daylight-sensor${i}-y`].max = H;
    }

    // Constrain Task Area to be within room dimensions
    if (dom['task-area-toggle']?.checked) {
        dom['task-area-width'].max = W;
        dom['task-area-depth'].max = L;

        // Ensure width/depth don't exceed max when changed
        if (parseFloat(dom['task-area-width'].value) > W) dom['task-area-width'].value = W;
        if (parseFloat(dom['task-area-depth'].value) > L) dom['task-area-depth'].value = L;

        const taskWidth = parseFloat(dom['task-area-width'].value);
        const taskDepth = parseFloat(dom['task-area-depth'].value);

        dom['task-area-start-x'].max = Math.max(0, W - taskWidth);
        dom['task-area-start-z'].max = Math.max(0, L - taskDepth);

        // Re-validate start positions if a change made the current value invalid
        if (parseFloat(dom['task-area-start-x'].value) > dom['task-area-start-x'].max) {
            dom['task-area-start-x'].value = dom['task-area-start-x'].max;
        }
        if (parseFloat(dom['task-area-start-z'].value) > dom['task-area-start-z'].max) {
            dom['task-area-start-z'].value = dom['task-area-start-z'].max;
        }
    }

    wallDirections.forEach(dir => {
        const wallW = (dir === 'n' || dir === 's') ? W : L;

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
            const {
                wh: wwr_wh
            } = getWindowParamsForWall(dir.toUpperCase());
            wwrSillInput.max = Math.max(0, H - wwr_wh);
            if (parseFloat(wwrSillInput.value) > parseFloat(wwrSillInput.max)) {
                wwrSillInput.value = wwrSillInput.max;
            }
        }

        const overhangDistSlider = dom[`overhang-dist-above-${dir}`];
        if (overhangDistSlider) {
            const {
                wh,
                sh
            } = getWindowParamsForWall(dir.toUpperCase());
            const spaceAboveWindow = H - (sh + wh);
            overhangDistSlider.max = Math.max(0, spaceAboveWindow).toFixed(2);
            if (parseFloat(overhangDistSlider.value) > parseFloat(overhangDistSlider.max)) {
                overhangDistSlider.value = overhangDistSlider.max;
            }
        }

        const winCountInput = dom[`win-count-${dir}`];
        if (winCountInput) {
            const {
                ww: ww_for_count
            } = getWindowParamsForWall(dir.toUpperCase());
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

    // Constrain Lighting Grid parameters to fit within the room
    if (dom['placement-mode-grid']?.classList.contains('active')) {
        const rows = parseInt(dom['grid-rows'].value, 10);
        const cols = parseInt(dom['grid-cols'].value, 10);
        const rowSpacing = parseFloat(dom['grid-row-spacing'].value);
        const colSpacing = parseFloat(dom['grid-col-spacing'].value);

        // Dynamically set the max value for the spacing sliders based on the number of rows/cols
        dom['grid-row-spacing'].max = (rows > 1) ? (L / (rows - 1)).toFixed(2) : L;
        dom['grid-col-spacing'].max = (cols > 1) ? (W / (cols - 1)).toFixed(2) : W;

        // Dynamically set the max value for the row/col sliders based on the spacing
        dom['grid-rows'].max = (rowSpacing > 0) ? Math.floor(L / rowSpacing) + 1 : 50;
        dom['grid-cols'].max = (colSpacing > 0) ? Math.floor(W / colSpacing) + 1 : 50;

        // After updating the max limits, clamp the current values if they are now out of bounds
        if (parseFloat(dom['grid-row-spacing'].value) > parseFloat(dom['grid-row-spacing'].max)) {
            dom['grid-row-spacing'].value = dom['grid-row-spacing'].max;
        }
        if (parseFloat(dom['grid-col-spacing'].value) > parseFloat(dom['grid-col-spacing'].max)) {
            dom['grid-col-spacing'].value = dom['grid-col-spacing'].max;
        }
        if (parseInt(dom['grid-rows'].value, 10) > parseInt(dom['grid-rows'].max, 10)) {
            dom['grid-rows'].value = dom['grid-rows'].max;
        }
        if (parseInt(dom['grid-cols'].value, 10) > parseInt(dom['grid-cols'].max, 10)) {
            dom['grid-cols'].value = dom['grid-cols'].max;
        }
    }

    updateAllLabels();
}

export function getWindowParamsForWall(orientation) {
    const W = parseFloat(dom.width.value), L = parseFloat(dom.length.value), H = parseFloat(dom.height.value);
    const wallWidth = (orientation === 'N' || orientation === 'S') ? W : L;
    const dir = orientation.toLowerCase();
    const winCount = parseInt(dom[`win-count-${dir}`].value);
    const mode = windowModes[dir];
    const winDepthPosId = mode === 'wwr' ? `win-depth-pos-${dir}` : `win-depth-pos-${dir}-manual`;
    const winDepthPos = parseFloat(dom[winDepthPosId]?.value || 0);
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

/**
 * Gathers all sensor grid parameters from the UI into a structured object.
 * @returns {object} An object containing illuminance and view grid parameters.
 */
export function getSensorGridParams() {
    const dom = getDom(); 

    const getFloat = (id, defaultValue = 0) => dom[id] ? parseFloat(dom[id].value) : defaultValue;
    const getInt = (id, defaultValue = 0) => dom[id] ? parseInt(dom[id].value, 10) : defaultValue;
    const getChecked = (id, defaultValue = false) => dom[id] ? dom[id].checked : defaultValue;

    const floorParams = {
        enabled: getChecked('grid-floor-toggle'),
        spacing: getFloat('floor-grid-spacing', 0.5),
        offset: getFloat('floor-grid-offset', 0.8),
        showIn3D: getChecked('show-floor-grid-3d-toggle'),
        isTaskArea: getChecked('task-area-toggle'),
        hasSurrounding: getChecked('surrounding-area-toggle'),
        task: {
            x: getFloat('task-area-start-x'),
            z: getFloat('task-area-start-z'),
            width: getFloat('task-area-width'),
            depth: getFloat('task-area-depth'),
        },
        surroundingWidth: getFloat('surrounding-area-width', 0.5),
    };

    const illuminanceParams = {
        enabled: getChecked('illuminance-grid-toggle'),
        showIn3D: getChecked('show-floor-grid-3d-toggle'),
        floor: floorParams,
        ceiling: {
            enabled: getChecked('grid-ceiling-toggle'),
            spacing: getFloat('ceiling-grid-spacing', 0.5),
            offset: getFloat('ceiling-grid-offset', -0.2),
        },
        walls: {
            enabled: ['north', 'south', 'east', 'west'].some(dir => getChecked(`grid-${dir}-toggle`)),
            spacing: getFloat('wall-grid-spacing', 0.5),
            offset: getFloat('wall-grid-offset', 0.1),
            surfaces: {
                n: getChecked('grid-north-toggle'),
                s: getChecked('grid-south-toggle'),
                e: getChecked('grid-east-toggle'),
                w: getChecked('grid-west-toggle'),
            }
        }
    };

    const viewParams = {
        enabled: getChecked('view-grid-toggle'),
        showIn3D: getChecked('show-view-grid-3d-toggle'),
        spacing: getFloat('view-grid-spacing', 0.75),
        offset: getFloat('view-grid-offset', 1.2),
        numDirs: getInt('view-grid-directions', 6),
        startVec: [
            getFloat('view-grid-start-vec-x', 1),
            getFloat('view-grid-start-vec-y', 0),
            getFloat('view-grid-start-vec-z', 0)
        ]
    };

    return {
        illuminance: illuminanceParams,
        view: viewParams
    };
}

function setProjectionMode(mode, updateViewButtons = true) {
    const isPersp = mode === 'perspective';
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

updateViewpointFromSliders

export function setWindowMode(dir, mode, triggerUpdate = true) {
    windowModes[dir] = mode;
    dom[`mode-wwr-btn-${dir}`].classList.toggle('active', mode === 'wwr');
    dom[`mode-manual-btn-${dir}`].classList.toggle('active', mode !== 'wwr');
    dom[`wwr-controls-${dir}`].classList.toggle('hidden', mode !== 'wwr');
    dom[`manual-controls-${dir}`].classList.toggle('hidden', mode === 'wwr');
    if (triggerUpdate) scheduleUpdate(`mode-${dir}`);
}

function updateGridControls() {
    dom['floor-grid-controls'].classList.toggle('hidden', !dom['grid-floor-toggle'].checked);
    dom['ceiling-grid-controls'].classList.toggle('hidden', !dom['grid-ceiling-toggle'].checked);
    const wallsChecked = ['north', 'south', 'east', 'west'].some(dir => dom[`grid-${dir}-toggle`].checked);
    dom['wall-grid-controls'].classList.toggle('hidden', !wallsChecked);
    scheduleUpdate();
}

export async function handleShadingTypeChange(dir, triggerUpdate = true) {
    const type = dom[`shading-type-${dir}`]?.value;
    if (type === undefined) return;
    ['overhang', 'lightshelf', 'louver', 'roller'].forEach(t => {
        const controlEl = dom[`shading-controls-${t}-${dir}`];
        if (controlEl) controlEl.classList.toggle('hidden', type !== t);
    });

    if (type === 'louver' && !suggestionMemory.has('louver_shading_enabled')) {
        import('./ai-assistant.js').then(({ triggerProactiveSuggestion }) => {
            triggerProactiveSuggestion('louver_shading_enabled');
        });
        suggestionMemory.add('louver_shading_enabled');
    }

    if (scene && triggerUpdate) {
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

    // Update the data table if it's visible
    populateDataTable();

    // Refresh the entire results dashboard to show the correct stats and legends
    updateResultsDashboard();
}

/**
* Sets up the theme switcher functionality for multiple themes.
*/
export function setupThemeSwitcher() {
    const lightBtn = dom['theme-btn-light'];
    const darkBtn = dom['theme-btn-dark'];
    const cyberBtn = dom['theme-btn-cyber'];
    const cafe58Btn = dom['theme-btn-cafe58'];
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
        cafe58Btn.style.display = 'none';

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
        } else if (theme === 'cafe58') {
            cafe58Btn.style.display = 'flex'; // Show cafe58 theme icon
            sceneBgColor = '#E1DEDE';
            mapTilesUrl = lightTilesUrl;
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

        // Update furniture colors to match the new theme
        updateFurnitureColor();

        // Re-render Mermaid diagrams with the new theme
        if (typeof mermaid !== 'undefined' && mermaid.run) {
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
    cyberBtn.addEventListener('click', () => applyTheme('cafe58'));
    cafe58Btn.addEventListener('click', () => applyTheme('light'));

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
export async function clearAllResultsDisplay() {
    // Clear all previous results visualizations from all panels
    if (dom['data-table-btn']) dom['data-table-btn'].classList.add('hidden');
    if (dom['data-table-panel']) dom['data-table-panel'].classList.add('hidden');
    if (dom['data-table-body']) dom['data-table-body'].innerHTML = '';
    if (dom['data-table-head']) dom['data-table-head'].innerHTML = '';
    if (dom['results-dashboard']) dom['results-dashboard'].classList.add('hidden');
    if (dom['glare-analysis-dashboard']) dom['glare-analysis-dashboard'].classList.add('hidden');
    if (dom['view-hdr-btn']) dom['view-hdr-btn'].classList.add('hidden');
    if (dom['annual-glare-controls']) dom['annual-glare-controls'].classList.add('hidden');
    if (dom['glare-rose-panel']) dom['glare-rose-panel'].classList.add('hidden');
    if (dom['results-file-name-a']) dom['results-file-name-a'].textContent = '';
    if (dom['results-file-name-b']) dom['results-file-name-b'].textContent = '';
    if (dom['results-file-input-a']) dom['results-file-input-a'].value = '';
    if (dom['results-file-input-b']) dom['results-file-input-b'].value = '';
    if (dom['generate-report-btn']) dom['generate-report-btn'].classList.add('hidden');

    const { clearAnnualDashboard, clearLightingEnergyDashboard } = await import('./annualDashboard.js');
        clearAnnualDashboard();
        clearTimeSeriesExplorer();
        // NEW: Also clear the lighting energy dashboard
        clearLightingEnergyDashboard();
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
    const lowerFileName = file.name.toLowerCase();
    const isHdrFile = lowerFileName.endsWith('.hdr');
    const isEpwFile = lowerFileName.endsWith('.epw');

    // For EPW files, we only want to load climate data, not clear other results
    if (!isEpwFile) {
        clearAllResultsDisplay();
    }

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
    // Handle .ill, .epw, and other text-based results files
    try {
        const result = await resultsManager.loadAndProcessFile(file, key);
        const loadedKey = result.key;

        // If an EPW was loaded, just show the climate button and stop
        if (result.type === 'climate') {
            if (fileNameDisplay) fileNameDisplay.textContent = file.name;
            dom['climate-analysis-controls']?.classList.remove('hidden');
            return;
        }

        if (resultsManager.hasAnnualData(loadedKey)) {
            const { project } = await import('./project.js');
            const scheduleFile = project.simulationFiles['occupancy-schedule'];
            await resultsManager.calculateLightingMetrics(loadedKey, null, scheduleFile);
      }

        if (fileNameDisplay) fileNameDisplay.textContent = file.name;

        updateSpectralMetricsDashboard(loadedKey); // Update the spectral dashboard

    // After loading, check for annual data to update relevant dashboards
    if (resultsManager.hasAnnualData(loadedKey)) {
        const { updateAnnualMetricsDashboard, updateLightingEnergyDashboard } = await import('./annualDashboard.js');
        const metrics = resultsManager.calculateAnnualMetrics(loadedKey, {});
        const lightingMetrics = resultsManager.datasets[loadedKey].lightingMetrics;
        const energyMetrics = resultsManager.datasets[loadedKey].lightingEnergyMetrics;
        updateAnnualMetricsDashboard(metrics, lightingMetrics);
        if (energyMetrics) {
            updateLightingEnergyDashboard(energyMetrics);
        }
        updateTimeSeriesExplorer();
    } else {
        clearAnnualDashboard();
        clearTimeSeriesExplorer();
    }

    // Check for and update circadian metrics dashboard
    const loadedDataset = resultsManager.datasets[loadedKey];
    if (loadedDataset && loadedDataset.circadianMetrics) {
        const { updateCircadianDashboard } = await import('./annualDashboard.js');
        updateCircadianDashboard(loadedDataset.circadianMetrics);
    }

    // Check for per-point spectral data and populate the metric selector
    if (loadedDataset && loadedDataset.spectralResults && Object.keys(loadedDataset.spectralResults).length > 0) {
        updateMetricSelector(loadedDataset.spectralResults);
    } else {
        dom['metric-selector-container']?.classList.add('hidden');
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

    // Show the data table button and populate the table
    if (dom['data-table-btn']) dom['data-table-btn'].classList.remove('hidden');
        currentSort = { column: 'id', direction: 'asc' }; // Reset sort
        populateDataTable();

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

    if (dom['generate-report-btn']) {
        dom['generate-report-btn'].classList.remove('hidden');
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

export function updateViewpointFromSliders() {
    // If the camera is currently being updated by the gizmo-to-slider sync,
    // don't process this slider input to prevent a feedback loop.
    if (isUpdatingCameraFromSliders) {
        return;
    }

    const params = {
        W: parseFloat(dom.width.value),
        L: parseFloat(dom.length.value),
        vpx: parseFloat(dom['view-pos-x'].value),
        vpy: parseFloat(dom['view-pos-y'].value),
        vpz: parseFloat(dom['view-pos-z'].value),
        vdx: parseFloat(dom['view-dir-x'].value),
        vdy: parseFloat(dom['view-dir-y'].value),
        vdz: parseFloat(dom['view-dir-z'].value),
        fov: parseFloat(dom['view-fov'].value),
        dist: parseFloat(dom['view-dist'].value)
    };

    // Set a flag to prevent the 'objectChange' listener from firing a UI update event.
    setUpdatingFromSliders(true);

    // Call the function from scene.js to update the 3D view
    updateViewpointFromUI(params);

    // Unset the flag after a short delay. This allows the gizmo to resume updating the UI.
    requestAnimationFrame(() => {
        setUpdatingFromSliders(false);
    });
}

/**
* Handles clicks on the 3D scene to detect clicks on sensor points.
* @param {MouseEvent} event The click event.
*/
async function onSensorClick(event) {
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

    const intersects = raycaster.intersectObjects(sensorMeshes, true);

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
            const { openTemporalMapForPoint } = await import('./annualDashboard.js');
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
    const activeData = resultsManager.getActiveData();
    if (!activeData || activeData.length === 0) {
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
 * This ensures the change is registered by the application's event listeners.
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
    // This is crucial for keeping the UI and 3D scene state synchronized.
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

    // 1. Calculate the new camera position in world coordinates
    const newCameraPosWorld = new THREE.Vector3(worldPoint.x, worldPoint.y + 0.4, worldPoint.z);

    // 2. Calculate the target in world coordinates
    const roomCenterWorld = new THREE.Vector3(0, roomH / 2, 0);

    // 3. Calculate the new direction vector in world space
    const newWorldDirection = new THREE.Vector3().subVectors(roomCenterWorld, newCameraPosWorld).normalize();

    // 4. ***FIX***: Convert the new WORLD direction to LOCAL direction to match what the sliders expect
    const inverseRoomQuaternion = roomObject.quaternion.clone().invert();
    const newLocalDirection = newWorldDirection.clone().applyQuaternion(inverseRoomQuaternion);

    // 5. Convert the new camera world position to slider coordinates (corner-based)
    const newCameraPosSlider = {
        x: newCameraPosWorld.x + roomW / 2,
        y: newCameraPosWorld.y,
        z: newCameraPosWorld.z + roomL / 2
    };

    // 6. Update the UI sliders with the corrected local-space values
    _updateViewpointSliderAndDispatch('view-pos-x', newCameraPosSlider.x);
    _updateViewpointSliderAndDispatch('view-pos-y', newCameraPosSlider.y);
    _updateViewpointSliderAndDispatch('view-pos-z', newCameraPosSlider.z);

    _updateViewpointSliderAndDispatch('view-dir-x', newLocalDirection.x);
    _updateViewpointSliderAndDispatch('view-dir-y', newLocalDirection.y);
    _updateViewpointSliderAndDispatch('view-dir-z', newLocalDirection.z);

    // 7. Ensure the viewpoint panel is visible so the user sees the changes
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
* Handles a click on the main renderer canvas to select/deselect walls or furniture.
* @param {MouseEvent} event The click event.
*/
function onSceneClick(event) {
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

    const objectsToIntersect = [wallSelectionGroup, furnitureObject, contextObject];
    const intersects = raycaster.intersectObjects(objectsToIntersect, true);

    const wallIntersect = intersects.find(i => i.object.userData.isSelectableWall === true);
    const furnitureIntersect = intersects.find(i => i.object.userData.isFurniture === true);
    const massingIntersect = intersects.find(i => i.object.userData.isMassingBlock === true);

    if (furnitureIntersect) {
        selectTransformableObject(furnitureIntersect.object);
    } else if (massingIntersect) {
        selectTransformableObject(massingIntersect.object);
    } else if (wallIntersect) {
        transformControls.detach(); // Detach from any other object
        handleWallInteraction(wallIntersect);
    } else {
        handleDeselection();
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
* Handles the logic for selecting any transformable object (furniture, massing block) and attaching the gizmo.
 * @param {THREE.Object3D} object The object that was clicked.
 */
function selectTransformableObject(object) {
    handleWallDeselection(); // Deselect any walls first
    transformControls.attach(object);
    dom['transform-controls-section']?.classList.remove('hidden');
    _updateTransformSlidersFromObject(object);

    // If it's a massing block, also update the massing creation panel
    if (object.userData.isMassingBlock) {
        const data = object.userData;

        // Set shape radio button and update UI accordingly
        const shapeRadio = document.querySelector(`input[name="massing-shape"][value="${data.shape}"]`);
        if (shapeRadio) {
            shapeRadio.checked = true;
            handleMassingShapeChange();
        }

        // Populate dimension sliders from the object's properties
        if (data.shape === 'box') {
            _setValueAndLabel('massing-width', data.width, 'm');
            _setValueAndLabel('massing-depth', data.depth, 'm');
            _setValueAndLabel('massing-height', data.height, 'm');
        } else {
            _setValueAndLabel('massing-radius', data.radius, 'm');
            _setValueAndLabel('massing-height', data.height, 'm');
        }

        // Populate position sliders
        _setValueAndLabel('massing-pos-x', object.position.x, 'm');
        _setValueAndLabel('massing-pos-y', object.position.y, 'm');
        _setValueAndLabel('massing-pos-z', object.position.z, 'm');
    }
}

/**
 * Handles clicks specifically on walls.
 * @param {object} wallIntersect The intersection object from the raycaster.
 */
function handleWallInteraction(wallIntersect) {
    let targetGroup = wallIntersect.object.parent;
    while (targetGroup && !targetGroup.userData.canonicalId) {
        targetGroup = targetGroup.parent;
    }
    if (!targetGroup) return;

    const newWallId = targetGroup.userData.canonicalId;

    if (isWallSelectionLocked) {
        if (newWallId === selectedWallId) {
            isWallSelectionLocked = false;
            updateLockIcon();
        }
    } else {
        if (newWallId !== selectedWallId) {
            handleWallSelection(targetGroup, true);
        }
    }
}

/**
 * Manages deselection of any selected object (walls or furniture).
 */
function handleDeselection() {
    handleWallDeselection();
    transformControls.detach();
    dom['transform-controls-section']?.classList.add('hidden');
}

/**
* Shows or hides the live preview section based on whether any section cut is active.
* @private
*/
function _updateLivePreviewVisibility() {
    if (!project.epwFileContent) return; // Don't show if no EPW is loaded
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
        const result = await project.runLivePreviewRender();

        if (result && result.hdrPath) {
            const { openHdrViewer } = await import('./hdrViewer.js');

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
* Calculates and updates the Lighting Power Density (LPD) display.
* @private
*/
function _updateLpdDisplay() {
    if (!dom['lpd-display'] || !dom['luminaire-wattage']) return;

    const W = parseFloat(dom.width.value);
    const L = parseFloat(dom.length.value);
    const area = W * L;
    if (area === 0) {
        dom['lpd-display'].textContent = '-- W/m²';
        return;
    }

    const wattage = parseFloat(dom['luminaire-wattage'].value);
    const isGrid = dom['placement-mode-grid']?.classList.contains('active');
    let numLuminaires = 1;
    if (isGrid) {
        const rows = parseInt(dom['grid-rows']?.value, 10) || 1;
        const cols = parseInt(dom['grid-cols']?.value, 10) || 1;
        numLuminaires = rows * cols;
    }

    const totalPower = wattage * numLuminaires;
    const lpd = totalPower / area;
    dom['lpd-display'].textContent = `${lpd.toFixed(2)} W/m²`;
}

/**
 * Sets up event listeners and logic for the AI Assistant settings modal.
 * @private
 */
function _setupAiSettingsModal() {
    const {
        'ai-settings-btn': settingsBtn,
        'ai-settings-modal': modal,
        'ai-settings-close-btn': closeBtn,
        'ai-settings-form': form,
        'ai-provider-select': providerSelect,
        'ai-model-select': modelSelect,
        'ai-api-key-input': apiKeyInput,
        'openrouter-info-box': orInfoBox
    } = dom;

    if (!settingsBtn || !modal || !closeBtn || !form) return;

    const models = {
        gemini: ['gemini-pro', 'gemini-1.5-pro-latest', 'gemini-1.5-flash-latest'],
        openrouter: [
            'google/gemini-pro', 'google/gemini-flash-1.5', 'openai/gpt-4o', 'anthropic/claude-3-haiku'
        ]
    };

    const updateModelList = () => {
        const provider = providerSelect.value;
        modelSelect.innerHTML = '';
        models[provider].forEach(modelName => {
            const option = document.createElement('option');
            option.value = modelName;
            option.textContent = modelName;
            modelSelect.appendChild(option);
        });
        orInfoBox.classList.toggle('hidden', provider !== 'openrouter');
    };

    const openModal = () => {
        updateModelList();
        // Load saved settings from localStorage
        const savedProvider = localStorage.getItem('ai_provider') || 'gemini';
        providerSelect.value = savedProvider;
        updateModelList(); // Update again to set correct list
        modelSelect.value = localStorage.getItem('ai_model') || models[savedProvider][0];
        apiKeyInput.value = localStorage.getItem('ai_api_key') || '';
        modal.classList.replace('hidden', 'flex');
        modal.style.zIndex = getNewZIndex();
    };

    const closeModal = () => modal.classList.replace('flex', 'hidden');

    settingsBtn.addEventListener('click', openModal);
    closeBtn.addEventListener('click', closeModal);
    providerSelect.addEventListener('change', updateModelList);

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        localStorage.setItem('ai_provider', providerSelect.value);
        localStorage.setItem('ai_model', modelSelect.value);
        localStorage.setItem('ai_api_key', apiKeyInput.value);
        showAlert('AI settings saved successfully.', 'Settings Saved');
        closeModal();
    });
}

/**
 * Gathers the current viewpoint parameters and formats them into a Radiance .vf file content string.
 * This version reads directly from the scene's camera object to ensure FPV changes are captured.
 * @param {boolean} [forceFisheye=false] - If true, overrides the UI settings to generate a 180° fisheye view.
 * @returns {string|null} The content for the .vf file or null if view elements are not found.
 */
export function getViewpointFileContent(forceFisheye = false) {
    const dom = getDom();
    if (!viewpointCamera || !roomObject || !dom['view-type'] || !dom['view-fov']) return null;

    // --- Get View Type and FOV from UI ---
    const viewType = forceFisheye ? 'h' : dom['view-type'].value;
    const fov = parseFloat(dom['view-fov'].value);
    const vfov = (viewType === 'h' || viewType === 'a') ? 180 : fov;
    const viewTypeMap = { 'v': '-vtv', 'h': '-vth', 'c': '-vtc', 'l': '-vtl', 'a': '-vta' };
    const radViewType = viewTypeMap[viewType] || '-vtv';

    // --- Get Position and Direction from the 3D Camera Object ---
    // This ensures that movements made in FPV mode are correctly captured.
    
    // 1. Get the camera's world position. Radiance is Z-up, Three.js is Y-up.
    const pos = viewpointCamera.position;
    const rad_vp = `${pos.x.toFixed(4)} ${pos.z.toFixed(4)} ${pos.y.toFixed(4)}`;

    // 2. Get the camera's world direction.
    // The camera looks down its local -Z axis. We get this vector in world space.
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(viewpointCamera.quaternion);
    const rad_vd = `${dir.x.toFixed(4)} ${dir.z.toFixed(4)} ${dir.y.toFixed(4)}`;

    // 3. Get the camera's "up" vector in world space.
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(viewpointCamera.quaternion);
    const rad_vu = `${up.x.toFixed(4)} ${up.z.toFixed(4)} ${up.y.toFixed(4)}`;

    return `${radViewType} -vp ${rad_vp} -vd ${rad_vd} -vu ${rad_vu} -vh ${vfov} -vv ${vfov}`;
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
                    case 'open_glare_rose': {
                        const { openGlareRoseDiagram } = await import('./annualDashboard.js');
                        openGlareRoseDiagram();
                        break;
                    }
                    case 'set_view_fisheye':
                        if (dom['view-type']) {
                            dom['view-type'].value = 'h'; // 'h' is standard fisheye
                            dom['view-type'].dispatchEvent(new Event('change', { bubbles: true }));
                        }
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

/**
* Highlights a single sensor point in the 3D view by its index.
* @param {number | null} index - The index of the sensor point to highlight, or null to clear.
*/
export function highlightSensorByIndex(index) {
    // First, reset all sensor colors to their correct data-driven values
    const activeData = resultsManager.getActiveData();
    if (activeData) {
    updateSensorGridColors(activeData);
    }

    if (index === null || index < 0) return; // Stop if we're just clearing

    let cumulativeIndex = 0;
    for (const mesh of sensorMeshes) {
    if (index < cumulativeIndex + mesh.count) {
        const instanceIndex = index - cumulativeIndex;
        // Apply a unique highlight color (purple) to the selected instance
        mesh.setColorAt(instanceIndex, new THREE.Color(0x9c27b0));
        mesh.instanceColor.needsUpdate = true;
        return; // Exit after highlighting
    }
    cumulativeIndex += mesh.count;
    }
}

/**
* Populates the interactive data table with the currently active results.
* This function handles sorting and rendering the table rows.
*/
function populateDataTable() {
    const tableBody = dom['data-table-body'];
    const tableHead = dom['data-table-head'];
    
    if (!tableBody || !tableHead) return;

    const activeData = resultsManager.getActiveData();
    const activeMetric = resultsManager.activeMetricType;

        if (!activeData || activeData.length === 0) {
        tableHead.innerHTML = '<tr><th>Point ID</th><th>Value</th></tr>';
        tableBody.innerHTML = '<tr><td colspan="2" class="p-4 text-center text-[--text-secondary]">No grid data loaded.</td></tr>';
        return;
        }

        // Map metric keys to user-friendly names for table headers
        const metricMap = {
        'illuminance': 'Illuminance (lux)', 'Photopic_lux': 'Photopic (lux)',
        'EML': 'EML (lux)', 'CS': 'Circadian Stimulus', 'CCT': 'CCT (K)'
        };
        const metricName = metricMap[activeMetric] || activeMetric.replace(/_/g, ' ');

        // Update table headers with sort indicators
        const sortIndicator = (col) => {
        if (currentSort.column === col) {
        return currentSort.direction === 'asc' ? ' ▲' : ' ▼';
        }
            return ' ↕';
        };
        tableHead.innerHTML = `
            <tr>
                <th data-column="id" class="cursor-pointer p-2 hover:bg-[--grid-color]">Point ID${sortIndicator('id')}</th>
                <th data-column="value" class="cursor-pointer p-2 hover:bg-[--grid-color]">${metricName}${sortIndicator('value')}</th>
            </tr>
        `;

        // Create a new array of objects for sorting, preserving original data
        tableData = activeData.map((value, index) => ({ id: index, value: value }));

        // Apply the current sorting
        if (currentSort.column) {
            tableData.sort((a, b) => {
            const valA = a[currentSort.column];
            const valB = b[currentSort.column];
            const direction = currentSort.direction === 'asc' ? 1 : -1;
            if (valA < valB) return -1 * direction;
            if (valA > valB) return 1 * direction;
            return 0;
            });
        }

    // Generate and insert table rows
    tableBody.innerHTML = tableData.map(item => `
        <tr data-point-index="${item.id}" class="hover:bg-[--grid-color] cursor-pointer">
            <td class="p-2">${item.id}</td>
            <td class="p-2">${item.value.toFixed(2)}</td>
        </tr>
    `).join('');

    filterDataTable(); // Re-apply any existing filter
}

// --- START: New functions for Daylighting Zone Visualizer ---

/**
* Updates the zone fraction sliders based on interactions with the 2D canvas.
* @param {number} percent - The new fraction for sensor 1 (0 to 1).
*/
function updateZoneSlidersFromCanvas(percent) {
    const s1 = dom['daylight-sensor1-percent'];
    const s2 = dom['daylight-sensor2-percent'];
    if (!s1 || !s2) return;

    // To prevent event loops, temporarily remove listeners
    const sliders = [s1, s2];
    sliders.forEach(s => s.removeEventListener('input', drawDaylightingZoneVisualizer));

    s1.value = percent.toFixed(2);
    s2.value = (1.0 - percent).toFixed(2);

    // Manually trigger updates for UI labels and the 3D scene
    updateAllLabels();
    // Dispatching the event ensures the LightingManager's own handler is called
    s1.dispatchEvent(new Event('input', { bubbles: true }));

    // Restore listeners
    setTimeout(() => {
        sliders.forEach(s => s.addEventListener('input', drawDaylightingZoneVisualizer));
    }, 0);
}

/**
* Draws the room outline and colored zones on the 2D canvas.
*/
function drawDaylightingZoneVisualizer() {
    if (!zoneCtx || !dom['daylighting-enabled-toggle']?.checked) return;

    const container = dom['daylighting-zone-visualizer-container'];
    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    zoneCanvas.width = rect.width * dpr;
    zoneCanvas.height = rect.height * dpr;
    zoneCtx.scale(dpr, dpr);

    const W = parseFloat(dom.width.value);
    const L = parseFloat(dom.length.value);
    const percent1 = parseFloat(dom['daylight-sensor1-percent'].value);
    const isCols = dom['daylighting-zone-strategy-cols'].classList.contains('active');

    const padding = 10;
    const canvasW = zoneCanvas.clientWidth - padding * 2;
    const canvasH = zoneCanvas.clientHeight - padding * 2;
    const scale = Math.min(canvasW / W, canvasH / L);
    const roomDrawW = W * scale;
    const roomDrawH = L * scale;
    const offsetX = (zoneCanvas.clientWidth - roomDrawW) / 2;
    const offsetY = (zoneCanvas.clientHeight - roomDrawH) / 2;

    zoneCtx.clearRect(0, 0, zoneCanvas.clientWidth, zoneCanvas.clientHeight);

    // Draw zones
    const style = getComputedStyle(document.documentElement);
    const zone1Color = style.getPropertyValue('--zone1-color-viz').trim() || 'rgba(59, 130, 246, 0.5)';
    const zone2Color = style.getPropertyValue('--zone2-color-viz').trim() || 'rgba(22, 163, 74, 0.5)';
    const dividerColor = style.getPropertyValue('--text-primary').trim() || '#ffffff';

    zoneCtx.fillStyle = zone1Color;
    if (isCols) {
        zoneCtx.fillRect(offsetX, offsetY, roomDrawW * percent1, roomDrawH);
    } else {
        zoneCtx.fillRect(offsetX, offsetY, roomDrawW, roomDrawH * percent1);
    }

    zoneCtx.fillStyle = zone2Color;
    if (isCols) {
        zoneCtx.fillRect(offsetX + roomDrawW * percent1, offsetY, roomDrawW * (1 - percent1), roomDrawH);
    } else {
        zoneCtx.fillRect(offsetX, offsetY + roomDrawH * percent1, roomDrawW, roomDrawH * (1 - percent1));
    }

    // Draw room outline
    zoneCtx.strokeStyle = style.getPropertyValue('--text-secondary').trim();
    zoneCtx.lineWidth = 1;
    zoneCtx.strokeRect(offsetX, offsetY, roomDrawW, roomDrawH);

    // Draw divider
    zoneCtx.strokeStyle = dividerColor;
    zoneCtx.lineWidth = 3;
    zoneCtx.beginPath();
    if (isCols) {
        const dividerX = offsetX + roomDrawW * percent1;
        zoneCtx.moveTo(dividerX, offsetY);
        zoneCtx.lineTo(dividerX, offsetY + roomDrawH);
    } else {
        const dividerY = offsetY + roomDrawH * percent1;
        zoneCtx.moveTo(offsetX, dividerY);
        zoneCtx.lineTo(offsetX + roomDrawW, dividerY);
    }
    zoneCtx.stroke();
}

/**
* Handles the mouse down event on the zone canvas to initiate dragging.
*/
function onZoneMouseDown(e) {
    const isCols = dom['daylighting-zone-strategy-cols'].classList.contains('active');
    const W = parseFloat(dom.width.value);
    const L = parseFloat(dom.length.value);
    const percent1 = parseFloat(dom['daylight-sensor1-percent'].value);
    const padding = 10;
    const canvasW = e.target.clientWidth - padding * 2;
    const canvasH = e.target.clientHeight - padding * 2;
    const scale = Math.min(canvasW / W, canvasH / L);
    const roomDrawW = W * scale;
    const roomDrawH = L * scale;
    const offsetX = (e.target.clientWidth - roomDrawW) / 2;
    const offsetY = (e.target.clientHeight - roomDrawH) / 2;

    const dividerPos = isCols ? offsetX + roomDrawW * percent1 : offsetY + roomDrawH * percent1;
    const mousePos = isCols ? e.offsetX : e.offsetY;

    if (Math.abs(mousePos - dividerPos) < 5) { // 5px tolerance for grabbing the divider
        isDraggingZoneDivider = true;
    }
}

/**
* Handles the mouse move event to update the zone divider and cursor style.
*/
function onZoneMouseMove(e) {
    const container = dom['daylighting-zone-visualizer-container'];
    const isCols = dom['daylighting-zone-strategy-cols'].classList.contains('active');
    const W = parseFloat(dom.width.value);
    const L = parseFloat(dom.length.value);
    const percent1 = parseFloat(dom['daylight-sensor1-percent'].value);
    const padding = 10;
    const canvasW = e.target.clientWidth - padding * 2;
    const canvasH = e.target.clientHeight - padding * 2;
    const scale = Math.min(canvasW / W, canvasH / L);
    const roomDrawW = W * scale;
    const roomDrawH = L * scale;
    const offsetX = (e.target.clientWidth - roomDrawW) / 2;
    const offsetY = (e.target.clientHeight - roomDrawH) / 2;

    const dividerPos = isCols ? offsetX + roomDrawW * percent1 : offsetY + roomDrawH * percent1;
    const mousePos = isCols ? e.offsetX : e.offsetY;

    container.style.cursor = Math.abs(mousePos - dividerPos) < 5 ? (isCols ? 'ew-resize' : 'ns-resize') : 'pointer';

    if (!isDraggingZoneDivider) return;

    let newPercent;
    if (isCols) {
        newPercent = (e.offsetX - offsetX) / roomDrawW;
    } else {
        newPercent = (e.offsetY - offsetY) / roomDrawH;
    }
    newPercent = Math.max(0, Math.min(1, newPercent)); // Clamp between 0 and 1

    updateZoneSlidersFromCanvas(newPercent);
    drawDaylightingZoneVisualizer();
}

/**
* Handles the mouse up event to end the drag operation.
*/
function onZoneMouseUp() {
    isDraggingZoneDivider = false;
}

/**
* Sets up all event listeners for the daylighting zone visualizer.
*/
function setupDaylightingZoneVisualizer() {
    zoneCanvas = dom['daylighting-zone-canvas'];
    if (!zoneCanvas) return;
    zoneCtx = zoneCanvas.getContext('2d');

    const inputsToWatch = ['width', 'length', 'daylight-sensor1-percent', 'daylight-sensor2-percent'];
    inputsToWatch.forEach(id => dom[id]?.addEventListener('input', drawDaylightingZoneVisualizer));

    const togglesToWatch = ['daylighting-enabled-toggle', 'daylighting-zone-strategy-rows', 'daylighting-zone-strategy-cols'];
    togglesToWatch.forEach(id => dom[id]?.addEventListener('click', drawDaylightingZoneVisualizer));

    dom['daylight-sensor-count']?.addEventListener('change', drawDaylightingZoneVisualizer);

    zoneCanvas.addEventListener('mousedown', onZoneMouseDown);
    zoneCanvas.addEventListener('mousemove', onZoneMouseMove);
    zoneCanvas.addEventListener('mouseup', onZoneMouseUp);
    zoneCanvas.addEventListener('mouseleave', onZoneMouseUp);

    new ResizeObserver(drawDaylightingZoneVisualizer).observe(dom['daylighting-zone-visualizer-container']);
}

// --- END: New functions for Daylighting Zone Visualizer ---

/**
* Filters the visible rows in the data table based on the filter input field.
*/
function filterDataTable() {
    const input = dom['data-table-filter-input'];
    const tableBody = dom['data-table-body'];
        if (!input || !tableBody) return;

        const filterText = input.value.trim().replace(/\s+/g, '');
        const rows = tableBody.querySelectorAll('tr');

        if (!filterText) {
        rows.forEach(row => row.style.display = '');
        return;
        }

    // Regex to parse operators and values (e.g., >=500, <100)
    const match = filterText.match(/^([<>=!]=?)\s*(-?\d+.?\d*)$/);
        if (!match) {
        rows.forEach(row => row.style.display = ''); // Show all if filter is invalid
        return;
        }

    const operator = match[1];
    const filterValue = parseFloat(match[2]);

    rows.forEach(row => {
    const cell = row.cells[1]; // Value is always in the second column
        if (cell) {
        const cellValue = parseFloat(cell.textContent);
        let show = false;
        switch (operator) {
        case '>':  show = cellValue > filterValue; break;
        case '<':  show = cellValue < filterValue; break;
        case '>=': show = cellValue >= filterValue; break;
        case '<=': show = cellValue <= filterValue; break;
        case '=':
        case '==': show = cellValue === filterValue; break;
        case '!=': show = cellValue !== filterValue; break;
        }
        row.style.display = show ? '' : 'none';
        }
    });
}

/**
* Opens the BSDF viewer panel and triggers parsing and rendering of the BSDF data.
*/
async function openBsdfViewer() {
    const { _parseBsdfXml } = await import('./radiance.js');
    const bsdfFile = project.simulationFiles['bsdf-file'];

    if (!bsdfFile || !bsdfFile.content) {
        showAlert('No BSDF file is loaded into the project.', 'File Not Found');
        return;
    }

    const panel = dom['bsdf-viewer-panel'];
    panel.classList.remove('hidden');
    panel.style.zIndex = getNewZIndex();
    ensureWindowInView(panel);

    // Use cached data if available to avoid re-parsing
    if (!parsedBsdfData) {
        dom['bsdf-info-display'].textContent = 'Parsing XML data...';
        try {
            // Use a timeout to allow the UI to update before a potentially blocking parse
            await new Promise(resolve => setTimeout(resolve, 10));
            parsedBsdfData = _parseBsdfXml(bsdfFile.content);
        } catch (error) {
            console.error("Error parsing BSDF XML:", error);
            showAlert(`Failed to parse BSDF file: ${error.message}`, 'Parsing Error');
            parsedBsdfData = null;
            dom['bsdf-info-display'].textContent = `Error: ${error.message}`;
            return;
        }
    }

    if (!parsedBsdfData || !parsedBsdfData.data.length) {
        showAlert('Could not find valid Klems transmission data in the BSDF file.', 'Data Not Found');
        dom['bsdf-info-display'].textContent = 'No valid Klems transmission data found.';
        return;
    }

    dom['bsdf-info-display'].textContent = `Basis: ${parsedBsdfData.basis}`;
    const select = dom['bsdf-incident-angle-select'];
    select.innerHTML = '';
    parsedBsdfData.data.forEach((incident, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = `Θ=${incident.incoming.theta}°, Φ=${incident.incoming.phi}°`;
        select.appendChild(option);
    });

    select.onchange = () => renderBsdfPlot(parsedBsdfData, select.value);
    
    // Ensure canvas is ready before drawing
    requestAnimationFrame(() => renderBsdfPlot(parsedBsdfData, 0));
}

/**
 * Renders the list of saved camera views in the UI.
 */
function renderSavedViews() {
    const listContainer = dom['saved-views-list'];
    if (!listContainer) return;

    listContainer.innerHTML = ''; // Clear existing list

    if (savedViews.length === 0) {
        listContainer.innerHTML = `<p class="text-xs text-center text-[--text-secondary] py-2">No views saved yet.</p>`;
        return;
    }

    savedViews.forEach((view, index) => {
        const viewElement = document.createElement('div');
        viewElement.className = 'saved-view-item';
        viewElement.dataset.index = index;
        viewElement.innerHTML = `
            <img src="${view.thumbnail}" alt="${view.name}" class="saved-view-thumbnail">
            <span class="saved-view-name">${view.name}</span>
            <button class="delete-view-btn" aria-label="Delete ${view.name}">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
        `;
        listContainer.appendChild(viewElement);
    });
}

/**
 * Captures the current camera view and adds it to the saved views list.
 */
async function saveCurrentView() {
    const { getCameraState, captureSceneSnapshot } = await import('./scene.js');
    const cameraState = getCameraState();
    const thumbnail = captureSceneSnapshot(128); // 128px wide thumbnail

    // Also capture the Radiance-specific view settings from the UI
    cameraState.viewType = dom['view-type'].value;
    cameraState.fov = parseFloat(dom['view-fov'].value);

    savedViews.push({
        name: `View ${savedViews.length + 1}`,
        thumbnail: thumbnail,
        cameraState: cameraState
    });

    renderSavedViews();
}

/**
 * Applies a saved camera view from the list to the main 3D scene.
 * @param {number} index - The index of the view to apply in the savedViews array.
 */
async function applySavedView(index) {
    if (index < 0 || index >= savedViews.length) return;
    const { applyCameraState } = await import('./scene.js');
    const view = savedViews[index];

    // Update the UI controls first to match the saved view
    if (dom['view-type'] && view.cameraState.viewType) {
        dom['view-type'].value = view.cameraState.viewType;
        // This will trigger other UI updates like enabling/disabling the fov slider
        dom['view-type'].dispatchEvent(new Event('change', { bubbles: true })); 
    }
    if (dom['view-fov'] && view.cameraState.fov) {
        dom['view-fov'].value = view.cameraState.fov;
        dom['view-fov'].dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Then apply the camera's physical position and orientation
    applyCameraState(view.cameraState);
}

/**
 * Sets up event listeners and logic for the Context & Site Modeling panel.
 */
async function setupContextControls() {
    const { contextObject, clearContextObjects, updateContextMaterial, createContextFromOsm } = await import('./geometry.js');

    const toggleContextMode = (mode) => {
        dom['osm-controls']?.classList.toggle('hidden', mode !== 'osm');
        dom['massing-controls']?.classList.toggle('hidden', mode !== 'massing');
        dom['topo-controls']?.classList.toggle('hidden', mode !== 'topo');
        dom['context-material-controls']?.classList.toggle('hidden', mode === 'none');

        ['none', 'osm', 'massing', 'topo'].forEach(m => {
            dom[`context-mode-${m}`]?.classList.toggle('active', m === mode);
        });

        if (mode === 'none') {
            transformControls.detach();
            clearContextObjects();
        }
    };

    dom['context-mode-none']?.addEventListener('click', () => toggleContextMode('none'));
    dom['context-mode-osm']?.addEventListener('click', () => toggleContextMode('osm'));
    dom['context-mode-massing']?.addEventListener('click', () => toggleContextMode('massing'));
    dom['context-mode-topo']?.addEventListener('click', () => toggleContextMode('topo'));

    dom['add-massing-block-btn']?.addEventListener('click', async () => {
        const { addMassingBlock } = await import('./geometry.js');
        const newBlock = addMassingBlock();
        selectTransformableObject(newBlock); // Select the new block immediately
    });

    // Enhanced Massing Tools Event Handlers
    setupMassingTools();

    dom['topo-heightmap-file']?.addEventListener('change', (event) => {
        const file = event.target.files[0];
        const display = dom['topo-heightmap-file'].parentElement.querySelector('[data-file-display-for]');
        if (file) {
            project.addSimulationFile('topo-heightmap-file', file.name, file); // Store the Blob
            if (display) display.textContent = file.name;
            scheduleUpdate(); // Trigger a scene update to build the topography
        } else {
            project.addSimulationFile('topo-heightmap-file', null, null);
            if (display) display.textContent = 'No file selected.';
            scheduleUpdate();
        }
    });

    dom['context-visibility-toggle']?.addEventListener('change', (e) => {
        if (contextObject) contextObject.visible = e.target.checked;
    });

    dom['fetch-osm-data-btn']?.addEventListener('click', async () => {
        const btn = dom['fetch-osm-data-btn'];
        btn.textContent = 'Fetching...';
        btn.disabled = true;
        try {
            const lat = parseFloat(dom.latitude.value);
            const lon = parseFloat(dom.longitude.value);
            const radius = parseInt(dom['osm-radius'].value, 10);

            if (isNaN(lat) || isNaN(lon)) {
                showAlert('Please set a valid project latitude and longitude before fetching data.', 'Location Not Set');
                // Automatically open the project panel to guide the user
                togglePanelVisibility('panel-project', 'toggle-panel-project-btn');
                return;
            }

            const query = `
                [out:json][timeout:25];
                (
                    way(around:${radius},${lat},${lon})["building"];
                );
                (._;>;);
                out;
            `;
            const response = await fetch('https://overpass-api.de/api/interpreter', {
                method: 'POST',
                body: query
            });

            if (!response.ok) {
                throw new Error(`API request failed with status ${response.status}`);
            }
            const osmData = await response.json();
            createContextFromOsm(osmData, lat, lon);
            showAlert(`${osmData.elements.filter(e => e.type === 'way').length} buildings loaded.`, 'Context Loaded');

        } catch (error) {
            console.error('Failed to fetch OSM data:', error);
            showAlert(`Error fetching site context: ${error.message}`, 'API Error');
        } finally {
            btn.textContent = 'Fetch Building Data';
            btn.disabled = false;
        }
    });

    ['context-refl', 'context-mat-type'].forEach(id => {
        dom[id]?.addEventListener('input', updateContextMaterial);
    });
}

/**
 * Deletes a saved camera view from the list.
 * @param {number} index - The index of the view to delete from the savedViews array.
 */
function deleteSavedView(index) {
    if (index < 0 || index >= savedViews.length) return;
    savedViews.splice(index, 1);
    // Re-name subsequent views to keep numbering consistent
    savedViews.forEach((view, i) => {
        if (view.name.startsWith('View ')) {
            view.name = `View ${i + 1}`;
        }
    });
    renderSavedViews();
}

/**
 * Loads an array of saved views into the UI state and renders them.
 * @param {Array} views - The array of view objects to load.
 */
export function loadSavedViews(views) {
    savedViews = views || [];
    renderSavedViews();
}

/**
 * Returns the current array of saved views.
 * @returns {Array} The saved views.
 */
export function getSavedViews() {
    return savedViews;
}

/**
* Renders the BSDF transmission data as a polar plot on the canvas.
* @param {object} bsdfData - The parsed BSDF data object.
* @param {number} incidentIndex - The index of the incident angle to display.
*/
function renderBsdfPlot(bsdfData, incidentIndex) {
    const canvas = dom['bsdf-polar-plot-canvas'];
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // High-DPI scaling
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const size = Math.min(rect.width, rect.height);
    const center = { x: rect.width / 2, y: rect.height / 2 };
    const radius = size * 0.45;

    ctx.clearRect(0, 0, rect.width, rect.height);
    const style = getComputedStyle(document.documentElement);
    const gridColor = style.getPropertyValue('--grid-color').trim();
    const textColor = style.getPropertyValue('--text-secondary').trim();

    // Draw polar grid
    ctx.strokeStyle = gridColor;
    ctx.fillStyle = textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '10px Inter';
    for (let i = 1; i <= 3; i++) {
        const r = radius * (i / 3);
        ctx.beginPath();
        ctx.arc(center.x, center.y, r, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.fillText(`${i * 30}°`, center.x, center.y - r - 8);
    }
    for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4;
        ctx.beginPath();
        ctx.moveTo(center.x, center.y);
        ctx.lineTo(center.x + radius * Math.cos(angle), center.y + radius * Math.sin(angle));
        ctx.stroke();
    }

    // Plot data points
    const dataSet = bsdfData.data[incidentIndex]?.transmittance;
    if (!dataSet) return;

    const maxVal = Math.max(...dataSet.map(d => d.value), 0.01);

    dataSet.forEach(point => {
        if (point.value <= 0) return;
        const r = (point.theta / 90) * radius;
        const angleRad = THREE.MathUtils.degToRad(point.phi - 90); // Align 0=top
        const x = center.x + r * Math.cos(angleRad);
        const y = center.y + r * Math.sin(angleRad);

        const intensity = point.value / maxVal;
        const pointRadius = 2 + intensity * 6;
        ctx.fillStyle = `rgba(59, 130, 246, ${0.2 + intensity * 0.8})`;
        ctx.beginPath();
        ctx.arc(x, y, pointRadius, 0, 2 * Math.PI);
        ctx.fill();
    });
}

/**
* Handles the toggling of the Sun Ray Tracing feature within the Aperture panel.
* This function moves the global sun ray tracing controls into the context of the currently selected wall panel and ensures only one toggle can be active at a time.
* @param {Event} event - The change event from the checkbox.
*/
function handleSunRayToggle(event) {
    const sunRaySection = dom['sun-ray-trace-section'];
    if (!sunRaySection) return;

    const checkbox = event.target;
    const dir = checkbox.id.split('-').pop(); // 'n', 's', 'e', or 'w'

    // Uncheck all other sun ray toggles to ensure only one is active
    ['n', 's', 'e', 'w'].forEach(d => {
        if (d !== dir && dom[`sun-ray-tracing-toggle-${d}`]) {
        dom[`sun-ray-tracing-toggle-${d}`].checked = false;
        }
    });

    if (checkbox.checked) {
        // Move the section into the correct parent container and make it visible
        const parentContainer = checkbox.parentElement.parentElement; // The div containing the label
        parentContainer.appendChild(sunRaySection);
        sunRaySection.classList.remove('hidden');
    } else {
        // Just hide the section. It will be moved again if another toggle is activated.
        sunRaySection.classList.add('hidden');
    }
}

/**
* Gathers parameters and initiates the sun ray tracing visualization.
*/
async function handleSunRayTrace() {
if (!project.epwFileContent) {
    showAlert('Please load an EPW weather file in the Project Setup panel before tracing sun rays.', 'Weather Data Missing');
    return;
}

    const btn = dom['trace-sun-rays-btn'];
    const btnSpan = btn.querySelector('span');
    const originalText = btnSpan.textContent;
    btn.disabled = true;
    btnSpan.textContent = 'Tracing...';

try {
// Use a timeout to allow the UI to update to the "Tracing..." state
await new Promise(resolve => setTimeout(resolve, 10));

  const { traceSunRays } = await import('./sunTracer.js');
  const params = {
      epwContent: project.epwFileContent,
      date: dom['sun-ray-date']._flatpickr.selectedDates[0],
      time: dom['sun-ray-time'].value,
      rayCount: parseInt(dom['sun-ray-count'].value, 10),
      maxBounces: parseInt(dom['sun-ray-bounces'].value, 10),
      W: parseFloat(dom.width.value),
      L: parseFloat(dom.length.value),
      H: parseFloat(dom.height.value),
      rotationY: parseFloat(dom['room-orientation'].value)
  };

  traceSunRays(params);
    } catch (error) {
    console.error("Error during sun ray tracing:", error);
    showAlert(`An error occurred: ${error.message}`, 'Error');
    } finally {
    btn.disabled = false;
    btnSpan.textContent = originalText;
    }
}

/**
 * Sets up the drag and drop functionality for the asset library.
 * @private
 */
function _setupAssetLibraryDragDrop() {
    const assetLibrary = dom['asset-library'];
    const renderContainer = dom['render-container'];
    if (!assetLibrary || !renderContainer) return;

    let draggedAssetType = null;

    assetLibrary.addEventListener('dragstart', (e) => {
        const item = e.target.closest('.asset-item');
        if (item && item.dataset.assetType) {
            draggedAssetType = item.dataset.assetType;
            e.dataTransfer.effectAllowed = 'copy';
        }
    });

    renderContainer.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    });

    renderContainer.addEventListener('drop', (e) => {
        e.preventDefault();
        if (!draggedAssetType) return;

        const rect = renderContainer.getBoundingClientRect();
        const pointer = new THREE.Vector2();
        pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(pointer, activeCamera);

        // Intersect with the ground plane to find the drop position
        const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const intersectPoint = new THREE.Vector3();
        raycaster.ray.intersectPlane(groundPlane, intersectPoint);

        if (intersectPoint) {
            addFurniture(draggedAssetType, intersectPoint);
        }
        draggedAssetType = null;
    });
}

/**
* Reads a 3D object's transform properties and populates the UI input fields.
* @param {THREE.Object3D} object The object to read from.
* @private
*/
function _updateTransformSlidersFromObject(object) {
    if (!object) return;

    // Position
    dom['obj-pos-x'].value = object.position.x;
    updateValueLabel(dom['obj-pos-x-val'], object.position.x, 'm', 'obj-pos-x');
    dom['obj-pos-y'].value = object.position.y;
    updateValueLabel(dom['obj-pos-y-val'], object.position.y, 'm', 'obj-pos-y');
    dom['obj-pos-z'].value = object.position.z;
    updateValueLabel(dom['obj-pos-z-val'], object.position.z, 'm', 'obj-pos-z');

    // Rotation (Y-axis only)
    const rotY = THREE.MathUtils.radToDeg(object.rotation.y);
    dom['obj-rot-y'].value = rotY;
    updateValueLabel(dom['obj-rot-y-val'], rotY, '°', 'obj-rot-y');

    // Scale (Uniform, using X-axis as the master)
    const scale = object.scale.x;
    dom['obj-scale-uniform'].value = scale;
    updateValueLabel(dom['obj-scale-uniform-val'], scale, '', 'obj-scale-uniform');
}

/**
* Reads the transform input fields and applies the values to the selected 3D object.
* @private
*/
function _updateObjectFromTransformSliders() {
    const object = transformControls.object;
    if (!object) return;

    // Position
    object.position.set(
        parseFloat(dom['obj-pos-x'].value),
        parseFloat(dom['obj-pos-y'].value),
        parseFloat(dom['obj-pos-z'].value)
    );

    // Rotation (Y-axis only) - Preserve existing X and Z rotation
    object.rotation.y = THREE.MathUtils.degToRad(parseFloat(dom['obj-rot-y'].value));

    // Scale (Uniform)
    const scale = parseFloat(dom['obj-scale-uniform'].value);
    object.scale.set(scale, scale, scale);
}

/**
 * Handles the pointer down event to initiate a resize drag or prepare for a click.
 */
function onPointerDown(event) {
    if (event.button !== 0) return;
    pointerDownPosition.set(event.clientX, event.clientY);

    if (isResizeMode) {
        const pointer = new THREE.Vector2();
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(pointer, activeCamera);
        
        const intersects = raycaster.intersectObjects(resizeHandlesObject.children);

        if (intersects.length > 0) {
            draggedHandle = intersects[0].object;
            intersectionPoint.copy(intersects[0].point);

            initialDimension.width = parseFloat(dom.width.value);
            initialDimension.length = parseFloat(dom.length.value);
            initialDimension.height = parseFloat(dom.height.value);

            const normal = (draggedHandle.userData.axis === 'y') 
                ? activeCamera.getWorldDirection(new THREE.Vector3()).negate() 
                : new THREE.Vector3(0, 1, 0).applyQuaternion(roomObject.quaternion);
            dragPlane.setFromNormalAndCoplanarPoint(normal, intersectionPoint);
            
            controls.enabled = false;
            renderer.domElement.style.cursor = 'move';
        }
    }
}

/**
 * Handles the pointer move event to perform the resize and update the UI.
 */
function onPointerMove(event) {
    if (isResizeMode) {
        updateResizeCursor(event); // Update cursor style on hover
    }
    if (!isResizeMode || !draggedHandle) return;

    const pointer = new THREE.Vector2();
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, activeCamera);

    const newPoint = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(dragPlane, newPoint)) {
        const delta = newPoint.clone().sub(intersectionPoint);
        const roomInverseQuaternion = roomObject.quaternion.clone().invert();
        delta.applyQuaternion(roomInverseQuaternion);

        const handleData = draggedHandle.userData;
        // Update the slider value and its text label directly, but do NOT dispatch the 'input' event.
        // This prevents the scene from being rebuilt on every mouse movement during the drag.
        if (handleData.axis === 'x') {
            const newValue = Math.max(1, initialDimension.width + delta.x * handleData.direction * 2).toFixed(1);
            dom.width.value = newValue;
            updateValueLabel(dom['width-val'], newValue, 'm', 'width');
        } else if (handleData.axis === 'z') {
            const newValue = Math.max(1, initialDimension.length + delta.z * handleData.direction * 2).toFixed(1);
            dom.length.value = newValue;
            updateValueLabel(dom['length-val'], newValue, 'm', 'length');
        } else if (handleData.axis === 'y') {
            const newValue = Math.max(1, initialDimension.height + delta.y * handleData.direction).toFixed(1);
            dom.height.value = newValue;
            updateValueLabel(dom['height-val'], newValue, 'm', 'height');
        }
    }
}

/**
 * Handles the pointer up event to end a resize drag or trigger a scene click action.
 */
function onPointerUp(event) {
    if (draggedHandle) {
        // This was the end of a resize drag.
        // Now, trigger a single scene update to rebuild the geometry with the final dimensions.
        scheduleUpdate();

        draggedHandle = null;
        controls.enabled = true;
        renderer.domElement.style.cursor = 'auto';
        return;
    }

    // Check if the mouse moved significantly. If not, treat it as a click.
    const pointerUpPosition = new THREE.Vector2(event.clientX, event.clientY);
    if (pointerUpPosition.distanceTo(pointerDownPosition) < 5) { // 5-pixel tolerance for a "click"
        handleSceneClick(event);
    }
}

/**
 * Contains the logic for selecting objects in the scene, formerly in onSceneClick.
 */
function handleSceneClick(event) {
    if (transformControls.dragging || sensorTransformControls.dragging || isResizeMode) return;

    const pointer = new THREE.Vector2();
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, activeCamera);

    // Add contextObject to allow selecting massing blocks
    const objectsToIntersect = [wallSelectionGroup, furnitureObject, contextObject];
    const intersects = raycaster.intersectObjects(objectsToIntersect, true);

    const wallIntersect = intersects.find(i => i.object.userData.isSelectableWall === true);
    const furnitureIntersect = intersects.find(i => i.object.userData.isFurniture === true);
    const massingIntersect = intersects.find(i => i.object.userData.isMassingBlock === true);

    if (furnitureIntersect) {
        // Use the generic function to select and attach gizmo
        selectTransformableObject(furnitureIntersect.object);
    } else if (massingIntersect) {
        // New case to handle selecting a massing block
        selectTransformableObject(massingIntersect.object);
    } else if (wallIntersect) {
        transformControls.detach(); // Detach from any other object
        handleWallInteraction(wallIntersect);
    } else {
        handleDeselection();
    }
}

/**
 * Changes the cursor style when hovering over a resize handle.
 */
function updateResizeCursor(event) {
    // Don't do anything if a drag is already in progress
    if (draggedHandle) {
        renderer.domElement.style.cursor = 'move';
        return;
    }

    const pointer = new THREE.Vector2();
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, activeCamera);

    const intersects = raycaster.intersectObjects(resizeHandlesObject.children, false);

    if (intersects.length > 0) {
        const axis = intersects[0].object.userData.axis;
        // Show ns-resize for up/down, and ew-resize for left/right
        renderer.domElement.style.cursor = (axis === 'y' || axis === 'z') ? 'ns-resize' : 'ew-resize';
    } else {
        renderer.domElement.style.cursor = 'auto';
    }
}

export function switchGeometryMode(mode) {
const isParametric = mode === 'parametric';

// Toggle button active state
dom['mode-parametric-btn']?.classList.toggle('active', isParametric);
dom['mode-import-btn']?.classList.toggle('active', !isParametric);

// Toggle panel visibility
dom['parametric-controls']?.classList.toggle('hidden', !isParametric);
dom['import-controls']?.classList.toggle('hidden', isParametric);

// Using an async IIFE to handle the dynamic import
(async () => {
    const { clearImportedModel, roomObject, wallSelectionGroup, shadingObject } = await import('./geometry.js');
    if (!isParametric) {
        // When switching to import mode, hide the parametric geometry
        roomObject.visible = false;
        wallSelectionGroup.visible = false;
        shadingObject.visible = false; // Hide parametric shading too
    } else {
        // When switching back to parametric, restore geometry visibility and clear any imported model.
        clearImportedModel();
        roomObject.visible = true;
        wallSelectionGroup.visible = true;
        shadingObject.visible = true;
        scheduleUpdate(); // Rebuild parametric geometry
    }
})();
}

async function handleModelImport() {
const { loadImportedModel } = await import('./geometry.js');
const fileInput = dom['import-obj-file'];

if (!fileInput || fileInput.files.length === 0) {
    showAlert('Please select an OBJ file to import.', 'No File Selected');
    return;
}

let objFile = null;
let mtlFile = null;

for (const file of fileInput.files) {
    if (file.name.toLowerCase().endsWith('.obj')) {
        objFile = file;
    } else if (file.name.toLowerCase().endsWith('.mtl')) {
        mtlFile = file;
    }
}

if (!objFile) {
    showAlert('An .obj file is required for import.', 'File Missing');
    return;
}

const readAsText = (file) => new Promise((resolve, reject) => {
    if (!file) {
        resolve(null);
        return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(file);
});

try {
    const [objContent, mtlContent] = await Promise.all([
        readAsText(objFile),
        readAsText(mtlFile)
    ]);

    const options = {
        scale: parseFloat(dom['import-scale'].value) || 1.0,
        center: dom['import-center-toggle'].checked
    };

    const materials = await loadImportedModel(objContent, mtlContent, options);

    if (materials.length > 0) {
        openMaterialTagger(materials);
    } else {
        showAlert('Model loaded, but no materials were found to tag. The model will be treated as a single object.', 'No Materials');
    }
} catch (error) {
    console.error("Error importing model:", error);
    showAlert(`Failed to import model: ${error.message}`, 'Import Error');
}
}

function openMaterialTagger(materials) {
const template = document.getElementById('template-material-tagger');
if (!template) return;

// Remove any existing tagger panel
document.getElementById('material-tagger-panel')?.remove();

const taggerPanel = template.content.cloneNode(true).firstElementChild;
taggerPanel.id = 'material-tagger-panel';
document.getElementById('window-container').appendChild(taggerPanel);
initializePanelControls(taggerPanel); // Make it draggable, etc.

const list = taggerPanel.querySelector('#material-tag-list');
const itemTemplate = document.getElementById('template-material-tag-item');

materials.forEach(mat => {
    const item = itemTemplate.content.cloneNode(true).firstElementChild;
    item.querySelector('.material-name').textContent = mat.name;
    const swatch = item.querySelector('.material-swatch');
    if (mat.color) {
        swatch.style.backgroundColor = `#${mat.color.getHexString()}`;
    }
    list.appendChild(item);
});

taggerPanel.querySelector('#finalize-import-btn').addEventListener('click', () => {
    const tagMap = new Map();
    list.querySelectorAll('.material-tag-item').forEach(item => {
        const name = item.querySelector('.material-name').textContent;
        const type = item.querySelector('.surface-type-selector').value;
        tagMap.set(name, type);
    });

    // Apply tags in geometry.js
    import('./geometry.js').then(({ applySurfaceTags }) => {
        applySurfaceTags(tagMap);
        showAlert('Surface types applied successfully.', 'Import Complete');
        taggerPanel.remove();
    });
});

ensureWindowInView(taggerPanel);
}

/**
 * Sets up all event listeners and functionality for the enhanced massing tools.
 * @private
 */
function setupMassingTools() {
    // Shape selection radio buttons
    const shapeRadios = document.querySelectorAll('input[name="massing-shape"]');
    shapeRadios.forEach(radio => {
        radio.addEventListener('change', handleMassingShapeChange);
    });

    // Dimension sliders
    const dimensionSliders = ['massing-width', 'massing-depth', 'massing-height', 'massing-radius'];
    dimensionSliders.forEach(id => {
        const slider = dom[id];
        const label = dom[`${id}-val`];
        if (slider && label) {
            slider.addEventListener('input', () => {
                let unit = 'm';
                updateValueLabel(label, slider.value, unit, id);

                // If a massing block is selected, update it live
                if (transformControls.object && transformControls.object.userData.isMassingBlock) {
                    _updateSelectedMassingBlock();
                } else {
                    updateMassingInfo();
                }
            });
        }
    });

    // Position sliders
    const positionSliders = ['massing-pos-x', 'massing-pos-y', 'massing-pos-z'];
    positionSliders.forEach(id => {
        const slider = dom[id];
        const label = dom[`${id}-val`];
        if (slider && label) {
            slider.addEventListener('input', () => {
                let unit = 'm';
                updateValueLabel(label, slider.value, unit, id);
            });
        }
    });

    // Multiple block controls
    const blockCountSlider = dom['massing-count'];
    const spacingSlider = dom['massing-spacing'];
    if (blockCountSlider) {
        blockCountSlider.addEventListener('input', () => {
            updateValueLabel(dom['massing-count-val'], blockCountSlider.value, '', 'massing-count');
            updateMassingInfo();
        });
    }
    if (spacingSlider) {
        spacingSlider.addEventListener('input', () => {
            updateValueLabel(dom['massing-spacing-val'], spacingSlider.value, 'm', 'massing-spacing');
        });
    }

    // Pattern selection
    const patternRadios = document.querySelectorAll('input[name="massing-pattern"]');
    patternRadios.forEach(radio => {
        radio.addEventListener('change', updateMassingInfo);
    });

    // Main action buttons
    dom['create-massing-blocks-btn']?.addEventListener('click', createMassingBlocks);
    dom['clear-massing-blocks-btn']?.addEventListener('click', clearAllMassingBlocks);

    // Initialize display values
    updateMassingInfo();
}

/**
 * Handles changes to the massing shape selection.
 * Shows/hides radius control based on selected shape.
 * @private
 */
function handleMassingShapeChange() {
    const selectedShape = document.querySelector('input[name="massing-shape"]:checked').value;
    const boxDimensions = dom['box-dimensions'];
    const radiusDimension = dom['radius-dimension'];
    const heightSlider = dom['massing-height'].parentElement.parentElement;

    if (selectedShape === 'box') {
        boxDimensions?.classList.remove('hidden');
        radiusDimension?.classList.add('hidden');
        heightSlider.classList.remove('hidden');
    } else if (selectedShape === 'sphere') {
        boxDimensions?.classList.add('hidden');
        radiusDimension?.classList.remove('hidden');
        heightSlider.classList.add('hidden'); // Height is implicit in sphere radius
    } else { // Cylinder or Pyramid
        boxDimensions?.classList.add('hidden');
        radiusDimension?.classList.remove('hidden');
        heightSlider.classList.remove('hidden');
    }

    updateMassingInfo();
}

/**
 * Updates the massing info display with current settings.
 * @private
 */
function updateMassingInfo() {
    const shape = document.querySelector('input[name="massing-shape"]:checked').value;
    const count = parseInt(dom['massing-count'].value);
    const infoEl = dom['massing-info'];

    if (!infoEl) return;

    // Calculate volume based on shape
    let volume = 0;
    if (shape === 'box') {
        const width = parseFloat(dom['massing-width'].value);
        const depth = parseFloat(dom['massing-depth'].value);
        const height = parseFloat(dom['massing-height'].value);
        volume = width * depth * height;
    } else {
        const radius = parseFloat(dom['massing-radius'].value);
        const height = parseFloat(dom['massing-height'].value);
        if (shape === 'cylinder') {
            volume = Math.PI * radius * radius * height;
        } else if (shape === 'sphere') {
            volume = (4/3) * Math.PI * radius * radius * radius;
        } else if (shape === 'pyramid') {
            // Approximate pyramid volume (cone geometry)
            volume = (1/3) * Math.PI * radius * radius * height;
        }
    }

    const totalVolume = volume * count;

    dom['massing-count-display'].textContent = count;
    dom['massing-volume-display'].textContent = `${totalVolume.toFixed(1)}m³`;
}

/**
 * Creates multiple massing blocks based on current UI settings.
 * @private
 */
async function createMassingBlocks() {
    const shape = document.querySelector('input[name="massing-shape"]:checked').value;
    const count = parseInt(dom['massing-count'].value);
    const spacing = parseFloat(dom['massing-spacing'].value);
    const pattern = document.querySelector('input[name="massing-pattern"]:checked').value;

    const baseParams = {
        shape: shape,
        positionX: parseFloat(dom['massing-pos-x'].value),
        positionY: parseFloat(dom['massing-pos-y'].value),
        positionZ: parseFloat(dom['massing-pos-z'].value)
    };

    // Add shape-specific parameters
    if (shape === 'box') {
        baseParams.width = parseFloat(dom['massing-width'].value);
        baseParams.depth = parseFloat(dom['massing-depth'].value);
        baseParams.height = parseFloat(dom['massing-height'].value);
    } else {
        baseParams.radius = parseFloat(dom['massing-radius'].value);
        baseParams.height = parseFloat(dom['massing-height'].value);
    }

    const { addMassingBlock } = await import('./geometry.js');

    // Create blocks based on pattern
    for (let i = 0; i < count; i++) {
        const params = { ...baseParams };

        // Calculate position based on pattern
        switch (pattern) {
            case 'linear':
                params.positionX += i * spacing;
                break;
            case 'grid':
                const cols = Math.ceil(Math.sqrt(count));
                const row = Math.floor(i / cols);
                const col = i % cols;
                params.positionX += col * spacing;
                params.positionZ += row * spacing;
                break;
            case 'random':
                params.positionX += (Math.random() - 0.5) * spacing * 2;
                params.positionZ += (Math.random() - 0.5) * spacing * 2;
                break;
        }

        params.name = `${shape.charAt(0).toUpperCase() + shape.slice(1)} Block ${i + 1}`;
        addMassingBlock(params);
    }

    showAlert(`${count} ${shape} massing block(s) created successfully.`, 'Blocks Created');
    updateMassingInfo();
}

/**
 * Clears all massing blocks from the scene.
 * @private
 */
async function clearAllMassingBlocks() {
    const { clearContextObjects } = await import('./geometry.js');
    clearContextObjects();
    showAlert('All massing blocks cleared.', 'Blocks Cleared');
    updateMassingInfo();
}

/**
 * Programmatically sets the value of a slider and updates its text label.
 * @param {string} id - The base ID of the slider (e.g., 'massing-width').
 * @param {number} value - The new numeric value for the slider.
 * @param {string} unit - The unit string (e.g., 'm').
 * @private
 */
function _setValueAndLabel(id, value, unit) {
    const slider = dom[id];
    if (!slider) return;
    slider.value = value;
    const label = dom[`${id}-val`];
    if (label) {
        updateValueLabel(label, value, unit, id);
    }
}

/**
 * Updates the geometry and properties of the currently selected massing block.
 * @private
 */
async function _updateSelectedMassingBlock() {
    const object = transformControls.object;
    if (!object || !object.userData.isMassingBlock) return;

    // Update userData first, so it's saved correctly
    const shape = document.querySelector('input[name="massing-shape"]:checked').value;
    object.userData.shape = shape;

    let newGeom;
    if (shape === 'box') {
        const width = parseFloat(dom['massing-width'].value);
        const depth = parseFloat(dom['massing-depth'].value);
        const height = parseFloat(dom['massing-height'].value);
        object.userData.width = width;
        object.userData.depth = depth;
        object.userData.height = height;
        newGeom = new THREE.BoxGeometry(width, height, depth);
        object.position.y = height / 2; // Recenter based on new height
    } else {
        const radius = parseFloat(dom['massing-radius'].value);
        const height = parseFloat(dom['massing-height'].value);
        object.userData.radius = radius;
        object.userData.height = height; // Store height even for sphere for consistency
        if (shape === 'cylinder') {
            newGeom = new THREE.CylinderGeometry(radius, radius, height, 16);
            object.position.y = height / 2;
        } else if (shape === 'pyramid') {
            newGeom = new THREE.ConeGeometry(radius, height, 4);
            object.position.y = height / 2;
        } else if (shape === 'sphere') {
            newGeom = new THREE.SphereGeometry(radius, 16, 12);
            object.position.y = radius; // Sphere origin is center, place it on the ground
        }
    }

    if (newGeom) {
        object.geometry.dispose(); // Dispose old geometry to prevent memory leaks
        object.geometry = newGeom;
    }
    updateMassingInfo();
}

/**
 * Sets up event listeners for the massing shape radio buttons.
 */
function setupMassingShapeListeners() {
    const shapeRadios = document.querySelectorAll('input[name="massing-shape"]');
    shapeRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            handleMassingShapeChange();
            if (transformControls.object && transformControls.object.userData.isMassingBlock) {
                _updateSelectedMassingBlock();
            }
        });
    });
}