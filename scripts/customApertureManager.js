import { getDom } from './dom.js';
import { updateCustomWall } from './customGeometryManager.js';
import { AperturePanelUI } from './AperturePanelUI.js';
import { updateScene } from './geometry.js';

const customWalls = new Map(); // Stores params for each wall

export function registerCustomWall(id, dimensions) {
    customWalls.set(id, {
        dimensions: dimensions,
        apertures: {
            count: 0,
            type: 'window', // Default type
            mode: 'wwr',
            wwr: 0.4,
            sillHeight: 1.0,
            width: 1.5,
            height: 1.2,
            depthPos: 0.1
        },
        shading: {
            type: 'none',
            enabled: false,
            // Pre-seed common defaults to avoid undefined issues
            'overhang-depth': 0.5,
            'overhang-dist-above': 0,
            'louver-slat-width': 0.1,
            'louver-slat-sep': 0.05
        },
        frame: {
            enabled: true,
            thick: 0.05,
            depth: 0.15
        }
    });
}

export function clearCustomWalls() {
    customWalls.clear();
}

export function getCustomWallData(id) {
    return customWalls.get(id);
}

export function injectCustomWallUI(wallId) {
    const dom = getDom();
    const panel = dom['panel-aperture'];

    const standardContent = document.getElementById('aperture-standard-content');
    const customContent = document.getElementById('aperture-custom-content');

    if (!standardContent || !customContent) {
        console.error("Aperture panel structure is invalid.");
        return;
    }

    // Hide standard, show custom
    standardContent.classList.add('hidden');
    customContent.classList.remove('hidden');

    // Clear existing custom content
    customContent.innerHTML = '';

    // Add Header for Custom Wall
    const headerDiv = document.createElement('div');
    headerDiv.className = 'space-y-2 pb-3 border-b border-[--grid-color] mb-3';
    const wallIndex = wallId.split('_')[1];
    headerDiv.innerHTML = `
        <h3 class="font-semibold text-sm uppercase">Custom Wall Selection</h3>
        <div class="flex justify-between items-center pt-2">
            <span class="label">Selected Wall:</span>
            <span class="data-value font-mono text-[--highlight-color]">Wall #${parseInt(wallIndex) + 1}</span>
        </div>`;
    customContent.appendChild(headerDiv);

    // Instantiate UI Helper (Using a temporary instance or static-like usage)
    // We can reuse the class methods.
    const uiHelper = new AperturePanelUI('panel-aperture'); // ID doesn't matter much here as we pass container

    // Get Data
    const wallData = customWalls.get(wallId);
    if (!wallData) return;

    // Create Container for Controls
    const controlsContainer = document.createElement('div');
    customContent.appendChild(controlsContainer);

    // Render Controls
    uiHelper.renderCustomWallControls(controlsContainer, wallId, wallData, (changedId, value) => {
        handleCustomWallChange(wallId, changedId, value);
    });

    panel.classList.remove('hidden');
}

/**
 * Handles updates from the UI.
 * Maps the flat ID structure to the nested wallData structure.
 */
function handleCustomWallChange(wallId, inputId, value) {
    const wallData = customWalls.get(wallId);
    if (!wallData) return;

    const suffix = wallId; // e.g. "wall_0"

    // Helper to strip suffix
    const key = inputId.replace(`-${suffix}`, '').replace(`-${suffix}-manual`, '');

    // Basic Mapping Logic
    // 1. Apertures
    if (key === 'win-count') wallData.apertures.count = parseInt(value);
    else if (key === 'mode') wallData.apertures.mode = value; // wwr or manual
    else if (key === 'type') {
        wallData.apertures.type = value;
        if (value === 'door') {
            wallData.apertures.sillHeight = 0;
            // Also force update UI input if generic inputs exist? 
            // The UI renders from data, so renderCustomWallControls will see new sillHeight.
            // But if we just trigger updateScene, the input fields won't update unless we re-render panel.
            // But setShadingState updates inputs.
            // We should probably explicitly update the sill height inputs here if they exist in DOM.
            const dom = getDom();
            ['wwr-sill-height', 'sill-height'].forEach(k => {
                const el = document.getElementById(`${k}-${suffix}`);
                if (el) {
                    el.value = 0;
                    el.dispatchEvent(new Event('input')); // Visual update
                }
            });
        } else {
            // Reset to default window height if switching back? only if it's currently 0?
            if (wallData.apertures.sillHeight === 0) {
                wallData.apertures.sillHeight = 1.0;
                const dom = getDom();
                ['wwr-sill-height', 'sill-height'].forEach(k => {
                    const el = document.getElementById(`${k}-${suffix}`);
                    if (el) {
                        el.value = 1.0;
                        el.dispatchEvent(new Event('input'));
                    }
                });
            }
        }
    }
    else if (key === 'wwr') wallData.apertures.wwr = parseFloat(value);
    else if (key === 'wwr-sill-height') wallData.apertures.sillHeight = parseFloat(value);
    else if (key === 'win-depth-pos') wallData.apertures.depthPos = parseFloat(value);

    // Manual Dims
    else if (key === 'win-width') wallData.apertures.width = parseFloat(value);
    else if (key === 'win-height') wallData.apertures.height = parseFloat(value);
    else if (key === 'sill-height') wallData.apertures.sillHeight = parseFloat(value);

    // 2. Shading
    else if (inputId.includes('shading-')) {
        // e.g. shading-type-wall_0 -> shading-type
        // e.g. shading-wall_0-toggle -> shading-toggle

        if (key === 'shading-toggle') wallData.shading.enabled = value;
        else if (key === 'shading-type') wallData.shading.type = value;
        else if (key === 'sun-ray-tracing-toggle') wallData.shading.sunRayTracing = value;

        // Complex Shading Params (Overhang, etc.)
        // We store them in specific sub-objects or just flat in shading?
        // Let's store them flat in shading for simplicity or nested if we want.
        // The key is like 'overhang-depth'.
        else {
            // Just store strictly in wallData.shading.[key]
            // e.g. overhang-dist-above -> wallData.shading['overhang-dist-above'] = value
            // This is flexible and allows expansion without strict schema matching
            wallData.shading[key] = value;
        }
    }

    // 3. Frame
    else if (inputId.includes('frame-')) {
        if (key === 'frame-toggle') wallData.frame.enabled = value;
        else if (key === 'frame-thick') wallData.frame.thick = parseFloat(value);
        else if (key === 'frame-depth') wallData.frame.depth = parseFloat(value);
    }

    console.log(`[CustomAperture] Updated ${wallId} - ${key}:`, value, wallData);

    // Trigger Update
    updateCustomWall(wallId);
    updateScene();
}

export function hideCustomWallUI() {
    const standardContent = document.getElementById('aperture-standard-content');
    const customContent = document.getElementById('aperture-custom-content');

    if (standardContent) standardContent.classList.remove('hidden');
    if (customContent) customContent.classList.add('hidden');
}
