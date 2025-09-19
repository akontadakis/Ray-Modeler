// scripts/lighting.js

import * as THREE from 'three';

/**
 * Parses the text content of an IESNA LM-63 photometric data file.
 * This helper class isolates the complex parsing logic from the main LightingManager.
 */
class IESParser {
    /**
     * Parses the IES file content and extracts key photometric data.
     * @param {string} iesContent The raw text content of the .ies file.
     * @returns {{
     * lumensPerLamp: number,
     * maxCandela: number,
     * verticalAngles: number[],
     * candelaValues: number[]
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
        lineIndex++; // Move past the TILT line

        const dataLine = lines[lineIndex++].split(/\s+/).map(Number);
        if (dataLine.length < 10) throw new Error("IES file format error: Invalid data definition line.");

        const [ , lumensPerLamp, , numVAngles, numHAngles] = dataLine;
        if (numVAngles <= 0 || numHAngles <= 0) throw new Error("IES file format error: Invalid number of angles.");

        // All subsequent lines contain angle and candela data as a stream of numbers.
        const dataValues = lines.slice(lineIndex).join(' ').trim().split(/\s+/).map(Number);
        if (dataValues.length < numVAngles + numHAngles + numVAngles) {
            throw new Error("IES file format error: Not enough data points.");
        }

        const verticalAngles = dataValues.slice(0, numVAngles);
        // Horizontal angles are read to correctly index into the candela values, but are not used for the 2D plot.
        const candelaStartIndex = numVAngles + numHAngles;
        // For a 2D plot, we only use the candela values for the first horizontal angle.
        const candelaValues = dataValues.slice(candelaStartIndex, candelaStartIndex + numVAngles);

        const maxCandela = Math.max(...candelaValues);
        if (maxCandela <= 0) throw new Error("No valid candela values found for plotting.");

        return { lumensPerLamp, maxCandela, verticalAngles, candelaValues };
    }

    /**
     * Helper to read a block of angle data.
     * @param {string[]} lines - All lines from the file.
     * @param {number} startIndex - The line index to start reading from.
     * @param {number} count - The number of angles to read.
     * @returns {number[]} The array of angles.
     * @private
     */
    static _readAngleData(lines, startIndex, count) {
        return lines.slice(startIndex, startIndex + count).join(' ').trim().split(/\s+/).map(Number);
    }

    /**
     * Helper to read candela values, specifically targeting the primary vertical distribution.
     * @param {string[]} lines - All lines from the file.
     * @param {number} startIndex - The line index to start reading from.
     * @param {number} vCount - The number of vertical angles.
     * @param {number} hCount - The number of horizontal angles.
     * @returns {number[]} The candela values for the first horizontal angle (main distribution).
     * @private
     */
    static _readCandelaData(lines, startIndex, vCount) {
        // For the 2D plot, we only need the candela values for the first horizontal angle.
        const allValues = lines.slice(startIndex).join(' ').trim().split(/\s+/).map(Number);
        return allValues.slice(0, vCount);
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
        /** @private @type {boolean} */
        this.isUpdatingFractions = false;

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

        // A valid IES definition requires a loaded file
        if (lightDef.type === 'ies' && !this.iesFileData) {
            return null;
        }

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
            const gizmo = this._createSingleGizmo(lightDef, gridInfo);
            this._positionAndRotateGizmo(gizmo, position, lightDef.rotation);
            this.lightsGroup.add(gizmo);
        };

        if (lightDef.placement === 'grid' && lightDef.grid) {
            this._createGridGizmos(lightDef, placeGizmo);
        } else {
            placeGizmo(lightDef.position, null);
        }
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

        // Calculate world position relative to the rotated room
        const centeredPos = new THREE.Vector3(position.x - W / 2, position.y, position.z - L / 2);
        const worldPos = centeredPos.applyAxisAngle(new THREE.Vector3(0, 1, 0), roomRotationY);
        gizmo.position.copy(worldPos);

        // Calculate world rotation including the room's rotation
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
     * @returns {THREE.Group} The complete gizmo group.
     * @private
     */
    _createSingleGizmo(lightDef, gridInfo = null) {
    const gizmo = new THREE.Group();
    const style = getComputedStyle(document.documentElement);
    let color = style.getPropertyValue('--light-source-color').trim();

    // Zone Visualization Logic
    const visualizeZones = this.dom['daylighting-visualize-zones-toggle']?.checked;
    const daylightingEnabled = lightDef.daylighting?.enabled;

        if (visualizeZones && daylightingEnabled && gridInfo && lightDef.daylighting.sensors) {
            const { sensors } = lightDef.daylighting;
            const { r, numRows } = gridInfo;
            // Define fallback colors in case CSS variables are not set
            const zone1Color = style.getPropertyValue('--zone1-color')?.trim() || '#3b82f6'; // Blue
            const zone2Color = style.getPropertyValue('--zone2-color')?.trim() || '#16a34a'; // Green

            if (sensors.length === 1) {
                color = zone1Color;
            } else if (sensors.length === 2) {
            const strategy = lightDef.daylighting.zoningStrategy || 'rows';
            const percent1 = sensors[0].percentControlled;

                if (strategy === 'rows') {
                    const { r, numRows } = gridInfo;
                    const numRowsZone1 = Math.round(numRows * percent1);
                    // Zone is split based on the row index
                    if (r < numRowsZone1) {
                        color = zone1Color;
                    } else {
                        color = zone2Color;
                    }
                } else { // strategy === 'cols'
                    const { c, numCols } = gridInfo;
                    const numColsZone1 = Math.round(numCols * percent1);
                    // Zone is split based on the column index
                    if (c < numColsZone1) {
                        color = zone1Color;
                    } else {
                        color = zone2Color;
                    }
                }
            }
        }

        const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), wireframe: true });

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
 * Determines the appropriate color for a light gizmo, considering daylighting zone visualization.
 * @param {object} lightDef - The light definition.
 * @param {object|null} gridInfo - Information about the gizmo's position in a grid.
 * @returns {string} The CSS color string.
 * @private
 */
_getGizmoColor(lightDef, gridInfo) {
    const style = getComputedStyle(document.documentElement);
    const visualizeZones = this.dom['daylighting-visualize-zones-toggle']?.checked;
    const daylightingEnabled = lightDef.daylighting?.enabled;

    if (visualizeZones && daylightingEnabled && gridInfo && lightDef.daylighting.sensors) {
        const { sensors, zoningStrategy = 'rows' } = lightDef.daylighting;
        const zone1Color = style.getPropertyValue('--zone1-color')?.trim() || '#3b82f6'; // Blue
        const zone2Color = style.getPropertyValue('--zone2-color')?.trim() || '#16a34a'; // Green

        if (sensors.length === 1) {
            return zone1Color;
        }
        if (sensors.length === 2) {
            const percent1 = sensors[0].percentControlled;
            if (zoningStrategy === 'rows') {
                const { r, numRows } = gridInfo;
                const numRowsZone1 = Math.round(numRows * percent1);
                return (r < numRowsZone1) ? zone1Color : zone2Color;
            } else { // strategy === 'cols'
                const { c, numCols } = gridInfo;
                const numColsZone1 = Math.round(numCols * percent1);
                return (c < numColsZone1) ? zone1Color : zone2Color;
            }
        }
    }

    return style.getPropertyValue('--light-source-color').trim() || '#ffff00'; // Default
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
                return geom.rotateX(-Math.PI / 2); // Align with XY plane
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
     * Creates gizmos for a grid layout, constrained to room dimensions.
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

        const gridMinX = desiredCenterX - gridSpanX / 2;
        const gridMaxX = desiredCenterX + gridSpanX / 2;
        const gridMinZ = desiredCenterZ - gridSpanZ / 2;
        const gridMaxZ = desiredCenterZ + gridSpanZ / 2;

        let offsetX = 0;
        if (gridMinX < 0) offsetX = -gridMinX;
        else if (gridMaxX > W) offsetX = W - gridMaxX;

        let offsetZ = 0;
        if (gridMinZ < 0) offsetZ = -gridMinZ;
        else if (gridMaxZ > L) offsetZ = L - gridMaxZ;

        const startX = (desiredCenterX + offsetX) - gridSpanX / 2;
        const startZ = (desiredCenterZ + offsetZ) - gridSpanZ / 2;

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
        const { project } = await import('./project.js'); // Lazy load
        if (file) {
            const content = await file.text();
            project.addSimulationFile('daylighting-schedule', file.name, content);
        } else {
            project.addSimulationFile('daylighting-schedule', null, null);
        }
    }

    /**
     * Ensures only one daylighting sensor gizmo can be active at a time.
     * @param {string} changedId - The ID of the toggle that was changed.
     * @private
     */
    _handleGizmoToggle(changedId) {
        const toggles = ['daylight-sensor1-gizmo-toggle', 'daylight-sensor2-gizmo-toggle'];
        if (this.dom[changedId].checked) {
            toggles.forEach(id => {
                if (id !== changedId) this.dom[id].checked = false;
            });
        }
        this._scheduleUpdate();
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
        const percent1Slider = this.dom['daylight-sensor1-percent'];
        if (percent1Slider) {
            percent1Slider.disabled = (count === 1);
            if (count === 1) percent1Slider.value = 1.0;
            percent1Slider.dispatchEvent(new Event('input', { bubbles: true }));
        }
        this._scheduleUpdate();
    }
    
    /** Enforces that the two sensor control fraction sliders sum to 1.0. @private */
    _handleFractionSliders(event) {
    const s1 = this.dom['daylight-sensor1-percent'];
    const s2 = this.dom['daylight-sensor2-percent'];
    if (!s1 || !s2) return;

    // Prevent recursion if this handler is triggered by the dispatched event below
    if (this._isUpdatingFractions) return;
    this._isUpdatingFractions = true;

    const changed = event.target;
    const other = (changed === s1) ? s2 : s1;

    if (parseFloat(s1.value) + parseFloat(s2.value) > 1.0) {
        const changedVal = parseFloat(changed.value);
        other.value = (1.0 - changedVal).toFixed(2);
        // Dispatch event for any other listeners
        other.dispatchEvent(new Event('input', { bubbles: true }));
    }

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
        if (!file) {
            this.iesFileData = null;
            this._setFileDisplayName('ies-file-input', null);
            this._updateIesViewer(null);
            this._scheduleUpdate();
            return;
        }

        try {
            const content = await file.text();
            this.iesFileData = { name: file.name, content: content };
            this._setFileDisplayName('ies-file-input', file.name);
            this._updateIesViewer(content);
            this._scheduleUpdate();
        } catch (error) {
            console.error("Error reading IES file:", error);
            this.iesFileData = null;
            this._setFileDisplayName('ies-file-input', 'Error reading file');
            this._updateIesViewer(null);
        }
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
                def.ies_file_data = this.iesFileData;
                def.ies_file = this.iesFileData?.name.replace(/\.ies$/i, '');
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
            visualizeZones: this.dom['daylighting-visualize-zones-toggle']?.checked
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
     * @param {number} index - The 1-based index of the sensor.
     * @returns {object} The sensor definition object.
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
        const display = input.parentElement?.querySelector(`[data-file-display-for="${inputId}"]`) || document.createElement('span');
        display.textContent = fileName || '';
    }
    
    /**
     * Updates the IES viewer with new data or hides it.
     * @param {string|undefined} iesContent - The IES file content.
     * @private
     */
    _updateIesViewer(iesContent) {
        const viewer = this.dom['ies-photometry-viewer'];
        if (iesContent) {
            try {
                this._drawIesPolarPlot(IESParser.parse(iesContent));
                viewer?.classList.remove('hidden');
            } catch (error) {
                console.error("Error parsing IES data:", error);
                viewer?.classList.add('hidden');
            }
        } else {
            viewer?.classList.add('hidden');
        }
    }

    /**
     * Draws a 2D polar plot of the photometric data onto the canvas.
     * @param {object} parsedData - The parsed data from the IESParser.
     * @private
     */
    _drawIesPolarPlot(parsedData) {
        const { lumensPerLamp, maxCandela, verticalAngles, candelaValues } = parsedData;

        if (this.dom['ies-info-display']) {
            this.dom['ies-info-display'].innerHTML = `Lumens: ${lumensPerLamp}<br>Max Cd: ${maxCandela.toFixed(0)}`;
        }

        const canvas = this.dom['ies-polar-plot-canvas'];
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
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
        candelaValues.forEach((cd, i) => {
            const angleRad = verticalAngles[i] * Math.PI / 180;
            const r = (cd / maxCandela) * radius;
            const x = centerX + r * Math.sin(angleRad);
            const y = centerY - r * Math.cos(angleRad);
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