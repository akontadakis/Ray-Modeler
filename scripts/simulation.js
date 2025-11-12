// scripts/simulation.js

import { showAlert, makeDraggable, makeResizable, ensureWindowInView, getNewZIndex, setupFileListenersForPanel, initializePanelControls } from './ui.js';
import { getDom } from './dom.js';
import { project } from './project.js'; // Import project to access its state
import { getRecipeById } from './recipes/RecipeRegistry.js';
import { getRuntimeEnvironment, getRecipeExecutionSupport } from './recipes/runtimeEnvironment.js';

// --- MODULE-LEVEL VARIABLES ---
let panelCounter = 0;
let globalParametersCache = {}; // Cache for global parameters that persists across accordion state changes

const availableModules = [
    // Global panel (not shown in recipes dropdown)
    { id: 'template-global-sim-params', name: 'Global Simulation Parameters' },
    // Recipe entries are now effectively mirrored from RecipeRegistry + DOM templates.
    // This array is kept for legacy button-based UI; the dropdown itself is Registry/DOM-driven.
    { id: 'template-recipe-illuminance', name: 'Recipe: Illuminance Map' },
    { id: 'template-recipe-rendering', name: 'Recipe: Photorealistic Rendering' },
    { id: 'template-recipe-dgp', name: 'Recipe: Daylight Glare Probability' },
    { id: 'template-recipe-df', name: 'Recipe: Daylight Factor' },
    { id: 'template-recipe-annual-3ph', name: 'Recipe: Annual Daylight (3-Phase)' },
    { id: 'template-recipe-sda-ase', name: 'Recipe: sDA & ASE (LM-83)' },
    { id: 'template-recipe-annual-5ph', name: 'Recipe: Annual Daylight (5-Phase)' },
    { id: 'template-recipe-imageless-glare', name: 'Recipe: Imageless Annual Glare' },
    { id: 'template-recipe-spectral-lark', name: 'Recipe: Spectral Analysis (Lark)' },
    { id: 'template-recipe-en17037', name: 'Recipe: EN 17037 Compliance' },
    { id: 'template-recipe-en-illuminance', name: 'Recipe: EN 12464-1 Illuminance' },
    { id: 'template-recipe-en-ugr', name: 'Recipe: EN 12464-1 UGR' },
    { id: 'template-recipe-lighting-energy', name: 'Recipe: Lighting Energy Analysis' },
    { id: 'template-recipe-facade-irradiation', name: 'Recipe: Façade Irradiation Analysis' },
    { id: 'template-recipe-annual-radiation', name: 'Recipe: Annual Solar Radiation' }
];

const FOLDER_STRUCTURE = [
    '01_geometry', '02_materials', '03_views', '04_skies', '05_bsdf',
    '06_octrees', '07_scripts', '08_results', '09_images', '10_schedules', '11_files', '12_topography'
];

// --- CORE PUBLIC FUNCTIONS ---
export function setupSimulationSidebar() {
    const simPanel = document.getElementById('panel-simulation-modules');
    const recipeSelector = document.getElementById('recipe-selector');
    if (!simPanel || !recipeSelector) return;

    // Initialize the logic for the entire panel, including global parameters.
    initializePanelLogic(simPanel);

    availableModules.forEach(module => {
       // Skip adding "Global" to the recipe dropdown
        if (module.id === 'template-global-sim-params') return;

        const option = document.createElement('option');
        option.value = module.id;
        option.textContent = module.name;
        recipeSelector.appendChild(option);
    });
    
    recipeSelector.addEventListener('change', (e) => {
        const templateId = e.target.value;
        const container = document.getElementById('recipe-parameters-container');
        const generateBtn = document.querySelector('#panel-simulation-modules [data-action="generate"]');
        const runBtn = document.querySelector('#panel-simulation-modules [data-action="run"]');
        const commandCenter = document.querySelector('#panel-simulation-modules .command-center');
        const infoBox = document.getElementById('recipe-info');

        if (!container || !generateBtn) return;

        // Clear previous recipe and hide execution details
        container.innerHTML = '';
        if (runBtn) runBtn.disabled = true;
        if (commandCenter) commandCenter.classList.add('hidden');
        delete container.dataset.activeRecipeTemplate;

        if (!templateId) {
            // If "-- Select --" is chosen, show placeholder text and disable button
            container.innerHTML = `<p class="text-sm text-center text-[--text-secondary] p-4">Select a recipe from the dropdown above to configure a simulation.</p>`;
            generateBtn.textContent = 'Generate Package';
            generateBtn.disabled = true;
            if (infoBox) infoBox.innerHTML = '';
            return;
        }

        const template = document.getElementById(templateId);
        if (!template) {
            if (infoBox) infoBox.innerHTML = `<p class="text-xs text-[--text-secondary]">No template found for selected recipe.</p>`;
            generateBtn.textContent = 'Generate Package';
            generateBtn.disabled = true;
            return;
        }

        const fullClone = template.content.cloneNode(true);
        const contentClone = fullClone.querySelector('.window-content');

        if (contentClone) {
            // Move the content from the template into the container
            container.append(...contentClone.children);

            // Set dataset for later reference
            container.dataset.activeRecipeTemplate = templateId;

            // Initialize logic for the newly added elements within the container
            initializePanelLogic(container);
            setupFileListenersForPanel(container);
        }

        // Update the generate button text and enable it
        const recipeDef = getRecipeById(templateId);
        const fallbackName = availableModules.find(m => m.id === templateId)?.name || 'Package';
        const recipeLabel = recipeDef?.name || fallbackName;
        generateBtn.textContent = `Generate ${recipeLabel.replace('Recipe: ', '')} Package`;
        generateBtn.disabled = false;

        // Surface basic recipe metadata / requirements (if available)
        if (infoBox) {
            if (recipeDef) {
                const env = recipeDef.environment || {};
                const req = recipeDef.inputSchema?.requiredResources || {};
                const deps = env.dependencies || [];

                const lines = [];

                if (recipeDef.description) {
                    lines.push(`<div class="text-xs text-[--text-secondary]">${recipeDef.description}</div>`);
                }

                const reqParts = [];
                if (req.needsSensorGrid) reqParts.push('sensor grid');
                if (req.needsView) reqParts.push('view/camera');
                if (req.needsBSDF) reqParts.push('BSDF file');
                if (recipeDef.inputSchema?.requiredFiles?.length) {
                    reqParts.push(...recipeDef.inputSchema.requiredFiles.map(f => `file: ${f}`));
                }
                if (reqParts.length) {
                    lines.push(`<div class="text-[0.65rem] text-[--text-secondary]">Requires: ${reqParts.join(', ')}</div>`);
                }

                if (deps.length) {
                    lines.push(`<div class="text-[0.65rem] text-[--text-secondary]">Toolchain: ${deps.join(', ')}</div>`);
                }

                infoBox.innerHTML = lines.join('') || '';
            } else {
                infoBox.innerHTML = `<div class="text-[0.65rem] text-[--text-secondary]">Legacy recipe. Generation uses the classic script generator.</div>`;
            }
        }
    });
}

/**
 * Recreates panels and ensures file inputs are correctly populated.
 * @param {object} simSettings - The saved settings for simulation panels.
 * @param {object} loadedFiles - The central store of loaded file data.
 * @param {object} ui - The dynamically imported UI module.
 */
export function recreateSimulationPanels(simSettings, loadedFiles, ui) {
    const panelContainer = document.getElementById('window-container');
    const moduleList = document.getElementById('simulation-module-list');
    const recipeSelector = document.getElementById('recipe-selector');
    const sidebarContainer = document.getElementById('recipe-parameters-container');

    // Clear all existing dynamically generated simulation panels (legacy floating windows)
    if (panelContainer && moduleList) {
        panelContainer.querySelectorAll('.floating-window[data-template-id^="template-recipe-"]').forEach(panel => {
            const templateId = panel.dataset.templateId;
            const button = moduleList.querySelector(`[data-template="${templateId}"]`);
            if (panel.parentElement) {
                panel.parentElement.removeChild(panel);
            }
            if (button) {
                button.innerHTML = '+';
                button.title = `Add ${button.previousElementSibling.textContent} Panel`;
            }
        });
    }

    // Clear sidebar recipe container UI
    if (sidebarContainer) {
        sidebarContainer.innerHTML = '';
        delete sidebarContainer.dataset.activeRecipeTemplate;
    }
    if (recipeSelector) {
        recipeSelector.value = '';
    }

    if (!simSettings) return;

    // 1. Recreate and populate the Global Parameters panel if it exists in settings (legacy floating panel)
    if (simSettings.global && Object.keys(simSettings.global).length > 0 && moduleList) {
        const templateId = 'template-global-sim-params';
        const button = moduleList.querySelector(`[data-template="${templateId}"]`);
        if (button) {
            const globalPanel = _createSimulationPanel(templateId, button);
            if (globalPanel) {
                _populatePanel(globalPanel, simSettings.global);
            }
        }
    }

    // 2. Determine the active recipe from canonical shape or legacy recipes[]
    let activeRecipe = null;

    if (simSettings.activeRecipe && simSettings.activeRecipe.templateId) {
        activeRecipe = simSettings.activeRecipe;
    } else if (Array.isArray(simSettings.recipes) && simSettings.recipes.length > 0) {
        // Backwards compatibility: fall back to the first stored recipe
        const first = simSettings.recipes[0];
        if (first && first.templateId) {
            activeRecipe = { templateId: first.templateId, values: first.values || {} };
        }
    }

    // 3. Restore the active recipe into the new dropdown + sidebar container
    if (activeRecipe && recipeSelector && sidebarContainer) {
        const { templateId, values } = activeRecipe;

        // Select the recipe in the dropdown if present
        const optionExists = Array.from(recipeSelector.options).some(opt => opt.value === templateId);
        if (optionExists) {
            recipeSelector.value = templateId;
        }

        // Inject template content into sidebar container
        const template = document.getElementById(templateId);
        if (template) {
            const fullClone = template.content.cloneNode(true);
            const contentClone = fullClone.querySelector('.window-content');

            if (contentClone) {
                sidebarContainer.append(...contentClone.children);
                sidebarContainer.dataset.activeRecipeTemplate = templateId;

                // Initialize logic and file listeners for the restored recipe UI
                initializePanelLogic(sidebarContainer);
                setupFileListenersForPanel(sidebarContainer);

                // Populate restored UI with saved values, matching the ID-mapping logic
                const activePanel = sidebarContainer.firstElementChild;
                if (activePanel && values && typeof values === 'object') {
                    const panelIdSuffix = activePanel.id.split('-').pop();
                    activePanel.querySelectorAll('input, select').forEach(input => {
                        const baseId = input.id.replace(`-${panelIdSuffix}`, '');
                        if (!baseId) return;
                        if (!(baseId in values)) return;

                        const savedValue = values[baseId];
                        if (input.type === 'file') {
                            if (savedValue && savedValue.name && project.simulationFiles[baseId]) {
                                let display = activePanel.querySelector(`[data-file-display-for="${input.id}"]`);
                                if (!display) {
                                    display = document.createElement('span');
                                    display.className = 'text-sm text-gray-500 ml-4 truncate max-w-[150px]';
                                    display.dataset.fileDisplayFor = input.id;
                                    input.parentElement.insertBefore(display, input.nextSibling);
                                }
                                display.textContent = savedValue.name;
                                display.title = savedValue.name;
                            }
                        } else if (input.type === 'checkbox' || input.type === 'radio') {
                            input.checked = !!savedValue;
                        } else {
                            input.value = savedValue;
                        }

                        input.dispatchEvent(new Event('change', { bubbles: true }));
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                    });
                }

                // Update Generate button label to match active recipe
                const generateBtn = document.querySelector('#panel-simulation-modules [data-action="generate"]');
                if (generateBtn) {
                    const recipeDef = getRecipeById(templateId);
                    const recipeLabel = recipeDef?.name || availableModules.find(m => m.id === templateId)?.name || 'Package';
                    generateBtn.textContent = `Generate ${recipeLabel.replace('Recipe: ', '')} Package`;
                    generateBtn.disabled = false;
                }
            }
        }
    }

    // 4. For any remaining legacy recipes (beyond the active one), optionally recreate floating panels
    if (Array.isArray(simSettings.recipes) && moduleList && panelContainer) {
        simSettings.recipes.forEach(recipeData => {
            const { templateId, values } = recipeData;
            if (!templateId || !values) return;
            if (activeRecipe && templateId === activeRecipe.templateId) return; // already handled via sidebar

            const button = moduleList.querySelector(`[data-template="${templateId}"]`);
            if (button) {
                const newPanel = _createSimulationPanel(templateId, button);
                if (newPanel) {
                    _populatePanel(newPanel, values);
                }
            }
        });
    }
}

/**
 * Finds and opens a specific recipe panel if it's not already visible.
 * @param {string} templateId - The full template ID of the recipe panel.
 * @returns {HTMLElement|null} The panel element if found, otherwise null.
 */
export async function openRecipePanelByType(templateId) {
    // Handle recipe templates that now use dropdown selection
    if (templateId.startsWith('template-recipe-')) {
        const recipeSelector = document.getElementById('recipe-selector');
        if (recipeSelector) {
            recipeSelector.value = templateId;
            recipeSelector.dispatchEvent(new Event('change', { bubbles: true }));
            await new Promise(resolve => setTimeout(resolve, 200)); // Wait for container to populate
            return document.getElementById('recipe-parameters-container');
        }
        console.error(`Recipe selector not found for template ${templateId}`);
        return null;
    }

    // Handle other templates (like global) with the original button-based logic
    const moduleList = document.getElementById('simulation-module-list');
    const button = moduleList?.querySelector(`[data-template="${templateId}"]`);

    if (!button) {
        console.error(`Button for template ${templateId} not found.`);
        return null;
    }

    let panel = document.querySelector(`.floating-window[data-template-id="${templateId}"]`);

    if (!panel) {
        // Panel doesn't exist, create it.
        panel = _createSimulationPanel(templateId, button);
    } else if (panel.classList.contains('hidden')) {
        // Panel exists but is hidden, toggle it.
        _togglePanelVisibility(templateId, button);
    }

    // Bring to front
    if(panel) {
        panel.style.zIndex = getNewZIndex();
        ensureWindowInView(panel);

        // --- Proactive Suggestions on Panel Open ---
        if (templateId === 'template-recipe-dgp') {
            const dom = getDom();
            const currentViewType = dom['view-type']?.value;
            if (currentViewType !== 'h' && currentViewType !== 'a') {
                const { triggerProactiveSuggestion } = await import('./ai-assistant.js');
                triggerProactiveSuggestion('dgp_recipe_bad_viewpoint');
            }
        }
    }

    return panel;
}

/**
 * Programmatically triggers the 'Generate Package' process for a given recipe panel.
 * @param {HTMLElement} panel - The recipe panel DOM element.
 * @param {string} [uniqueId=null] - An optional unique ID for this simulation run.
 * @returns {Promise<object|null>} The result from the project's package generation.
 */
export async function programmaticallyGeneratePackage(panel, uniqueId = null) {
    // Find buttons in panel or globally (for container case)
    const generateBtn = panel.querySelector('[data-action="generate"]') || document.querySelector('[data-action="generate"]');
    if (!generateBtn) return null;

    generateBtn.textContent = 'Generating...';
    generateBtn.disabled = true;

    try {
        const result = await project.generateSimulationPackage(panel, uniqueId);
        if (!result) throw new Error("Script generation failed or was aborted.");

        // Find command center in panel or globally
        const commandCenter = panel.querySelector('.command-center') || document.querySelector('.command-center');
        const scriptTextArea = commandCenter?.querySelector('textarea');

        if (result.content && scriptTextArea && commandCenter) {
            scriptTextArea.value = result.content;
            commandCenter.classList.remove('hidden');
            showAlert('Simulation package generated successfully!', 'Success');
            const runBtn = panel.querySelector('[data-action="run"]') || document.querySelector('[data-action="run"]');
            if (runBtn) runBtn.disabled = false;
        }
        return result; // Return the generated script info
    } catch (error) {
        console.error('Error generating simulation package:', error);
        showAlert(`Failed to generate simulation package: ${error.message}`, 'Error');
        const runBtn = panel.querySelector('[data-action="run"]') || document.querySelector('[data-action="run"]');
        if (runBtn) runBtn.disabled = true;
        return null;
    } finally {
        generateBtn.textContent = 'Generate Package';
        generateBtn.disabled = false;
    }
}

// --- PRIVATE HELPER FUNCTIONS ---
function _togglePanelVisibility(templateId, button) {
    const panelContainer = document.getElementById('window-container');
    let panel = panelContainer.querySelector(`.floating-window[data-template-id="${templateId}"]`);

    if (!panel) {
        _createSimulationPanel(templateId, button);
    } else {
        const isHidden = panel.classList.toggle('hidden');
        button.innerHTML = isHidden ? '+' : '−';
        button.title = `${isHidden ? 'Add' : 'Close'} ${button.previousElementSibling.textContent} Panel`;

        if (!isHidden) {
            panel.style.zIndex = getNewZIndex();
            ensureWindowInView(panel);
        }
    }
}

function _createSimulationPanel(templateId, button) {
    const template = document.getElementById(templateId);
    if (!template) return null;

    panelCounter++;
    const clone = template.content.firstElementChild.cloneNode(true);
    clone.id = `${templateId}-panel-${panelCounter}`;
    clone.dataset.templateId = templateId;

    uniquifyIds(clone, panelCounter);

    const openWindows = document.querySelectorAll('#window-container .floating-window:not(.hidden)').length;
    clone.style.top = `${80 + (openWindows % 10) * 40}px`;
    clone.style.left = `calc(50vw - 200px + ${(openWindows % 5) * 20}px)`;
    clone.style.transform = 'none';

   document.getElementById('window-container').appendChild(clone);

    // Add specific listeners for certain panels upon creation
    if (templateId === 'template-global-sim-params') {
        const abInput = clone.querySelector('[id^="ab-num-"]');
        abInput?.addEventListener('change', (e) => {
            if (parseInt(e.target.value, 10) < 2) {
                import('./ai-assistant.js').then(({ triggerProactiveSuggestion }) => {
                    triggerProactiveSuggestion('low_ambient_bounces');
                });
            }
        });
    }

    initializePanelControls(clone);
    initializePanelLogic(clone);
    setupFileListenersForPanel(clone);

    if (button) {
        button.innerHTML = '−';
        button.title = `Close ${button.previousElementSibling.textContent} Panel`;
    }
    return clone;
}

/**
 * Populates a panel with data. File inputs now correctly find their data
 * in the central `project.simulationFiles` store.
 * @param {HTMLElement} panel - The panel element to populate.
 * @param {object} panelData - The key-value object of settings for this panel.
 */
function _populatePanel(panel, panelData) {
    const panelIdSuffix = panel.id.split('-').pop();

    for (const originalKey in panelData) {
        const value = panelData[originalKey];
        const elId = `${originalKey}-${panelIdSuffix}`;
        const el = panel.querySelector(`#${elId}`);

        if (el) {
            if (el.type === 'file') {
                // The `value` here is an object like { name: 'file.ies' }.
                // The actual file data is already in `project.simulationFiles` keyed by the originalKey.
                if (value && value.name && project.simulationFiles[originalKey]) {
                    // Find the display span and update it with the filename.
                    let display = panel.querySelector(`[data-file-display-for="${el.id}"]`);
                    if (!display) {
                         display = document.createElement('span');
                         display.className = 'text-sm text-gray-500 ml-4 truncate max-w-[150px]';
                         display.dataset.fileDisplayFor = el.id;
                         el.parentElement.insertBefore(display, el.nextSibling);
                    }
                    display.textContent = value.name;
                    display.title = value.name;
                }
            } else if (el.type === 'checkbox' || el.type === 'radio') {
                el.checked = value;
            } else {
                el.value = value;
            }
            
            // Trigger events to ensure UI updates itself (e.g. sliders updating text labels)
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }
}

// Helper functions (uniquifyIds, makeWindowInteractive, etc.) go here...
export function uniquifyIds(element, suffix) {
    element.querySelectorAll('[id]').forEach(el => {
        const oldId = el.id;
        const newId = `${oldId}-${suffix}`;
        el.id = newId;

        const label = element.querySelector(`label[for="${oldId}"]`);
        if (label) label.setAttribute('for', newId);
        
        const displayFor = element.querySelector(`[data-file-display-for="${oldId}"]`);
        if (displayFor) displayFor.dataset.fileDisplayFor = newId;
    });
}

/**
 * Shows an alert with instructions on how to run the simulation script in a local terminal
 * for browser-based environments where direct execution is not possible.
 * @param {string} scriptFile The name of the script file to run (e.g., 'RUN_Simulation.sh').
 */
function _showBrowserRunInstructions(scriptFile) {
    const isWindows = navigator.platform.toUpperCase().indexOf('WIN') !== -1;
    const command = isWindows ? `${scriptFile}` : `./${scriptFile}`;
    const chmodCommand = `chmod +x ${scriptFile}`;
    const macInstructions = `
        <div class="space-y-2">
            <label class="block font-semibold text-sm">2. Make Script Executable (macOS/Linux Only)</label>
            <div class="flex items-center gap-2">
                <code class="code-block flex-grow">${chmodCommand}</code>
                <button id="copy-chmod-command-btn" class="btn btn-xs btn-secondary">Copy</button>
            </div>
        </div>
    `;

    const instructions = `
        <div class="space-y-4 text-left">
            <p class="text-sm">Your browser cannot run local scripts for security reasons. Please follow these steps in your own terminal:</p>
            <div class="space-y-2">
                <label class="block font-semibold text-sm">1. Navigate to the Scripts Directory</label>
                <p class="text-xs text-gray-400">Open your terminal (e.g., Terminal, Command Prompt, PowerShell) and use the <code>cd</code> command to go to the <code>07_scripts</code> folder inside your project directory.</p>
            </div>
            ${isWindows ? '' : macInstructions}
            <div class="space-y-2">
                <label class="block font-semibold text-sm">${isWindows ? '2.' : '3.'} Run the Simulation</label>
                <div class="flex items-center gap-2">
                    <code class="code-block flex-grow">${command}</code>
                    <button id="copy-run-command-btn" class="btn btn-xs btn-secondary">Copy</button>
                </div>
            </div>
            <p class="info-box !text-xs !py-2 !px-3">Ensure Radiance is installed and its 'bin' directory is in your system's PATH for these commands to work.</p>
        </div>
    `;

    const alertPanel = document.querySelector('#custom-alert .ui-panel');
    if (alertPanel) {
        alertPanel.classList.remove('max-w-sm');
        alertPanel.classList.add('max-w-lg');
    }
    showAlert(instructions, 'How to Run Simulation');

    // Attach listeners to the copy buttons inside the newly created alert
    const copyBtn = (id, text) => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.addEventListener('click', () => {
                navigator.clipboard.writeText(text).then(() => {
                    btn.textContent = 'Copied!';
                    setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
                });
            }, { once: true });
        }
    };

    copyBtn('copy-run-command-btn', command);
    if (!isWindows) {
        copyBtn('copy-chmod-command-btn', chmodCommand);
    }
}

export function initializePanelLogic(panel) {
    // Initializes quality presets if the panel is a recipe, which now target global params
    if (panel.dataset.templateId && panel.dataset.templateId.startsWith('template-recipe-')) {
        _initQualityPresets(panel);
    } else if (panel.id.includes('recipe-parameters-container')) {
         _initQualityPresets(panel);
    }

    // Initializes interactive sliders and number inputs
    panel.querySelectorAll('.param-item').forEach(item => {
        const slider = item.querySelector('input[type="range"]');
        const numberInput = item.querySelector('input[type="number"]');
        if (slider && numberInput) {
            const updateNumber = () => numberInput.value = slider.value;
            const updateSlider = () => { if (numberInput.value) slider.value = numberInput.value; };
            slider.addEventListener('input', updateNumber);
            numberInput.addEventListener('change', updateSlider);
            updateNumber();
        }
    });

    // Initializes toggle-button groups
    panel.querySelectorAll('.btn-group').forEach(group => {
        group.addEventListener('click', (e) => {
            const button = e.target.closest('.btn');
            if (!button || !group.contains(button)) return;
            group.querySelectorAll('.btn').forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
        });
    });

    // Initializes the execution buttons and Command Center
    const generateBtn = panel.querySelector('[data-action="generate"]');
    const runBtn = panel.querySelector('[data-action="run"]');
    let generatedScriptFiles = {}; // Variable to hold script names between generate and run

   if (generateBtn) {
        generateBtn.addEventListener('click', async () => {
            const result = await programmaticallyGeneratePackage(panel);
            if (result) {
                 generatedScriptFiles = { sh: result.shFile, bat: result.batFile };
            }
        });
    }

    if (runBtn) {
        runBtn.addEventListener('click', () => {
            const isWindows = navigator.platform.toUpperCase().indexOf('WIN') !== -1;
            const scriptFile = isWindows ? generatedScriptFiles.bat : generatedScriptFiles.sh;

            if (!scriptFile) {
                showAlert('No script has been generated for this recipe yet. Click "Generate Package" first.', 'Error');
                return;
            }

            const recipeType = panel.dataset.templateId || panel.dataset.activeRecipeTemplate;
            const recipeDef = recipeType ? getRecipeById(recipeType) : null;
            const runtimeEnv = getRuntimeEnvironment();
            const support = getRecipeExecutionSupport(recipeDef, runtimeEnv);

            const command = isWindows ? `${scriptFile}` : `./${scriptFile}`;

            // If this environment/recipe combo cannot auto-run, show instructions instead.
            if (!support.canAutoRun) {
                _showBrowserRunInstructions(scriptFile);

                // Optionally surface reasons in a separate info alert for clarity.
                if (support.reasons && support.reasons.length) {
                    showAlert(
                        `<div class="text-xs text-[--text-secondary] space-y-1">${support.reasons.map(r => `<div>${r}</div>`).join('')}</div>`,
                        'Execution Information'
                    );
                }
                return;
            }

            // Auto-run via Electron when supported.
            if (window.electronAPI && (project.dirPath || project.dirHandle)) {
                const commandCenter = panel.querySelector('.command-center');
                if (commandCenter) {
                    commandCenter.classList.remove('hidden');
                }

                window.electronAPI.runScript({
                    projectPath: project.dirPath || project.dirHandle?.name,
                    scriptName: scriptFile
                });
            } else {
                // Fallback: show instructions if Electron is not available.
                _showBrowserRunInstructions(scriptFile);
            }
        });
    }

    // Add logic to handle the simulation output console
    const commandCenter = panel.querySelector('.command-center');
    if (commandCenter && window.electronAPI) {
        // Create the output console if it doesn't exist
        let outputConsole = commandCenter.querySelector('.simulation-output-console');
        if (!outputConsole) {
            const consoleWrapper = document.createElement('div');
            consoleWrapper.className = "mt-4 pt-4 border-t border-dashed border-[--grid-color]";
            consoleWrapper.innerHTML = `
                <h5 class="font-semibold text-xs uppercase text-[--text-secondary] mb-2">Simulation Output</h5>
                <pre class="simulation-output-console w-full h-48 font-mono text-xs p-2 rounded bg-[--grid-color] border border-gray-500/50 overflow-y-auto whitespace-pre-wrap"></pre>
            `;
            commandCenter.appendChild(consoleWrapper);
            outputConsole = consoleWrapper.querySelector('.simulation-output-console');
        }

        window.electronAPI.onScriptOutput((data) => {
            if (outputConsole) {
                outputConsole.textContent += data;
                outputConsole.scrollTop = outputConsole.scrollHeight; // Auto-scroll
            }
        });

        window.electronAPI.onScriptExit((code) => {
            if (outputConsole) {
                outputConsole.textContent += `\n--- PROCESS EXITED WITH CODE: ${code} ---`;
                outputConsole.scrollTop = outputConsole.scrollHeight;
            }
        });
    }
}

/**
 * Defines quality presets for Radiance parameters.
 * Keys should correspond to the base ID of the input elements.
 */
const QUALITY_PRESETS = {
    draft: { ab: 2, ad: 512, as: 128, aa: 0.2, lw: 0.05 },
    medium: { ab: 4, ad: 2048, as: 1024, aa: 0.15, lw: 0.01 },
    high: { ab: 6, ad: 4096, as: 2048, aa: 0.1, lw: 0.005 },
};

/**
 * Initializes the quality preset dropdown in a recipe panel.
 * @param {HTMLElement} panel The recipe panel element.
 */
function _initQualityPresets(panel) {
// The preset selector could be in a floating panel or the main sidebar
const presetSelect = panel.querySelector('[id^="quality-preset"]');
if (!presetSelect) return;

presetSelect.addEventListener('change', (e) => {
    const selectedPreset = e.target.value;
    if (selectedPreset === 'custom' || !QUALITY_PRESETS[selectedPreset]) {
        // If user selects custom, do nothing. They can edit the global params manually.
        return;
    }

    const presetValues = QUALITY_PRESETS[selectedPreset];
    // The target inputs are ALWAYS the global parameters in the main simulation panel
    const globalParamsPanel = document.getElementById('panel-simulation-modules');
    if (!globalParamsPanel) return;

    for (const key in presetValues) {
        // The IDs in the global panel are like 'ab' & 'ab-num', 'ad' & 'ad-num'.
        const slider = globalParamsPanel.querySelector(`#${key}`);
        const numberInput = globalParamsPanel.querySelector(`#${key}-num`);
        
        if (slider && numberInput) {
            const newValue = presetValues[key];
            slider.value = newValue;
            numberInput.value = newValue;
            // Dispatch events to ensure UI consistency (e.g., updating text labels)
            // and notify other parts of the app of the change.
            numberInput.dispatchEvent(new Event('input', { bubbles: true })); // For updating the slider
            slider.dispatchEvent(new Event('input', { bubbles: true })); // For updating the label
        }
    }
    showAlert(`Global simulation parameters set to '${selectedPreset}' preset.`, 'Preset Applied');
});
}
