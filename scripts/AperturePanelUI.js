export class AperturePanelUI {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.orientations = [
            { id: 'n', label: 'North' },
            { id: 's', label: 'South' },
            { id: 'e', label: 'East' },
            { id: 'w', label: 'West' }
        ];

        this.shadingTypes = [
            { value: 'none', label: 'None' },
            { value: 'overhang', label: 'Overhang' },
            { value: 'lightshelf', label: 'Light Shelf' },
            { value: 'louver', label: 'Louver' },
            { value: 'roller', label: 'Roller' },
            { value: 'imported_obj', label: 'Imported OBJ' }
        ];
    }

    render() {
        if (!this.container) return;
        this.container.innerHTML = '';

        const header = this.createHeader("Apertures & Shading");
        this.container.appendChild(header);

        const content = document.createElement('div');
        content.className = 'window-content space-y-5';

        // --- Standard Content Container ---
        const standardContent = document.createElement('div');
        standardContent.id = 'aperture-standard-content';
        standardContent.className = 'space-y-5';

        // 1. Wall Selection
        standardContent.appendChild(this.createWallSelectionSection());

        // 2. Sun Ray Tracing (Global)
        standardContent.appendChild(this.createSunRayTraceSection());

        // 3. Orientation Controls (N, S, E, W)
        this.orientations.forEach(orient => {
            standardContent.appendChild(this.createOrientationSection(orient));
        });

        // 4. Frame Controls (Global)
        standardContent.appendChild(this.createFrameControls());

        content.appendChild(standardContent);

        // --- Custom Content Container ---
        const customContent = document.createElement('div');
        customContent.id = 'aperture-custom-content';
        customContent.className = 'hidden space-y-5';
        content.appendChild(customContent);

        this.container.appendChild(content);
        this.appendResizeHandles();
    }

    createHeader(title) {
        const div = document.createElement('div');
        div.className = 'window-header';
        div.innerHTML = `
            <span>${title}</span>
            <div class="window-controls">
                <div class="window-icon-max"></div>
                <div class="collapse-icon"></div>
                <div class="window-icon-close"></div>
            </div>`;
        return div;
    }

    createWallSelectionSection() {
        const div = document.createElement('div');
        div.className = 'space-y-2 pb-3';
        div.innerHTML = `
            <h3 class="font-semibold text-sm uppercase">Wall Selection</h3>
            <p class="info-box !text-xs !py-2 !px-3">Click a wall in the 3D view to select it.</p>
            <div class="flex justify-between items-center pt-2">
                <span class="label">Selected Wall:</span>
                <div id="wall-selection-status" class="flex items-center gap-3">
                    <span id="selected-wall-display" class="data-value font-mono">None</span>
                    <button id="wall-select-lock-btn" class="hidden" aria-label="Lock wall selection">
                        <svg id="lock-icon-unlocked" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>
                        <svg id="lock-icon-locked" class="hidden" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                    </button>
                </div>
            </div>`;
        return div;
    }

    createSunRayTraceSection() {
        const div = document.createElement('div');
        div.id = 'sun-ray-trace-section';
        div.className = 'hidden space-y-3 pt-4 mt-4 border-t-2 border-[--grid-color]';

        div.innerHTML = `
            <h3 class="font-semibold text-sm uppercase">Sun Ray Tracing</h3>
            <p class="info-box !text-xs !py-2 !px-3">Visualize direct sun penetration and bounces. Requires an EPW file.</p>
            <div class="grid grid-cols-2 gap-4">
                <div><label for="sun-ray-date" class="label text-xs">Date</label><input type="text" id="sun-ray-date" class="w-full mt-1 flatpickr-input" placeholder="Select date..."></div>
                <div><label for="sun-ray-time" class="label text-xs">Time</label><input type="time" id="sun-ray-time" value="12:00" class="w-full mt-1"></div>
            </div>`;

        div.appendChild(this.createRangeControl('sun-ray-count', 'Ray Count', 10, 1000, 100, 10));
        div.appendChild(this.createRangeControl('sun-ray-bounces', 'Max Bounces', 0, 10, 1, 1));

        // Checkbox
        const toggleDiv = document.createElement('div');
        toggleDiv.className = 'pt-2';
        toggleDiv.innerHTML = `
            <label for="sun-rays-visibility-toggle" class="flex items-center cursor-pointer">
                <input type="checkbox" id="sun-rays-visibility-toggle" checked>
                <span class="ml-3 label !text-gray-600 !uppercase-none !font-normal !mb-0">Show Traced Rays</span>
            </label>`;
        div.appendChild(toggleDiv);

        // Info Display
        const infoDiv = document.createElement('div');
        infoDiv.id = 'sun-ray-info-display';
        infoDiv.className = 'hidden mt-4 pt-4 border-t border-dashed border-[--grid-color] space-y-2';
        infoDiv.innerHTML = `
            <h4 class="font-semibold text-xs uppercase text-[--text-secondary]">Solar Data at Selected Time</h4>
            <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <span class="text-[--text-secondary]">Sun Altitude:</span><span id="sun-altitude-val" class="data-value font-mono text-right">--</span>
                <span class="text-[--text-secondary]">Sun Azimuth:</span><span id="sun-azimuth-val" class="data-value font-mono text-right">--</span>
                <span class="text-[--text-secondary]">Direct Normal Irradiance:</span><span id="sun-dni-val" class="data-value font-mono text-right">--</span>
                <span class="text-[--text-secondary]">Diffuse Horizontal Irradiance:</span><span id="sun-dhi-val" class="data-value font-mono text-right">--</span>
            </div>`;
        div.appendChild(infoDiv);

        const btn = document.createElement('button');
        btn.id = 'trace-sun-rays-btn';
        btn.className = 'btn btn-primary w-full mt-2';
        btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" class="mr-2 inline-block"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg><span>Trace Sun Rays</span>`;
        div.appendChild(btn);

        return div;
    }

    createOrientationSection(orient) {
        const suffix = orient.id;
        const container = document.createElement('div');
        container.id = `aperture-controls-${suffix}`;
        container.className = 'aperture-controls hidden space-y-5 pt-4 border-t border-[--grid-color]';

        container.innerHTML = `<h3 class="font-semibold text-sm uppercase">${orient.label} Wall Apertures</h3>`;

        container.appendChild(this.createRangeControl(`win-count-${suffix}`, '# of Windows', 0, 10, 0, 1));

        const modeDiv = document.createElement('div');
        modeDiv.innerHTML = `
            <label class="label">Mode</label>
            <div class="btn-group mt-1">
                <button id="mode-wwr-btn-${suffix}" class="btn active">WWR</button>
                <button id="mode-manual-btn-${suffix}" class="btn">Manual</button>
            </div>`;
        container.appendChild(modeDiv);

        const wwrContainer = document.createElement('div');
        wwrContainer.id = `wwr-controls-${suffix}`;
        wwrContainer.className = 'space-y-5';
        wwrContainer.appendChild(this.createRangeControl(`wwr-${suffix}`, 'WWR (%)', 0, 0.99, 0.4, 0.01, '%', true));
        wwrContainer.appendChild(this.createRangeControl(`wwr-sill-height-${suffix}`, 'Sill Height (m)', 0, 10, 1.0, 0.05, 'm'));
        wwrContainer.appendChild(this.createRangeControl(`win-depth-pos-${suffix}`, 'Window Depth Position (m)', 0, 0.2, 0.1, 0.01, 'm'));
        container.appendChild(wwrContainer);

        const manualContainer = document.createElement('div');
        manualContainer.id = `manual-controls-${suffix}`;
        manualContainer.className = 'hidden space-y-5';
        manualContainer.appendChild(this.createRangeControl(`win-width-${suffix}`, 'Win. Width (m)', 0.1, 20, 1.5, 0.1, 'm'));
        manualContainer.appendChild(this.createRangeControl(`win-height-${suffix}`, 'Win. Height (m)', 0.1, 10, 1.2, 0.1, 'm'));
        manualContainer.appendChild(this.createRangeControl(`sill-height-${suffix}`, 'Sill Height (m)', 0, 10, 1.0, 0.05, 'm'));
        manualContainer.appendChild(this.createRangeControl(`win-depth-pos-${suffix}-manual`, 'Window Depth Position (m)', 0, 0.2, 0.1, 0.01, 'm'));
        container.appendChild(manualContainer);

        container.appendChild(this.createShadingSection(suffix, orient.label));

        return container;
    }

    createShadingSection(suffix, labelText) {
        const container = document.createElement('div');
        container.className = 'shading-section-container space-y-4 pt-4 mt-4 border-t border-dashed border-[--grid-color]';

        container.innerHTML = `
            <h4 class="font-semibold text-sm uppercase text-gray-700">${labelText} Wall Shading</h4>
            <label class="flex items-center cursor-pointer" for="shading-${suffix}-toggle">
                <input type="checkbox" id="shading-${suffix}-toggle">
                <span class="ml-3 text-sm font-normal text-[--text-primary]">Enable Shading on this Wall</span>
            </label>`;

        const controlsDiv = document.createElement('div');
        controlsDiv.id = `shading-controls-${suffix}`;
        controlsDiv.className = 'hidden space-y-5';

        const typeGroup = document.createElement('div');
        const select = document.createElement('select');
        select.id = `shading-type-${suffix}`;
        select.className = 'w-full mt-1';
        this.shadingTypes.forEach(opt => {
            const option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.label;
            select.appendChild(option);
        });
        typeGroup.innerHTML = `<label class="label" for="shading-type-${suffix}">Device Type</label>`;
        typeGroup.appendChild(select);
        controlsDiv.appendChild(typeGroup);

        controlsDiv.appendChild(this.createOverhangControls(suffix));
        controlsDiv.appendChild(this.createLightshelfControls(suffix));
        controlsDiv.appendChild(this.createLouverControls(suffix));
        controlsDiv.appendChild(this.createRollerControls(suffix));
        controlsDiv.appendChild(this.createImportedObjControls(suffix));

        // Sun Ray Tracing Toggle (Per Wall Context)
        const sunRayDiv = document.createElement('div');
        sunRayDiv.className = "pt-4 mt-4 border-t border-dashed border-[--grid-color]";
        sunRayDiv.innerHTML = `
             <label class="flex items-center cursor-pointer" for="sun-ray-tracing-toggle-${suffix}">
                <input type="checkbox" id="sun-ray-tracing-toggle-${suffix}">
                <span class="ml-3 text-sm font-normal text-[--text-primary]">Enable Sun Ray Tracing</span>
            </label>`;
        controlsDiv.appendChild(sunRayDiv);

        container.appendChild(controlsDiv);
        return container;
    }

    createOverhangControls(suffix) {
        const div = document.createElement('div');
        div.id = `shading-controls-overhang-${suffix}`;
        div.className = 'hidden space-y-4 pt-4 border-t border-[--grid-color]';

        div.appendChild(this.createRangeControl(`overhang-dist-above-${suffix}`, 'Distance Above Top (m)', 0, 1.0, 0, 0.05, 'm'));
        div.appendChild(this.createRangeControl(`overhang-tilt-${suffix}`, 'Tilt Angle', 0, 180, 90, 1, '°'));
        div.appendChild(this.createRangeControl(`overhang-depth-${suffix}`, 'Depth (m)', 0, 2.0, 0.5, 0.1, 'm'));
        div.appendChild(this.createRangeControl(`overhang-thick-${suffix}`, 'Thickness (m)', 0.005, 0.5, 0.05, 0.005, 'm'));
        div.appendChild(this.createRangeControl(`overhang-left-extension-${suffix}`, 'Left Extension (m)', 0, 1.0, 0, 0.05, 'm'));
        div.appendChild(this.createRangeControl(`overhang-right-extension-${suffix}`, 'Right Extension (m)', 0, 1.0, 0, 0.05, 'm'));
        return div;
    }

    createLightshelfControls(suffix) {
        const div = document.createElement('div');
        div.id = `shading-controls-lightshelf-${suffix}`;
        div.className = 'hidden space-y-4 pt-4 border-t border-[--grid-color]';

        div.innerHTML = `
            <div><label class="label">Placement</label>
            <div class="btn-group mt-1">
                <button id="lightshelf-placement-ext-${suffix}" class="btn active">Exterior</button>
                <button id="lightshelf-placement-int-${suffix}" class="btn">Interior</button>
                <button id="lightshelf-placement-both-${suffix}" class="btn">Both</button>
            </div></div>`;

        // Exterior Controls
        const extDiv = document.createElement('div');
        extDiv.id = `lightshelf-controls-ext-${suffix}`;
        extDiv.className = "space-y-4 pt-4 border-t border-dashed border-[--grid-color]";
        extDiv.innerHTML = `<h3 class="font-semibold text-xs uppercase text-[--text-secondary]">Exterior Shelf</h3>`;
        extDiv.appendChild(this.createRangeControl(`lightshelf-dist-below-ext-${suffix}`, 'Dist Below Top (m)', 0, 3.0, 0.2, 0.05, 'm'));
        extDiv.appendChild(this.createRangeControl(`lightshelf-tilt-ext-${suffix}`, 'Tilt Angle', -90, 90, 0, 1, '°'));
        extDiv.appendChild(this.createRangeControl(`lightshelf-depth-ext-${suffix}`, 'Depth (m)', 0, 2.0, 0.5, 0.1, 'm'));
        extDiv.appendChild(this.createRangeControl(`lightshelf-thick-ext-${suffix}`, 'Thickness (m)', 0.005, 0.5, 0.05, 0.005, 'm'));
        div.appendChild(extDiv);

        // Interior Controls
        const intDiv = document.createElement('div');
        intDiv.id = `lightshelf-controls-int-${suffix}`;
        intDiv.className = "hidden space-y-4 pt-4 border-t border-dashed border-[--grid-color]";
        intDiv.innerHTML = `<h3 class="font-semibold text-xs uppercase text-[--text-secondary]">Interior Shelf</h3>`;
        intDiv.appendChild(this.createRangeControl(`lightshelf-dist-below-int-${suffix}`, 'Dist Below Top (m)', 0, 3.0, 0.2, 0.05, 'm'));
        intDiv.appendChild(this.createRangeControl(`lightshelf-tilt-int-${suffix}`, 'Tilt Angle', -90, 90, 0, 1, '°'));
        intDiv.appendChild(this.createRangeControl(`lightshelf-depth-int-${suffix}`, 'Depth (m)', 0, 2.0, 0.5, 0.1, 'm'));
        intDiv.appendChild(this.createRangeControl(`lightshelf-thick-int-${suffix}`, 'Thickness (m)', 0.005, 0.5, 0.05, 0.005, 'm'));
        div.appendChild(intDiv);

        return div;
    }

    createLouverControls(suffix) {
        const div = document.createElement('div');
        div.id = `shading-controls-louver-${suffix}`;
        div.className = 'hidden space-y-4 pt-4 border-t border-[--grid-color]';

        div.innerHTML = `
            <div><label class="label">Placement</label>
            <div class="btn-group mt-1">
                <button id="louver-placement-ext-${suffix}" class="btn active">Exterior</button>
                <button id="louver-placement-int-${suffix}" class="btn">Interior</button>
            </div></div>
            <div><label class="label" for="louver-slat-orientation-${suffix}">Orientation</label>
            <select id="louver-slat-orientation-${suffix}" class="w-full mt-1">
                <option value="horizontal" selected>Horizontal</option>
                <option value="vertical">Vertical</option>
            </select></div>`;

        div.appendChild(this.createRangeControl(`louver-slat-width-${suffix}`, 'Slat Width (m)', 0.01, 1.0, 0.1, 0.01, 'm'));
        div.appendChild(this.createRangeControl(`louver-slat-sep-${suffix}`, 'Slat Separation (m)', 0, 0.5, 0.05, 0.01, 'm'));
        div.appendChild(this.createRangeControl(`louver-slat-thick-${suffix}`, 'Slat Thickness (m)', 0, 0.5, 0.01, 0.005, 'm'));
        div.appendChild(this.createRangeControl(`louver-slat-angle-${suffix}`, 'Slat Angle', -90, 90, 0, 1, '°'));
        div.appendChild(this.createRangeControl(`louver-dist-to-glass-${suffix}`, 'Dist to Glass (m)', 0, 1.0, 0.1, 0.01, 'm'));
        return div;
    }

    createRollerControls(suffix) {
        const div = document.createElement('div');
        div.id = `shading-controls-roller-${suffix}`;
        div.className = 'hidden space-y-4 pt-4 border-t border-[--grid-color]';
        div.innerHTML = `<p class="info-box !text-xs !py-2 !px-3">Roller shades are placed internally.</p>`;

        div.innerHTML += `<h4 class="font-semibold text-xs uppercase text-[--text-secondary] pt-2">Sizing Offsets</h4>`;
        div.appendChild(this.createRangeControl(`roller-top-opening-${suffix}`, 'Top Opening (m)', -1.0, 1.0, 0.0, 0.01, 'm'));
        div.appendChild(this.createRangeControl(`roller-bottom-opening-${suffix}`, 'Bottom Opening (m)', -1.0, 1.0, 0.0, 0.01, 'm'));
        div.appendChild(this.createRangeControl(`roller-left-opening-${suffix}`, 'Left Opening (m)', -1.0, 1.0, 0.0, 0.01, 'm'));
        div.appendChild(this.createRangeControl(`roller-right-opening-${suffix}`, 'Right Opening (m)', -1.0, 1.0, 0.0, 0.01, 'm'));

        div.innerHTML += `<h4 class="font-semibold text-xs uppercase text-[--text-secondary] pt-2">Placement</h4>`;
        div.appendChild(this.createRangeControl(`roller-dist-to-glass-${suffix}`, 'Dist to Glass (m)', 0, 1.0, 0.1, 0.01, 'm'));

        div.innerHTML += `<h4 class="font-semibold text-xs uppercase text-[--text-secondary] pt-2">Physical Properties</h4>`;
        div.appendChild(this.createRangeControl(`roller-solar-trans-${suffix}`, 'Solar Transmittance', 0, 1, 0.1, 0.01));
        div.appendChild(this.createRangeControl(`roller-solar-refl-${suffix}`, 'Solar Reflectance', 0, 1, 0.7, 0.01));
        div.appendChild(this.createRangeControl(`roller-vis-trans-${suffix}`, 'Visible Transmittance', 0, 1, 0.05, 0.01));
        div.appendChild(this.createRangeControl(`roller-vis-refl-${suffix}`, 'Visible Reflectance', 0, 1, 0.7, 0.01));
        div.appendChild(this.createRangeControl(`roller-ir-emis-${suffix}`, 'IR Emissivity', 0, 1, 0.9, 0.01));
        div.appendChild(this.createRangeControl(`roller-ir-trans-${suffix}`, 'IR Transmittance', 0, 1, 0.0, 0.01));
        div.appendChild(this.createRangeControl(`roller-thickness-${suffix}`, 'Thickness (m)', 0, 0.05, 0.001, 0.001, 'm'));
        div.appendChild(this.createRangeControl(`roller-conductivity-${suffix}`, 'Conductivity (W/m-K)', 0, 10.0, 0.1, 0.01));

        return div;
    }

    createImportedObjControls(suffix) {
        const div = document.createElement('div');
        div.id = `shading-controls-imported_obj-${suffix}`;
        div.className = 'hidden space-y-4 pt-4 border-t border-[--grid-color]';

        div.innerHTML = `
            <div>
                <label class="label" for="shading-obj-file-${suffix}">OBJ File (.obj)</label>
                <input type="file" id="shading-obj-file-${suffix}" accept=".obj" class="w-full text-sm">
                <span data-file-display-for="shading-obj-file-${suffix}" class="text-xs text-[--text-secondary] truncate block mt-1">No file selected.</span>
            </div>
            <h4 class="font-semibold text-xs uppercase text-[--text-secondary] pt-2">Transform</h4>
        `;

        const createXYZ = (label, paramPrefix, defVal = 0, step = 0.1) => {
            return `
            <div>
                <label class="label text-xs">${label}</label>
                <div class="grid grid-cols-3 gap-2 mt-1">
                    <input type="number" id="${paramPrefix}-x-${suffix}" value="${defVal}" step="${step}" class="param-input-num">
                    <input type="number" id="${paramPrefix}-y-${suffix}" value="${defVal}" step="${step}" class="param-input-num">
                    <input type="number" id="${paramPrefix}-z-${suffix}" value="${defVal}" step="${step}" class="param-input-num">
                </div>
            </div>`;
        };

        div.innerHTML += createXYZ('Position (X, Y, Z)', `shading-obj-pos`);
        div.innerHTML += createXYZ('Rotation (°)', `shading-obj-rot`, 0, 1);
        div.innerHTML += createXYZ('Scale', `shading-obj-scale`, 1, 0.05);

        div.innerHTML += `<p class="info-box !text-xs !py-2 !px-3">Click object in 3D view to use gizmo.</p>`;
        return div;
    }

    createFrameControls(suffix = '') {
        const s = suffix ? `-${suffix}` : '';
        const div = document.createElement('div');
        div.className = 'pt-4 border-t border-[--grid-color]';
        div.innerHTML = `
            <label for="frame-toggle${s}" class="flex items-center cursor-pointer">
                <input type="checkbox" id="frame-toggle${s}" checked>
                <span class="ml-3 text-sm font-normal text-[--text-primary]">Add Frame To All Windows</span>
            </label>
            <div id="frame-controls${s}" class="mt-4 space-y-2"></div>`;

        const controls = div.querySelector(`#frame-controls${s}`);
        controls.appendChild(this.createRangeControl(`frame-thick${s}`, 'Frame Thick. (m)', 0, 1, 0.01, 0.01, 'm'));
        controls.appendChild(this.createRangeControl(`frame-depth${s}`, 'Frame Depth (m)', 0, 1, 0.05, 0.01, 'm'));

        return div;
    }

    createRangeControl(id, label, min, max, value, step, unit = '', percentMode = false) {
        const wrapper = document.createElement('div');
        const displayVal = percentMode ? `${Math.round(value * 100)}%` : `${value}${unit}`;

        wrapper.innerHTML = `
            <label class="label" for="${id}">${label}</label>
            <div class="flex items-center space-x-3 mt-1">
                <input type="range" id="${id}" min="${min}" max="${max}" value="${value}" step="${step}">
                <span id="${id}-val" class="data-value font-mono w-12 text-left">${displayVal}</span>
            </div>`;

        const input = wrapper.querySelector('input');
        const span = wrapper.querySelector('span');
        input.addEventListener('input', (e) => {
            let v = parseFloat(e.target.value);
            span.textContent = percentMode ? `${Math.round(v * 100)}%` : `${v}${unit}`;
        });

        return wrapper;
    }


    /**
     * Renders the full suite of controls for a custom wall into the given container.
     * @param {HTMLElement} container - The container to render into.
     * @param {string} wallId - The unique ID of the custom wall.
     * @param {object} wallData - The data object for the wall.
     * @param {function} onUpdate - Callback function triggered on any change.
     */
    renderCustomWallControls(container, wallId, wallData, onUpdate) {
        container.innerHTML = '';
        const suffix = wallId;
        const isDoor = wallData.apertures.type === 'door';
        const ceilingHeight = wallData.dimensions?.height || 3.0; // Get ceiling height for door max

        // 1. Initial Data Binding Helper
        // We defer this because inputs are created by sub-functions
        const bindInput = (id, value) => {
            const el = container.querySelector(`#${id}`);
            if (el) {
                if (el.type === 'checkbox') el.checked = value;
                else el.value = value;
                // Trigger visual update for range sliders
                el.dispatchEvent(new Event('input'));
            }
        };

        // 2. Create Sections

        // A. Aperture Type (Window / Door)
        const typeDiv = document.createElement('div');
        typeDiv.className = 'pt-2';
        typeDiv.innerHTML = `
            <label class="label">Aperture Type</label>
            <div class="btn-group mt-1">
                <button id="type-window-btn-${suffix}" class="btn ${!isDoor ? 'active' : ''}">Window</button>
                <button id="type-door-btn-${suffix}" class="btn ${isDoor ? 'active' : ''}">Door</button>
            </div>`;
        container.appendChild(typeDiv);

        // === WINDOW CONTROLS CONTAINER ===
        const windowControlsContainer = document.createElement('div');
        windowControlsContainer.id = `window-controls-container-${suffix}`;
        windowControlsContainer.className = isDoor ? 'hidden' : '';

        // Window Count & Mode
        windowControlsContainer.appendChild(this.createRangeControl(`win-count-${suffix}`, '# of Windows', 0, 10, wallData.apertures.count || 0, 1));

        const modeDiv = document.createElement('div');
        modeDiv.className = 'pt-2';
        modeDiv.innerHTML = `
            <label class="label">Mode</label>
            <div class="btn-group mt-1">
                <button id="mode-wwr-btn-${suffix}" class="btn ${wallData.apertures.mode === 'wwr' ? 'active' : ''}">WWR</button>
                <button id="mode-manual-btn-${suffix}" class="btn ${wallData.apertures.mode === 'manual' ? 'active' : ''}">Manual</button>
            </div>`;
        windowControlsContainer.appendChild(modeDiv);

        // WWR Controls
        const wwrContainer = document.createElement('div');
        wwrContainer.id = `wwr-controls-${suffix}`;
        wwrContainer.className = wallData.apertures.mode === 'wwr' ? 'space-y-5 mt-4' : 'hidden space-y-5 mt-4';
        wwrContainer.appendChild(this.createRangeControl(`wwr-${suffix}`, 'WWR (%)', 0, 0.99, wallData.apertures.wwr || 0.4, 0.01, '%', true));
        wwrContainer.appendChild(this.createRangeControl(`wwr-sill-height-${suffix}`, 'Sill Height (m)', 0, 10, wallData.apertures.sillHeight || 1.0, 0.05, 'm'));
        wwrContainer.appendChild(this.createRangeControl(`win-depth-pos-${suffix}`, 'Window Depth Position (m)', 0, 1, wallData.apertures.depthPos || 0.1, 0.05, 'm'));
        windowControlsContainer.appendChild(wwrContainer);

        // Manual Controls
        const manualContainer = document.createElement('div');
        manualContainer.id = `manual-controls-${suffix}`;
        manualContainer.className = wallData.apertures.mode === 'manual' ? 'space-y-5 mt-4' : 'hidden space-y-5 mt-4';
        manualContainer.appendChild(this.createRangeControl(`win-width-${suffix}`, 'Win. Width (m)', 0.1, 20, wallData.apertures.width || 1.5, 0.1, 'm'));
        manualContainer.appendChild(this.createRangeControl(`win-height-${suffix}`, 'Win. Height (m)', 0.1, 10, wallData.apertures.height || 1.2, 0.1, 'm'));
        manualContainer.appendChild(this.createRangeControl(`sill-height-${suffix}`, 'Sill Height (m)', 0, 10, wallData.apertures.sillHeight || 1.0, 0.05, 'm'));
        manualContainer.appendChild(this.createRangeControl(`win-depth-pos-${suffix}-manual`, 'Window Depth Position (m)', 0, 1, wallData.apertures.depthPos || 0.1, 0.05, 'm'));
        windowControlsContainer.appendChild(manualContainer);

        container.appendChild(windowControlsContainer);

        // === DOOR CONTROLS CONTAINER ===
        const doorControlsContainer = document.createElement('div');
        doorControlsContainer.id = `door-controls-container-${suffix}`;
        doorControlsContainer.className = isDoor ? 'space-y-5 mt-4' : 'hidden space-y-5 mt-4';

        doorControlsContainer.appendChild(this.createRangeControl(`door-count-${suffix}`, '# of Doors', 0, 10, wallData.apertures.doorCount || 0, 1));
        doorControlsContainer.appendChild(this.createRangeControl(`door-spacing-${suffix}`, 'Distance between Doors (m)', 0, 10, wallData.apertures.doorSpacing || 0.5, 0.05, 'm'));
        doorControlsContainer.appendChild(this.createRangeControl(`door-height-${suffix}`, 'Door Height (m)', 0.5, ceilingHeight, wallData.apertures.doorHeight || 2.1, 0.05, 'm'));
        doorControlsContainer.appendChild(this.createRangeControl(`door-width-${suffix}`, 'Door Width (m)', 0.3, 5, wallData.apertures.doorWidth || 0.9, 0.05, 'm'));
        doorControlsContainer.appendChild(this.createRangeControl(`door-depth-pos-${suffix}`, 'Door Depth Position (m)', 0, 1, wallData.apertures.doorDepthPos || 0.1, 0.05, 'm'));

        container.appendChild(doorControlsContainer);

        // D. Shading Section
        const shadingContainer = this.createShadingSection(suffix, 'Custom');
        container.appendChild(shadingContainer);

        // E. Frame Section (only for windows)
        const frameContainer = this.createFrameControls(suffix);
        frameContainer.id = `frame-container-${suffix}`;
        frameContainer.classList.toggle('hidden', isDoor);
        container.appendChild(frameContainer);


        // 3. Bind Values & Attach Listeners
        // We iterate over all inputs in the container
        const inputs = container.querySelectorAll('input, select');
        inputs.forEach(input => {
            // Attach listener
            input.addEventListener('input', (e) => {
                const target = e.target;
                onUpdate(target.id, target.type === 'checkbox' ? target.checked : target.value);
            });
            input.addEventListener('change', (e) => {
                const target = e.target;
                onUpdate(target.id, target.type === 'checkbox' ? target.checked : target.value);
            });
        });

        // Mode Toggles (for windows)
        const wwrBtn = container.querySelector(`#mode-wwr-btn-${suffix}`);
        const manualBtn = container.querySelector(`#mode-manual-btn-${suffix}`);

        wwrBtn?.addEventListener('click', () => {
            wwrBtn.classList.add('active');
            manualBtn.classList.remove('active');
            wwrContainer.classList.remove('hidden');
            manualContainer.classList.add('hidden');
            onUpdate(`mode-${suffix}`, 'wwr');
        });

        manualBtn?.addEventListener('click', () => {
            manualBtn.classList.add('active');
            wwrBtn.classList.remove('active');
            manualContainer.classList.remove('hidden');
            wwrContainer.classList.add('hidden');
            onUpdate(`mode-${suffix}`, 'manual');
        });

        // Type Toggles (Window/Door)
        const typeWinBtn = container.querySelector(`#type-window-btn-${suffix}`);
        const typeDoorBtn = container.querySelector(`#type-door-btn-${suffix}`);

        typeWinBtn?.addEventListener('click', () => {
            typeWinBtn.classList.add('active');
            typeDoorBtn.classList.remove('active');
            windowControlsContainer.classList.remove('hidden');
            doorControlsContainer.classList.add('hidden');
            frameContainer.classList.remove('hidden');
            onUpdate(`type-${suffix}`, 'window');
        });

        typeDoorBtn?.addEventListener('click', () => {
            typeDoorBtn.classList.add('active');
            typeWinBtn.classList.remove('active');
            doorControlsContainer.classList.remove('hidden');
            windowControlsContainer.classList.add('hidden');
            frameContainer.classList.add('hidden');
            onUpdate(`type-${suffix}`, 'door');
        });

        // Shading Toggle Logic
        const shadeToggle = container.querySelector(`#shading-${suffix}-toggle`);
        const shadeControls = container.querySelector(`#shading-controls-${suffix}`);
        if (shadeToggle && shadeControls) {
            shadeToggle.checked = wallData.shading?.enabled || false;
            shadeControls.classList.toggle('hidden', !shadeToggle.checked);

            shadeToggle.addEventListener('change', (e) => {
                shadeControls.classList.toggle('hidden', !e.target.checked);
            });
        }
    }

    // Override createFrameControls to accept suffix
    createFrameControls(suffix = '') {
        const s = suffix ? `-${suffix}` : '';
        const div = document.createElement('div');
        div.className = 'pt-4 border-t border-[--grid-color]';
        div.innerHTML = `
            <label for="frame-toggle${s}" class="flex items-center cursor-pointer">
                <input type="checkbox" id="frame-toggle${s}" checked>
                <span class="ml-3 text-sm font-normal text-[--text-primary]">Add Frame To All Windows</span>
            </label>
            <div id="frame-controls${s}" class="mt-4 space-y-2"></div>`;

        const controls = div.querySelector(`#frame-controls${s}`);
        controls.appendChild(this.createRangeControl(`frame-thick${s}`, 'Frame Thick. (m)', 0, 1, 0.05, 0.01, 'm'));
        controls.appendChild(this.createRangeControl(`frame-depth${s}`, 'Frame Depth (m)', 0, 1, 0.15, 0.01, 'm'));

        return div;
    }

    appendResizeHandles() {
        const positions = ['top', 'right', 'bottom', 'left', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
        positions.forEach(pos => {
            const div = document.createElement('div');
            div.className = pos.includes('-') ? `resize-handle-corner ${pos}` : `resize-handle-edge ${pos}`;
            this.container.appendChild(div);
        });
    }
}