import { getDom } from './dom.js';
import { setUiValue, showAlert, setShadingState } from './ui.js';
import { project } from './project.js';
import { resultsManager } from './resultsManager.js';
import { GeneticOptimizer } from './optimizationEngine.js';

let optimizer = null;
let isOptimizing = false;
let optimizationPanel = null; // This will store the reference to the correct panel

// --- Configuration maps ---
const RECIPE_METRICS = {
    'sda-ase': [
        { id: 'maximize_sDA', name: 'Maximize sDA', file: '_sDA_final.ill' },
        { id: 'minimize_ASE', name: 'Minimize ASE', file: '_ASE_direct_only.ill' }
    ],
    'illuminance': [
        { id: 'maximize_avg', name: 'Maximize Avg Illuminance', file: '_illuminance.txt' },
        { id: 'minimize_avg', name: 'Minimize Avg Illuminance', file: '_illuminance.txt' }
    ],
    'dgp': [
        { id: 'minimize_dgp', name: 'Minimize DGP', file: '_DGP.txt' }
    ]
};

// Master list of all optimizable parameters for each shading type
// Master list of all optimizable parameters for each shading type
const SHADING_PARAMETERS = {
    'overhang': [
        { id: 'dist-above', name: 'Distance Above Top (m)', type: 'continuous', min: 0, max: 1.0, step: 0.05 },
        { id: 'tilt', name: 'Tilt Angle (°)', type: 'continuous', min: -90, max: 90, step: 5 },
        { id: 'depth', name: 'Depth (m)', type: 'continuous', min: 0.1, max: 2.0, step: 0.1 },
        { id: 'thick', name: 'Thickness (m)', type: 'continuous', min: 0.01, max: 0.5, step: 0.01 },
        { id: 'extension', name: 'Extension From Window (m)', type: 'continuous', min: 0, max: 1.0, step: 0.05 }
    ],
    'lightshelf': [
        { id: 'placement', name: 'Placement', type: 'discrete', options: ['ext', 'int', 'both'] },
        { id: 'dist-below', name: 'Distance Below Top (m)', type: 'continuous', min: 0, max: 3.0, step: 0.05 },
        { id: 'tilt', name: 'Tilt Angle (°)', type: 'continuous', min: -90, max: 90, step: 5 },
        { id: 'depth', name: 'Depth (m)', type: 'continuous', min: 0, max: 2.0, step: 0.1 },
        { id: 'thick', name: 'Thickness (m)', type: 'continuous', min: 0.005, max: 0.5, step: 0.005 }
    ],
    'louver': [
        { id: 'placement', name: 'Placement', type: 'discrete', options: ['ext', 'int'] },
        { id: 'slat-orientation', name: 'Slat Orientation', type: 'discrete', options: ['horizontal', 'vertical'] },
        { id: 'slat-width', name: 'Slat Width (m)', type: 'continuous', min: 0.01, max: 1.0, step: 0.01 },
        { id: 'slat-sep', name: 'Slat Separation (m)', type: 'continuous', min: 0.01, max: 0.5, step: 0.01 },
        { id: 'slat-thick', name: 'Slat Thickness (m)', type: 'continuous', min: 0.001, max: 0.05, step: 0.001 },
        { id: 'slat-angle', name: 'Slat Angle (°)', type: 'continuous', min: -90, max: 90, step: 5 },
        { id: 'dist-to-glass', name: 'Blind to Glass Distance (m)', type: 'continuous', min: 0.0, max: 1.0, step: 0.01 }
    ],
    'roller': [
        { id: 'top-opening', name: 'Top Opening (m)', type: 'continuous', min: -1.0, max: 1.0, step: 0.05 },
        { id: 'bottom-opening', name: 'Bottom Opening (m)', type: 'continuous', min: -1.0, max: 1.0, step: 0.05 },
        { id: 'left-opening', name: 'Left Opening (m)', type: 'continuous', min: -1.0, max: 1.0, step: 0.05 },
        { id: 'right-opening', name: 'Right Opening (m)', type: 'continuous', min: -1.0, max: 1.0, step: 0.05 },
        { id: 'dist-to-glass', name: 'Distance to Glass (m)', type: 'continuous', min: 0.0, max: 1.0, step: 0.01 },
        { id: 'solar-trans', name: 'Solar Transmittance', type: 'continuous', min: 0.0, max: 1.0, step: 0.01 },
        { id: 'solar-refl', name: 'Solar Reflectance', type: 'continuous', min: 0.0, max: 1.0, step: 0.01 },
        { id: 'vis-trans', name: 'Visible Transmittance', type: 'continuous', min: 0.0, max: 1.0, step: 0.01 },
        { id: 'vis-refl', name: 'Visible Reflectance', type: 'continuous', min: 0.0, max: 1.0, step: 0.01 },
        { id: 'ir-emis', name: 'IR Emissivity', type: 'continuous', min: 0.0, max: 1.0, step: 0.01 },
        { id: 'ir-trans', name: 'IR Transmittance', type: 'continuous', min: 0.0, max: 1.0, step: 0.01 },
        { id: 'thickness', name: 'Thickness (m)', type: 'continuous', min: 0.0, max: 0.05, step: 0.001 },
        { id: 'conductivity', name: 'Conductivity (W/m-K)', type: 'continuous', min: 0.0, max: 10.0, step: 0.01 }
    ]
};

// ==================== PUBLIC API ====================

/**
 * Initializes all event listeners for the optimization panel.
* This is called by ai-assistant.js once the panel is in the DOM.
 * @param {HTMLElement} optPanel The specific panel element for this optimization instance.
 */
    export function initOptimizationUI(optPanel) {
    console.log('[initOptimizationUI] Initializing optimization panel UI.');
    optimizationPanel = optPanel; // Store the panel reference

    // Get elements scoped to the correct panel
    const optShadingType = optimizationPanel.querySelector('#opt-shading-type');
    const optSimulationRecipe = optimizationPanel.querySelector('#opt-simulation-recipe');
    const startOptimizationBtn = optimizationPanel.querySelector('#start-optimization-btn');
    const resumeOptimizationBtn = optimizationPanel.querySelector('#resume-optimization-btn');
    const cancelOptimizationBtn = optimizationPanel.querySelector('#cancel-optimization-btn');

    // Setup event listeners
    if (optShadingType) {
        console.log('[initOptimizationUI] Found #opt-shading-type dropdown. Attaching listener.');
        optShadingType.addEventListener('change', () => {
            console.log('[#opt-shading-type change event] Dropdown changed!');
            populateParameters();
        });
    } else {
        console.error('[initOptimizationUI] CRITICAL: #opt-shading-type dropdown not found.');
    }
    optSimulationRecipe?.addEventListener('change', updateGoalMetrics);
    startOptimizationBtn?.addEventListener('click', () => startOptimization(false));
    resumeOptimizationBtn?.addEventListener('click', () => startOptimization(true));
    cancelOptimizationBtn?.addEventListener('click', cancelOptimization);

    // Initial population
    populateParameters();
    updateGoalMetrics();
}

// ==================== UI MANAGEMENT ====================

function populateParameters() {
    if (!optimizationPanel) return; // Guard clause
    const optShadingType = optimizationPanel.querySelector('#opt-shading-type');
    const optParamsContainer = optimizationPanel.querySelector('#opt-params-container');
    const template = document.getElementById('template-opt-param'); // Template is global

    if (!optShadingType || !optParamsContainer || !template) return;

    const type = optShadingType.value;
    console.log(`[populateParameters] Populating for type: ${type}`); // Add this line
    optParamsContainer.innerHTML = ''; // Clear existing

    const params = SHADING_PARAMETERS[type] || [];
    params.forEach(param => {
        const clone = template.content.cloneNode(true);
        const item = clone.querySelector('.opt-param-item');
        item.dataset.paramId = param.id;
        clone.querySelector('.opt-param-name').textContent = param.name;

        const continuousControls = clone.querySelector('.opt-param-controls-continuous');
        const discreteControls = clone.querySelector('.opt-param-controls-discrete');
        const toggle = clone.querySelector('.opt-param-toggle');

        // Add change listener to show/hide controls when toggled
        toggle.addEventListener('change', () => {
            const controls = param.type === 'continuous' ? continuousControls : discreteControls;
            controls.classList.toggle('hidden', !toggle.checked);
        });

        if (param.type === 'continuous') {
            // Set up continuous (min/max/step) controls
            discreteControls.remove(); // Remove the unused template part
            const minInput = clone.querySelector('.opt-param-min');
            const maxInput = clone.querySelector('.opt-param-max');
            const stepInput = clone.querySelector('.opt-param-step');

            minInput.value = param.min;
            minInput.step = param.step;
            maxInput.value = param.max;
            maxInput.step = param.step;

            const finerStep = Math.max(0.0001, param.step / 10.0);
            stepInput.value = param.step;
            stepInput.step = finerStep;
            stepInput.min = finerStep;

        } else if (param.type === 'discrete') {
            // Set up discrete (options) controls
            continuousControls.remove(); // Remove the unused template part
            const select = clone.querySelector('.opt-param-options');
            param.options.forEach(opt => {
                const optionEl = document.createElement('option');
                optionEl.value = opt;
                optionEl.textContent = opt;
                select.appendChild(optionEl);
            });
            // Disable the select by default, enable when checkbox is checked
            select.disabled = true; 
            toggle.addEventListener('change', () => {
                select.disabled = !toggle.checked;
            });
        }

        optParamsContainer.appendChild(clone);
    });
}

function updateGoalMetrics() {
    if (!optimizationPanel) return; // Guard clause
    const optSimulationRecipe = optimizationPanel.querySelector('#opt-simulation-recipe');
    const optGoalMetric = optimizationPanel.querySelector('#opt-goal-metric');

    if (!optSimulationRecipe || !optGoalMetric) return;

    const recipe = optSimulationRecipe.value;
    optGoalMetric.innerHTML = '';

    const metrics = RECIPE_METRICS[recipe] || [];
    metrics.forEach(metric => {
        const option = document.createElement('option');
        option.value = metric.id;
        option.textContent = metric.name;
        optGoalMetric.appendChild(option);
    });
}

function setControlsLocked(locked) {
    isOptimizing = locked;
    if (!optimizationPanel) return;

    const startBtn = optimizationPanel.querySelector('#start-optimization-btn');
    const resumeBtn = optimizationPanel.querySelector('#resume-optimization-btn');
    const cancelBtn = optimizationPanel.querySelector('#cancel-optimization-btn');

    startBtn?.classList.toggle('hidden', locked);
    resumeBtn?.classList.toggle('hidden', locked);
    cancelBtn?.classList.toggle('hidden', !locked);

    [
        'opt-target-wall', 'opt-shading-type', 'opt-simulation-recipe',
        'opt-goal-metric', 'opt-constraint', 'opt-population-size',
        'opt-generations', 'opt-quality'
    ].forEach(id => {
        const element = optimizationPanel.querySelector(`#${id}`);
        if (element) element.disabled = locked;
    });

    // Disable parameter checkboxes and inputs
    optimizationPanel.querySelectorAll('.opt-param-item input').forEach(input => {
        input.disabled = locked;
    });
}

// ==================== LOGGING ====================

function log(message) {
    if (!optimizationPanel) return;
    const logEl = optimizationPanel.querySelector('#optimization-log');
    if (logEl) {
        logEl.textContent += `${message}\n`;
        logEl.scrollTop = logEl.scrollHeight;
    }
    console.log(`[Optimization] ${message}`);
}

function clearLog() {
    if (!optimizationPanel) return;
    const logEl = optimizationPanel.querySelector('#optimization-log');
    if (logEl) {
        logEl.textContent = '';
    }
}

// ==================== OPTIMIZATION CONTROL ====================

function cancelOptimization() {
    if (optimizer) {
    optimizer.stop();
    log('❌ Cancellation requested - will stop after current generation');
    if (!optimizationPanel) return;
    const cancelBtn = optimizationPanel.querySelector('#cancel-optimization-btn');
    if (cancelBtn) {
        cancelBtn.disabled = true;
            cancelBtn.textContent = 'Cancelling...';
        }
    }
}

async function startOptimization(resume = false) {
    if (isOptimizing) {
        showAlert('Optimization already running', 'Error');
        return;
    }

    try {
        setControlsLocked(true);
        if (!resume) clearLog();

        // 1. Gather settings
        const settings = gatherSettings();
        log(`Starting optimization: ${settings.goalId}`);
        log(`  Wall: ${settings.wall.toUpperCase()}, Type: ${settings.shadingType}`);
        log(`  Params: ${settings.parameters.map(p => p.name).join(', ')}`);
        log(`  Population: ${settings.populationSize}, Generations: ${settings.generations}`);

        // 2. Create optimizer
        optimizer = new GeneticOptimizer({
            populationSize: settings.populationSize,
            generations: settings.generations,
            mutationRate: 0.1,
            parameterConstraints: settings.parameters
        });

        // 3. Handle resume
        if (resume) {
            await loadCheckpoint();
        }

        // 4. Define fitness function (SEQUENTIAL execution)
        const fitnessFunction = async (population) => {
            log(`\n=== Evaluating ${population.length} designs for Gen ${optimizer.currentGeneration + 1}/${settings.generations} ===`);
            
            const populationWithFitness = [];
            for (let i = 0; i < population.length; i++) {
                if (!isOptimizing) throw new Error('Optimization cancelled');
                
                const design = population[i];
                log(`  Design ${i + 1}/${population.length}: ${JSON.stringify(design.params)}`);
                
                try {
                    // Apply design to scene
                    await applyDesignToScene(design.params, settings);
                    
                    // Run simulation
                    await runSimulation(settings);
                    
                    // Parse results
                    const fitness = await calculateFitness(settings);
                    design.fitness = fitness.score;
                    design.metricValue = fitness.value; // Store for logging
                    log(`    → Fitness: ${fitness.score.toFixed(2)} (${fitness.value.toFixed(2)}${fitness.unit})`);

                } catch (err) {
                    log(`    → FAILED: ${err.message}`);
                    design.fitness = -Infinity; // Penalize failed designs
                    design.metricValue = 0;
                }
                populationWithFitness.push(design);
            }
            return populationWithFitness;
        };

        // 5. Progress callback
        const progressCallback = async (gen, best, population) => {
            log(`\n✓ Generation ${gen + 1}/${settings.generations} complete`);
            log(`  Best so far: ${best.metricValue.toFixed(2)} (fitness: ${best.fitness.toFixed(2)})`);
            // Save checkpoint
            await saveCheckpoint();
        };

        // 6. Run optimization
        const result = await optimizer.run(fitnessFunction, progressCallback);

        if (isOptimizing) { // Check if it finished, not cancelled
            log(`\n🎉 Optimization complete!`);
            log(`\nBest design:`);
            Object.entries(result.params).forEach(([key, val]) => {
                log(`  ${key}: ${val.toFixed(3)}`);
            });
            log(`  Final score: ${result.metricValue.toFixed(2)}`);
            
            // Apply best design
            await applyDesignToScene(result.params, settings);
            showAlert('Optimization complete! Best design applied to scene.', 'Success');
        }

    } catch (err) {
        log(`\n❌ Error: ${err.message}`);
        if (!err.message.includes('cancelled')) {
            showAlert(`Optimization failed: ${err.message}`, 'Error');
        } else {
            showAlert('Optimization cancelled', 'Info');
        }
    } finally {
        setControlsLocked(false);
        if (optimizationPanel) {
            const cancelBtn = optimizationPanel.querySelector('#cancel-optimization-btn');
            if (cancelBtn) {
                cancelBtn.disabled = false;
        cancelBtn.textContent = 'Cancel';
        }
    }
    optimizer = null;
}
}

// ==================== HELPER FUNCTIONS ====================

function gatherSettings() {
    if (!optimizationPanel) throw new Error("Optimization panel is not initialized.");

    const optParamsContainer = optimizationPanel.querySelector('#opt-params-container');
    const optTargetWall = optimizationPanel.querySelector('#opt-target-wall');
    const optShadingType = optimizationPanel.querySelector('#opt-shading-type');
    const optSimulationRecipe = optimizationPanel.querySelector('#opt-simulation-recipe');
    const optGoalMetric = optimizationPanel.querySelector('#opt-goal-metric');
    const optConstraint = optimizationPanel.querySelector('#opt-constraint');
    const optPopulationSize = optimizationPanel.querySelector('#opt-population-size');
    const optGenerations = optimizationPanel.querySelector('#opt-generations');
    const optQuality = optimizationPanel.querySelector('#opt-quality');

    const selectedParams = [];
    if (optParamsContainer) {
        const currentShadingType = optShadingType?.value || 'overhang';
        optParamsContainer.querySelectorAll('.opt-param-item').forEach(item => {
        const toggle = item.querySelector('.opt-param-toggle');
        if (toggle.checked) {
            const paramId = item.dataset.paramId;
            const paramConfig = SHADING_PARAMETERS[currentShadingType].find(p => p.id === paramId);

            if (paramConfig.type === 'continuous') {
                selectedParams.push({
                    name: paramId,
                    type: 'continuous',
                    min: parseFloat(item.querySelector('.opt-param-min').value),
                    max: parseFloat(item.querySelector('.opt-param-max').value),
                    step: parseFloat(item.querySelector('.opt-param-step').value)
                });
            } else if (paramConfig.type === 'discrete') {
                // For discrete, we don't use min/max, we just pass the available options
                selectedParams.push({
                    name: paramId,
                    type: 'discrete',
                    options: paramConfig.options
                });
            }
        }
    });
    }

    if (selectedParams.length === 0) {
        throw new Error('No parameters selected. Please check at least one parameter to optimize.');
    }
    if (selectedParams.length > 3) {
        throw new Error('Maximum 3 parameters allowed for optimization.');
    }

    return {
        wall: optTargetWall?.value || 's',
        shadingType: optShadingType?.value || 'overhang',
        recipe: optSimulationRecipe?.value || 'sda-ase',
        goalId: optGoalMetric?.value || 'maximize_sDA',
        constraint: optConstraint?.value.trim() || '',
        populationSize: parseInt(optPopulationSize?.value || '10'),
        generations: parseInt(optGenerations?.value || '5'),
        quality: optQuality?.value || 'medium',
        parameters: selectedParams
    };
}

async function applyDesignToScene(params, settings) {
    const { wall, shadingType } = settings;

    // Enable shading for this wall
    setShadingState(wall, { enabled: true, type: shadingType });

    // Set each parameter value in the UI
    for (const [paramName, value] of Object.entries(params)) {
        const paramConfig = SHADING_PARAMETERS[shadingType].find(p => p.id === paramName);

        if (paramConfig.type === 'continuous') {
            // e.g., 'overhang-depth-s'
            const elementId = `${shadingType}-${paramName}-${wall}`;
            setUiValue(elementId, value);
        } else if (paramConfig.type === 'discrete') {
            // Discrete values control buttons or selects, e.g., 'louver-placement-ext-s'
            const dom = getDom();
            if (paramName === 'placement') {
                // This handles button groups like louver/lightshelf placement
                ['ext', 'int', 'both'].forEach(opt => {
                    const btn = dom[`${shadingType}-${paramName}-${opt}-${wall}`];
                    if (btn) btn.classList.toggle('active', opt === value);
                });
                // Also update the visibility of internal/external controls
                if (dom[`${shadingType}-controls-ext-${wall}`]) {
                     dom[`${shadingType}-controls-ext-${wall}`].classList.toggle('hidden', value === 'int');
                }
                if (dom[`${shadingType}-controls-int-${wall}`]) {
                     dom[`${shadingType}-controls-int-${wall}`].classList.toggle('hidden', value === 'ext');
                }

            } else {
                // This handles standard <select> dropdowns like 'slat-orientation'
                const elementId = `${shadingType}-${paramName}-${wall}`;
                setUiValue(elementId, value);
            }
        }
    }

    // Wait for geometry update to propagate
    await new Promise(resolve => setTimeout(resolve, 300));
}

async function runSimulation(settings) {
    // Dynamically import simulation functions to avoid circular dependencies
    const { openRecipePanelByType, programmaticallyGeneratePackage } = await import('./simulation.js');

    // Map recipe ID to template ID
    const recipeTemplates = {
        'sda-ase': 'template-recipe-sda-ase',
        'illuminance': 'template-recipe-illuminance',
        'dgp': 'template-recipe-dgp'
    };
    const templateId = recipeTemplates[settings.recipe];
    if (!templateId) throw new Error(`Unknown recipe: ${settings.recipe}`);

    // Open panel if needed (it may be hidden)
    let panel = document.querySelector(`.floating-window[data-template-id="${templateId}"]`);
    if (!panel || panel.classList.contains('hidden')) {
        panel = openRecipePanelByType(templateId);
        await new Promise(resolve => setTimeout(resolve, 200)); // Wait for panel to render
    }

    // Set quality preset on the recipe panel
    // Handle both floating panels (with suffix) and container (no suffix)
    let panelSuffix = '';
    if (panel.id !== 'recipe-parameters-container') {
        panelSuffix = panel.id.split('-').pop(); // Get the unique panel ID suffix for floating panels
    }
    const qualitySelect = panel.querySelector(`#quality-preset${panelSuffix ? '-' + panelSuffix : ''}`);
    if (qualitySelect) {
        qualitySelect.value = settings.quality;
        qualitySelect.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
        console.warn(`Could not find quality preset selector on panel ${panel.id}`);
    }

    // Generate package using existing function
    const scriptInfo = await programmaticallyGeneratePackage(panel);

    // Run script and wait for it to complete
    return new Promise((resolve, reject) => {
        if (!window.electronAPI?.runScript) {
            return reject(new Error('Electron API (runScript) not available'));
        }

        let output = '';
        const handleExit = (code) => {
            cleanup();
            if (code === 0) resolve({ success: true, output });
            else reject(new Error(`Simulation script failed with code ${code}. Check console for details.`));
        };
        const handleOutput = (data) => {
            output += data;
        };

        // Subscribe to Electron events
        const unsubExit = window.electronAPI.onScriptExit(handleExit);
        const unsubOutput = window.electronAPI.onScriptOutput(handleOutput);

        const cleanup = () => {
            unsubExit();
            unsubOutput();
        };

        // Execute the script
        window.electronAPI.runScript({
            projectPath: project.dirPath,
            scriptName: scriptInfo.shFile
        });
    });
}

async function calculateFitness(settings) {
    const projectName = project.projectName || 'scene';
    const metrics = RECIPE_METRICS[settings.recipe];
    const goalMetric = metrics.find(m => m.id === settings.goalId);
    if (!goalMetric) throw new Error(`Unknown goal: ${settings.goalId}`);

    // Read result file
    const filePath = `08_results/${projectName}${goalMetric.file}`;
    const file = await readProjectFile(filePath);
    
    // Load data into results manager using slot 'a'
    await resultsManager.loadAndProcessFile(file, 'a');

    // Calculate metric value based on recipe
    let value, unit;
    if (settings.recipe === 'sda-ase') {
        const annualMetrics = resultsManager.calculateAnnualMetrics('a', {});
        if (settings.goalId.includes('sDA')) {
            value = annualMetrics.sDA;
        } else {
            value = annualMetrics.ASE;
        }
        unit = '%';
    } else if (settings.recipe === 'illuminance') {
        const stats = resultsManager.getActiveStats();
        value = stats.avg;
        unit = ' lux';
    } else if (settings.recipe === 'dgp') {
        const text = await file.text();
        const match = text.match(/DGP:\s*([\d.]+)/); // Assuming simple text output for DGP
        value = match ? parseFloat(match[1]) : 0;
        unit = '';
    } else {
        throw new Error(`Fitness calculation not implemented for recipe: ${settings.recipe}`);
    }

    // Calculate score (negate for minimize goals)
    let score = settings.goalId.startsWith('minimize') ? -value : value;

    // Apply constraint penalty
    if (settings.constraint) {
        // NOTE: This simple version only constrains the primary metric.
        // A more advanced version would parse multiple files.
        const constraintMet = checkConstraint(value, settings.constraint);
        if (!constraintMet) {
            score = -Infinity; // Heavy penalty for failing constraint
            log(`    → Constraint FAILED (${settings.constraint})`);
        }
    }

    return { score, value, unit };
}

function checkConstraint(value, constraintStr) {
    // Simple constraint parser (e.g., "ASE < 10" or "< 10")
    const regex = /(<|<=|>|>=|==)\s*([\d.]+)/;
    const match = constraintStr.match(regex);
    
    if (!match) {
        console.warn(`Invalid constraint syntax: "${constraintStr}"`);
        return true; // Fail open
    }
    
    const [, operator, thresholdStr] = match;
    const threshold = parseFloat(thresholdStr);

    switch (operator) {
        case '<': return value < threshold;
        case '<=': return value <= threshold;
        case '>': return value > threshold;
        case '>=': return value >= threshold;
        case '==': return Math.abs(value - threshold) < 0.01;
        default: return true;
    }
}

async function readProjectFile(relativePath) {
    if (!window.electronAPI?.readFile || !project.dirPath) {
        throw new Error('File access requires Electron app and saved project');
    }
    
    const result = await window.electronAPI.readFile({
        projectPath: project.dirPath,
        filePath: relativePath
    });

    if (!result.success) {
        throw new Error(`Failed to read file: ${relativePath}. ${result.error}`);
    }

    // Convert Electron's buffer (if any) to a File object
    const buffer = new Uint8Array(result.content.data).buffer;
    const blob = new Blob([buffer]);
    return new File([blob], result.name, { type: 'application/octet-stream' });
}

async function saveCheckpoint() {
    if (!optimizer || !window.electronAPI?.writeFile || !project.dirPath) return;
    
    try {
        const state = optimizer.getState();
        const content = JSON.stringify(state, null, 2);
        await window.electronAPI.writeFile({
            projectPath: project.dirPath,
            filePath: '11_files/optimization_checkpoint.json',
            content: content
        });
        log('  💾 Checkpoint saved');
    } catch (err) {
        log(`  ⚠️ Could not save checkpoint: ${err.message}`);
    }
}

async function loadCheckpoint() {
    if (!optimizer || !window.electronAPI?.readFile || !project.dirPath) return;

    try {
        const result = await window.electronAPI.readFile({
            projectPath: project.dirPath,
            filePath: '11_files/optimization_checkpoint.json'
        });

        if (result.success) {
            // Decode the content from Electron
            const decoder = new TextDecoder('utf-8');
            const content = decoder.decode(new Uint8Array(result.content.data));
            const state = JSON.parse(content);
            
            optimizer.loadState(state);
            log(`✓ Resumed from generation ${state.currentGeneration + 1}`);
        } else {
            throw new Error('Checkpoint file not found or unreadable.');
        }
    } catch (err) {
        log(`⚠️ Could not load checkpoint: ${err.message}. Starting from scratch.`);
    }
}
