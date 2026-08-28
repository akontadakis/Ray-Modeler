// scripts/lighting.js

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { sensorTransformControls } from './scene.js';
import { attachGizmoToSelectedSensor } from './geometry.js';
import { updateAllLabels } from './ui.js';


/**
 * Parses the text content of an IESNA LM-63 photometric data file.
 * This helper class isolates the complex parsing logic from the main LightingManager.
 */
class IESParser {
    /**
     * Parses the IES file content and extracts key photometric data.
     *
     * Candela values are returned already scaled by the file's candela multiplier and
     * ballast factor, so they are true candela regardless of the units the file was
     * authored in. Luminaire dimensions are returned in metres.
     *
     * @param {string} iesContent The raw text content of the .ies file.
     * @returns {{
     * lumensPerLamp: number,
     * numLamps: number,
     * candelaMultiplier: number,
     * ballastFactor: number,
     * photometricType: number,
     * unitsType: number,
     * dimensions: {width: number, length: number, height: number},
     * isAbsolute: boolean,
     * wattage: number,
     * maxCandela: number,
     * verticalAngles: number[],
     * horizontalAngles: number[],
     * allCandelaValues: number[],
     * candelaValuesFor2D: number[],
     * warnings: string[]
     * }} Parsed photometric data.
     * @throws {Error} If the file format is invalid.
     */
    static parse(iesContent) {
        const lines = iesContent.replace(/\r\n/g, '\n').split('\n').map(l => l.trim());
        let lineIndex = 0;

        // Find the TILT line to start reading data
        while (lineIndex < lines.length && !lines[lineIndex].startsWith('TILT')) {
            lineIndex++;
        }
        if (lineIndex >= lines.length) throw new Error("IES file format error: TILT line not found.");

        const tiltValue = (lines[lineIndex].split('=')[1] || '').trim().toUpperCase();
        lineIndex++; // Move past the TILT line

        // LM-63 allows every numeric record to wrap across physical lines, so the rest of
        // the file is consumed as one whitespace-delimited token stream rather than
        // line-by-line. Blank lines are simply absorbed by the split.
        const tokens = lines.slice(lineIndex).join(' ').trim().split(/\s+/).filter(t => t.length > 0);
        let t = 0;
        const takeNumbers = (count, what) => {
            if (t + count > tokens.length) {
                throw new Error(`IES file format error: Not enough data for ${what}.`);
            }
            const out = new Array(count);
            for (let k = 0; k < count; k++) {
                const value = Number(tokens[t + k]);
                if (!Number.isFinite(value)) {
                    throw new Error(`IES file format error: Non-numeric value "${tokens[t + k]}" in ${what}.`);
                }
                out[k] = value;
            }
            t += count;
            return out;
        };

        // TILT=INCLUDE embeds a tilt block here: the lamp-to-luminaire geometry flag, the
        // number of angle/multiplier pairs, then the two arrays. TILT=NONE and
        // TILT=<filename> embed nothing. Skipping only one line breaks every tiltable file.
        if (tiltValue === 'INCLUDE') {
            takeNumbers(1, 'TILT lamp-to-luminaire geometry');
            const [numTiltPairs] = takeNumbers(1, 'TILT pair count');
            if (!Number.isInteger(numTiltPairs) || numTiltPairs < 0) {
                throw new Error("IES file format error: Invalid TILT pair count.");
            }
            takeNumbers(numTiltPairs * 2, 'TILT angle/multiplier pairs');
        }

        const dataLine1 = takeNumbers(10, 'data definition line 1');
        const dataLine2 = takeNumbers(3, 'ballast/watts definition line 2');

        const [numLamps, lumensPerLamp, candelaMultiplier, numVAngles, numHAngles,
            photometricType, unitsType] = dataLine1;
        const ballastFactor = dataLine2[0];
        const wattage = dataLine2[2];
        // Absolute photometry files use lumensPerLamp === -1; luminous flux is defined
        // directly by the candela data rather than a rated lamp lumen value.
        const isAbsolute = lumensPerLamp === -1;

        if (!Number.isInteger(numVAngles) || !Number.isInteger(numHAngles) || numVAngles <= 0 || numHAngles <= 0) {
            throw new Error("IES file format error: Invalid number of angles.");
        }

        const verticalAngles = takeNumbers(numVAngles, 'vertical angles');
        const horizontalAngles = takeNumbers(numHAngles, 'horizontal angles');
        const rawCandela = takeNumbers(numVAngles * numHAngles, 'candela values');

        // The candela multiplier and the ballast factor both scale the tabulated values;
        // a file authored in e.g. millicandela carries the 0.001 in the multiplier.
        const scale = (Number.isFinite(candelaMultiplier) && candelaMultiplier > 0 ? candelaMultiplier : 1)
            * (Number.isFinite(ballastFactor) && ballastFactor > 0 ? ballastFactor : 1);
        const allCandelaValues = rawCandela.map(c => c * scale);

        // For 2D plot, use the first set of vertical candela values (C0 plane)
        const candelaValuesFor2D = allCandelaValues.slice(0, numVAngles);

        // Loop-based max: Math.max(...arr) blows the argument limit on large webs
        // (a 181x721 file is 130k values) and NaN <= 0 is false, so it never caught garbage.
        let maxCandela = -Infinity;
        for (let i = 0; i < allCandelaValues.length; i++) {
            const v = allCandelaValues[i];
            if (v > maxCandela) maxCandela = v;
        }
        if (!Number.isFinite(maxCandela) || maxCandela <= 0) {
            throw new Error("No valid candela values found for plotting.");
        }

        // Units type: 1 = feet, 2 = metres. Only the luminaire dimensions carry units.
        const dimensionScale = (unitsType === 1) ? 0.3048 : 1;
        const dimensions = {
            width: dataLine1[7] * dimensionScale,
            length: dataLine1[8] * dimensionScale,
            height: dataLine1[9] * dimensionScale
        };

        const warnings = [];
        // Photometric type: 1 = C, 2 = B, 3 = A. The viewer's spherical maths assume Type C.
        if (photometricType !== 1) {
            const typeName = photometricType === 2 ? 'B' : photometricType === 3 ? 'A' : `${photometricType}`;
            warnings.push(`Photometric Type ${typeName} file: the viewer renders Type C (C-gamma) geometry, so the plotted web is indicative only.`);
        }
        if (unitsType !== 1 && unitsType !== 2) {
            warnings.push(`Unrecognised units type "${unitsType}"; luminaire dimensions assumed to be metres.`);
        }

        return {
            lumensPerLamp,
            numLamps,
            candelaMultiplier,
            ballastFactor,
            photometricType,
            unitsType,
            dimensions,
            isAbsolute,
            wattage,
            maxCandela,
            verticalAngles,
            horizontalAngles,
            allCandelaValues,
            candelaValuesFor2D,
            warnings
        };
    }
}


/**
 * Manages all aspects of artificial lighting in the scene, including UI, state, and 3D visuals.
 * This class is designed as a singleton, instantiated once and initialized with dependencies.
 */
class LightingManager {
    /**
     * @constructor
     */
    constructor() {
        /** @type {?THREE.Scene} */
        this.scene = null;
        /** @type {?object.<string, HTMLElement>} */
        this.dom = null;
        /** @type {THREE.Group} */
        this.lightsGroup = new THREE.Group();
        /** @private @type {boolean} */
        this.isInitialized = false;
        /** @private @type {boolean} */
        this.updateScheduled = false;
        /** @private @type {?{name: string, content: string}} */
        this.iesFileData = null;
        /** @private @type {?{name: string}} */
        this.scheduleFileData = null;
        /** @private @type {object} */
        this.ies3d = { scene: null, camera: null, renderer: null, controls: null, webMesh: null, animationFrameId: null, resizeObserver: null };
        /** @private @type {boolean} */
        this._isUpdatingFractions = false;
        /** @private @type {boolean} */
        this.isPanelSetup = false;
        /** @private @type {number} */
        this._iesReadRequestId = 0;

        this.lightsGroup.name = 'LightingGizmos';
    }

    /**
     * Initializes the manager with its core dependencies. Must be called after the scene and DOM are ready.
     * @param {THREE.Scene} scene - The main THREE.js scene object.
     * @param {object.<string, HTMLElement>} domCache - The cache of DOM elements.
     */
    init(scene, domCache) {
        if (this.isInitialized) return;
        this.scene = scene;
        this.dom = domCache;
        this.scene.add(this.lightsGroup);
        this.isInitialized = true;
    }

    /**
     * Initializes the lighting panel UI and event listeners. Must be called after init().
     */
    setupPanel() {
        if (!this.isInitialized) {
            console.error("LightingManager not initialized. Call init() first.");
            return;
        }
        // Guard against a second call: _bindEventListeners attaches a permanent
        // 'dragging-changed' listener to the shared sensorTransformControls that is never
        // removed, so re-entry would duplicate every handler.
        if (this.isPanelSetup) {
            this._synchronizeUIState();
            return;
        }
        this.isPanelSetup = true;

        this._bindEventListeners();
        this._synchronizeUIState();
    }

    // --- PUBLIC API ---

    /**
     * Updates the light visuals in the scene based on the current UI state.
     * This is the main public method to be called when a redraw is needed.
     */
    updateVisuals() {
        if (!this.isInitialized) return;

        this._clearVisuals();

        const isEnabled = this.dom['lighting-enabled-toggle']?.checked;
        this.lightsGroup.visible = isEnabled;

        if (isEnabled) {
            const lightDef = this.getCurrentState();
            if (lightDef) {
                this._createVisual(lightDef);
            }
        }
    }

    /**
     * Gathers the complete current lighting configuration from the UI controls.
     * @returns {object|null} A light definition object or null if misconfigured.
     */
    getCurrentState() {
        if (!this.dom['lighting-enabled-toggle']?.checked || !this.dom['light-type-selector']) {
            return null;
        }

        const lightDef = this._getBaseLightDef();
        this._addGeometryDef(lightDef);
        this._addTypeSpecificDef(lightDef);
        this._addGridDef(lightDef);
        this._addDaylightingDef(lightDef);

        // A valid IES definition requires a loaded file. Returning null here would make
        // project.js read the whole lighting section as "disabled" and silently drop the
        // position, grid, maintenance factor and the entire daylighting-control setup, so
        // flag the missing file instead and keep everything else intact.
        lightDef.ies_file_missing = (lightDef.type === 'ies' && !this.iesFileData);

        return lightDef;
    }
    
    /**
     * Applies a saved lighting state from a project file to the UI controls.
     * @param {object|null} state - The light definition object to apply, or null if disabled.
     */
    applyState(state) {
        if (!this.isInitialized) return;

        const isEnabled = !!state;
        this._setUIValue('lighting-enabled-toggle', isEnabled, 'checked');

        if (isEnabled) {
            this._applyGeneralState(state);
            this._applyGeometryState(state);
            this._applyTypeSpecificState(state);
            this._applyDaylightingState(state);
        }

        this._synchronizeUIState();
    }
    
    // --- PRIVATE: VISUALIZATION ---

    /**
     * Clears all existing light visualization objects from the scene and disposes of their resources.
     * @private
     */
    _clearVisuals() {
        while (this.lightsGroup.children.length > 0) {
            const object = this.lightsGroup.children[0];
            object.traverse((child) => {
                // ArrowHelper's cone and line geometries are MODULE-LEVEL singletons shared
                // by every arrow in the app (see three/src/helpers/ArrowHelper.js: the
                // lazily-created _lineGeometry / _coneGeometry). Disposing them here would
                // free the GPU buffers behind the daylighting-sensor arrows and the sun
                // tracer as well. Only the per-instance materials belong to this gizmo, and
                // arrow.line is a Line (not a Mesh) so its material was previously leaked.
                if (child.type === 'ArrowHelper') {
                    child.line?.material?.dispose();
                    child.cone?.material?.dispose();
                    return;
                }
                if (child.parent?.type === 'ArrowHelper') return; // handled above
                if (child.isMesh) {
                    child.geometry.dispose();
                    if (child.material) {
                        const materials = Array.isArray(child.material) ? child.material : [child.material];
                        materials.forEach(material => material.dispose());
                    }
                }
            });
            this.lightsGroup.remove(object);
        }
    }

    /**
     * Creates and places the 3D gizmos in the scene based on a light definition object.
     * @param {object} lightDef - The light definition object.
     * @private
     */
    _createVisual(lightDef) {
        const placeGizmo = (position, gridInfo = null) => {
            // Pass the luminaire's final calculated position to the gizmo creation function
            const gizmo = this._createSingleGizmo(lightDef, position, gridInfo);
            this._positionAndRotateGizmo(gizmo, position, lightDef.rotation);
            this.lightsGroup.add(gizmo);
        };

        if (lightDef.placement === 'grid' && lightDef.grid) {
            this._createGridGizmos(lightDef, placeGizmo);
        } else {
            this._setGridWarning(null);
            placeGizmo(lightDef.position, null);
        }
}

    /**
     * Shows or clears an inline warning under the grid layout inputs.
     * The element is created on first use because index.html has no placeholder for it.
     * @param {?string} message - The warning text, or null to clear it.
     * @private
     */
    _setGridWarning(message) {
        const host = this.dom['grid-layout-inputs'];
        if (!host) return;
        let warning = host.querySelector('[data-lighting-grid-warning]');
        if (!warning) {
            if (!message) return;
            warning = document.createElement('p');
            warning.setAttribute('data-lighting-grid-warning', '');
            warning.className = 'text-xs mt-2 leading-snug';
            warning.style.color = 'var(--warning-color, #d97706)';
            host.appendChild(warning);
        }
        warning.textContent = message || '';
        warning.classList.toggle('hidden', !message);
    }
    
    /**
     * Positions and rotates a single gizmo in world space, accounting for room rotation.
     * @param {THREE.Group} gizmo - The gizmo to transform.
     * @param {{x: number, y: number, z: number}} position - The desired position in room coordinates.
     * @param {{x: number, y: number, z: number}} rotation - The desired rotation in degrees.
     * @private
     */
    _positionAndRotateGizmo(gizmo, position, rotation) {
        const W = parseFloat(this.dom['width'].value);
        const L = parseFloat(this.dom['length'].value);
        const roomRotationY = THREE.MathUtils.degToRad(parseFloat(this.dom['room-orientation'].value));
        // lightsGroup is added straight to the scene and is NOT in geometry.js's
        // groupsToTransform list, so the room elevation is never applied to it by the scene
        // rebuild. Read it exactly as geometry.js readParams() does and apply it here,
        // otherwise upper-storey luminaires sit below their own floor.
        const elevationRaw = parseFloat(this.dom['elevation']?.value);
        const elevation = Number.isFinite(elevationRaw) ? elevationRaw : 0;

        // Calculate world position relative to the rotated room
        const centeredPos = new THREE.Vector3(position.x - W / 2, position.y, position.z - L / 2);
        const worldPos = centeredPos.applyAxisAngle(new THREE.Vector3(0, 1, 0), roomRotationY);
        worldPos.y += elevation;
        gizmo.position.copy(worldPos);

        // Calculate world rotation including the room's rotation.
        //
        // ORIENTATION CONVENTION (verified against ies2rad, Radiance 6.1a):
        //   The gizmo's aim is its local -Z. With the panel default light-rot-x = -90 the
        //   'YXZ' composition below sends local -Z to world (0, -1, 0), i.e. straight down,
        //   which is the correct preview for a ceiling downlight.
        //   ies2rad already emits its prototype polygon aimed at nadir (-Z in Radiance), so
        //   the exporter must apply the IDENTITY rotation for this default, not '-rx -90'.
        //   See the module footer for the full preview -> xform correspondence.
        const euler = new THREE.Euler(
            THREE.MathUtils.degToRad(rotation.x),
            THREE.MathUtils.degToRad(rotation.y),
            THREE.MathUtils.degToRad(rotation.z),
            'YXZ' // Intrinsic rotation order for intuitive control
        );
        const roomQuaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), roomRotationY);
        gizmo.quaternion.setFromEuler(euler).premultiply(roomQuaternion);
    }

    /**
     * Creates a single visual gizmo for a light source, including geometry and helpers.
     * @param {object} lightDef - The light definition.
     * @param {object} position - The {x, y, z} position of the luminaire in room coordinates.
     * @param {object} [gridInfo=null] - Optional grid information.
     * @returns {THREE.Group} The complete gizmo group.
     * @private
     */
    _createSingleGizmo(lightDef, position, gridInfo = null) {
        const gizmo = new THREE.Group();

        // The color is determined by which control zone the luminaire falls in
        const color = this._getGizmoColor(lightDef, gridInfo);

        const material = new THREE.MeshBasicMaterial({
            color: new THREE.Color(color),
            wireframe: true
        });

        const geometry = this._createGizmoGeometry(lightDef);
        gizmo.add(new THREE.Mesh(geometry, material));

        if (lightDef.type === 'spotlight') {
            const coneHelper = this._createSpotlightCone(lightDef.cone_angle, color);
            gizmo.add(coneHelper);
        }

        gizmo.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, 0), 0.4, color));
        return gizmo;
    }
    
/**
     * Determines the appropriate color for a light gizmo based on which control zone it
     * falls in.
     *
     * `percentControlled` is labelled "Fraction of Lights Controlled", so the split must be
     * by LUMINAIRE COUNT, not by a linear slice of the room's length/width — for an uneven
     * grid (e.g. 3 rows at 60%) those two give different answers.
     *
     * @param {object} lightDef - The light definition.
     * @param {?{r: number, c: number, numRows: number, numCols: number}} gridInfo - The
     *        luminaire's index within the grid, or null for a single luminaire.
     * @returns {string} The CSS color string.
     * @private
     */
    _getGizmoColor(lightDef, gridInfo = null) {
        const style = getComputedStyle(document.documentElement);
        const visualizeZones = this.dom['daylighting-visualize-zones-toggle']?.checked;
        const daylightingEnabled = lightDef.daylighting?.enabled;

        // Only apply zone colors if visualization is enabled
        if (visualizeZones && daylightingEnabled && lightDef.daylighting.sensors) {
            const { sensors, zoningStrategy = 'rows' } = lightDef.daylighting;
            const zone1Color = style.getPropertyValue('--zone1-color')?.trim() || '#3b82f6';
            const zone2Color = style.getPropertyValue('--zone2-color')?.trim() || '#16a34a';

            if (sensors.length === 1) {
                return zone1Color; // If only one sensor, all lights are in its zone.
            }
            if (sensors.length === 2) {
                // A lone luminaire cannot be split; it belongs entirely to sensor 1's zone.
                if (!gridInfo) return zone1Color;

                const percent1 = Math.min(1, Math.max(0, sensors[0].percentControlled ?? 1));
                const { r, c, numRows, numCols } = gridInfo;

                if (zoningStrategy === 'rows') {
                    // 'Rows' assigns whole rows to zone 1, front to back, until the
                    // requested fraction of the luminaire count is reached.
                    const zone1Rows = Math.round(numRows * percent1);
                    return (r < zone1Rows) ? zone1Color : zone2Color;
                } else { // strategy === 'cols'
                    // 'Columns' assigns whole columns to zone 1, left to right.
                    const zone1Cols = Math.round(numCols * percent1);
                    return (c < zone1Cols) ? zone1Color : zone2Color;
                }
            }
        }

        // Default color if visualization is off or misconfigured
        return style.getPropertyValue('--light-source-color').trim() || '#ffff00';
    }

    /**
     * Creates the appropriate THREE.BufferGeometry for a light gizmo.
     * @param {object} lightDef - The light definition.
     * @returns {THREE.BufferGeometry}
     * @private
     */
    _createGizmoGeometry(lightDef) {
        const { type, radius, length, innerRadius, outerRadius } = lightDef.geometry;
        switch (type) {
            case 'sphere':
                return new THREE.SphereGeometry(radius, 32, 16);
            case 'cylinder': {
                const geom = new THREE.CylinderGeometry(radius, radius, length, 32);
                return geom.rotateX(Math.PI / 2); // Align with local Z-axis
            }
            case 'ring': {
                const geom = new THREE.RingGeometry(innerRadius, outerRadius, 32);
                // RingGeometry is already built in the XY plane with a +Z normal. The old
                // rotateX(-PI/2) pushed it into the XZ plane, so a ceiling ring drew
                // edge-on as a vertical disc. Rotate by PI instead, which keeps it in XY
                // and turns the normal to -Z, matching the aim arrow and spotlight cone.
                return geom.rotateX(Math.PI);
            }
            case 'polygon':
            case 'ies':
            default:
                return new THREE.PlaneGeometry(0.25, 0.25);
        }
    }

    /**
     * Creates a wireframe cone helper for spotlight visualization.
     * @param {number} angle - The cone angle in degrees.
     * @param {string} color - The CSS color string.
     * @returns {THREE.Mesh} The cone mesh.
     * @private
     */
    _createSpotlightCone(angle, color) {
        const coneHeight = 0.8;
        const coneRadius = coneHeight * Math.tan(THREE.MathUtils.degToRad(angle / 2));
        const coneGeom = new THREE.ConeGeometry(coneRadius, coneHeight, 32, 1, true);
        coneGeom.translate(0, -coneHeight / 2, 0); // Position base at origin
        coneGeom.rotateX(Math.PI / 2); // Point along local -Z
        const coneMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), wireframe: true, transparent: true, opacity: 0.3 });
        return new THREE.Mesh(coneGeom, coneMaterial);
    }
    
    /**
     * Creates gizmos for a grid layout. The grid is NOT constrained to the room; it is laid
     * out exactly as scriptGenerator.js will export it, and an overflow is reported instead.
     * @param {object} lightDef - The light definition object.
     * @param {Function} placeGizmo - The function to call for placing each gizmo.
     * @private
     */
    _createGridGizmos(lightDef, placeGizmo) {
        const W = parseFloat(this.dom['width'].value);
        const L = parseFloat(this.dom['length'].value);

        const { rows, cols, row_spacing, col_spacing } = lightDef.grid;
        const numRows = Math.max(1, rows || 1);
        const numCols = Math.max(1, cols || 1);

        const gridSpanX = (numCols - 1) * col_spacing;
        const gridSpanZ = (numRows - 1) * row_spacing;

        const { x: desiredCenterX, z: desiredCenterZ } = lightDef.position;

        // The grid start must match scriptGenerator.js exactly (it recomputes startX/startY
        // from the same numbers with no clamping). The preview used to shove an oversized
        // grid back inside the room, which made the preview and the exported scene disagree
        // about where every luminaire is. Per the shared contract the clamp is gone; an
        // out-of-room grid is now reported instead of silently moved.
        const startX = desiredCenterX - gridSpanX / 2;
        const startZ = desiredCenterZ - gridSpanZ / 2;

        const overflows = (startX < 0) || (startX + gridSpanX > W) || (startZ < 0) || (startZ + gridSpanZ > L);
        this._setGridWarning(overflows
            ? `Luminaire grid extends outside the room (${numCols}×${numRows} spanning ${gridSpanX.toFixed(2)}×${gridSpanZ.toFixed(2)} m in a ${W.toFixed(2)}×${L.toFixed(2)} m room). Luminaires outside the room are still exported at these positions.`
            : null);

        for (let r = 0; r < numRows; r++) {
        for (let c = 0; c < numCols; c++) {
            const position = {
                x: startX + c * col_spacing,
                y: lightDef.position.y,
                z: startZ + r * row_spacing
            };
            const gridInfo = { r, c, numRows, numCols };
            placeGizmo(position, gridInfo);
        }
    }
}
    
    // --- PRIVATE: EVENT HANDLING & UI MANAGEMENT ---

    /**
     * Schedules a single visual update on the next animation frame.
     * @private
     */
    _scheduleUpdate() {
        if (this.updateScheduled) return;
        this.updateScheduled = true;
        requestAnimationFrame(() => {
            this.updateVisuals();
            import('./geometry.js').then(({ updateDaylightingSensorVisuals }) => {
                updateDaylightingSensorVisuals();
            }).catch(err => console.error("Failed to update daylighting visuals:", err));
            this.updateScheduled = false;
        });
    }

    /**
     * Binds all event listeners for the lighting panel.
     * @private
     */
    _bindEventListeners() {
        const listeners = {
            'lighting-enabled-toggle': { event: 'change', handler: () => this._toggleLightingControls() },
            'light-type-selector': { event: 'change', handler: () => this._toggleLightParamSections() },
            'placement-mode-individual': { event: 'click', handler: () => this._togglePlacementMode(false) },
            'placement-mode-grid': { event: 'click', handler: () => this._togglePlacementMode(true) },
            'light-geometry-selector': { event: 'change', handler: () => { this._toggleGeometryParams(); this._scheduleUpdate(); } },
            'glow-behavior': { event: 'change', handler: () => { this._toggleGlowRadiusInput(); this._scheduleUpdate(); } },
            'ies-file-input': { event: 'change', handler: (e) => this._handleIesFileChange(e) },
            'daylighting-enabled-toggle': { event: 'change', handler: () => this._toggleDaylightingControls() },
            'daylighting-visualize-zones-toggle': { event: 'change', handler: () => this._scheduleUpdate() },
            'daylighting-control-type': { event: 'change', handler: () => this._toggleDaylightControlTypeParams() },
            'daylighting-zone-strategy-rows': { event: 'click', handler: (e) => this._handleZoneStrategyChange(e) },
            'daylighting-zone-strategy-cols': { event: 'click', handler: (e) => this._handleZoneStrategyChange(e) },
            'daylight-sensor-count': { event: 'change', handler: () => this._toggleSensorCountControls() },
            'daylight-sensor1-percent': { event: 'input', handler: (e) => this._handleFractionSliders(e) },
            'daylight-sensor2-percent': { event: 'input', handler: (e) => this._handleFractionSliders(e) },
            'daylighting-availability-schedule': { event: 'change', handler: (e) => this._handleScheduleFileChange(e) },
            'daylight-sensor1-gizmo-toggle': { event: 'change', handler: () => this._handleGizmoToggle('daylight-sensor1-gizmo-toggle') },
            'daylight-sensor2-gizmo-toggle': { event: 'change', handler: () => this._handleGizmoToggle('daylight-sensor2-gizmo-toggle') },
        };

        // --- Gizmo Drag Listener ---
        // This listener syncs the 3D gizmo's position back to the UI sliders when a drag operation finishes.
        sensorTransformControls.addEventListener('dragging-changed', (event) => {
            if (event.value === false) { // Event fires when dragging stops
                if (!sensorTransformControls.object) return;

                const controlledObject = sensorTransformControls.object;
                const isSensor1 = controlledObject.name === 'daylightingSensor1';
                const isSensor2 = controlledObject.name === 'daylightingSensor2';

                if (!isSensor1 && !isSensor2) return;

                const W = parseFloat(this.dom.width.value);
                const L = parseFloat(this.dom.length.value);
                const sensorIndex = isSensor1 ? 1 : 2;
                const finalPosition = controlledObject.position;

                const sliderX = finalPosition.x - W / 2;
                const sliderZ = finalPosition.z - L / 2;

                // Update slider values directly
                if (this.dom[`daylight-sensor${sensorIndex}-x`]) this.dom[`daylight-sensor${sensorIndex}-x`].value = sliderX.toFixed(2);
                if (this.dom[`daylight-sensor${sensorIndex}-y`]) this.dom[`daylight-sensor${sensorIndex}-y`].value = finalPosition.y.toFixed(2);
                if (this.dom[`daylight-sensor${sensorIndex}-z`]) this.dom[`daylight-sensor${sensorIndex}-z`].value = sliderZ.toFixed(2);

                updateAllLabels();

                // Trigger an 'input' event to notify the rest of the app of the change.
                if (this.dom[`daylight-sensor${sensorIndex}-x`]) {
                    this.dom[`daylight-sensor${sensorIndex}-x`].dispatchEvent(new Event('input', { bubbles: true }));
                }
            }
        });

        for (const id in listeners) {
            this.dom[id]?.addEventListener(listeners[id].event, listeners[id].handler);
        }

        const updateOnChangeIds = [
            'light-pos-x', 'light-pos-y', 'light-pos-z',
            'light-rot-x', 'light-rot-y', 'light-rot-z',
            'grid-rows', 'grid-cols', 'grid-row-spacing', 'grid-col-spacing'
        ];
        updateOnChangeIds.forEach(id => this.dom[id]?.addEventListener('input', () => this._scheduleUpdate()));
    }
    
    /**
     * Handles the selection of a new availability schedule file.
     * @param {Event} event - The file input change event.
     * @private
     */
    async _handleScheduleFileChange(event) {
        const file = event.target.files[0];
        try {
            const { project } = await import('./project.js'); // Lazy load
            if (file) {
                const content = await file.text();
                // Key must match the load side in project.js (daylighting-availability-schedule).
                project.addSimulationFile('daylighting-availability-schedule', file.name, content);
                this.scheduleFileData = { name: file.name };
                this._setFileDisplayName('daylighting-availability-schedule', file.name);
            } else {
                project.addSimulationFile('daylighting-availability-schedule', null, null);
                this.scheduleFileData = null;
                this._setFileDisplayName('daylighting-availability-schedule', null);
            }
        } catch (error) {
            console.error("Error reading availability schedule file:", error);
            this.scheduleFileData = null;
            this._setFileDisplayName('daylighting-availability-schedule', 'Error reading file');
        }
    }

    /**
     * Ensures only one daylighting sensor gizmo can be active at a time.
     * @param {string} changedId - The ID of the toggle that was changed.
     * @private
     */
    _handleGizmoToggle(changedId) {
        const toggles = ['daylight-sensor1-gizmo-toggle', 'daylight-sensor2-gizmo-toggle'];
        const isChecked = this.dom[changedId].checked;

        // Ensure only one toggle is active at a time
        if (isChecked) {
            toggles.forEach(id => {
                if (id !== changedId) this.dom[id].checked = false;
            });
        }

        // Directly attach/detach the gizmo without a full scene redraw.
        attachGizmoToSelectedSensor();
    }
    
    /**
     * Sets the initial visibility state of all UI sections in the panel.
     * @private
     */
    _synchronizeUIState() {
        this._toggleLightingControls();
        this._toggleLightParamSections();
        this._togglePlacementMode(this.dom['placement-mode-grid']?.classList.contains('active'));
        this._toggleGeometryParams();
        this._toggleGlowRadiusInput();
        this._toggleDaylightingControls();
        this._toggleDaylightControlTypeParams();
        this._toggleSensorCountControls();
        this._scheduleUpdate();
    }

    /** Toggles visibility of the main lighting controls wrapper. @private */
    _toggleLightingControls() {
        const isEnabled = this.dom['lighting-enabled-toggle']?.checked;
        this.dom['lighting-controls-wrapper']?.classList.toggle('hidden', !isEnabled);
        this.dom['lighting-power-section']?.classList.toggle('hidden', !isEnabled);
        this.dom['lighting-spec-section']?.classList.toggle('hidden', !isEnabled);
        this._scheduleUpdate();
    }

    /** Toggles visibility of parameter sections based on the selected light type. @private */
    _toggleLightParamSections() {
        const selectedType = this.dom['light-type-selector']?.value;
        this.dom['panel-lighting']?.querySelectorAll('.light-param-section').forEach(section => {
            section.classList.toggle('hidden', section.id !== `params-${selectedType}`);
        });
        this._toggleGeometryParams();
        this._scheduleUpdate();
    }
    
    /** Toggles visibility of geometry type parameters. @private */
    _toggleGeometryParams() {
        const selectedType = this.dom['light-type-selector']?.value;
        const showGeometry = selectedType !== 'ies';
        this.dom['light-geometry-section']?.classList.toggle('hidden', !showGeometry);
        this.dom['geometry-params-section']?.classList.toggle('hidden', !showGeometry);
        if (showGeometry) {
            const selectedGeo = this.dom['light-geometry-selector']?.value;
            this.dom['geometry-params-section']?.querySelectorAll(':scope > div').forEach(section => {
                section.classList.toggle('hidden', section.id !== `geo-params-${selectedGeo}`);
            });
        }
    }

    /** Toggles visibility of the glow radius input based on the glow behavior dropdown. @private */
    _toggleGlowRadiusInput() {
        const showRadius = this.dom['glow-behavior']?.value === 'positive';
        this.dom['glow-radius-input-container']?.classList.toggle('hidden', !showRadius);
    }
    
    /** Toggles between individual and grid placement modes. @private */
    _togglePlacementMode(isGrid) {
        this.dom['placement-mode-individual']?.classList.toggle('active', !isGrid);
        this.dom['placement-mode-grid']?.classList.toggle('active', isGrid);
        this.dom['grid-layout-inputs']?.classList.toggle('hidden', !isGrid);
        this._scheduleUpdate();
    }
    
    /** Toggles visibility of the main daylighting controls wrapper. @private */
    _toggleDaylightingControls() {
        const isEnabled = this.dom['daylighting-enabled-toggle']?.checked;
        this.dom['daylighting-controls-wrapper']?.classList.toggle('hidden', !isEnabled);
        this._scheduleUpdate();
    }

    /** Toggles visibility of parameters specific to a daylighting control type. @private */
    _toggleDaylightControlTypeParams() {
        const selectedType = this.dom['daylighting-control-type']?.value;
        this.dom['daylight-continuous-params']?.classList.toggle('hidden', selectedType === 'Stepped');
        this.dom['daylight-stepped-params']?.classList.toggle('hidden', selectedType !== 'Stepped');
        this._scheduleUpdate();
    }

     /** Toggles the UI for single vs. dual daylighting sensor setups. @private */
    _toggleSensorCountControls() {
        const count = parseInt(this.dom['daylight-sensor-count']?.value, 10);
        this.dom['daylight-sensor-2-controls']?.classList.toggle('hidden', count !== 2);
        this.dom['daylighting-zoning-strategy-controls']?.classList.toggle('hidden', count !== 2);

        const s1 = this.dom['daylight-sensor1-percent'];
        const s2 = this.dom['daylight-sensor2-percent'];

        if (s1 && s2) {
            if (count === 1) {
                s1.disabled = true;
                s1.value = 1.0;
                s2.disabled = true;
                s2.value = 0.0; // Ensure second sensor fraction is zero
            } else { // count === 2
                s1.disabled = false;
                s2.disabled = false;
                // When switching to 2 sensors, ensure values are valid (e.g., reset to 50/50)
                if (parseFloat(s1.value) === 1.0) {
                    s1.value = 0.5;
                    s2.value = 0.5;
                }
            }
            // Trigger UI updates for labels and the 3D scene
            updateAllLabels();
            this._scheduleUpdate();
        }
    }
    
    /** Enforces that the two sensor control fraction sliders sum to 1.0. @private */
    _handleFractionSliders(event) {
        // Prevent recursive calls while we programmatically update the sliders
        if (this._isUpdatingFractions) return;
        this._isUpdatingFractions = true;

        const s1 = this.dom['daylight-sensor1-percent'];
        const s2 = this.dom['daylight-sensor2-percent'];
        if (!s1 || !s2) {
            this._isUpdatingFractions = false;
            return;
        }

        const changedSlider = event.target;
        const otherSlider = (changedSlider === s1) ? s2 : s1;
        const changedValue = parseFloat(changedSlider.value);

        // Update the other slider to ensure the sum is always exactly 1.0
        otherSlider.value = (1.0 - changedValue).toFixed(2);

        // Manually update the text labels for both sliders, as one was changed without an input event
        updateAllLabels();

        // Allow this handler to run again
        this._isUpdatingFractions = false;
    }

    /** Manages active state for the zone strategy buttons and schedules an update. @private */
    _handleZoneStrategyChange(event) {
        const rowsBtn = this.dom['daylighting-zone-strategy-rows'];
        const colsBtn = this.dom['daylighting-zone-strategy-cols'];
        if (!rowsBtn || !colsBtn) return;

        const isRows = event.target === rowsBtn;
        rowsBtn.classList.toggle('active', isRows);
        colsBtn.classList.toggle('active', !isRows);

    this._scheduleUpdate();
    }

    /**
     * Handles the selection of a new .ies file.
     * @param {Event} event - The file input change event.
     * @private
     */
    async _handleIesFileChange(event) {
        const file = event.target.files[0];
        // Sequencing guard: this handler awaits, so picking file A then file B quickly can
        // settle out of order. Only the newest request is allowed to commit its result.
        const requestId = ++this._iesReadRequestId;

        try {
            const { project } = await import('./project.js'); // Lazy load
            if (requestId !== this._iesReadRequestId) return;

            if (!file) {
                // Key must match scriptGenerator.js, which reads simulationFiles['ies-file-input'].
                project.addSimulationFile('ies-file-input', null, null);
                this.iesFileData = null;
                this._setFileDisplayName('ies-file-input', null);
                this._updateIesViewer(null);
                this._scheduleUpdate();
                return;
            }

            const content = await file.text();
            if (requestId !== this._iesReadRequestId) return;

            // Register the file in the central project store. Without this,
            // scriptGenerator.js cannot find simulationFiles['ies-file-input'] and emits
            // '# ERROR: IES file selected but file data not found in project.', so the
            // whole electric-lighting simulation runs with zero luminous output.
            project.addSimulationFile('ies-file-input', file.name, content);
            this.iesFileData = { name: file.name, content: content };
            this._setFileDisplayName('ies-file-input', file.name);
            this._updateIesViewer(content);
            this._scheduleUpdate();
        } catch (error) {
            if (requestId !== this._iesReadRequestId) return;
            console.error("Error reading IES file:", error);
            this.iesFileData = null;
            this._setFileDisplayName('ies-file-input', 'Error reading file');
            this._updateIesViewer(null);
        }
    }

    /**
     * Creates and manages the 3D photometric web viewer.
     * @param {object} parsedData - The parsed data from the IESParser.
     * @private
     */
    _updateIes3dView(parsedData) {
        this._setupIes3dViewer();
        const scene = this.ies3d.scene;
        if (!scene) return;

        // Clear previous mesh
        if (this.ies3d.webMesh) {
            this.ies3d.webMesh.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
            scene.remove(this.ies3d.webMesh);
        }

        this.ies3d.webMesh = this._createPhotometricWeb(parsedData);
        if (this.ies3d.webMesh) {
            scene.add(this.ies3d.webMesh);
        }
    }

    /**
     * Initializes the Three.js scene for the 3D IES viewer.
     * @private
     */
    _setupIes3dViewer() {
        if (this.ies3d.renderer) return; // Already initialized

        const container = this.dom['ies-3d-viewer-container'];
        if (!container) return;

        this.ies3d.scene = new THREE.Scene();
        this.ies3d.scene.background = null; // transparent

        // The container is only measurable once it is visible; if it is still collapsed
        // (0x0) the aspect would be NaN and the camera projection matrix would be poisoned.
        const initW = container.clientWidth || 1;
        const initH = container.clientHeight || 1;
        this.ies3d.camera = new THREE.PerspectiveCamera(50, initW / initH, 0.1, 100);
        this.ies3d.camera.position.set(1.2, 0.8, 1.8);

        const ambient = new THREE.AmbientLight(0xffffff, 0.6);
        this.ies3d.scene.add(ambient);
        const directional = new THREE.DirectionalLight(0xffffff, 1.2);
        directional.position.set(1, 2, 1.5);
        this.ies3d.scene.add(directional);

        this.ies3d.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.ies3d.renderer.setSize(initW, initH);
        this.ies3d.renderer.setPixelRatio(window.devicePixelRatio);
        container.appendChild(this.ies3d.renderer.domElement);

        this.ies3d.controls = new OrbitControls(this.ies3d.camera, this.ies3d.renderer.domElement);
        this.ies3d.controls.enableDamping = true;
        this.ies3d.controls.dampingFactor = 0.1;
        this.ies3d.controls.minDistance = 1;
        this.ies3d.controls.maxDistance = 10;
        this.ies3d.controls.autoRotate = true;
        this.ies3d.controls.autoRotateSpeed = 0.75;


        const animate = () => {
            if (!this.ies3d.renderer || !this.ies3d.scene || !this.ies3d.camera) return;
            this.ies3d.animationFrameId = requestAnimationFrame(animate);
            this.ies3d.controls.update();
            this.ies3d.renderer.render(this.ies3d.scene, this.ies3d.camera);
        };
        animate();

        this.ies3d.resizeObserver = new ResizeObserver(() => {
            if (!this.ies3d.renderer || !this.ies3d.camera) return;
            const w = container.clientWidth;
            const h = container.clientHeight;
            if (w === 0 || h === 0) return;
            this.ies3d.camera.aspect = w / h;
            this.ies3d.camera.updateProjectionMatrix();
            this.ies3d.renderer.setSize(w, h);
        });
        this.ies3d.resizeObserver.observe(container);
    }

    /**
     * Expands the tabulated C-planes of an LM-63 file into a full, closed 0..360 degree
     * ring of planes so the photometric web can be built as a proper surface.
     *
     * LM-63 lets a file declare only the planes it needs and rely on symmetry:
     *   - one plane (or a 0..0 span): the distribution is rotationally symmetric, so the
     *     single plane is revolved into a solid of revolution;
     *   - 0..90 : quadrant symmetry, mirrored about 90 then about 180;
     *   - 0..180: bilateral symmetry, mirrored about 180;
     *   - 0..360: already complete (the last plane duplicates the first);
     *   - anything else (e.g. 0..350): closed by repeating the first plane at +360.
     *
     * @param {number[]} verticalAngles - The vertical angle list.
     * @param {number[]} horizontalAngles - The tabulated horizontal (C) angles.
     * @param {number[]} allCandelaValues - Candela values, H-major then V.
     * @returns {{hAngles: number[], planes: number[][]}} The closed ring of planes.
     * @private
     */
    _expandPhotometricPlanes(verticalAngles, horizontalAngles, allCandelaValues) {
        const numV = verticalAngles.length;
        const numH = horizontalAngles.length;

        const sourcePlanes = [];
        for (let j = 0; j < numH; j++) {
            sourcePlanes.push(allCandelaValues.slice(j * numV, (j + 1) * numV));
        }

        const span = numH > 1 ? horizontalAngles[numH - 1] - horizontalAngles[0] : 0;
        const near = (a, b) => Math.abs(a - b) < 0.5;

        // Rotationally symmetric: revolve the single plane about the vertical axis.
        if (numH === 1 || near(span, 0)) {
            const STEPS = 24;
            const hAngles = [];
            const planes = [];
            for (let k = 0; k <= STEPS; k++) {
                hAngles.push((k * 360) / STEPS);
                planes.push(sourcePlanes[0]);
            }
            return { hAngles, planes };
        }

        const hAngles = horizontalAngles.slice();
        const planes = sourcePlanes.slice();

        const mirrorAbout = (total) => {
            const n = hAngles.length;
            for (let k = n - 2; k >= 0; k--) {
                hAngles.push(total - hAngles[k]);
                planes.push(planes[k]);
            }
        };

        if (near(span, 90)) {
            mirrorAbout(180);
            mirrorAbout(360);
        } else if (near(span, 180)) {
            mirrorAbout(360);
        } else if (near(span, 360)) {
            // Already a closed full revolution.
        } else {
            // Partial coverage that is not a documented symmetry (e.g. 0..350 in 10 degree
            // steps): close the ring by repeating the first plane one turn later.
            hAngles.push(hAngles[0] + 360);
            planes.push(planes[0]);
        }

        return { hAngles, planes };
    }

    /**
     * Generates a 3D mesh representing the photometric web.
     * @param {object} parsedData - The parsed data from IESParser.
     * @returns {THREE.Mesh|null} The generated mesh or null.
     * @private
     */
    _createPhotometricWeb(parsedData) {
        const { verticalAngles, horizontalAngles, allCandelaValues, maxCandela } = parsedData;
        const numV = verticalAngles.length;

        if (numV < 2 || horizontalAngles.length < 1 || allCandelaValues.length === 0) return null;

        // Expand the tabulated C-planes into a closed 0..360 ring so the surface can be
        // built without wrapping the last plane back onto C0.
        const { hAngles, planes } = this._expandPhotometricPlanes(verticalAngles, horizontalAngles, allCandelaValues);
        const numH = hAngles.length;
        if (numH < 2) return null;

        const vertices = [];
        const indices = [];
        const scale = 1 / maxCandela;

        for (let j = 0; j < numH; j++) {
            const hAngleRad = THREE.MathUtils.degToRad(hAngles[j]);
            const plane = planes[j];
            for (let i = 0; i < numV; i++) {
                const vAngleRad = THREE.MathUtils.degToRad(verticalAngles[i]);
                const r = plane[i] * scale;

                const x = r * Math.sin(vAngleRad) * Math.cos(hAngleRad);
                const y = -r * Math.cos(vAngleRad);
                const z = r * Math.sin(vAngleRad) * Math.sin(hAngleRad);
                vertices.push(x, y, z);
            }
        }

        // The ring is already closed (the last plane repeats the first), so quads run
        // strictly between consecutive planes. The old `(j + 1) % numH` collapsed every
        // triangle when numH === 1, which is the common rotationally-symmetric downlight.
        for (let j = 0; j < numH - 1; j++) {
            for (let i = 0; i < numV - 1; i++) {
                const p1 = j * numV + i;
                const p2 = (j + 1) * numV + i;
                const p3 = (j + 1) * numV + (i + 1);
                const p4 = j * numV + (i + 1);
                indices.push(p1, p2, p4);
                indices.push(p2, p3, p4);
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setIndex(indices);
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.computeVertexNormals();

        const style = getComputedStyle(document.documentElement);
        const material = new THREE.MeshStandardMaterial({
            color: new THREE.Color(style.getPropertyValue('--highlight-color').trim()),
            side: THREE.DoubleSide,
            metalness: 0.2,
            roughness: 0.6
        });

        const mesh = new THREE.Mesh(geometry, material);

        const wireframeGeom = new THREE.WireframeGeometry(geometry);
        const wireframeMat = new THREE.LineBasicMaterial({
            color: new THREE.Color(style.getPropertyValue('--text-secondary').trim()),
            transparent: true,
            opacity: 0.3
        });
        mesh.add(new THREE.LineSegments(wireframeGeom, wireframeMat));
        return mesh;
    }

    /**
     * Cleans up all resources used by the 3D IES viewer.
     * @private
     */
    _clearIes3dView() {
        if (this.ies3d.animationFrameId) {
            cancelAnimationFrame(this.ies3d.animationFrameId);
            this.ies3d.animationFrameId = null;
        }
        if (this.ies3d.resizeObserver) {
            this.ies3d.resizeObserver.disconnect();
            this.ies3d.resizeObserver = null;
        }
        if (this.ies3d.scene) {
            while (this.ies3d.scene.children.length > 0) {
                const object = this.ies3d.scene.children[0];
                // Free the GPU resources too, not just the parent link. This viewer scene
                // only ever holds lights and the generated web, none of which share
                // geometry or materials with anything else.
                object.traverse?.(child => {
                    child.geometry?.dispose?.();
                    if (child.material) {
                        const materials = Array.isArray(child.material) ? child.material : [child.material];
                        materials.forEach(material => material.dispose?.());
                    }
                });
                this.ies3d.scene.remove(object);
            }
            this.ies3d.scene = null;
        }
        this.ies3d.webMesh = null;
        if (this.ies3d.controls) {
            this.ies3d.controls.dispose();
            this.ies3d.controls = null;
        }
        if (this.ies3d.renderer) {
            // dispose() alone leaves the WebGL context alive; alternating valid and
            // malformed IES files then exhausts the browser's context cap (~16) and the
            // browser starts reclaiming contexts, which can kill the main room viewport.
            this.ies3d.renderer.dispose();
            this.ies3d.renderer.forceContextLoss?.();
            this.ies3d.renderer.domElement.remove();
            this.ies3d.renderer = null;
        }
        this.ies3d.camera = null;
    }

    // --- PRIVATE: STATE GETTERS ---

    /** @private @returns {object} */
    _getBaseLightDef() {
        return {
            type: this.dom['light-type-selector'].value,
            placement: this.dom['placement-mode-grid'].classList.contains('active') ? 'grid' : 'individual',
            position: { x: this._getUIValue('light-pos-x'), y: this._getUIValue('light-pos-y'), z: this._getUIValue('light-pos-z') },
            rotation: { x: this._getUIValue('light-rot-x'), y: this._getUIValue('light-rot-y'), z: this._getUIValue('light-rot-z') },
            identifier: 'live_preview_light',
            maintenance_factor: this._getUIValue('maintenance-factor'),
            ra: this.dom['light-source-ra']?.value,
            tcp: this.dom['light-source-tcp']?.value,
            luminaire_wattage: this._getUIValue('luminaire-wattage', 0),
        };
    }
    
    /** @private @param {object} def */
    _addGeometryDef(def) {
        def.geometry = { type: this.dom['light-geometry-selector']?.value || 'ies' };
        if (def.type === 'ies') return;

        switch (def.geometry.type) {
            case 'sphere':
                def.geometry.radius = this._getUIValue('geo-sphere-radius');
                break;
            case 'cylinder':
                def.geometry.radius = this._getUIValue('geo-cylinder-radius');
                def.geometry.length = this._getUIValue('geo-cylinder-length');
                break;
            case 'ring':
                def.geometry.innerRadius = this._getUIValue('geo-ring-radius-in');
                def.geometry.outerRadius = this._getUIValue('geo-ring-radius-out');
                break;
        }
    }

    /** @private @param {object} def */
    _addTypeSpecificDef(def) {
        const getRgb = (prefix) => [this._getUIValue(`${prefix}-r`), this._getUIValue(`${prefix}-g`), this._getUIValue(`${prefix}-b`)];
        switch (def.type) {
            case 'light':
                def.rgb = getRgb('light-rgb');
                break;
            case 'spotlight':
                def.rgb = getRgb('spot-rgb');
                def.cone_angle = this._getUIValue('spot-cone-angle');
                def.direction = [this._getUIValue('spot-dir-x'), this._getUIValue('spot-dir-y'), this._getUIValue('spot-dir-z')];
                def.normalize = this.dom['spot-normalize-toggle']?.checked;
                break;
            case 'glow':
                def.rgb = getRgb('glow-rgb');
                const behavior = this.dom['glow-behavior']?.value;
                def.max_radius = (behavior === 'positive') ? this._getUIValue('glow-max-radius') : parseFloat(behavior);
                break;
            case 'illum':
                def.rgb = getRgb('illum-rgb');
                def.alternate_material = this.dom['illum-alt-material']?.value.trim();
                break;
            case 'ies':
                // Field names below are the exporter's contract; they map 1:1 onto ies2rad
                // flags: ies_units -> -d, ies_multiplier -> -m, ies_lamp_type -> -t,
                // ies_force_color/ies_color -> -c, ies_file -> the .rad prototype basename.
                def.ies_file_data = this.iesFileData;
                def.ies_file = this.iesFileData?.name?.replace(/\.ies$/i, '');
                def.ies_units = this.dom['ies-units']?.value;
                def.ies_multiplier = this._getUIValue('ies-multiplier');
                def.ies_lamp_type = this.dom['ies-lamp-type']?.value.trim();
                def.ies_force_color = this.dom['ies-force-color-toggle']?.checked;
                def.ies_color = getRgb('ies-color');
                break;
        }
    }

    /** @private @param {object} def */
    _addGridDef(def) {
        if (def.placement === 'grid') {
            def.grid = {
                rows: this._getUIValue('grid-rows', 1, true),
                cols: this._getUIValue('grid-cols', 1, true),
                row_spacing: this._getUIValue('grid-row-spacing'),
                col_spacing: this._getUIValue('grid-col-spacing')
            };
        }
    }

    /** @private @param {object} def */
    _addDaylightingDef(def) {
        const isEnabled = this.dom['daylighting-enabled-toggle']?.checked;
        def.daylighting = {
            enabled: isEnabled,
            visualizeZones: this.dom['daylighting-visualize-zones-toggle']?.checked,
            // Persist the availability schedule reference so it survives save/load.
            scheduleFile: this.scheduleFileData || null
        };
        if (!isEnabled) return;

        const sensorCount = this._getUIValue('daylight-sensor-count', 1, true);
        Object.assign(def.daylighting, {
            zoningStrategy: this.dom['daylighting-zone-strategy-cols']?.classList.contains('active') ? 'cols' : 'rows',
            controlType: this.dom['daylighting-control-type']?.value || 'Continuous',
            setpoint: this._getUIValue('daylighting-setpoint', 500),
            minPowerFraction: this._getUIValue('daylighting-min-power-frac', 0.3),
            minLightFraction: this._getUIValue('daylighting-min-light-frac', 0.2),
            nSteps: this._getUIValue('daylighting-steps', 3, true),
            sensors: Array.from({ length: sensorCount }, (_, i) => this._getSensorDef(i + 1))
        });
    }

    /**
     * Gathers the definition for a single daylighting sensor.
     *
     * COORDINATE CONVENTION — note that this object and its sibling `lightDef.position`
     * use DIFFERENT origins, deliberately:
     *   - The daylighting sensor x/z returned here are CENTRED: the sliders in index.html
     *     run min=-10 max=10 with the room centre at 0, so x = -W/2 is the west wall and
     *     x = +W/2 is the east wall. y is an absolute height above the floor.
     *   - `lightDef.position` (see _getBaseLightDef) is CORNER-ORIGIN: x in [0, W],
     *     z in [0, L], measured from the room's (0, 0) corner.
     * Per the shared contract, lighting.js keeps the centred values as authored by the UI
     * and project.js converts centred -> corner-origin before handing them to
     * transformThreePointToRadianceArray. Do NOT subtract W/2 or L/2 here; doing it on both
     * sides is what put the sensor in the floor/wall corner.
     *
     * @param {number} index - The 1-based index of the sensor.
     * @returns {object} The sensor definition object with centred x/z.
     * @private
     */
    _getSensorDef(index) {
        return {
            x: this._getUIValue(`daylight-sensor${index}-x`, 0),
            y: this._getUIValue(`daylight-sensor${index}-y`, 0.8),
            z: this._getUIValue(`daylight-sensor${index}-z`, 0),
            direction: {
                x: this._getUIValue(`daylight-sensor${index}-dir-x`, 0),
                y: this._getUIValue(`daylight-sensor${index}-dir-y`, 1),
                z: this._getUIValue(`daylight-sensor${index}-dir-z`, 0)
            },
            percentControlled: this._getUIValue(`daylight-sensor${index}-percent`, 1),
        };
    }
    
    // --- PRIVATE: STATE SETTERS ---

    /** @private @param {object} state */
    _applyGeneralState(state) {
        this._setUIValue('light-type-selector', state.type);
        // Restore the placement mode. _getBaseLightDef reads it from the button's 'active'
        // class and _synchronizeUIState re-reads that same class, so without this a saved
        // grid reopens as a single luminaire.
        this._togglePlacementMode(state.placement === 'grid');
        this._setUIValue('light-pos-x', state.position?.x);
        this._setUIValue('light-pos-y', state.position?.y);
        this._setUIValue('light-pos-z', state.position?.z);
        this._setUIValue('light-rot-x', state.rotation?.x);
        this._setUIValue('light-rot-y', state.rotation?.y);
        this._setUIValue('light-rot-z', state.rotation?.z);
        this._setUIValue('grid-rows', state.grid?.rows);
        this._setUIValue('grid-cols', state.grid?.cols);
        this._setUIValue('grid-row-spacing', state.grid?.row_spacing);
        this._setUIValue('grid-col-spacing', state.grid?.col_spacing);
        this._setUIValue('maintenance-factor', state.maintenance_factor);
        this._setUIValue('light-source-ra', state.ra);
        this._setUIValue('light-source-tcp', state.tcp);
        this._setUIValue('luminaire-wattage', state.luminaire_wattage);
    }
    
    /** @private @param {object} state */
    _applyGeometryState(state) {
        this._setUIValue('light-geometry-selector', state.geometry?.type);
        this._setUIValue('geo-sphere-radius', state.geometry?.radius);
        this._setUIValue('geo-cylinder-radius', state.geometry?.radius);
        this._setUIValue('geo-cylinder-length', state.geometry?.length);
        this._setUIValue('geo-ring-radius-in', state.geometry?.innerRadius);
        this._setUIValue('geo-ring-radius-out', state.geometry?.outerRadius);
    }
    
    /** @private @param {object} state */
    _applyTypeSpecificState(state) {
        const setRgb = (prefix, rgb) => {
            this._setUIValue(`${prefix}-r`, rgb?.[0]);
            this._setUIValue(`${prefix}-g`, rgb?.[1]);
            this._setUIValue(`${prefix}-b`, rgb?.[2]);
        };
        switch (state.type) {
            case 'light': setRgb('light-rgb', state.rgb); break;
            case 'spotlight':
                setRgb('spot-rgb', state.rgb);
                this._setUIValue('spot-cone-angle', state.cone_angle);
                this._setUIValue('spot-dir-x', state.direction?.[0]);
                this._setUIValue('spot-dir-y', state.direction?.[1]);
                this._setUIValue('spot-dir-z', state.direction?.[2]);
                this._setUIValue('spot-normalize-toggle', state.normalize, 'checked');
                break;
            case 'glow':
                setRgb('glow-rgb', state.rgb);
                const behavior = state.max_radius > 0 ? 'positive' : state.max_radius;
                this._setUIValue('glow-behavior', behavior);
                this._setUIValue('glow-max-radius', state.max_radius > 0 ? state.max_radius : 1.0);
                break;
            case 'illum':
                setRgb('illum-rgb', state.rgb);
                this._setUIValue('illum-alt-material', state.alternate_material);
                break;
            case 'ies':
                this.iesFileData = state.ies_file_data || null;
                // Re-register with the project store so scriptGenerator.js can find
                // simulationFiles['ies-file-input'] after loading a project that predates
                // the file ever being registered there.
                if (this.iesFileData?.name && this.iesFileData?.content) {
                    import('./project.js')
                        .then(({ project }) => project.addSimulationFile('ies-file-input', this.iesFileData.name, this.iesFileData.content))
                        .catch(err => console.error("Failed to register IES file with project:", err));
                }
                this._setFileDisplayName('ies-file-input', this.iesFileData?.name);
                this._setUIValue('ies-units', state.ies_units);
                this._setUIValue('ies-multiplier', state.ies_multiplier);
                this._setUIValue('ies-lamp-type', state.ies_lamp_type);
                this._setUIValue('ies-force-color-toggle', state.ies_force_color, 'checked');
                setRgb('ies-color', state.ies_color);
                this._updateIesViewer(this.iesFileData?.content);
                break;
        }
    }
    
    /** @private @param {object} state */
    _applyDaylightingState(state) {
        if (!state.daylighting) return;
        this._setUIValue('daylighting-enabled-toggle', state.daylighting.enabled, 'checked');
        this._setUIValue('daylighting-visualize-zones-toggle', state.daylighting.visualizeZones, 'checked');

        if (state.daylighting.zoningStrategy === 'cols') {
            this.dom['daylighting-zone-strategy-cols']?.click();
        } else {
            this.dom['daylighting-zone-strategy-rows']?.click();
        }

        this._setUIValue('daylighting-control-type', state.daylighting.controlType);
        this._setUIValue('daylighting-setpoint', state.daylighting.setpoint);
        this._setUIValue('daylighting-min-power-frac', state.daylighting.minPowerFraction);
        this._setUIValue('daylighting-min-light-frac', state.daylighting.minLightFraction);
        this._setUIValue('daylighting-steps', state.daylighting.nSteps);
        this.scheduleFileData = state.daylighting.scheduleFile || null;
        this._setFileDisplayName('daylighting-availability-schedule', state.daylighting.scheduleFile?.name);

        if (state.daylighting.sensors) {
            this._setUIValue('daylight-sensor-count', state.daylighting.sensors.length);
            state.daylighting.sensors.forEach((sensor, i) => {
                const idx = i + 1;
                this._setUIValue(`daylight-sensor${idx}-x`, sensor.x);
                this._setUIValue(`daylight-sensor${idx}-y`, sensor.y);
                this._setUIValue(`daylight-sensor${idx}-z`, sensor.z);
                this._setUIValue(`daylight-sensor${idx}-dir-x`, sensor.direction?.x);
                this._setUIValue(`daylight-sensor${idx}-dir-y`, sensor.direction?.y);
                this._setUIValue(`daylight-sensor${idx}-dir-z`, sensor.direction?.z);
                this._setUIValue(`daylight-sensor${idx}-percent`, sensor.percentControlled);
            });
        }
    }
    
    // --- PRIVATE: UTILITY HELPERS ---

    /**
     * Safely gets a numeric value from a DOM element.
     * @param {string} id - The ID of the DOM element.
     * @param {number} [defaultValue=0] - The value to return if the element is not found or the value is invalid.
     * @param {boolean} [isInt=false] - Whether to parse the value as an integer.
     * @returns {number}
     * @private
     */
    _getUIValue(id, defaultValue = 0, isInt = false) {
        const element = this.dom[id];
        if (!element) return defaultValue;
        const value = isInt ? parseInt(element.value, 10) : parseFloat(element.value);
        return isNaN(value) ? defaultValue : value;
    }
    
    /**
     * Safely sets the value of a UI element and triggers update events.
     * @param {string} id - The ID of the DOM element.
     * @param {*} value - The value to set.
     * @param {'value'|'checked'} [property='value'] - The property to update on the element.
     * @private
     */
    _setUIValue(id, value, property = 'value') {
        const element = this.dom[id];
        if (element && value !== null && value !== undefined) {
            element[property] = value;
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    /**
     * Updates the display name for a file input.
     * @param {string} inputId - The ID of the file input.
     * @param {string} [fileName] - The name of the file to display.
     * @private
     */
    _setFileDisplayName(inputId, fileName) {
        const input = this.dom[inputId];
        if (!input) return;

        // Neither ies-file-input nor daylighting-availability-schedule has a
        // [data-file-display-for] target in index.html, and the old fallback created a
        // detached span that was never inserted — so the chosen filename was invisible and
        // a read failure looked exactly like a success. Create and insert the element.
        let display = input.parentElement?.querySelector(`[data-file-display-for="${inputId}"]`)
            || document.querySelector(`[data-file-display-for="${inputId}"]`);

        if (!display) {
            if (!input.parentElement) return;
            display = document.createElement('span');
            display.setAttribute('data-file-display-for', inputId);
            display.className = 'block text-xs font-mono mt-1 break-all';
            display.style.color = 'var(--text-secondary)';
            input.insertAdjacentElement('afterend', display);
        }

        display.textContent = fileName || '';
        display.title = fileName || '';
    }
    
    /**
     * Updates the IES viewer with new data or hides it.
     * @param {string|undefined} iesContent - The IES file content.
     * @private
     */
    _updateIesViewer(iesContent) {
        const viewerContainer = this.dom['ies-photometry-viewer'];
        if (iesContent) {
            try {
                const parsedData = IESParser.parse(iesContent);
                // Un-hide FIRST: while the container is hidden, canvas.clientWidth and the
                // 3D container's clientWidth/clientHeight are all 0, so the polar plot was
                // sized 0x0 with radius 0 and the camera aspect was NaN. Nothing ever
                // redrew them afterwards, so the 2D plot stayed permanently blank.
                viewerContainer?.classList.remove('hidden');
                this._updateIesInfoDisplay(parsedData);
                this._drawIesPolarPlot(parsedData);
                this._updateIes3dView(parsedData);
            } catch (error) {
                console.error("Error parsing or rendering IES data:", error);
                this._setFileDisplayName('ies-file-input', `Invalid IES file: ${error.message}`);
                this._setIesWarnings([]);
                viewerContainer?.classList.add('hidden');
                this._clearIes3dView();
            }
        } else {
            this._setIesWarnings([]);
            viewerContainer?.classList.add('hidden');
            this._clearIes3dView();
        }
    }

    /**
     * Updates the IES metadata display in the UI.
     * @param {object} parsedData - The parsed data from the IESParser.
     * @private
     */
    _updateIesInfoDisplay(parsedData) {
        const { numLamps, lumensPerLamp, wattage, isAbsolute, ballastFactor, warnings } = parsedData;
        // Absolute-photometry IES files signal luminous flux via candela values, not a
        // rated lamp lumen figure (lumensPerLamp === -1). Avoid showing negative totals.
        const isAbs = isAbsolute || lumensPerLamp === -1;
        // The ballast factor scales the delivered output; ignoring it overstates efficacy.
        const bf = (Number.isFinite(ballastFactor) && ballastFactor > 0) ? ballastFactor : 1;
        const totalLumens = isAbs ? null : numLamps * lumensPerLamp * bf;
        const efficacy = (!isAbs && wattage > 0) ? (totalLumens / wattage).toFixed(1) : 'N/A';

        if (this.dom['ies-lumens-val']) this.dom['ies-lumens-val'].textContent = isAbs ? 'Absolute' : totalLumens.toFixed(0);
        if (this.dom['ies-wattage-val']) this.dom['ies-wattage-val'].textContent = wattage.toFixed(1);
        if (this.dom['ies-efficacy-val']) this.dom['ies-efficacy-val'].textContent = efficacy;

        this._setIesWarnings(warnings);
    }

    /**
     * Shows or clears the IES parser warnings (non Type-C photometry, odd units, ...).
     * The element is created on first use because index.html has no placeholder for it.
     * @param {string[]} [warnings] - The warning messages to display.
     * @private
     */
    _setIesWarnings(warnings) {
        const host = this.dom['ies-photometry-viewer'];
        if (!host) return;
        const messages = Array.isArray(warnings) ? warnings.filter(Boolean) : [];
        let box = host.querySelector('[data-ies-warnings]');
        if (!box) {
            if (messages.length === 0) return;
            box = document.createElement('p');
            box.setAttribute('data-ies-warnings', '');
            box.className = 'text-xs mt-2 leading-snug';
            box.style.color = 'var(--warning-color, #d97706)';
            host.appendChild(box);
        }
        box.textContent = messages.join(' ');
        box.classList.toggle('hidden', messages.length === 0);
    }

    /**
     * Draws a 2D polar plot of the photometric data onto the canvas.
     * @param {object} parsedData - The parsed data from the IESParser.
     * @private
     */
    _drawIesPolarPlot(parsedData) {
        const { maxCandela, verticalAngles, candelaValuesFor2D } = parsedData;

        const canvas = this.dom['ies-polar-plot-canvas'];
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        // The caller un-hides the viewer before drawing so these are measurable; the
        // fallbacks only guard against the panel itself being collapsed.
        const width = canvas.clientWidth || canvas.parentElement?.clientWidth || 200;
        const height = canvas.clientHeight || canvas.parentElement?.clientHeight || 200;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        const centerX = width / 2;
        const centerY = height / 2;
        const radius = Math.min(centerX, centerY) * 0.9;
        ctx.clearRect(0, 0, width, height);

        this._drawPolarGrid(ctx, centerX, centerY, radius, maxCandela);

        ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--highlight-color').trim();
        ctx.lineWidth = 2;
        ctx.beginPath();
        candelaValuesFor2D.forEach((cd, i) => {
            const angleRad = verticalAngles[i] * Math.PI / 180;
            const r = (cd / maxCandela) * radius;
            const x = centerX + r * Math.sin(angleRad);
            // Vertical angle 0 is NADIR in LM-63, and canvas y grows DOWNWARD, so nadir
            // must plot BELOW the centre. The old `centerY - r*cos` drew every downlight as
            // an uplighter. This now matches the 3D web, which uses y = -r*cos(v).
            const y = centerY + r * Math.cos(angleRad);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();
    }
    
    /**
     * Draws the polar grid background for the IES plot.
     * @param {CanvasRenderingContext2D} ctx - The canvas context.
     * @param {number} cx - Center X coordinate.
     * @param {number} cy - Center Y coordinate.
     * @param {number} radius - The outer radius of the grid.
     * @param {number} maxValue - The maximum candela value for labeling.
     * @private
     */
    _drawPolarGrid(ctx, cx, cy, radius, maxValue) {
        const style = getComputedStyle(document.documentElement);
        ctx.strokeStyle = style.getPropertyValue('--grid-color').trim();
        ctx.fillStyle = style.getPropertyValue('--text-secondary').trim();
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';

        // Concentric circles
        for (let i = 1; i <= 4; i++) {
            const r = (i / 4) * radius;
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, 2 * Math.PI);
            ctx.stroke();
            if (i < 4) {
                ctx.fillText((maxValue * i / 4).toFixed(0), cx, cy - r - 4);
            }
        }
        // Radial lines
        for (let i = 0; i < 12; i++) {
            const angle = i * 30 * Math.PI / 180;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle));
            ctx.stroke();
        }
    }
}

// Create the singleton instance to be imported by other modules.
export const lightingManager = new LightingManager();

/**
 * Re-draws the luminaire gizmos against the current room dimensions, orientation and
 * elevation.
 *
 * `lightsGroup` is added directly to the scene and is deliberately NOT in geometry.js's
 * `groupsToTransform` list (it bakes the room transform into each gizmo instead, so that
 * per-luminaire rotations survive). That means the scene rebuild must call this whenever
 * the room changes, or the luminaires stay where they were. Import it lazily from
 * geometry.js (`import('./lighting.js').then(({ updateLightingVisuals }) => ...)`) to avoid
 * a static import cycle, since lighting.js already imports from geometry.js.
 */
export function updateLightingVisuals() {
    lightingManager.updateVisuals();
}

/*
 * ---------------------------------------------------------------------------------------
 * PREVIEW -> RADIANCE ORIENTATION CONTRACT (for scriptGenerator.js)
 * ---------------------------------------------------------------------------------------
 * The preview composes the luminaire orientation as THREE.Euler(rx, ry, rz, 'YXZ'), i.e.
 * R_three = Ry(ry) . Rx(rx) . Rz(rz), and aims the luminaire along its local -Z.
 *
 * ies2rad emits its prototype already aimed at nadir (verified with Radiance 6.1a: the
 * generated polygon's winding gives a -Z normal), so the exporter must NOT apply '-rx -90'
 * — that lands the luminaire horizontal. With the shared coordinate convention
 * (x, y, z)_three -> (x, -z, y)_radiance, the required Radiance rotation is
 *
 *     R_rad = Rz(ry) . Rx(rx) . Ry(-rz) . Rx(90)
 *
 * xform applies transforms in command order (first listed applied first), so:
 *
 *     !xform -rx 90 -ry <-rot.z> -rx <rot.x> -rz <rot.y> -t <X> <Y> <Z> <basename>.rad
 *
 * For the panel default (rot.x = -90, rot.y = rot.z = 0) this collapses to the identity,
 * which is correct: the prototype is already a downlight.
 * ---------------------------------------------------------------------------------------
 */