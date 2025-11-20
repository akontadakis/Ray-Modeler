// scripts/ui.js

import { getDom } from './dom.js';
import { initSidebar } from './sidebar.js'; // Changed import
// Import bake function from geometry
import { updateScene, axesObject, updateSensorGridColors, roomObject, shadingObject, sensorMeshes, wallSelectionGroup, highlightWall, clearWallHighlights, updateHighlightColor, furnitureObject, addFurniture, updateFurnitureColor, resizeHandlesObject, contextObject, vegetationObject, addImportedAsset, getWallGroupById } from './geometry.js';

import { activeCamera, perspectiveCamera, orthoCamera, setActiveCamera, onWindowResize, controls, transformControls, sensorTransformControls, viewpointCamera, scene, updateLiveViewType, renderer, toggleFirstPersonView as sceneToggleFPV, isFirstPersonView as sceneIsFPV, fpvOrthoCamera, updateViewpointFromUI, setGizmoVisibility, setUpdatingFromSliders, isUpdatingCameraFromSliders, setGizmoMode } from './scene.js';
import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { project } from './project.js';
// The generateAndStoreOccupancyCsv function needs to be available to other modules like project.js
export { generateAndStoreOccupancyCsv, getDom };
import { resultsManager, palettes } from './resultsManager.js';
import * as MESH from '../scripts/scene.js';
import { initHdrViewer, openHdrViewer } from './hdrViewer.js';

// --- SHORTCUTS ---
// Centralized object to define all keyboard shortcut actions
const shortcutActions = {
    // File actions
    'saveProject': () => dom['save-project-button']?.click(),
    'loadProject': () => dom['load-project-button']?.click(),
    'saveView': () => dom['save-view-btn']?.click(),

    // View controls
    'viewPersp': () => setCameraView('persp'),
    'viewOrtho': () => setCameraView('ortho'),
    'viewTop': () => setCameraView('top'),
    'viewFront': () => setCameraView('front'),
    'viewBack': () => setCameraView('back'),
    'viewLeft': () => setCameraView('left'),
    'viewRight': () => setCameraView('right'),

    // Panel toggles
    'toggleProjectPanel': () => togglePanelVisibility('panel-project', 'toggle-panel-project-btn'),
    'toggleDimensionsPanel': () => togglePanelVisibility('panel-dimensions', 'toggle-panel-dimensions-btn'),
    'toggleAperturePanel': () => togglePanelVisibility('panel-aperture', 'toggle-panel-aperture-btn'),
    'toggleLightingPanel': () => togglePanelVisibility('panel-lighting', 'toggle-panel-lighting-btn'),
    'toggleMaterialsPanel': () => togglePanelVisibility('panel-materials', 'toggle-panel-materials-btn'),
    'toggleSensorPanel': () => togglePanelVisibility('panel-sensor', 'toggle-panel-sensor-btn'),
    'toggleViewpointPanel': () => togglePanelVisibility('panel-viewpoint', 'toggle-panel-viewpoint-btn'),
    'toggleScenePanel': () => togglePanelVisibility('panel-scene-elements', 'toggle-panel-scene-btn'),
    'toggleEnergyPlusPanel': () => togglePanelVisibility('panel-energyplus', 'toggle-panel-energyplus-btn'),

    // Other UI toggles
    'toggleInfoPanel': () => togglePanelVisibility('panel-info', 'info-button'),
    'toggleAIAssistant': () => dom['ai-assistant-button']?.click(),
    'openShortcuts': () => openShortcutHelp(),

    // Gizmo modes
    'gizmoTranslate': () => setAndDisplayGizmoMode('translate'),
    'gizmoRotate': () => setAndDisplayGizmoMode('rotate'),
    'gizmoScale': () => setAndDisplayGizmoMode('scale'),

    // Scene Interaction Toggles
    'toggleQuadView': () => dom['view-btn-quad']?.click(),
    'toggleFpv': () => dom['fpv-toggle-btn']?.click(),
    'toggleGizmo': () => dom['gizmo-toggle']?.click(),
    'toggleResizeMode': () => dom['resize-mode-toggle']?.click(),
};

// Default key mappings. This structure makes it easier to add a customization UI later.
const keyMap = {
    'KeyS+Ctrl': 'saveProject',
    'KeyO+Ctrl': 'loadProject',
    'KeyS+Shift': 'saveView',
    'KeyP': 'viewPersp',
    'KeyO': 'viewOrtho',
    'KeyT': 'viewTop',
    'KeyF': 'viewFront',
    'KeyB': 'viewBack',
    'KeyL': 'viewLeft',
    'KeyR': 'viewRight',
    'Digit1': 'toggleProjectPanel',
    'Digit2': 'toggleDimensionsPanel',
    'Digit3': 'toggleAperturePanel',
    'Digit4': 'toggleLightingPanel',
    'Digit5': 'toggleMaterialsPanel',
    'Digit6': 'toggleSensorPanel',
    'Digit7': 'toggleViewpointPanel',
    'Digit8': 'toggleScenePanel',
    'Digit9': 'toggleEnergyPlusPanel',
    'KeyQ': 'toggleQuadView',
    'KeyV': 'toggleFpv',
    'KeyG': 'toggleGizmo',
    'KeyM': 'toggleResizeMode',
};

/**
 * Handles global keydown events for shortcuts.
 * @param {KeyboardEvent} event
 */
function handleKeyDown(event) {
    // Ignore shortcuts if the user is typing in an input field.
    const target = event.target;
    const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
    if (isTyping) return;

    // Special case for '?' key which is more reliable than using event.code
    if (event.key === '?') {
        event.preventDefault();
        shortcutActions['openShortcuts']();
        return;
    }

    // Construct a unique key identifier string (e.g., 'KeyS+Ctrl')
    let keyIdentifier = event.code;
    if (event.ctrlKey) keyIdentifier += '+Ctrl';
    if (event.altKey) keyIdentifier += '+Alt';
    if (event.shiftKey) keyIdentifier += '+Shift';

    const action = keyMap[keyIdentifier];
    if (action && shortcutActions[action]) {
        event.preventDefault(); // Prevent browser default actions (e.g., Ctrl+S saving the page)
        shortcutActions[action]();
    }
}

/**
 * Opens the keyboard shortcut help modal.
 */
function openShortcutHelp() {
    const modal = dom['shortcut-help-modal'];
    if (modal) {
        modal.classList.replace('hidden', 'flex');
        modal.style.zIndex = getNewZIndex();
    }
}

// --- MODULE STATE ---
const dom = getDom(); // Get the cached dom from the new module

let isLeftSidebarDocked = localStorage.getItem('isLeftSidebarDocked') === 'true'; // Load state
let isTopSidebarDocked = localStorage.getItem('isTopSidebarDocked') === 'true'; // Load state for top sidebar

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
    return function (...args) {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };
}

const debouncedScheduleUpdate = debounce(scheduleUpdate, 250); // 250ms delay

const debouncedWindowResize = debounce(() => window.dispatchEvent(new Event('resize')), 100);

let map, tileLayer;
let maxZ = 100;

/**
* Generates an 8760-hour occupancy schedule CSV content based on UI controls
* and stores it in the project's simulation files.
*/
function generateAndStoreOccupancyCsv() {
    const dom = getDom();

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
    const dom = getDom();

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
    const dom = getDom();

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


/**
 * Programmatically sets the shading state (enabled and type) for a specific wall.
 * @param {string} wallDir - The wall direction ('n', 's', 'e', 'w').
 * @param {object} state - An object with { enabled: boolean, type: string }.
 */
export function setShadingState(wallDir, state) {
    const dom = getDom();

    const toggle = dom[`shading-${wallDir}-toggle`];
    const typeSelect = dom[`shading-type-${wallDir}`];

    if (toggle) {
        // Only trigger change if the value is actually different
        if (toggle.checked !== state.enabled) {
            toggle.checked = state.enabled;
            toggle.dispatchEvent(new Event('change', { bubbles: true })); // Trigger listener to show/hide controls
        }
    }
    if (typeSelect) {
        // Only trigger change if the value is actually different
        if (typeSelect.value !== state.type) {
            typeSelect.value = state.type;
            typeSelect.dispatchEvent(new Event('change', { bubbles: true })); // Trigger listener to show/hide specific controls
        }
    }
}

/**
 * Schedules a scene update to happen on the next animation frame.
 * @param {string|null} [id=null] - The ID of the element that triggered the update (optional).
 */
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
let windowModes = { 'n': 'wwr', 's': 'wwr', 'e': 'wwr', 'w': 'wwr' };

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
    const activeData = resultsManager.getActiveData();
    if (activeData && activeData.length > 0) {
        const timeScrubber = dom['time-scrubber'];
        const currentHour = timeScrubber ? parseInt(timeScrubber.value, 10) : -1;
        let dataToDisplay = activeData;

        // If annual data is loaded and we are scrubbing, use hourly data
        if (resultsManager.hasAnnualData(resultsManager.activeView) && currentHour >= 0) {
            dataToDisplay = resultsManager.getIlluminanceForHour(currentHour, resultsManager.activeView);
        }

        if (dataToDisplay) {
            updateSensorGridColors(dataToDisplay);
        }
    } else {
        // If there's no data, ensure grid is cleared of colors
        updateSensorGridColors(null);
    }
}

/**
* Highlights sensor points that correspond to the min or max value.
* @param {'min' | 'max'} type - The type of value to highlight.
*/
export function highlightSensorPoint(type) {
    const dom = getDom();

    const activeData = resultsManager.getActiveData();
    const activeStats = resultsManager.getActiveStats();

    if (!activeData || activeData.length === 0 || !activeStats) {
        showAlert('No results data available to highlight.', 'Info');
        return;
    }

    const targetValue = (type === 'min') ? activeStats.min : activeStats.max;
    const indices = [];
    activeData.forEach((value, index) => {
        if (value === targetValue) {
            indices.push(index);
        }
    });

    if (indices.length > 0) {
        const color = (type === 'min') ? 0x0000ff : 0xff0000; // Blue for min, Red for max
        highlightPointsByIndices(indices, color);
    } else {
        console.warn(`Could not find index for ${type} value: ${targetValue}`);
    }
}

/**
* Highlights multiple sensor points in the 3D view by their indices.
* @param {number[]} indices - An array of sensor point indices to highlight.
* @param {number} [color=0xffa500] - The hex color to use for highlighting (default is orange).
*/
export function highlightPointsByIndices(indices, color = 0xffa500) {
    if (!resultsManager.getActiveData() || resultsManager.getActiveData().length === 0) {
        return;
    }

    // Clear existing highlights before applying new ones.
    clearSensorHighlights();

    if (!indices || indices.length === 0) {
        return; // Nothing to highlight
    }

    let cumulativeIndex = 0;
    for (const mesh of sensorMeshes) {
        if (!mesh.instanceColor) continue;

        let needsUpdate = false;
        for (const index of indices) {
            if (index >= cumulativeIndex && index < cumulativeIndex + mesh.count) {
                const instanceIndex = index - cumulativeIndex;
                mesh.setColorAt(instanceIndex, new THREE.Color(color));
                needsUpdate = true;
            }
        }

        if (needsUpdate) {
            mesh.instanceColor.needsUpdate = true;
        }

        cumulativeIndex += mesh.count;
    }
}

/**
* Adds a specific handler for the static BSDF file input.
*/
// This helper function updates the lock icon's appearance based on the state
function updateLockIcon() {
    const dom = getDom();
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
    const dom = getDom();

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
    const dom = getDom();

    setGizmoVisibility(dom['gizmo-toggle'].checked);
}

// --- START: New functions for Task Area Visualizer ---
/**
* Updates the task area sliders based on interactions with the 2D canvas.
* @param {object} rect - An object with {x, z, w, d} for the task area.
*/
function updateSlidersFromCanvas(rect) {
    const dom = getDom();

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
    const dom = getDom();

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
    const dom = getDom();

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
    const dom = getDom();

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

    if (isDraggingTaskArea || isResizingTaskArea) {
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
    const dom = getDom();

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
    const dom = getDom();

    taskAreaCanvas = dom['task-area-canvas'];
    if (!taskAreaCanvas) return;
    taskAreaCtx = taskAreaCanvas.getContext('2d');

    const inputsToWatch = ['width', 'length', 'task-area-start-x', 'task-area-start-z', 'task-area-width', 'task-area-depth'];
    inputsToWatch.forEach(id => {
        dom[id]?.addEventListener('input', drawTaskAreaVisualizer);
    });

    dom['task-area-toggle']?.addEventListener('change', () => {
        if (dom['task-area-toggle'].checked) {
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

/**
 * Sets up event listeners for the Helios/AI Assistant panel.
 */
function setupHeliosPanel() {
    const dom = getDom();

    const optimizationTab = dom['helios-optimization-tab-btn'];          // Radiance / daylight optimization
    const epOptimizationTab = dom['helios-ep-optimization-tab-btn'];    // EnergyPlus optimization
    const chatTab = dom['ai-chat-tab-1'];
    const chatContent = dom['ai-chat-content-1'];

    // Always make both optimization tabs available; content visibility is managed by ai-assistant.js
    if (optimizationTab) optimizationTab.classList.remove('hidden');
    if (epOptimizationTab) epOptimizationTab.classList.remove('hidden');

    // Ensure there is always at least one active tab (chat) if none is set yet
    if (chatTab && chatContent && dom['ai-chat-tabs'] && !dom['ai-chat-tabs'].querySelector('.ai-chat-tab.active')) {
        chatTab.classList.add('active');
        chatContent.classList.remove('hidden');
    }

    // NOTE: Former helios-mode-toggle behavior has been removed.
    // Both optimization tabs are always available; tab click handlers manage active content.

    // AI Panel Tab Switching
    // AI Panel Tab Switching
    // Logic moved entirely to ai-assistant.js to handle dynamic chat tabs and optimization tabs unification.
    // This listener is neutralized to prevent conflicts (blank content issues).
    dom['ai-chat-tabs']?.addEventListener('click', (e) => {
        // no-op: ai-assistant.js handles all click events for these tabs
    });
}

export async function setupEventListeners() {
    const dom = getDom();

    // Global listener for all keyboard shortcuts
    window.addEventListener('keydown', handleKeyDown);

    // Add the event listener for the lock button
    dom['wall-select-lock-btn']?.addEventListener('click', () => {
        isWallSelectionLocked = !isWallSelectionLocked;
        updateLockIcon();
    });

    // Add listener for the new globals toggle in the simulation panel
    dom['globals-toggle']?.addEventListener('change', (e) => {
        dom['globals-controls']?.classList.toggle('hidden', !e.target.checked);
        if (e.target.checked) {
            const panel = e.target.closest('.floating-window');
            if (panel) {
                ensureWindowInView(panel);
            }
        }
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
    setupHeliosPanel();
    dom['view-btn-persp']?.addEventListener('click', () => setCameraView('persp'));
    dom['view-btn-ortho']?.addEventListener('click', () => setCameraView('ortho'));
    dom['view-btn-top']?.addEventListener('click', () => setCameraView('top'));
    dom['view-btn-front']?.addEventListener('click', () => setCameraView('front'));
    dom['view-btn-back']?.addEventListener('click', () => setCameraView('back'));
    dom['view-btn-left']?.addEventListener('click', () => setCameraView('left'));
    dom['view-btn-right']?.addEventListener('click', () => setCameraView('right'));

    dom['view-btn-quad']?.addEventListener('click', () => {
        const container = dom['render-container'];
        const isActive = container.classList.toggle('quad-view-active');
        dom['view-btn-quad'].classList.toggle('active', isActive);

        // Disable other view buttons in quad mode
        ['persp', 'ortho', 'top', 'front', 'back', 'left', 'right'].forEach(v => {
            dom[`view-btn-${v}`].disabled = isActive;
        });

        import('../scripts/scene.js').then(scene => {
            scene.toggleQuadView(isActive);
        });
    });

    if (dom['frame-toggle']) {
        // Sync initial visibility state on load
        dom['frame-controls']?.classList.toggle('hidden', !dom['frame-toggle'].checked);

        dom['frame-toggle'].addEventListener('change', () => {
            dom['frame-controls']?.classList.toggle('hidden', !dom['frame-toggle'].checked);
            scheduleUpdate();
        });
    }

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

    // Set initial state for ground grid controls
    if (dom['ground-grid-controls'] && dom['ground-plane-toggle']) {
        dom['ground-grid-controls'].classList.toggle('hidden', !dom['ground-plane-toggle'].checked);
    }

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
    dom['show-annual-profile-btn']?.addEventListener('click', onShowAnnualProfile);

    // --- Annual Glare Listeners ---
    dom['glare-rose-btn']?.addEventListener('click', async () => {
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
    dom['render-container'].addEventListener('pointerdown', onPointerDown, false);
    dom['render-container'].addEventListener('pointermove', onPointerMove, false);
    dom['render-container'].addEventListener('pointerup', onPointerUp, false);

    if (dom['view-type']) updateLiveViewType(dom['view-type'].value);

    // --- Gizmo Mode Listeners ---
    dom['gizmo-mode-translate']?.addEventListener('click', () => setAndDisplayGizmoMode('translate'));
    dom['gizmo-mode-rotate']?.addEventListener('click', () => setAndDisplayGizmoMode('rotate'));
    dom['gizmo-mode-scale']?.addEventListener('click', () => setAndDisplayGizmoMode('scale'));

    // --- Shortcut Help Modal Listeners ---
    dom['shortcut-help-btn']?.addEventListener('click', openShortcutHelp);
    dom['shortcut-modal-close-btn']?.addEventListener('click', () => {
        dom['shortcut-help-modal']?.classList.replace('flex', 'hidden');
    });

    // Listener for the new optimization info modal
    dom['opt-info-modal-close-btn']?.addEventListener('click', () => {
        dom['optimization-info-modal']?.classList.replace('flex', 'hidden');
    });

    // Listener for the new EP optimization info modal
    dom['ep-opt-info-modal-close-btn']?.addEventListener('click', () => {
        dom['ep-optimization-info-modal']?.classList.replace('flex', 'hidden');
    });

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

    // Listener for the remove object button
    dom['remove-selected-object-btn']?.addEventListener('click', _removeSelectedObject);

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
    });

    // Make toolbars draggable
    const leftToolbarContainer = dom['left-controls-container'];
    const viewControlsContainer = dom['view-controls'];

    if (leftToolbarContainer) {
        // Use the whole container as the handle
        makeDraggable(leftToolbarContainer, leftToolbarContainer);
        // Bring to front on click
        leftToolbarContainer.addEventListener('mousedown', () => {
            leftToolbarContainer.style.zIndex = getNewZIndex();
        });
    }

    if (viewControlsContainer) {
        // Use the whole container as the handle
        makeDraggable(viewControlsContainer, viewControlsContainer);
        // Bring to front on click
        viewControlsContainer.addEventListener('mousedown', () => {
            viewControlsContainer.style.zIndex = getNewZIndex();
        });
    }

    setupRecipeGuidesPanel();

    promptForProjectDirectory();

    // Defer initial state settings until the 3D scene is fully initialized.
    dom['render-container'].addEventListener('sceneReady', () => {
        // Set the camera helper's visibility based on the default checkbox state.
        setGizmoVisibility(dom['gizmo-toggle'].checked);
    }, { once: true }); // The event should only fire once.

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

    initSidebar();

    // Add focus/blur handlers to the AI API key field to prevent password manager interference.
    // Some extensions are aggressive and cause errors even with autocomplete="off".
    // By changing the type, we make it look like a normal text field when not in use.
    const apiKeyInput = dom['ai-secret-field'];
    if (apiKeyInput) {
        apiKeyInput.addEventListener('focus', () => {
            setTimeout(() => { apiKeyInput.type = 'password'; }, 50);
        });
        apiKeyInput.addEventListener('blur', () => {
            if (apiKeyInput.value === '') {
                apiKeyInput.type = 'text';
            }
        });
    }

    // Initialize bounding box labels
    const bboxLabelIds = ['min-x', 'max-x', 'min-y', 'max-y', 'min-z', 'max-z'];
    bboxLabelIds.forEach(suffix => {
        const sliderId = `gen-bbox-${suffix}`;
        const labelId = `${sliderId}-val`;
        if (dom[sliderId] && dom[labelId]) {
            updateValueLabel(dom[labelId], dom[sliderId].value, 'm', sliderId);
        }
    });

} // End of setupEventListeners

/**
* Programmatically sets the value of a UI element and dispatches events.
* @param {string} id - The base ID of the element (e.g., 'overhang-depth-s').
* @param {string|number|boolean} value - The new value to set.
*/
export function setUiValue(id, value) {
    const element = dom[id] || document.getElementById(id);
    if (!element) {
        console.warn(`[setUiValue] Element '${id}' not found`);
        return false;
    }

    if (element.type === 'checkbox') {
        element.checked = !!value;
    } else {
        element.value = value;
    }

    // Dispatch events to ensure labels and other listeners update
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
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
const PANEL_BUTTON_MAP = {
    'panel-project': 'toggle-panel-project-btn',
    'panel-dimensions': 'toggle-panel-dimensions-btn',
    'panel-aperture': 'toggle-panel-aperture-btn',
    'panel-lighting': 'toggle-panel-lighting-btn',
    'panel-materials': 'toggle-panel-materials-btn',
    'panel-sensor': 'toggle-panel-sensor-btn',
    'panel-viewpoint': 'toggle-panel-viewpoint-btn',
    'panel-scene-elements': 'toggle-panel-scene-btn',
    'panel-info': 'info-button',
    'panel-recipe-guides': 'recipe-guides-btn',
    'panel-ai-assistant': 'ai-assistant-button',
    'panel-simulation-modules': 'toggle-modules-btn',
    'panel-analysis-modules': 'toggle-analysis-btn',
    'panel-energyplus': 'toggle-panel-energyplus-btn'
};

export function getPanelToggleButtonId(panelId) {
    return PANEL_BUTTON_MAP[panelId] || null;
}

export function togglePanelVisibility(panelId, btnId) {
    const dom = getDom();

    const panel = document.getElementById(panelId);
    const resolvedBtnId = btnId || getPanelToggleButtonId(panelId);
    const btn = resolvedBtnId ? document.getElementById(resolvedBtnId) : null;
    if (!panel) return;

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

        initializePanelControls(panel);

        // Make sure the panel is within the viewport
        ensureWindowInView(panel);
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
    const dom = getDom();

    const panelMap = {
        'toggle-panel-project-btn': 'panel-project',
        'toggle-panel-dimensions-btn': 'panel-dimensions',
        'toggle-panel-aperture-btn': 'panel-aperture',
        'toggle-panel-lighting-btn': 'panel-lighting',
        'toggle-panel-materials-btn': 'panel-materials',
        'toggle-panel-sensor-btn': 'panel-sensor',
        'toggle-panel-viewpoint-btn': 'panel-viewpoint',
        'toggle-panel-scene-btn': 'panel-scene-elements',
        'toggle-panel-energyplus-btn': 'panel-energyplus',
        'info-button': 'panel-info',
        'recipe-guides-btn': 'panel-recipe-guides',
        'toggle-modules-btn': 'panel-simulation-modules',
        'toggle-analysis-btn': 'panel-analysis-modules'
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
    const dom = getDom();

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
                    'panel-recipe-guides': 'recipe-guides-btn',
                    'panel-ai-assistant': 'ai-assistant-button',
                    'panel-simulation-modules': 'toggle-modules-btn',
                    'panel-analysis-modules': 'toggle-analysis-btn',
                    'panel-energyplus': 'toggle-panel-energyplus-btn'
                };
                const btnId = panelMap[win.id];
                if (btnId && dom[btnId]) {
                    dom[btnId].classList.remove('active');
                }
            }
        });
    }

    if (header) makeDraggable(win, header);

    // Add accordion functionality to panels
    win.querySelectorAll('.accordion-header').forEach(header => {
        header.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent panel from dragging when clicking header
            const content = header.nextElementSibling;
            const chevron = header.querySelector('.accordion-chevron');
            if (content && content.classList.contains('accordion-content')) {
                const isVisible = content.style.display === 'block';
                content.style.display = isVisible ? 'none' : 'block';
                header.parentElement.classList.toggle('open', !isVisible);
                if (chevron) {
                    chevron.textContent = isVisible ? '▶' : '▼';
                }
                // Ensure panel is visible if it was expanded and might go off-screen
                if (!isVisible) {
                    ensureWindowInView(win);
                }
            }
        });
    });

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
    let offsetX, offsetY;
    handle.onmousedown = e => {
        // START: Add check for docked state and dock buttons
        if (element.classList.contains('docked') || e.target.closest('#dock-left-sidebar-btn') || e.target.closest('#dock-top-sidebar-btn')) return;
        // END: Add check for docked state and dock buttons
        if (e.target.closest('.window-controls') || e.target.classList.contains('resize-handle')) return;
        e.preventDefault();

        // Get initial position using computed style before making changes
        const style = window.getComputedStyle(element);
        const matrix = new DOMMatrix(style.transform);
        const initialX = matrix.m41;
        const initialY = matrix.m42;

        // Calculate offset relative to the initial transformed position and page coordinates
        offsetX = e.pageX - initialX;
        offsetY = e.pageY - initialY;

        // Ensure transform positioning is set from the start if not already
        if (!element.dataset.transformPositioned) {
            // If the element wasn't transform positioned, capture its current screen position FIRST
            const rect = element.getBoundingClientRect();

            element.style.left = '0px';
            element.style.top = '0px';
            element.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`; // Set transform to its ORIGINAL position

            // Recalculate offset based on this new transform
            offsetX = e.pageX - rect.left;
            offsetY = e.pageY - rect.top;
            element.dataset.transformPositioned = 'true';
        }

        element.classList.add('is-dragging'); // Add dragging class
        controls.enabled = false;

        // On the first drag, we switch the element to a pure transform-based positioning
        if (!element.dataset.transformPositioned) {
            element.style.left = '0px';
            element.style.top = '0px';
            element.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`;
            element.dataset.transformPositioned = 'true';
        }

        controls.enabled = false;
        document.onmouseup = () => {
            document.onmouseup = null;
            document.onmousemove = null;
            controls.enabled = true;
            element.classList.remove('is-dragging'); // Remove dragging class
        };
        document.onmousemove = (e) => {
            e.preventDefault();
            if (element.classList.contains('maximized')) return;

            // Calculate the new desired top-left position using page coordinates
            let newX = e.pageX - offsetX;
            let newY = e.pageY - offsetY;

            // Constrain the element within the viewport for smooth dragging
            const elementWidth = element.offsetWidth;
            const elementHeight = element.offsetHeight;

            const finalX = Math.max(0, Math.min(newX, window.innerWidth - elementWidth));
            const finalY = Math.max(0, Math.min(newY, window.innerHeight - elementHeight));

            element.style.transform = `translate3d(${finalX}px, ${finalY}px, 0)`;
        };
    };
}

export function makeResizable(element, handles) {
    handles.forEach(handle => {
        handle.onmousedown = function (e) {
            e.preventDefault();
            e.stopPropagation();

            if (element.classList.contains('maximized')) return;

            // Add classes to body for global cursor and to disable transitions
            document.body.classList.add('is-resizing');
            document.body.style.cursor = window.getComputedStyle(handle).cursor;

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

            document.onmousemove = function (moveEvent) {
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

            document.onmouseup = function () {
                // Remove global classes and styles
                document.body.classList.remove('is-resizing');
                document.body.style.cursor = '';

                document.onmousemove = null;
                document.onmouseup = null;
                controls.enabled = true;
            };
        };
    });
}

/**
* Makes the AI Assistant sidebar horizontally resizable.
* @param {HTMLElement} sidebar The sidebar element.
* @param {HTMLElement} handle The drag handle element.
*/
function makeSidebarResizable(sidebar, handle) {
    const dom = getDom();

    handle.onmousedown = function (e) {
        e.preventDefault();
        e.stopPropagation();

        const initialMouseX = e.clientX;
        const initialWidth = sidebar.offsetWidth;
        document.body.classList.add('is-resizing-sidebar');
        document.body.style.cursor = 'ew-resize';
        document.body.style.userSelect = 'none';

        document.onmousemove = function (moveEvent) {
            const dx = initialMouseX - moveEvent.clientX;
            let newWidth = initialWidth + dx;

            const minWidth = 320;
            const maxWidth = Math.min(800, window.innerWidth - 100);
            newWidth = Math.max(minWidth, Math.min(newWidth, maxWidth));

            // Only update the CSS variable; the components will react to it.
            document.documentElement.style.setProperty('--ai-sidebar-width', `${newWidth}px`);
            debouncedWindowResize();
        };

        document.onmouseup = function () {
            document.onmousemove = null;
            document.onmouseup = null;
            document.body.classList.remove('is-resizing-sidebar');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
    };
}

/**
* Makes the AI chat input area vertically resizable.
*/
function makeChatInputResizable() {
    const dom = getDom();

    const handle = dom['chat-resize-handle'];
    const container = dom['ai-chat-input-container'];
    if (!handle || !container) return;

    handle.onmousedown = function (e) {
        e.preventDefault();
        e.stopPropagation();

        const startY = e.clientY;
        const startHeight = container.offsetHeight;
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';

        document.onmousemove = function (moveEvent) {
            const dy = startY - moveEvent.clientY;
            let newHeight = startHeight + dy;

            const minHeight = 60;
            const maxHeight = 400;
            newHeight = Math.max(minHeight, Math.min(newHeight, maxHeight));

            container.style.height = `${newHeight}px`;
        };

        document.onmouseup = function () {
            document.onmousemove = null;
            document.onmouseup = null;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
    };
}

export function setupSidebar() {
    const dom = getDom();

    // This now controls the AI assistant sidebar on the right.
    dom['ai-assistant-button']?.addEventListener('click', () => {
        const sidebar = dom['right-sidebar'];
        if (sidebar) {
            const isOpening = sidebar.classList.contains('closed');
            sidebar.classList.toggle('closed');
            document.body.classList.toggle('ai-sidebar-open', isOpening);

            // Dispatch a window resize event after the transition to fix rendering
            setTimeout(() => {
                window.dispatchEvent(new Event('resize'));
            }, 400); // Should match CSS transition duration
        }
    });

    const sidebar = dom['right-sidebar'];
    const handle = sidebar?.querySelector('.resize-handle-edge.left');
    if (sidebar && handle) {
        makeSidebarResizable(sidebar, handle);
    }
}

function setupProjectPanel() {
    const dom = getDom();

    setupEpwUploadModal();
    checkRadiancePath();

    // Fix for Leaflet's default icon paths when using a bundler or CDN
    delete L.Icon.Default.prototype._getIconUrl;
    L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    });

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
    const dom = getDom();

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
            reader.onload = async function (e) {
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

export function setCameraView(view) {
    const dom = getDom();

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
    const dom = getDom();

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
    { test: (id) => id === 'ground-grid-size', format: (num) => `${Math.round(num)}m` },
    { test: (id) => id === 'ground-grid-divisions', format: (num) => `${Math.round(num)}` },
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
    const dom = getDom();

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
    const dom = getDom();

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
    const dom = getDom();

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
    const dom = getDom();

    const params = {};
    wallDirections.forEach(dir => {
        if (!dom[`shading-${dir}-toggle`]?.checked) return; // Use return to skip iteration

        const type = dom[`shading-type-${dir}`]?.value;
        if (!type || type === 'none') return; // Use return to skip iteration

        const shadeParams = { type };

        if (type === 'overhang') {
            shadeParams.overhang = {
                depth: parseFloat(dom[`overhang-depth-${dir}`]?.value || 0),
                tilt: parseFloat(dom[`overhang-tilt-${dir}`]?.value || 90),
                distAbove: parseFloat(dom[`overhang-dist-above-${dir}`]?.value || 0),
                leftExtension: parseFloat(dom[`overhang-left-extension-${dir}`]?.value || 0),
                rightExtension: parseFloat(dom[`overhang-right-extension-${dir}`]?.value || 0),
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
        } else if (type === 'generative') {
            // Retrieve the stored generative pattern type, its parameters, and bounding box
            if (project.generativeShadingParams && project.generativeShadingParams[dir]) {
                // Make sure to retrieve both procedural parameters and bounding box info
                shadeParams.generative = {
                    patternType: project.generativeShadingParams[dir].patternType,
                    parameters: project.generativeShadingParams[dir].parameters || {},
                    boundingBox: project.generativeShadingParams[dir].boundingBox || {} // Add bounding box
                };
            } else {
                // If nothing stored, maybe initialize default bbox here? Or handle in generate method.
                shadeParams.generative = { patternType: 'fins', parameters: {}, boundingBox: {} }; // Default if nothing is stored
            }
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
        showIn3D: getChecked('show-view-grid-3d-toggle', true), // Default to true if element not found
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
    const dom = getDom();

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


export function setWindowMode(dir, mode, triggerUpdate = true) {
    const dom = getDom();

    windowModes[dir] = mode;
    dom[`mode-wwr-btn-${dir}`].classList.toggle('active', mode === 'wwr');
    dom[`mode-manual-btn-${dir}`].classList.toggle('active', mode !== 'wwr');
    dom[`wwr-controls-${dir}`].classList.toggle('hidden', mode !== 'wwr');
    dom[`manual-controls-${dir}`].classList.toggle('hidden', mode === 'wwr');
    if (triggerUpdate) scheduleUpdate(`mode-${dir}`);
}

function updateGridControls() {
    const dom = getDom();

    dom['floor-grid-controls'].classList.toggle('hidden', !dom['grid-floor-toggle'].checked);
    dom['ceiling-grid-controls'].classList.toggle('hidden', !dom['grid-ceiling-toggle'].checked);
    const wallsChecked = ['north', 'south', 'east', 'west'].some(dir => dom[`grid-${dir}-toggle`].checked);
    dom['wall-grid-controls'].classList.toggle('hidden', !wallsChecked);
    scheduleUpdate();
}

export async function handleShadingTypeChange(dir, triggerUpdate = true) {
    const dom = getDom();

    const type = dom[`shading-type-${dir}`]?.value;
    if (type === undefined) return;
    ['overhang', 'lightshelf', 'louver', 'roller', 'imported_obj'].forEach(t => {
        const controlEl = dom[`shading-controls-${t}-${dir}`];
        if (controlEl) controlEl.classList.toggle('hidden', type !== t);
    });
    // Show/Hide Topology specific controls
    const patternType = project.generativeShadingParams?.[dir]?.patternType;
    const topoParamsEl = document.getElementById(`topology-params-${dir}`);
    if (topoParamsEl) {
        topoParamsEl.classList.toggle('hidden', !(type === 'generative' && patternType === 'topology_optimized'));
    }

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
    const dom = getDom();

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
    const dom = getDom();

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
    const dom = getDom();

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
    const dom = getDom();

    dom['custom-alert-title'].textContent = title;
    dom['custom-alert-message'].innerHTML = message;
    dom['custom-alert'].style.zIndex = getNewZIndex();
    dom['custom-alert'].classList.replace('hidden', 'flex');
}

function hideAlert() {
    const dom = getDom();

    dom['custom-alert'].classList.replace('flex', 'hidden');
}

/**
* Toggles the visibility and state of the comparative analysis UI.
* @param {boolean} enabled - Whether to enable or disable the mode.
*/
function toggleComparisonMode(enabled) {
    const dom = getDom();

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
    const dom = getDom();

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
    const dom = getDom();

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
    const dom = getDom();

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
    const dom = getDom();

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
                if (dom['combined-analysis-btn']) dom['combined-analysis-btn'].style.display = 'block';
            } else {
                if (dom['combined-analysis-btn']) dom['combined-analysis-btn'].style.display = 'none';
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
    const dom = getDom();

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
    const dom = getDom();

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
    const dom = getDom();

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
    const dom = getDom();

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
    const dom = getDom();

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
    const dom = getDom();

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
    const dom = getDom();

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
    if (dom['glare-source-list']) {
        dom['glare-source-list'].querySelectorAll('li').forEach(item => item.classList.remove('active-glare-source'));
    }
});

/** Handles right-click events on the 3D scene to show a context menu on sensor points.
* @param {MouseEvent} event The contextmenu event.
*/
function onSensorRightClick(event) {
    const dom = getDom();

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

        // Check if this point has annual data
        const hasAnnual = resultsManager.getAnnualDataForPoint(resultsManager.activeView, finalIndex) !== null;

        const menu = dom['sensor-context-menu'];

        // Store both point and index
        menu.dataset.point = JSON.stringify(intersection.point);
        menu.dataset.pointIndex = finalIndex;

        // Show/hide the annual profile button based on data availability
        dom['show-annual-profile-btn'].classList.toggle('hidden', !hasAnnual);

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
    const dom = getDom();

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
 * Sets the gizmo mode and updates the UI button states.
 * @param {string} mode - The desired gizmo mode ('translate', 'rotate', 'scale').
 */
function setAndDisplayGizmoMode(mode) {
    const dom = getDom();

    setGizmoMode(mode);

    // Update UI button states
    dom['gizmo-mode-translate']?.classList.toggle('active', mode === 'translate');
    dom['gizmo-mode-rotate']?.classList.toggle('active', mode === 'rotate');
    dom['gizmo-mode-scale']?.classList.toggle('active', mode === 'scale');
}

/**
* Handles the click event for the "Set Viewpoint Here" button in the context menu.
*/
function onSetViewpointHere() {
    const dom = getDom();

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

let pointProfileChart = null; // Module-level variable to hold the chart instance

/**
 * Renders or updates the point-specific annual profile chart.
 * @param {string} key - The dataset key ('a' or 'b').
 * @param {number} pointIndex - The index of the sensor point.
 */
function updatePointAnnualProfileChart(key, pointIndex) {
    const dom = getDom();
    if (!dom['point-annual-profile-chart']) return;

    const annualData = resultsManager.getAnnualDataForPoint(key, pointIndex);
    if (!annualData) {
        // Hide or clear the chart if no data
        dom['annual-profile-point-id'].textContent = 'select point';
        if (pointProfileChart) {
            pointProfileChart.destroy();
            pointProfileChart = null;
        }
        return;
    }

    dom['annual-profile-point-id'].textContent = `#${pointIndex}`;

    const ctx = dom['point-annual-profile-chart'].getContext('2d');
    const labels = Array.from({ length: 8760 }, (_, i) => i);

    if (pointProfileChart) {
        pointProfileChart.data.labels = labels;
        pointProfileChart.data.datasets[0].data = annualData;
        pointProfileChart.data.datasets[0].label = `Illuminance (lux) - Point #${pointIndex}`;
        pointProfileChart.update('none'); // Update without animation
    } else {
        pointProfileChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: `Illuminance (lux) - Point #${pointIndex}`,
                    data: annualData,
                    borderColor: 'var(--highlight-color, #3B82F6)',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    borderWidth: 1,
                    pointRadius: 0,
                    fill: true,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: 'Illuminance (lux)' },
                        ticks: { color: 'var(--text-secondary, #6B7280)' },
                        grid: { color: 'var(--grid-color, #E5E7EB)' }
                    },
                    x: {
                        type: 'linear', // Use linear scale for 8760 hours
                        title: { display: true, text: 'Hour of Year' },
                        ticks: { color: 'var(--text-secondary, #6B7280)', maxTicksLimit: 12 },
                        grid: { display: false }
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        callbacks: {
                            title: function (tooltipItems) {
                                const hour = tooltipItems[0].parsed.x;
                                const day = Math.floor(hour / 24) + 1;
                                const hourOfDay = hour % 24;
                                return `Day ${day}, Hour ${hourOfDay}`;
                            }
                        }
                    }
                }
            }
        });
    }
}

/**
* Handles the click event for the "Show Annual Profile" button in the context menu.
*/
function onShowAnnualProfile() {
    const dom = getDom();
    const menu = dom['sensor-context-menu'];
    if (!menu.dataset.pointIndex) return;

    const pointIndex = parseInt(menu.dataset.pointIndex, 10);
    const activeKey = resultsManager.activeView;

    // Open the results analysis panel if it's hidden
    const resultsPanel = dom['results-analysis-panel'];
    if (resultsPanel && resultsPanel.classList.contains('hidden')) {
        resultsPanel.classList.remove('hidden');
        resultsPanel.style.zIndex = getNewZIndex();
        ensureWindowInView(resultsPanel);
        // We must update the whole panel to initialize the histogram, etc.
        updateResultsAnalysisPanel();
    }

    updatePointAnnualProfileChart(activeKey, pointIndex);
    menu.classList.add('hidden'); // Hide the menu
}

/**
* Sets up the welcome screen with interactive visual effects that can be cycled through.
*/
export function setupWelcomeScreen() {
    const dom = getDom();

    const welcomeScreen = document.getElementById('welcome-screen');
    const canvas = document.getElementById('glow-canvas');
    if (!welcomeScreen || !canvas) return;

    const ctx = canvas.getContext('2d');
    let animationFrameId;
    let currentEffectIndex = 0;
    const mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

    // --- EFFECT 1: Raycasting ---
    const raycastEffect = {
        boundaries: [],
        rays: [],
        init() {
            this.boundaries = [];
            const w = canvas.clientWidth;
            const h = canvas.clientHeight;

            this.boundaries.push(new this.Boundary(0, 0, w, 0));
            this.boundaries.push(new this.Boundary(w, 0, w, h));
            this.boundaries.push(new this.Boundary(0, h, w, h));
            this.boundaries.push(new this.Boundary(0, 0, 0, h));

            for (let i = 0; i < 4; i++) {
                this.boundaries.push(new this.Boundary(Math.random() * w, Math.random() * h, Math.random() * w, Math.random() * h));
            }
            if (this.rays.length === 0) {
                for (let a = 0; a < 360; a += 1.5) {
                    this.rays.push(new this.Ray(a * Math.PI / 180));
                }
            }
        },

        animate() {
            const theme = document.documentElement.getAttribute('data-theme') || 'light';
            let bgColor, rayColor, hitColor;
            if (theme === 'dark') { bgColor = '#212121'; rayColor = 'rgba(224, 224, 224, 0.1)'; hitColor = 'rgba(224, 224, 224, 0.8)'; }
            else if (theme === 'cyber') { bgColor = '#030d22'; rayColor = 'rgba(77, 139, 238, 0.2)'; hitColor = '#00f6ff'; }
            else { bgColor = '#E9E9EF'; rayColor = 'rgba(52, 52, 52, 0.1)'; hitColor = 'rgba(52, 52, 52, 0.7)'; }

            ctx.fillStyle = bgColor;
            ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);

            for (const ray of this.rays) {
                let closestPoint = null;
                let record = Infinity;
                for (const wall of this.boundaries) {
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
                    ctx.strokeStyle = rayColor;
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(mouse.x, mouse.y);
                    ctx.lineTo(closestPoint.x, closestPoint.y);
                    ctx.stroke();
                    ctx.fillStyle = hitColor;
                    ctx.beginPath();
                    ctx.arc(closestPoint.x, closestPoint.y, 3, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        },

        Boundary: class {
            constructor(x1, y1, x2, y2) { this.a = { x: x1, y: y1 }; this.b = { x: x2, y: y2 }; }
        },
        Ray: class {
            constructor(angle) { this.dir = { x: Math.cos(angle), y: Math.sin(angle) }; }
            cast(wall, origin) {
                const [x1, y1, x2, y2] = [wall.a.x, wall.a.y, wall.b.x, wall.b.y];
                const [x3, y3, x4, y4] = [origin.x, origin.y, origin.x + this.dir.x, origin.y + this.dir.y];
                const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
                if (den === 0) return null;
                const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
                const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / den;
                if (t > 0 && t < 1 && u > 0) return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
                return null;
            }
        }
    };

    // --- EFFECT 2: Flashlight ---
    const flashlightEffect = {
        shapes: [],
        init() {
            this.shapes = [];
            const w = canvas.clientWidth;
            const h = canvas.clientHeight;
            for (let i = 0; i < 50; i++) {
                this.shapes.push(new this.Shape(w, h));
            }
        },

        animate() {
            const theme = document.documentElement.getAttribute('data-theme') || 'light';
            let bgColor;
            if (theme === 'dark') { bgColor = '#212121'; }
            else if (theme === 'cyber') { bgColor = '#030d22'; }
            else { bgColor = '#E9E9EF'; }

            ctx.fillStyle = bgColor;
            ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);

            for (const shape of this.shapes) {
                shape.draw(ctx);
            }

            ctx.globalCompositeOperation = 'destination-in';

            const gradient = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, 250);
            gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
            gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);

            ctx.globalCompositeOperation = 'source-over';
        },

        Shape: class {
            constructor(w, h) {
                this.x = Math.random() * w;
                this.y = Math.random() * h;
                this.type = Math.random() > 0.5 ? 'circle' : 'rect';
                const colors = ['#ff2e97', '#00f6ff', '#ffd400', '#4d8bee', '#E1DEDE', '#888888'];
                this.color = colors[Math.floor(Math.random() * colors.length)];
                if (this.type === 'circle') { this.radius = Math.random() * 30 + 10; }
                else { this.width = Math.random() * 60 + 20; this.height = Math.random() * 60 + 20; }
            }
            draw(ctx) {
                ctx.fillStyle = this.color;
                if (this.type === 'circle') {
                    ctx.beginPath();
                    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
                    ctx.fill();
                } else {
                    ctx.fillRect(this.x - this.width / 2, this.y - this.height / 2, this.width, this.height);
                }
            }
        }
    };

    const effects = [raycastEffect, flashlightEffect];

    function switchEffect(index) {
        cancelAnimationFrame(animationFrameId);
        currentEffectIndex = index % effects.length;
        const effect = effects[currentEffectIndex];

        // A single animation loop that calls the current effect's animate function
        function animationLoop() {
            effect.animate();
            animationFrameId = requestAnimationFrame(animationLoop);
        }

        effect.init(); // Initialize the new effect
        animationLoop(); // Start its animation
    }

    function resizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);
        effects[currentEffectIndex].init();
    }

    function onMouseMove(e) {
        mouse.x = e.clientX;
        mouse.y = e.clientY;
    }

    function hideWelcomeScreen() {
        welcomeScreen.style.opacity = '0';
        setTimeout(() => {
            welcomeScreen.style.display = 'none';
            cancelAnimationFrame(animationFrameId);
            window.removeEventListener('mousemove', onMouseMove);
            if (resizeObserver) resizeObserver.disconnect();
        }, 500);
    }

    // --- Setup Event Listeners ---
    const resizeObserver = new ResizeObserver(() => resizeCanvas());
    resizeObserver.observe(welcomeScreen);
    window.addEventListener('mousemove', onMouseMove);

    dom['start-with-shoebox']?.addEventListener('click', (e) => {
        e.stopPropagation();
        switchGeometryMode('parametric');
        hideWelcomeScreen();
    });

    dom['start-with-import']?.addEventListener('click', (e) => {
        e.stopPropagation();
        switchGeometryMode('import');
        hideWelcomeScreen();
        togglePanelVisibility('panel-dimensions', 'toggle-panel-dimensions-btn');
    });

    dom['cycle-effect-btn']?.addEventListener('click', (e) => {
        e.stopPropagation();
        switchEffect(currentEffectIndex + 1);
    });

    // Initial setup
    resizeCanvas();
    switchEffect(0);
}

/**
* Handles a click on the main renderer canvas to select/deselect walls or furniture.
* @param {MouseEvent} event The click event.
*/
function onSceneClick(event) {
    const dom = getDom();

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
    const vegetationIntersect = intersects.find(i => i.object.userData.isVegetation === true);
    const massingIntersect = intersects.find(i => i.object.userData.isMassingBlock === true);

    if (furnitureIntersect) {
        selectTransformableObject(furnitureIntersect.object);
    } else if (vegetationIntersect) {
        selectTransformableObject(vegetationIntersect.object);
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
* @param {boolean} [resetLock=true] - Whether this selection should reset the lock state.
*/
function handleWallSelection(wallGroup, resetLock = true) {
    // Set the selected wall ID
    selectedWallId = wallGroup.userData.canonicalId;

    // Find the actual mesh within the group to highlight
    // The geometry function `highlightWall` will clear any previous highlight.
    const wallMesh = wallGroup.children.find(c => c.isMesh && c.userData.isSelectableWall);
    if (wallMesh) {
        // Highlight the selected wall mesh in the 3D view
        highlightWall(wallMesh);
    }

    // Show the specific aperture/shading controls for the selected wall
    showApertureControlsFor(selectedWallId);

    // Only reset the lock state if instructed to do so (e.g., manual click)
    // AI actions might pass false here to prevent unlocking
    if (resetLock) {
        isWallSelectionLocked = false; // Unlock selection
        updateLockIcon(); // Update the lock icon in the UI
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
    const dom = getDom();

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

    if (id) {
        // Show the specific panel for the selected wall
        let controls = dom[`aperture-controls-${id}`];
        if (!controls) {
            // Fallback: try to find it again if not in cache
            controls = document.getElementById(`aperture-controls-${id}`);
            if (controls) dom[`aperture-controls-${id}`] = controls;
        }

        if (controls) {
            controls.classList.remove('hidden');
            dom['selected-wall-display'].textContent = `${wallNames[id]} Wall`;
        }
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
    const dom = getDom();

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
    const dom = getDom();

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
    const dom = getDom();

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
    const dom = getDom();

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
    const dom = getDom();

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
    const dom = getDom();

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
    const dom = getDom();

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
    const dom = getDom();

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
    const dom = getDom();

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
    const dom = getDom();

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
    const dom = getDom();

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
    const dom = getDom();

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
                case '>': show = cellValue > filterValue; break;
                case '<': show = cellValue < filterValue; break;
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
    const dom = getDom();

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
    const dom = getDom();

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
    const dom = getDom();

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
    const dom = getDom();

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
    const dom = getDom();

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
    const dom = getDom();

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
    const dom = getDom();

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
    const dom = getDom();

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
    const dom = getDom();

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
    const dom = getDom();

    const assetLibrary = dom['asset-library'];
    const renderContainer = dom['render-container'];
    if (!assetLibrary || !renderContainer) return;

    let draggedAssetType = null;

    const setupDragStart = (library) => {
        if (!library) return;
        library.addEventListener('dragstart', (e) => {
            const item = e.target.closest('.asset-item');
            if (item && item.dataset.assetType) {
                draggedAssetType = item.dataset.assetType;
                e.dataTransfer.effectAllowed = 'copy';
                console.log(`[DEBUG] Drag Start. Asset: ${draggedAssetType}`);
            }
        });
    };

    setupDragStart(assetLibrary);
    setupDragStart(dom['asset-library-vegetation']);

    const customAssetImporter = dom['custom-asset-importer'];
    let assetTypeToImport = null;

    const handleAssetClick = (e) => {
        const item = e.target.closest('.asset-item');
        if (!item) return;

        const assetType = item.dataset.assetType;
        if (assetType === 'custom-obj-furniture' || assetType === 'custom-obj-vegetation') {
            assetTypeToImport = assetType;
            customAssetImporter.click();
        }
    };

    assetLibrary.addEventListener('click', handleAssetClick);
    dom['asset-library-vegetation']?.addEventListener('click', handleAssetClick);

    customAssetImporter?.addEventListener('change', async (e) => {
        if (!assetTypeToImport) return;

        let objFile = null;
        let mtlFile = null;

        for (const file of e.target.files) {
            if (file.name.toLowerCase().endsWith('.obj')) objFile = file;
            else if (file.name.toLowerCase().endsWith('.mtl')) mtlFile = file;
        }

        if (!objFile) {
            showAlert('An .obj file is required for import.', 'File Missing');
            return;
        }

        const readAsText = (file) => new Promise((resolve, reject) => {
            if (!file) { resolve(null); return; }
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsText(file);
        });

        try {
            const [objContent, mtlContent] = await Promise.all([readAsText(objFile), readAsText(mtlFile)]);

            const newAsset = await addImportedAsset(objContent, mtlContent, assetTypeToImport);

            if (newAsset) {
                selectTransformableObject(newAsset);
                showAlert(`Imported ${objFile.name} successfully.`, 'Asset Imported');
            } else {
                throw new Error("Asset creation failed in geometry module.");
            }

        } catch (error) {
            console.error("Error importing custom asset:", error);
            showAlert(`Failed to import asset: ${error.message}`, 'Import Error');
        } finally {
            // Reset for next import
            assetTypeToImport = null;
            e.target.value = ''; // Allows re-importing the same file
        }
    });

    renderContainer.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    });

    renderContainer.addEventListener('drop', (e) => {
        e.preventDefault();
        if (!draggedAssetType) return;

        // Capture the asset type in a constant. This is the main fix.
        const assetTypeToCreate = draggedAssetType;

        const rect = renderContainer.getBoundingClientRect();
        const pointer = new THREE.Vector2();
        pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(pointer, activeCamera);

        const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const intersectPoint = new THREE.Vector3();
        const didIntersect = raycaster.ray.intersectPlane(groundPlane, intersectPoint);

        if (didIntersect) {
            const vegetationTypes = ['tree-deciduous', 'tree-coniferous', 'bush'];
            if (vegetationTypes.includes(assetTypeToCreate)) {
                import('./geometry.js').then(({ addVegetation }) => {
                    const vegetation = addVegetation(assetTypeToCreate, intersectPoint);
                    if (!vegetation) {
                        // If creation fails, log an error to the console instead of showing a popup.
                        console.error(`Failed to create vegetation asset: ${assetTypeToCreate}`);
                    }
                });
            } else {
                addFurniture(assetTypeToCreate, intersectPoint);
            }
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
    const dom = getDom();

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
    const dom = getDom();

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
* Removes the currently selected object (furniture, vegetation, or massing block) from the scene.
* @private
*/
async function _removeSelectedObject() {
    const dom = getDom();

    const object = transformControls.object;
    if (!object) {
        return; // Nothing selected, do nothing.
    }

    const objectName = object.userData.assetType || object.userData.name || 'object';

    if (object.userData.isFurniture || object.userData.isVegetation) {
        // Detach gizmo and hide controls
        transformControls.detach();
        dom['transform-controls-section']?.classList.add('hidden');

        // Remove from its parent group
        if (object.parent) {
            object.parent.remove(object);
        }

        showAlert(`Removed ${objectName}.`, 'Object Removed');
    } else if (object.userData.isMassingBlock) {
        // Detach gizmo and hide controls
        transformControls.detach();
        dom['transform-controls-section']?.classList.add('hidden');

        // Use the manager function to handle removal and UI update
        const { deleteContextObject } = await import('./geometry.js');
        deleteContextObject(object.userData.id);
        showAlert(`Removed ${objectName}.`, 'Object Removed');
    } else {
        showAlert('This object type cannot be removed.', 'Action Not Allowed');
    }
}

/**
 * Handles the pointer down event to initiate a resize drag or prepare for a click.
 */
function onPointerDown(event) {
    const dom = getDom();

    if (event.button !== 0) return;
    pointerDownPosition.set(event.clientX, event.clientY);

    if (isResizeMode) {
        const pointer = new THREE.Vector2();
        const targetElement = event.target.closest('.viewport');
        if (!targetElement) return; // Must be in a viewport

        const rect = targetElement.getBoundingClientRect();
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
    const dom = getDom();

    if (isResizeMode) {
        updateResizeCursor(event); // Update cursor style on hover
    }
    if (!isResizeMode || !draggedHandle) return;

    const pointer = new THREE.Vector2();
    const targetElement = event.target.closest('.viewport');
    if (!targetElement) return; // Must be in a viewport

    const rect = targetElement.getBoundingClientRect();
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
    const dom = getDom();

    if (transformControls.dragging || sensorTransformControls.dragging || isResizeMode) return;

    const { isQuadView, topCamera, frontCamera, sideCamera } = MESH;
    const pointer = new THREE.Vector2();
    let cameraForRaycast = activeCamera;

    // Always get the target viewport from the event, as the listener is on the container
    const targetElement = event.target.closest('.viewport');
    if (!targetElement) return; // Exit if click was not inside a viewport

    if (isQuadView) {
        switch (targetElement.id) {
            case 'viewport-main':
                cameraForRaycast = activeCamera;
                break;
            case 'viewport-top':
                cameraForRaycast = topCamera;
                break;
            case 'viewport-front':
                cameraForRaycast = frontCamera;
                break;
            case 'viewport-side':
                cameraForRaycast = sideCamera;
                break;
            default:
                return;
        }
    }

    const rect = targetElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, cameraForRaycast);

    const objectsToIntersect = [wallSelectionGroup, furnitureObject, contextObject, vegetationObject];
    const intersects = raycaster.intersectObjects(objectsToIntersect, true);

    const wallIntersect = intersects.find(i => i.object.userData.isSelectableWall === true);
    const furnitureIntersect = intersects.find(i => i.object.userData.isFurniture === true);
    const massingIntersect = intersects.find(i => i.object.userData.isMassingBlock === true);
    const vegetationIntersect = intersects.find(i => {
        let parent = i.object;
        while (parent) {
            if (parent.userData.isVegetation) return true;
            parent = parent.parent;
        }
        return false;
    });

    if (furnitureIntersect) {
        selectTransformableObject(furnitureIntersect.object);
    } else if (vegetationIntersect) {
        let targetGroup = vegetationIntersect.object;
        while (targetGroup && !targetGroup.userData.isVegetation) {
            targetGroup = targetGroup.parent;
        }
        if (targetGroup) {
            selectTransformableObject(targetGroup);
            // Show transform controls for vegetation
            dom['transform-controls-section']?.classList.remove('hidden');
        }
    } else if (massingIntersect) {
        selectTransformableObject(massingIntersect.object);
    } else if (wallIntersect) {
        transformControls.detach(); // Detach from any other object
        handleWallInteraction(wallIntersect);
        // --- ADD THIS NEW LOGIC ---
        // Ensure the wall group exists and get its ID
        let targetGroup = wallIntersect.object.parent;
        while (targetGroup && !targetGroup.userData.canonicalId) {
            targetGroup = targetGroup.parent;
        }
        if (targetGroup && targetGroup.userData.canonicalId && !isWallSelectionLocked) {
            handleWallSelection(targetGroup, true);
        }
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
    const dom = getDom();

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
    const dom = getDom();

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
    const dom = getDom();

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
    const dom = getDom();

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
    const dom = getDom();

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
    const dom = getDom();

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
            volume = (4 / 3) * Math.PI * radius * radius * radius;
        } else if (shape === 'pyramid') {
            // Approximate pyramid volume (cone geometry)
            volume = (1 / 3) * Math.PI * radius * radius * height;
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
    const dom = getDom();

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
    const dom = getDom();

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
    const dom = getDom();

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

/**
 * Generates an enhanced flowchart for a recipe based on its workflow type.
 * @param {string} recipeName - The name of the recipe.
 * @param {string} content - The guide content.
 * @returns {string} Empty string - flowcharts have been removed.
 */
function generateEnhancedFlowchart(recipeName, content) {
    // Flowcharts have been removed from the application
    return '';
}

/**
 * Generates flowchart for point-in-time simulations.
 */
function generatePointInTimeFlowchart() {
    return `
    A[Generate Sky<br/>Conditions]:::input
    B[Compile Scene<br/>Geometry]:::process
    C[Calculate Illuminance<br/>at Sensor Points]:::process
    D[Generate Results<br/>Visualization]:::output

    A --> B --> C --> D

    class A,B,C,D codeTheme;
    `;
}

/**
 * Generates flowchart for 3-Phase annual simulations.
 */
function generateAnnual3PhaseFlowchart() {
    return `
    A[Load Weather<br/>& BSDF Data]:::input
    B{Generate Matrices?}:::decision
    C[Run Matrix<br/>Generation]:::subprocess
    D[Run Annual<br/>Simulation]:::process
    E[Calculate Metrics<br/>(sDA, UDI)]:::process
    F[Generate Results<br/>Dashboard]:::output

    A --> B
    B -->|Yes| C
    B -->|No| D
    C --> D --> E --> F

    class A,B,C,D,E,F codeTheme;
    `;
}

/**
 * Generates flowchart for advanced annual simulations.
 */
function generateAnnualAdvancedFlowchart() {
    return `
    A[Load Multiple<br/>Data Files]:::input
    B[Generate Core<br/>Matrices]:::subprocess
    C[Run Advanced<br/>Calculations]:::process
    D[Post-Process<br/>Results]:::process
    E[Generate Analysis<br/>Dashboards]:::output

    A --> B --> C --> D --> E

    class A,B,C,D,E codeTheme;
    `;
}

/**
 * Generates flowchart for compliance recipes.
 */
function generateComplianceFlowchart() {
    return `
    A[Configure Multiple<br/>Checks]:::input
    B[Run Daylight<br/>Provision]:::subprocess
    C[Run Sunlight<br/>Exposure]:::subprocess
    D[Run View<br/>Analysis]:::subprocess
    E[Run Glare<br/>Protection]:::subprocess
    F[Generate Compliance<br/>Report]:::output

    A --> B
    A --> C
    A --> D
    A --> E
    B --> F
    C --> F
    D --> F
    E --> F

    class A,B,C,D,E,F codeTheme;
    `;
}

/**
 * Generates flowchart for electric lighting recipes.
 */
function generateElectricFlowchart() {
    return `
    A[Configure Lighting<br/>System]:::input
    B[Define Task<br/>& Surrounding Areas]:::process
    C[Calculate Illuminance<br/>Distribution]:::process
    D[Compute Uniformity<br/>& Compliance]:::process
    E[Generate Standards<br/>Report]:::output

    A --> B --> C --> D --> E

    class A,B,C,D,E codeTheme;
    `;
}

/**
 * Generates flowchart for energy analysis recipes.
 */
function generateEnergyFlowchart() {
    return `
    A[Configure Lighting<br/>& Controls]:::input
    B[Generate Blind<br/>Operation Schedule]:::subprocess
    C[Run Annual Illuminance<br/>with Dynamic Blinds]:::process
    D[Calculate Lighting<br/>Energy Consumption]:::process
    E[Generate Energy<br/>Savings Report]:::output

    A --> B --> C --> D --> E

    class A,B,C,D,E codeTheme;
    `;
}

/**
 * Generates flowchart for facade analysis recipes.
 */
function generateFacadeFlowchart() {
    return `
    A[Define Façade<br/>Analysis Plane]:::input
    B[Generate Annual<br/>Sky Matrix]:::process
    C[Calculate Daylight<br/>Coefficients]:::subprocess
    D[Compute Annual<br/>Irradiation]:::process
    E[Generate Façade<br/>Heatmap]:::output

    A --> B --> C --> D --> E

    class A,B,C,D,E codeTheme;
    `;
}

/**
 * Generates flowchart for annual radiation recipes.
 */
function generateAnnualRadiationFlowchart() {
    return `
    A[Define Interior<br/>Sensor Grids]:::input
    B[Generate Annual<br/>Sky Conditions]:::process
    C[Calculate Radiation<br/>Coefficients]:::subprocess
    D[Compute Annual<br/>Solar Load]:::process
    E[Generate Surface<br/>Heatmaps]:::output

    A --> B --> C --> D --> E

    class A,B,C,D,E codeTheme;
    `;
}

/**
 * Generates generic flowchart for unspecified recipes.
 */
function generateGenericFlowchart() {
    return `
    A[Configure<br/>Parameters]:::input
    B[Prepare<br/>Scene Data]:::process
    C[Run<br/>Simulation]:::subprocess
    D[Process<br/>Results]:::process
    E[Generate<br/>Output]:::output

    A --> B --> C --> D --> E

    class A,B,C,D,E codeTheme;
    `;
}

/**
 * Parses the guide text, generates enhanced flowcharts, and sets up the recipe guides panel.
 */
function setupRecipeGuidesPanel() {
    const dom = getDom();

    const guideText = `
# Guide to the "Illuminance Map" Recipe

The Illuminance Map recipe is a foundational Radiance workflow designed to perform a point-in-time daylighting analysis. Its purpose is to calculate the amount of light (illuminance, measured in lux) falling on specific surfaces within your model at a single, precise moment (e.g., the summer solstice at noon). This guide is broken down into two main parts: the essential scene setup required before using the recipe, and the specific parameters within the recipe itself.

## Workflow Overview
This recipe follows a standard point-in-time simulation workflow:
1. Generate sky conditions for the specified date/time
2. Compile scene geometry and materials
3. Calculate illuminance at each sensor point
4. Generate results visualization
## Part 1: Foundational Scene Setup (Prerequisites)

Before you can successfully run an illuminance map simulation, you must first define the physical and environmental context of your scene. The recipe depends entirely on the data configured in these panels.
### Step 1: Model the Physical Space

Your 3D model must be fully defined. This involves several key panels:

#### A. Dimensions & Geometry (Toolbar Icon 2): Define the core architecture.
- **Dimensions:** Set the room's **Width (X)**, **Length (Z)**, and **Height (Y)**.
- **Orientation:** This is critical. It sets the building's rotation relative to North. An orientation of **0** degrees (the default) means the "South" wall in the Apertures panel faces true South, receiving the most direct sun in the northern hemisphere.
#### B. Apertures & Shading (Toolbar Icon 3): This is where daylight enters your model.
- **Select a Wall:** Click on a wall in the 3D view to bring up its controls.
- **Add Windows:** Use either **WWR (Window-to-Wall Ratio)** mode for quick parametric design or **Manual** mode for specific window dimensions. At least one window is necessary for a daylighting simulation.
- **Define Shading:** If your design includes overhangs, fins, light shelves, or louvers, you must enable and configure them here. These elements will realistically block or redirect sunlight in the simulation.
#### C. Material Properties (Toolbar Icon 5): The properties of your surfaces determine how light reflects and distributes within the space.
- **Set Reflectance:** For the **Walls, Floor,** and **Ceiling**, set a plausible **Reflectance** value. Typical interior values range from 0.8 for a white ceiling to 0.5 for light-colored walls and 0.2 for a dark floor.
- **Set Glazing Transmittance:** For the **Glazing** material, set the **Transmittance**. This controls how much light passes through the glass. A value of **0.7** is a reasonable starting point for standard double-pane glazing.
### Step 2: Establish Geographic Location & Climate

The simulation calculates the sun's position and sky's brightness based on its location on Earth.
1. Open the **Project Setup** panel (Toolbar Icon 1).
2. Provide the location using one of two methods:
    - **(Recommended) Upload EPW File:** Click **"Upload EPW File"** and select a climate data file for your desired location. This is the most accurate method and will automatically populate the Latitude and Longitude fields.
- **Manual Entry:** If you don't have an EPW file, you can manually type the **Latitude** and **Longitude** into the input fields. The interactive map will update accordingly.

### Step 3: Define the Analysis Grid (Critical)

This is the most important prerequisite. You must tell Radiance *where* to perform the calculations. Without a sensor grid, the simulation has no points to measure and will fail.
1. Open the **Sensor Grid** panel (Toolbar Icon 6).
2. Ensure the **"Illuminance Grid"** checkbox at the top is **enabled**.
3. In the **Surface Selection** area, check the box for each surface you want to analyze. For a standard workplane analysis, you would check **"Floor"**.
4. Configure the grid parameters for your selected surface(s). For a floor grid:
    - **Show in 3D View:** It is highly recommended to check this to visualize where your sensors are.
- **Spacing:** This determines the density of measurement points. A smaller value (e.g., **0.25m**) creates a more detailed, higher-resolution map but increases computation time. A larger value (e.g., **1.0m**) is faster but less detailed.
- **Height Offset:** This sets the height of the measurement plane above the selected surface. For a standard office workplane, this should be set to **0.8 meters**.
## Part 2: Configuring and Running the Recipe

With the scene fully defined, you can now configure the Illuminance Map recipe.
### Step 4: Configure Recipe-Specific Parameters
1. Open the **Simulation** panel (Toolbar Icon toggle-modules-btn).
2. From the **"Select Recipe"** dropdown, choose **"Recipe: Illuminance Map"**.
3. The panel will now show settings specific to this simulation:
    - **Sky Definition (\`gensky\`):** This sets the **exact moment in time** for the analysis. The sun's position and sky conditions will be calculated for this instant.
- **Month, Day, Time:** Set these to the specific date and time you wish to investigate.
- **Quality Preset:** This is a shortcut for controlling simulation accuracy vs. speed. It adjusts the core Radiance ambient parameters found in the "Global Simulation Parameters" section.
- **Draft:** Use for very quick initial checks. Expect a "splotchy" and less accurate result.
- **Medium:** A good balance for most design iterations.
        - **High:** Recommended for final, presentation-quality results. This takes the longest to compute.
    - **Grid-Based Illuminance (\`rtrace\`):** These settings control the core ray-tracing command. For this recipe, the default settings are almost always correct.
        - **Calculation Mode:** Leave this on **Irradiance (-I)**. The script will automatically convert the final results to illuminance (lux).
### Step 5: Generate and Run the Simulation
1. Click the **Generate Package** button. This compiles all your scene data and recipe settings into a complete, runnable Radiance project folder, including the master simulation script.
2. You will see the script's content appear in the text box.
3. Click the **Run Simulation** button. The **Simulation Console** will open and display the live output from the Radiance commands (\`gensky\`, \`oconv\`, \`rtrace\`).
4. The simulation is complete when the console reports a success message.
### Step 6: Visualize the Results
1. Open the **Analysis** panel (Toolbar toggle-analysis-btn).
2. Click **Load Results File (A)**.
3. Navigate to your project folder, then into the \`08_results\` subfolder, and select the generated illuminance file (e.g., \`MyProject_illuminance.txt\`).
4. The application will parse the data and display a false-color heatmap on the sensor grid in the 3D viewport.
5. The **Results Dashboard** will also appear, showing summary statistics like the minimum, maximum, and average illuminance across the grid.

# Guide to the "Photorealistic Rendering" Recipe

This recipe is designed to create a single, physically-based, high-dynamic range (HDR) image of your scene. It captures the lighting conditions from a specific viewpoint at a single moment in time, making it ideal for visual analysis, presentations, or as a basis for glare calculations.
## 1. Foundational Scene Setup (Prerequisites)

Before generating a rendering, you must define the complete physical and environmental context. The quality of your final image is directly dependent on the detail and accuracy of this setup.
### Step 1: Model the Physical Space
The 3D model must be fully defined, just as with other simulation types.
- **A. Dimensions & Geometry (Toolbar Icon 2):** Establish the room's **Width, Length, Height,** and **Orientation**. The orientation is crucial as it dictates how sunlight will enter the space through your windows.
- **B. Apertures & Shading (Toolbar Icon 3):** Define all windows and any shading systems. The size, placement, and type of shading will directly impact the light patterns, shadows, and overall brightness of your rendered image.
- **C. Material Properties (Toolbar Icon 5):** The visual appearance of your scene is determined by its materials.
- **Set Reflectance & Color:** For opaque surfaces like walls, floors, and ceilings, set the **Reflectance**. The color swatch for each material will update accordingly, giving you a preview in the 3D viewport.
- **Set Glazing Transmittance:** For the **Glazing** material, adjust the **Transmittance** to control the clarity and brightness of the glass.
### Step 2: Establish Geographic Location & Climate
Radiance calculates the sun's position and the sky's appearance based on your project's location.
1. Open the **Project Setup** panel (Toolbar Icon 1).
2. Provide the location by either **uploading an EPW file** (recommended) or by **manually entering the Latitude and Longitude**.
### Step 3: Define the Viewpoint (Critical)
This is the most critical prerequisite for this recipe. You must tell Radiance *from where* to render the image. The final image will be generated from the exact perspective of this virtual camera.
1. Open the **Viewpoint** panel (Toolbar Icon 7).
2. **Set the View Type:**
    - For standard architectural renderings, select **Perspective**.
- For glare analysis or special visualizations, you might select **Fisheye**.
3. **Position the Camera:** You have two main methods:
    - **Sliders:** Use the **Position (vp)** and **Direction (vd)** sliders to numerically define the camera's location and where it's looking.
- **(Recommended) First-Person View (FPV):** Click the **"Enter Viewpoint"** button. You can now navigate the scene using your mouse and keyboard (W, A, S, D) as if you were in a video game. This is the most intuitive way to frame the perfect shot. Click "Exit Viewpoint" when you are done.
4. **Adjust Field of View (FOV):** The FOV slider controls the zoom or extent of the view, similar to a camera lens.
## 2. Recipe-Specific Parameters

Once the scene and viewpoint are set, you can configure the rendering recipe itself.
### Step 4: Configure Recipe Parameters
1. Open the **Simulation** panel (Toolbar toggle-modules-btn).
2. From the **"Select Recipe"** dropdown, choose **"Recipe: Photorealistic Rendering"**.
3. The panel will display the following settings:
    - **Sky Definition (\`gensky\`):** Sets the exact date and time for the simulation. The sun's position, color, and sky brightness will be calculated for this moment.
- **Quality Preset:** This is a crucial setting that balances image quality against rendering time. It adjusts the core ambient calculation parameters in the "Global Simulation Parameters" section.
- **Draft:** Very fast, but will produce a noisy, splotchy image. Good for quick lighting checks.
- **Medium:** A good balance for most iterative design checks.
        - **High:** Recommended for final, presentation-quality images. This will take significantly longer to compute.
    - **Image-Based Rendering (\`rpict\`):** These parameters control the \`rpict\` command, which generates the image.
- **Image Size & Resolution:** Set the output image dimensions in pixels using the **X Resolution** and **Y Resolution** fields.
- **Image Sampling & Filtering:** These advanced settings control anti-aliasing. For most uses, leaving them at the preset defaults is sufficient.
### Step 5: Generate and Run the Simulation
1. Click the **Generate Package** button. This action compiles all your settings and creates the necessary files (\`scene.rad\`, \`materials.rad\`, \`viewpoint.vf\`) and the master simulation script (e.g., \`RUN_Project_Rendering.sh\`) in your project's \`07_scripts\` folder.
2. Click the **Run Simulation** button. The **Simulation Console** will appear, showing the live progress from the Radiance commands.
3. Rendering an image can take anywhere from a few seconds to many minutes, depending on your quality settings and scene complexity.
## 3. Viewing and Analyzing the Output

The simulation's primary output is a High-Dynamic Range (HDR) image.
- **File Location:** The image (e.g., \`MyProject.hdr\`) is saved in the \`09_images/hdr\` subfolder within your project directory.
- **Viewing the Image:**
    1. Open the **Analysis** panel (Toolbar toggle-analysis-btn).
2. Click **Load Results File (A)** and select the \`.hdr\` file you just generated.
3. A new button, **View HDR Image**, will appear. Click it.
4. The **HDR Image Viewer** will open, displaying your rendering.
- **Analyzing in the Viewer:** The HDR viewer is a powerful tool.
- **Exposure:** Use the slider to adjust the image's brightness, simulating how the human eye adapts to different light levels.
- **False Color:** Enable this mode to see a heatmap of the luminance (cd/m²) in your scene, helping you identify areas that are too bright or too dark.
- **Luminance Probe:** Hover your mouse over any point in the image to get a precise luminance reading in cd/m².

# Guide to the "Daylight Glare Probability (DGP)" Recipe

The Daylight Glare Probability (DGP) recipe is a specialized workflow for assessing visual discomfort within your space. It simulates a 180° fisheye image from a specific observer's point of view and analyzes it to calculate a DGP value between 0 (no perceptible glare) and 1 (unbearable glare). This guide details the essential setup steps and the recipe-specific parameters you need to configure for a correct and meaningful analysis.
## Part 1: Foundational Scene Setup (Prerequisites)

The accuracy of a glare simulation is highly sensitive to the scene's setup. The following steps are mandatory.

### Step 1: Model the Physical Space
The geometry and materials are the primary drivers of glare. Ensure they are defined accurately.
- **Dimensions & Geometry (Toolbar Icon 2):** Set the room's **Width, Length, Height,** and especially its **Orientation**. The orientation determines which facades are exposed to direct sun at critical times of the day.
- **Apertures & Shading (Toolbar Icon 3):** Define all windows and shading systems. Unprotected glazing is the most common cause of glare, so accurately modeling overhangs, fins, blinds, or other mitigation strategies is crucial for the analysis.
- **Material Properties (Toolbar Icon 5):** Set realistic **Reflectance** values for all surfaces. Highly reflective or glossy materials can cause significant secondary (reflected) glare. The **Glazing Transmittance** value directly impacts how much light enters the space.
### Step 2: Establish Geographic Location
The sun is the primary source of daylight glare. Its position is calculated based on your project's location.
1. Open the **Project Setup** panel (Toolbar Icon 1).
2. Provide the location by either **uploading an EPW file** or by **manually entering the Latitude and Longitude**. This data is used by the \`gensky\` command in the simulation script.
### Step 3: Define the Observer's Viewpoint (CRITICAL)
This is the most critical step for a DGP analysis. The entire calculation is performed from a single, specific observer position and gaze direction.
1. Open the **Viewpoint** panel (Toolbar Icon 7).
2. **Set View Type to Fisheye:** This is **mandatory**. From the "View Type" dropdown, you must select **Fisheye (h)**. The \`evalglare\` program requires a 180° hemispherical image to correctly analyze the entire visual field. A standard "Perspective" view will produce incorrect DGP results.
3. **Position the Observer:** Place the virtual camera at a realistic occupant location.
- Use the **"Enter Viewpoint" (FPV)** mode for an intuitive, first-person placement (e.g., seated at a desk).
- Alternatively, use the **Position (vp)** sliders. Pay close attention to the **Y (Height)** value, which should correspond to a typical eye height (e.g., **1.2 meters** for a seated person).
4. **Set the Gaze Direction:** Aim the camera where an occupant would normally be looking.
- **Pro Tip:** For a worst-case office scenario, aim the camera towards a potential computer screen location, not directly out the window. This represents a more realistic task view. Adjust the **Direction (vd)** sliders or aim the camera in FPV mode.
## Part 2: Configuring and Running the Recipe

With the scene and observer viewpoint correctly set, you can configure the simulation recipe.
### Step 4: Configure the DGP Recipe
1. Open the **Simulation** panel (Toolbar toggle-modules-btn).
2. From the **"Select Recipe"** dropdown, choose **"Recipe: Daylight Glare Probability"**.
3. Configure the specific settings for this recipe:
    - **Sky Definition (\`gensky\`):** Select a "worst-case" time for glare. This is often a clear day when the sun is at a low altitude and might be in the observer's field of view (e.g., an afternoon in winter). Set the **Month, Day, and Time** accordingly.
    - **Quality Preset:** Glare is caused by very bright areas, which can be small. It is highly sensitive to rendering quality.
        - **High (Accurate):** This setting is **strongly recommended**. The recipe defaults to high-quality ambient parameters (\`ab=6\`, \`ad=2048\`, etc.) to ensure that small, intense light sources (like specular reflections) are accurately captured. Using lower quality presets can lead to inaccurate DGP values.
- **Daylight Glare Probability (\`evalglare\`):** These switches control the \`evalglare\` analysis program.
        - **Create Check File (-c):** Keep this **checked**. The script will generate a verification image where all pixels identified as glare sources are highlighted in red. This is invaluable for understanding the source of the glare.
        - **Detailed Output (-d):** Keep this **checked**. This generates a text report listing the properties (luminance, size, position) of each individual glare source found in the image.
### Step 5: Generate and Run the Simulation
1. Click the **Generate Package** button. The application will create all necessary files and the master script (\`RUN_..._DGP_Analysis.sh\` or \`.bat\`) in your project folder.
2. Click the **Run Simulation** button. The console will show the progress. The script first runs \`rpict\` to render the high-quality 180° fisheye HDR image, and then runs \`evalglare\` to analyze it.
## Part 3: Viewing and Analyzing the Output

The simulation produces two key files in the \`08_results\` folder and one in the \`09_images/hdr\` folder:
- **DGP Report (.txt):** Contains the final DGP value and detailed source information.
- **Fisheye Image (.hdr):** The image that was analyzed.
- **Glare Check Image (_check.hdr):** The verification image with glare sources highlighted.
To analyze the results within Ray Modeler:
1. Open the **Analysis** panel (Toolbar toggle-analysis-btn).
2. Click **Load Results File (A)** and select the generated \`.txt\` report file.
3. The **Glare Analysis Dashboard** will automatically appear, showing:
    - The final calculated **DGP value**.
- The total number of glare sources detected.
    - A clickable list of each individual source.
4. **Interactive Analysis:** Click on a source in the list. The application will project its location back into the 3D scene, highlighting the exact surface (e.g., a specific window pane, a reflective frame) that caused the glare. This provides direct, actionable feedback for your design.
5. You can also load and view the \`.hdr\` files in the **HDR Image Viewer** for a full visual inspection.

# Guide to the "Daylight Factor" Recipe

This recipe automates the classic method for assessing daylight performance. It calculates the **Daylight Factor (DF)**, which is the ratio of the internal illuminance at a point to the simultaneous, unobstructed external horizontal illuminance under a standard CIE overcast sky. The result is expressed as a percentage.

## 1. Foundational Scene Setup (Prerequisites)

For an accurate Daylight Factor calculation, the physical characteristics of the space are paramount.
### Step 1: Model the Physical Space
The geometry and materials directly influence the internal light distribution.
- **A. Dimensions & Geometry (Toolbar Icon 2):** Define the room's **Width, Length,** and **Height**. While orientation is less critical for a uniform overcast sky, it's good practice to set it correctly.
- **B. Apertures & Shading (Toolbar Icon 3):** *This is critical.* The size, number, and placement of your windows are the primary factors determining the Daylight Factor. Define them accurately. Any external obstructions or shading devices will also significantly impact the result.
- **C. Material Properties (Toolbar Icon 5):** The **Reflectance** of your interior surfaces (walls, floor, ceiling) is very important. Higher reflectance values will increase the *internally reflected component* of the daylight factor, leading to higher overall DF values, especially deeper in the room.
### Step 2: Define the Analysis Grid (Critical)
You must tell Radiance where to calculate the internal illuminance. Without a sensor grid, the simulation has no measurement points.
1. Open the **Sensor Grid** panel (Toolbar Icon 6).
2. Ensure the **"Illuminance Grid"** checkbox is **enabled**.
3. Under **Surface Selection**, check the box for **"Floor"** to create a standard analysis plane.
4. Configure the grid parameters:
    - **Spacing:** A smaller spacing (e.g., **0.5m**) will produce a more detailed DF map.
- **Height Offset:** Set this to your desired workplane height (e.g., **0.8 meters**).
## 2. Recipe-Specific Parameters

Once the scene is modeled, you can configure the Daylight Factor recipe itself.
### Step 3: Configure the DF Recipe
1. Open the **Simulation** panel (Toolbar toggle-modules-btn).
2. From the **"Select Recipe"** dropdown, choose **"Recipe: Daylight Factor"**.
3. The panel will display the following settings, which control the \`gensky\` Radiance command:
    - **Quality Preset:** Controls the ambient calculation parameters for \`rtrace\`. For DF, **"Medium (Balanced)"** is usually sufficient for reliable results.
- **\`gensky\` Parameters for DF:**
        - **Sky Type:** For a standard Daylight Factor calculation, this **must be set to Overcast (-c)**. This creates the uniform, diffuse sky condition required by the DF definition.
- **Ground Reflectance (-g):** This simulates the light reflecting from the ground outside the building. A value of **0.2** is standard.
        - **Diffuse Horizontal Irradiance (-B):** This is a technical but crucial parameter. To achieve the standard reference exterior illuminance of 10,000 lux for DF calculations, the script uses a specific horizontal irradiance value of **55.866 W/m²**. You should not change this value for a standard DF analysis.
## 3. Generating and Running the Simulation

After configuring the parameters, follow these steps to execute the analysis.
### Step 4: Generate and Run
1. Click the **Generate Package** button. This action compiles your scene and settings into a complete Radiance project, including the executable script (\`RUN_..._Daylight_Factor.sh\` or \`.bat\`).
2. Click the **Run Simulation** button. The **Simulation Console** will appear, showing the progress.
The script performs the following key steps:
    - \`gensky\`: Creates the overcast sky.
- \`oconv\`: Compiles the scene geometry and sky into an octree file.
- \`rtrace\`: Calculates the interior illuminance at each point on your sensor grid.
- \`rcalc\`: Takes the \`rtrace\` results and calculates the final percentage: \`DF = (Internal Lux / 10,000 Lux) * 100\`.
## 4. Viewing and Analyzing the Output

The simulation produces a text file in your project's \`08_results\` folder (e.g., \`MyProject_df_results.txt\`).
- **Content:** This file contains a single column of numbers. Each number is the calculated **Daylight Factor as a percentage** for one sensor point.
- **Visualization:**
    1. Open the **Analysis** panel.
2. Click **Load Results File (A)** and select the generated \`_df_results.txt\` file.
3. The application will display a false-color heatmap on the 3D sensor grid, allowing you to visually assess the daylight distribution. Areas with DF above 2% are generally considered well daylit.

# Guide to the "Annual daylight (3-Phase)" Recipe

The Annual Daylight (3-Phase) recipe is a powerful and efficient method for calculating hourly illuminance levels across a full year (8,760 hours). It is particularly useful for analyzing designs with complex fenestration systems (like blinds, frits, or electrochromic glass) because it decouples the simulation into independent phases. This means you can swap out the glazing system without having to re-run the entire time-consuming simulation from scratch. This guide will walk you through the entire workflow, from preparing your model to analyzing the final annual results.
## Part 1: Foundational Scene Setup (Prerequisites)

The accuracy of the 3-Phase method depends on a complete and correct definition of your scene. All steps in this section are mandatory.

### Step 1: Model the Physical Space
The geometry and materials of your room form the basis for the core simulation matrices.
- **A. Dimensions & Geometry (Toolbar Icon 2):** Define the room's **Width, Length, Height,** and **Orientation**.
- **B. Apertures & Shading (Toolbar Icon 3):** Accurately model all windows and any static shading devices (like overhangs or fins). The geometry of these elements is baked into the Daylight and View matrices.
- **C. Material Properties (Toolbar Icon 5):**
    - Set the **Reflectance** for all interior surfaces (walls, floor, ceiling). These values are critical for accurately calculating the internally reflected light.
- The material named \`glass_mat\` is specially treated by the simulation script as the boundary between the interior and the exterior sky. The transmittance value you set here is primarily for 3D viewport visualization; the actual optical properties for the simulation will come from the BSDF file.
### Step 2: Define the Analysis Grid (Critical)
The sensor grid defines the points where illuminance will be calculated. This grid is the input for generating the **View Matrix (V)**.
1. Open the **Sensor Grid** panel (Toolbar Icon 6).
2. Enable the **"Illuminance Grid"** and, under **Surface Selection**, check the box for the surfaces you want to analyze (typically the **"Floor"**).
3. Set the **Height Offset** to your desired workplane height (e.g., **0.8 meters**). The **Spacing** will determine the resolution of your final results.
### Step 3: Acquire and Load External Data Files (Critical)
The 3-Phase method requires two specific external data files. You must provide these yourself.
- **A. EPW Weather File:**
    - **What it is:** An EnergyPlus Weather (EPW) file contains hourly climate data for a specific location for an entire year, including solar radiation values.
- **Why it's needed:** The recipe uses this file with the \`gendaymtx\` command to generate the **Sky Matrix (S)**, which describes the brightness of 145 different patches of the sky for all 8,760 hours of the year.
- **Where to get it:** You can download free EPW files from several official repositories:
        - EnergyPlus Weather Database: The primary source, with thousands of locations worldwide.
- Ladybug Tools EPWMap: A user-friendly map for finding and downloading weather files.
- **How to load it:** In the **Project Setup** panel, click **"Upload EPW File"** and select the \`.epw\` file you downloaded. The project's Latitude and Longitude will be updated automatically.
- **B. BSDF XML File:**
    - **What it is:** A Bidirectional Scattering Distribution Function (BSDF) file is a standard format (.xml) that describes the complex angular transmission and reflection properties of a fenestration system.
- **Why it's needed:** This file represents the **Transmission Matrix (T)**. The \`dctimestep\` command uses it to calculate how much light from each of the 145 sky patches passes through the glazing at every possible angle.
- **Where to get it:**
        - Window Manufacturers: Many manufacturers provide BSDF files for their specific products.
- LBNL International Glazing Database (IGDB): A large collection of glazing data that can be used in the free **LBNL WINDOW** software to generate custom BSDF files for complex assemblies (e.g., double-glazing with an interior blind).
- **How to load it:** In the **Material Properties** panel, under the **Glazing** section, enable the **"Add BSDF" toggle and upload your \`.xml\` file**.
## Part 2: Configuring and Running the Recipe

With the scene fully prepared, you can now configure and run the simulation.
### Step 4: Configure the 3-Phase Recipe
1. Open the **Simulation** panel (Toolbar toggle-modules-btn).
2. From the **"Select Recipe"** dropdown, choose **"Recipe: Annual Daylight (3-Phase)"**.
3. The panel will display the following settings:
    - **Quality Preset:** This is a crucial setting. The matrix generation step is computationally expensive. It is **highly recommended to use the "High (Accurate)" preset**. This ensures your core matrices (\`view.mtx\` and \`daylight.mtx\`) are precise and can be reused for future analyses without recalculation.
- The UI will also show fields for the **Weather File** and **BSDF File**, confirming that they are linked from the other panels.
### Step 5: The Two-Script Workflow
The 3-Phase method separates the simulation into two stages. When you click "Generate Package," two scripts are created to manage this process. You must run them in order.
1. **Generate the Scripts:** Click the **Generate Package** button. This creates your project folder structure and saves two scripts in the \`07_scripts\` folder.
2. **Run Script 1: \`RUN_..._3ph_Matrix_Generation.sh\`**
    - **What it does:** This script runs the time-consuming \`rcontrib\` command twice to create the geometry-dependent matrices.
- **Daylight Matrix (D):** Traces rays from the exterior of the glazing *outwards* to the sky to determine how much of the sky each window can see.
- **View Matrix (V):** Traces rays from the sensor points *outwards* through the glazing to determine what each sensor point "sees" through the window.
- **When to run it:** You only need to run this script **once** for a given room geometry, sensor grid, and interior material setup.
3. **Run Script 2: \`RUN_..._3ph_Annual_Simulation.sh\`**
    - **What it does:** This script is much faster. It first runs \`gendaymtx\` to generate the **Sky Matrix (S)** from your EPW file. Then, it uses the \`dctimestep\` command to multiply all four matrices together (V x T x D x S) for every hour of the year, producing the final illuminance results.
- **When to run it:** You can run this script repeatedly. If you want to test a different glazing system, simply load a new BSDF file in the UI, regenerate the package (this will update the file link), and re-run **only this second script**.
## Part 3: Viewing and Analyzing the Output

- **File Output:** The final result is a binary \`.ill\` file (e.g., \`MyProject.ill\`) saved in your \`08_results\` folder. It contains 8,760 hourly illuminance values for every sensor point.
- **Analysis in Ray Modeler:**
    1. Open the **Analysis** panel.
2. Click **Load Results File (A)** and select the \`.ill\` file.
3. The application will automatically detect the annual data format and enable advanced analysis tools:
        - **Results Dashboard:** View key annual performance metrics like **sDA (Spatial Daylight Autonomy)** and **UDI (Useful Daylight Illuminance)**.
- **Time-Series Explorer:** Use the **Time Scrubber** to visualize the illuminance heatmap on your 3D model for any hour of the year.
- **Temporal Map:** Right-click a sensor point in the 3D view to open a detailed 24x365 heatmap showing the hourly performance of that specific location.

# Guide to the "sDA & ASE (LM-83)" Recipe

The sDA & ASE (LM-83) recipe automates the full simulation workflow required by the IES standard LM-83-12 for calculating **Spatial Daylight Autonomy (sDA)** and **Annual Sun Exposure (ASE)**. Instead of just calculating daylight for a static scene, this recipe simulates a "virtual occupant" who operates the blinds based on direct sunlight. The final result for sDA is a combination of hours when the blinds are open and hours when they are closed, providing a much more realistic prediction of annual daylight performance.
## The Detailed Workflow Explained

The script generated by this recipe orchestrates a complex, multi-step simulation using the Radiance 3-Phase Method as its foundation. Understanding these steps is key to interpreting the results correctly.
1.  **Generate Annual Sky Descriptions:** The process begins by reading your **EPW weather file**. From this, it generates two 8760-hour sky descriptions (matrices):
    - **Total Sky Matrix:** Represents the light from both the diffuse sky and the direct sun for every hour of the year.
- **Direct Sun-Only Sky Matrix:** Represents *only* the light coming directly from the sun for every hour. This is crucial for identifying glare potential.
2.  **Calculate Annual Direct Illuminance:** The script then performs an initial annual simulation using only the **direct sun-only sky matrix** and your **"blinds open" BSDF file**. This calculates, for every sensor point and every hour, how much light is received *only* from the direct sun passing through the unshaded windows.
3.  **Calculate Annual Sun Exposure (ASE):** The results from the previous step are used to calculate ASE. The standard defines ASE as the percentage of the workplane that receives at least **1000 lux** of direct sunlight for at least **250 hours** per year.
4.  **Generate a Dynamic Blind Schedule:** A Python script (\`process_sDA.py\`) analyzes the direct illuminance results from Step 2. It acts as a virtual occupant with the following logic for each occupied hour:
    - It checks how many sensor points on the grid are receiving more direct sunlight than the specified **Illuminance Threshold** (default is 1000 lux).
- If the percentage of points exceeding the threshold is greater than the **Area Trigger** (default is 2%), the script assumes the blinds are closed for that hour. - Otherwise, the blinds remain open.
    - This process creates an 8760-hour schedule file (\`blinds.schedule\`) where each hour is marked as **0** (open) or **1** (closed).
5.  **Calculate Total Annual Illuminance (Blinds Open):** A second full annual simulation is run. This time, it uses the **total sky matrix** and the **"blinds open" BSDF file**. This produces an 8760-hour illuminance file (\`results_open.ill\`) for the scenario where blinds are never used.
6.  **Calculate Total Annual Illuminance (Blinds Closed):** A third full annual simulation is run, using the **total sky matrix** and the **"blinds closed" BSDF file**. This produces another 8760-hour illuminance file (\`results_closed.ill\`) for the scenario where the blinds are always down.
7.  **Combine Results for Final sDA Calculation:** The Python script runs a final time. It reads the \`blinds.schedule\` and creates a final, combined results file (\`<project>_sDA_final.ill\`). For each hour:
    - If the schedule says **0** (open), it copies the illuminance data for that hour from \`results_open.ill\`.
- If the schedule says **1** (closed), it copies the data for that hour from \`results_closed.ill\`.
- This final, combined file is what you use to accurately calculate sDA.
## Step-by-Step Guide to Run the sDA & ASE Recipe

Follow these steps precisely to set up and execute the simulation.
### Part 1: Prerequisite Steps (MUST be done first)

#### Step 1: Generate the V and D Matrices
This recipe relies on pre-computed matrices that describe how light moves through your scene. These must be generated *before* you run the sDA/ASE simulation.
1. Click the **Simulation** button on the left toolbar to open the **Simulation** panel.
2. In the **Recipe Selector** dropdown, choose **Recipe: Annual Daylight (3-Phase)**.
3. Load your **Weather File (.epw)** and your primary **BSDF File (.xml)** for your glazing.
4. Click **Generate Package**.
5. Click **Run Simulation** and wait for the process to complete in the console. This step can take a significant amount of time.

#### Step 2: Set Up Core Project Data
Before configuring the recipe, ensure your base project is set up correctly.
- **Location & Climate:** Open the **Project Setup** panel. Click **Upload EPW File** and select your climate file. This is mandatory for any annual analysis.
- **Sensor Grid:** Open the **Sensor Grid** panel.
- Ensure the **Illuminance Grid** checkbox is enabled.
    - Under **Surface Selection**, ensure the **Floor** checkbox is checked. The sensor points on the floor represent the workplane where sDA and ASE are measured.
- **Occupancy Schedule (Recommended):** Open the **Project Setup** panel again.
    - Check the **Generate Occupancy Schedule** box.
- Set the occupied days and time range appropriate for your building.
    - Click **Generate & Save Schedule**. This creates an \`occupancy.csv\` file that the analysis will use to filter for relevant hours.
### Part 2: Configure and Run the sDA & ASE Recipe

#### Step 3: Configure the Recipe Inputs
1. Open the **Simulation** panel.
2. From the **Recipe Selector** dropdown, choose **Recipe: sDA & ASE (LM-83)**.
3. Fill in the required inputs in the panel that appears:
    - **Weather File (.epw):** Select the same EPW file you loaded in the Project Setup panel.
- **BSDF - Blinds Open (.xml):** Provide a BSDF XML file that represents your glazing system *without any shading devices*.
- **BSDF - Blinds Closed (.xml):** Provide a second BSDF XML file that represents your glazing system *with the blinds or shades fully deployed*.
- **Illuminance Threshold (lux):** This is the level of *direct* sunlight on the workplane that triggers the virtual occupant to close the blinds. The IES LM-83 standard recommends a default value of **1000 lux**.
- **Area Trigger (%):** This is the percentage of the workplane that must exceed the illuminance threshold before the blinds are closed. The standard recommends a default of **2%**.

#### Step 4: Generate and Run the Simulation
1. Click the **Generate Package** button. This creates the necessary script files (\`.sh\`, \`.bat\`) and the Python helper script (\`process_sDA.py\`) in your project's \`07_scripts\` folder.
2. Click the **Run Simulation** button. The simulation console will appear and show the progress as it moves through the multiple \`dctimestep\` calculations and Python script executions.
## Analyzing Your Results

Once the simulation completes, you will have two primary result files in your \`08_results\` folder. You must load them separately to see the correct metrics.
- **To Analyze Annual Sun Exposure (ASE):**
    1. Click the **Analysis** button on the left toolbar to open the **Analysis** panel.
2. Click **Load Results File (A)**.
    3. Select the file named \`<project_name>_ASE_direct_only.ill\`.
    4. The **Results Dashboard** will appear. Look for the **Annual Metrics Dashboard** to see the calculated **ASE percentage**.
- **To Analyze Spatial Daylight Autonomy (sDA):**
    1. In the **Analysis** panel, click **Load Results File (A)** again (this will replace the ASE file).
2. Select the file named \`<project_name>_sDA_final.ill\`.
    3. The **Results Dashboard** will update, and the **Annual Metrics Dashboard** will now show the calculated **sDA percentage**, which correctly accounts for the hours the blinds were closed.
## Detailed Parameter Summary

| Parameter/Input | UI Location | Purpose & Requirements | Recommended Setting / Notes |
| :--- | :--- | :--- | :--- |
| View & Daylight Matrices | (Generated) | Foundational geometry matrices (\`view.mtx\`, \`daylight.mtx\`). Must be generated by running the \`Annual Daylight (3-Phase)\` recipe first. | Use high-quality Radiance parameters (\`-ab 7\`, \`-ad 4096\`, etc.) for matrix generation. |
| EPW Weather File | \`Project Setup\` & \`sDA Recipe\` | Provides 8760 hours of sun and sky data. Mandatory. | Select the file for your project's location. |
| Sensor Grid | \`Sensor Grid\` | Defines the points on the workplane for calculation. A floor grid is required. | Spacing of 0.5m - 1.0m is typical. Offset should match workplane height (e.g., 0.8m). |
| BSDF - Blinds Open | \`sDA Recipe\` | XML file describing the clear glazing system (no shades). | This is the baseline for your window's performance. |
| BSDF - Blinds Closed | \`sDA Recipe\` | XML file describing the glazing system *with* the shading device deployed. | Critical for simulating the dynamic behavior. |
| Illuminance Threshold | \`sDA Recipe\` | The direct illuminance level (lux) that triggers the blinds. | \`1000 lux\` (IES LM-83 default). |
| Area Trigger | \`sDA Recipe\` | The percentage of the grid that must exceed the threshold to close the blinds. | \`2%\` (IES LM-83 default). |
| Occupancy Schedule | \`Project Setup\` | An 8760-hour CSV file defining occupied hours. Filters results. | Generate from the UI for accuracy. If omitted, a default schedule is used for analysis. |

# Guide to the "Annual Daylight (5-Phase)" Recipe

The 5-Phase Method is an advanced annual daylighting simulation technique that provides higher accuracy than the standard 3-Phase method. It is particularly effective for spaces with complex fenestration systems (CFS) like venetian blinds, prismatic glazing, or fabrics, as it more accurately models the behavior of direct sunlight.
## The Detailed Workflow Explained

The script generated by this recipe automates a complex series of matrix calculations to produce a final, high-fidelity annual illuminance result.
1.  **Generate Core Matrices:** The process begins by creating the foundational matrices that describe your scene's geometry and the annual sky conditions:
    - **View Matrix (V):** Describes the path of light from the *interior side of the windows* to the *sensor points* on your grid.
- **Daylight Matrix (D):** Describes how light from the diffuse sky reaches the *exterior of your windows*.
- **Sky Matrix (S):** Describes the light contribution from the entire sky (diffuse sky + direct sun) for all 8760 hours, based on your EPW file.
- **Direct Sun-Only Sky Matrix (S_direct):** A special sky matrix containing *only* the direct sun component for all 8760 hours.
2.  **Calculate Total Illuminance (3-Phase Method):** The script first calculates the total annual illuminance using a standard 3-Phase approach. It combines the **View (V)**, **Daylight (D)**, and **total Sky (S)** matrices with your standard **Klems BSDF** file. This result is named \`total_3ph.ill\`.
3.  **Calculate the "Inaccurate" Direct Component:** It runs a second 3-Phase calculation, this time combining the **V**, **D**, and **Klems BSDF** matrices with the **direct-sun-only sky matrix (S_direct)**. This isolates the contribution of direct sun as calculated by the lower-resolution Klems BSDF. This result is named \`direct_3ph.ill\`.
4.  **Calculate the "Accurate" Direct Component:** This is the key step of the 5-Phase method. The script runs a third 3-Phase calculation, again using the **direct-sun-only sky matrix (S_direct)**, but this time it substitutes the standard Klems BSDF with the special, high-resolution **Tensor Tree BSDF** file. This accurately models how direct sun rays are transmitted and scattered. This result is named \`direct_5ph.ill\`.
5.  **Combine for Final Result:** The script performs a final matrix operation using \`rmtxop\` to produce the final result file (\`<project_name>_5ph_final.ill\`): **Final Result = (Total 3-Phase Illuminance) - (Inaccurate Direct Component) + (Accurate Direct Component)**. This step effectively replaces the low-resolution direct sun calculation within the total result with the high-resolution one, yielding a final, highly accurate annual illuminance file.
## Required Input Files

This recipe requires **three specific files** that you must provide. Two of these are special BSDF files that must be generated using external software (like LBNL WINDOW and the command-line \`genBSDF\` tool).
- **Weather File (.epw):** Your project's standard EnergyPlus Weather file.
- **Klems BSDF (.xml):** This is the standard, full Klems basis BSDF file for your glazing system. It models how both diffuse light and sunlight are transmitted.
- **Tensor Tree BSDF (.xml):** This is a special, high-angular-resolution BSDF file. Its purpose is to very accurately model the transmission of the direct sun component. You must provide a separate XML file generated in this format for the recipe to work.
## In-App Step-by-Step Guide

Follow these steps precisely to set up and execute the simulation within Ray Modeler.
### Part 1: Core Project Setup
Before configuring the recipe, ensure your base project is set up correctly.
- **Location & Climate:** Open the **Project Setup** panel. Click **Upload EPW File** and select your project's climate file. This is mandatory for any annual simulation.
- **Sensor Grid:** Open the **Sensor Grid** panel. Ensure the **Illuminance Grid** checkbox is enabled, and that the **Floor** grid checkbox is checked. The sensor points on the floor represent the workplane where illuminance will be calculated.
- **Glazing BSDF:** Open the **Materials** panel. In the **Glazing** section, check the **Add BSDF** box and upload your primary **Klems BSDF** file. While the recipe will ask for this file again, setting it here ensures your project file is complete.
### Part 2: Configure the 5-Phase Recipe
1. Open the **Simulation** panel by clicking the **Simulation** icon on the left toolbar.
2. From the **Recipe Selector** dropdown, choose **Recipe: Annual Daylight (5-Phase)**.
3. Fill in the required file inputs in the panel that appears:
    - **Weather File (.epw):** Click to select the same EPW file you loaded in your Project Setup.
- **Klems BSDF (T):** Click to upload your standard, full Klems BSDF file.
- **Tensor Tree BSDF (for Cds):** Click to upload the special Tensor Tree BSDF file required for the high-resolution direct sun calculation.
### Part 3: Generate and Run the Simulation
1. Click the **Generate Package** button. This creates the necessary script files (\`.sh\`, \`.bat\`) in your project's \`07_scripts\` folder.
2. Click the **Run Simulation** button. The simulation console will appear and show the progress as it generates all the required matrices and combines them. This is a very computationally intensive process and may take a long time to complete.
## Analyzing Your Results

Once the simulation completes, you will have one primary result file in your \`08_results\` folder, ready for analysis.
1. Click the **Analysis** button on the left toolbar to open the **Analysis** panel.
2. Click **Load Results File (A)**.
3. Select the file named \`<project_name>_5ph_final.ill\`.
4. The **Results Dashboard** will appear. The **Annual Metrics Dashboard** will now show the calculated **sDA** and **UDI** percentages based on this high-accuracy simulation.
## Detailed Parameter Summary

| Parameter/Input | UI Location | Purpose & Requirements | Recommended Setting / Notes |
| :--- | :--- | :--- | :--- |
| EPW Weather File | \`Project Setup\` & \`5-Phase Recipe\` | Provides 8760 hours of sun and sky data. Mandatory. | Select the file for your project's location. |
| Sensor Grid | \`Sensor Grid\` | Defines the points on the workplane for calculation. A floor grid is required. | Spacing of 0.5m - 1.0m is typical. Offset should match workplane height (e.g., 0.8m). |
| Klems BSDF | \`Materials\` & \`5-Phase Recipe\` | The standard XML file for your window system. Used for diffuse light and the baseline total illuminance calculation. | Required for the **T** matrix. |
| Tensor Tree BSDF | \`5-Phase Recipe\` | A special, high-resolution XML file for your window system. Used for accurately calculating the direct sun component. | Crucial for the method. Must be generated externally. |
| Global Sim Parameters | \`Simulation Panel\` | Radiance quality settings (\`-ab\`, \`-ad\`, etc.) used for matrix generation. | Use high-quality settings (\`-ab 7\`, \`-ad 4096\`, etc.) for best results. The recipe defaults to these. |

# Guide to the "Imageless Annual Glare" Recipe

The Imageless Annual Glare recipe performs an advanced, year-long glare analysis without rendering thousands of individual images. Instead, it uses a matrix-based calculation method (\`rcontrib\` and \`dcglare\`) to efficiently compute the **Daylight Glare Probability (DGP)** for every occupied hour of the year at multiple viewpoints simultaneously. This is the industry-standard method for assessing long-term visual discomfort and is essential for compliance with standards like **EN 17037**. The final outputs are the annual DGP time-series, **Glare Autonomy (GA)**, and **Spatial Glare Autonomy (sGA)**.
## The Detailed Workflow Explained

The script generated by this recipe follows a precise workflow to calculate annual glare.
1.  **Create Scene Octree:** It compiles all your scene geometry (room, shading, context) and materials into a single Radiance octree file for efficient ray tracing.
2.  **Generate Annual Sky Matrix:** It reads your **EPW weather file** and generates an 8760-hour sky matrix (\`sky.mtx\`) that describes the brightness of the entire sky dome for every hour of the year.
3.  **Calculate Direct Daylight Coefficients (D_direct):** Using \`rcontrib\`, the script traces rays from your viewpoints *out* into the scene and calculates how much light reaches them *after only one bounce* (\`-ab 1\`). This matrix (\`dc_direct.mtx\`) isolates the light contribution from the first reflection, which is crucial for identifying glare sources.
4.  **Calculate Total Daylight Coefficients (D_total):** The script runs \`rcontrib\` again, but this time with a high number of ambient bounces (\`-ab 8\`). This matrix (\`dc_total.mtx\`) captures the total illuminance at the viewpoints, including all inter-reflections, which is needed to determine the background luminance for the DGP calculation.
5.  **Calculate Annual DGP:** The \`dcglare\` tool combines the two coefficient matrices (Direct and Total) with the annual sky matrix. It then calculates the DGP value for every viewpoint for every occupied hour of the year, saving the results to \`<project_name>.dgp\`.
6.  **Calculate Glare Autonomy (GA):** The script runs \`dcglare\` a second time. This time, it uses a DGP threshold (e.g., 0.40) to determine the percentage of occupied hours that each viewpoint is *free* of glare. The results are saved to \`<project_name>.ga\`.
7.  **Calculate Spatial Glare Autonomy (sGA):** Finally, \`rcalc\` processes the Glare Autonomy file to determine the percentage of *viewpoints* that meet a specific target (e.g., being glare-free for 95% of the time). This single percentage is the final sGA metric.

## Required Input Files & Setup

This recipe requires specific inputs to be configured correctly in the UI before you can run it.
- **Weather File (.epw):** Your project's standard EnergyPlus Weather file, which provides the annual sky conditions.
- **View Grid (.ray):** This is **the most critical input** for this recipe. It's a file containing the starting positions and directions of thousands of rays, representing multiple viewpoints within your scene. You must generate this within the Ray Modeler application.
- **Occupancy Schedule (.csv) (Optional but Recommended):** An 8760-hour schedule file that tells the simulation which hours to consider for the analysis. If not provided, a default schedule is assumed by the analysis tools.
## In-App Step-by-Step Guide

Follow these steps precisely to set up and execute the simulation.
### Part 1: Core Project Setup
- **Location & Climate:** Open the **Project Setup** panel. Click **Upload EPW File** and select your project's climate file.
- **Generate a View Grid:** This is the most important step for this recipe.
    1. Open the **Sensor Grid** panel.
2. Check the box for **View Grid (for Glare)**. This will reveal the view grid controls.
3. **Spacing:** Set the distance between each viewpoint on the floor plan (e.g., 0.75m).
4. **Height Offset:** Set the height of the viewpoints above the floor, representing eye level (e.g., 1.2m).
5. **Number of Directions:** Set how many directions will be analyzed from each point (e.g., 6 directions will cover a 360° view in 60° increments).
6. Check **Show in 3D View** to see a visualization of the viewpoints and their directions as arrows.
- **Generate an Occupancy Schedule:** In the **Project Setup** panel:
    1. Check the **Generate Occupancy Schedule** box.
2. Set the occupied days and time range for your building.
    3. Click **Generate & Save Schedule**.
### Part 2: Configure the Imageless Glare Recipe
1. Open the **Simulation** panel by clicking the **Simulation** icon on the left toolbar.
2. From the **Recipe Selector** dropdown, choose **Recipe: Imageless Annual Glare**.
3. Fill in the required inputs in the panel that appears:
    - **Weather File (.epw):** Select the same EPW file you loaded in your Project Setup.
- **Occupancy Schedule (.csv) (Optional):** Select the \`occupancy.csv\` file you generated. The script will automatically look for this in your project folder.
- **Glare Threshold (DGP):** Set the DGP value that defines a "glare event". A common value is **0.40**.
- **Spatial Glare Autonomy Target (%):** Set the percentage of time a viewpoint must be glare-free to pass the GA test. A common target is **95%**.

### Part 3: Generate and Run the Simulation
1. Click the **Generate Package** button. This creates the script files (\`.sh\`, \`.bat\`) in your project's \`07_scripts\` folder.
2. Click the **Run Simulation** button. The simulation console will appear and show the progress as it generates the matrices and runs \`dcglare\`. This is a computationally intensive process.

## Analyzing Your Results

After the simulation completes, you can analyze the output to understand the annual glare performance.
1. Open the **Analysis** panel.
2. Click **Load Results File (A)**.
3. Select the file named \`<project_name>.dgp\`.
4. The **Annual Glare Controls** section will appear in the Analysis panel.
5. Click the **Generate Glare Rose Diagram** button. A new window will open, showing a polar chart that visualizes the number of glare hours based on the sun's position in the sky. This helps you identify which solar positions are causing the most frequent glare.

## Detailed Parameter Summary

| Parameter/Input | UI Location | Purpose & Requirements | Recommended Setting / Notes |
| :--- | :--- | :--- | :--- |
| View Grid | \`Sensor Grid\` | **Mandatory.** Defines the multiple viewpoints and directions for the imageless analysis. The script generates a \`.ray\` file from these settings. | A 1.2m height offset is typical for a seated observer. 6-8 directions provide good coverage. |
| EPW Weather File | \`Project Setup\` & \`Imageless Glare Recipe\` | Provides 8760 hours of sun and sky data. Mandatory for annual analysis. | Select the file for your project's location. |
| Occupancy Schedule | \`Project Setup\` & \`Imageless Glare Recipe\` | An 8760-hour CSV file defining occupied hours. This filters the glare analysis to only include relevant times. | Highly recommended for accurate GA and sGA results. |
| DGP Threshold | \`Imageless Glare Recipe\` | The Daylight Glare Probability value above which an hour is considered to have discomforting glare. | """0.40 is a common threshold for ""disturbing"" glare.""" |
| sGA Target | \`Imageless Glare Recipe\` | The percentage of occupied time a single viewpoint must be *below* the DGP threshold to be considered "glare-free". | """95% is a common target (i.e., allowing glare for up to 5% of the time).""" |
| Global Sim Parameters | \`Simulation Panel\` | Radiance quality settings (\`-ab\`, \`-ad\`, etc.) used for the matrix calculations. | High-quality parameters (\`-ab 8\`, \`-ad 4096\`, etc.) are essential for accurate glare results. The recipe defaults to these. |

# Guide to the "Spectral Analysis (Lark)" Recipe

This recipe calculates the full spectral power distribution of light at each sensor point. It then uses a Python script to post-process this data and compute key circadian metrics, such as Circadian Stimulus (CS), Equivalent Melanopic Lux (EML), and Correlated Color Temperature (CCT). This is essential for analyses focused on WELL Building Standards or human-centric lighting design.
## Part 1: Foundational Scene Setup (Prerequisites)

This recipe has unique and critical data requirements beyond the standard geometric setup.
### Step 1: Model the Physical Space
The geometry and shading must be accurately defined as they would be for any other simulation.
- **Dimensions, Apertures, Shading:** Define your room's geometry, windows, and any shading devices. These elements control the amount and direction of light entering the space.
### Step 2: Define the Analysis Grid
You must tell Radiance where to perform the spectral calculations.
1. Open the **Sensor Grid** panel (Toolbar Icon 6).
2. Enable the **Illuminance Grid** and select the surfaces for analysis (e.g., **Floor**).
3. Set the grid's **Spacing** and **Height Offset**.

### Step 3: Acquire and Load Spectral Data Files (CRITICAL)
This is the most important prerequisite. This recipe requires specific text files that describe the spectral properties of your materials and light sources.
- **A. Material Spectral Reflectance Data (SRD):**
    - **What it is:** A simple two-column text file (\`.dat\` or \`.txt\`) where the first column is wavelength (in nanometers) and the second is the material's reflectance at that wavelength.
- **Why it's needed:** The recipe uses this data to create spectrally-accurate materials for the simulation. The script automatically bins this data into the 9 channels required for the Lark method.
- **Where to get it:**
        - From building material manufacturers.
- From scientific material databases (e.g., REFPROP).
        - By measuring physical samples with a spectrometer.
- **How to load it:**
        1. Go to the **Material Properties** panel (Toolbar Icon 5).
2. For **Walls, Floor,** and/or **Ceiling**, switch the **Reflectance Mode** from "Simple" to **"Spectral"**.
3. Click the file input to upload your \`.dat\` file for each material.
- **B. Sun & Sky Spectral Power Distribution (SPD):**
    - **What it is:** Two separate two-column text files (\`.spd\` or \`.txt\`) describing the spectral composition (energy at each wavelength) of direct sunlight and diffuse skylight, respectively.
- **Why it's needed:** The recipe uses these files to generate a spectrally-correct sky model. It bins the data from these files to determine the "color" of the sun and sky for the simulation.
- **Where to get it:** You can find standard illuminant data (like CIE Standard Illuminant D65 for the sky) from various scientific sources or generate them using specialized software.
- **How to load it:** These files are uploaded directly within the recipe panel itself, as described in the next section.
## Part 2: Configuring and Running the Recipe

With the scene and spectral data prepared, you can configure the simulation.
### Step 4: Configure the Spectral Recipe
1. Open the **Simulation** panel (Toolbar toggle-modules-btn).
2. From the **"Select Recipe"** dropdown, choose **"Recipe: Spectral Analysis (Lark)"**.
3. The panel will display the following settings:
    - **9-Channel Simulation Toggle:** Keep this **checked**. This enables the high-accuracy, 9-channel simulation which is the core of this recipe.
- **Sky & Sun Definition:** Unlike other recipes, this one uses direct radiometric inputs instead of relying on an EPW file for a single time point.
- **Month, Day, Time:** Used to calculate the sun's position.
- **Direct Normal Irradiance (DNI):** The amount of solar radiation received per unit area by a surface held perpendicular to the sun's rays.
- **Diffuse Horizontal Irradiance (DHI):** The solar radiation from the sky (excluding the direct sunbeam) falling on a horizontal surface.
- You would typically source DNI and DHI values from a weather file for your desired time.
- **Spectral Data Files:** Upload your **Sun SPD** and **Sky SPD** files here.
- **Quality Preset:** It's recommended to use **"Medium"** or **"High"** quality to ensure accurate results, as spectral simulations can be sensitive to calculation parameters.
### Step 5: Generate and Run the Simulation
1. Click the **Generate Package** button. This creates a highly specialized shell script (.sh) that automates the complex multi-pass simulation.
2. Click the **Run Simulation** button. The console will show the progress. The script performs a multi-step process:
    - **Material Generation:** Creates three different material files, one for each of the three RGB passes (totaling 9 channels).
- **Sky Generation:** Bins the SPD data and scales it to match the brightness defined by the DNI/DHI values.
- **Triple Simulation:** Runs the Radiance \`rtrace\` command **three separate times**, once for each spectral band.
- **Result Combination:** Merges the three output files into a single 9-column results file (\`results_9channel.res\`).
- **Post-Processing:** Runs a built-in Python script (\`process_spectral.py\`) that reads the 9-channel data and calculates all the final circadian and spectral metrics.
## Part 3: Viewing and Analyzing the Output

- **File Output:** The recipe's primary outputs are two files saved in the \`08_results/spectral_9ch\` folder: \`circadian_per_point.csv\` and \`circadian_summary.json\`.
- **Analysis in Ray Modeler:**
    1. Open the **Analysis** panel.
2. Click **Load Results File (A)** and select the \`circadian_per_point.csv\` file.
3. The application will automatically parse the data and activate the spectral analysis dashboards:
        - **Circadian Health Metrics Dashboard:** This dashboard will appear, showing space-averaged values for **Circadian Stimulus (CS)**, **Equivalent Melanopic Lux (EML)**, **CCT**, and a checklist for **WELL v2 L03 compliance**.
- **3D View Metric Selector:** A new dropdown will appear in the Analysis panel, allowing you to switch the 3D heatmap visualization between different metrics like **Photopic Illuminance, EML, CS, and CCT**. This allows you to see the spatial distribution of these non-visual quantities.

# Guide to the "EN 17037 Compliance" Recipe

It automates the complex series of simulations required to check a design against the four main pillars of the European daylighting standard EN 17037: **Daylight Provision, Exposure to Sunlight, View Out, and Protection from Glare**.
## 1. Foundational Scene Setup (Prerequisites)

This recipe combines annual simulations, point-in-time checks, and image-based analysis. Therefore, it requires a complete and accurate scene setup.

### Step 1: Model the Physical Space
The geometry and materials are critical for all four compliance checks.
- **Dimensions & Geometry (Toolbar Icon 2):** Define the room's **Width, Length, Height,** and **Orientation**.
- **Apertures & Shading (Toolbar Icon 3):** Accurately model all windows and any static shading devices. The size and placement of glazing are fundamental to all four pillars of the standard.
- **Material Properties (Toolbar Icon 5):** Set realistic **Reflectance** values for all interior surfaces to ensure accurate calculation of internally reflected light.
### Step 2: Provide Climate Data (Critical)
All checks in EN 17037 are climate-based.
1. Open the **Project Setup** panel (Toolbar Icon 1).
2. Click **"Upload EPW File"** and load a valid weather file for your project's location. This file is mandatory and will be used for every part of the simulation.
### Step 3: Define All Analysis Points (Critical)
This recipe requires three distinct types of analysis points to be defined.
- **A. Illuminance Grid (for Daylight Provision):**
    1. Go to the **Sensor Grid** panel (Toolbar Icon 6).
2. Enable the **"Illuminance Grid"** and check the **"Floor"** surface.
3. Set the **Height Offset** to the reference plane height (e.g., 0.85m as per the standard).
- **B. Glare View Grid (for Glare Protection):**
    1. In the **Sensor Grid** panel, also enable the **"View Grid"** checkbox.
2. Set its **Height Offset** to a typical seated eye-level (e.g., 1.2m). This creates the observer points for the imageless glare analysis.
- **C. Observer Viewpoint (for Sunlight & View):**
    1. Go to the **Viewpoint** panel (Toolbar Icon 7).
2. Position the camera at a representative location where an occupant would be. This viewpoint is used for the "Exposure to Sunlight" and "View Out" checks. 3. Set the **Y (Height)** to eye-level (e.g., 1.2m).

## 2. Recipe-Specific Parameters

With the scene fully defined, you can configure the compliance checks.
### Step 4: Configure the EN 17037 Recipe
1. Open the **Simulation** panel (Toolbar toggle-modules-btn).
2. From the **"Select Recipe"** dropdown, choose **"Recipe: EN 17037 Compliance Check"**.
3. The panel allows you to enable or disable each of the four checks and set their target performance levels.
- **1. Daylight Provision:**
        - **Toggle:** Keep this **checked** to run the annual daylighting simulation.
- **Target Performance Level:** Select **Minimum, Medium,** or **High**. This sets the target illuminance levels (ET and ETM) that the script will check against, based on the standard's requirements. The script uses Climate-Based Method 2.
    - **2. Exposure to Sunlight:**
        - **Toggle:** Keep this **checked** to verify direct sun access.
- **Reference Day:** Select a date for the check. The standard often suggests a day near the spring equinox, like **March 21st**.
- **Target Duration:** Select **Minimum (1.5 hours), Medium (3.0 hours),** or **High (4.0 hours)**. The script will check if the viewpoint receives at least this much direct sunlight on the chosen day.
    - **3. View Out:**
        - **Toggle:** Keep this **checked** to generate a fisheye image for manual verification of view quality (e.g., horizontal sight angle, number of view layers).
- **Quantitative View Factor Toggle:** Check this box to run an additional calculation that numerically determines the percentage of the occupant's view that is comprised of windows. This provides a quantitative metric to support the qualitative assessment.
- **Target Performance Level:** Select the target level for the view.
    - **4. Protection from Glare:**
        - **Toggle:** Keep this **checked** to run the imageless annual glare analysis.
- **Target Performance Level:** Select **Minimum (DGP ≤ 0.45), Medium (DGP ≤ 0.40),** or **High (DGP ≤ 0.35)**. The script will check if glare exceeds this threshold for more than 5% of occupied hours.
- You can also provide an optional **occupancy schedule file** for more accurate results.
## 3. Generating and Running the Simulation

This is a multi-stage process automated by the generated scripts.
### Step 5: Generate and Run
1. Click the **Generate Package** button. The application generates a master script (\`RUN_..._EN17037_Compliance.sh\`) along with several helper Python scripts (\`process_en17037_daylight.py\`, \`process_en17037_glare.py\`). Crucially, it also generates the complete scripts for its dependency recipes: "Annual Daylight (3-Phase)" and "Imageless Annual Glare".
2. Click the **Run Simulation** button. The master script will execute the checks in order. The **Simulation Console will show detailed progress for each step.** This process can be very time-consuming, especially the matrix generation for the annual simulations.
- **Daylight Provision** runs the full 3-Phase annual simulation and then uses a Python script to analyze the \`.ill\` file against the EN 17037 criteria.
- **Sunlight Exposure** runs a loop that checks the sun's visibility from the viewpoint at 15-minute intervals for the specified day.
- **View Out** runs \`rpict\` to create a fisheye image. If the quantitative check is enabled, it runs a separate \`rtrace\` simulation on a modified scene to calculate the view factor.
- **Glare Protection** runs the full imageless annual glare workflow and then uses a Python script to check the results against the standard's time-based threshold.
## 4. Understanding the Output

The final output is a comprehensive report printed directly to the **Simulation Console**.
- **Console Report:** After all simulations are complete, the master script will print a summary for each enabled check, clearly stating the calculated value and whether it **PASSES** or **FAILS** based on the selected performance level.
- **Supporting Files:** All intermediate and final data files are saved in your project folder for further inspection:
    - **Daylight Provision:** An annual illuminance file (\`.ill\`) in \`08_results\`.
- **Sunlight Exposure:** No file is saved; the result is printed to the console.
- **View Out:** A fisheye image (\`_view_out.hdr\`) is saved in \`09_images\`. If the quantitative check was run, a \`_view_factor.txt\` file is saved in \`08_results\`.
- **Glare Protection:** An annual DGP file (\`.dgp\`) is saved in \`08_results\`.

# Guide to the "EN 12464-1 Illuminance" Recipe

This recipe is specifically designed to verify compliance with the core lighting requirements of the European standard EN 12464-1 for indoor workplaces. It calculates the **maintained illuminance (Ēm)** and **uniformity (U₀)** for both a defined **Task Area** and its **Immediate Surrounding Area**. This analysis is typically performed for electric lighting scenarios.

## 1. Foundational Scene Setup (Prerequisites)

To perform a correct EN 12464-1 analysis, you must precisely define the lighting system and the specific areas of measurement.
### Step 1: Model the Physical Space
Define the room's geometry and surface properties.
- **Dimensions & Geometry (Toolbar Icon 2):** Set the room's **Width, Length,** and **Height**.
- **Material Properties (Toolbar Icon 5):** Set realistic **Reflectance** values for the walls, floor, and ceiling, as these will affect the distribution of light from your luminaires.
### Step 2: Define the Artificial Lighting System (Critical)
This recipe is centered on analyzing an electric lighting design.
1. Open the **Artificial Lighting** panel (Toolbar Icon 4).
2. Enable the **"Enable Artificial Lighting"** toggle.
3. Define your luminaires. For compliance checks, it's highly recommended to use the **IES Photometric File** type and upload the \`.ies\` file from your luminaire manufacturer. This provides the most accurate light distribution data.
4. Use the **Placement** controls to arrange your luminaires, either individually or in a grid.
5. In the **"EN 12464-1 Specification"** section, set the correct **Maintenance Factor (MF)** for your design. The simulation results will be scaled by this factor to calculate the *maintained* illuminance.
### Step 3: Define the Analysis Grids (CRITICAL)
This is the most important prerequisite. EN 12464-1 requires you to analyze two distinct areas: the **task area** where the main visual work is done, and a 0.5m band around it called the **surrounding area**.
1. Open the **Sensor Grid** panel (Toolbar Icon 6).
2. Ensure the **"Illuminance Grid"** is enabled.
3. Under **"Floor Grid"**, set the **Height Offset** to the height of the workplane (e.g., 0.85m).
4. Enable the **"Define Specific Task Area"** toggle.
5. Use the sliders or the interactive **Task Area Visualizer** canvas to define the exact **Start X, Start Z, Width, and Depth** of your primary work area. The 3D view will show a colored overlay representing this zone.
6. Enable the **"Include Surrounding Area"** toggle. The **Band Width** is typically fixed at 0.5m as per the standard. The application will automatically create a second grid in this band around your defined task area.
7. When the simulation package is generated, this setup creates two separate sensor point files: \`task_grid.pts\` and \`surrounding_grid.pts\`.
## 2. Recipe-Specific Parameters

Once the scene is fully configured, set up the recipe itself.
### Step 4: Configure the Recipe
1. Open the **Simulation** panel (Toolbar toggle-modules-btn).
2. From the **"Select Recipe"** dropdown, choose **"Recipe: EN 12464-1 Illuminance"**.
3. Configure the main parameter:
    - **Calculation Quality:** This sets the accuracy of the Radiance calculation. For official compliance verification, it's strongly recommended to select **"Compliance (High Quality)"**. This uses a high number of ambient bounces and divisions (\`-ab 7\`, \`-ad 2048\`) to ensure accurate results, especially for uniformity calculations.
## 3. Generating and Running the Simulation

### Step 5: Generate and Run
1. Click the **Generate Package** button. This creates all necessary scene files and the master script (\`RUN_..._EN12464_Illuminance.sh\` or \`.bat\`).
2. Click the **Run Simulation** button. The simulation console will appear. The script performs the following steps:
    - \`oconv\`: Compiles an octree of the scene, including only the electric lighting geometry (no sky).
- \`rtrace\` (Pass 1): Calculates the illuminance at every point in the \`task_grid.pts\` file and saves the results.
- \`rtrace\` (Pass 2): Calculates the illuminance at every point in the \`surrounding_grid.pts\` file and saves the results.
- **Post-Processing:** The script uses Radiance's \`total\` and \`datamax\` tools to calculate the average (Ēm), minimum (Emin), and uniformity (U₀) for both result sets.
## 4. Understanding the Output

The primary output is a text-based summary report automatically generated by the script.
- **File Location:** The summary is saved as \`EN12464_Illuminance_Summary.txt\` inside your project's \`08_results\` folder.
- **Content:** The summary report is also printed directly to the **Simulation Console** for immediate review. It clearly lists the calculated **Average Illuminance (Em)**, **Minimum Illuminance (Emin)**, and **Uniformity (U0)** for both the Task Area and the Surrounding Area, allowing you to easily compare them against the standard's requirements for your specific task.
- **Visualization:** You can also load the intermediate results files (\`task_results_lux.txt\` and \`surround_results_lux.txt\`) into the **Analysis** panel to visualize the illuminance distribution as a false-color heatmap on the grids in the 3D view.

# Guide to the "Unified Glare Rating (UGR)" Recipe

This recipe automates the calculation of the **Unified Glare Rating (UGR)**, a metric used to predict discomfort glare from luminaires in an indoor environment, as specified by the European standard EN 12464-1. The calculation is performed from a single, specific observer viewpoint.
## 1. Foundational Scene Setup (Prerequisites)

An accurate UGR calculation depends on a precise definition of the lighting system, surface properties, and the observer's position.
### Step 1: Model the Physical Space
The brightness of surfaces in the field of view contributes to the overall glare calculation.
- **Dimensions & Geometry (Toolbar Icon 2):** Define the room's **Width, Length,** and **Height**.
- **Material Properties (Toolbar Icon 5):** Set realistic **Reflectance** values for all major surfaces (walls, floor, ceiling). These values are critical as they determine the background luminance (Lb) in the UGR formula.
### Step 2: Define the Artificial Lighting System (Critical)
UGR is a metric for assessing glare from electric lighting.
1. Open the **Artificial Lighting** panel (Toolbar Icon 4).
2. Enable the **"Enable Artificial Lighting"** toggle.
3. Define your luminaires. For compliance checks, it is **essential to use the IES Photometric File** type and upload the \`.ies\` file provided by the luminaire manufacturer. This ensures the simulation uses the correct luminous intensity distribution of the light sources.
4. Use the **Placement** controls to arrange your luminaires accurately within the scene.
### Step 3: Define the Observer's Viewpoint (CRITICAL)
The entire UGR calculation is performed from the perspective of a single observer. This step must be done correctly for a valid result.
1. Open the **Viewpoint** panel (Toolbar Icon 7).
2. **Set the View Type to Fisheye:** This is **mandatory**. In the "View Type" dropdown, you **must** select **Fisheye (h)**. The \`evalglare\` program, which calculates UGR, requires a 180° hemispherical image to correctly analyze the entire field of view.
3. **Position the Observer:** Place the virtual camera at a representative observer location. Use the **"Enter Viewpoint" (FPV)** mode or the position sliders to place the camera at a typical eye height (e.g., **1.2 meters** for a seated person, 1.6m for standing). Position the observer in a location where glare is likely to be a concern (e.g., looking across the length of the room).
4. **Set the Gaze Direction:** Aim the camera horizontally, parallel to the main viewing direction (e.g., along the length of the room).
## 2. Recipe-Specific Parameters

With the scene fully configured, you can set up the UGR recipe itself.
### Step 4: Configure the Recipe
1. Open the **Simulation** panel (Toolbar toggle-modules-btn).
2. From the **"Select Recipe"** dropdown, choose **"Recipe: EN 12464-1 UGR"**.
3. Configure the recipe's parameters:
    - **UGR Limit (UGRₗ):** Enter the maximum permissible UGR value for the task being performed in the space (e.g., 19 for office work, 22 for general circulation). The script will use this value to determine if the result is a PASS or FAIL.
- **Calculation Quality:** For official compliance verification, it is **strongly recommended to select "Compliance (High Quality)"**. Glare calculations are very sensitive to rendering accuracy. This preset uses a high number of ambient bounces and divisions (\`-ab 7\`, \`-ad 2048\`) to ensure all light sources and their reflections are captured accurately.
## 3. Generating and Running the Simulation

### Step 5: Generate and Run
1. Click the **Generate Package** button. This creates all necessary scene files and the master script (\`RUN_..._EN12464_UGR.sh\` or \`.bat\`).
2. Click the **Run Simulation** button. The simulation console will appear, showing the live progress.
3. The script performs the following key steps:
    - \`oconv\`: Compiles an octree of the scene, including only the electric lighting geometry (no sky is included for a standard UGR test).
- \`rpict\`: Renders a high-quality, high-resolution (2048x2048) 180° fisheye HDR image from the observer's viewpoint.
- \`evalglare\`: Analyzes the generated HDR image to find all luminaires in the field of view, calculate the background luminance, and compute the final UGR value according to the CIE formula. The script uses the \`-vth\` flag, which is specifically for UGR calculations from a fisheye image.
## 4. Understanding the Output

The recipe produces a detailed text report summarizing the UGR calculation.
- **File Location:** A full report is saved as \`EN12464_UGR_Report.txt\` and a concise summary is saved as \`EN12464_UGR_Summary.txt\` inside your project's \`08_results\` folder.
- **Console Output:** The most important information—the calculated **UGR Value** and the **PASS/FAIL** status based on your specified limit—is printed directly to the **Simulation Console** for immediate review.
- **Visualization:** The intermediate fisheye HDR image (\`_ugr_view.hdr\`) is saved in the \`09_images/hdr\` folder. You can load this file in the **Analysis** panel and view it in the **HDR Image Viewer** to visually inspect the scene and identify which luminaires are contributing most to the glare sensation.

# Guide to the "Lighting Energy Analysis" Recipe

This advanced recipe simulates the annual energy consumption of an electric lighting system that is integrated with daylighting controls. It runs a full annual simulation, determines when blinds would be deployed, calculates the resulting interior illuminance, and then computes the energy used by the dimmable lighting system to meet a target illuminance setpoint.
## 1. Foundational Scene Setup (Prerequisites)

This recipe builds upon the annual daylighting workflow and has several critical dependencies that must be configured correctly.
### Step 1: Model the Physical Space
The room geometry and materials must be defined as they form the basis for the simulation matrices.
- **Dimensions & Geometry (Toolbar Icon 2):** Set the room's **Width, Length, Height,** and **Orientation**.
- **Material Properties (Toolbar Icon 5):** Set realistic **Reflectance** values for all interior surfaces.
### Step 2: Define the Artificial Lighting & Daylighting Controls (Critical)
The core of this analysis is the electric lighting system.
1. Open the **Artificial Lighting** panel (Toolbar Icon 4).
2. Enable **"Enable Artificial Lighting"**.
3. Define your luminaires using **IES Photometric Files** for accuracy.
4. Set the **Placement** (Individual or Grid) for your luminaires.
5. Under **"Power & Energy"**, enter the **Luminaire Power (Watts)** for a single luminaire. The script uses this to calculate the total installed power.
6. Enable **"Enable Daylighting Controls"**.
7. Under **"Control Logic"**, configure your system:
    - **Lighting Control Type:** Choose how the lights dim (e.g., **Continuous, Stepped**).
- **Illuminance Setpoint (lux):** Set the target illuminance the system will try to maintain (e.g., 500 lux).
- **Min Input Power / Min Light Output:** Define the dimming curve.
8. Under **"Control Sensor Placement"**, define the location and view direction of the photosensor(s) that control the lights.
### Step 3: Define the Analysis Grid
The simulation needs a sensor grid to calculate illuminance values, which are used to determine when blinds are deployed.
1. Open the **Sensor Grid** panel (Toolbar Icon 6).
2. Enable the **"Illuminance Grid"** and select the **"Floor"**.
3. Set the grid **Spacing** and **Height Offset** for the workplane.
### Step 4: Provide Climate & Glazing Data (CRITICAL)
This recipe requires a weather file and **two separate BSDF files** to simulate the window system with and without blinds.
- **Weather File:** In the **Project Setup** panel, **"Upload EPW File"**. This is used to generate the annual sky conditions.
- **BSDF Files:** In the recipe panel itself, you must upload two \`.xml\` files:
    - **BSDF - Blinds Open:** Represents the clear glazing.
- **BSDF - Blinds Closed:** Represents the glazing with the blinds/shades deployed.
- **Where to get them:** These files are typically generated using software like **LBNL WINDOW**, where you can model a complete fenestration assembly (e.g., double glazing + interior roller shade) and export its BSDF data.
## 2. Recipe-Specific Parameters

### Step 5: Configure the Recipe
1. Open the **Simulation** panel (Toolbar toggle-modules-btn).
2. From the **"Select Recipe"** dropdown, choose **"Recipe: Lighting Energy Analysis"**.
3. Configure the **"Blind Operation Parameters"**: These settings determine when the simulation deploys the "Blinds Closed" BSDF file.
- **Illuminance Threshold (lux):** The direct sunlight illuminance value that will trigger the blinds to close. A common value is 1000 lux.
    - **Area Trigger (%):** The percentage of the sensor grid that must exceed the threshold before the blinds are closed. A common value is 2%.

## 3. Generating and Running the Simulation

This is a multi-step workflow that requires running several scripts in sequence. The recipe automates this by calling its dependencies.

### Step 6: Generate and Run
1. Click the **Generate Package** button. This action generates multiple files:
    - The complete script for the **"Annual Daylight (3-Phase)"** recipe (to generate the core \`view.mtx\` and \`daylight.mtx\`).
- A Python helper script (\`process_energy.py\`) to manage the logic.
    - The master orchestration script (\`RUN_..._Energy_Analysis.sh\`).
2. Click the **Run Simulation** button. The console will show the progress as the master script executes the entire workflow:
    - **Run Matrix Generation:** First, it calls the 3-Phase matrix generation script to create \`view.mtx\` and \`daylight.mtx\`.
- **Calculate Direct Illuminance:** It runs \`dctimestep\` with a **direct-sun-only** sky matrix to get the illuminance used for the blind trigger.
- **Generate Blind Schedule:** It runs the \`process_energy.py\` script, which analyzes the direct illuminance and creates a \`blinds.schedule\` file (an 8,760-hour list of 0s and 1s).
- **Calculate Full Illuminance:** It runs \`dctimestep\` twice: once with the "Blinds Open" BSDF and once with the "Blinds Closed" BSDF.
- **Combine Results:** It runs the Python script again to merge the "Open" and "Closed" results into a single final illuminance file (\`_energy_final.ill\`) based on the hourly schedule.
- **Calculate Energy:** Finally, the Python script reads the final illuminance file, compares the hourly average daylight to the setpoint, calculates the required electrical light contribution, and computes the annual energy consumption.
## 4. Understanding the Output

The final output is a concise summary of the energy performance.
- **File Location:** A summary file named \`energy_summary.csv\` is saved in the \`08_results\` folder.
- **Console Output:** The key results are printed directly to the **Simulation Console** for immediate review.
- **Dashboard:** The results can be visualized by loading the \`energy_summary.csv\` file in the **Analysis** panel, which will bring up the **Lighting Energy Dashboard**. This dashboard displays:
    - **Lighting Power Density (LPD):** The installed power per unit area.
- **Annual Lighting Energy:** The total estimated energy consumption in kWh/year.
- **Daylighting Savings (%):** The percentage of energy saved compared to a scenario with no daylighting controls.

# Guide to the "Façade Irradiation Analysis" Recipe

This recipe is used to calculate the total amount of solar energy (irradiation, measured in kWh/m²/year) that strikes an exterior building façade over an entire year. It accounts for shading from the building's own geometry, attached shading devices, and any modeled surrounding context buildings.
## 1. Foundational Scene Setup (Prerequisites)

The accuracy of this analysis is highly dependent on the correct modeling of the building and its surrounding environment.
### Step 1: Model the Physical Space and Context
You must define the building's geometry and any objects that could cast a shadow on the façade being analyzed.
- **Dimensions & Geometry (Toolbar Icon 2):** Set the building's core **Width, Length, Height,** and **Orientation**.
- **Apertures & Shading (Toolbar Icon 3):** Accurately model any shading devices like **overhangs or fins** attached to the building, as these will directly block solar radiation.
- **Scene Elements (Toolbar Icon 8):** This is **critical** for an accurate site-specific analysis. Use the **Context & Site Modeling** tools to add surrounding buildings or topography. These objects will be included in the simulation and will cast realistic shadows on your target façade.
### Step 2: Establish Geographic Location (Critical)
The amount of solar radiation is entirely dependent on the climate and sun path at the project's location.
1. Open the **Project Setup** panel (Toolbar Icon 1).
2. You **must** upload a climate data file by clicking **"Upload EPW File"**. The script uses this file with the \`gendaymtx\` command to generate the sky conditions for every hour of the year.
## 2. Recipe-Specific Parameters

Once the scene is modeled, you configure the specific parameters for the irradiation analysis.
### Step 3: Configure the Recipe
1. Open the **Simulation** panel (Toolbar toggle-modules-btn).
2. From the **"Select Recipe"** dropdown, choose **"Recipe: Façade Irradiation Analysis"**.
3. The panel will display the following settings for defining the virtual analysis plane:
    - **Target Façade:** Select which building face you want to analyze (**South, North, East,** or **West**). The script will automatically create a sensor grid parallel to this façade.
- **Offset from Façade (m):** This sets the distance between the building face and the virtual analysis grid. A small value like **0.05** is typical.
    - **Grid Spacing (m):** This controls the resolution of the analysis. A smaller value (e.g., **0.5m**) creates a more detailed map but takes longer to compute.
## 3. Generating and Running the Simulation

### Step 4: Generate and Run
1. Click the **Generate Package** button. This action compiles your scene and settings and generates several key files, including:
    - The scene geometry (\`.rad\`) and material (\`.rad\`) files.
- A special sensor points file (\`facade_grid.pts\`) containing the coordinates and normal vectors for each point on the virtual façade plane.
- The master simulation script (\`RUN_..._Facade_Irradiation.sh\`).
2. Click the **Run Simulation** button. The console will show the progress as the script executes a multi-step Radiance workflow:
    - \`gendaymtx\`: Creates an annual sky matrix from your EPW file.
- \`oconv\`: Compiles an octree of your entire scene, including the main building, shading devices, and all context geometry.
- \`rcontrib\`: Calculates the Daylight Coefficients. This is an intensive step that traces rays from each sensor point on the façade grid out to the sky, determining how much of the sky each point can see while accounting for all obstructions.
- \`dctimestep\`: Multiplies the daylight coefficients by the hourly sky matrix to calculate the hourly solar irradiance (in W/m²) for the entire year.
- \`total\` & \`rcalc\`: These commands sum the hourly irradiance values for the whole year and convert the final result from W/m²/year to the standard unit of **kWh/m²/year**.
## 4. Understanding the Output

The final output is a text file containing the total annual solar irradiation value for each sensor point.
- **File Location:** The results are saved as \`facade_annual_kWh.txt\` in your project's \`08_results\` folder.
- **Visualization:**
    1. Open the **Analysis** panel.
2. Click **Load Results File (A)** and select the generated \`facade_annual_kWh.txt\` file.
3. The application will automatically create a temporary 3D plane in your scene that matches the position of your analysis grid. 4. It will then display a false-color heatmap on this plane, allowing you to visually identify areas of high and low solar exposure on the façade throughout the year.

# Guide to the "Annual Solar Radiation" Recipe

This recipe calculates the cumulative solar energy (irradiation, measured in kWh/m²/year) that falls on interior surfaces over an entire year. It is essential for understanding passive solar heating gains, potential for material degradation from UV exposure, and identifying areas with high solar load.
## 1. Foundational Scene Setup (Prerequisites)

The accuracy of this analysis depends on the correct modeling of the building's interaction with the annual sun path.
### Step 1: Model the Physical Space
You must define the building's geometry and any elements that will cast shadows.
- **Dimensions & Geometry (Toolbar Icon 2):** Set the room's **Width, Length, Height,** and **Orientation**.
- **Apertures & Shading (Toolbar Icon 3):** Accurately model all windows and any external or internal shading devices. These elements are critical as they control how much solar radiation enters the space.
- **Scene Elements (Toolbar Icon 8):** For a site-specific analysis, model any surrounding context buildings or topography, as they will cast shadows on your building's façade throughout the year.
### Step 2: Establish Geographic Location (Critical)
The amount and angle of solar radiation are entirely dependent on the project's location.
1. Open the **Project Setup** panel (Toolbar Icon 1).
2. You **must** upload a climate data file by clicking **"Upload EPW File"**. The simulation script uses this file to generate the sky conditions for all 8,760 hours of the year.
### Step 3: Define the Analysis Grids (CRITICAL)
This is the most important prerequisite. You must specify which interior surfaces you want to measure.
1. Open the **Sensor Grid** panel (Toolbar Icon 6).
2. Ensure the **"Illuminance Grid"** toggle is enabled.
3. Under **Surface Selection**, check the boxes for all the interior surfaces you want to analyze (e.g., **"Floor"**, **"North Wall"**, etc.).
4. For each selected surface, define the **Spacing** of the sensor points. A denser grid provides a higher-resolution map.
5. This setup is used to generate the \`grid.pts\` file, which contains the coordinates and normal vectors for every point where the calculation will be performed.
## 2. Recipe-Specific Parameters

With the scene fully defined, you can configure the recipe itself.
### Step 4: Configure the Recipe
1. Open the **Simulation** panel (Toolbar toggle-modules-btn).
2. From the **"Select Recipe"** dropdown, choose **"Recipe: Annual Solar Radiation"**.
3. The panel will display the following settings:
    - **Calculation Quality:** This sets the accuracy of the Radiance ambient calculation. It is recommended to use **"Medium (Balanced)"** or **"High (Accurate)"** to ensure reliable results.
- **Weather File (.epw):** This input confirms which EPW file is being used. The file must be loaded via the **Project Setup** panel.
## 3. Generating and Running the Simulation

### Step 5: Generate and Run
1. Click the **Generate Package** button. This action compiles all scene data and recipe settings into a complete Radiance project, including the master simulation script (\`RUN_..._Annual_Radiation.sh\`).
2. Click the **Run Simulation** button. The simulation console will appear, showing the progress of a complex, multi-step workflow automated by the script:
    - \`gendaymtx\`: Creates the annual sky matrix from your EPW file.
- \`oconv\`: Compiles an octree of your entire scene, including all shading and context geometry.
- \`rcontrib\`: Calculates the Daylight Coefficients. This is the most intensive step, where Radiance traces rays from every sensor point on your interior grids out to the sky to determine how much of the sky is visible from each point, accounting for all obstructions.
- \`dctimestep\`: Multiplies the daylight coefficients by the hourly sky matrix to calculate the hourly solar irradiance (in W/m²) for the entire year.
- \`rmtxop\` & \`total\`: The script uses these tools to sum the hourly results for each point and convert the final value into the standard unit of **kWh/m²/year**.
## 4. Viewing and Analyzing the Output

The final output is a text file containing the total annual solar radiation value for each sensor point on your grids.
- **File Location:** The results are saved as \`..._annual_radiation.txt\` in your project's \`08_results\` folder.
- **Visualization:**
    1. Open the **Analysis** panel.
2. Click **Load Results File (A)** and select the generated \`_annual_radiation.txt\` file.
3. The application will display a false-color heatmap on the sensor grids you defined in the 3D view. 4. This allows you to visually identify which surfaces and which parts of those surfaces receive the most and least solar energy over the course of a year.
    `;

    const recipeGuides = {};
    const guideSelector = dom['guide-selector'];
    const guideContentDiv = dom['guide-content'];
    if (!guideSelector || !guideContentDiv) return;

    // Split guides by the main title pattern
    const guides = guideText.split(/# Guide to the "([^"]+)" Recipe/g).slice(1);

    for (let i = 0; i < guides.length; i += 2) {
        const recipeName = guides[i].trim();
        let rawContent = guides[i + 1];

        // 1. Clean content
        rawContent = rawContent.replace(/\//g, '').trim();

        // 3. Process content line-by-line to build the main HTML content
        let html = '';
        let inList = null; // null, 'ul', 'ol', 'table'
        let tableHeader = true;

        const closeList = () => {
            if (inList) {
                html += `</${inList}>`;
                inList = null;
                tableHeader = true;
            }
        };

        const lines = rawContent.split('\n');
        for (const line of lines) {
            const trimmedLine = line.trim();

            if (trimmedLine.length === 0) {
                closeList();
                continue;
            }

            // Inline formatting helper
            const formatInline = (text) => text
                .replace(/\`([^`]+)\`/g, '<code>$1</code>')
                .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

            // Headings
            if (trimmedLine.startsWith('## ')) {
                closeList();
                html += `<h2>${formatInline(trimmedLine.substring(3))}</h2>`;
            } else if (trimmedLine.startsWith('### ')) {
                closeList();
                html += `<h3>${formatInline(trimmedLine.substring(4))}</h3>`;
            } else if (trimmedLine.startsWith('#### ')) {
                closeList();
                html += `<h4>${formatInline(trimmedLine.substring(5))}</h4>`;
            }
            // Tables
            else if (trimmedLine.startsWith('|') && trimmedLine.endsWith('|')) {
                if (inList !== 'table') {
                    closeList();
                    html += '<table>';
                    inList = 'table';
                    tableHeader = true;
                }
                const cells = trimmedLine.split('|').slice(1, -1);
                if (cells.every(c => c.trim().match(/^-+$/))) {
                    tableHeader = false; // This is the separator line
                } else {
                    const tag = tableHeader ? 'th' : 'td';
                    html += '<tr>' + cells.map(c => `<${tag}>${formatInline(c.trim())}</${tag}>`).join('') + '</tr>';
                }
            }
            // Lists
            else if (trimmedLine.match(/^\d+\.\s/)) {
                if (inList !== 'ol') { closeList(); html += '<ol>'; inList = 'ol'; }
                html += `<li>${formatInline(trimmedLine.replace(/^\d+\.\s/, ''))}</li>`;
            } else if (trimmedLine.startsWith('- ')) {
                if (inList !== 'ul') { closeList(); html += '<ul>'; inList = 'ul'; }
                html += `<li>${formatInline(trimmedLine.substring(2))}</li>`;
            }
            // Paragraphs
            else {
                closeList();
                html += `<p>${formatInline(trimmedLine)}</p>`;
            }
        }
        closeList(); // Close any trailing list

        recipeGuides[recipeName] = html;

        const option = document.createElement('option');
        option.value = recipeName;
        option.textContent = recipeName;
        guideSelector.appendChild(option);
    }

    guideSelector.addEventListener('change', e => {
        guideContentDiv.innerHTML = recipeGuides[e.target.value] || '<p class="text-[--text-secondary]">Please select a recipe from the dropdown above to see its guide.</p>';
    });
}
