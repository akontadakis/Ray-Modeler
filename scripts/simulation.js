// scripts/simulation.js

import { showAlert, makeDraggable, makeResizable, ensureWindowInView, getNewZIndex, setupFileListenersForPanel, initializePanelControls } from './ui.js';
import { getDom } from './dom.js';
import { project } from './project.js'; // Import project to access its state

// --- MODULE-LEVEL VARIABLES ---
let panelCounter = 0;
let globalParametersCache = {}; // Cache for global parameters that persists across accordion state changes

const availableModules = [
    { id: 'template-global-sim-params', name: 'Global Simulation Parameters' },
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

    if (!container || !generateBtn) return;

    // Clear previous recipe and hide execution details
    container.innerHTML = '';
    runBtn.disabled = true;
    commandCenter.classList.add('hidden');


    if (templateId) {
        const template = document.getElementById(templateId);
        if (template) {
        const fullClone = template.content.cloneNode(true);
        // Find the content inside the cloned template
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
        const recipeName = availableModules.find(m => m.id === templateId)?.name || 'Package';
        generateBtn.textContent = `Generate ${recipeName.replace('Recipe: ', '')} Package`;
        generateBtn.disabled = false;

        }
    } else {
        // If "-- Select --" is chosen, show placeholder text and disable button
        container.innerHTML = `<p class="text-sm text-center text-[--text-secondary] p-4">Select a recipe from the dropdown above to configure a simulation.</p>`;
        generateBtn.textContent = 'Generate Package';
        generateBtn.disabled = true;
        delete container.dataset.activeRecipeTemplate;
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

    // Clear all existing dynamically generated simulation panels
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

    if (!simSettings) return;

    // 1. Recreate and populate the Global Parameters panel if it exists in settings
    if (simSettings.global && Object.keys(simSettings.global).length > 0) {
        const templateId = 'template-global-sim-params';
        const button = moduleList.querySelector(`[data-template="${templateId}"]`);
        if (button) {
            const globalPanel = _createSimulationPanel(templateId, button);
            if (globalPanel) {
                _populatePanel(globalPanel, simSettings.global);
            }
        }
    }

    // 2. Recreate and populate each recipe panel from the settings
    if (simSettings.recipes && Array.isArray(simSettings.recipes)) {
        simSettings.recipes.forEach(recipeData => {
            const { templateId, values } = recipeData;
            if (templateId && values) {
                const button = moduleList.querySelector(`[data-template="${templateId}"]`);
                if (button) {
                    const newPanel = _createSimulationPanel(templateId, button);
                    if (newPanel) {
                        _populatePanel(newPanel, values);
                    }
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
 * @returns {Promise<object|null>} The result from the project's package generation.
 */
export async function programmaticallyGeneratePackage(panel) {
    const generateBtn = panel.querySelector('[data-action="generate"]');
    if (!generateBtn) return null;

    generateBtn.textContent = 'Generating...';
    generateBtn.disabled = true;

    try {
        const result = await project.generateSimulationPackage(panel);
        if (!result) throw new Error("Script generation failed or was aborted.");

        const commandCenter = panel.querySelector('.command-center');
        const scriptTextArea = commandCenter?.querySelector('textarea');

        if (result.content && scriptTextArea && commandCenter) {
            scriptTextArea.value = result.content;
            commandCenter.classList.remove('hidden');
            showAlert('Simulation package generated successfully!', 'Success');
            const runBtn = panel.querySelector('[data-action="run"]');
            if (runBtn) runBtn.disabled = false;
        }
        return result; // Return the generated script info
    } catch (error) {
        console.error('Error generating simulation package:', error);
        showAlert(`Failed to generate simulation package: ${error.message}`, 'Error');
        const runBtn = panel.querySelector('[data-action="run"]');
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

        const command = isWindows ? `${scriptFile}` : `./${scriptFile}`;

        // If in Electron, run directly. Otherwise, show instructions.
        if (window.electronAPI && project.dirHandle) {
            const commandCenter = panel.querySelector('.command-center');
            const outputConsole = commandCenter?.querySelector('.simulation-output-console');

            window.electronAPI.runScript({
              projectPath: project.dirHandle.name,
              scriptName: scriptFile
          });
      } else {
          // --- Browser Fallback: Show instructions ---
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
