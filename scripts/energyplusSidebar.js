// scripts/energyplusSidebar.js
import { getDom } from './dom.js';
import { project } from './project.js';
import { resultsManager } from './resultsManager.js';
import { validateEnergyPlusRunRequest, formatIssuesSummary } from './energyplusValidation.js';
/* EnergyPlus contextual help disabled */

let dom;

const recipes = {
    "IDF Preview / Diagnostics": {
        description: "Inspect how the current project and EnergyPlus configuration map into EnergyPlus objects. Highlights missing constructions, materials, schedules, and other issues.",
        id: "energyplus-diagnostics",
        isDiagnostics: true
    },
    "Annual Energy Simulation": {
        description: "Runs a full annual energy simulation using EnergyPlus.",
        id: "annual-energy-simulation",
        scriptName: "run-energyplus.sh",
        params: [
            { id: "idf-file", name: "IDF File (optional, defaults to generated model.idf)", type: "file", accept: ".idf" },
            { id: "epw-file", name: "EPW File (optional, uses project-level EPW if omitted)", type: "file", accept: ".epw" },
            { id: "eplus-exe", name: "EnergyPlus Executable Path", type: "text" }
        ]
    },
    "Heating Design Day": {
        description: "Runs a sizing-only simulation using design day periods defined in the IDF (heating-focused).",
        id: "heating-design-day",
        scriptName: "run-heating-design.sh",
        params: [
            { id: "idf-file", name: "IDF File (optional, defaults to model.idf)", type: "file", accept: ".idf" },
            { id: "epw-file", name: "EPW File (optional, uses project-level EPW if omitted)", type: "file", accept: ".epw" },
            { id: "eplus-exe", name: "EnergyPlus Executable Path", type: "text" }
        ]
    },
    "Cooling Design Day": {
        description: "Runs a sizing-only simulation using design day periods defined in the IDF (cooling-focused).",
        id: "cooling-design-day",
        scriptName: "run-cooling-design.sh",
        params: [
            { id: "idf-file", name: "IDF File (optional, defaults to model.idf)", type: "file", accept: ".idf" },
            { id: "epw-file", name: "EPW File (optional, uses project-level EPW if omitted)", type: "file", accept: ".epw" },
            { id: "eplus-exe", name: "EnergyPlus Executable Path", type: "text" }
        ]
    }
};

function initializeEnergyPlusSidebar() {
    dom = getDom();
    const panel = dom['panel-energyplus'];
    if (!panel) return;

    let content = panel.querySelector('.window-content');
    if (!content) {
        content = document.createElement('div');
        content.className = 'window-content';
        panel.appendChild(content);
    }

    // Unified layout for the EnergyPlus sidebar
    content.innerHTML = `
        <div class="space-y-4 p-1">
            <div class="border border-gray-800/80 rounded bg-black/40 p-3 space-y-4">
                
                <!-- 1. Simulation Checklist -->
                <div>
                    <div class="flex items-center justify-between mb-2">
                        <h3 class="font-semibold text-sm uppercase">Simulation Checklist</h3>
                        <button class="btn btn-xxs btn-secondary" data-action="refresh-simulation-checklist">Refresh</button>
                    </div>
                    <div data-role="simulation-checklist-body" class="space-y-1">
                        <div class="text-xs text-[--text-secondary]">Evaluating project...</div>
                    </div>
                </div>

                <!-- 2. Simulation Recipes -->
                <div>
                    <h3 class="font-semibold text-sm uppercase mb-2">Run Simulation</h3>
                    <div class="recipe-list space-y-2"></div>
                </div>

                <!-- 3. Configuration -->
                <div>
                    <h3 class="font-semibold text-sm uppercase mb-2">Configuration</h3>
                    <div class="grid grid-cols-2 gap-2">
                        <button class="btn btn-sm btn-secondary w-full" data-action="open-materials-manager">Materials</button>
                        <button class="btn btn-sm btn-secondary w-full" data-action="open-constructions-manager">Constructions</button>
                        <button class="btn btn-sm btn-secondary w-full" data-action="open-schedules-manager">Schedules</button>
                        <button class="btn btn-sm btn-secondary w-full" data-action="open-zone-loads-manager">Zone Loads</button>
                        <button class="btn btn-sm btn-secondary w-full" data-action="open-ideal-loads-manager">Thermostats</button>
                        <button class="btn btn-sm btn-secondary w-full" data-action="open-weather-location-manager">Weather</button>
                        <button class="btn btn-sm btn-secondary w-full" data-action="open-daylighting-manager">Daylighting</button>
                        <button class="btn btn-sm btn-secondary w-full" data-action="open-outputs-manager">Outputs</button>
                        <button class="btn btn-sm btn-secondary w-full col-span-2" data-action="open-simulation-control-manager">Simulation Control</button>
                    </div>
                </div>
            </div>

            <p class="text-xs text-[--text-secondary] px-1">
                <strong>HVAC scope:</strong> Ray-Modeler generates models using <code>ZoneHVAC:IdealLoadsAirSystem</code>.
                Detailed Air/PlantLoop systems are not generated.
            </p>
        </div>
    `;

    // Wire up all controls after rendering the new layout

    const checklistContainer = content.querySelector('[data-role="simulation-checklist-body"]');
    if (checklistContainer) {
        renderSimulationChecklist(checklistContainer);
    }

    const checklistRefreshBtn = content.querySelector('[data-action="refresh-simulation-checklist"]');
    if (checklistRefreshBtn && checklistContainer) {
        checklistRefreshBtn.addEventListener('click', () => {
            renderSimulationChecklist(checklistContainer);
        });
    }

    populateRecipeList();

    // Delegated click handler for the configuration buttons
    content.addEventListener('click', async (ev) => {
        const btn = ev.target.closest('button[data-action]');
        if (!btn) return;

        const action = btn.dataset.action;
        const actions = {
            'open-materials-manager': openMaterialsManagerPanel,
            'open-constructions-manager': openConstructionsManagerPanel,
            'open-schedules-manager': openSchedulesManagerPanel,
            'open-zone-loads-manager': openZoneLoadsManagerPanel,
            'open-ideal-loads-manager': openIdealLoadsManagerPanel,
            'open-daylighting-manager': openDaylightingManagerPanel,
            'open-outputs-manager': openOutputsManagerPanel,
            'open-weather-location-manager': openWeatherLocationManagerPanel,
            'open-simulation-control-manager': openSimulationControlManagerPanel,
        };

        if (actions[action]) {
            actions[action]();
        }
    });

    // Checklist delegated actions
    const checklistBody = content.querySelector('[data-role="simulation-checklist-body"]');
    if (checklistBody) {
        checklistBody.addEventListener('click', async (ev) => {
            const btn = ev.target.closest('[data-checklist-action]');
            if (!btn) return;
            ev.stopPropagation(); // Prevent content click handler from firing
            const action = btn.getAttribute('data-checklist-action');

            try {
                const checklistActions = {
                    'open-diagnostics': openDiagnosticsPanel,
                    'open-materials': openMaterialsManagerPanel,
                    'open-constructions': openConstructionsManagerPanel,
                    'open-schedules': openSchedulesManagerPanel,
                    'open-zone-loads': openZoneLoadsManagerPanel,
                    'open-ideal-loads': openIdealLoadsManagerPanel,
                    'open-daylighting': openDaylightingManagerPanel,
                    'open-outputs': openOutputsManagerPanel,
                    'open-weather-location': openWeatherLocationManagerPanel,
                    'open-sim-control': openSimulationControlManagerPanel,
                    'open-annual': () => openRecipePanel(recipes['Annual Energy Simulation']),
                    'open-heating-dd': () => openRecipePanel(recipes['Heating Design Day']),
                    'open-cooling-dd': () => openRecipePanel(recipes['Cooling Design Day']),
                };

                if (checklistActions[action]) {
                    await Promise.resolve(checklistActions[action]());
                } else if (action === 'generate-idf') {
                    const { generateAndStoreIdf } = await import('./energyplus.js');
                    await generateAndStoreIdf();
                    alert('IDF generated and stored as model.idf');
                    if (checklistContainer) {
                        renderSimulationChecklist(checklistContainer);
                    }
                }
            } catch (err) {
                console.error('Simulation Checklist action failed:', err);
                alert('Simulation Checklist action failed. Check console for details.');
            }
        });
    }
}

/**
 * SIMULATION CHECKLIST
 * Provides a guided 1→7 workflow status derived from current project metadata and diagnostics.
 */

async function computeSimulationChecklist() {
    // Helper to read meta and energyPlusConfig safely
    const safeGetMeta = () => {
        try {
            return (typeof project.getMetadata === 'function' && project.getMetadata()) || project.metadata || {};
        } catch (e) {
            console.warn('SimulationChecklist: failed to read project metadata', e);
            return {};
        }
    };

    const meta = safeGetMeta();
    const ep = meta.energyPlusConfig || meta.energyplus || {};
    const weather = ep.weather || {};
    const simControl = ep.simulationControl || {};

    // Try to pull diagnostics; fall back to null if unavailable.
    let diagnostics = null;
    try {
        const { generateEnergyPlusDiagnostics } = await import('./energyplus.js');
        diagnostics = await generateEnergyPlusDiagnostics();
    } catch (err) {
        console.debug('SimulationChecklist: diagnostics unavailable or failed', err);
    }

    const issues = (diagnostics && diagnostics.issues) || [];

    const hasFatalIssues = issues.some((i) => i.severity === 'error');
    const hasWarnings = issues.some((i) => i.severity === 'warning');

    const geometry = diagnostics && diagnostics.geometry;
    const constructionsDiag = diagnostics && diagnostics.constructions;
    const materialsDiag = diagnostics && diagnostics.materials;
    const schedLoadsDiag = diagnostics && diagnostics.schedulesAndLoads;

    // Quick helpers
    const hasZones =
        (geometry && geometry.totals && geometry.totals.zones > 0) ||
        (typeof project.getZones === 'function' && (project.getZones() || []).length > 0) ||
        (Array.isArray(project.zones) && project.zones.length > 0);

    const missingCons = (constructionsDiag && constructionsDiag.missingConstructions) || [];
    const missingMats = (materialsDiag && materialsDiag.missingMaterials) || [];
    const missingScheds = (schedLoadsDiag && schedLoadsDiag.missingSchedules) || [];
    const inconsistentLoads = (schedLoadsDiag && schedLoadsDiag.inconsistentLoads) || [];

    const epwPath = weather.epwPath || ep.weatherFilePath || null;
    const locationSource = weather.locationSource || 'FromEPW';
    const cl = weather.customLocation || null;

    const validateCustomLocation = () => {
        if (!cl) return false;
        const { name, latitude, longitude, timeZone, elevation } = cl;
        if (!name) return false;
        if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return false;
        if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return false;
        if (!Number.isFinite(timeZone) || timeZone < -12 || timeZone > 14) return false;
        if (!Number.isFinite(elevation)) return false;
        return true;
    };

    // Step 1: Geometry
    const step1 = (() => {
        if (hasZones) {
            return {
                id: 'geometry',
                label: '1. Geometry',
                status: 'ok',
                description: 'Project zones detected.',
                actions: [{ label: 'Open Diagnostics', actionId: 'open-diagnostics' }],
            };
        }
        return {
            id: 'geometry',
            label: '1. Geometry',
            status: 'warning',
            description: 'No explicit zones found. IDF will fall back to a default Zone_1.',
            actions: [{ label: 'Open Diagnostics', actionId: 'open-diagnostics' }],
        };
    })();

    // Step 2: Constructions & Materials
    const step2 = (() => {
        if (missingCons.length || missingMats.length) {
            return {
                id: 'constructions',
                label: '2. Constructions & Materials',
                status: 'error',
                description: 'Missing constructions or materials referenced by the model.',
                actions: [
                    { label: 'Open Constructions', actionId: 'open-constructions' },
                    { label: 'Open Materials', actionId: 'open-materials' },
                    { label: 'Diagnostics', actionId: 'open-diagnostics' },
                ],
            };
        }
        const hasAny =
            (Array.isArray(ep.constructions) && ep.constructions.length) ||
            (Array.isArray(ep.materials) && ep.materials.length);
        return {
            id: 'constructions',
            label: '2. Constructions & Materials',
            status: hasAny ? 'ok' : 'warning',
            description: hasAny
                ? 'Constructions and materials configured or using built-ins.'
                : 'Using built-in defaults only. Review for project-specific envelopes.',
            actions: [
                { label: 'Open Constructions', actionId: 'open-constructions' },
                { label: 'Open Materials', actionId: 'open-materials' },
            ],
        };
    })();

    // Step 3: Schedules & Zone Loads
    const step3 = (() => {
        if (missingScheds.length || inconsistentLoads.length) {
            return {
                id: 'schedules-loads',
                label: '3. Schedules & Zone Loads',
                status: 'warning',
                description: 'Some schedules or zone loads may be missing or inconsistent.',
                actions: [
                    { label: 'Open Schedules', actionId: 'open-schedules' },
                    { label: 'Open Zone Loads', actionId: 'open-zone-loads' },
                    { label: 'Diagnostics', actionId: 'open-diagnostics' },
                ],
            };
        }
        const hasZoneLoads = Array.isArray(ep.zoneLoads) && ep.zoneLoads.length > 0;
        return {
            id: 'schedules-loads',
            label: '3. Schedules & Zone Loads',
            status: hasZoneLoads ? 'ok' : 'warning',
            description: hasZoneLoads
                ? 'Zone loads and schedules configured.'
                : 'No explicit zone loads defined. Results may under-estimate internal gains.',
            actions: [
                { label: 'Open Schedules', actionId: 'open-schedules' },
                { label: 'Open Zone Loads', actionId: 'open-zone-loads' },
            ],
        };
    })();

    // Step 4: Thermostats & Ideal Loads
    const step4 = (() => {
        const hasThermostats = Array.isArray(ep.thermostats) && ep.thermostats.length > 0;
        const hasIdealLoads =
            (ep.idealLoads && ep.idealLoads.global) ||
            (ep.idealLoads && Array.isArray(ep.idealLoads.perZone) && ep.idealLoads.perZone.length > 0);

        if (hasThermostats && hasIdealLoads) {
            return {
                id: 'thermostats-ideal-loads',
                label: '4. Thermostats & Ideal Loads',
                status: 'ok',
                description: 'Thermostats and IdealLoads configured. HVAC modeled via IdealLoads.',
                actions: [{ label: 'Thermostats & IdealLoads', actionId: 'open-ideal-loads' }],
            };
        }

        return {
            id: 'thermostats-ideal-loads',
            label: '4. Thermostats & Ideal Loads',
            status: 'warning',
            description:
                'No complete thermostat/IdealLoads configuration detected. Zones may free-float or be unconstrained.',
            actions: [{ label: 'Thermostats & IdealLoads', actionId: 'open-ideal-loads' }],
        };
    })();

    // Step 5: Weather & Location
    const step5 = (() => {
        const actions = [{ label: 'Weather & Location', actionId: 'open-weather-location' }];

        if (!epwPath) {
            return {
                id: 'weather-location',
                label: '5. Weather & Location',
                status: 'error',
                description:
                    'No EPW selected. Annual/design-day simulations cannot run reliably without a project EPW.',
                actions,
            };
        }

        if (locationSource === 'Custom' && !validateCustomLocation()) {
            return {
                id: 'weather-location',
                label: '5. Weather & Location',
                status: 'error',
                description: 'Custom location selected but fields are incomplete or invalid.',
                actions,
            };
        }

        return {
            id: 'weather-location',
            label: '5. Weather & Location',
            status: 'ok',
            description:
                locationSource === 'Custom'
                    ? 'EPW set and custom location defined.'
                    : 'EPW set. Location derived from EPW.',
            actions,
        };
    })();

    // Step 6: IDF Generation readiness
    const step6 = (() => {
        if (hasFatalIssues || missingCons.length || missingMats.length) {
            return {
                id: 'idf-generation',
                label: '6. IDF Generation',
                status: 'error',
                description:
                    'Diagnostics report blocking issues (e.g., missing constructions/materials). Fix before generating IDF.',
                actions: [
                    { label: 'Diagnostics', actionId: 'open-diagnostics' },
                    { label: 'Generate IDF', actionId: 'generate-idf' },
                ],
            };
        }

        if (hasWarnings || missingScheds.length || inconsistentLoads.length) {
            return {
                id: 'idf-generation',
                label: '6. IDF Generation',
                status: 'warning',
                description:
                    'IDF can be generated, but diagnostics report warnings (e.g., schedules/loads). Review before final runs.',
                actions: [
                    { label: 'Diagnostics', actionId: 'open-diagnostics' },
                    { label: 'Generate IDF', actionId: 'generate-idf' },
                ],
            };
        }

        return {
            id: 'idf-generation',
            label: '6. IDF Generation',
            status: 'ok',
            description: 'Configuration is consistent. Generate IDF from the current project.',
            actions: [{ label: 'Generate IDF', actionId: 'generate-idf' }],
        };
    })();

    // Step 7: Run EnergyPlus readiness
    const step7 = (() => {
        const actions = [
            { label: 'Annual', actionId: 'open-annual' },
            { label: 'Heating DD', actionId: 'open-heating-dd' },
            { label: 'Cooling DD', actionId: 'open-cooling-dd' },
        ];

        if (!epwPath) {
            return {
                id: 'run-energyplus',
                label: '7. Run EnergyPlus',
                status: 'error',
                description: 'Cannot run: EPW is missing. Configure in Weather & Location.',
                actions: [{ label: 'Weather & Location', actionId: 'open-weather-location' }],
            };
        }

        if (hasFatalIssues || missingCons.length || missingMats.length) {
            return {
                id: 'run-energyplus',
                label: '7. Run EnergyPlus',
                status: 'error',
                description: 'Cannot run safely: diagnostics report blocking IDF issues.',
                actions: [
                    { label: 'Diagnostics', actionId: 'open-diagnostics' },
                    { label: 'Constructions', actionId: 'open-constructions' },
                    { label: 'Materials', actionId: 'open-materials' },
                ],
            };
        }

        const isElectron = typeof window !== 'undefined' && !!window.electronAPI;

        if (!isElectron) {
            return {
                id: 'run-energyplus',
                label: '7. Run EnergyPlus',
                status: 'warning',
                description:
                    'Electron bridge not detected. You can generate IDF/scripts but cannot run EnergyPlus directly here.',
                actions: [
                    { label: 'Annual', actionId: 'open-annual' },
                    { label: 'Heating DD', actionId: 'open-heating-dd' },
                    { label: 'Cooling DD', actionId: 'open-cooling-dd' },
                ],
            };
        }

        return {
            id: 'run-energyplus',
            label: '7. Run EnergyPlus',
            status: hasWarnings ? 'warning' : 'ok',
            description: hasWarnings
                ? 'Ready to run via Electron; diagnostics report warnings to review.'
                : 'Ready to run EnergyPlus via Electron recipes.',
            actions,
        };
    })();

    return [step1, step2, step3, step4, step5, step6, step7];
}

function renderSimulationChecklist(container) {
    container.innerHTML = `
        <div class="text-xs text-[--text-secondary]">
            Evaluating project configuration...
        </div>
    `;

    computeSimulationChecklist()
        .then((items) => {
            if (!items || !items.length) {
                container.innerHTML = `
                    <div class="text-xs text-red-400">
                        Failed to evaluate checklist.
                    </div>
                `;
                return;
            }

            const icon = (status) => {
                const baseClasses = "inline-block w-2.5 h-2.5 rounded-full mr-2 flex-shrink-0";
                if (status === 'ok') return `<span class="${baseClasses} bg-emerald-500"></span>`;
                if (status === 'warning') return `<span class="${baseClasses} bg-yellow-400"></span>`;
                return `<span class="${baseClasses} bg-red-500"></span>`;
            };

            const html = items
                .map((item) => {
                    const actions =
                        item.actions && item.actions.length
                            ? item.actions
                                  .map(
                                      (a) =>
                                          `<button class="btn btn-xxs btn-secondary ml-1" data-checklist-action="${a.actionId}">${a.label}</button>`
                                  )
                                  .join('')
                            : '';
                    return `
                        <div class="flex flex-col py-1.5 border-b border-gray-700/50 last:border-b-0">
                            <div class="flex items-center justify-between">
                                <div class="flex items-center min-w-0">
                                    ${icon(item.status)}
                                    <span class="font-semibold text-xs truncate">${item.label}</span>
                                </div>
                                <div class="flex items-center flex-shrink-0 ml-2">${actions}</div>
                            </div>
                            <div class="text-xs text-[--text-secondary] pl-[18px] pt-0.5">
                                ${item.description || ''}
                            </div>
                        </div>
                    `;
                })
                .join('');

            container.innerHTML = html;
        })
        .catch((err) => {
            console.error('SimulationChecklist: render failed', err);
            container.innerHTML = `
                <div class="text-xs text-red-400">
                    Failed to evaluate checklist. Check console for details.
                </div>
            `;
        });
}

function populateRecipeList() {
    const recipeList = dom['panel-energyplus']?.querySelector('.recipe-list');
    if (!recipeList) return;

    recipeList.innerHTML = '';
    for (const name in recipes) {
        const recipe = recipes[name];
        const button = document.createElement('button');
        button.className = 'btn btn-sm btn-secondary w-full text-left p-2';
        button.innerHTML = `
            <div class="font-semibold">${name}</div>
            <div class="text-[11px] font-normal normal-case text-[--text-secondary] whitespace-normal">${recipe.description}</div>
        `;
        button.onclick = () => {
            if (recipe.isDiagnostics) {
                openDiagnosticsPanel();
            } else {
                openRecipePanel(recipe);
            }
        };
        recipeList.appendChild(button);
    }
}

function openRecipePanel(recipe) {
    const panelId = `panel-${recipe.id}`;
    let panel = document.getElementById(panelId);
    if (!panel) {
        panel = createRecipePanel(recipe);
        document.getElementById('window-container').appendChild(panel);
    }
    panel.classList.remove('hidden');
    panel.style.zIndex = getNewZIndex();
}

async function openDiagnosticsPanel() {
    const panelId = 'panel-energyplus-diagnostics';
    let panel = document.getElementById(panelId);
    if (!panel) {
        panel = createDiagnosticsPanel();
        document.getElementById('window-container').appendChild(panel);
    }
    panel.classList.remove('hidden');
    panel.style.zIndex = getNewZIndex();
    await refreshDiagnosticsPanel(panel);
}

function createDiagnosticsPanel() {
    const panel = document.createElement('div');
    panel.id = 'panel-energyplus-diagnostics';
    panel.className = 'floating-window ui-panel resizable-panel';

    panel.innerHTML = `
        <div class="window-header">
            <span>EnergyPlus IDF Preview / Diagnostics</span>
            <div class="window-controls">
                <div class="window-icon-max" title="Maximize/Restore"></div>
                <div class="collapse-icon" title="Minimize"></div>
                <div class="window-icon-close" title="Close"></div>
            </div>
        </div>
        <div class="window-content space-y-3 text-[9px]">
            <div class="resize-handle-edge top"></div>
            <div class="resize-handle-edge right"></div>
            <div class="resize-handle-edge bottom"></div>
            <div class="resize-handle-edge left"></div>
            <div class="resize-handle-corner top-left"></div>
            <div class="resize-handle-corner top-right"></div>
            <div class="resize-handle-corner bottom-left"></div>
            <div class="resize-handle-corner bottom-right"></div>

            <p class="info-box !text-[9px] !py-1.5 !px-2">
                Preview how the current Ray-Modeler project and EnergyPlus configuration map into EnergyPlus objects.
                This diagnostics view does not modify your project or write files.
            </p>

            <div class="flex justify-between items-center gap-2">
                <span class="font-semibold text-[9px] uppercase text-[--text-secondary]">
                    Summary
                </span>
                <button class="btn btn-xxs btn-secondary" data-action="refresh-diagnostics">
                    Refresh
                </button>
            </div>

            <div class="border border-gray-700/70 rounded bg-black/40 p-2 space-y-1 max-h-72 overflow-y-auto **scrollable-panel-inner**"
                 data-role="diagnostics-body">
                <div class="text-[8px] text-[--text-secondary]">
                    Diagnostics will appear here.
                </div>
            </div>

            <div class="text-[8px] text-[--text-secondary]">
                Use this panel to:
                <ul class="list-disc pl-4 space-y-0.5">
                    <li>Verify that zones are detected.</li>
                    <li>Check constructions and materials are defined and referenced correctly.</li>
                    <li>Check schedules and loads for missing references.</li>
                    <li>Jump directly to configuration panels to fix detected issues.</li>
                </ul>
            </div>
        </div>
    `;

    if (typeof window !== 'undefined' && window.initializePanelControls) {
        window.initializePanelControls(panel);
    } else {
        const closeButton = panel.querySelector('.window-icon-close');
        if (closeButton) {
            closeButton.onclick = () => panel.classList.add('hidden');
        }
    }

    const refreshBtn = panel.querySelector('[data-action="refresh-diagnostics"]');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
            await refreshDiagnosticsPanel(panel);
        });
    }

    return panel;
}

async function refreshDiagnosticsPanel(panel) {
    const body = panel.querySelector('[data-role="diagnostics-body"]');
    if (!body) return;

    body.innerHTML = `
        <div class="text-[8px] text-[--text-secondary]">
            Gathering diagnostics from current project...
        </div>
    `;

    try {
        const { generateEnergyPlusDiagnostics } = await import('./energyplus.js');
        const diagnostics = await generateEnergyPlusDiagnostics();

        renderDiagnostics(body, diagnostics);
    } catch (err) {
        console.error('EnergyPlus Diagnostics: failed to load diagnostics', err);
        body.innerHTML = `
            <div class="text-[8px] text-red-400">
                Failed to compute diagnostics. Check console for details.
            </div>
        `;
    }
}

function renderDiagnostics(container, diagnostics) {
    if (!diagnostics) {
        container.innerHTML = `
            <div class="text-[8px] text-red-400">
                No diagnostics data returned.
            </div>
        `;
        return;
    }

    const { geometry, constructions, materials, schedulesAndLoads, issues } = diagnostics;

    const hasErrors = (issues || []).some((i) => i.severity === 'error');
    const hasWarnings = (issues || []).some((i) => i.severity === 'warning');

    const issueBadge = hasErrors
        ? `<span class="ml-1 px-1 rounded bg-red-600/70 text-[7px]">Errors</span>`
        : hasWarnings
        ? `<span class="ml-1 px-1 rounded bg-yellow-600/70 text-[7px]">Warnings</span>`
        : `<span class="ml-1 px-1 rounded bg-emerald-700/70 text-[7px]">Clean</span>`;

    const zonesHtml = (geometry?.zones || [])
        .map(
            (z) => `
            <tr>
                <td class="px-1 py-0.5 align-top">${z.name}</td>
                <td class="px-1 py-0.5 align-top text-[--text-secondary]">
                    ${z.surfaces?.total ?? 0}
                </td>
                <td class="px-1 py-0.5 align-top text-[--text-secondary]">
                    ${z.windows?.total ?? 0}
                </td>
            </tr>
        `
        )
        .join('') ||
        `<tr><td class="px-1 py-0.5 text-[--text-secondary]" colspan="3">
            No zones detected. Generated IDF will fall back to a single Zone_1.
        </td></tr>`;

    const missingCons = constructions?.missingConstructions || [];
    const unusedCons = constructions?.unusedConstructions || [];
    const missingMats = materials?.missingMaterials || [];
    const unusedMats = materials?.unusedMaterials || [];
    const missingScheds = schedulesAndLoads?.missingSchedules || [];
    const inconsistentLoads = schedulesAndLoads?.inconsistentLoads || [];

    const issuesHtml =
        issues && issues.length
            ? issues
                  .map((i) => {
                      const color =
                          i.severity === 'error'
                              ? 'text-red-400'
                              : i.severity === 'warning'
                              ? 'text-yellow-300'
                              : 'text-[--text-secondary]';
                      return `<div class="${color}">• [${i.severity}] ${i.message}</div>`;
                  })
                  .join('')
            : `<div class="text-[8px] text-[--text-secondary]">No issues detected.</div>`;

    const button = (label, action) =>
        `<button class="btn btn-xxs btn-secondary ml-1" data-nav="${action}">${label}</button>`;

    container.innerHTML = `
        <div class="space-y-2">
            <div class="flex items-center justify-between">
                <div>
                    <span class="font-semibold text-[9px] uppercase text-[--text-secondary]">
                        Overall Status
                    </span>
                    ${issueBadge}
                </div>
            </div>

            <div class="border border-gray-700/70 rounded bg-black/40 p-2 space-y-1">
                <div class="font-semibold text-[8px] uppercase text-[--text-secondary]">
                    Geometry
                </div>
                <div class="text-[8px] text-[--text-secondary] mb-1">
                    Zones detected: ${geometry?.totals?.zones ?? 0}
                </div>
                <table class="w-full text-[8px]">
                    <thead class="bg-black/40">
                        <tr>
                            <th class="px-1 py-0.5 text-left">Zone</th>
                            <th class="px-1 py-0.5 text-left">Surfaces*</th>
                            <th class="px-1 py-0.5 text-left">Windows*</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${zonesHtml}
                    </tbody>
                </table>
                <div class="text-[7px] text-[--text-secondary] mt-0.5">
                    *Surface/window counts are placeholders until explicit geometry mapping is exposed.
                </div>
            </div>

            <div class="border border-gray-700/70 rounded bg-black/40 p-2 space-y-1">
                <div class="flex items-center justify-between">
                    <div class="font-semibold text-[8px] uppercase text-[--text-secondary]">
                        Constructions & Materials
                    </div>
                    <div class="flex items-center">
                        ${(missingCons.length || missingMats.length)
                            ? button('Open Constructions', 'constructions') +
                              button('Open Materials', 'materials')
                            : ''}
                    </div>
                </div>
                <div class="text-[8px]">
                    ${missingCons.length
                        ? `<div class="text-red-400">Missing constructions: ${missingCons
                              .map((n) => `<code>${n}</code>`)
                              .join(', ')}</div>`
                        : `<div class="text-[--text-secondary]">No missing constructions.</div>`}
                    ${unusedCons.length
                        ? `<div class="text-[--text-secondary]">Unused constructions: ${unusedCons
                              .slice(0, 10)
                              .map((n) => `<code>${n}</code>`)
                              .join(', ')}${unusedCons.length > 10 ? '…' : ''}</div>`
                        : ''}
                    ${missingMats.length
                        ? `<div class="text-red-400">Missing materials (referenced but not defined): ${missingMats
                              .map((n) => `<code>${n}</code>`)
                              .join(', ')}</div>`
                        : `<div class="text-[--text-secondary]">No missing materials referenced by constructions.</div>`}
                    ${unusedMats.length
                        ? `<div class="text-[--text-secondary]">Unused materials: ${unusedMats
                              .slice(0, 10)
                              .map((n) => `<code>${n}</code>`)
                              .join(', ')}${unusedMats.length > 10 ? '…' : ''}</div>`
                        : ''}
                </div>
            </div>

            <div class="border border-gray-700/70 rounded bg-black/40 p-2 space-y-1">
                <div class="flex items-center justify-between">
                    <div class="font-semibold text-[8px] uppercase text-[--text-secondary]">
                        Schedules & Loads
                    </div>
                    <div class="flex items-center">
                        ${missingScheds.length || inconsistentLoads.length
                            ? button('Open Schedules', 'schedules') +
                              button('Open Zone Loads', 'zone-loads')
                            : ''}
                    </div>
                </div>
                <div class="text-[8px]">
                    ${missingScheds.length
                        ? `<div class="text-yellow-300">Missing schedules: ${missingScheds
                              .map((n) => `<code>${n}</code>`)
                              .join(', ')}</div>`
                        : `<div class="text-[--text-secondary]">No missing schedules referenced by loads/controls.</div>`}
                    ${inconsistentLoads.length
                        ? `<div class="mt-1 text-[8px] text-yellow-300">
                               ${inconsistentLoads
                                   .slice(0, 20)
                                   .map(
                                       (e) =>
                                           `• [${e.zone}] ${e.issue}`
                                   )
                                   .join('<br>')}
                               ${
                                   inconsistentLoads.length > 20
                                       ? '<br>…'
                                       : ''
                               }
                           </div>`
                        : ''}
                </div>
            </div>

            <div class="border border-gray-700/70 rounded bg-black/40 p-2 space-y-1">
                <div class="font-semibold text-[8px] uppercase text-[--text-secondary]">
                    Issues
                </div>
                <div class="text-[8px]">
                    ${issuesHtml}
                </div>
            </div>
        </div>
    `;

    // Wire quick navigation buttons
    container
        .querySelectorAll('button[data-nav]')
        .forEach((btn) => {
            btn.addEventListener('click', (ev) => {
                const nav = ev.currentTarget.getAttribute('data-nav');
                if (nav === 'materials') {
                    openMaterialsManagerPanel();
                } else if (nav === 'constructions') {
                    openConstructionsManagerPanel();
                } else if (nav === 'schedules') {
                    openSchedulesManagerPanel();
                } else if (nav === 'zone-loads') {
                    openZoneLoadsManagerPanel();
                }
            });
        });
}

function createRecipePanel(recipe) {
    const panel = document.createElement('div');
    panel.id = `panel-${recipe.id}`;
    panel.className = 'floating-window ui-panel resizable-panel';
    panel.dataset.scriptName = recipe.scriptName;

    let paramsHtml = '';
    recipe.params.forEach((param) => {
        paramsHtml += `
            <div>
                <label class="label" for="${param.id}">${param.name}</label>
                <input type="${param.type}" id="${param.id}" ${param.accept ? `accept="${param.accept}"` : ''} class="w-full text-sm">
            </div>
        `;
    });

    const isAnnual = recipe.id === 'annual-energy-simulation';
    const isHeating = recipe.id === 'heating-design-day';
    const isCooling = recipe.id === 'cooling-design-day';

    // Helper: read current project-level EPW from metadata
    function getProjectEpwPath() {
        try {
            const meta =
                (typeof project.getMetadata === 'function' && project.getMetadata()) ||
                project.metadata ||
                {};
            const ep = meta.energyPlusConfig || meta.energyplus || {};
            const weather = ep.weather || {};
            return weather.epwPath || ep.weatherFilePath || null;
        } catch (e) {
            console.warn('EnergyPlus: failed to read project-level EPW', e);
            return null;
        }
    }

    function getRunName() {
        if (isAnnual) return 'annual';
        if (isHeating) return 'heating-design';
        if (isCooling) return 'cooling-design';
        return recipe.id || 'custom';
    }

    panel.innerHTML = `
        <div class="window-header">
            <span>${recipe.name || 'EnergyPlus Simulation'}</span>
            <div class="window-controls">
                <div class="window-icon-max" title="Maximize/Restore"></div>
                <div class="collapse-icon" title="Minimize"></div>
                <div class="window-icon-close" title="Close"></div>
            </div>
        </div>
        <div class="window-content space-y-4">
            <div class="resize-handle-edge top"></div>
            <div class="resize-handle-edge right"></div>
            <div class="resize-handle-edge bottom"></div>
            <div class="resize-handle-edge left"></div>
            <div class="resize-handle-corner top-left"></div>
            <div class="resize-handle-corner top-right"></div>
            <div class="resize-handle-corner bottom-left"></div>
            <div class="resize-handle-corner bottom-right"></div>
            <p class="info-box !text-xs !py-2 !px-3">${recipe.description}</p>
            ${
                isAnnual
                    ? `
            <button class="btn btn-secondary w-full" data-action="generate-idf-from-project">
                Generate IDF from current Ray-Modeler project
            </button>
            <p class="text-[9px] text-[--text-secondary] mt-1">
                Uses the current <code>energyPlusConfig</code> to write <code>model.idf</code>.
                Configure Materials, Constructions, Schedules, Zone Loads, Thermostats & IdealLoads, Daylighting, Outputs, and Simulation Control in the sidebar.
            </p>
            `
                    : ''
            }
            ${paramsHtml}
            ${
                isAnnual
                    ? `
            <div class="text-[8px] text-[--text-secondary]">
                Project EPW: <span data-role="project-epw-label">(resolving...)</span>
            </div>
            `
                    : ''
            }
            ${
                isHeating || isCooling
                    ? `
            <p class="text-[8px] text-[--text-secondary]">
                This recipe reuses the selected IDF (or <code>model.idf</code> by default).
                Ensure your <code>SimulationControl</code> and <code>SizingPeriod</code> objects in the IDF represent the desired design-day conditions.
                EnergyPlus is run in a dedicated <code>runs/${isHeating ? 'heating-design' : 'cooling-design'}</code> directory via the Electron bridge.
            </p>
            `
                    : ''
            }
            <div class="space-y-2">
                <button class="btn btn-primary w-full" data-action="run">Run Simulation</button>
            </div>
            <div class="mt-3">
                <h5 class="font-semibold text-[10px] uppercase text-[--text-secondary] mb-1">EnergyPlus Output</h5>
                <pre class="simulation-output-console w-full h-32 font-mono text-[10px] p-2 rounded bg-[--grid-color] border border-gray-500/50 overflow-y-auto whitespace-pre-wrap"></pre>
            </div>
        </div>
    `;

    // Initialize standard floating window behavior (drag, resize, close/max/min)
    if (typeof window !== 'undefined' && window.initializePanelControls) {
        window.initializePanelControls(panel);
    } else {
        const closeButton = panel.querySelector('.window-icon-close');
        if (closeButton) {
            closeButton.onclick = () => panel.classList.add('hidden');
        }
    }

    // Wire actions
    const generateBtn = panel.querySelector('[data-action="generate-idf-from-project"]');
    const runBtn = panel.querySelector('[data-action="run"]');
    const outputConsole = panel.querySelector('.simulation-output-console');
    const projectEpwLabel = panel.querySelector('[data-role="project-epw-label"]');

    if (isAnnual && projectEpwLabel) {
        const epw = getProjectEpwPath();
        projectEpwLabel.textContent = epw || '(not set)';
    }

    // Lazy import to avoid circular deps on load
    if (generateBtn) {
        generateBtn.addEventListener('click', async () => {
            try {
                const { generateAndStoreIdf } = await import('./energyplus.js');
                const idfContent = await generateAndStoreIdf();
                if (outputConsole) {
                    outputConsole.textContent = 'IDF generated and stored as model.idf\n';
                }
            } catch (err) {
                console.error('EnergyPlus: failed to generate IDF from project', err);
                if (outputConsole) {
                    outputConsole.textContent += `Error generating IDF: ${err.message}\n`;
                }
                alert('Failed to generate IDF from project. Check console for details.');
            }
        });
    }


    if (runBtn) {
        // Per-panel listeners to avoid leaks; scoped to this recipe panel.
        let epOutputListener = null;
        let epExitListener = null;

        runBtn.addEventListener('click', () => {
            if (!window.electronAPI) {
                if (outputConsole) {
                    outputConsole.textContent +=
                        'Electron environment not detected. Please run via Electron or use the generated IDF/scripts.\n';
                }
                alert(
                    'EnergyPlus can only be run directly inside the Electron app. In browser, use the generated IDF/scripts manually.'
                );
                return;
            }

            const idfInput = panel.querySelector('#idf-file');
            const epwInput = panel.querySelector('#epw-file');
            const exeInput = panel.querySelector('#eplus-exe');

            const idfPath =
                idfInput &&
                idfInput.files &&
                idfInput.files[0]
                    ? idfInput.files[0].path || idfInput.files[0].name
                    : 'model.idf'; // fallback: use generated IDF in project folder

            // EPW resolution for all recipes:
            // 1) Explicit EPW selected in this panel (if present)
            // 2) Project-level EPW from energyPlusConfig.weather.epwPath / weatherFilePath
            const explicitEpw =
                epwInput &&
                epwInput.files &&
                epwInput.files[0]
                    ? epwInput.files[0].path || epwInput.files[0].name
                    : null;

            const projectEpw = getProjectEpwPath();
            const epwPath = explicitEpw || projectEpw || null;

            const energyPlusPath =
                exeInput && exeInput.value
                    ? exeInput.value.trim()
                    : null;

            // For annual and design-day recipes, we require EPW to keep behavior explicit.
            if (!epwPath) {
                alert(
                    'No EPW specified. Select an EPW here or configure a project-level EPW in the "Weather & Location" panel.'
                );
                return;
            }

            if (!energyPlusPath) {
                alert('Specify the EnergyPlus executable path.');
                return;
            }

            const runName = getRunName();
            const runId = `${runName}-${Date.now()}`;

            // Pre-run validation (no Electron call if blocking issues exist)
            const preRun = validateEnergyPlusRunRequest({
                idfPath,
                epwPath,
                energyPlusPath,
                recipeId: recipe.id,
            });

            if (!preRun.ok) {
                const summary = formatIssuesSummary(preRun.issues, 4);
                if (outputConsole) {
                    outputConsole.textContent +=
                        'Pre-run validation failed:\n' +
                        (summary ||
                            'Blocking configuration issues detected.') +
                        '\n\n';
                    outputConsole.scrollTop =
                        outputConsole.scrollHeight;
                }
                alert(
                    'Cannot start EnergyPlus run due to configuration issues.\n\n' +
                        (summary ||
                            'Check the EnergyPlus sidebar configuration and diagnostics.')
                );
                return;
            }

            // Register run in resultsManager (status: pending)
            resultsManager.registerEnergyPlusRun(runId, {
                label: `EnergyPlus ${runName}`,
                recipeId: recipe.id,
            });

            if (outputConsole) {
                outputConsole.textContent =
                    `Running EnergyPlus [${runName}]...\n` +
                    `IDF: ${idfPath}\n` +
                    `EPW: ${epwPath}\n` +
                    `Exe: ${energyPlusPath}\n` +
                    `Outputs: runs/${runName}/ (if supported by Electron bridge)\n\n`;
            }

            // Clean up any previous listeners for this panel to avoid leaks.
            if (
                window.electronAPI.offEnergyPlusOutput &&
                epOutputListener
            ) {
                window.electronAPI.offEnergyPlusOutput(
                    epOutputListener
                );
                epOutputListener = null;
            }
            if (
                window.electronAPI.offEnergyPlusExit &&
                epExitListener
            ) {
                window.electronAPI.offEnergyPlusExit(epExitListener);
                epExitListener = null;
            }

            // Run EnergyPlus via Electron bridge.
            // See preload.js for full contract; main should:
            // - Use runName/runId to choose output directory, e.g. runs/annual, runs/heating-design.
            // - Invoke: energyplus -w epwPath -d runs/runName -r idfPath
            // - Stream stdout/stderr to 'energyplus-output'; send 'energyplus-exit' on completion.
            const runOptions = {
                idfPath,
                epwPath,
                energyPlusPath,
                runName,
                runId, // Used by ResultsManager and for filtering logs
            };

            window.electronAPI.runEnergyPlus(runOptions);

            // Output handler, tolerant to both structured and legacy payloads.
            const handleOutput = (payload) => {
                if (!outputConsole) return;

                let text = '';
                if (
                    payload &&
                    typeof payload === 'object' &&
                    typeof payload.chunk === 'string'
                ) {
                    // New structured form: filter by runId if provided.
                    if (
                        payload.runId &&
                        payload.runId !== runId
                    ) {
                        return;
                    }
                    text = payload.chunk;
                } else {
                    // Legacy: plain string.
                    text = String(payload ?? '');
                }

                if (!text) return;
                outputConsole.textContent += text;
                outputConsole.scrollTop =
                    outputConsole.scrollHeight;
            };

            // Exit handler, tolerant to both structured and legacy payloads.
            const handleExit = (payload) => {
                // Ignore events for other runs if runId is present.
                if (
                    payload &&
                    typeof payload === 'object' &&
                    payload.runId &&
                    payload.runId !== runId
                ) {
                    return;
                }

                const code =
                    typeof payload === 'object' &&
                    payload !== null
                        ? typeof payload.exitCode === 'number'
                            ? payload.exitCode
                            : 0
                        : typeof payload === 'number'
                        ? payload
                        : 0;

                const resolvedRunId =
                    (payload &&
                        typeof payload === 'object' &&
                        payload.runId) ||
                    runId;

                const baseDir =
                    payload &&
                    typeof payload === 'object'
                        ? payload.outputDir
                        : undefined;

                const errContent =
                    payload &&
                    typeof payload === 'object'
                        ? payload.errContent
                        : undefined;

                const csvContents =
                    payload &&
                    typeof payload === 'object'
                        ? payload.csvContents
                        : undefined;

                const runRecord =
                    resultsManager.parseEnergyPlusResults(
                        resolvedRunId,
                        {
                            baseDir,
                            errContent,
                            csvContents,
                            statusFromRunner: code,
                        }
                    );

                if (outputConsole) {
                    outputConsole.textContent +=
                        `\n--- EnergyPlus exited with code: ${code} ---\n`;

                    if (runRecord && runRecord.errors) {
                        const {
                            fatal,
                            severe,
                            warning,
                        } = runRecord.errors;
                        const lines = [];
                        if (fatal.length) {
                            lines.push(
                                `Fatal errors: ${fatal.length}`
                            );
                            lines.push(fatal[0]);
                        }
                        if (severe.length) {
                            lines.push(
                                `Severe errors: ${severe.length}`
                            );
                            if (!fatal.length) {
                                lines.push(severe[0]);
                            }
                        }
                        if (warning.length) {
                            lines.push(
                                `Warnings: ${warning.length}`
                            );
                        }
                        if (lines.length) {
                            outputConsole.textContent +=
                                lines.join('\n') + '\n';
                        }
                    }

                    outputConsole.scrollTop =
                        outputConsole.scrollHeight;
                }

                // Auto-detach listeners on completion when off* is available.
                if (
                    window.electronAPI.offEnergyPlusOutput &&
                    epOutputListener
                ) {
                    window.electronAPI.offEnergyPlusOutput(
                        epOutputListener
                    );
                    epOutputListener = null;
                }
                if (
                    window.electronAPI.offEnergyPlusExit &&
                    epExitListener
                ) {
                    window.electronAPI.offEnergyPlusExit(
                        epExitListener
                    );
                    epExitListener = null;
                }
            };

            // Attach listeners (prefer structured helpers; fallback to legacy).
            if (window.electronAPI.onEnergyPlusOutput) {
                epOutputListener =
                    window.electronAPI.onEnergyPlusOutput(
                        handleOutput
                    );
            }

            if (window.electronAPI.onceEnergyPlusExit) {
                epExitListener =
                    window.electronAPI.onceEnergyPlusExit(
                        handleExit
                    );
            } else if (
                window.electronAPI.onEnergyPlusExit
            ) {
                epExitListener =
                    window.electronAPI.onEnergyPlusExit(
                        handleExit
                    );
            }
        });
    }

    return panel;
}

/**
 * ENERGYPLUS MATERIALS MANAGER
 * OpenStudio-style JS-only manager for meta.energyPlusConfig.materials.
 *
 * - Lists materials from project metadata (energyPlusConfig.materials || []).
 * - Supports types: Material, Material:NoMass, WindowMaterial:SimpleGlazingSystem.
 * - Add / Edit via inline form.
 * - Delete is blocked if material is referenced by any construction.layers.
 */
function openMaterialsManagerPanel() {
    const panelId = 'panel-energyplus-materials';
    let panel = document.getElementById(panelId);
    if (!panel) {
        panel = createMaterialsManagerPanel();
        document.getElementById('window-container').appendChild(panel);
    }
    panel.classList.remove('hidden');
    panel.style.zIndex = getNewZIndex();
}

/**
 * Safely get current metadata and normalized EnergyPlus config.
 */
function getEnergyPlusConfig() {
    const meta =
        (typeof project.getMetadata === 'function' && project.getMetadata()) ||
        project.metadata ||
        {};
    const ep = meta.energyPlusConfig || meta.energyplus || {};
    const materials = Array.isArray(ep.materials) ? ep.materials.slice() : [];
    const constructions = Array.isArray(ep.constructions)
        ? ep.constructions
        : [];
    return { meta, ep, materials, constructions };
}

function saveEnergyPlusConfig(meta, ep) {
    const next = {
        ...ep,
    };
    if (typeof project.updateMetadata === 'function') {
        project.updateMetadata({
            ...meta,
            energyPlusConfig: next,
        });
    } else {
        project.metadata = {
            ...(project.metadata || meta),
            energyPlusConfig: next,
        };
    }
}

function createMaterialsManagerPanel() {
    const panel = document.createElement('div');
    panel.id = 'panel-energyplus-materials';
    panel.className = 'floating-window ui-panel resizable-panel';

    panel.innerHTML = `
        <div class="window-header">
            <span>EnergyPlus Materials</span>
            <!-- Help button removed -->
            <div class="window-controls">
                <div class="window-icon-max" title="Maximize/Restore"></div>
                <div class="collapse-icon" title="Minimize"></div>
                <div class="window-icon-close" title="Close"></div>
            </div>
        </div>
        <div class="window-content space-y-2">
            <div class="resize-handle-edge top"></div>
            <div class="resize-handle-edge right"></div>
            <div class="resize-handle-edge bottom"></div>
            <div class="resize-handle-edge left"></div>
            <div class="resize-handle-corner top-left"></div>
            <div class="resize-handle-corner top-right"></div>
            <div class="resize-handle-corner bottom-left"></div>
            <div class="resize-handle-corner bottom-right"></div>
            <p class="info-box !text-[10px] !py-1.5 !px-2">
                Manage EnergyPlus materials used in generated IDF files.
                Entries are stored in <code>energyPlusConfig.materials</code>.
            </p>
            <div class="flex justify-between items-center gap-2">
                <span class="font-semibold text-[10px] uppercase text-[--text-secondary]">Materials</span>
                <button class="btn btn-xs btn-secondary" data-action="add-material">+ Add Material</button>
                </div>
                <div class="border border-gray-700/70 rounded bg-black/40 max-h-64 overflow-y-auto **scrollable-panel-inner**">
                    <table class="w-full text-[9px] materials-table">
                        <thead>
                        <tr class="bg-black/40">
                            <th class="px-2 py-1 text-left">Name</th>
                            <th class="px-2 py-1 text-left">Type</th>
                            <th class="px-2 py-1 text-left">Summary</th>
                            <th class="px-2 py-1 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody class="materials-tbody"></tbody>
                </table>
            </div>
            <div class="text-[9px] text-[--text-secondary]">
                Note: You cannot delete materials referenced by EnergyPlus constructions.
            </div>
        </div>
    `;

    if (typeof window !== 'undefined' && window.initializePanelControls) {
        window.initializePanelControls(panel);
    } else {
        const closeButton = panel.querySelector('.window-icon-close');
        if (closeButton) {
            closeButton.onclick = () => panel.classList.add('hidden');
        }
    }

    const tbody = panel.querySelector('.materials-tbody');
    const helpBtn = panel.querySelector('[data-action="open-help-materials"]');
    // Sidebar Materials help button disabled
    // if (helpBtn) {
    //     helpBtn.addEventListener('click', () => openHelpPanel('config/materials'));
    // }
    const addBtn = panel.querySelector('[data-action="add-material"]');

    function render() {
        const { materials, constructions } = getEnergyPlusConfig();
        tbody.innerHTML = '';
        if (!materials.length) {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="px-2 py-1 text-[9px] text-[--text-secondary]" colspan="4">
                    No custom materials defined. Built-in RM_* materials are always available.
                </td>
            `;
            tbody.appendChild(tr);
            return;
        }

        materials.forEach((m, index) => {
            const tr = document.createElement('tr');
            const summary = getMaterialSummary(m);
            tr.innerHTML = `
                <td class="px-2 py-1 align-top">${m.name || ''}</td>
                <td class="px-2 py-1 align-top">${m.type || 'Material'}</td>
                <td class="px-2 py-1 align-top text-[8px] text-[--text-secondary]">${summary}</td>
                <td class="px-2 py-1 align-top text-right">
                    <button class="btn btn-xxs btn-secondary" data-action="edit" data-index="${index}">Edit</button>
                    <button class="btn btn-xxs btn-danger ml-1" data-action="delete" data-index="${index}">Delete</button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        // Wire row actions
        tbody.querySelectorAll('button[data-action="edit"]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.index, 10);
                openMaterialEditor(panel, idx);
            });
        });
        tbody.querySelectorAll('button[data-action="delete"]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.index, 10);
                deleteMaterial(idx, constructions);
                render();
            });
        });
    }

    function deleteMaterial(index, constructions) {
        const { meta, ep, materials } = getEnergyPlusConfig();
        const m = materials[index];
        if (!m) return;

        const inUse = Array.isArray(constructions)
            ? constructions.some((c) =>
                  Array.isArray(c.layers) &&
                  c.layers.some((ln) => String(ln) === String(m.name))
              )
            : false;

        if (inUse) {
            alert(
                `Cannot delete material "${m.name}": it is referenced by one or more constructions.`
            );
            return;
        }

        materials.splice(index, 1);
        saveEnergyPlusConfig(meta, { ...ep, materials });
    }

    if (addBtn) {
        addBtn.addEventListener('click', () => {
            openMaterialEditor(panel, null);
        });
    }

    // Initial render
    render();

    // Attach a reference for re-rendering from editor
    panel._renderMaterials = render;

    return panel;
}

function getMaterialSummary(m) {
    if (!m) return '';
    if (m.type === 'Material:NoMass') {
        return `R=${m.thermalResistance ?? '?'} m²K/W`;
    }
    if (m.type === 'WindowMaterial:SimpleGlazingSystem') {
        return `U=${m.uFactor ?? '?'} W/m²K, SHGC=${m.solarHeatGainCoeff ?? '?'}, Tv=${m.visibleTransmittance ?? '?'}`;
    }
    // Default Material
    const t = m.thickness ?? '?';
    const k = m.conductivity ?? '?';
    const d = m.density ?? '?';
    return `t=${t} m, k=${k} W/mK, ρ=${d} kg/m³`;
}

/**
 * Open a simple inline editor for creating/updating a material.
 * index === null → new material
 */
function openMaterialEditor(parentPanel, index) {
    const existing = getEnergyPlusConfig();
    const materials = existing.materials;
    const editing = index != null ? materials[index] : null;

    // Remove any existing editor
    let editor = parentPanel.querySelector('.materials-editor');
    if (editor) editor.remove();

    editor = document.createElement('div');
    editor.className =
        'materials-editor mt-2 p-2 border border-[--accent-color]/40 rounded bg-black/70 space-y-1 text-[9px]';

    const type = editing?.type || 'Material';
    const name = editing?.name || '';

    editor.innerHTML = `
        <div class="flex justify-between items-center gap-2">
            <span class="font-semibold text-[9px]">${index != null ? 'Edit Material' : 'Add Material'}</span>
            <button class="btn btn-xxs btn-secondary" data-action="close-editor">×</button>
        </div>
        <div class="grid grid-cols-2 gap-2 mt-1">
            <div>
                <label class="label !text-[8px]">Name</label>
                <input type="text" class="w-full text-[9px]" data-field="name" value="${name}">
            </div>
            <div>
                <label class="label !text-[8px]">Type</label>
                <select class="w-full text-[9px]" data-field="type">
                    <option value="Material"${type === 'Material' ? ' selected' : ''}>Material</option>
                    <option value="Material:NoMass"${type === 'Material:NoMass' ? ' selected' : ''}>Material:NoMass</option>
                    <option value="WindowMaterial:SimpleGlazingSystem"${
                        type === 'WindowMaterial:SimpleGlazingSystem' ? ' selected' : ''
                    }>WindowMaterial:SimpleGlazingSystem</option>
                </select>
            </div>
        </div>
        <div class="mt-1 space-y-1" data-fields-container></div>
        <div class="flex justify-end gap-2 mt-2">
            <button class="btn btn-xxs btn-secondary" data-action="save-material">Save</button>
        </div>
    `;

    const content = parentPanel.querySelector('.window-content');
    content.appendChild(editor);

    const fieldsContainer = editor.querySelector('[data-fields-container]');
    const typeSelect = editor.querySelector('[data-field="type"]');
    const closeBtn = editor.querySelector('[data-action="close-editor"]');
    const saveBtn = editor.querySelector('[data-action="save-material"]');

    function renderTypeFields(selectedType, current) {
        if (!fieldsContainer) return;
        if (selectedType === 'Material:NoMass') {
            fieldsContainer.innerHTML = `
                <div class="grid grid-cols-3 gap-1">
                    <div>
                        <label class="label !text-[8px]">R (m²K/W)</label>
                        <input type="number" step="0.01" class="w-full text-[9px]" data-field="thermalResistance" value="${
                            current?.thermalResistance ?? ''
                        }">
                    </div>
                    <div>
                        <label class="label !text-[8px]">Solar Abs.</label>
                        <input type="number" step="0.01" class="w-full text-[9px]" data-field="solarAbsorptance" value="${
                            current?.solarAbsorptance ?? ''
                        }">
                    </div>
                    <div>
                        <label class="label !text-[8px]">Vis. Abs.</label>
                        <input type="number" step="0.01" class="w-full text-[9px]" data-field="visibleAbsorptance" value="${
                            current?.visibleAbsorptance ?? ''
                        }">
                    </div>
                </div>
            `;
        } else if (selectedType === 'WindowMaterial:SimpleGlazingSystem') {
            fieldsContainer.innerHTML = `
                <div class="grid grid-cols-3 gap-1">
                    <div>
                        <label class="label !text-[8px]">U (W/m²K)</label>
                        <input type="number" step="0.01" class="w-full text-[9px]" data-field="uFactor" value="${
                            current?.uFactor ?? ''
                        }">
                    </div>
                    <div>
                        <label class="label !text-[8px]">SHGC</label>
                        <input type="number" step="0.01" class="w-full text-[9px]" data-field="solarHeatGainCoeff" value="${
                            current?.solarHeatGainCoeff ?? ''
                        }">
                    </div>
                    <div>
                        <label class="label !text-[8px]">Tv</label>
                        <input type="number" step="0.01" class="w-full text-[9px]" data-field="visibleTransmittance" value="${
                            current?.visibleTransmittance ?? ''
                        }">
                    </div>
                </div>
            `;
        } else {
            // Opaque Material
            fieldsContainer.innerHTML = `
                <div class="grid grid-cols-3 gap-1">
                    <div>
                        <label class="label !text-[8px]">Thickness (m)</label>
                        <input type="number" step="0.001" class="w-full text-[9px]" data-field="thickness" value="${
                            current?.thickness ?? ''
                        }">
                    </div>
                    <div>
                        <label class="label !text-[8px]">k (W/mK)</label>
                        <input type="number" step="0.01" class="w-full text-[9px]" data-field="conductivity" value="${
                            current?.conductivity ?? ''
                        }">
                    </div>
                    <div>
                        <label class="label !text-[8px]">ρ (kg/m³)</label>
                        <input type="number" step="1" class="w-full text-[9px]" data-field="density" value="${
                            current?.density ?? ''
                        }">
                    </div>
                </div>
                <div class="grid grid-cols-3 gap-1 mt-1">
                    <div>
                        <label class="label !text-[8px]">c (J/kgK)</label>
                        <input type="number" step="1" class="w-full text-[9px]" data-field="specificHeat" value="${
                            current?.specificHeat ?? ''
                        }">
                    </div>
                    <div>
                        <label class="label !text-[8px]">Solar Abs.</label>
                        <input type="number" step="0.01" class="w-full text-[9px]" data-field="solarAbsorptance" value="${
                            current?.solarAbsorptance ?? ''
                        }">
                    </div>
                    <div>
                        <label class="label !text-[8px]">Vis. Abs.</label>
                        <input type="number" step="0.01" class="w-full text-[9px]" data-field="visibleAbsorptance" value="${
                            current?.visibleAbsorptance ?? ''
                        }">
                    </div>
                </div>
            `;
        }
    }

    renderTypeFields(type, editing);

    typeSelect.addEventListener('change', () => {
        const selectedType = typeSelect.value;
        renderTypeFields(selectedType, null);
    });

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            editor.remove();
        });
    }

    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            const { meta, ep, materials: currentMaterials } = getEnergyPlusConfig();

            const nameInput = editor.querySelector('[data-field="name"]');
            const tSelect = editor.querySelector('[data-field="type"]');
            const selectedType = tSelect.value;
            const matName = (nameInput.value || '').trim();

            if (!matName) {
                alert('Material name is required.');
                return;
            }

            // Prevent duplicate names (except when editing same index)
            const duplicateIndex = currentMaterials.findIndex(
                (m, i) => m && m.name === matName && i !== index
            );
            if (duplicateIndex !== -1) {
                alert(
                    `A material named "${matName}" already exists. Choose a different name.`
                );
                return;
            }

            // Collect type-specific fields
            const m = { type: selectedType, name: matName };

            const getNum = (sel) => {
                const el = editor.querySelector(sel);
                if (!el) return undefined;
                const v = parseFloat(el.value);
                return Number.isFinite(v) ? v : undefined;
            };

            if (selectedType === 'Material:NoMass') {
                m.thermalResistance = getNum('[data-field="thermalResistance"]');
                m.solarAbsorptance = getNum('[data-field="solarAbsorptance"]');
                m.visibleAbsorptance = getNum('[data-field="visibleAbsorptance"]');
            } else if (
                selectedType === 'WindowMaterial:SimpleGlazingSystem'
            ) {
                m.uFactor = getNum('[data-field="uFactor"]');
                m.solarHeatGainCoeff = getNum(
                    '[data-field="solarHeatGainCoeff"]'
                );
                m.visibleTransmittance = getNum(
                    '[data-field="visibleTransmittance"]'
                );
            } else {
                m.thickness = getNum('[data-field="thickness"]');
                m.conductivity = getNum('[data-field="conductivity"]');
                m.density = getNum('[data-field="density"]');
                m.specificHeat = getNum('[data-field="specificHeat"]');
                m.solarAbsorptance = getNum('[data-field="solarAbsorptance"]');
                m.visibleAbsorptance = getNum(
                    '[data-field="visibleAbsorptance"]'
                );
            }

            if (index != null) {
                currentMaterials[index] = { ...currentMaterials[index], ...m };
            } else {
                currentMaterials.push(m);
            }

            saveEnergyPlusConfig(meta, { ...ep, materials: currentMaterials });

            editor.remove();
            if (parentPanel._renderMaterials) {
                parentPanel._renderMaterials();
            }
        });
    }
}

/**
 * ENERGYPLUS CONSTRUCTIONS MANAGER
 * Manage meta.energyPlusConfig.constructions and meta.energyPlusConfig.defaults.
 */
function openConstructionsManagerPanel() {
    const panelId = 'panel-energyplus-constructions';
    let panel = document.getElementById(panelId);
    if (!panel) {
        panel = createConstructionsManagerPanel();
        document.getElementById('window-container').appendChild(panel);
    }
    panel.classList.remove('hidden');
    panel.style.zIndex = getNewZIndex();
}

function createConstructionsManagerPanel() {
    const panel = document.createElement('div');
    panel.id = 'panel-energyplus-constructions';
    panel.className = 'floating-window ui-panel resizable-panel';

    panel.innerHTML = `
        <div class="window-header">
            <span>EnergyPlus Constructions</span>
            <!-- Help button removed -->
            <div class="window-controls">
                <div class="window-icon-max" title="Maximize/Restore"></div>
                <div class="collapse-icon" title="Minimize"></div>
                <div class="window-icon-close" title="Close"></div>
            </div>
        </div>
        <div class="window-content space-y-2">
            <div class="resize-handle-edge top"></div>
            <div class="resize-handle-edge right"></div>
            <div class="resize-handle-edge bottom"></div>
            <div class="resize-handle-edge left"></div>
            <div class="resize-handle-corner top-left"></div>
            <div class="resize-handle-corner top-right"></div>
            <div class="resize-handle-corner bottom-left"></div>
            <div class="resize-handle-corner bottom-right"></div>
            <p class="info-box !text-[10px] !py-1.5 !px-2">
                Define constructions as ordered stacks of materials. Stored in <code>energyPlusConfig.constructions</code>.
                Defaults control which constructions are used for walls, roofs, floors, and windows.
            </p>
            <div class="flex justify-between items-center gap-2">
                <span class="font-semibold text-[10px] uppercase text-[--text-secondary]">Constructions</span>
                <button class="btn btn-xs btn-secondary" data-action="add-construction">+ Add Construction</button>
            </div>
            <div class="border border-gray-700/70 rounded bg-black/40 max-h-64 overflow-y-auto **scrollable-panel-inner**">
                <table class="w-full text-[9px] constructions-table">
                    <thead>
                        <tr class="bg-black/40">
                            <th class="px-2 py-1 text-left">Name</th>
                            <th class="px-2 py-1 text-left">Layers (outside → inside)</th>
                            <th class="px-2 py-1 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody class="constructions-tbody"></tbody>
                </table>
            </div>
            <div class="mt-2 space-y-1">
                <span class="font-semibold text-[10px] uppercase text-[--text-secondary]">Defaults</span>
                <div class="grid grid-cols-2 gap-1 text-[9px]">
                    <div>
                        <label class="label !text-[8px]">Default Ext Wall</label>
                        <select class="w-full text-[9px]" data-default-key="wallConstruction"></select>
                    </div>
                    <div>
                        <label class="label !text-[8px]">Default Roof</label>
                        <select class="w-full text-[9px]" data-default-key="roofConstruction"></select>
                    </div>
                    <div>
                        <label class="label !text-[8px]">Default Floor</label>
                        <select class="w-full text-[9px]" data-default-key="floorConstruction"></select>
                    </div>
                    <div>
                        <label class="label !text-[8px]">Default Window</label>
                        <select class="w-full text-[9px]" data-default-key="windowConstruction"></select>
                    </div>
                </div>
            </div>
            <div class="text-[9px] text-[--text-secondary]">
                Note: You cannot delete constructions that are set as defaults. Future surface editors may add additional reference checks.
            </div>
        </div>
    `;

    if (typeof window !== 'undefined' && window.initializePanelControls) {
        window.initializePanelControls(panel);
    } else {
        const closeButton = panel.querySelector('.window-icon-close');
        if (closeButton) {
            closeButton.onclick = () => panel.classList.add('hidden');
        }
    }

    const tbody = panel.querySelector('.constructions-tbody');
    const headerHelp = panel.querySelector('[data-action="open-help-constructions"]');
    // Header Constructions help button disabled
    // if (headerHelp) {
    //     headerHelp.addEventListener('click', () => openHelpPanel('config/constructions'));
    // }
    const addBtn = panel.querySelector('[data-action="add-construction"]');
    const defaultSelects = panel.querySelectorAll('select[data-default-key]');

    function getEP() {
        const meta =
            (typeof project.getMetadata === 'function' && project.getMetadata()) ||
            project.metadata ||
            {};
        const ep = meta.energyPlusConfig || meta.energyplus || {};
        const constructions = Array.isArray(ep.constructions)
            ? ep.constructions.slice()
            : [];
        const defaults = ep.defaults || {};
        const materials = Array.isArray(ep.materials) ? ep.materials : [];
        return { meta, ep, constructions, defaults, materials };
    }

    function saveEP(meta, ep) {
        const next = { ...ep };
        if (typeof project.updateMetadata === 'function') {
            project.updateMetadata({
                ...meta,
                energyPlusConfig: next,
            });
        } else {
            project.metadata = {
                ...(project.metadata || meta),
                energyPlusConfig: next,
            };
        }
    }

    function render() {
        const { constructions, defaults } = getEP();
        tbody.innerHTML = '';

        if (!constructions.length) {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="px-2 py-1 text-[9px] text-[--text-secondary]" colspan="3">
                    No custom constructions defined. Built-in RM_* constructions remain available.
                </td>
            `;
            tbody.appendChild(tr);
        } else {
            constructions.forEach((c, index) => {
                const isDefault =
                    defaults.wallConstruction === c.name ||
                    defaults.roofConstruction === c.name ||
                    defaults.floorConstruction === c.name ||
                    defaults.windowConstruction === c.name;
                const layersText = Array.isArray(c.layers)
                    ? c.layers.join(', ')
                    : '';
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td class="px-2 py-1 align-top">
                        ${c.name || ''}
                        ${isDefault ? '<span class="ml-1 text-[7px] text-[--accent-color]">(default)</span>' : ''}
                    </td>
                    <td class="px-2 py-1 align-top text-[8px] text-[--text-secondary]">${layersText}</td>
                    <td class="px-2 py-1 align-top text-right">
                        <button class="btn btn-xxs btn-secondary" data-action="edit" data-index="${index}">Edit</button>
                        <button class="btn btn-xxs btn-danger ml-1" data-action="delete" data-index="${index}">Delete</button>
                    </td>
                `;
                tbody.appendChild(tr);
            });

            tbody.querySelectorAll('button[data-action="edit"]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const idx = parseInt(btn.dataset.index, 10);
                    openConstructionEditor(panel, idx);
                });
            });
            tbody.querySelectorAll('button[data-action="delete"]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const idx = parseInt(btn.dataset.index, 10);
                    deleteConstruction(idx);
                    render();
                    renderDefaults();
                });
            });
        }

        renderDefaults();
    }

    function renderDefaults() {
        const { constructions, defaults } = getEP();
        defaultSelects.forEach((sel) => {
            const key = sel.dataset.defaultKey;
            const current = defaults[key];
            sel.innerHTML = `<option value="">(none)</option>`;
            constructions.forEach((c) => {
                const opt = document.createElement('option');
                opt.value = c.name;
                opt.textContent = c.name;
                if (c.name === current) opt.selected = true;
                sel.appendChild(opt);
            });
        });
    }

    function deleteConstruction(index) {
        const { meta, ep, constructions, defaults } = getEP();
        const c = constructions[index];
        if (!c) return;

        // Guard: cannot delete if set as default
        if (
            defaults.wallConstruction === c.name ||
            defaults.roofConstruction === c.name ||
            defaults.floorConstruction === c.name ||
            defaults.windowConstruction === c.name
        ) {
            alert(
                `Cannot delete construction "${c.name}": it is set as a default. Change defaults first.`
            );
            return;
        }

        constructions.splice(index, 1);
        saveEP(meta, { ...ep, constructions });
    }

    if (addBtn) {
        addBtn.addEventListener('click', () => {
            openConstructionEditor(panel, null);
        });
    }

    defaultSelects.forEach((sel) => {
        sel.addEventListener('change', () => {
            const { meta, ep, defaults } = getEP();
            const key = sel.dataset.defaultKey;
            const val = sel.value || undefined;
            const nextDefaults = { ...defaults };
            if (val) nextDefaults[key] = val;
            else delete nextDefaults[key];
            saveEP(meta, { ...ep, defaults: nextDefaults });
            render(); // re-render to update default badges
        });
    });

    render();

    panel._renderConstructions = render;

    return panel;
}

/**
 * Open editor for a construction (index) or create new (index == null).
 */
function openConstructionEditor(parentPanel, index) {
    const getEP = () => {
        const meta =
            (typeof project.getMetadata === 'function' && project.getMetadata()) ||
            project.metadata ||
            {};
        const ep = meta.energyPlusConfig || meta.energyplus || {};
        const constructions = Array.isArray(ep.constructions)
            ? ep.constructions.slice()
            : [];
        const defaults = ep.defaults || {};
        const materials = Array.isArray(ep.materials) ? ep.materials : [];
        return { meta, ep, constructions, defaults, materials };
    };

    const saveEP = (meta, ep) => {
        const next = { ...ep };
        if (typeof project.updateMetadata === 'function') {
            project.updateMetadata({
                ...meta,
                energyPlusConfig: next,
            });
        } else {
            project.metadata = {
                ...(project.metadata || meta),
                energyPlusConfig: next,
            };
        }
    };

    // Remove existing editor if any
    let editor = parentPanel.querySelector('.constructions-editor');
    if (editor) editor.remove();

    const { constructions, materials } = getEP();
    const editing = index != null ? constructions[index] : null;

    editor = document.createElement('div');
    editor.className =
        'constructions-editor mt-2 p-2 border border-[--accent-color]/40 rounded bg-black/70 space-y-1 text-[9px]';

    const name = editing?.name || '';

    editor.innerHTML = `
        <div class="flex justify-between items-center gap-2">
            <span class="font-semibold text-[9px]">${index != null ? 'Edit Construction' : 'Add Construction'}</span>
            <button class="btn btn-xxs btn-secondary" data-action="close-editor">×</button>
        </div>
        <div class="mt-1 grid grid-cols-2 gap-2">
            <div>
                <label class="label !text-[8px]">Name</label>
                <input type="text" class="w-full text-[9px]" data-field="name" value="${name}">
            </div>
            <div class="text-[8px] text-[--text-secondary] flex items-end">
                Layers are ordered from outside to inside.
            </div>
        </div>
        <div class="mt-1 space-y-1">
            <div class="flex justify-between items-center">
                <span class="text-[8px] font-semibold text-[--text-secondary]">Layers</span>
                <button class="btn btn-xxs btn-secondary" data-action="add-layer">+ Add Layer</button>
            </div>
            <div class="space-y-1" data-layers-container></div>
        </div>
        <div class="flex justify-end gap-2 mt-2">
            <button class="btn btn-xxs btn-secondary" data-action="save-construction">Save</button>
        </div>
    `;

    const content = parentPanel.querySelector('.window-content');
    content.appendChild(editor);

    const closeBtn = editor.querySelector('[data-action="close-editor"]');
    const addLayerBtn = editor.querySelector('[data-action="add-layer"]');
    const saveBtn = editor.querySelector('[data-action="save-construction"]');
    const layersContainer = editor.querySelector('[data-layers-container]');

    // Build material options list: custom + known built-ins from builder
    const builtinMaterialNames = [
        'RM_Concrete_200mm',
        'RM_Insulation_100mm',
        'RM_Gypsum_13mm',
        'RM_Screed_50mm',
        'RM_Glass_Double_Clear',
    ];
    const materialNames = Array.from(
        new Set([
            ...builtinMaterialNames,
            ...materials
                .map((m) => m && m.name)
                .filter((n) => typeof n === 'string' && n.trim().length),
        ])
    );

    function addLayerRow(value) {
        const row = document.createElement('div');
        row.className = 'flex items-center gap-1';
        const options = materialNames
            .map(
                (n) =>
                    `<option value="${n}"${
                        n === value ? ' selected' : ''
                    }>${n}</option>`
            )
            .join('');
        row.innerHTML = `
            <select class="w-full text-[9px]" data-field="layer-material">
                <option value="">(select material)</option>
                ${options}
            </select>
            <button class="btn btn-xxs btn-secondary" data-action="move-up">↑</button>
            <button class="btn btn-xxs btn-secondary" data-action="move-down">↓</button>
            <button class="btn btn-xxs btn-danger" data-action="remove-layer">×</button>
        `;
        layersContainer.appendChild(row);

        const moveUp = row.querySelector('[data-action="move-up"]');
        const moveDown = row.querySelector('[data-action="move-down"]');
        const remove = row.querySelector('[data-action="remove-layer"]');

        moveUp.addEventListener('click', () => {
            const prev = row.previousElementSibling;
            if (prev) {
                layersContainer.insertBefore(row, prev);
            }
        });
        moveDown.addEventListener('click', () => {
            const next = row.nextElementSibling;
            if (next) {
                layersContainer.insertBefore(next, row);
            }
        });
        remove.addEventListener('click', () => {
            row.remove();
        });
    }

    // Initialize layers
    if (editing && Array.isArray(editing.layers) && editing.layers.length) {
        editing.layers.forEach((ln) => addLayerRow(ln));
    } else {
        addLayerRow('');
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            editor.remove();
        });
    }

    if (addLayerBtn) {
        addLayerBtn.addEventListener('click', () => {
            addLayerRow('');
        });
    }

    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            const { meta, ep, constructions, defaults } = getEP();

            const nameInput = editor.querySelector('[data-field="name"]');
            const consName = (nameInput.value || '').trim();
            if (!consName) {
                alert('Construction name is required.');
                return;
            }

            // Collect layers
            const layers = [];
            layersContainer
                .querySelectorAll('[data-field="layer-material"]')
                .forEach((sel) => {
                    const v = sel.value.trim();
                    if (v) layers.push(v);
                });

            if (!layers.length) {
                alert('At least one layer (material) is required.');
                return;
            }

            // Name uniqueness (except same index)
            const dupIndex = constructions.findIndex(
                (c, i) => c && c.name === consName && i !== index
            );
            if (dupIndex !== -1) {
                alert(
                    `A construction named "${consName}" already exists. Choose a different name.`
                );
                return;
            }

            // Build construction object
            const newC = { name: consName, layers };

            const nextConstructions = constructions.slice();
            let oldName = editing?.name;

            if (index != null) {
                nextConstructions[index] = newC;
            } else {
                nextConstructions.push(newC);
            }

            // Update defaults if name changed
            const nextDefaults = { ...defaults };
            if (oldName && oldName !== consName) {
                Object.keys(nextDefaults).forEach((k) => {
                    if (nextDefaults[k] === oldName) {
                        nextDefaults[k] = consName;
                    }
                });
            }

            saveEP(meta, {
                ...ep,
                constructions: nextConstructions,
                defaults: nextDefaults,
            });

            editor.remove();
            if (parentPanel._renderConstructions) {
                parentPanel._renderConstructions();
            }
        });
    }
}

/**
 * ENERGYPLUS SCHEDULES MANAGER
 * Manage meta.energyPlusConfig.schedules.compact (user schedules) alongside built-ins.
 */
function openSchedulesManagerPanel() {
    const panelId = 'panel-energyplus-schedules';
    let panel = document.getElementById(panelId);
    if (!panel) {
        panel = createSchedulesManagerPanel();
        document.getElementById('window-container').appendChild(panel);
    }
    panel.classList.remove('hidden');
    panel.style.zIndex = getNewZIndex();
}

function createSchedulesManagerPanel() {
    const panel = document.createElement('div');
    panel.id = 'panel-energyplus-schedules';
    panel.className = 'floating-window ui-panel resizable-panel';

    panel.innerHTML = `
        <div class="window-header">
            <span>EnergyPlus Schedules</span>
            <!-- Help button removed -->
            <div class="window-controls">
                <div class="window-icon-max" title="Maximize/Restore"></div>
                <div class="collapse-icon" title="Minimize"></div>
                <div class="window-icon-close" title="Close"></div>
            </div>
        </div>
        <div class="window-content space-y-2">
            <div class="resize-handle-edge top"></div>
            <div class="resize-handle-edge right"></div>
            <div class="resize-handle-edge bottom"></div>
            <div class="resize-handle-edge left"></div>
            <div class="resize-handle-corner top-left"></div>
            <div class="resize-handle-corner top-right"></div>
            <div class="resize-handle-corner bottom-left"></div>
            <div class="resize-handle-corner bottom-right"></div>
            <p class="info-box !text-[10px] !py-1.5 !px-2">
                Manage Schedule:Compact objects used by loads, IdealLoads, thermostats, and daylighting.
                Built-in schedules are read-only; user schedules are stored in <code>energyPlusConfig.schedules.compact</code>.
            </p>
            <div class="flex justify-between items-center gap-2">
                <span class="font-semibold text-[10px] uppercase text-[--text-secondary]">Schedules (Compact)</span>
                <button class="btn btn-xs btn-secondary" data-action="add-schedule">+ Add Schedule</button>
            </div>
            <div class="border border-gray-700/70 rounded bg-black/40 max-h-64 overflow-y-auto **scrollable-panel-inner**">
                <table class="w-full text-[9px] schedules-table">
                    <thead>
                        <tr class="bg-black/40">
                            <th class="px-2 py-1 text-left">Name</th>
                            <th class="px-2 py-1 text-left">TypeLimits</th>
                            <th class="px-2 py-1 text-left">Origin</th>
                            <th class="px-2 py-1 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody class="schedules-tbody"></tbody>
                </table>
            </div>
            <div class="text-[9px] text-[--text-secondary]">
                Note: Built-in schedules cannot be edited or deleted. User schedules cannot be deleted while in use.
            </div>
        </div>
    `;

    if (typeof window !== 'undefined' && window.initializePanelControls) {
        window.initializePanelControls(panel);
    } else {
        const closeButton = panel.querySelector('.window-icon-close');
        if (closeButton) {
            closeButton.onclick = () => panel.classList.add('hidden');
        }
    }

    const tbody = panel.querySelector('.schedules-tbody');
    const headerHelp = panel.querySelector('[data-action="open-help-schedules"]');
    // Header Schedules help button disabled
    // if (headerHelp) {
    //     headerHelp.addEventListener('click', () => openHelpPanel('config/schedules'));
    // }
    const addBtn = panel.querySelector('[data-action="add-schedule"]');

    function getEP() {
        const meta =
            (typeof project.getMetadata === 'function' && project.getMetadata()) ||
            project.metadata ||
            {};
        const ep = meta.energyPlusConfig || meta.energyplus || {};
        const raw = ep.schedules && ep.schedules.compact;
        const builtins = new Set([
            'RM_AlwaysOn',
            'RM_Office_Occ',
            'RM_Office_Lighting',
            'RM_Office_Equipment',
        ]);

        const user = [];

        if (Array.isArray(raw)) {
            raw.forEach((s) => {
                if (!s || !s.name || !Array.isArray(s.lines)) return;
                const nm = String(s.name);
                if (!builtins.has(nm)) {
                    user.push({
                        name: nm,
                        typeLimits: s.typeLimits || 'Fraction',
                        lines: s.lines.slice(),
                    });
                }
            });
        } else if (raw && typeof raw === 'object') {
            Object.keys(raw).forEach((nm) => {
                const s = raw[nm];
                if (!s || !Array.isArray(s.lines)) return;
                if (!builtins.has(nm)) {
                    user.push({
                        name: nm,
                        typeLimits: s.typeLimits || 'Fraction',
                        lines: s.lines.slice(),
                    });
                }
            });
        }

        return { meta, ep, user, builtins };
    }

    function saveUserSchedules(meta, ep, user) {
        // Persist user schedules as array of {name,typeLimits,lines}
        const compact = {};
        // Built-ins are implicit in builder; we only store users here.
        user.forEach((s) => {
            compact[s.name] = {
                typeLimits: s.typeLimits || 'Fraction',
                lines: s.lines.slice(),
            };
        });

        const nextEP = {
            ...ep,
            schedules: {
                ...(ep.schedules || {}),
                compact,
            },
        };

        if (typeof project.updateMetadata === 'function') {
            project.updateMetadata({
                ...meta,
                energyPlusConfig: nextEP,
            });
        } else {
            project.metadata = {
                ...(project.metadata || meta),
                energyPlusConfig: nextEP,
            };
        }
    }

    function isScheduleReferenced(name) {
        const meta =
            (typeof project.getMetadata === 'function' && project.getMetadata()) ||
            project.metadata ||
            {};
        const ep = meta.energyPlusConfig || meta.energyplus || {};
        const target = String(name);

        // zoneLoads
        if (Array.isArray(ep.zoneLoads)) {
            for (const zl of ep.zoneLoads) {
                if (
                    zl?.people?.schedule === target ||
                    zl?.lighting?.schedule === target ||
                    zl?.equipment?.schedule === target ||
                    zl?.infiltration?.schedule === target
                ) {
                    return true;
                }
            }
        }

        // idealLoads (global/perZone availabilitySchedule)
        if (ep.idealLoads) {
            if (ep.idealLoads.global?.availabilitySchedule === target) return true;
            if (Array.isArray(ep.idealLoads.perZone)) {
                for (const z of ep.idealLoads.perZone) {
                    if (z?.availabilitySchedule === target) return true;
                }
            }
        }

        // thermostats
        if (Array.isArray(ep.thermostats)) {
            for (const t of ep.thermostats) {
                if (
                    t?.heatingScheduleName === target ||
                    t?.coolingScheduleName === target
                ) {
                    return true;
                }
            }
        }

        // daylighting: no direct schedule refs in current schema; skip

        return false;
    }

    function render() {
        const { user, builtins } = getEP();
        tbody.innerHTML = '';

        // Built-in schedules (read-only)
        const builtinList = Array.from(builtins);
        builtinList.forEach((nm) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="px-2 py-1 align-top">${nm}</td>
                <td class="px-2 py-1 align-top">Fraction</td>
                <td class="px-2 py-1 align-top text-[8px] text-[--accent-color]">Built-in</td>
                <td class="px-2 py-1 align-top text-right text-[8px] text-[--text-secondary]">read-only</td>
            `;
            tbody.appendChild(tr);
        });

        // User schedules
        if (!user.length) {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="px-2 py-1 text-[9px] text-[--text-secondary]" colspan="4">
                    No custom schedules defined.
                </td>
            `;
            tbody.appendChild(tr);
        } else {
            user.forEach((s, index) => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td class="px-2 py-1 align-top">${s.name}</td>
                    <td class="px-2 py-1 align-top">${s.typeLimits || 'Fraction'}</td>
                    <td class="px-2 py-1 align-top text-[8px] text-[--text-secondary]">User</td>
                    <td class="px-2 py-1 align-top text-right">
                        <button class="btn btn-xxs btn-secondary" data-action="edit" data-index="${index}">Edit</button>
                        <button class="btn btn-xxs btn-danger ml-1" data-action="delete" data-index="${index}">Delete</button>
                    </td>
                `;
                tbody.appendChild(tr);
            });

            tbody.querySelectorAll('button[data-action="edit"]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const idx = parseInt(btn.dataset.index, 10);
                    openScheduleEditor(panel, idx);
                });
            });

            tbody.querySelectorAll('button[data-action="delete"]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const idx = parseInt(btn.dataset.index, 10);
                    deleteSchedule(idx);
                });
            });
        }
    }

    function deleteSchedule(index) {
        const { meta, ep, user } = getEP();
        const s = user[index];
        if (!s) return;

        if (isScheduleReferenced(s.name)) {
            alert(
                `Cannot delete schedule "${s.name}": it is referenced by loads, IdealLoads, or thermostats.`
            );
            return;
        }

        user.splice(index, 1);
        saveUserSchedules(meta, ep, user);
        render();
    }

    if (addBtn) {
        addBtn.addEventListener('click', () => {
            openScheduleEditor(panel, null);
        });
    }

    panel._renderSchedules = render;

    render();

    return panel;
}

/**
 * Add/Edit Schedule:Compact (user schedules only).
 * index === null → new schedule.
 */
function openScheduleEditor(parentPanel, index) {
    const getState = () => {
        const { meta, ep, user, builtins } = (() => {
            const meta =
                (typeof project.getMetadata === 'function' &&
                    project.getMetadata()) ||
                project.metadata ||
                {};
            const ep = meta.energyPlusConfig || meta.energyplus || {};
            const raw = ep.schedules && ep.schedules.compact;
            const builtins = new Set([
                'RM_AlwaysOn',
                'RM_Office_Occ',
                'RM_Office_Lighting',
                'RM_Office_Equipment',
            ]);
            const user = [];
            if (Array.isArray(raw)) {
                raw.forEach((s) => {
                    if (!s || !s.name || !Array.isArray(s.lines)) return;
                    const nm = String(s.name);
                    if (!builtins.has(nm)) {
                        user.push({
                            name: nm,
                            typeLimits: s.typeLimits || 'Fraction',
                            lines: s.lines.slice(),
                        });
                    }
                });
            } else if (raw && typeof raw === 'object') {
                Object.keys(raw).forEach((nm) => {
                    const s = raw[nm];
                    if (!s || !Array.isArray(s.lines)) return;
                    if (!builtins.has(nm)) {
                        user.push({
                            name: nm,
                            typeLimits: s.typeLimits || 'Fraction',
                            lines: s.lines.slice(),
                        });
                    }
                });
            }
            return { meta, ep, user, builtins };
        })();
        return { meta, ep, user, builtins };
    };

    const saveUser = (meta, ep, user) => {
        const compact = {};
        user.forEach((s) => {
            compact[s.name] = {
                typeLimits: s.typeLimits || 'Fraction',
                lines: s.lines.slice(),
            };
        });
        const nextEP = {
            ...ep,
            schedules: {
                ...(ep.schedules || {}),
                compact,
            },
        };
        if (typeof project.updateMetadata === 'function') {
            project.updateMetadata({
                ...meta,
                energyPlusConfig: nextEP,
            });
        } else {
            project.metadata = {
                ...(project.metadata || meta),
                energyPlusConfig: nextEP,
            };
        }
    };

    // Remove any existing editor
    let editor = parentPanel.querySelector('.schedules-editor');
    if (editor) editor.remove();

    const { user, builtins } = getState();
    const editing = index != null ? user[index] : null;

    editor = document.createElement('div');
    editor.className =
        'schedules-editor mt-2 p-2 border border-[--accent-color]/40 rounded bg-black/70 space-y-1 text-[9px]';

    const name = editing?.name || '';
    const typeLimits = editing?.typeLimits || 'Fraction';
    const linesText = (editing?.lines || []).join('\n');

    editor.innerHTML = `
        <div class="flex justify-between items-center gap-2">
            <span class="font-semibold text-[9px]">${editing ? 'Edit Schedule' : 'Add Schedule'}</span>
            <button class="btn btn-xxs btn-secondary" data-action="close-editor">×</button>
        </div>
        <div class="grid grid-cols-2 gap-2 mt-1">
            <div>
                <label class="label !text-[8px]">Name</label>
                <input type="text" class="w-full text-[9px]" data-field="name" value="${name}">
            </div>
            <div>
                <label class="label !text-[8px]">TypeLimits</label>
                <input type="text" class="w-full text-[9px]" data-field="typeLimits" value="${typeLimits}">
            </div>
        </div>
        <div class="mt-1">
            <label class="label !text-[8px]">Schedule:Compact Lines</label>
            <textarea class="w-full text-[8px] h-24 font-mono" data-field="lines"
                placeholder="Example:
Through: 12/31
For: AllDays
Until: 24:00, 1.0">${linesText}</textarea>
        </div>
        <div class="text-[7px] text-[--text-secondary]">
            Lines are written exactly as in Schedule:Compact objects and will be emitted verbatim.
        </div>
        <div class="flex justify-end gap-2 mt-2">
            <button class="btn btn-xxs btn-secondary" data-action="save-schedule">Save</button>
        </div>
    `;

    const content = parentPanel.querySelector('.window-content');
    content.appendChild(editor);

    const closeBtn = editor.querySelector('[data-action="close-editor"]');
    const saveBtn = editor.querySelector('[data-action="save-schedule"]');

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            editor.remove();
        });
    }

    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            const { meta, ep, user, builtins } = getState();

            const nameInput = editor.querySelector('[data-field="name"]');
            const tlInput = editor.querySelector('[data-field="typeLimits"]');
            const linesInput = editor.querySelector('[data-field="lines"]');

            const nm = (nameInput.value || '').trim();
            if (!nm) {
                alert('Schedule name is required.');
                return;
            }

            // Cannot collide with built-ins
            if (builtins.has(nm)) {
                alert('Cannot use a built-in schedule name for a custom schedule.');
                return;
            }

            // Uniqueness among users (except same index)
            const dupIndex = user.findIndex(
                (s, i) => s.name === nm && i !== index
            );
            if (dupIndex !== -1) {
                alert(
                    `A schedule named "${nm}" already exists. Choose a different name.`
                );
                return;
            }

            // Lines
            const lines = (linesInput.value || '')
                .split('\n')
                .map((l) => l.trim())
                .filter((l) => l.length > 0);
            if (!lines.length) {
                alert('At least one Schedule:Compact line is required.');
                return;
            }

            const typeLimits = (tlInput.value || 'Fraction').trim() || 'Fraction';

            const updated = {
                name: nm,
                typeLimits,
                lines,
            };

            const updatedUser = user.slice();
            const oldName = editing?.name;

            if (index != null && editing) {
                // If name changed and is referenced, block rename to avoid silent breakage.
                if (oldName && oldName !== nm && isScheduleReferenced(oldName)) {
                    alert(
                        `Cannot rename schedule "${oldName}" while it is referenced. Update usages first.`
                    );
                    return;
                }
                updatedUser[index] = updated;
            } else {
                updatedUser.push(updated);
            }

            saveUser(meta, ep, updatedUser);

            editor.remove();
            if (parentPanel._renderSchedules) {
                parentPanel._renderSchedules();
            }
        });
    }
}

/**
 * ENERGYPLUS ZONE LOADS MANAGER
 * Per-zone loads control panel, backed by energyPlusConfig.zoneLoads.
 */
function openZoneLoadsManagerPanel() {
    const panelId = 'panel-energyplus-zone-loads';
    let panel = document.getElementById(panelId);
    if (!panel) {
        panel = createZoneLoadsManagerPanel();
        document.getElementById('window-container').appendChild(panel);
    }
    panel.classList.remove('hidden');
    panel.style.zIndex = getNewZIndex();
}

function createZoneLoadsManagerPanel() {
    const panel = document.createElement('div');
    panel.id = 'panel-energyplus-zone-loads';
    panel.className = 'floating-window ui-panel resizable-panel';

    panel.innerHTML = `
        <div class="window-header">
            <span>Zone Loads</span>
            <!-- Help button removed -->
            <div class="window-controls">
                <div class="window-icon-max" title="Maximize/Restore"></div>
                <div class="collapse-icon" title="Minimize"></div>
                <div class="window-icon-close" title="Close"></div>
            </div>
        </div>
        <div class="window-content space-y-2">
            <div class="resize-handle-edge top"></div>
            <div class="resize-handle-edge right"></div>
            <div class="resize-handle-edge bottom"></div>
            <div class="resize-handle-edge left"></div>
            <div class="resize-handle-corner top-left"></div>
            <div class="resize-handle-corner top-right"></div>
            <div class="resize-handle-corner bottom-left"></div>
            <div class="resize-handle-corner bottom-right"></div>
            <p class="info-box !text-[10px] !py-1.5 !px-2">
                Configure per-zone internal loads (people, lighting, equipment, infiltration).
                Values are stored in <code>energyPlusConfig.zoneLoads</code>.
            </p>

            <div class="border border-gray-700/70 rounded bg-black/40 p-2 space-y-1">
                <div class="flex justify-between items-center gap-2">
                    <span class="font-semibold text-[9px] uppercase text-[--text-secondary]">Template (Apply to all zones)</span>
                    <button class="btn btn-xxs btn-secondary" data-action="apply-template">Apply to all zones</button>
                </div>
                <div class="grid grid-cols-4 gap-1 mt-1 text-[8px]">
                    <div>
                        <label class="label !text-[8px]">People [p/m²]</label>
                        <input type="number" step="0.01" class="w-full text-[8px]" data-template="peoplePerArea">
                    </div>
                    <div>
                        <label class="label !text-[8px]">Lights [W/m²]</label>
                        <input type="number" step="0.1" class="w-full text-[8px]" data-template="lightsWm2">
                    </div>
                    <div>
                        <label class="label !text-[8px]">Equip [W/m²]</label>
                        <input type="number" step="0.1" class="w-full text-[8px]" data-template="equipWm2">
                    </div>
                    <div>
                        <label class="label !text-[8px]">Infil [ACH]</label>
                        <input type="number" step="0.1" class="w-full text-[8px]" data-template="infilAch">
                    </div>
                </div>
                <div class="grid grid-cols-4 gap-1 mt-1 text-[8px]">
                    <div>
                        <label class="label !text-[8px]">People Sched</label>
                        <select class="w-full text-[8px]" data-template="peopleSched"></select>
                    </div>
                    <div>
                        <label class="label !text-[8px]">Lights Sched</label>
                        <select class="w-full text-[8px]" data-template="lightsSched"></select>
                    </div>
                    <div>
                        <label class="label !text-[8px]">Equip Sched</label>
                        <select class="w-full text-[8px]" data-template="equipSched"></select>
                    </div>
                    <div>
                        <label class="label !text-[8px]">Infil Sched</label>
                        <select class="w-full text-[8px]" data-template="infilSched"></select>
                    </div>
                </div>
            </div>

            <div class="border border-gray-700/70 rounded bg-black/40 max-h-72 overflow-y-auto **scrollable-panel-inner**">
                <table class="w-full text-[8px] zone-loads-table">
                    <thead class="bg-black/40">
                        <tr>
                            <th class="px-1 py-1 text-left">Zone</th>
                            <th class="px-1 py-1 text-left">People [p/m²] / Sched</th>
                            <th class="px-1 py-1 text-left">Lights [W/m²] / Sched</th>
                            <th class="px-1 py-1 text-left">Equip [W/m²] / Sched</th>
                            <th class="px-1 py-1 text-left">Infil [ACH] / Sched</th>
                        </tr>
                    </thead>
                    <tbody class="zone-loads-tbody"></tbody>
                </table>
            </div>

            <div class="flex justify-end gap-2 mt-1">
                <button class="btn btn-xxs btn-secondary" data-action="save-zone-config">
                    Save Configuration
                </button>
            </div>

            <div class="text-[8px] text-[--text-secondary]">
                Notes:
                <ul class="list-disc pl-4 space-y-0.5">
                    <li>Loads are stored per zone in <code>zoneLoads</code> (one entry per zone).</li>
                </ul>
            </div>
        </div>
    `;

    if (typeof window !== 'undefined' && window.initializePanelControls) {
        window.initializePanelControls(panel);
    } else {
        const closeBtn = panel.querySelector('.window-icon-close');
        if (closeBtn) {
            closeBtn.onclick = () => panel.classList.add('hidden');
        }
    }

    const tbody = panel.querySelector('.zone-loads-tbody');
    const headerHelp = panel.querySelector('[data-action="open-help-loads"]');
    // Header Loads help button disabled
    // if (headerHelp) {
    //     headerHelp.addEventListener('click', () => openHelpPanel('config/loads'));
    // }
    const applyTemplateBtn = panel.querySelector('[data-action="apply-template"]');
    const saveBtn = panel.querySelector('[data-action="save-zone-config"]');

    function getMetaAndEP() {
        const meta =
            (typeof project.getMetadata === 'function' && project.getMetadata()) ||
            project.metadata ||
            {};
        const ep = meta.energyPlusConfig || meta.energyplus || {};
        return { meta, ep };
    }

    function getZones() {
        const { meta } = getMetaAndEP();
        let zones = [];
        if (typeof project.getZones === 'function') {
            zones = project.getZones() || [];
        } else if (Array.isArray(project.zones)) {
            zones = project.zones;
        }
        if (!Array.isArray(zones) || !zones.length) {
            return [{ name: 'Zone_1' }];
        }
        return zones.map((z, i) => ({
            name: z.name || `Zone_${i + 1}`,
        }));
    }

    function getScheduleNames(ep) {
        const names = new Set([
            'RM_AlwaysOn',
            'RM_Office_Occ',
            'RM_Office_Lighting',
            'RM_Office_Equipment',
        ]);
        const sc = ep.schedules && ep.schedules.compact;
        if (Array.isArray(sc)) {
            sc.forEach((s) => {
                if (s && s.name) names.add(String(s.name));
            });
        } else if (sc && typeof sc === 'object') {
            Object.keys(sc).forEach((nm) => names.add(nm));
        }
        return Array.from(names);
    }

    function buildIndexes(ep) {
        const zoneLoadsIndex = new Map();
        if (Array.isArray(ep.zoneLoads)) {
            ep.zoneLoads.forEach((zl) => {
                if (zl && zl.zoneName) {
                    zoneLoadsIndex.set(String(zl.zoneName), zl);
                }
            });
        }
        return { zoneLoadsIndex };
    }

    function fillTemplateScheduleOptions(ep) {
        const schedNames = getScheduleNames(ep);
        const templSelects = panel.querySelectorAll('[data-template]');
        templSelects.forEach((sel) => {
            if (!(sel instanceof HTMLSelectElement)) return;
            const key = sel.getAttribute('data-template') || '';
            sel.innerHTML = '';
            const allowBlank = key === 'heatSpSched' || key === 'coolSpSched' || key === 'ilAvail';
            if (allowBlank) {
                const opt = document.createElement('option');
                opt.value = '';
                opt.textContent = '(none)';
                sel.appendChild(opt);
            }
            schedNames.forEach((nm) => {
                const opt = document.createElement('option');
                opt.value = nm;
                opt.textContent = nm;
                sel.appendChild(opt);
            });
        });
    }

    function render() {
        const { ep } = getMetaAndEP();
        const zones = getZones();
        const schedNames = getScheduleNames(ep);
        const { zoneLoadsIndex } = buildIndexes(ep);

        // Template selects
        fillTemplateScheduleOptions(ep);

        tbody.innerHTML = '';
        zones.forEach((z) => {
            const zn = String(z.name);
            const zl = zoneLoadsIndex.get(zn) || {};

            const tr = document.createElement('tr');
            tr.dataset.zoneName = zn;

            const schedOptions = (selected) => {
                let html = `<option value="">(none)</option>`;
                schedNames.forEach((nm) => {
                    const sel = nm === selected ? ' selected' : '';
                    html += `<option value="${nm}"${sel}>${nm}</option>`;
                });
                return html;
            };

            const oaMethodOptions = (selected) => {
                const methods = ['', 'None', 'Sum', 'Flow/Person', 'Flow/Area'];
                return methods
                    .map((m) => {
                        const label = m || '(inherit/global)';
                        const val = m;
                        const sel = m === selected ? ' selected' : '';
                        return `<option value="${val}"${sel}>${label}</option>`;
                    })
                    .join('');
            };

            tr.innerHTML = `
                <td class="px-1 py-1 align-top text-[--accent-color]">${zn}</td>

                <td class="px-1 py-1 align-top">
                    <input type="number" step="0.01"
                        class="w-full text-[8px] mb-0.5"
                        data-field="peoplePerArea"
                        value="${zl.people?.peoplePerArea ?? ''}">
                    <select class="w-full text-[8px]" data-field="peopleSched">
                        ${schedOptions(zl.people?.schedule || '')}
                    </select>
                </td>

                <td class="px-1 py-1 align-top">
                    <input type="number" step="0.1"
                        class="w-full text-[8px] mb-0.5"
                        data-field="lightsWm2"
                        value="${zl.lighting?.wattsPerArea ?? ''}">
                    <select class="w-full text-[8px]" data-field="lightsSched">
                        ${schedOptions(zl.lighting?.schedule || '')}
                    </select>
                </td>

                <td class="px-1 py-1 align-top">
                    <input type="number" step="0.1"
                        class="w-full text-[8px] mb-0.5"
                        data-field="equipWm2"
                        value="${zl.equipment?.wattsPerArea ?? ''}">
                    <select class="w-full text-[8px]" data-field="equipSched">
                        ${schedOptions(zl.equipment?.schedule || '')}
                    </select>
                </td>

                <td class="px-1 py-1 align-top">
                    <input type="number" step="0.1"
                        class="w-full text-[8px] mb-0.5"
                        data-field="infilAch"
                        value="${zl.infiltration?.ach ?? ''}">
                    <select class="w-full text-[8px]" data-field="infilSched">
                        ${schedOptions(zl.infiltration?.schedule || '')}
                    </select>
                </td>

            `;

            tbody.appendChild(tr);
        });
    }

    function collectTemplateValues() {
        const obj = {};
        const root = panel;
        const num = (sel) => {
            const el = root.querySelector(`[data-template="${sel}"]`);
            if (!el) return undefined;
            const v = parseFloat(el.value);
            return Number.isFinite(v) ? v : undefined;
        };
        const str = (sel) => {
            const el = root.querySelector(`[data-template="${sel}"]`);
            if (!el) return undefined;
            const v = (el.value || '').trim();
            return v || undefined;
        };

        obj.peoplePerArea = num('peoplePerArea');
        obj.lightsWm2 = num('lightsWm2');
        obj.equipWm2 = num('equipWm2');
        obj.infilAch = num('infilAch');

        obj.peopleSched = str('peopleSched');
        obj.lightsSched = str('lightsSched');
        obj.equipSched = str('equipSched');
        obj.infilSched = str('infilSched');

        obj.heatSpSched = str('heatSpSched');
        obj.coolSpSched = str('coolSpSched');
        obj.ilAvail = str('ilAvail');
        obj.ilHeatCap = num('ilHeatCap');
        obj.ilCoolCap = num('ilCoolCap');
        obj.ilOaMethod = str('ilOaMethod');
        obj.ilOaPerPerson = num('ilOaPerPerson');
        obj.ilOaPerArea = num('ilOaPerArea');
        obj.ilAvail = str('ilAvail');
        obj.ilHeatCap = num('ilHeatCap');
        obj.ilCoolCap = num('ilCoolCap');
        obj.ilOaMethod = str('ilOaMethod');
        obj.ilOaPerPerson = num('ilOaPerPerson');
        obj.ilOaPerArea = num('ilOaPerArea');

        return obj;
    }

    function applyTemplateToAllZones() {
        const tmpl = collectTemplateValues();
        const rows = tbody.querySelectorAll('tr[data-zone-name]');
        rows.forEach((tr) => {
            const setVal = (sel, val) => {
                if (val === undefined) return;
                const el = tr.querySelector(sel);
                if (el) el.value = val;
            };
            const setNum = (sel, val) => {
                if (val === undefined) return;
                const el = tr.querySelector(sel);
                if (el) el.value = val;
            };

            setNum('[data-field="peoplePerArea"]', tmpl.peoplePerArea);
            setVal('[data-field="peopleSched"]', tmpl.peopleSched);

            setNum('[data-field="lightsWm2"]', tmpl.lightsWm2);
            setVal('[data-field="lightsSched"]', tmpl.lightsSched);

            setNum('[data-field="equipWm2"]', tmpl.equipWm2);
            setVal('[data-field="equipSched"]', tmpl.equipSched);

            setNum('[data-field="infilAch"]', tmpl.infilAch);
            setVal('[data-field="infilSched"]', tmpl.infilSched);
        });
    }

    function buildNextConfigFromUI() {
        const { meta, ep } = getMetaAndEP();
        const rows = Array.from(
            tbody.querySelectorAll('tr[data-zone-name]')
        );
        const zones = rows.map((tr) => tr.dataset.zoneName);

        const nextZoneLoads = [];

        // Collect per-zone values
        rows.forEach((tr) => {
            const zn = tr.dataset.zoneName;

            const num = (sel) => {
                const el = tr.querySelector(sel);
                if (!el) return undefined;
                const v = parseFloat(el.value);
                return Number.isFinite(v) ? v : undefined;
            };
            const str = (sel) => {
                const el = tr.querySelector(sel);
                if (!el) return undefined;
                const v = (el.value || '').trim();
                return v || undefined;
            };

            const peoplePerArea = num('[data-field="peoplePerArea"]');
            const peopleSched = str('[data-field="peopleSched"]');

            const lightsWm2 = num('[data-field="lightsWm2"]');
            const lightsSched = str('[data-field="lightsSched"]');

            const equipWm2 = num('[data-field="equipWm2"]');
            const equipSched = str('[data-field="equipSched"]');

            const infilAch = num('[data-field="infilAch"]');
            const infilSched = str('[data-field="infilSched"]');

            if (
                peoplePerArea != null ||
                lightsWm2 != null ||
                equipWm2 != null ||
                infilAch != null
            ) {
                const zl = { zoneName: zn };
                if (peoplePerArea != null) {
                    zl.people = {
                        peoplePerArea,
                        schedule: peopleSched,
                    };
                }
                if (lightsWm2 != null) {
                    zl.lighting = {
                        wattsPerArea: lightsWm2,
                        schedule: lightsSched,
                    };
                }
                if (equipWm2 != null) {
                    zl.equipment = {
                        wattsPerArea: equipWm2,
                        schedule: equipSched,
                    };
                }
                if (infilAch != null) {
                    zl.infiltration = {
                        ach: infilAch,
                        schedule: infilSched,
                    };
                }
                nextZoneLoads.push(zl);
            }

        });

        const nextConfig = {
            ...ep,
            zoneLoads: nextZoneLoads,
        };

        return { meta, nextConfig };
    }

    if (applyTemplateBtn) {
        applyTemplateBtn.addEventListener('click', () => {
            applyTemplateToAllZones();
        });
    }

    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            try {
                const { meta, nextConfig } = buildNextConfigFromUI();
                if (typeof project.updateMetadata === 'function') {
                    project.updateMetadata({
                        ...meta,
                        energyPlusConfig: nextConfig,
                    });
                } else {
                    project.metadata = {
                        ...(project.metadata || meta),
                        energyPlusConfig: nextConfig,
                    };
                }
                alert('Zone loads configuration saved.');
            } catch (err) {
                console.error('EnergyPlus Zone Manager: save failed', err);
                alert('Failed to save configuration. Check console for details.');
            }
        });
    }

    render();

    return panel;
}

/**
 * DAYLIGHTING MANAGER
 * Manage energyPlusConfig.daylighting.controls and .outputs.illuminanceMaps.
 */
function openDaylightingManagerPanel() {
    const panelId = 'panel-energyplus-daylighting';
    let panel = document.getElementById(panelId);
    if (!panel) {
        panel = createDaylightingManagerPanel();
        document.getElementById('window-container').appendChild(panel);
    }
    panel.classList.remove('hidden');
    panel.style.zIndex = getNewZIndex();
}

function createIdealLoadsManagerPanel() {
    const panel = document.createElement('div');
    panel.id = 'panel-energyplus-ideal-loads';
    panel.className = 'floating-window ui-panel resizable-panel';

    panel.innerHTML = `
        <div class="window-header">
            <span>Thermostats & IdealLoads</span>
            <div class="window-controls">
                <div class="window-icon-max" title="Maximize/Restore"></div>
                <div class="collapse-icon" title="Minimize"></div>
                <div class="window-icon-close" title="Close"></div>
            </div>
        </div>
        <div class="window-content space-y-3">
            <div class="resize-handle-edge top"></div>
            <div class="resize-handle-edge right"></div>
            <div class="resize-handle-edge bottom"></div>
            <div class="resize-handle-edge left"></div>
            <div class="resize-handle-corner top-left"></div>
            <div class="resize-handle-corner top-right"></div>
            <div class="resize-handle-corner bottom-left"></div>
            <div class="resize-handle-corner bottom-right"></div>

            <p class="info-box !text-[10px] !py-1.5 !px-2">
                Configure global/per-zone thermostats and IdealLoads settings.
                Backed by <code>energyPlusConfig.thermostats</code> and <code>energyPlusConfig.idealLoads</code>.
                Ray-Modeler's EnergyPlus integration uses <code>ZoneHVAC:IdealLoadsAirSystem</code> plus standard
                zone controls only; system-level AirLoopHVAC/PlantLoop objects are intentionally not generated.
            </p>

            <!-- THERMOSTAT SETPOINTS -->
            <div class="space-y-1 border border-gray-700/70 rounded bg-black/40 p-2">
                <div class="flex justify-between items-center">
                    <span class="font-semibold text-[10px] uppercase text-[--text-secondary]">Thermostat Setpoints</span>
                    <button class="btn btn-xxs btn-secondary" data-action="add-tstat-setpoint">+ Add Setpoint</button>
                </div>
                <div class="border border-gray-700/70 rounded bg-black/60 max-h-32 overflow-y-auto **scrollable-panel-inner** mt-1">
                    <table class="w-full text-[8px]">
                        <thead class="bg-black/40">
                            <tr>
                                <th class="px-1 py-1 text-left">Name</th>
                                <th class="px-1 py-1 text-left">Type</th>
                                <th class="px-1 py-1 text-left">Schedule(s)</th>
                                <th class="px-1 py-1 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody class="tstat-setpoints-tbody"></tbody>
                    </table>
                </div>
                <div class="text-[7px] text-[--text-secondary]">
                    Defines ThermostatSetpoint:SingleHeating / SingleCooling / SingleHeatingOrCooling / DualSetpoint
                    objects referenced by zone thermostat controls.
                </div>
            </div>

            <!-- ZONE THERMOSTAT CONTROLS -->
            <div class="space-y-1 border border-gray-700/70 rounded bg-black/40 p-2">
                <div class="flex justify-between items-center">
                    <span class="font-semibold text-[10px] uppercase text-[--text-secondary]">Zone Thermostat Controls</span>
                </div>
                <div class="border border-gray-700/70 rounded bg-black/60 max-h-40 overflow-y-auto **scrollable-panel-inner** mt-1">
                    <table class="w-full text-[8px]">
                        <thead class="bg-black/40">
                            <tr>
                                <th class="px-1 py-1 text-left">Zone</th>
                                <th class="px-1 py-1 text-left">Control Type Schedule</th>
                                <th class="px-1 py-1 text-left">SingleHeat</th>
                                <th class="px-1 py-1 text-left">SingleCool</th>
                                <th class="px-1 py-1 text-left">SingleHeat/Cool</th>
                                <th class="px-1 py-1 text-left">DualSetpoint</th>
                            </tr>
                        </thead>
                        <tbody class="tstat-zone-controls-tbody"></tbody>
                    </table>
                </div>
                <div class="text-[7px] text-[--text-secondary]">
                    Maps zones to ZoneControl:Thermostat using the setpoints above. Leave cells blank to inherit or skip.
                </div>
            </div>

            <!-- GLOBAL IDEAL LOADS -->
            <div class="space-y-1 border border-gray-700/70 rounded bg-black/40 p-2">
                <div class="flex justify-between items-center">
                    <span class="font-semibold text-[10px] uppercase text-[--text-secondary]">Global IdealLoads (Defaults)</span>
                </div>
                <div class="grid grid-cols-4 gap-2 text-[8px] mt-1">
                    <div>
                        <label class="label !text-[8px]">Availability Schedule</label>
                        <select class="w-full text-[8px]" data-field="il-global-avail"></select>
                    </div>
                    <div>
                        <label class="label !text-[8px]">Max Heat T [°C]</label>
                        <input type="number" class="w-full text-[8px]" data-field="il-global-maxHeatT" placeholder="50">
                    </div>
                    <div>
                        <label class="label !text-[8px]">Min Cool T [°C]</label>
                        <input type="number" class="w-full text-[8px]" data-field="il-global-minCoolT" placeholder="13">
                    </div>
                    <div>
                        <label class="label !text-[8px]">Heat Limit</label>
                        <select class="w-full text-[8px]" data-field="il-global-heatLimit">
                            <option value="">(default)</option>
                            <option value="NoLimit">NoLimit</option>
                            <option value="LimitFlowRate">LimitFlowRate</option>
                            <option value="LimitCapacity">LimitCapacity</option>
                            <option value="LimitFlowRateAndCapacity">LimitFlowRateAndCapacity</option>
                        </select>
                    </div>
                </div>
                <div class="grid grid-cols-4 gap-2 text-[8px] mt-1">
                    <div>
                        <label class="label !text-[8px]">Max Heat Flow [m³/s]</label>
                        <input type="number" step="0.001" class="w-full text-[8px]" data-field="il-global-maxHeatFlow">
                    </div>
                    <div>
                        <label class="label !text-[8px]">Max Heat Cap [W]</label>
                        <input type="number" class="w-full text-[8px]" data-field="il-global-maxHeatCap">
                    </div>
                    <div>
                        <label class="label !text-[8px]">Cool Limit</label>
                        <select class="w-full text-[8px]" data-field="il-global-coolLimit">
                            <option value="">(default)</option>
                            <option value="NoLimit">NoLimit</option>
                            <option value="LimitFlowRate">LimitFlowRate</option>
                            <option value="LimitCapacity">LimitCapacity</option>
                            <option value="LimitFlowRateAndCapacity">LimitFlowRateAndCapacity</option>
                        </select>
                    </div>
                    <div>
                        <label class="label !text-[8px]">Max Cool Flow [m³/s]</label>
                        <input type="number" step="0.001" class="w-full text-[8px]" data-field="il-global-maxCoolFlow">
                    </div>
                </div>
                <div class="grid grid-cols-4 gap-2 text-[8px] mt-1">
                    <div>
                        <label class="label !text-[8px]">Max Cool Cap [W]</label>
                        <input type="number" class="w-full text-[8px]" data-field="il-global-maxCoolCap">
                    </div>
                    <div>
                        <label class="label !text-[8px]">Dehum Type</label>
                        <select class="w-full text-[8px]" data-field="il-global-dehumType">
                            <option value="">(default)</option>
                            <option value="None">None</option>
                            <option value="ConstantSensibleHeatRatio">ConstantSensibleHeatRatio</option>
                            <option value="Humidistat">Humidistat</option>
                            <option value="ConstantSupplyHumidityRatio">ConstantSupplyHumidityRatio</option>
                        </select>
                    </div>
                    <div>
                        <label class="label !text-[8px]">Cool SHR</label>
                        <input type="number" step="0.01" class="w-full text-[8px]" data-field="il-global-coolSHR">
                    </div>
                    <div>
                        <label class="label !text-[8px]">Humid Type</label>
                        <select class="w-full text-[8px]" data-field="il-global-humType">
                            <option value="">(default)</option>
                            <option value="None">None</option>
                            <option value="Humidistat">Humidistat</option>
                            <option value="ConstantSupplyHumidityRatio">ConstantSupplyHumidityRatio</option>
                        </select>
                    </div>
                </div>
                <div class="grid grid-cols-4 gap-2 text-[8px] mt-1">
                    <div>
                        <label class="label !text-[8px]">OA Method</label>
                        <select class="w-full text-[8px]" data-field="il-global-oaMethod">
                            <option value="">(none)</option>
                            <option value="None">None</option>
                            <option value="Sum">Sum</option>
                            <option value="Flow/Person">Flow/Person</option>
                            <option value="Flow/Area">Flow/Area</option>
                        </select>
                    </div>
                    <div>
                        <label class="label !text-[8px]">OA L/s.person</label>
                        <input type="number" step="0.001" class="w-full text-[8px]" data-field="il-global-oaPP">
                    </div>
                    <div>
                        <label class="label !text-[8px]">OA L/s.m²</label>
                        <input type="number" step="0.001" class="w-full text-[8px]" data-field="il-global-oaPA">
                    </div>
                    <div>
                        <label class="label !text-[8px]">Heat Recovery</label>
                        <select class="w-full text-[8px]" data-field="il-global-hrType">
                            <option value="">(default)</option>
                            <option value="None">None</option>
                            <option value="Sensible">Sensible</option>
                            <option value="Enthalpy">Enthalpy</option>
                        </select>
                    </div>
                </div>
                <div class="grid grid-cols-4 gap-2 text-[8px] mt-1">
                    <div>
                        <label class="label !text-[8px]">HR Sens Eff</label>
                        <input type="number" step="0.01" class="w-full text-[8px]" data-field="il-global-hrSens">
                    </div>
                    <div>
                        <label class="label !text-[8px]">HR Lat Eff</label>
                        <input type="number" step="0.01" class="w-full text-[8px]" data-field="il-global-hrLat">
                    </div>
                </div>
                <div class="text-[7px] text-[--text-secondary]">
                    Values left blank use EnergyPlus defaults. These act as defaults for all zones unless overridden below.
                </div>
            </div>

            <!-- PER-ZONE IDEAL LOADS -->
            <div class="space-y-1 border border-gray-700/70 rounded bg-black/40 p-2">
                <div class="flex justify-between items-center">
                    <span class="font-semibold text-[10px] uppercase text-[--text-secondary]">Per-Zone IdealLoads Overrides</span>
                </div>
                <div class="border border-gray-700/70 rounded bg-black/60 max-h-40 overflow-y-auto **scrollable-panel-inner** mt-1">
                    <table class="w-full text-[8px]">
                        <thead class="bg-black/40">
                            <tr>
                                <th class="px-1 py-1 text-left">Zone</th>
                                <th class="px-1 py-1 text-left">Avail</th>
                                <th class="px-1 py-1 text-left">Heat Limit / Cap / Flow</th>
                                <th class="px-1 py-1 text-left">Cool Limit / Cap / Flow</th>
                                <th class="px-1 py-1 text-left">Dehum/Hum</th>
                                <th class="px-1 py-1 text-left">OA Method / Flows</th>
                                <th class="px-1 py-1 text-left">HR Type/Eff</th>
                            </tr>
                        </thead>
                        <tbody class="ideal-perzone-tbody"></tbody>
                    </table>
                </div>
                <div class="flex justify-end gap-2 mt-2">
                    <button class="btn btn-xxs btn-secondary" data-action="save-ideal-loads">
                        Save Thermostats & IdealLoads
                    </button>
                </div>
                <div class="text-[7px] text-[--text-secondary]">
                    Blank cells inherit from Global IdealLoads. This configuration is emitted into ZoneControl:Thermostat and ZoneHVAC:IdealLoadsAirSystem.
                </div>
            </div>

            <!-- GLOBAL THERMOSTATS -->
            <div class="space-y-1 border border-gray-700/70 rounded bg-black/40 p-2">
                <div class="flex justify-between items-center">
                    <span class="font-semibold text-[10px] uppercase text-[--text-secondary]">Global Thermostat Schedules</span>
                </div>
                <div class="grid grid-cols-2 gap-2 text-[8px] mt-1">
                    <div>
                        <label class="label !text-[8px]">Heating Schedule</label>
                        <select class="w-full text-[8px]" data-field="globalHeatSched"></select>
                    </div>
                    <div>
                        <label class="label !text-[8px]">Cooling Schedule</label>
                        <select class="w-full text-[8px]" data-field="globalCoolSched"></select>
                    </div>
                </div>
            </div>

            <!-- PER-ZONE THERMOSTATS -->
            <div class="space-y-1 border border-gray-700/70 rounded bg-black/40 p-2">
                <div class="flex justify-between items-center">
                    <span class="font-semibold text-[10px] uppercase text-[--text-secondary]">Per-Zone Thermostat Overrides</span>
                </div>
                <div class="max-h-40 overflow-y-auto **scrollable-panel-inner**">
                    <table class="w-full text-[8px]">
                        <thead class="bg-black/40">
                            <tr>
                                <th class="px-1 py-1 text-left">Zone</th>
                                <th class="px-1 py-1 text-left">Heat Sched (override)</th>
                                <th class="px-1 py-1 text-left">Cool Sched (override)</th>
                            </tr>
                        </thead>
                        <tbody class="tstats-tbody"></tbody>
                    </table>
                </div>
                <div class="text-[7px] text-[--text-secondary]">
                    Leave blank to use global schedules or no control.
                </div>
            </div>

            <!-- GLOBAL IDEALLOADS -->
            <div class="space-y-1 border border-gray-700/70 rounded bg-black/40 p-2">
                <div class="flex justify-between items-center">
                    <span class="font-semibold text-[10px] uppercase text-[--text-secondary]">Global IdealLoads Settings</span>
                </div>
                <div class="grid grid-cols-4 gap-2 text-[8px] mt-1">
                    <div>
                        <label class="label !text-[8px]">Avail. Schedule</label>
                        <select class="w-full text-[8px]" data-field="il-global-avail"></select>
                    </div>
                    <div>
                        <label class="label !text-[8px]">Heat Cap [W]</label>
                        <input type="number" class="w-full text-[8px]" data-field="il-global-heatcap">
                    </div>
                    <div>
                        <label class="label !text-[8px]">Cool Cap [W]</label>
                        <input type="number" class="w-full text-[8px]" data-field="il-global-coolcap">
                    </div>
                    <div>
                        <label class="label !text-[8px]">OA Method</label>
                        <select class="w-full text-[8px]" data-field="il-global-oamethod">
                            <option value="">(none)</option>
                            <option value="None">None</option>
                            <option value="Sum">Sum</option>
                            <option value="Flow/Person">Flow/Person</option>
                            <option value="Flow/Area">Flow/Area</option>
                        </select>
                    </div>
                </div>
                <div class="grid grid-cols-4 gap-2 text-[8px] mt-1">
                    <div>
                        <label class="label !text-[8px]">OA L/s.person</label>
                        <input type="number" step="0.001" class="w-full text-[8px]" data-field="il-global-oaperperson">
                    </div>
                    <div>
                        <label class="label !text-[8px]">OA L/s.m²</label>
                        <input type="number" step="0.001" class="w-full text-[8px]" data-field="il-global-oaperarea">
                    </div>
                </div>
                <div class="text-[7px] text-[--text-secondary]">
                    OA flows are stored in m³/s in metadata; values here are in L/s and converted.
                </div>
            </div>

            <!-- PER-ZONE IDEALLOADS -->
            <div class="space-y-1 border border-gray-700/70 rounded bg-black/40 p-2">
                <div class="flex justify-between items-center">
                    <span class="font-semibold text-[10px] uppercase text-[--text-secondary]">Per-Zone IdealLoads Overrides</span>
                </div>
                <div class="max-h-40 overflow-y-auto **scrollable-panel-inner**">
                    <table class="w-full text-[8px]">
                        <thead class="bg-black/40">
                            <tr>
                                <th class="px-1 py-1 text-left">Zone</th>
                                <th class="px-1 py-1 text-left">Avail. Sched</th>
                                <th class="px-1 py-1 text-left">Heat Cap [W]</th>
                                <th class="px-1 py-1 text-left">Cool Cap [W]</th>
                                <th class="px-1 py-1 text-left">OA Method</th>
                                <th class="px-1 py-1 text-left">OA L/s.person</th>
                                <th class="px-1 py-1 text-left">OA L/s.m²</th>
                            </tr>
                        </thead>
                        <tbody class="ideal-perzone-tbody"></tbody>
                    </table>
                </div>
            </div>

            <div class="flex justify-end gap-2">
                <button class="btn btn-xxs btn-secondary" data-action="save-ideal-loads">Save Thermostats & IdealLoads</button>
            </div>
        </div>
    `;

    if (typeof window !== 'undefined' && window.initializePanelControls) {
        window.initializePanelControls(panel);
    } else {
        const closeButton = panel.querySelector('.window-icon-close');
        if (closeButton) {
            closeButton.onclick = () => panel.classList.add('hidden');
        }
    }

    const tstatsTbody = panel.querySelector('.tstats-tbody');
    const idealPerZoneTbody = panel.querySelector('.ideal-perzone-tbody');
    const saveBtn = panel.querySelector('[data-action="save-ideal-loads"]');

    function getMetaEp() {
        const meta =
            (typeof project.getMetadata === 'function' && project.getMetadata()) ||
            project.metadata ||
            {};
        const ep = meta.energyPlusConfig || meta.energyplus || {};
        return { meta, ep };
    }

    function getZones() {
        let zones = [];
        if (typeof project.getZones === 'function') {
            zones = project.getZones() || [];
        } else if (Array.isArray(project.zones)) {
            zones = project.zones;
        }
        if (!Array.isArray(zones) || !zones.length) {
            return [{ name: 'Zone_1' }];
        }
        return zones.map((z, i) => ({
            name: z.name || `Zone_${i + 1}`,
        }));
    }

    function getScheduleNames(ep) {
        const names = new Set([
            'RM_AlwaysOn',
            'RM_Office_Occ',
            'RM_Office_Lighting',
            'RM_Office_Equipment',
        ]);
        const sc = ep.schedules && ep.schedules.compact;
        if (Array.isArray(sc)) {
            sc.forEach((s) => {
                if (s && s.name) names.add(String(s.name));
            });
        } else if (sc && typeof sc === 'object') {
            Object.keys(sc).forEach((nm) => names.add(nm));
        }
        return Array.from(names);
    }

    function buildState(ep) {
        const zones = getZones();
        const schedNames = getScheduleNames(ep);

        // Thermostats
        let globalT = { heatingScheduleName: '', coolingScheduleName: '' };
        const perZoneT = new Map();
        if (Array.isArray(ep.thermostats)) {
            ep.thermostats.forEach((t) => {
                if (!t) return;
                const zn = (t.zoneName || '').toString();
                if (!zn || zn.toUpperCase() === 'GLOBAL') {
                    if (!globalT) globalT = {};
                    if (t.heatingScheduleName) globalT.heatingScheduleName = t.heatingScheduleName;
                    if (t.coolingScheduleName) globalT.coolingScheduleName = t.coolingScheduleName;
                } else {
                    perZoneT.set(zn, {
                        zoneName: zn,
                        heatingScheduleName: t.heatingScheduleName || '',
                        coolingScheduleName: t.coolingScheduleName || '',
                    });
                }
            });
        }

        // IdealLoads
        const ideal = ep.idealLoads || {};
        const g = ideal.global || {};
        const perZoneIdeal = new Map();
        if (Array.isArray(ideal.perZone)) {
            ideal.perZone.forEach((cfg) => {
                if (cfg && cfg.zoneName) {
                    perZoneIdeal.set(String(cfg.zoneName), { ...cfg });
                }
            });
        }

        return { zones, schedNames, globalT, perZoneT, idealGlobal: g, perZoneIdeal };
    }

    function fillGlobalThermostatUI(ep, state) {
        const heatSel = panel.querySelector('[data-field="globalHeatSched"]');
        const coolSel = panel.querySelector('[data-field="globalCoolSched"]');
        if (!heatSel || !coolSel) return;
        const addOptions = (sel, selected) => {
            sel.innerHTML = '<option value="">(none)</option>';
            state.schedNames.forEach((nm) => {
                const opt = document.createElement('option');
                opt.value = nm;
                opt.textContent = nm;
                if (nm === selected) opt.selected = true;
                sel.appendChild(opt);
            });
        };
        addOptions(heatSel, state.globalT.heatingScheduleName || '');
        addOptions(coolSel, state.globalT.coolingScheduleName || '');
    }

    function renderPerZoneThermostats(ep, state) {
        tstatsTbody.innerHTML = '';
        const schedOptions = (selected) => {
            let html = '<option value="">(inherit)</option>';
            state.schedNames.forEach((nm) => {
                const sel = nm === selected ? ' selected' : '';
                html += `<option value="${nm}"${sel}>${nm}</option>`;
            });
            return html;
        };
        state.zones.forEach((z) => {
            const zn = String(z.name);
            const t = state.perZoneT.get(zn) || {};
            const tr = document.createElement('tr');
            tr.dataset.zoneName = zn;
            tr.innerHTML = `
                <td class="px-1 py-1 align-top text-[--accent-color]">${zn}</td>
                <td class="px-1 py-1 align-top">
                    <select class="w-full text-[8px]" data-field="heatSched">${schedOptions(t.heatingScheduleName || '')}</select>
                </td>
                <td class="px-1 py-1 align-top">
                    <select class="w-full text-[8px]" data-field="coolSched">${schedOptions(t.coolingScheduleName || '')}</select>
                </td>
            `;
            tstatsTbody.appendChild(tr);
        });
    }

    function fillGlobalIdealUI(ep, state) {
        const availSel = panel.querySelector('[data-field="il-global-avail"]');
        const heatCapInput = panel.querySelector('[data-field="il-global-heatcap"]');
        const coolCapInput = panel.querySelector('[data-field="il-global-coolcap"]');
        const oaMethodSel = panel.querySelector('[data-field="il-global-oamethod"]');
        const oaPerPersonInput = panel.querySelector('[data-field="il-global-oaperperson"]');
        const oaPerAreaInput = panel.querySelector('[data-field="il-global-oaperarea"]');
        if (!availSel || !heatCapInput || !coolCapInput || !oaMethodSel || !oaPerPersonInput || !oaPerAreaInput) return;

        // availability schedule options
        availSel.innerHTML = '<option value="">(none)</option>';
        state.schedNames.forEach((nm) => {
            const opt = document.createElement('option');
            opt.value = nm;
            opt.textContent = nm;
            if (nm === state.idealGlobal.availabilitySchedule) opt.selected = true;
            availSel.appendChild(opt);
        });

        heatCapInput.value = state.idealGlobal.maxHeatingCapacity ?? '';
        coolCapInput.value = state.idealGlobal.maxCoolingCapacity ?? '';
        oaMethodSel.value = state.idealGlobal.outdoorAirMethod || '';

        oaPerPersonInput.value =
            state.idealGlobal.outdoorAirFlowPerPerson != null
                ? (state.idealGlobal.outdoorAirFlowPerPerson * 1000.0).toString()
                : '';
        oaPerAreaInput.value =
            state.idealGlobal.outdoorAirFlowPerArea != null
                ? (state.idealGlobal.outdoorAirFlowPerArea * 1000.0).toString()
                : '';
    }

    function renderPerZoneIdeal(state) {
        idealPerZoneTbody.innerHTML = '';
        const schedOptions = (selected) => {
            let html = '<option value="">(inherit/global)</option>';
            state.schedNames.forEach((nm) => {
                const sel = nm === selected ? ' selected' : '';
                html += `<option value="${nm}"${sel}>${nm}</option>`;
            });
            return html;
        };
        const oaMethodOptions = (selected) => {
            const methods = ['', 'None', 'Sum', 'Flow/Person', 'Flow/Area'];
            return methods
                .map((m) => {
                    const label = m || '(inherit/global)';
                    const sel = m === selected ? ' selected' : '';
                    return `<option value="${m}"${sel}>${label}</option>`;
                })
                .join('');
        };

        state.zones.forEach((z) => {
            const zn = String(z.name);
            const cfg = state.perZoneIdeal.get(zn) || {};
            const tr = document.createElement('tr');
            tr.dataset.zoneName = zn;
            tr.innerHTML = `
                <td class="px-1 py-1 align-top text-[--accent-color]">${zn}</td>
                <td class="px-1 py-1 align-top">
                    <select class="w-full text-[8px]" data-field="il-avail">${schedOptions(cfg.availabilitySchedule || '')}</select>
                </td>
                <td class="px-1 py-1 align-top">
                    <input type="number" class="w-full text-[8px]" data-field="il-heatcap" value="${cfg.maxHeatingCapacity ?? ''}">
                </td>
                <td class="px-1 py-1 align-top">
                    <input type="number" class="w-full text-[8px]" data-field="il-coolcap" value="${cfg.maxCoolingCapacity ?? ''}">
                </td>
                <td class="px-1 py-1 align-top">
                    <select class="w-full text-[8px]" data-field="il-oamethod">
                        ${oaMethodOptions(cfg.outdoorAirMethod || '')}
                    </select>
                </td>
                <td class="px-1 py-1 align-top">
                    <input type="number" step="0.001" class="w-full text-[8px]" data-field="il-oaperperson"
                        value="${
                            cfg.outdoorAirFlowPerPerson != null
                                ? cfg.outdoorAirFlowPerPerson * 1000.0
                                : ''
                        }">
                </td>
                <td class="px-1 py-1 align-top">
                    <input type="number" step="0.001" class="w-full text-[8px]" data-field="il-oaperarea"
                        value="${
                            cfg.outdoorAirFlowPerArea != null
                                ? cfg.outdoorAirFlowPerArea * 1000.0
                                : ''
                        }">
                </td>
            `;
            idealPerZoneTbody.appendChild(tr);
        });
    }

    function collectAndSave() {
        const { meta, ep } = getMetaEp();
        const state = buildState(ep);
        const zones = state.zones.map((z) => z.name);
        const zoneSet = new Set(zones);

        // Collect global thermostats
        const heatSel = panel.querySelector('[data-field="globalHeatSched"]');
        const coolSel = panel.querySelector('[data-field="globalCoolSched"]');
        const globalHeat = (heatSel?.value || '').trim();
        const globalCool = (coolSel?.value || '').trim();

        const thermostats = [];

        if (globalHeat || globalCool) {
            thermostats.push({
                zoneName: 'GLOBAL',
                heatingScheduleName: globalHeat || undefined,
                coolingScheduleName: globalCool || undefined,
            });
        }

        // Collect per-zone tstat overrides
        tstatsTbody.querySelectorAll('tr[data-zone-name]').forEach((tr) => {
            const zn = tr.dataset.zoneName;
            if (!zn || !zoneSet.has(zn)) return;
            const heat = (tr.querySelector('[data-field="heatSched"]')?.value || '').trim();
            const cool = (tr.querySelector('[data-field="coolSched"]')?.value || '').trim();
            if (heat || cool) {
                thermostats.push({
                    zoneName: zn,
                    heatingScheduleName: heat || undefined,
                    coolingScheduleName: cool || undefined,
                });
            }
        });

        // Collect global IdealLoads
        const availSel = panel.querySelector('[data-field="il-global-avail"]');
        const heatCapInput = panel.querySelector('[data-field="il-global-heatcap"]');
        const coolCapInput = panel.querySelector('[data-field="il-global-coolcap"]');
        const oaMethodSel = panel.querySelector('[data-field="il-global-oamethod"]');
        const oaPerPersonInput = panel.querySelector('[data-field="il-global-oaperperson"]');
        const oaPerAreaInput = panel.querySelector('[data-field="il-global-oaperarea"]');

        const idealGlobal = {};

        if (availSel && availSel.value) {
            idealGlobal.availabilitySchedule = availSel.value;
        }

        const gHeatCap = parseFloat(heatCapInput?.value || '');
        if (Number.isFinite(gHeatCap)) {
            idealGlobal.heatingLimitType = 'LimitCapacity';
            idealGlobal.maxHeatingCapacity = gHeatCap;
        }

        const gCoolCap = parseFloat(coolCapInput?.value || '');
        if (Number.isFinite(gCoolCap)) {
            idealGlobal.coolingLimitType = 'LimitCapacity';
            idealGlobal.maxCoolingCapacity = gCoolCap;
        }

        const gOaMethod = oaMethodSel?.value || '';
        if (gOaMethod) {
            idealGlobal.outdoorAirMethod = gOaMethod;
        }

        const gOaPerPerson_Ls = parseFloat(oaPerPersonInput?.value || '');
        if (Number.isFinite(gOaPerPerson_Ls) && gOaPerPerson_Ls > 0) {
            idealGlobal.outdoorAirFlowPerPerson = gOaPerPerson_Ls / 1000.0;
        }

        const gOaPerArea_Ls = parseFloat(oaPerAreaInput?.value || '');
        if (Number.isFinite(gOaPerArea_Ls) && gOaPerArea_Ls > 0) {
            idealGlobal.outdoorAirFlowPerArea = gOaPerArea_Ls / 1000.0;
        }

        // Collect per-zone IdealLoads overrides
        const perZoneIdeal = [];
        idealPerZoneTbody.querySelectorAll('tr[data-zone-name]').forEach((tr) => {
            const zn = tr.dataset.zoneName;
            if (!zn || !zoneSet.has(zn)) return;

            const avail = (tr.querySelector('[data-field="il-avail"]')?.value || '').trim();
            const heatCap = parseFloat(
                tr.querySelector('[data-field="il-heatcap"]')?.value || ''
            );
            const coolCap = parseFloat(
                tr.querySelector('[data-field="il-coolcap"]')?.value || ''
            );
            const oaMethod = (tr.querySelector('[data-field="il-oamethod"]')?.value || '').trim();
            const oaPerPerson_Ls = parseFloat(
                tr.querySelector('[data-field="il-oaperperson"]')?.value || ''
            );
            const oaPerArea_Ls = parseFloat(
                tr.querySelector('[data-field="il-oaperarea"]')?.value || ''
            );

            const cfg = { zoneName: zn };
            let has = false;

            if (avail) {
                cfg.availabilitySchedule = avail;
                has = true;
            }
            if (Number.isFinite(heatCap)) {
                cfg.heatingLimitType = 'LimitCapacity';
                cfg.maxHeatingCapacity = heatCap;
                has = true;
            }
            if (Number.isFinite(coolCap)) {
                cfg.coolingLimitType = 'LimitCapacity';
                cfg.maxCoolingCapacity = coolCap;
                has = true;
            }
            if (oaMethod) {
                cfg.outdoorAirMethod = oaMethod;
                has = true;
            }
            if (Number.isFinite(oaPerPerson_Ls) && oaPerPerson_Ls > 0) {
                cfg.outdoorAirFlowPerPerson = oaPerPerson_Ls / 1000.0;
                has = true;
            }
            if (Number.isFinite(oaPerArea_Ls) && oaPerArea_Ls > 0) {
                cfg.outdoorAirFlowPerArea = oaPerArea_Ls / 1000.0;
                has = true;
            }

            if (has) {
                perZoneIdeal.push(cfg);
            }
        });

        const idealLoads = {};
        if (Object.keys(idealGlobal).length) {
            idealLoads.global = idealGlobal;
        }
        if (perZoneIdeal.length) {
            idealLoads.perZone = perZoneIdeal;
        }

        const nextEp = {
            ...ep,
            thermostats: thermostats,
            idealLoads: idealLoads,
        };

        if (typeof project.updateMetadata === 'function') {
            project.updateMetadata({
                ...meta,
                energyPlusConfig: nextEp,
            });
        } else {
            project.metadata = {
                ...(project.metadata || meta),
                energyPlusConfig: nextEp,
            };
        }
    }

    function renderAll() {
        const { ep } = getMetaEp();
        const state = buildState(ep);
        fillGlobalThermostatUI(ep, state);
        renderPerZoneThermostats(ep, state);
        fillGlobalIdealUI(ep, state);
        renderPerZoneIdeal(state);
    }

    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            try {
                collectAndSave();
                alert('Thermostats & IdealLoads configuration saved.');
            } catch (err) {
                console.error('IdealLoadsManager: save failed', err);
                alert('Failed to save Thermostats & IdealLoads configuration. Check console for details.');
            }
        });
    }

    renderAll();

    return panel;
}

function openIdealLoadsManagerPanel() {
    const panelId = 'panel-energyplus-ideal-loads';
    let panel = document.getElementById(panelId);
    if (!panel) {
        panel = createIdealLoadsManagerPanel();
        document.getElementById('window-container').appendChild(panel);
    }
    panel.classList.remove('hidden');
    panel.style.zIndex = getNewZIndex();
}

function createDaylightingManagerPanel() {
    const panel = document.createElement('div');
    panel.id = 'panel-energyplus-daylighting';
    panel.className = 'floating-window ui-panel resizable-panel';

    panel.innerHTML = `
        <div class="window-header">
            <span>Daylighting</span>
            <!-- Help button removed -->
            <div class="window-controls">
                <div class="window-icon-max" title="Maximize/Restore"></div>
                <div class="collapse-icon" title="Minimize"></div>
                <div class="window-icon-close" title="Close"></div>
            </div>
        </div>
        <div class="window-content space-y-3">
            <div class="resize-handle-edge top"></div>
            <div class="resize-handle-edge right"></div>
            <div class="resize-handle-edge bottom"></div>
            <div class="resize-handle-edge left"></div>
            <div class="resize-handle-corner top-left"></div>
            <div class="resize-handle-corner top-right"></div>
            <div class="resize-handle-corner bottom-left"></div>
            <div class="resize-handle-corner bottom-right"></div>
            <p class="info-box !text-[10px] !py-1.5 !px-2">
                Configure per-zone <code>Daylighting:Controls</code> and <code>Output:IlluminanceMap</code>.
                Settings are stored in <code>energyPlusConfig.daylighting</code> and consumed by the EnergyPlus model builder.
            </p>

            <!-- Per-zone Daylighting:Controls -->
            <div class="space-y-1">
                <div class="flex justify-between items-center">
                    <span class="font-semibold text-[10px] uppercase text-[--text-secondary]">Daylighting Controls (per zone)</span>
                </div>
                <div class="border border-gray-700/70 rounded bg-black/40 max-h-60 overflow-y-auto **scrollable-panel-inner**">
                    <table class="w-full text-[8px]">
                        <thead class="bg-black/40">
                            <tr>
                                <th class="px-1 py-1 text-left">Zone</th>
                                <th class="px-1 py-1 text-left">Enabled</th>
                                <th class="px-1 py-1 text-left">Ref Pt 1 (x,y,z)</th>
                                <th class="px-1 py-1 text-left">Ref Pt 2 (x,y,z)</th>
                                <th class="px-1 py-1 text-left">Setpoint [lux]</th>
                                <th class="px-1 py-1 text-left">Type</th>
                                <th class="px-1 py-1 text-left">Fraction</th>
                            </tr>
                        </thead>
                        <tbody class="daylighting-controls-tbody"></tbody>
                    </table>
                </div>
            </div>

            <!-- Illuminance Maps -->
            <div class="space-y-1">
                <div class="flex justify-between items-center">
                    <span class="font-semibold text-[10px] uppercase text-[--text-secondary]">Illuminance Maps</span>
                    <button class="btn btn-xxs btn-secondary" data-action="add-illum-map">+ Add Map</button>
                </div>
                <div class="border border-gray-700/70 rounded bg-black/40 max-h-40 overflow-y-auto **scrollable-panel-inner**">
                    <table class="w-full text-[8px]">
                        <thead class="bg-black/40">
                            <tr>
                                <th class="px-1 py-1 text-left">Name</th>
                                <th class="px-1 py-1 text-left">Zone</th>
                                <th class="px-1 py-1 text-left">Origin (x,y,z)</th>
                                <th class="px-1 py-1 text-left">Grid (Nx, Dx, Ny, Dy)</th>
                                <th class="px-1 py-1 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody class="illum-maps-tbody"></tbody>
                    </table>
                </div>
            </div>

            <div class="flex justify-end gap-2">
                <button class="btn btn-xxs btn-secondary" data-action="save-daylighting">Save Daylighting</button>
            </div>
        </div>
    `;

    if (typeof window !== 'undefined' && window.initializePanelControls) {
        window.initializePanelControls(panel);
    } else {
        const closeBtn = panel.querySelector('.window-icon-close');
        if (closeBtn) {
            closeBtn.onclick = () => panel.classList.add('hidden');
        }
    }

    const controlsTbody = panel.querySelector('.daylighting-controls-tbody');
    const headerHelp = panel.querySelector('[data-action="open-help-daylighting"]');
    if (headerHelp) {
        headerHelp.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            // Daylighting header help disabled
            console.debug('[EnergyPlus] Daylighting help disabled');
            // openHelpPanel('config/daylighting');
        });
    }
    const illumTbody = panel.querySelector('.illum-maps-tbody');
    const addIllumBtn = panel.querySelector('[data-action="add-illum-map"]');
    const saveBtn = panel.querySelector('[data-action="save-daylighting"]');

    function getMetaEPDaylighting() {
        const meta =
            (typeof project.getMetadata === 'function' && project.getMetadata()) ||
            project.metadata ||
            {};
        const ep = meta.energyPlusConfig || meta.energyplus || {};
        const daylighting = ep.daylighting || {};
        return { meta, ep, daylighting };
    }

    function getZones() {
        let zones = [];
        if (typeof project.getZones === 'function') {
            zones = project.getZones() || [];
        } else if (Array.isArray(project.zones)) {
            zones = project.zones;
        }
        if (!Array.isArray(zones) || !zones.length) {
            return [{ name: 'Zone_1' }];
        }
        return zones.map((z, i) => ({
            name: z.name || `Zone_${i + 1}`,
        }));
    }

    function renderControls() {
        const { daylighting } = getMetaEPDaylighting();
        const zones = getZones();
        const existing = new Map();

        if (Array.isArray(daylighting.controls)) {
            daylighting.controls.forEach((c) => {
                if (c && c.zoneName) {
                    existing.set(String(c.zoneName), c);
                }
            });
        }

        controlsTbody.innerHTML = '';

        zones.forEach((z) => {
            const zn = String(z.name);
            const c = existing.get(zn) || {};
            const enabled = c.enabled !== false && c.refPoints && c.refPoints.length > 0 && typeof c.setpoint === 'number';

            const rp1 = (c.refPoints && c.refPoints[0]) || {};
            const rp2 = (c.refPoints && c.refPoints[1]) || {};

            const tr = document.createElement('tr');
            tr.dataset.zoneName = zn;
            tr.innerHTML = `
                <td class="px-1 py-1 align-top text-[--accent-color]">${zn}</td>
                <td class="px-1 py-1 align-top">
                    <input type="checkbox" data-field="enabled" ${enabled ? 'checked' : ''}>
                </td>
                <td class="px-1 py-1 align-top">
                    <div class="grid grid-cols-3 gap-0.5">
                        <input type="number" step="0.01" class="w-full text-[8px]" placeholder="x" data-field="rp1x" value="${rp1.x ?? ''}">
                        <input type="number" step="0.01" class="w-full text-[8px]" placeholder="y" data-field="rp1y" value="${rp1.y ?? ''}">
                        <input type="number" step="0.01" class="w-full text-[8px]" placeholder="z" data-field="rp1z" value="${rp1.z ?? ''}">
                    </div>
                </td>
                <td class="px-1 py-1 align-top">
                    <div class="grid grid-cols-3 gap-0.5">
                        <input type="number" step="0.01" class="w-full text-[8px]" placeholder="x" data-field="rp2x" value="${rp2.x ?? ''}">
                        <input type="number" step="0.01" class="w-full text-[8px]" placeholder="y" data-field="rp2y" value="${rp2.y ?? ''}">
                        <input type="number" step="0.01" class="w-full text-[8px]" placeholder="z" data-field="rp2z" value="${rp2.z ?? ''}">
                    </div>
                </td>
                <td class="px-1 py-1 align-top">
                    <input type="number" step="1" class="w-full text-[8px]" data-field="setpoint" value="${c.setpoint ?? ''}">
                </td>
                <td class="px-1 py-1 align-top">
                    <select class="w-full text-[8px]" data-field="type">
                        <option value="Continuous"${c.type === 'Continuous' || !c.type ? ' selected' : ''}>Continuous</option>
                        <option value="Stepped"${c.type === 'Stepped' ? ' selected' : ''}>Stepped</option>
                        <option value="ContinuousOff"${c.type === 'ContinuousOff' ? ' selected' : ''}>ContinuousOff</option>
                    </select>
                </td>
                <td class="px-1 py-1 align-top">
                    <input type="number" step="0.05" min="0" max="1" class="w-full text-[8px]" data-field="fraction" value="${c.fraction ?? ''}">
                </td>
            `;
            controlsTbody.appendChild(tr);
        });
    }

    function renderIlluminanceMaps() {
        const { daylighting } = getMetaEPDaylighting();
        const zones = getZones().map((z) => z.name);
        const maps = (daylighting.outputs && Array.isArray(daylighting.outputs.illuminanceMaps))
            ? daylighting.outputs.illuminanceMaps
            : [];

        illumTbody.innerHTML = '';

        if (!maps.length) {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="px-1 py-1 text-[8px] text-[--text-secondary]" colspan="5">
                    No illuminance maps defined.
                </td>
            `;
            illumTbody.appendChild(tr);
            return;
        }

        maps.forEach((m, index) => {
            const tr = document.createElement('tr');
            tr.dataset.index = String(index);
            tr.innerHTML = `
                <td class="px-1 py-1 align-top">
                    <input class="w-full text-[8px]" data-field="name" value="${m.name || ''}">
                </td>
                <td class="px-1 py-1 align-top">
                    <select class="w-full text-[8px]" data-field="zoneName">
                        ${zones
                            .map((zn) => `<option value="${zn}"${zn === m.zoneName ? ' selected' : ''}>${zn}</option>`)
                            .join('')}
                    </select>
                </td>
                <td class="px-1 py-1 align-top">
                    <div class="grid grid-cols-3 gap-0.5">
                        <input type="number" step="0.01" class="w-full text-[8px]" placeholder="x" data-field="xOrigin" value="${m.xOrigin ?? ''}">
                        <input type="number" step="0.01" class="w-full text-[8px]" placeholder="y" data-field="yOrigin" value="${m.yOrigin ?? ''}">
                        <input type="number" step="0.01" class="w-full text-[8px]" placeholder="z" data-field="zHeight" value="${m.zHeight ?? ''}">
                    </div>
                </td>
                <td class="px-1 py-1 align-top">
                    <div class="grid grid-cols-4 gap-0.5">
                        <input type="number" step="1" class="w-full text-[8px]" placeholder="Nx" data-field="xNumPoints" value="${m.xNumPoints ?? ''}">
                        <input type="number" step="0.01" class="w-full text-[8px]" placeholder="Dx" data-field="xSpacing" value="${m.xSpacing ?? ''}">
                        <input type="number" step="1" class="w-full text-[8px]" placeholder="Ny" data-field="yNumPoints" value="${m.yNumPoints ?? ''}">
                        <input type="number" step="0.01" class="w-full text-[8px]" placeholder="Dy" data-field="ySpacing" value="${m.ySpacing ?? ''}">
                    </div>
                </td>
                <td class="px-1 py-1 align-top text-right">
                    <button class="btn btn-xxs btn-danger" data-action="delete-map">Delete</button>
                </td>
            `;
            illumTbody.appendChild(tr);
        });

        illumTbody.querySelectorAll('button[data-action="delete-map"]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const row = btn.closest('tr');
                if (row) row.remove();
            });
        });
    }

    function addIlluminanceMapRow() {
        const zones = getZones().map((z) => z.name);
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="px-1 py-1 align-top">
                <input class="w-full text-[8px]" data-field="name" placeholder="Map name">
            </td>
            <td class="px-1 py-1 align-top">
                <select class="w-full text-[8px]" data-field="zoneName">
                    ${zones.map((zn) => `<option value="${zn}">${zn}</option>`).join('')}
                </select>
            </td>
            <td class="px-1 py-1 align-top">
                <div class="grid grid-cols-3 gap-0.5">
                    <input type="number" step="0.01" class="w-full text-[8px]" placeholder="x" data-field="xOrigin">
                    <input type="number" step="0.01" class="w-full text-[8px]" placeholder="y" data-field="yOrigin">
                    <input type="number" step="0.01" class="w-full text-[8px]" placeholder="z" data-field="zHeight">
                </div>
            </td>
            <td class="px-1 py-1 align-top">
                <div class="grid grid-cols-4 gap-0.5">
                    <input type="number" step="1" class="w-full text-[8px]" placeholder="Nx" data-field="xNumPoints">
                    <input type="number" step="0.01" class="w-full text-[8px]" placeholder="Dx" data-field="xSpacing">
                    <input type="number" step="1" class="w-full text-[8px]" placeholder="Ny" data-field="yNumPoints">
                    <input type="number" step="0.01" class="w-full text-[8px]" placeholder="Dy" data-field="ySpacing">
                </div>
            </td>
            <td class="px-1 py-1 align-top text-right">
                <button class="btn btn-xxs btn-danger" data-action="delete-map">Delete</button>
            </td>
        `;
        illumTbody.appendChild(tr);
        const delBtn = tr.querySelector('button[data-action="delete-map"]');
        if (delBtn) {
            delBtn.addEventListener('click', () => tr.remove());
        }
    }


    function collectDaylightingFromUI() {
        const { meta, ep } = getMetaEPDaylighting();
        const zones = getZones().map((z) => z.name);
        const zoneSet = new Set(zones);

        // Controls
        const controls = [];
        controlsTbody.querySelectorAll('tr[data-zone-name]').forEach((tr) => {
            const zn = tr.dataset.zoneName;
            if (!zn || !zoneSet.has(zn)) return;

            const enabled = tr.querySelector('[data-field="enabled"]')?.checked;
            const num = (field) => {
                const el = tr.querySelector(`[data-field="${field}"]`);
                if (!el) return undefined;
                const v = parseFloat(el.value);
                return Number.isFinite(v) ? v : undefined;
            };

            const setpoint = num('setpoint');
            const rp1 = {
                x: num('rp1x'),
                y: num('rp1y'),
                z: num('rp1z'),
            };
            const rp2 = {
                x: num('rp2x'),
                y: num('rp2y'),
                z: num('rp2z'),
            };
            const type = tr.querySelector('[data-field="type"]')?.value || 'Continuous';
            const fractionEl = tr.querySelector('[data-field="fraction"]');
            const fractionVal = fractionEl ? parseFloat(fractionEl.value) : NaN;
            const fraction =
                Number.isFinite(fractionVal) && fractionVal > 0
                    ? Math.max(0, Math.min(1, fractionVal))
                    : undefined;

            const hasRP1 = Number.isFinite(rp1.x) && Number.isFinite(rp1.y) && Number.isFinite(rp1.z);
            const hasRP2 = Number.isFinite(rp2.x) && Number.isFinite(rp2.y) && Number.isFinite(rp2.z);

            if (enabled && hasRP1 && Number.isFinite(setpoint)) {
                const refPoints = [];
                refPoints.push({ x: rp1.x, y: rp1.y, z: rp1.z });
                if (hasRP2) {
                    refPoints.push({ x: rp2.x, y: rp2.y, z: rp2.z });
                }
                const ctrl = {
                    zoneName: zn,
                    enabled: true,
                    refPoints,
                    setpoint,
                    type: type === 'Stepped' || type === 'ContinuousOff' ? type : 'Continuous',
                };
                if (fraction !== undefined) {
                    ctrl.fraction = fraction;
                }
                controls.push(ctrl);
            }
        });

        // Illuminance maps
        const illuminanceMaps = [];
        illumTbody.querySelectorAll('tr').forEach((tr) => {
            const nameEl = tr.querySelector('[data-field="name"]');
            if (!nameEl) return;
            const name = (nameEl.value || '').trim();
            if (!name) return;

            const zoneName = (tr.querySelector('[data-field="zoneName"]')?.value || '').trim();
            if (!zoneName || !zoneSet.has(zoneName)) return;

            const num = (field) => {
                const el = tr.querySelector(`[data-field="${field}"]`);
                if (!el) return NaN;
                const v = parseFloat(el.value);
                return v;
            };

            const xOrigin = num('xOrigin');
            const yOrigin = num('yOrigin');
            const zHeight = num('zHeight');
            const xNumPoints = num('xNumPoints');
            const xSpacing = num('xSpacing');
            const yNumPoints = num('yNumPoints');
            const ySpacing = num('ySpacing');

            if (
                !Number.isFinite(xOrigin) ||
                !Number.isFinite(yOrigin) ||
                !Number.isFinite(zHeight) ||
                !Number.isFinite(xNumPoints) ||
                !Number.isFinite(xSpacing) ||
                !Number.isFinite(yNumPoints) ||
                !Number.isFinite(ySpacing)
            ) {
                return;
            }

            illuminanceMaps.push({
                name,
                zoneName,
                xOrigin,
                yOrigin,
                zHeight,
                xNumPoints,
                xSpacing,
                yNumPoints,
                ySpacing,
            });
        });

        const nextDaylighting = {};
        if (controls.length) {
            nextDaylighting.controls = controls;
        }
        if (illuminanceMaps.length) {
            nextDaylighting.outputs = {
                illuminanceMaps,
            };
        }

        const nextEP = {
            ...ep,
            daylighting: nextDaylighting,
        };

        return { meta, nextEP };
    }

    if (addIllumBtn) {
        addIllumBtn.addEventListener('click', () => {
            addIlluminanceMapRow();
        });
    }

    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            try {
                const { meta, nextEP } = collectDaylightingFromUI();
                if (typeof project.updateMetadata === 'function') {
                    project.updateMetadata({
                        ...meta,
                        energyPlusConfig: nextEP,
                    });
                } else {
                    project.metadata = {
                        ...(project.metadata || meta),
                        energyPlusConfig: nextEP,
                    };
                }
                alert('Daylighting configuration saved.');
            } catch (err) {
                console.error('DaylightingManager: save failed', err);
                alert('Failed to save Daylighting configuration. Check console for details.');
            }
        });
    }

    renderControls();
    renderIlluminanceMaps();

    return panel;
}

/**
 * OUTPUTS MANAGER
 * Manage energyPlusConfig.daylighting.outputs.variables (Output:Variable entries).
 */
function openOutputsManagerPanel() {
    const panelId = 'panel-energyplus-outputs';
    let panel = document.getElementById(panelId);
    if (!panel) {
        panel = createOutputsManagerPanel();
        document.getElementById('window-container').appendChild(panel);
    }
    panel.classList.remove('hidden');
    panel.style.zIndex = getNewZIndex();
}

function createOutputsManagerPanel() {
    const panel = document.createElement('div');
    panel.id = 'panel-energyplus-outputs';
    panel.className = 'floating-window ui-panel resizable-panel';

    panel.innerHTML = `
        <div class="window-header">
            <span>Outputs</span>
            <div class="window-controls">
                <div class="window-icon-max" title="Maximize/Restore"></div>
                <div class="collapse-icon" title="Minimize"></div>
                <div class="window-icon-close" title="Close"></div>
            </div>
        </div>
        <div class="window-content space-y-2">
            <div class="resize-handle-edge top"></div>
            <div class="resize-handle-edge right"></div>
            <div class="resize-handle-edge bottom"></div>
            <div class="resize-handle-edge left"></div>
            <div class="resize-handle-corner top-left"></div>
            <div class="resize-handle-corner top-right"></div>
            <div class="resize-handle-corner bottom-left"></div>
            <div class="resize-handle-corner bottom-right"></div>

            <p class="info-box !text-[10px] !py-1.5 !px-2">
                Configure <code>Output:Variable</code> entries.
                Settings are stored in <code>energyPlusConfig.daylighting.outputs.variables</code>.
            </p>

            <div class="flex justify-between items-center">
                <span class="font-semibold text-[10px] uppercase text-[--text-secondary]">Output Variables</span>
                <button class="btn btn-xxs btn-secondary" data-action="add-output-var">+ Add Variable</button>
            </div>

            <div class="border border-gray-700/70 rounded bg-black/40 max-h-56 overflow-y-auto **scrollable-panel-inner**">
                <table class="w-full text-[8px]">
                    <thead class="bg-black/40">
                        <tr>
                            <th class="px-1 py-1 text-left">Key</th>
                            <th class="px-1 py-1 text-left">Variable Name</th>
                            <th class="px-1 py-1 text-left">Frequency</th>
                            <th class="px-1 py-1 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody class="outputs-vars-tbody"></tbody>
                </table>
            </div>

            <div class="text-[7px] text-[--text-secondary]">
                Examples: Key = zone name or "Environment"; Variable = "Zone Lights Electric Power"; Frequency = Hourly/RunPeriod/etc.
            </div>

            <div class="flex justify-end gap-2">
                <button class="btn btn-xxs btn-secondary" data-action="save-outputs">Save Outputs</button>
            </div>
        </div>
    `;

    if (typeof window !== 'undefined' && window.initializePanelControls) {
        window.initializePanelControls(panel);
    } else {
        const closeButton = panel.querySelector('.window-icon-close');
        if (closeButton) {
            closeButton.onclick = () => panel.classList.add('hidden');
        }
    }

    const tbody = panel.querySelector('.outputs-vars-tbody');
    const addBtn = panel.querySelector('[data-action="add-output-var"]');
    const saveBtn = panel.querySelector('[data-action="save-outputs"]');

    function getState() {
        const meta =
            (typeof project.getMetadata === 'function' && project.getMetadata()) ||
            project.metadata ||
            {};
        const ep = meta.energyPlusConfig || meta.energyplus || {};
        const daylighting = ep.daylighting || {};
        const outputs = daylighting.outputs || {};
        const vars = Array.isArray(outputs.variables) ? outputs.variables.slice() : [];
        return { meta, ep, daylighting, vars };
    }

    function render() {
        const { vars } = getState();
        tbody.innerHTML = '';

        if (!vars.length) {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="px-1 py-1 text-[8px] text-[--text-secondary]" colspan="4">
                    No Output:Variable entries defined.
                </td>
            `;
            tbody.appendChild(tr);
            return;
        }

        vars.forEach((v, index) => {
            const tr = document.createElement('tr');
            tr.dataset.index = String(index);
            tr.innerHTML = `
                <td class="px-1 py-1 align-top">
                    <input class="w-full text-[8px]" data-field="key" value="${v.key || ''}">
                </td>
                <td class="px-1 py-1 align-top">
                    <input class="w-full text-[8px]" data-field="variableName" value="${v.variableName || ''}">
                </td>
                <td class="px-1 py-1 align-top">
                    <select class="w-full text-[8px]" data-field="freq">
                        ${['Timestep','Hourly','Daily','Monthly','RunPeriod'].map((f) => `
                            <option value="${f}"${(v.reportingFrequency || 'Hourly') === f ? ' selected' : ''}>${f}</option>
                        `).join('')}
                    </select>
                </td>
                <td class="px-1 py-1 align-top text-right">
                    <button class="btn btn-xxs btn-danger" data-action="delete-var">Delete</button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        tbody.querySelectorAll('button[data-action="delete-var"]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const row = btn.closest('tr');
                if (row) row.remove();
            });
        });
    }

    function addRow() {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="px-1 py-1 align-top">
                <input class="w-full text-[8px]" data-field="key" placeholder="Key (zone name, Environment, *)">
            </td>
            <td class="px-1 py-1 align-top">
                <input class="w-full text-[8px]" data-field="variableName" placeholder="Variable Name">
            </td>
            <td class="px-1 py-1 align-top">
                <select class="w-full text-[8px]" data-field="freq">
                    <option value="Hourly" selected>Hourly</option>
                    <option value="Timestep">Timestep</option>
                    <option value="Daily">Daily</option>
                    <option value="Monthly">Monthly</option>
                    <option value="RunPeriod">RunPeriod</option>
                </select>
            </td>
            <td class="px-1 py-1 align-top text-right">
                <button class="btn btn-xxs btn-danger" data-action="delete-var">Delete</button>
            </td>
        `;
        tbody.appendChild(tr);
        tr.querySelector('[data-action="delete-var"]').addEventListener('click', () => {
            tr.remove();
        });
    }

    function collect() {
        const { meta, ep, daylighting } = getState();
        const vars = [];
        tbody.querySelectorAll('tr').forEach((tr) => {
            const key = (tr.querySelector('[data-field="key"]')?.value || '').trim();
            const variableName = (tr.querySelector('[data-field="variableName"]')?.value || '').trim();
            const freq = tr.querySelector('[data-field="freq"]')?.value || 'Hourly';
            if (!key || !variableName) return;
            vars.push({
                key,
                variableName,
                reportingFrequency: freq,
            });
        });

        const nextDaylighting = {
            ...daylighting,
            outputs: {
                ...(daylighting.outputs || {}),
                variables: vars,
            },
        };

        const nextEP = {
            ...ep,
            daylighting: nextDaylighting,
        };

        return { meta, nextEP };
    }

    if (addBtn) {
        addBtn.addEventListener('click', () => addRow());
    }

    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            try {
                const { meta, nextEP } = collect();
                if (typeof project.updateMetadata === 'function') {
                    project.updateMetadata({
                        ...meta,
                        energyPlusConfig: nextEP,
                    });
                } else {
                    project.metadata = {
                        ...(project.metadata || meta),
                        energyPlusConfig: nextEP,
                    };
                }
                alert('Outputs configuration saved.');
            } catch (err) {
                console.error('OutputsManager: save failed', err);
                alert('Failed to save Outputs configuration. Check console for details.');
            }
        });
    }

    render();

    return panel;
}

/**
 * ENERGYPLUS SIMULATION CONTROL MANAGER
 * Configure global simulation objects:
 *  - Building
 *  - Timestep
 *  - SimulationControl
 *  - GlobalGeometryRules
 *  - ShadowCalculation
 *  - SurfaceConvectionAlgorithm:Inside/Outside
 *  - HeatBalanceAlgorithm
 *  - SizingPeriod:WeatherFileDays
 *  - RunPeriod
 *  - RunPeriodControl:DaylightSavingTime
 * Values stored in energyPlusConfig.simulationControl.
 */
function openWeatherLocationManagerPanel() {
    const panelId = 'panel-energyplus-weather-location';
    let panel = document.getElementById(panelId);
    if (!panel) {
        panel = createWeatherLocationManagerPanel();
        document.getElementById('window-container').appendChild(panel);
    }
    panel.classList.remove('hidden');
    panel.style.zIndex = getNewZIndex();
}

/**
 * Weather & Location Manager
 * Canonical project-level weather configuration:
 *   energyPlusConfig.weather = {
 *     epwPath?: string,
 *     locationSource?: 'FromEPW' | 'Custom',
 *     customLocation?: {
 *       name: string,
 *       latitude: number,
 *       longitude: number,
 *       timeZone: number,
 *       elevation: number
 *     }
 *   }
 *
 * Backwards compatibility:
 *   - If ep.weatherFilePath exists and weather.epwPath is missing, it is shown as selected EPW.
 */
function createWeatherLocationManagerPanel() {
    const panel = document.createElement('div');
    panel.id = 'panel-energyplus-weather-location';
    panel.className = 'floating-window ui-panel resizable-panel';

    const { meta, ep, weather } = getWeatherConfig();

    const locationSource = weather.locationSource || 'FromEPW';
    const epwPath = weather.epwPath || ep.weatherFilePath || '';
    const cl = weather.customLocation || {};

    panel.innerHTML = `
        <div class="window-header">
            <span>Weather & Location</span>
            <div class="window-controls">
                <div class="window-icon-max" title="Maximize/Restore"></div>
                <div class="collapse-icon" title="Minimize"></div>
                <div class="window-icon-close" title="Close"></div>
            </div>
        </div>
        <div class="window-content space-y-3 text-[8px]">
            <div class="resize-handle-edge top"></div>
            <div class="resize-handle-edge right"></div>
            <div class="resize-handle-edge bottom"></div>
            <div class="resize-handle-edge left"></div>
            <div class="resize-handle-corner top-left"></div>
            <div class="resize-handle-corner top-right"></div>
            <div class="resize-handle-corner bottom-left"></div>
            <div class="resize-handle-corner bottom-right"></div>

            <p class="info-box !text-[9px] !py-1.5 !px-2">
                Configure the project-level EnergyPlus weather file (EPW) and location strategy.
                This configuration is used when generating IDFs and running simulations.
            </p>

            <!-- Project EPW selection -->
            <div class="border border-gray-700/70 rounded bg-black/40 p-2 space-y-1">
                <div class="flex items-center justify-between">
                    <span class="font-semibold text-[9px] uppercase text-[--text-secondary]">
                        Project Weather File (EPW)
                    </span>
                </div>
                <div class="flex items-center gap-2 mt-1">
                    <input
                        type="text"
                        class="w-full text-[8px]"
                        data-field="epw-path"
                        value="${epwPath || ''}"
                        placeholder="No EPW selected"
                        readonly
                    >
                    <button class="btn btn-xxs btn-secondary" data-action="select-epw">
                        Select EPW
                    </button>
                    <button class="btn btn-xxs btn-secondary" data-action="clear-epw">
                        Clear
                    </button>
                </div>
                <div class="text-[7px] text-[--text-secondary] mt-1">
                    The selected EPW is stored in <code>energyPlusConfig.weather.epwPath</code>.
                    If not set, annual simulations will fail validation.
                </div>
                <div class="text-[7px] text-yellow-300" data-role="epw-warning" style="${epwPath ? 'display:none;' : ''}">
                    No EPW is currently configured.
                </div>
            </div>

            <!-- Location source -->
            <div class="border border-gray-700/70 rounded bg-black/40 p-2 space-y-1">
                <div class="font-semibold text-[9px] uppercase text-[--text-secondary]">
                    Location Source
                </div>
                <div class="flex flex-col gap-1 mt-1">
                    <label class="inline-flex items-center gap-1">
                        <input type="radio" name="loc-source" value="FromEPW" data-field="loc-from-epw" ${locationSource === 'Custom' ? '' : 'checked'}>
                        <span class="text-[8px]">From EPW (recommended)</span>
                    </label>
                    <label class="inline-flex items-center gap-1">
                        <input type="radio" name="loc-source" value="Custom" data-field="loc-custom" ${locationSource === 'Custom' ? 'checked' : ''}>
                        <span class="text-[8px]">Custom location (advanced)</span>
                    </label>
                </div>
                <div class="mt-2 grid grid-cols-5 gap-1 text-[8px]" data-role="custom-location-fields" style="${locationSource === 'Custom' ? '' : 'display:none;'}">
                    <div>
                        <label class="label !text-[7px]">Name</label>
                        <input class="w-full" data-field="cl-name" value="${cl.name || ''}" placeholder="MySite">
                    </div>
                    <div>
                        <label class="label !text-[7px]">Lat (°)</label>
                        <input type="number" step="0.01" class="w-full" data-field="cl-lat" value="${cl.latitude ?? ''}">
                    </div>
                    <div>
                        <label class="label !text-[7px]">Lon (°)</label>
                        <input type="number" step="0.01" class="w-full" data-field="cl-lon" value="${cl.longitude ?? ''}">
                    </div>
                    <div>
                        <label class="label !text-[7px]">TZ (hr)</label>
                        <input type="number" step="0.1" class="w-full" data-field="cl-tz" value="${cl.timeZone ?? ''}">
                    </div>
                    <div>
                        <label class="label !text-[7px]">Elev (m)</label>
                        <input type="number" step="0.1" class="w-full" data-field="cl-elev" value="${cl.elevation ?? ''}">
                    </div>
                </div>
                <div class="text-[7px] text-[--text-secondary] mt-1">
                    When using "Custom location", these values override EPW-derived location for IDF generation.
                    All fields are required for a valid custom location.
                </div>
            </div>

            <div class="flex justify-end">
                <button class="btn btn-xxs btn-secondary" data-action="save-weather-location">
                    Save Weather & Location
                </button>
            </div>
        </div>
    `;

    if (typeof window !== 'undefined' && window.initializePanelControls) {
        window.initializePanelControls(panel);
    } else {
        const closeButton = panel.querySelector('.window-icon-close');
        if (closeButton) {
            closeButton.onclick = () => panel.classList.add('hidden');
        }
    }

    const selectBtn = panel.querySelector('[data-action="select-epw"]');
    const clearBtn = panel.querySelector('[data-action="clear-epw"]');
    const saveBtn = panel.querySelector('[data-action="save-weather-location"]');
    const epwInput = panel.querySelector('[data-field="epw-path"]');
    const epwWarning = panel.querySelector('[data-role="epw-warning"]');
    const locFromEpwRadio = panel.querySelector('[data-field="loc-from-epw"]');
    const locCustomRadio = panel.querySelector('[data-field="loc-custom"]');
    const customFields = panel.querySelector('[data-role="custom-location-fields"]');

    function setEpwPath(path) {
        if (!epwInput) return;
        epwInput.value = path || '';
        if (epwWarning) {
            epwWarning.style.display = path ? 'none' : '';
        }
    }

    if (selectBtn) {
        selectBtn.addEventListener('click', async () => {
            // Prefer Electron dialog when available
            if (window.electronAPI && typeof window.electronAPI.openFileDialog === 'function') {
                try {
                    const result = await window.electronAPI.openFileDialog({
                        filters: [{ name: 'EPW files', extensions: ['epw'] }],
                    });
                    if (result && result.filePaths && result.filePaths[0]) {
                        setEpwPath(result.filePaths[0]);
                    }
                } catch (err) {
                    console.error('Weather & Location: EPW selection failed', err);
                    alert('Failed to select EPW via Electron. Check console for details.');
                }
            } else {
                // Browser-only fallback: use an <input type="file"> just to capture the name.
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.epw';
                input.onchange = () => {
                    const file = input.files && input.files[0];
                    if (file) {
                        // In browser builds we cannot rely on absolute paths; store the name as a hint.
                        setEpwPath(file.path || file.name);
                    }
                };
                input.click();
            }
        });
    }

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            setEpwPath('');
        });
    }

    function updateLocationSourceUI() {
        if (!locCustomRadio || !locFromEpwRadio || !customFields) return;
        const useCustom = locCustomRadio.checked;
        customFields.style.display = useCustom ? '' : 'none';
    }

    if (locFromEpwRadio) {
        locFromEpwRadio.addEventListener('change', updateLocationSourceUI);
    }
    if (locCustomRadio) {
        locCustomRadio.addEventListener('change', updateLocationSourceUI);
    }
    updateLocationSourceUI();

    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            try {
                const { meta: m0, ep: ep0 } = getWeatherConfig();

                const nextWeather = {};

                // EPW path
                const epw = (epwInput?.value || '').trim();
                if (epw) {
                    nextWeather.epwPath = epw;
                }

                // Location source
                const useCustom = locCustomRadio && locCustomRadio.checked;
                nextWeather.locationSource = useCustom ? 'Custom' : 'FromEPW';

                if (useCustom) {
                    const name = (panel.querySelector('[data-field="cl-name"]')?.value || '').trim();
                    const lat = parseFloat(panel.querySelector('[data-field="cl-lat"]')?.value || '');
                    const lon = parseFloat(panel.querySelector('[data-field="cl-lon"]')?.value || '');
                    const tz = parseFloat(panel.querySelector('[data-field="cl-tz"]')?.value || '');
                    const elev = parseFloat(panel.querySelector('[data-field="cl-elev"]')?.value || '');

                    if (
                        !name ||
                        !Number.isFinite(lat) ||
                        lat < -90 ||
                        lat > 90 ||
                        !Number.isFinite(lon) ||
                        lon < -180 ||
                        lon > 180 ||
                        !Number.isFinite(tz) ||
                        tz < -12 ||
                        tz > 14 ||
                        !Number.isFinite(elev)
                    ) {
                        alert(
                            'Custom location is incomplete or invalid. Please fill all fields (name, lat, lon, tz, elev) with valid values.'
                        );
                        return;
                    }

                    nextWeather.customLocation = {
                        name,
                        latitude: lat,
                        longitude: lon,
                        timeZone: tz,
                        elevation: elev,
                    };
                }

                const nextEP = {
                    ...ep0,
                    weather: nextWeather,
                };

                if (typeof project.updateMetadata === 'function') {
                    project.updateMetadata({
                        ...m0,
                        energyPlusConfig: nextEP,
                    });
                } else {
                    project.metadata = {
                        ...(project.metadata || m0),
                        energyPlusConfig: nextEP,
                    };
                }

                alert('Weather & Location configuration saved.');
            } catch (err) {
                console.error('Weather & Location: save failed', err);
                alert('Failed to save Weather & Location configuration. Check console for details.');
            }
        });
    }

    return panel;
}

function getWeatherConfig() {
    const meta =
        (typeof project.getMetadata === 'function' && project.getMetadata()) ||
        project.metadata ||
        {};
    const ep = meta.energyPlusConfig || meta.energyplus || {};
    const weather = ep.weather || {};
    return { meta, ep, weather };
}

function openSimulationControlManagerPanel() {
    const panelId = 'panel-energyplus-sim-control';
    let panel = document.getElementById(panelId);
    if (!panel) {
        panel = createSimulationControlManagerPanel();
        document.getElementById('window-container').appendChild(panel);
    }
    panel.classList.remove('hidden');
    panel.style.zIndex = getNewZIndex();
}

function getSimulationControlConfig() {
    const meta =
        (typeof project.getMetadata === 'function' && project.getMetadata()) ||
        project.metadata ||
        {};
    const ep = meta.energyPlusConfig || meta.energyplus || {};
    const sc = ep.simulationControl || {};

    const withDefaults = {
        building: {
            name: sc.building?.name ?? 'OfficeBuilding',
            northAxis: sc.building?.northAxis ?? 0.0,
            terrain: sc.building?.terrain ?? 'City',
            loadsTolerance: sc.building?.loadsTolerance ?? 0.04,
            tempTolerance: sc.building?.tempTolerance ?? 0.4,
            solarDistribution: sc.building?.solarDistribution ?? 'FullInteriorAndExteriorWithReflections',
            maxWarmupDays: sc.building?.maxWarmupDays ?? 25,
            minWarmupDays: sc.building?.minWarmupDays ?? 6,
        },
        timestep: {
            timestepsPerHour: sc.timestep?.timestepsPerHour ?? 4,
        },
        simulationControlFlags: {
            doZoneSizing: sc.simulationControlFlags?.doZoneSizing ?? false,
            doSystemSizing: sc.simulationControlFlags?.doSystemSizing ?? false,
            doPlantSizing: sc.simulationControlFlags?.doPlantSizing ?? false,
            runSizingPeriods: sc.simulationControlFlags?.runSizingPeriods ?? true,
            runWeatherRunPeriods: sc.simulationControlFlags?.runWeatherRunPeriods ?? true,
        },
        globalGeometryRules: {
            startingVertexPosition: sc.globalGeometryRules?.startingVertexPosition ?? 'UpperLeftCorner',
            vertexEntryDirection: sc.globalGeometryRules?.vertexEntryDirection ?? 'Counterclockwise',
            coordinateSystem: sc.globalGeometryRules?.coordinateSystem ?? 'Relative',
        },
        shadowCalculation: {
            calculationFrequency: sc.shadowCalculation?.calculationFrequency ?? 10,
            maxFigures: sc.shadowCalculation?.maxFigures ?? 15000,
            algorithm: sc.shadowCalculation?.algorithm ?? 'ConvexWeilerAtherton',
            skyDiffuseModel: sc.shadowCalculation?.skyDiffuseModel ?? 'SimpleSkyDiffuseModeling',
        },
        surfaceConvection: {
            insideAlgorithm: sc.surfaceConvection?.insideAlgorithm ?? 'TARP',
            outsideAlgorithm: sc.surfaceConvection?.outsideAlgorithm ?? 'DOE-2',
        },
        heatBalanceAlgorithm: {
            algorithm: sc.heatBalanceAlgorithm?.algorithm ?? 'ConductionTransferFunction',
            surfaceTempUpperLimit: sc.heatBalanceAlgorithm?.surfaceTempUpperLimit ?? 200,
            hConvMin: sc.heatBalanceAlgorithm?.hConvMin ?? 0.1,
            hConvMax: sc.heatBalanceAlgorithm?.hConvMax ?? 1000,
        },
        sizingPeriodWeatherFileDays: {
            name: sc.sizingPeriodWeatherFileDays?.name ?? 'Sizing',
            beginMonth: sc.sizingPeriodWeatherFileDays?.beginMonth ?? 1,
            beginDayOfMonth: sc.sizingPeriodWeatherFileDays?.beginDayOfMonth ?? 1,
            endMonth: sc.sizingPeriodWeatherFileDays?.endMonth ?? 12,
            endDayOfMonth: sc.sizingPeriodWeatherFileDays?.endDayOfMonth ?? 31,
            useWeatherFileDaylightSaving: sc.sizingPeriodWeatherFileDays?.useWeatherFileDaylightSaving ?? true,
            useWeatherFileRainSnowIndicators: sc.sizingPeriodWeatherFileDays?.useWeatherFileRainSnowIndicators ?? true,
        },
        runPeriod: {
            name: sc.runPeriod?.name ?? 'Annual_Simulation',
            beginMonth: sc.runPeriod?.beginMonth ?? 1,
            beginDayOfMonth: sc.runPeriod?.beginDayOfMonth ?? 1,
            endMonth: sc.runPeriod?.endMonth ?? 12,
            endDayOfMonth: sc.runPeriod?.endDayOfMonth ?? 31,
            dayOfWeekForStart: sc.runPeriod?.dayOfWeekForStart ?? 'UseWeatherFile',
            useWeatherFileHolidays: sc.runPeriod?.useWeatherFileHolidays ?? false,
            useWeatherFileDaylightSaving: sc.runPeriod?.useWeatherFileDaylightSaving ?? false,
            applyWeekendHolidayRule: sc.runPeriod?.applyWeekendHolidayRule ?? true,
            useWeatherFileRain: sc.runPeriod?.useWeatherFileRain ?? true,
            useWeatherFileSnow: sc.runPeriod?.useWeatherFileSnow ?? true,
            numTimesRunperiodToBeRepeated: sc.runPeriod?.numTimesRunperiodToBeRepeated ?? 1,
        },
        daylightSavingTime: {
            startDate: sc.daylightSavingTime?.startDate ?? '4/1',
            endDate: sc.daylightSavingTime?.endDate ?? '9/30',
        },
    };

    return { meta, ep, sc: withDefaults };
}

function saveSimulationControlConfig(meta, ep, sc) {
    const next = {
        ...ep,
        simulationControl: sc,
    };
    if (typeof project.updateMetadata === 'function') {
        project.updateMetadata({
            ...meta,
            energyPlusConfig: next,
        });
    } else {
        project.metadata = {
            ...(project.metadata || meta),
            energyPlusConfig: next,
        };
    }
}

function createSimulationControlManagerPanel() {
    const panel = document.createElement('div');
    panel.id = 'panel-energyplus-sim-control';
    panel.className = 'floating-window ui-panel resizable-panel';

    const { sc } = getSimulationControlConfig();

    panel.innerHTML = `
        <div class="window-header">
            <span>EnergyPlus Simulation Control</span>
            <div class="window-controls">
                <div class="window-icon-max" title="Maximize/Restore"></div>
                <div class="collapse-icon" title="Minimize"></div>
                <div class="window-icon-close" title="Close"></div>
            </div>
        </div>
        <div class="window-content space-y-3 text-[8px]">
            <div class="resize-handle-edge top"></div>
            <div class="resize-handle-edge right"></div>
            <div class="resize-handle-edge bottom"></div>
            <div class="resize-handle-edge left"></div>
            <div class="resize-handle-corner top-left"></div>
            <div class="resize-handle-corner top-right"></div>
            <div class="resize-handle-corner bottom-left"></div>
            <div class="resize-handle-corner bottom-right"></div>

            <p class="info-box !text-[9px] !py-1.5 !px-2">
                Configure global EnergyPlus simulation settings used when generating the IDF.
                Location is taken from the EPW file and is not configured here.
            </p>

            <!-- Building -->
            <div class="border border-gray-700/70 rounded bg-black/40 p-2 space-y-1">
                <div class="font-semibold text-[9px] uppercase text-[--text-secondary]">Building</div>
                <div class="grid grid-cols-4 gap-1">
                    <div>
                        <label class="label !text-[8px]">Name</label>
                        <input class="w-full" data-field="b-name" value="${sc.building.name}">
                    </div>
                    <div>
                        <label class="label !text-[8px]">North Axis [deg]</label>
                        <input type="number" step="0.1" class="w-full" data-field="b-north" value="${sc.building.northAxis}">
                    </div>
                    <div>
                        <label class="label !text-[8px]">Terrain</label>
                        <select class="w-full" data-field="b-terrain">
                            ${['Ocean','Country','Suburbs','City'].map(t => `
                                <option value="${t}" ${t === sc.building.terrain ? 'selected' : ''}>${t}</option>
                            `).join('')}
                        </select>
                    </div>
                    <div>
                        <label class="label !text-[8px]">Solar Dist.</label>
                        <select class="w-full" data-field="b-solar">
                            ${[
                                'MinimalShadowing',
                                'FullExterior',
                                'FullInteriorAndExterior',
                                'FullInteriorAndExteriorWithReflections'
                            ].map(v => `
                                <option value="${v}" ${v === sc.building.solarDistribution ? 'selected' : ''}>${v}</option>
                            `).join('')}
                        </select>
                    </div>
                </div>
                <div class="grid grid-cols-4 gap-1 mt-1">
                    <div>
                        <label class="label !text-[8px]">Loads Tol.</label>
                        <input type="number" step="0.001" class="w-full" data-field="b-loadsTol" value="${sc.building.loadsTolerance}">
                    </div>
                    <div>
                        <label class="label !text-[8px]">Temp Tol. [°C]</label>
                        <input type="number" step="0.01" class="w-full" data-field="b-tempTol" value="${sc.building.tempTolerance}">
                    </div>
                    <div>
                        <label class="label !text-[8px]">Max Warmup Days</label>
                        <input type="number" class="w-full" data-field="b-maxWarmup" value="${sc.building.maxWarmupDays}">
                    </div>
                    <div>
                        <label class="label !text-[8px]">Min Warmup Days</label>
                        <input type="number" class="w-full" data-field="b-minWarmup" value="${sc.building.minWarmupDays}">
                    </div>
                </div>
            </div>

            <!-- Timestep & SimulationControl -->
            <div class="grid grid-cols-2 gap-2">
                <div class="border border-gray-700/70 rounded bg-black/40 p-2 space-y-1">
                    <div class="font-semibold text-[9px] uppercase text-[--text-secondary]">Timestep</div>
                    <label class="label !text-[8px]">Timesteps per Hour</label>
                    <input type="number" min="1" max="60" class="w-full" data-field="ts-perhour" value="${sc.timestep.timestepsPerHour}">
                </div>
                <div class="border border-gray-700/70 rounded bg-black/40 p-2 space-y-1">
                    <div class="font-semibold text-[9px] uppercase text-[--text-secondary]">Simulation Control</div>
                    <div class="grid grid-cols-2 gap-1">
                        <label class="inline-flex items-center gap-1">
                            <input type="checkbox" data-field="sc-doZone" ${sc.simulationControlFlags.doZoneSizing ? 'checked' : ''}>
                            <span>Do Zone Sizing</span>
                        </label>
                        <label class="inline-flex items-center gap-1">
                            <input type="checkbox" data-field="sc-doSystem" ${sc.simulationControlFlags.doSystemSizing ? 'checked' : ''}>
                            <span>Do System Sizing</span>
                        </label>
                        <label class="inline-flex items-center gap-1">
                            <input type="checkbox" data-field="sc-doPlant" ${sc.simulationControlFlags.doPlantSizing ? 'checked' : ''}>
                            <span>Do Plant Sizing</span>
                        </label>
                        <label class="inline-flex items-center gap-1">
                            <input type="checkbox" data-field="sc-runSizing" ${sc.simulationControlFlags.runSizingPeriods ? 'checked' : ''}>
                            <span>Run Sizing Periods</span>
                        </label>
                        <label class="inline-flex items-center gap-1">
                            <input type="checkbox" data-field="sc-runWeather" ${sc.simulationControlFlags.runWeatherRunPeriods ? 'checked' : ''}>
                            <span>Run Weather Periods</span>
                        </label>
                    </div>
                </div>
            </div>

            <!-- GlobalGeometryRules & ShadowCalculation -->
            <div class="grid grid-cols-2 gap-2">
                <div class="border border-gray-700/70 rounded bg-black/40 p-2 space-y-1">
                    <div class="font-semibold text-[9px] uppercase text-[--text-secondary]">Global Geometry Rules</div>
                    <div>
                        <label class="label !text-[8px]">Starting Vertex Position</label>
                        <select class="w-full" data-field="ggr-start">
                            ${['UpperLeftCorner','UpperRightCorner','LowerLeftCorner','LowerRightCorner'].map(v => `
                                <option value="${v}" ${v === sc.globalGeometryRules.startingVertexPosition ? 'selected' : ''}>${v}</option>
                            `).join('')}
                        </select>
                    </div>
                    <div>
                        <label class="label !text-[8px]">Vertex Entry Direction</label>
                        <select class="w-full" data-field="ggr-dir">
                            ${['Counterclockwise','Clockwise'].map(v => `
                                <option value="${v}" ${v === sc.globalGeometryRules.vertexEntryDirection ? 'selected' : ''}>${v}</option>
                            `).join('')}
                        </select>
                    </div>
                    <div>
                        <label class="label !text-[8px]">Coordinate System</label>
                        <select class="w-full" data-field="ggr-coord">
                            ${['World','Local','Relative'].map(v => `
                                <option value="${v}" ${v === sc.globalGeometryRules.coordinateSystem ? 'selected' : ''}>${v}</option>
                            `).join('')}
                        </select>
                    </div>
                </div>
                <div class="border border-gray-700/70 rounded bg-black/40 p-2 space-y-1">
                    <div class="font-semibold text-[9px] uppercase text-[--text-secondary]">Shadow Calculation</div>
                    <div class="grid grid-cols-2 gap-1">
                        <div>
                            <label class="label !text-[8px]">Calc Frequency</label>
                            <input type="number" class="w-full" data-field="shad-freq" value="${sc.shadowCalculation.calculationFrequency}">
                        </div>
                        <div>
                            <label class="label !text-[8px]">Max Figures</label>
                            <input type="number" class="w-full" data-field="shad-maxfig" value="${sc.shadowCalculation.maxFigures}">
                        </div>
                    </div>
                    <div>
                        <label class="label !text-[8px]">Algorithm</label>
                        <input class="w-full" data-field="shad-alg" value="${sc.shadowCalculation.algorithm}">
                    </div>
                    <div>
                        <label class="label !text-[8px]">Sky Diffuse Model</label>
                        <input class="w-full" data-field="shad-sky" value="${sc.shadowCalculation.skyDiffuseModel}">
                    </div>
                </div>
            </div>

            <!-- Surface Convection & Heat Balance -->
            <div class="grid grid-cols-2 gap-2">
                <div class="border border-gray-700/70 rounded bg-black/40 p-2 space-y-1">
                    <div class="font-semibold text-[9px] uppercase text-[--text-secondary]">Surface Convection</div>
                    <div>
                        <label class="label !text-[8px]">Inside Algorithm</label>
                        <input class="w-full" data-field="conv-in" value="${sc.surfaceConvection.insideAlgorithm}">
                    </div>
                    <div>
                        <label class="label !text-[8px]">Outside Algorithm</label>
                        <input class="w-full" data-field="conv-out" value="${sc.surfaceConvection.outsideAlgorithm}">
                    </div>
                </div>
                <div class="border border-gray-700/70 rounded bg-black/40 p-2 space-y-1">
                    <div class="font-semibold text-[9px] uppercase text-[--text-secondary]">Heat Balance Algorithm</div>
                    <div>
                        <label class="label !text-[8px]">Algorithm</label>
                        <input class="w-full" data-field="hb-alg" value="${sc.heatBalanceAlgorithm.algorithm}">
                    </div>
                    <div class="grid grid-cols-3 gap-1 mt-1">
                        <div>
                            <label class="label !text-[8px]">Surf T max [°C]</label>
                            <input type="number" class="w-full" data-field="hb-tmax" value="${sc.heatBalanceAlgorithm.surfaceTempUpperLimit}">
                        </div>
                        <div>
                            <label class="label !text-[8px]">hConv min</label>
                            <input type="number" step="0.01" class="w-full" data-field="hb-hmin" value="${sc.heatBalanceAlgorithm.hConvMin}">
                        </div>
                        <div>
                            <label class="label !text-[8px]">hConv max</label>
                            <input type="number" class="w-full" data-field="hb-hmax" value="${sc.heatBalanceAlgorithm.hConvMax}">
                        </div>
                    </div>
                </div>
            </div>

            <!-- Sizing Period -->
            <div class="border border-gray-700/70 rounded bg-black/40 p-2 space-y-1">
                <div class="font-semibold text-[9px] uppercase text-[--text-secondary]">SizingPeriod:WeatherFileDays</div>
                <div class="grid grid-cols-6 gap-1">
                    <div>
                        <label class="label !text-[8px]">Name</label>
                        <input class="w-full" data-field="sp-name" value="${sc.sizingPeriodWeatherFileDays.name}">
                    </div>
                    <div>
                        <label class="label !text-[8px]">Begin M</label>
                        <input type="number" min="1" max="12" class="w-full" data-field="sp-bm" value="${sc.sizingPeriodWeatherFileDays.beginMonth}">
                    </div>
                    <div>
                        <label class="label !text-[8px]">Begin D</label>
                        <input type="number" min="1" max="31" class="w-full" data-field="sp-bd" value="${sc.sizingPeriodWeatherFileDays.beginDayOfMonth}">
                    </div>
                    <div>
                        <label class="label !text-[8px]">End M</label>
                        <input type="number" min="1" max="12" class="w-full" data-field="sp-em" value="${sc.sizingPeriodWeatherFileDays.endMonth}">
                    </div>
                    <div>
                        <label class="label !text-[8px]">End D</label>
                        <input type="number" min="1" max="31" class="w-full" data-field="sp-ed" value="${sc.sizingPeriodWeatherFileDays.endDayOfMonth}">
                    </div>
                    <div class="flex flex-col justify-end gap-0.5">
                        <label class="inline-flex items-center gap-1">
                            <input type="checkbox" data-field="sp-dst" ${sc.sizingPeriodWeatherFileDays.useWeatherFileDaylightSaving ? 'checked' : ''}>
                            <span class="whitespace-nowrap">Use WF DST</span>
                        </label>
                        <label class="inline-flex items-center gap-1">
                            <input type="checkbox" data-field="sp-rain" ${sc.sizingPeriodWeatherFileDays.useWeatherFileRainSnowIndicators ? 'checked' : ''}>
                            <span class="whitespace-nowrap">Use WF Rain/Snow</span>
                        </label>
                    </div>
                </div>
            </div>

            <!-- RunPeriod & DST -->
            <div class="grid grid-cols-2 gap-2">
                <div class="border border-gray-700/70 rounded bg-black/40 p-2 space-y-1">
                    <div class="font-semibold text-[9px] uppercase text-[--text-secondary]">RunPeriod</div>
                    <div class="grid grid-cols-4 gap-1">
                        <div class="col-span-2">
                            <label class="label !text-[8px]">Name</label>
                            <input class="w-full" data-field="rp-name" value="${sc.runPeriod.name}">
                        </div>
                        <div>
                            <label class="label !text-[8px]">Begin M</label>
                            <input type="number" min="1" max="12" class="w-full" data-field="rp-bm" value="${sc.runPeriod.beginMonth}">
                        </div>
                        <div>
                            <label class="label !text-[8px]">Begin D</label>
                            <input type="number" min="1" max="31" class="w-full" data-field="rp-bd" value="${sc.runPeriod.beginDayOfMonth}">
                        </div>
                    </div>
                    <div class="grid grid-cols-4 gap-1 mt-1">
                        <div>
                            <label class="label !text-[8px]">End M</label>
                            <input type="number" min="1" max="12" class="w-full" data-field="rp-em" value="${sc.runPeriod.endMonth}">
                        </div>
                        <div>
                            <label class="label !text-[8px]">End D</label>
                            <input type="number" min="1" max="31" class="w-full" data-field="rp-ed" value="${sc.runPeriod.endDayOfMonth}">
                        </div>
                        <div class="col-span-2">
                            <label class="label !text-[8px]">Day of Week / UseWeatherFile</label>
                            <input class="w-full" data-field="rp-dow" value="${sc.runPeriod.dayOfWeekForStart}">
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-1 mt-1">
                        <label class="inline-flex items-center gap-1">
                            <input type="checkbox" data-field="rp-holidays" ${sc.runPeriod.useWeatherFileHolidays ? 'checked' : ''}>
                            <span>Use WF Holidays</span>
                        </label>
                        <label class="inline-flex items-center gap-1">
                            <input type="checkbox" data-field="rp-dst" ${sc.runPeriod.useWeatherFileDaylightSaving ? 'checked' : ''}>
                            <span>Use WF DST</span>
                        </label>
                        <label class="inline-flex items-center gap-1">
                            <input type="checkbox" data-field="rp-weekend" ${sc.runPeriod.applyWeekendHolidayRule ? 'checked' : ''}>
                            <span>Weekend Holiday Rule</span>
                        </label>
                        <label class="inline-flex items-center gap-1">
                            <input type="checkbox" data-field="rp-rain" ${sc.runPeriod.useWeatherFileRain ? 'checked' : ''}>
                            <span>Use WF Rain</span>
                        </label>
                        <label class="inline-flex items-center gap-1">
                            <input type="checkbox" data-field="rp-snow" ${sc.runPeriod.useWeatherFileSnow ? 'checked' : ''}>
                            <span>Use WF Snow</span>
                        </label>
                        <div>
                            <label class="label !text-[8px]">Repeat Count</label>
                            <input type="number" min="1" class="w-full" data-field="rp-repeat" value="${sc.runPeriod.numTimesRunperiodToBeRepeated}">
                        </div>
                    </div>
                </div>
                <div class="border border-gray-700/70 rounded bg-black/40 p-2 space-y-1">
                    <div class="font-semibold text-[9px] uppercase text-[--text-secondary]">RunPeriodControl:DaylightSavingTime</div>
                    <div class="grid grid-cols-2 gap-1">
                        <div>
                            <label class="label !text-[8px]">Start Date (M/D)</label>
                            <input class="w-full" data-field="dst-start" value="${sc.daylightSavingTime.startDate}">
                        </div>
                        <div>
                            <label class="label !text-[8px]">End Date (M/D)</label>
                            <input class="w-full" data-field="dst-end" value="${sc.daylightSavingTime.endDate}">
                        </div>
                    </div>
                </div>
            </div>

            <div class="flex justify-end">
                <button class="btn btn-xxs btn-secondary" data-action="save-sim-control">Save Simulation Control</button>
            </div>
        </div>
    `;

    if (typeof window !== 'undefined' && window.initializePanelControls) {
        window.initializePanelControls(panel);
    } else {
        const closeButton = panel.querySelector('.window-icon-close');
        if (closeButton) {
            closeButton.onclick = () => panel.classList.add('hidden');
        }
    }

    const saveBtn = panel.querySelector('[data-action="save-sim-control"]');
    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            try {
                const { meta, ep } = getSimulationControlConfig();
                const root = panel;

                const num = (sel) => {
                    const el = root.querySelector(sel);
                    if (!el) return undefined;
                    const v = parseFloat(el.value);
                    return Number.isFinite(v) ? v : undefined;
                };
                const str = (sel) => {
                    const el = root.querySelector(sel);
                    if (!el) return '';
                    return (el.value || '').trim();
                };
                const bool = (sel) => {
                    const el = root.querySelector(sel);
                    return !!(el && el.checked);
                };

                const sim = {
                    building: {
                        name: str('[data-field="b-name"]') || 'OfficeBuilding',
                        northAxis: num('[data-field="b-north"]') ?? 0,
                        terrain: str('[data-field="b-terrain"]') || 'City',
                        loadsTolerance: num('[data-field="b-loadsTol"]') ?? 0.04,
                        tempTolerance: num('[data-field="b-tempTol"]') ?? 0.4,
                        solarDistribution: str('[data-field="b-solar"]') || 'FullInteriorAndExteriorWithReflections',
                        maxWarmupDays: num('[data-field="b-maxWarmup"]') ?? 25,
                        minWarmupDays: num('[data-field="b-minWarmup"]') ?? 6,
                    },
                    timestep: {
                        timestepsPerHour: num('[data-field="ts-perhour"]') ?? 4,
                    },
                    simulationControlFlags: {
                        doZoneSizing: bool('[data-field="sc-doZone"]'),
                        doSystemSizing: bool('[data-field="sc-doSystem"]'),
                        doPlantSizing: bool('[data-field="sc-doPlant"]'),
                        runSizingPeriods: bool('[data-field="sc-runSizing"]'),
                        runWeatherRunPeriods: bool('[data-field="sc-runWeather"]'),
                    },
                    globalGeometryRules: {
                        startingVertexPosition: str('[data-field="ggr-start"]') || 'UpperLeftCorner',
                        vertexEntryDirection: str('[data-field="ggr-dir"]') || 'Counterclockwise',
                        coordinateSystem: str('[data-field="ggr-coord"]') || 'Relative',
                    },
                    shadowCalculation: {
                        calculationFrequency: num('[data-field="shad-freq"]') ?? 10,
                        maxFigures: num('[data-field="shad-maxfig"]') ?? 15000,
                        algorithm: str('[data-field="shad-alg"]') || 'ConvexWeilerAtherton',
                        skyDiffuseModel: str('[data-field="shad-sky"]') || 'SimpleSkyDiffuseModeling',
                    },
                    surfaceConvection: {
                        insideAlgorithm: str('[data-field="conv-in"]') || 'TARP',
                        outsideAlgorithm: str('[data-field="conv-out"]') || 'DOE-2',
                    },
                    heatBalanceAlgorithm: {
                        algorithm: str('[data-field="hb-alg"]') || 'ConductionTransferFunction',
                        surfaceTempUpperLimit: num('[data-field="hb-tmax"]') ?? 200,
                        hConvMin: num('[data-field="hb-hmin"]') ?? 0.1,
                        hConvMax: num('[data-field="hb-hmax"]') ?? 1000,
                    },
                    sizingPeriodWeatherFileDays: {
                        name: str('[data-field="sp-name"]') || 'Sizing',
                        beginMonth: num('[data-field="sp-bm"]') ?? 1,
                        beginDayOfMonth: num('[data-field="sp-bd"]') ?? 1,
                        endMonth: num('[data-field="sp-em"]') ?? 12,
                        endDayOfMonth: num('[data-field="sp-ed"]') ?? 31,
                        useWeatherFileDaylightSaving: bool('[data-field="sp-dst"]'),
                        useWeatherFileRainSnowIndicators: bool('[data-field="sp-rain"]'),
                    },
                    runPeriod: {
                        name: str('[data-field="rp-name"]') || 'Annual_Simulation',
                        beginMonth: num('[data-field="rp-bm"]') ?? 1,
                        beginDayOfMonth: num('[data-field="rp-bd"]') ?? 1,
                        endMonth: num('[data-field="rp-em"]') ?? 12,
                        endDayOfMonth: num('[data-field="rp-ed"]') ?? 31,
                        dayOfWeekForStart: str('[data-field="rp-dow"]') || 'UseWeatherFile',
                        useWeatherFileHolidays: bool('[data-field="rp-holidays"]'),
                        useWeatherFileDaylightSaving: bool('[data-field="rp-dst"]'),
                        applyWeekendHolidayRule: bool('[data-field="rp-weekend"]'),
                        useWeatherFileRain: bool('[data-field="rp-rain"]'),
                        useWeatherFileSnow: bool('[data-field="rp-snow"]'),
                        numTimesRunperiodToBeRepeated: num('[data-field="rp-repeat"]') ?? 1,
                    },
                    daylightSavingTime: {
                        startDate: str('[data-field="dst-start"]') || '4/1',
                        endDate: str('[data-field="dst-end"]') || '9/30',
                    },
                };

                saveSimulationControlConfig(meta, ep, sim);
                alert('EnergyPlus Simulation Control configuration saved.');
            } catch (err) {
                console.error('SimulationControlManager: save failed', err);
                alert('Failed to save Simulation Control configuration. Check console for details.');
            }
        });
    }

    return panel;
}

function getNewZIndex() {
    const allWindows = document.querySelectorAll('.floating-window');
    let maxZ = 100;
    allWindows.forEach((win) => {
        const z = parseInt(win.style.zIndex, 10);
        if (z > maxZ) maxZ = z;
    });
    return maxZ + 1;
}

export { initializeEnergyPlusSidebar };
