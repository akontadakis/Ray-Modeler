// scripts/energyplusSidebar.js
import { getDom } from './dom.js';
import { project } from './project.js';
/* EnergyPlus contextual help disabled */

let dom;

const recipes = {
    "Annual Energy Simulation": {
        description: "Runs a full annual energy simulation using EnergyPlus.",
        id: "annual-energy-simulation",
        scriptName: "run-energyplus.sh",
        params: [
            { id: "idf-file", name: "IDF File (optional, defaults to generated model.idf)", type: "file", accept: ".idf" },
            { id: "epw-file", name: "EPW File", type: "file", accept: ".epw" },
            { id: "eplus-exe", name: "EnergyPlus Executable Path", type: "text" }
        ]
    },
    "Heating Design Day": {
        description: "Calculates heating loads for a design day.",
        id: "heating-design-day",
        scriptName: "run-heating-design.sh",
        params: [
            { id: "idf-file", name: "IDF File", type: "file", accept: ".idf" }
        ]
    },
    "Cooling Design Day": {
        description: "Calculates cooling loads for a design day.",
        id: "cooling-design-day",
        scriptName: "run-cooling-design.sh",
        params: [
            { id: "idf-file", name: "IDF File", type: "file", accept: ".idf" }
        ]
    }
};

function initializeEnergyPlusSidebar() {
    dom = getDom();
    const panel = dom['panel-energyplus'];
    if (!panel) return;

    // Ensure base content exists
    let content = panel.querySelector('.window-content');
    if (!content) {
        content = document.createElement('div');
        content.className = 'window-content';
        panel.appendChild(content);
    }

    // Ensure recipe list container
    let recipeListContainer = content.querySelector('.recipe-list');
    if (!recipeListContainer) {
        content.innerHTML = `
            <div class="space-y-4">
                <div class="flex items-center justify-between">
                    <h3 class="font-semibold text-sm uppercase">EnergyPlus Simulations</h3>
                </div>
                <div class="recipe-list space-y-2"></div>
                <div class="materials-manager-entry space-y-1">
                    <div class="flex items-center justify-between">
                        <h3 class="font-semibold text-[10px] uppercase text-[--text-secondary]">Configuration Panels</h3>
                    </div>
                    <button class="btn btn-xs btn-secondary w-full" data-action="open-materials-manager">
                        EnergyPlus Materials
                    </button>
                    <button class="btn btn-xs btn-secondary w-full mt-1" data-action="open-constructions-manager">
                        EnergyPlus Constructions
                    </button>
                    <button class="btn btn-xs btn-secondary w-full mt-1" data-action="open-schedules-manager">
                        EnergyPlus Schedules
                    </button>
                    <button class="btn btn-xs btn-secondary w-full mt-1" data-action="open-zone-loads-manager">
                        Zone Loads / Thermostats / IdealLoads
                    </button>
                    <button class="btn btn-xs btn-secondary w-full mt-1" data-action="open-daylighting-manager">
                        Daylighting & Outputs
                    </button>
                </div>
            </div>
        `;
        recipeListContainer = content.querySelector('.recipe-list');
    } else {
        // Inject Materials manager entry if not present
        if (!content.querySelector('[data-action="open-materials-manager"]') &&
            !content.querySelector('[data-action="open-constructions-manager"]') &&
            !content.querySelector('[data-action="open-schedules-manager"]')) {
            const cfgBlock = document.createElement('div');
            cfgBlock.className = 'materials-manager-entry space-y-1 mt-3';
            cfgBlock.innerHTML = `
                <h3 class="font-semibold text-[10px] uppercase text-[--text-secondary]">Configuration Panels</h3>
                <button class="btn btn-xs btn-secondary w-full" data-action="open-materials-manager">
                    EnergyPlus Materials
                </button>
                <button class="btn btn-xs btn-secondary w-full mt-1" data-action="open-constructions-manager">
                    EnergyPlus Constructions
                </button>
                <button class="btn btn-xs btn-secondary w-full mt-1" data-action="open-schedules-manager">
                    EnergyPlus Schedules
                </button>
            `;
            content.appendChild(cfgBlock);
        }
    }

    populateRecipeList();

    // Wire Materials Manager button
    const helpSimBtn = content.querySelector('[data-action="open-help-simulations"]');
    if (helpSimBtn) {
        // helpSimBtn click (EnergyPlus contextual help) disabled by request
        // helpSimBtn.addEventListener('click', () => openHelpPanel('simulations/run'));
    }

    const helpCfgBtn = content.querySelector('[data-action="open-help-config-overview"]');
    if (helpCfgBtn) {
        // helpCfgBtn click (EnergyPlus contextual help) disabled by request
        // helpCfgBtn.addEventListener('click', () => openHelpPanel('config/overview'));
    }

    const materialsBtn = content.querySelector('[data-action="open-materials-manager"]');
    if (materialsBtn) {
        materialsBtn.addEventListener('click', () => {
            openMaterialsManagerPanel();
        });
    }
    const constructionsBtn = content.querySelector('[data-action="open-constructions-manager"]');
    if (constructionsBtn) {
        constructionsBtn.addEventListener('click', () => {
            openConstructionsManagerPanel();
        });
    }
    const schedulesBtn = content.querySelector('[data-action="open-schedules-manager"]');
    if (schedulesBtn) {
        schedulesBtn.addEventListener('click', () => {
            openSchedulesManagerPanel();
        });
    }
    const zoneLoadsBtn = content.querySelector('[data-action="open-zone-loads-manager"]');
    if (zoneLoadsBtn) {
        zoneLoadsBtn.addEventListener('click', () => {
            openZoneLoadsManagerPanel();
        });
    }
    const daylightingBtn = content.querySelector('[data-action="open-daylighting-manager"]');
    if (daylightingBtn) {
        daylightingBtn.addEventListener('click', () => {
            openDaylightingManagerPanel();
        });
    }

    // Wire help buttons inside Configuration Panels block (delegated here for convenience)
    content
        .querySelectorAll('[data-action="open-materials-manager"]')
        .forEach((btn) => {
            // Left-click opens the manager panel
            btn.addEventListener('click', () => {
                openMaterialsManagerPanel();
            });
            // Right-click opens contextual help
            btn.addEventListener('contextmenu', (ev) => {
                // Materials help disabled
                ev.preventDefault();
                // openHelpPanel('config/materials');
            });
        });

    content
        .querySelectorAll('[data-action="open-constructions-manager"]')
        .forEach((btn) => {
            btn.addEventListener('click', () => {
                openConstructionsManagerPanel();
            });
            btn.addEventListener('contextmenu', (ev) => {
                // Constructions help disabled
                ev.preventDefault();
                // openHelpPanel('config/constructions');
            });
        });

    content
        .querySelectorAll('[data-action="open-schedules-manager"]')
        .forEach((btn) => {
            btn.addEventListener('click', () => {
                openSchedulesManagerPanel();
            });
            btn.addEventListener('contextmenu', (ev) => {
                // Schedules help disabled
                ev.preventDefault();
                // openHelpPanel('config/schedules');
            });
        });

    content
        .querySelectorAll('[data-action="open-zone-loads-manager"]')
        .forEach((btn) => {
            btn.addEventListener('click', () => {
                openZoneLoadsManagerPanel();
            });
            btn.addEventListener('contextmenu', (ev) => {
                // Loads help disabled
                ev.preventDefault();
                // openHelpPanel('config/loads');
            });
        });

    content
        .querySelectorAll('[data-action="open-daylighting-manager"]')
        .forEach((btn) => {
            btn.addEventListener('click', () => {
                openDaylightingManagerPanel();
            });
            btn.addEventListener('contextmenu', (ev) => {
                // Daylighting help disabled
                ev.preventDefault();
                // openHelpPanel('config/daylighting');
            });
        });
}

function populateRecipeList() {
    const recipeList = dom['panel-energyplus'].querySelector('.recipe-list');
    recipeList.innerHTML = '';
    for (const name in recipes) {
        const recipe = recipes[name];
        const button = document.createElement('button');
        button.className = 'btn btn-secondary w-full';
        button.textContent = name;
        button.onclick = () => openRecipePanel(recipe);
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

function createRecipePanel(recipe) {
    const panel = document.createElement('div');
    panel.id = `panel-${recipe.id}`;
    panel.className = 'floating-window ui-panel resizable-panel';
    panel.dataset.scriptName = recipe.scriptName;

    let paramsHtml = '';
    recipe.params.forEach(param => {
        paramsHtml += `
            <div>
                <label class="label" for="${param.id}">${param.name}</label>
                <input type="${param.type}" id="${param.id}" ${param.accept ? `accept="${param.accept}"` : ''} class="w-full text-sm">
            </div>
        `;
    });

    const isAnnual = recipe.id === 'annual-energy-simulation';

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
            ${isAnnual ? `
            <button class="btn btn-secondary w-full" data-action="generate-idf-from-project">
                Generate IDF from current Ray-Modeler project
            </button>
            <p class="text-[9px] text-[--text-secondary] mt-1">
                IDF generation uses the current <code>energyPlusConfig</code>.
                Use the EnergyPlus configuration panels (Materials, Constructions, Schedules, Zone Loads / IdealLoads, Daylighting & Outputs)
                in the sidebar to manage these settings.
            </p>
            ` : ''}
            ${paramsHtml}
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
        runBtn.addEventListener('click', () => {
            if (!window.electronAPI) {
                if (outputConsole) {
                    outputConsole.textContent += 'Electron environment not detected. Please run via Electron or use generated scripts.\n';
                }
                alert('EnergyPlus can only be run directly inside the Electron app. In browser, use generated scripts manually.');
                return;
            }

            const idfInput = panel.querySelector('#idf-file');
            const epwInput = panel.querySelector('#epw-file');
            const exeInput = panel.querySelector('#eplus-exe');

            const idfPath = idfInput && idfInput.files && idfInput.files[0]
                ? idfInput.files[0].path || idfInput.files[0].name
                : 'model.idf'; // fallback: use generated IDF in project folder

            const epwPath = epwInput && epwInput.files && epwInput.files[0]
                ? epwInput.files[0].path || epwInput.files[0].name
                : null;

            const energyPlusPath = exeInput && exeInput.value
                ? exeInput.value.trim()
                : null;

            if (!epwPath) {
                alert('Select an EPW weather file before running.');
                return;
            }

            if (!energyPlusPath) {
                alert('Specify the EnergyPlus executable path.');
                return;
            }

            if (outputConsole) {
                outputConsole.textContent = `Running EnergyPlus...\nIDF: ${idfPath}\nEPW: ${epwPath}\nExe: ${energyPlusPath}\n\n`;
            }

            window.electronAPI.runEnergyPlus({
                idfPath,
                epwPath,
                energyPlusPath
            });

            window.electronAPI.onEnergyPlusOutput((data) => {
                if (outputConsole) {
                    outputConsole.textContent += data;
                    outputConsole.scrollTop = outputConsole.scrollHeight;
                }
            });

            window.electronAPI.onEnergyPlusExit((code) => {
                if (outputConsole) {
                    outputConsole.textContent += `\n--- EnergyPlus exited with code: ${code} ---\n`;
                    outputConsole.scrollTop = outputConsole.scrollHeight;
                }
            });
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
 * ENERGYPLUS ZONE LOADS / THERMOSTATS / IDEALLOADS MANAGER
 * Per-zone control panel, backed by energyPlusConfig.zoneLoads, thermostats, idealLoads.
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
            <span>Zone Loads / Thermostats / IdealLoads</span>
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
                Configure per-zone internal loads, thermostat setpoints, and IdealLoads overrides.
                Values are stored in <code>energyPlusConfig.zoneLoads</code>, <code>energyPlusConfig.thermostats</code>, and <code>energyPlusConfig.idealLoads</code>.
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
                <div class="grid grid-cols-4 gap-1 mt-1 text-[8px]">
                    <div>
                        <label class="label !text-[8px]">IL Avail Sched (GLOBAL)</label>
                        <select class="w-full text-[8px]" data-template="ilAvail"></select>
                    </div>
                    <div>
                        <label class="label !text-[8px]">Heat Cap [W] (GLOBAL)</label>
                        <input type="number" step="10" class="w-full text-[8px]" data-template="ilHeatCap">
                    </div>
                    <div>
                        <label class="label !text-[8px]">Cool Cap [W] (GLOBAL)</label>
                        <input type="number" step="10" class="w-full text-[8px]" data-template="ilCoolCap">
                    </div>
                    <div>
                        <label class="label !text-[8px]">OA Method (GLOBAL)</label>
                        <select class="w-full text-[8px]" data-template="ilOaMethod">
                            <option value="">(inherit)</option>
                            <option value="None">None</option>
                            <option value="Sum">Sum</option>
                            <option value="Flow/Person">Flow/Person</option>
                            <option value="Flow/Area">Flow/Area</option>
                        </select>
                    </div>
                </div>
                <div class="grid grid-cols-4 gap-1 mt-1 text-[8px]">
                    <div>
                        <label class="label !text-[8px]">OA [L/s.person] (GLOBAL)</label>
                        <input type="number" step="0.01" class="w-full text-[8px]" data-template="ilOaPerPerson">
                    </div>
                    <div>
                        <label class="label !text-[8px]">OA [L/s.m²] (GLOBAL)</label>
                        <input type="number" step="0.01" class="w-full text-[8px]" data-template="ilOaPerArea">
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
                            <th class="px-1 py-1 text-left">Tstat Heat/Cool Sched</th>
                            <th class="px-1 py-1 text-left">IdealLoads (Avail / Caps / OA)</th>
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
                    <li>Thermostats use one GLOBAL entry plus optional per-zone overrides.</li>
                    <li>IdealLoads uses <code>idealLoads.global</code> and optional <code>idealLoads.perZone</code> overrides.</li>
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

        let globalTstat = null;
        const tstatPerZone = new Map();
        if (Array.isArray(ep.thermostats)) {
            ep.thermostats.forEach((t) => {
                if (!t) return;
                const zn = (t.zoneName || '').toString();
                if (!zn || zn.toUpperCase() === 'GLOBAL') {
                    if (!globalTstat) {
                        globalTstat = {
                            zoneName: 'GLOBAL',
                            heatingScheduleName: t.heatingScheduleName,
                            coolingScheduleName: t.coolingScheduleName,
                        };
                    }
                } else if (!tstatPerZone.has(zn)) {
                    tstatPerZone.set(zn, {
                        zoneName: zn,
                        heatingScheduleName: t.heatingScheduleName,
                        coolingScheduleName: t.coolingScheduleName,
                    });
                }
            });
        }

        const idealGlobal = (ep.idealLoads && ep.idealLoads.global) || {};
        const idealPerZone = new Map();
        if (ep.idealLoads && Array.isArray(ep.idealLoads.perZone)) {
            ep.idealLoads.perZone.forEach((c) => {
                if (c && c.zoneName) {
                    idealPerZone.set(String(c.zoneName), { ...c });
                }
            });
        }

        return { zoneLoadsIndex, globalTstat, tstatPerZone, idealGlobal, idealPerZone };
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
        const { zoneLoadsIndex, globalTstat, tstatPerZone, idealGlobal, idealPerZone } =
            buildIndexes(ep);

        // Template selects
        fillTemplateScheduleOptions(ep);

        tbody.innerHTML = '';
        zones.forEach((z) => {
            const zn = String(z.name);
            const zl = zoneLoadsIndex.get(zn) || {};
            const tstat = tstatPerZone.get(zn) || {};
            const idealZ = idealPerZone.get(zn) || {};

            const effHeatT =
                tstat.heatingScheduleName || globalTstat?.heatingScheduleName || '';
            const effCoolT =
                tstat.coolingScheduleName || globalTstat?.coolingScheduleName || '';

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

                <td class="px-1 py-1 align-top">
                    <select class="w-full text-[8px] mb-0.5" data-field="tstatHeatOverride">
                        ${schedOptions(tstat.heatingScheduleName || '')}
                    </select>
                    <select class="w-full text-[8px]" data-field="tstatCoolOverride">
                        ${schedOptions(tstat.coolingScheduleName || '')}
                    </select>
                    <div class="text-[7px] text-[--text-secondary]">
                        Blank = use GLOBAL or no control.
                    </div>
                </td>

                <td class="px-1 py-1 align-top">
                    <select class="w-full text-[8px] mb-0.5" data-field="idealAvail">
                        ${schedOptions(idealZ.availabilitySchedule || '')}
                    </select>
                    <div class="grid grid-cols-2 gap-0.5 mt-0.5">
                        <input type="number" step="10"
                            class="w-full text-[8px]"
                            placeholder="Heat cap W (override)"
                            data-field="idealHeatCap"
                            value="${idealZ.maxHeatingCapacity ?? ''}">
                        <input type="number" step="10"
                            class="w-full text-[8px]"
                            placeholder="Cool cap W (override)"
                            data-field="idealCoolCap"
                            value="${idealZ.maxCoolingCapacity ?? ''}">
                    </div>
                    <select class="w-full text-[8px] mt-0.5" data-field="idealOaMethod">
                        ${oaMethodOptions(idealZ.outdoorAirMethod || '')}
                    </select>
                    <div class="grid grid-cols-2 gap-0.5 mt-0.5">
                        <input type="number" step="0.001"
                            class="w-full text-[8px]"
                            placeholder="OA L/s.person (override)"
                            data-field="idealOaPerPerson"
                            value="${idealZ.outdoorAirFlowPerPerson != null ? idealZ.outdoorAirFlowPerPerson * 1000.0 : ''}">
                        <input type="number" step="0.001"
                            class="w-full text-[8px]"
                            placeholder="OA L/s.m² (override)"
                            data-field="idealOaPerArea"
                            value="${idealZ.outdoorAirFlowPerArea != null ? idealZ.outdoorAirFlowPerArea * 1000.0 : ''}">
                    </div>
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
        const perZoneTstats = [];
        const perZoneIdeal = [];

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

            const tHeat = str('[data-field="tstatHeatOverride"]');
            const tCool = str('[data-field="tstatCoolOverride"]');
            if (tHeat || tCool) {
                perZoneTstats.push({
                    zoneName: zn,
                    heatingScheduleName: tHeat,
                    coolingScheduleName: tCool,
                });
            }

            const idealAvail = str('[data-field="idealAvail"]');
            const idealHeatCap = num('[data-field="idealHeatCap"]');
            const idealCoolCap = num('[data-field="idealCoolCap"]');
            const idealOaMethod = str('[data-field="idealOaMethod"]');
            const idealOaPerPerson_Ls = num('[data-field="idealOaPerPerson"]');
            const idealOaPerArea_Ls = num('[data-field="idealOaPerArea"]');

            if (
                idealAvail ||
                idealHeatCap != null ||
                idealCoolCap != null ||
                idealOaMethod ||
                idealOaPerPerson_Ls != null ||
                idealOaPerArea_Ls != null
            ) {
                const cfg = { zoneName: zn };
                if (idealAvail) cfg.availabilitySchedule = idealAvail;
                if (idealHeatCap != null) {
                    cfg.heatingLimitType = 'LimitCapacity';
                    cfg.maxHeatingCapacity = idealHeatCap;
                }
                if (idealCoolCap != null) {
                    cfg.coolingLimitType = 'LimitCapacity';
                    cfg.maxCoolingCapacity = idealCoolCap;
                }
                if (idealOaMethod) cfg.outdoorAirMethod = idealOaMethod;
                if (idealOaPerPerson_Ls != null) {
                    cfg.outdoorAirFlowPerPerson = idealOaPerPerson_Ls / 1000.0;
                }
                if (idealOaPerArea_Ls != null) {
                    cfg.outdoorAirFlowPerArea = idealOaPerArea_Ls / 1000.0;
                }
                perZoneIdeal.push(cfg);
            }
        });

        // Template-driven GLOBAL thermostat and IdealLoads
        const tmpl = collectTemplateValues();
        const nextThermostats = [];
        if (tmpl.heatSpSched || tmpl.coolSpSched) {
            nextThermostats.push({
                zoneName: 'GLOBAL',
                heatingScheduleName: tmpl.heatSpSched,
                coolingScheduleName: tmpl.coolSpSched,
            });
        }

        perZoneTstats.forEach((t) => {
            const heat = t.heatingScheduleName;
            const cool = t.coolingScheduleName;
            if (heat || cool) {
                nextThermostats.push({
                    zoneName: t.zoneName,
                    heatingScheduleName: heat,
                    coolingScheduleName: cool,
                });
            }
        });

        const existingIdeal = ep.idealLoads || {};
        const globalIdeal = { ...(existingIdeal.global || {}) };

        // Global availability schedule
        if (tmpl.ilAvail !== undefined) {
            if (tmpl.ilAvail) {
                globalIdeal.availabilitySchedule = tmpl.ilAvail;
            } else {
                delete globalIdeal.availabilitySchedule;
            }
        }

        // Global heating capacity
        if (tmpl.ilHeatCap !== undefined) {
            if (Number.isFinite(tmpl.ilHeatCap)) {
                globalIdeal.heatingLimitType = 'LimitCapacity';
                globalIdeal.maxHeatingCapacity = tmpl.ilHeatCap;
            } else {
                globalIdeal.heatingLimitType = 'NoLimit';
                delete globalIdeal.maxHeatingCapacity;
            }
        }

        // Global cooling capacity
        if (tmpl.ilCoolCap !== undefined) {
            if (Number.isFinite(tmpl.ilCoolCap)) {
                globalIdeal.coolingLimitType = 'LimitCapacity';
                globalIdeal.maxCoolingCapacity = tmpl.ilCoolCap;
            } else {
                globalIdeal.coolingLimitType = 'NoLimit';
                delete globalIdeal.maxCoolingCapacity;
            }
        }

        // Global OA method
        if (tmpl.ilOaMethod !== undefined) {
            if (tmpl.ilOaMethod) {
                globalIdeal.outdoorAirMethod = tmpl.ilOaMethod;
            } else {
                delete globalIdeal.outdoorAirMethod;
            }
        }

        // Global OA flows (L/s → m3/s)
        if (tmpl.ilOaPerPerson !== undefined) {
            if (Number.isFinite(tmpl.ilOaPerPerson) && tmpl.ilOaPerPerson > 0) {
                globalIdeal.outdoorAirFlowPerPerson = tmpl.ilOaPerPerson / 1000.0;
            } else {
                delete globalIdeal.outdoorAirFlowPerPerson;
            }
        }
        if (tmpl.ilOaPerArea !== undefined) {
            if (Number.isFinite(tmpl.ilOaPerArea) && tmpl.ilOaPerArea > 0) {
                globalIdeal.outdoorAirFlowPerArea = tmpl.ilOaPerArea / 1000.0;
            } else {
                delete globalIdeal.outdoorAirFlowPerArea;
            }
        }

        const cleanedGlobalIdeal =
            Object.keys(globalIdeal).length > 0 ? globalIdeal : existingIdeal.global || {};

        const nextIdealLoads = {
            global: cleanedGlobalIdeal,
            perZone: perZoneIdeal,
        };

        // Filter out thermostats / perZone configs for zones that no longer exist
        const zoneSet = new Set(zones);
        const filteredThermostats = nextThermostats.filter((t) => {
            if (!t) return false;
            if (!t.zoneName) return false;
            if (t.zoneName.toUpperCase() === 'GLOBAL') return true;
            return zoneSet.has(String(t.zoneName));
        });
        const filteredPerZoneIdeal = nextIdealLoads.perZone.filter((c) =>
            c && c.zoneName && zoneSet.has(String(c.zoneName))
        );

        const nextConfig = {
            ...ep,
            zoneLoads: nextZoneLoads,
            thermostats: filteredThermostats,
            idealLoads: {
                global: nextIdealLoads.global,
                perZone: filteredPerZoneIdeal,
            },
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
                alert('Zone loads, thermostats, and IdealLoads configuration saved.');
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
 * DAYLIGHTING & OUTPUTS MANAGER
 * Manage energyPlusConfig.daylighting.controls and .outputs (IlluminanceMaps, Output:Variable).
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

function createDaylightingManagerPanel() {
    const panel = document.createElement('div');
    panel.id = 'panel-energyplus-daylighting';
    panel.className = 'floating-window ui-panel resizable-panel';

    panel.innerHTML = `
        <div class="window-header">
            <span>Daylighting & Outputs</span>
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
                Configure per-zone <code>Daylighting:Controls</code>, <code>Output:IlluminanceMap</code>, and key <code>Output:Variable</code> entries.
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

            <!-- Output Variables -->
            <div class="space-y-1">
                <div class="flex justify-between items-center">
                    <span class="font-semibold text-[10px] uppercase text-[--text-secondary]">Output Variables</span>
                    <button class="btn btn-xxs btn-secondary" data-action="add-output-var">+ Add Variable</button>
                </div>
                <div class="border border-gray-700/70 rounded bg-black/40 max-h-40 overflow-y-auto **scrollable-panel-inner**">
                    <table class="w-full text-[8px]">
                        <thead class="bg-black/40">
                            <tr>
                                <th class="px-1 py-1 text-left">Key</th>
                                <th class="px-1 py-1 text-left">Variable Name</th>
                                <th class="px-1 py-1 text-left">Frequency</th>
                                <th class="px-1 py-1 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody class="output-vars-tbody"></tbody>
                    </table>
                </div>
                <div class="text-[7px] text-[--text-secondary]">
                    Examples: Key = zone name or "Environment"; Variable = "Zone Lights Electric Power"; Frequency = Hourly/RunPeriod/etc.
                </div>
            </div>

            <div class="flex justify-end gap-2">
                <button class="btn btn-xxs btn-secondary" data-action="save-daylighting">Save Daylighting & Outputs</button>
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
    const varsTbody = panel.querySelector('.output-vars-tbody');
    const addIllumBtn = panel.querySelector('[data-action="add-illum-map"]');
    const addVarBtn = panel.querySelector('[data-action="add-output-var"]');
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

    function renderOutputVars() {
        const { daylighting } = getMetaEPDaylighting();
        const vars = (daylighting.outputs && Array.isArray(daylighting.outputs.variables))
            ? daylighting.outputs.variables
            : [];

        varsTbody.innerHTML = '';

        if (!vars.length) {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="px-1 py-1 text-[8px] text-[--text-secondary]" colspan="4">
                    No Output:Variable entries defined.
                </td>
            `;
            varsTbody.appendChild(tr);
            return;
        }

        vars.forEach((v) => {
            const tr = document.createElement('tr');
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
            varsTbody.appendChild(tr);
        });

        varsTbody.querySelectorAll('button[data-action="delete-var"]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const row = btn.closest('tr');
                if (row) row.remove();
            });
        });
    }

    function addOutputVarRow() {
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
        varsTbody.appendChild(tr);
        const delBtn = tr.querySelector('button[data-action="delete-var"]');
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

        // Output variables
        const variables = [];
        varsTbody.querySelectorAll('tr').forEach((tr) => {
            const key = (tr.querySelector('[data-field="key"]')?.value || '').trim();
            const variableName = (tr.querySelector('[data-field="variableName"]')?.value || '').trim();
            const freq = tr.querySelector('[data-field="freq"]')?.value || 'Hourly';
            if (!key || !variableName) return;
            variables.push({
                key,
                variableName,
                reportingFrequency: freq,
            });
        });

        const nextDaylighting = {};
        if (controls.length) {
            nextDaylighting.controls = controls;
        }
        if (illuminanceMaps.length || variables.length) {
            nextDaylighting.outputs = {};
            if (illuminanceMaps.length) {
                nextDaylighting.outputs.illuminanceMaps = illuminanceMaps;
            }
            if (variables.length) {
                nextDaylighting.outputs.variables = variables;
            }
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

    if (addVarBtn) {
        addVarBtn.addEventListener('click', () => {
            addOutputVarRow();
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
                alert('Daylighting & Outputs configuration saved.');
            } catch (err) {
                console.error('DaylightingManager: save failed', err);
                alert('Failed to save Daylighting & Outputs configuration. Check console for details.');
            }
        });
    }

    renderControls();
    renderIlluminanceMaps();
    renderOutputVars();

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
