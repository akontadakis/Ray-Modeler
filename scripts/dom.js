// scripts/dom.js

const dom = {};

/**
 * Caches references to all necessary DOM elements for the application.
 * This should be called once on startup.
 */
export function setupDOM() {
const ids = [
    // Global
    'theme-btn-light', 'theme-btn-dark', 'theme-btn-cyber', 'theme-btn-cafe58', 'theme-switcher-container',
    'render-container', 'sidebar-wrapper', 'right-sidebar',
    'welcome-screen', 'glow-canvas', 'start-with-shoebox', 'start-with-import', 'welcome-effect-switcher', 'cycle-effect-btn',

    // Main Panels & Toggles
    'panel-simulation-modules', 'globals-toggle', 'globals-controls', 'panel-analysis-modules', 'toggle-modules-btn', 'toggle-analysis-btn',
    'save-project-button', 'load-project-button', 'run-simulation-button', 'custom-alert',
    'custom-alert-title', 'custom-alert-message', 'custom-alert-close',

    // Toolbars
    'left-toolbar', 'left-controls-container', 'toggle-panel-project-btn', 'toggle-panel-dimensions-btn', 
    'toggle-panel-aperture-btn', 'toggle-panel-lighting-btn', 'toggle-panel-materials-btn',
    'toggle-panel-sensor-btn', 'toggle-panel-viewpoint-btn', 'toggle-panel-scene-btn',
    'view-controls', 'view-btn-persp', 'view-btn-ortho', 'view-btn-top', 'view-btn-front', 'view-btn-back', 'view-btn-left', 'view-btn-right', 'view-btn-quad',
    'viewport-main', 'viewport-top', 'viewport-front', 'viewport-side',

    // Scene Elements Panel
    'panel-scene-elements', 'asset-library', 'asset-library-vegetation', 'transform-controls-section',
    'gizmo-mode-translate', 'gizmo-mode-rotate', 'gizmo-mode-scale', 'remove-selected-object-btn',
    'obj-pos-x', 'obj-pos-y', 'obj-pos-z', 'obj-pos-x-val', 'obj-pos-y-val', 'obj-pos-z-val',
    'obj-rot-y', 'obj-rot-y-val',
    'obj-scale-uniform', 'obj-scale-uniform-val',

    // Project Panel
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
    'show-view-grid-3d-toggle', 'view-grid-spacing', 'view-grid-spacing-val', 'view-grid-offset', 
    'view-grid-offset-val', 'view-grid-directions', 'view-grid-directions-val', 'view-grid-start-vec-x',
    'view-grid-start-vec-x-val', 'view-grid-start-vec-y', 'view-grid-start-vec-y-val', 'view-grid-start-vec-z',
    'view-grid-start-vec-z-val',

    // EN 12464-1 Task/Surrounding Grids
    'task-area-toggle', 'task-area-controls',
    'task-area-visualizer-container', 'task-area-canvas',
    'task-area-start-x', 'task-area-start-x-val', 'task-area-start-z', 'task-area-start-z-val',
    'task-area-width', 'task-area-width-val', 'task-area-depth', 'task-area-depth-val',
    'surrounding-area-toggle', 'surrounding-area-controls', 'surrounding-area-width', 'surrounding-area-width-val',

    // Viewpoint Panel
    'panel-viewpoint', 'view-type', 'fpv-toggle-btn', 'gizmo-toggle',
    'view-pos-x', 'view-pos-x-val', 'view-pos-y', 'view-pos-y-val', 'view-pos-z', 'view-pos-z-val',
    'view-dir-x', 'view-dir-x-val', 'view-dir-y', 'view-dir-y-val', 'view-dir-z', 'view-dir-z-val',
    'view-fov', 'view-fov-val', 'view-dist', 'view-dist-val',

    // View Options Panel
    'transparent-toggle', 'transparency-controls', 'surface-opacity', 'surface-opacity-val', 'ground-plane-toggle', 'ground-grid-controls', 'ground-grid-size', 'ground-grid-size-val', 'ground-grid-divisions', 'ground-grid-divisions-val', 'world-axes-toggle', 'world-axes-size', 'world-axes-size-val',
    'h-section-toggle', 'h-section-controls', 'h-section-dist', 'h-section-dist-val',
    'v-section-toggle', 'v-section-controls', 'v-section-dist', 'v-section-dist-val',
    'live-preview-section', 'preview-date', 'preview-time', 'render-section-preview-btn',
    'occupancy-toggle', 'occupancy-controls', 'occupancy-schedule-filename',
    'occupancy-time-range-display', 'occupancy-time-slider-container',
    'occupancy-time-range-start', 'occupancy-time-range-end', 'generate-occupancy-btn',

    // Context & Site Modeling
    'context-mode-none', 'context-mode-osm', 'context-mode-massing', 'context-mode-topo',
    'osm-controls', 'osm-radius', 'osm-radius-val', 'fetch-osm-data-btn', 'context-visibility-toggle',
    'massing-controls', 'add-massing-block-btn',
    'massing-shape', 'massing-width', 'massing-width-val', 'massing-depth', 'massing-depth-val',
    'massing-height', 'massing-height-val', 'massing-radius', 'massing-radius-val',
    'massing-pos-x', 'massing-pos-x-val', 'massing-pos-y', 'massing-pos-y-val', 'massing-pos-z', 'massing-pos-z-val',
    'massing-count', 'massing-count-val', 'massing-spacing', 'massing-spacing-val',
    'massing-pattern', 'create-massing-blocks-btn', 'clear-massing-blocks-btn',
    'massing-info', 'massing-count-display', 'massing-volume-display',
    'topo-controls', 'topo-heightmap-file', 'topo-plane-size', 'topo-plane-size-val', 'topo-vertical-scale', 'topo-vertical-scale-val',
    'context-material-controls', 'context-mat-type', 'context-refl', 'context-refl-val',

    // Shortcut Modal
    'shortcut-help-btn', 'shortcut-help-modal', 'shortcut-modal-close-btn',

    // AI Assistant & Info Panel
    'info-button', 'panel-info', 'ai-assistant-button', 'ai-chat-messages',
    'ai-chat-form', 'ai-chat-input', 'ai-chat-send', 'ai-mode-select', 'ai-mode-description-box', 
    'ai-mode-description-text', 'ai-chat-tabs', 'ai-settings-btn', 'ai-settings-modal', 
    'ai-settings-close-btn', 'ai-settings-form', 'ai-provider-select', 'ai-model-select',
    'ai-secret-field', 'ai-custom-model-input', 'openrouter-info-box', 'chat-resize-handle', 'ai-chat-input-container',
    'ai-info-btn', 'helios-capabilities-modal', 'helios-capabilities-close-btn',

    // Results Panel
    'results-file-input-a', 'results-file-name-a', 'compare-mode-toggle', 'comparison-file-loader',
    'results-file-input-b', 'results-file-name-b', 'view-mode-selector', 'view-mode-a-btn',
    'view-mode-b-btn', 'view-mode-diff-btn', 'summary-stats-container', 'summary-a', 'summary-b',
    'results-min-val-a', 'results-avg-val-a', 'results-max-val-a', 'results-min-val-b',
    'results-avg-val-b', 'results-max-val-b', 'color-scale-section', 'standard-color-scale',
    'difference-color-scale', 'difference-legend', 'diff-legend-min-label', 'diff-legend-max-label',
    'results-dashboard', 'results-legend', 'legend-min-label', 'legend-max-label',
    'results-scale-min', 'results-scale-min-num', 'results-scale-max', 'results-scale-max-num', 'results-palette',
    'data-table-btn', 'data-table-panel', 'data-table-filter-input',
    'results-data-table', 'data-table-head', 'data-table-body',
    'results-dashboard-btn', 'results-analysis-panel', 'stats-min-val', 'stats-max-val', 'stats-avg-val',
    'stats-uniformity-val', 'highlight-min-btn', 'highlight-max-btn', 'clear-highlights-btn', 'heatmap-canvas',
    'heatmap-controls-container', 'heatmap-mode-selector', 'da-threshold-controls', 'da-threshold-slider', 'da-threshold-val',
    'illuminance-histogram', 'interactive-legend', 'legend-min-val', 'legend-max-val', 'scale-min-input', 'scale-max-input', 'scale-min-input-num', 'scale-max-input-num',

    // Annual Dashboards
    'annual-metrics-dashboard', 'sda-gauge', 'ase-gauge', 'udi-chart', 'sda-value', 'ase-value',
    'lighting-metrics-dashboard', 'savings-gauge', 'power-gauge', 'savings-value', 'power-value',
    'annual-time-series-explorer', 'time-series-chart', 'time-scrubber', 'time-scrubber-display',
    'glare-analysis-dashboard', 'glare-metric-label', 'glare-val', 'glare-source-count', 'glare-source-list', 'clear-glare-highlight-btn',
    'annual-glare-controls', 'glare-rose-btn', 'glare-rose-panel', 'glare-rose-threshold', 'glare-rose-threshold-val', 'glare-rose-canvas',
    'combined-analysis-btn', 'combined-analysis-panel', 'combined-glare-threshold', 'combined-glare-threshold-val', 'combined-analysis-canvas',
    'temporal-map-panel', 'temporal-map-point-id', 'temporal-map-canvas',
    'climate-analysis-controls', 'climate-dashboard-btn', 'climate-analysis-panel', 'wind-rose-canvas', 'solar-radiation-canvas', 'temperature-chart-canvas', 'humidity-chart-canvas', 'sun-path-canvas',
    'lighting-energy-dashboard', 'lpd-val', 'energy-val', 'energy-savings-val', 'lpd-gauge', 'energy-gauge', 'energy-savings-gauge',
    'circadian-metrics-dashboard', 'cs-gauge', 'cs-value', 'eml-value', 'cct-value', 'well-compliance-checklist',
    'spectral-metrics-dashboard', 'metric-photopic-val', 'metric-melanopic-val', 'metric-neuropic-val',
    'metric-selector-container', 'metric-selector',

    // Other
    'sensor-context-menu', 'set-viewpoint-here-btn', 'wall-select-lock-btn', 'lock-icon-unlocked', 'lock-icon-locked', 'selected-wall-display',
    'sun-ray-trace-section', 'sun-ray-date', 'sun-ray-time', 'sun-ray-count', 'sun-ray-count-val', 'sun-ray-bounces', 'sun-ray-bounces-val', 'sun-rays-visibility-toggle', 'trace-sun-rays-btn',
    'sun-ray-info-display', 'sun-altitude-val', 'sun-azimuth-val', 'sun-dni-val', 'sun-dhi-val',
    'save-view-btn', 'saved-views-list', 'recipe-guides-btn', 'panel-recipe-guides', 'guide-selector', 'guide-content',
    'custom-asset-importer',

    // Lighting Panel
    'lighting-enabled-toggle', 'lighting-controls-wrapper', 'light-type-selector', 'light-geometry-section',
    'light-geometry-selector', 'geometry-params-section', 'geo-params-polygon', 'geo-params-sphere',
    'geo-sphere-radius', 'geo-params-cylinder', 'geo-cylinder-radius', 'geo-cylinder-length', 'geo-params-ring',
    'geo-ring-radius-in', 'geo-ring-radius-out',
    'params-light', 'light-rgb-r', 'light-rgb-g', 'light-rgb-b',
    'params-spotlight', 'spot-rgb-r', 'spot-rgb-g', 'spot-rgb-b', 'spot-cone-angle', 'spot-dir-x', 'spot-dir-y',
    'spot-dir-z', 'spot-normalize-toggle',
    'params-glow', 'glow-rgb-r', 'glow-rgb-g', 'glow-rgb-b', 'glow-behavior', 'glow-radius-input-container', 'glow-max-radius',
    'params-illum', 'illum-rgb-r', 'illum-rgb-g', 'illum-rgb-b', 'illum-alt-material',
    'params-ies', 'ies-file-input', 'ies-photometry-viewer', 'ies-info-display', 'ies-lumens-val', 'ies-wattage-val',
    'ies-efficacy-val', 'ies-polar-plot-canvas', 'ies-3d-viewer-container', 'ies-units', 'ies-multiplier',
    'ies-lamp-type', 'ies-force-color-toggle', 'ies-color-override-inputs', 'ies-color-r', 'ies-color-g', 'ies-color-b',
    'placement-mode-individual', 'placement-mode-grid', 'light-pos-x', 'light-pos-y', 'light-pos-z', 'light-rot-x',
    'light-rot-y', 'light-rot-z', 'grid-layout-inputs', 'grid-rows', 'grid-cols', 'grid-row-spacing', 'grid-col-spacing',
    'lighting-power-section', 'luminaire-wattage', 'lpd-display',
    'lighting-spec-section', 'maintenance-factor', 'maintenance-factor-val', 'light-source-ra', 'light-source-tcp',
    // Daylighting Controls
    'daylighting-enabled-toggle', 'daylighting-controls-wrapper', 'daylighting-visualize-zones-toggle', 'daylighting-availability-schedule',
    'daylighting-control-type', 'daylighting-setpoint', 'daylight-continuous-params', 'daylighting-min-power-frac',
    'daylighting-min-power-frac-val', 'daylighting-min-light-frac', 'daylighting-min-light-frac-val',
    'daylight-stepped-params', 'daylighting-steps', 'daylight-sensor-count', 'daylighting-zoning-strategy-controls',
    'daylighting-zone-strategy-rows', 'daylighting-zone-strategy-cols', 'daylight-sensor-controls-container',
    'daylight-sensor-1-controls', 'daylight-sensor1-gizmo-toggle', 'daylight-sensor1-x', 'daylight-sensor1-y',
    'daylight-sensor1-z', 'daylight-sensor1-x-val', 'daylight-sensor1-y-val', 'daylight-sensor1-z-val',
    'daylight-sensor1-dir-x', 'daylight-sensor1-dir-y', 'daylight-sensor1-dir-z', 'daylight-sensor1-dir-x-val',
    'daylight-sensor1-dir-y-val', 'daylight-sensor1-dir-z-val', 'daylight-sensor1-percent', 'daylight-sensor1-percent-val',
    'daylight-sensor-2-controls', 'daylight-sensor2-gizmo-toggle', 'daylight-sensor2-x', 'daylight-sensor2-y',
    'daylight-sensor2-z', 'daylight-sensor2-x-val', 'daylight-sensor2-y-val', 'daylight-sensor2-z-val',
    'daylight-sensor2-dir-x', 'daylight-sensor2-dir-y', 'daylight-sensor2-dir-z', 'daylight-sensor2-dir-x-val',
    'daylight-sensor2-dir-y-val', 'daylight-sensor2-dir-z-val', 'daylight-sensor2-percent', 'daylight-sensor2-percent-val',
    'daylighting-zone-visualizer-container', 'daylighting-zone-canvas', 'daylight-sensor-placement-header'
  ];

  const wallDirections = ['n', 's', 'e', 'w'];

// Add static IDs
ids.forEach(id => {
    const el = document.getElementById(id);
        if (el) dom[id] = el;
    });

    // Add dynamically generated IDs for aperture and shading controls
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
            `solar-params-${dir}`, `solar-quality-${dir}`, `solar-threshold-${dir}`, `solar-threshold-val-${dir}`,
            `solar-epw-file-${dir}`, `solar-analyze-btn-${dir}`, `solar-progress-${dir}`, `solar-progress-fill-${dir}`,
            `solar-progress-text-${dir}`, `solar-results-${dir}`, `solar-high-hours-${dir}`, `solar-peak-alt-${dir}`,
            `solar-fin-count-${dir}`, `solar-edit-btn-${dir}`,
        ];
        
        controlIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) dom[id] = el;
        });
    });
}

/**
 * Provides read-only access to the cached DOM elements.
 * @returns {object} The DOM cache.
 */
export function getDom() {
    return dom;
}