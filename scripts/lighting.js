// scripts/lighting.js

import * as THREE from 'three';


/**
 * Manages all aspects of artificial lighting in the scene.
 * This class is initialized in two steps:
 * 1. Constructor: Sets up internal state.
 * 2. init(): Receives external dependencies (scene, dom) once they are ready.
 */
class LightingManager {
    constructor() {
        /** @type {?THREE.Scene} */
        this.scene = null;
        /** @type {?object} */
        this.dom = null;
        /** @type {THREE.Group} */
        this.lightsGroup = new THREE.Group();
        /** @private @type {boolean} */
        this.isInitialized = false;
        /** @private @type {boolean} */
        this.updateScheduled = false;
        /** @private @type {?{name: string, content: string}} */
        this.iesFileData = null;

        this.lightsGroup.name = 'LightingGizmos';
    }

    /**
     * Initializes the manager with its core dependencies.
     * This MUST be called after the scene and DOM are ready.
     * @param {THREE.Scene} scene - The main THREE.js scene object.
     * @param {object} domCache - The cache of DOM elements.
     */
    init(scene, domCache) {
        if (this.isInitialized) return;

        this.scene = scene;
        this.dom = domCache;

        this.scene.add(this.lightsGroup);
        this.isInitialized = true;
    }

    /**
     * Initializes the lighting panel UI and event listeners.
     * Must be called after init().
     */
    setupPanel() {
        if (!this.isInitialized) {
            console.error("LightingManager not initialized. Call init() first.");
            return;
        }
        
        const panel = this.dom['panel-lighting'];
        if (!panel) {
            console.error("Lighting panel element not found in DOM cache.");
            return;
        }

        this._addDomEventListeners(panel);
        
        // Initial UI State Synchronization
        this._toggleLightingControls();
        this._toggleLightParamSections();
        if(this.dom['placement-mode-grid']) {
            this._togglePlacementMode(this.dom['placement-mode-grid'].classList.contains('active'));
        }
            this._toggleGeometryParams();
            this._toggleGlowRadiusInput();
            this._toggleDaylightingControls(); // Initial state for daylighting controls
            this._toggleDaylightControlTypeParams(); // Initial state for daylighting params
            this.updateVisuals();
        }

    /**
     * Schedules a single update for the light visuals on the next animation frame.
     * Prevents redundant updates from multiple rapid input changes.
     * @private
     */
    _scheduleUpdate() {
    if (this.updateScheduled) return;
    this.updateScheduled = true;
    requestAnimationFrame(() => {
        this.updateVisuals(); // Updates light fixture gizmos

        // Dynamically import and call the function to update daylighting sensor visuals
        import('./geometry.js').then(({ updateDaylightingSensorVisuals }) => {
            updateDaylightingSensorVisuals();
        }).catch(err => console.error("Failed to update daylighting visuals:", err));

        this.updateScheduled = false;
    });
}





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
     * Updates the light visuals in the scene.
     * This is the main public method to be called when a redraw is needed.
     */
    updateVisuals() {
        if (!this.isInitialized) return;

        if (this.isInitialized && !this.lightsGroup.parent) {
            this.scene.add(this.lightsGroup);
        }

        this._clearVisuals();
        const isEnabled = this.dom['lighting-enabled-toggle']?.checked;
        if (isEnabled) {
            const lightDef = this.getCurrentState();
            if (lightDef) {
                this._createVisual(lightDef);
            }
        }
    }

    /**
     * Gathers the current lighting configuration from the UI controls.
     * @returns {object|null} A light definition object or null if lighting is disabled or misconfigured.
     */
    getCurrentState() {
        const isEnabled = this.dom['lighting-enabled-toggle']?.checked;
        if (!isEnabled || !this.dom['light-type-selector']) {
            return null;
        }
    
        const lightDef = this._getBaseLightDef();
        this._addGeometryDef(lightDef);
        this._addTypeSpecificDef(lightDef);
        this._addGridDef(lightDef);
        this._addDaylightingDef(lightDef); // Add daylighting params

        if (lightDef.type === 'ies' && (!this.dom['ies-file-input']?.files?.length)) {
            return null;
        }
    
        return lightDef;
    }
/**
     * Applies a saved lighting state from a project file to the UI controls.
     * @param {LightDefinition|null} state - The light definition object to apply, or null if disabled.
     */
    applyState(state) {
        if (!this.isInitialized) return;

        const isEnabled = !!state;
        this._setUIValue('lighting-enabled-toggle', isEnabled, 'checked');

        if (!isEnabled) {
            this._toggleLightingControls();
            return;
        }

        const stateMap = {
            'light-type-selector': state.type,
            'light-pos-x': state.position?.x, 'light-pos-y': state.position?.y, 'light-pos-z': state.position?.z,
            'light-rot-x': state.rotation?.x, 'light-rot-y': state.rotation?.y, 'light-rot-z': state.rotation?.z,
            'grid-rows': state.grid?.rows, 'grid-cols': state.grid?.cols,
            'grid-row-spacing': state.grid?.row_spacing, 'grid-col-spacing': state.grid?.col_spacing,
            'light-geometry-selector': state.geometry?.type,
            'geo-sphere-radius': state.geometry?.radius,
            'geo-cylinder-radius': state.geometry?.radius, 'geo-cylinder-length': state.geometry?.length,
            'geo-ring-radius-in': state.geometry?.innerRadius, 'geo-ring-radius-out': state.geometry?.outerRadius,
            'light-rgb-r': state.rgb?.[0], 'light-rgb-g': state.rgb?.[1], 'light-rgb-b': state.rgb?.[2],
            'spot-rgb-r': state.rgb?.[0], 'spot-rgb-g': state.rgb?.[1], 'spot-rgb-b': state.rgb?.[2],
            'spot-cone-angle': state.cone_angle,
            'spot-dir-x': state.direction?.[0], 'spot-dir-y': state.direction?.[1], 'spot-dir-z': state.direction?.[2],
            'spot-normalize-toggle': { value: state.normalize, type: 'checked' },
            'glow-rgb-r': state.rgb?.[0], 'glow-rgb-g': state.rgb?.[1], 'glow-rgb-b': state.rgb?.[2],
            'glow-max-radius': state.max_radius > 0 ? state.max_radius : 1.0,
            'glow-behavior': state.max_radius <= 0 ? state.max_radius : 'positive',
            'illum-rgb-r': state.rgb?.[0], 'illum-rgb-g': state.rgb?.[1], 'illum-rgb-b': state.rgb?.[2],
            'illum-alt-material': state.alternate_material,
            'ies-units': state.ies_units, 'ies-multiplier': state.ies_multiplier, 'ies-lamp-type': state.ies_lamp_type,
            'ies-force-color-toggle': { value: state.ies_force_color, type: 'checked' },
            'ies-color-r': state.ies_color?.[0], 'ies-color-g': state.ies_color?.[1], 'ies-color-b': state.ies_color?.[2],

            // EN 12464-1 Additions
            'maintenance-factor': state.maintenance_factor,
            'light-source-ra': state.ra,
            'light-source-tcp': state.tcp,

            'daylighting-enabled-toggle': { value: state.daylighting?.enabled, type: 'checked' },
            'daylighting-control-type': state.daylighting?.controlType,
            'daylighting-setpoint': state.daylighting?.setpoint,
            'daylighting-min-power-frac': state.daylighting?.minPowerFraction,
            'daylighting-steps': state.daylighting?.nSteps,
        };

        for (const [id, config] of Object.entries(stateMap)) {
            const value = config?.value ?? config;
            const type = config?.type ?? 'value';
            this._setUIValue(id, value, type);
        }

        // Handle dynamic elements like sensors and file inputs
        this.iesFileData = state.ies_file_data || null;
        this._setFileDisplayName('ies-file-input', this.iesFileData?.name);
        const viewer = this.dom['ies-photometry-viewer'];
        if (state.type === 'ies' && this.iesFileData?.content) {
            try {
                this._parseAndDrawIesPhotometry(this.iesFileData.content);
                viewer?.classList.remove('hidden');
            } catch (error) {
                console.error("Error parsing IES data from loaded project:", error);
                viewer?.classList.add('hidden');
            }
        } else if (viewer) {
            viewer.classList.add('hidden');
        }

        // Handle dynamic elements like sensors and file inputs
        if (state.daylighting?.sensors) {
            const sensorCount = state.daylighting.sensors.length;
            this._setUIValue('daylight-sensor-count', sensorCount);

            state.daylighting.sensors.forEach((sensor, index) => {
                const i = index + 1;
                this._setUIValue(`daylight-sensor${i}-x`, sensor.x);
                this._setUIValue(`daylight-sensor${i}-y`, sensor.y);
                this._setUIValue(`daylight-sensor${i}-z`, sensor.z);
                this._setUIValue(`daylight-sensor${i}-dir-x`, sensor.direction?.x);
                this._setUIValue(`daylight-sensor${i}-dir-y`, sensor.direction?.y);
                this._setUIValue(`daylight-sensor${i}-dir-z`, sensor.direction?.z);
                this._setUIValue(`daylight-sensor${i}-percent`, sensor.percentControlled);
            });
        }

        this._setFileDisplayName('daylighting-availability-schedule', state.daylighting?.scheduleFile?.name);

        // Update UI visibility
        this._togglePlacementMode(state.placement === 'grid');
        this._toggleLightingControls();
        this._toggleLightParamSections();
        this._toggleGlowRadiusInput();
        this._toggleDaylightingControls();
    }
    
   /**
     * Gathers the daylighting controls configuration from the UI.
     * @param {LightDefinition} def - The light definition object to be populated.
     * @private
     */
    _addDaylightingDef(def) {
        const isEnabled = this.dom['daylighting-enabled-toggle']?.checked;
        def.daylighting = { enabled: isEnabled };
        if (!isEnabled) return;

        const sensorCount = parseInt(this.dom['daylight-sensor-count']?.value, 10) || 1;

        Object.assign(def.daylighting, {
            controlType: this.dom['daylighting-control-type'].value,
            setpoint: parseFloat(this.dom['daylighting-setpoint'].value),
            minPowerFraction: parseFloat(this.dom['daylighting-min-power-frac'].value),
            minLightFraction: parseFloat(this.dom['daylighting-min-light-frac'].value),
            nSteps: parseInt(this.dom['daylighting-steps'].value, 10),
            sensors: [],
        });

        // Loop based on the selected sensor count
        for (let i = 1; i <= sensorCount; i++) {
            def.daylighting.sensors.push({
                x: parseFloat(this.dom[`daylight-sensor${i}-x`].value),
                y: parseFloat(this.dom[`daylight-sensor${i}-y`].value),
                z: parseFloat(this.dom[`daylight-sensor${i}-z`].value),
                direction: {
                    x: parseFloat(this.dom[`daylight-sensor${i}-dir-x`].value),
                    y: parseFloat(this.dom[`daylight-sensor${i}-dir-y`].value),
                    z: parseFloat(this.dom[`daylight-sensor${i}-dir-z`].value)
                },
                percentControlled: parseFloat(this.dom[`daylight-sensor${i}-percent`].value),
            });
        }
    }

    /**
     * Creates and places the 3D gizmos in the scene based on a light definition object.
     * @param {object} lightDef - The light definition object from getCurrentState.
     * @private
     */
    _createVisual(lightDef) {
            const W = parseFloat(this.dom['width'].value);
            const L = parseFloat(this.dom['length'].value); 
            const roomRotationY = THREE.MathUtils.degToRad(parseFloat(this.dom['room-orientation'].value));

            const placeGizmo = (position) => {
            const gizmo = this._createSingleGizmo(lightDef);
            
            // Calculate world position relative to the rotated room
            const localPos = new THREE.Vector3(position.x, position.y, position.z);
            const centeredPos = new THREE.Vector3(localPos.x - W / 2, localPos.y, localPos.z - L / 2);
            const worldPos = centeredPos.applyAxisAngle(new THREE.Vector3(0, 1, 0), roomRotationY);
            gizmo.position.copy(worldPos);

            // Calculate world rotation including the room's rotation
            const euler = new THREE.Euler(
                THREE.MathUtils.degToRad(lightDef.rotation.x),
                THREE.MathUtils.degToRad(lightDef.rotation.y),
                THREE.MathUtils.degToRad(lightDef.rotation.z),
                'YXZ' // Intrinsic rotation order
            );
            const roomQuaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), roomRotationY);
            gizmo.quaternion.setFromEuler(euler).premultiply(roomQuaternion);
            
            this.lightsGroup.add(gizmo);
        };

        if (lightDef.placement === 'grid' && lightDef.grid) {
            this._createGridGizmos(lightDef, placeGizmo);
        } else {
            placeGizmo(lightDef.position);
        }
    }

    /**
     * Creates a single visual gizmo for a light source.
     * @param {object} lightDef - The light definition.
     * @returns {THREE.Group} The complete gizmo group.
     * @private
     */
    _createSingleGizmo(lightDef) {
        const gizmo = new THREE.Group();
        const color = getComputedStyle(document.documentElement).getPropertyValue('--light-source-color').trim();
        const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), wireframe: true });
        let geometry;

        switch (lightDef.geometry.type) {
            case 'sphere':
                geometry = new THREE.SphereGeometry(lightDef.geometry.radius, 32, 16);
                break;
            case 'cylinder':
                geometry = new THREE.CylinderGeometry(lightDef.geometry.radius, lightDef.geometry.radius, lightDef.geometry.length, 32);
                geometry.rotateX(Math.PI / 2); // Align with local Z-axis for the arrow helper
                break;
            case 'ring':
                geometry = new THREE.RingGeometry(lightDef.geometry.innerRadius, lightDef.geometry.outerRadius, 32);
                geometry.rotateX(-Math.PI / 2); // Align with XY plane
                break;
            case 'polygon':
            case 'ies':
            default:
                geometry = new THREE.PlaneGeometry(0.25, 0.25);
                break;
        }
        gizmo.add(new THREE.Mesh(geometry, material));

        if (lightDef.type === 'spotlight') {
            const coneHeight = 0.8;
            const coneRadius = coneHeight * Math.tan(THREE.MathUtils.degToRad(lightDef.cone_angle / 2));
            const coneGeom = new THREE.ConeGeometry(coneRadius, coneHeight, 32, 1, true);
            coneGeom.translate(0, -coneHeight / 2, 0); // Position base at origin
            coneGeom.rotateX(Math.PI / 2); // Point along local -Z
            const coneMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), wireframe: true, transparent: true, opacity: 0.3 });
            gizmo.add(new THREE.Mesh(coneGeom, coneMaterial));
        }

        // Add a direction arrow helper (points along local -Z axis)
        gizmo.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, 0), 0.4, color));

        return gizmo;
    }
    
    // --- Helper methods for UI and data gathering ---

    /**
     * Adds all necessary event listeners to the lighting panel controls.
     * @param {HTMLElement} panel - The lighting panel container element.
     * @private
     */
async _addDomEventListeners(panel) {
        this.dom['lighting-enabled-toggle']?.addEventListener('change', () => this._toggleLightingControls());
        this.dom['light-type-selector']?.addEventListener('change', () => this._toggleLightParamSections());
        this.dom['placement-mode-individual']?.addEventListener('click', () => this._togglePlacementMode(false));
        this.dom['placement-mode-grid']?.addEventListener('click', () => this._togglePlacementMode(true));
        this.dom['light-geometry-selector']?.addEventListener('change', () => {
            this._toggleGeometryParams();
            this._scheduleUpdate();
        });
        this.dom['glow-behavior']?.addEventListener('change', () => {
            this._toggleGlowRadiusInput();
            this._scheduleUpdate();
        });
        this.dom['ies-file-input']?.addEventListener('change', (e) => this._handleIesFileChange(e));

        // --- Daylighting Controls Listeners ---
        this.dom['daylighting-enabled-toggle']?.addEventListener('change', () => this._toggleDaylightingControls());
        this.dom['daylighting-control-type']?.addEventListener('change', () => this._toggleDaylightControlTypeParams());
        this.dom['daylighting-availability-schedule']?.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            const { project } = await import('./project.js'); // Lazy load to avoid circular dependency
            if (file) {
                const reader = new FileReader();
                reader.onload = (readEvent) => {
                    project.addSimulationFile('daylighting-schedule', file.name, readEvent.target.result);
                };
                reader.readAsText(file);
            } else {
                project.addSimulationFile('daylighting-schedule', null, null);
            }
        });
    }

      /**
   * Handles the selection of a new IES file from the input.
   * @param {Event} event - The file input change event.
   * @private
   */
  async _handleIesFileChange(event) {
      const file = event.target.files?.[0];
      const viewer = this.dom['ies-photometry-viewer'];

      if (!file) {
          this.iesFileData = null;
          this._setFileDisplayName('ies-file-input', null);
          viewer?.classList.add('hidden');
          this._scheduleUpdate();
          return;
      }

      this._setFileDisplayName('ies-file-input', file.name);

      try {
          const fileContent = await file.text();
          this.iesFileData = {
              name: file.name,
              content: fileContent
          };
          this._parseAndDrawIesPhotometry(fileContent);
          viewer?.classList.remove('hidden');
      } catch (error) {
          console.error("Error processing IES file:", error);
          viewer?.classList.add('hidden');
          this.iesFileData = null;
          this._setFileDisplayName('ies-file-input', `Error: ${file.name}`);
      } finally {
          this._scheduleUpdate();
      }
  }

  /**
   * Parses IES file content and draws a 2D polar plot of the photometric data.
   * @param {string} iesContent - The raw text content of the .ies file.
   * @private
   */
  _parseAndDrawIesPhotometry(iesContent) {
      const lines = iesContent.replace(/\r\n/g, '\n').split('\n').map(l => l.trim());
      let lineIndex = 0;
      while (lineIndex < lines.length && !lines[lineIndex].startsWith('TILT')) {
          lineIndex++;
      }
      if (lineIndex >= lines.length) throw new Error("IES file format error: TILT line not found.");
      lineIndex++; 

      const dataLine = lines[lineIndex++].split(/\s+/).map(Number);
      if (dataLine.length < 10) throw new Error("IES file format error: Invalid data definition line.");

      const [numLamps, lumensPerLamp, multiplier, numVAngles, numHAngles] = dataLine;

      const vAngles = lines.slice(lineIndex, lineIndex + numVAngles).join(' ').trim().split(/\s+/).map(Number);
      lineIndex += numVAngles;
      const hAngles = lines.slice(lineIndex, lineIndex + numHAngles).join(' ').trim().split(/\s+/).map(Number);
      lineIndex += numHAngles;
      const candelaValues = lines.slice(lineIndex).join(' ').trim().split(/\s+/).map(Number);

      const mainDistribution = [];
      for (let i = 0; i < numVAngles; i++) {
          mainDistribution.push(candelaValues[i]);
      }

      const maxCandela = Math.max(...mainDistribution);
      if (maxCandela <= 0) throw new Error("No valid candela values found for plotting.");

      const infoEl = this.dom['ies-info-display'];
      if (infoEl) {
          infoEl.innerHTML = `Lumens: ${lumensPerLamp}<br>Max Cd: ${maxCandela.toFixed(0)}`;
      }

      const canvas = this.dom['ies-polar-plot-canvas'];
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);

      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const centerX = width / 2;
      const centerY = height / 2;
      const radius = Math.min(centerX, centerY) * 0.9;

      ctx.clearRect(0, 0, width, height);

      const style = getComputedStyle(document.documentElement);
      const gridColor = style.getPropertyValue('--grid-color').trim();
      const textColor = style.getPropertyValue('--text-secondary').trim();
      const lineColor = style.getPropertyValue('--primary-color').trim();

      ctx.strokeStyle = gridColor;
      ctx.fillStyle = textColor;
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';

      for (let i = 1; i <= 4; i++) {
          const r = (i / 4) * radius;
          ctx.beginPath();
          ctx.arc(centerX, centerY, r, 0, 2 * Math.PI);
          ctx.stroke();
          if (i < 4) {
               ctx.fillText((maxCandela * i / 4).toFixed(0), centerX, centerY - r - 4);
          }
      }
      for (let i = 0; i < 12; i++) {
          const angle = i * 30 * Math.PI / 180;
          ctx.beginPath();
          ctx.moveTo(centerX, centerY);
          ctx.lineTo(centerX + radius * Math.cos(angle), centerY + radius * Math.sin(angle));
          ctx.stroke();
      }

      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      mainDistribution.forEach((cd, i) => {
          const angleRad = vAngles[i] * Math.PI / 180;
          const r = (cd / maxCandela) * radius;
          const x = centerX + r * Math.sin(angleRad);
          const y = centerY - r * Math.cos(angleRad);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
      });

      if (vAngles[vAngles.length - 1] <= 90) {
          for (let i = mainDistribution.length - 1; i >= 0; i--) {
              const cd = mainDistribution[i];
              const angleRad = (180 - vAngles[i]) * Math.PI / 180;
               const r = (cd / maxCandela) * radius;
               const x = centerX + r * Math.sin(angleRad);
               const y = centerY - r * Math.cos(angleRad);
               ctx.lineTo(x, y);
          }
      }
      ctx.closePath();
      ctx.stroke();
  }
  
    /** Toggles the main lighting controls wrapper visibility. */
    _toggleLightingControls() {
        if (!this.dom['lighting-enabled-toggle'] || !this.dom['lighting-controls-wrapper']) return;
        const isEnabled = this.dom['lighting-enabled-toggle'].checked;
        this.dom['lighting-controls-wrapper'].classList.toggle('hidden', !isEnabled);
        this._scheduleUpdate();
    }
    
    /** Toggles visibility of parameter sections based on the selected light type. */
    _toggleLightParamSections() {
        if (!this.dom['light-type-selector'] || !this.dom['panel-lighting']) return;
        const selectedType = this.dom['light-type-selector'].value;
        this.dom['panel-lighting'].querySelectorAll('.light-param-section').forEach(section => {
            section.classList.toggle('hidden', section.id !== `params-${selectedType}`);
        });
        this._toggleGeometryParams();
        this._scheduleUpdate();
    }
    
    /** Toggles visibility of geometry type parameters. */
    _toggleGeometryParams() {
        if (!this.dom['light-type-selector'] || !this.dom['light-geometry-section'] || !this.dom['geometry-params-section']) return;
        const selectedType = this.dom['light-type-selector'].value;
        const showGeometry = selectedType !== 'ies';
        this.dom['light-geometry-section'].classList.toggle('hidden', !showGeometry);
        this.dom['geometry-params-section'].classList.toggle('hidden', !showGeometry);
        if (showGeometry) {
            const selectedGeo = this.dom['light-geometry-selector'].value;
            this.dom['geometry-params-section'].querySelectorAll(':scope > div').forEach(section => {
                section.classList.toggle('hidden', section.id !== `geo-params-${selectedGeo}`);
            });
        }
    }

    /** Toggles visibility of the glow radius input. */
    _toggleGlowRadiusInput() {
        if (!this.dom['glow-radius-input-container'] || !this.dom['glow-behavior']) return;
        this.dom['glow-radius-input-container'].classList.toggle('hidden', this.dom['glow-behavior'].value !== 'positive');
    }

    /** Toggles between individual and grid placement modes. */
    _togglePlacementMode(isGrid) {
        if (!this.dom['placement-mode-individual'] || !this.dom['placement-mode-grid'] || !this.dom['grid-layout-inputs']) return;
        this.dom['placement-mode-individual'].classList.toggle('active', !isGrid);
        this.dom['placement-mode-grid'].classList.toggle('active', isGrid);
        this.dom['grid-layout-inputs'].classList.toggle('hidden', !isGrid);
        this._scheduleUpdate();
    }

    /**
     * Creates gizmos for a grid layout.
     * @param {object} lightDef - The light definition object.
     * @param {Function} placeGizmo - The function to call for placing each gizmo.
     * @private
     */
    _createGridGizmos(lightDef, placeGizmo) {
        let { rows, cols, row_spacing, col_spacing } = lightDef.grid;
        rows = Math.max(1, rows || 1);
        cols = Math.max(1, cols || 1);
        const gridWidth = (cols - 1) * col_spacing;
        const gridDepth = (rows - 1) * row_spacing;
        const startOffset = new THREE.Vector3(
            lightDef.position.x - gridWidth / 2,
            lightDef.position.y,
            lightDef.position.z - gridDepth / 2
        );

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const gridPos = new THREE.Vector3(c * col_spacing, 0, r * row_spacing).add(startOffset);
                placeGizmo(gridPos);
            }
        }
    }
    
    /**
     * Safely sets the value of a DOM element and dispatches events to trigger updates.
     * @param {string} id - The key for the DOM element in the `this.dom` cache.
     * @param {*} value - The value to set.
     * @param {'value'|'checked'} [property='value'] - The property to set on the element.
     * @private
     */
    _setUIValue(id, value, property = 'value') {
        if (this.dom[id] && value !== null && value !== undefined) {
            this.dom[id][property] = value;
            this.dom[id].dispatchEvent(new Event('input', { bubbles: true }));
            this.dom[id].dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    /**
     * Sets the text content for a file input's display element.
     * @param {string} inputId - The ID of the file input element.
     * @param {string} [fileName] - The name of the file to display.
     * @private
     */
    _setFileDisplayName(inputId, fileName) {
        const input = this.dom[inputId];
        if (!input) return;

        let display = input.parentElement.querySelector(`[data-file-display-for="${inputId}"]`);
        if (!display) {
            display = document.createElement('span');
            display.className = 'text-xs text-gray-400 ml-2';
            display.dataset.fileDisplayFor = inputId;
            input.after(display);
        }
        display.textContent = fileName || '';
    }

    /** @private @returns {LightDefinition} */
    _getBaseLightDef() {
        return {
            type: this.dom['light-type-selector'].value,
            placement: this.dom['placement-mode-grid'].classList.contains('active') ? 'grid' : 'individual',
            position: { x: parseFloat(this.dom['light-pos-x'].value), y: parseFloat(this.dom['light-pos-y'].value), z: parseFloat(this.dom['light-pos-z'].value) },
            rotation: { x: parseFloat(this.dom['light-rot-x'].value), y: parseFloat(this.dom['light-rot-y'].value), z: parseFloat(this.dom['light-rot-z'].value) },
            identifier: 'live_preview_light',
            
            // EN 12464-1 Additions
            maintenance_factor: parseFloat(this.dom['maintenance-factor']?.value),
            ra: this.dom['light-source-ra']?.value,
            tcp: this.dom['light-source-tcp']?.value,
        };
    }
    
    /** @private @param {LightDefinition} def */
    _addGeometryDef(def) {
        def.geometry = {};
        if (def.type === 'ies' || !this.dom['light-geometry-selector']) {
            def.geometry.type = 'ies';
            return;
        }
        def.geometry.type = this.dom['light-geometry-selector'].value;
        switch (def.geometry.type) {
            case 'sphere':   def.geometry.radius = parseFloat(this.dom['geo-sphere-radius'].value); break;
            case 'cylinder': def.geometry.radius = parseFloat(this.dom['geo-cylinder-radius'].value); def.geometry.length = parseFloat(this.dom['geo-cylinder-length'].value); break;
            case 'ring':     def.geometry.innerRadius = parseFloat(this.dom['geo-ring-radius-in'].value); def.geometry.outerRadius = parseFloat(this.dom['geo-ring-radius-out'].value); break;
        }
    }
    
    /** @private @param {LightDefinition} def */
    _addTypeSpecificDef(def) {
        switch (def.type) {
            case 'light':     def.rgb = [parseFloat(this.dom['light-rgb-r'].value), parseFloat(this.dom['light-rgb-g'].value), parseFloat(this.dom['light-rgb-b'].value)]; break;
            case 'spotlight':
                def.rgb = [parseFloat(this.dom['spot-rgb-r'].value), parseFloat(this.dom['spot-rgb-g'].value), parseFloat(this.dom['spot-rgb-b'].value)];
                def.cone_angle = parseFloat(this.dom['spot-cone-angle'].value);
                def.direction = [parseFloat(this.dom['spot-dir-x'].value), parseFloat(this.dom['spot-dir-y'].value), parseFloat(this.dom['spot-dir-z'].value)];
                def.normalize = this.dom['spot-normalize-toggle'].checked;
                break;
            case 'glow':
                def.rgb = [parseFloat(this.dom['glow-rgb-r'].value), parseFloat(this.dom['glow-rgb-g'].value), parseFloat(this.dom['glow-rgb-b'].value)];
                const glowBehavior = this.dom['glow-behavior'].value;
                def.max_radius = (glowBehavior === 'positive') ? parseFloat(this.dom['glow-max-radius'].value) : parseFloat(glowBehavior);
                break;
            case 'illum':
                def.rgb = [parseFloat(this.dom['illum-rgb-r'].value), parseFloat(this.dom['illum-rgb-g'].value), parseFloat(this.dom['illum-rgb-b'].value)];
                def.alternate_material = this.dom['illum-alt-material'].value.trim();
                break;
            case 'ies':
                const file = this.dom['ies-file-input']?.files?.[0];
                def.ies_file_data = this.iesFileData;
                def.ies_file = this.iesFileData ? this.iesFileData.name.replace(/\.ies$/i, '') : null;
                def.ies_units = this.dom['ies-units'].value;
                def.ies_multiplier = parseFloat(this.dom['ies-multiplier'].value);
                def.ies_lamp_type = this.dom['ies-lamp-type'].value.trim();
                def.ies_force_color = this.dom['ies-force-color-toggle'].checked;
                def.ies_color = [parseFloat(this.dom['ies-color-r'].value), parseFloat(this.dom['ies-color-g'].value), parseFloat(this.dom['ies-color-b'].value)];
                break;
        }
    }
    
    /** @private @param {LightDefinition} def */
    _addGridDef(def) {
        if (def.placement === 'grid') {
            def.grid = {
                rows: parseInt(this.dom['grid-rows'].value, 10),
                cols: parseInt(this.dom['grid-cols'].value, 10),
                row_spacing: parseFloat(this.dom['grid-row-spacing'].value),
                col_spacing: parseFloat(this.dom['grid-col-spacing'].value)
            };
        }
    }

    /** Toggles visibility of the main daylighting controls wrapper. */
    _toggleDaylightingControls() {
        if (!this.dom['daylighting-enabled-toggle'] || !this.dom['daylighting-controls-wrapper']) return;
        const isEnabled = this.dom['daylighting-enabled-toggle'].checked;
        this.dom['daylighting-controls-wrapper'].classList.toggle('hidden', !isEnabled);
        this._scheduleUpdate();
    }

    /** Toggles visibility of parameters specific to a daylighting control type. */
    _toggleDaylightControlTypeParams() {
        if (!this.dom['daylighting-control-type']) return;
        const selectedType = this.dom['daylighting-control-type'].value;
        this.dom['daylight-continuous-params']?.classList.toggle('hidden', selectedType === 'Stepped');
        this.dom['daylight-stepped-params']?.classList.toggle('hidden', selectedType !== 'Stepped');
        this._scheduleUpdate();
    };

}

// Create the singleton instance to be imported by other modules.
export const lightingManager = new LightingManager();