import { getDom } from './dom.js';
import { setUiValue, showAlert, setShadingState, getNewZIndex } from './ui.js';
import { project } from './project.js';
import { resultsManager } from './resultsManager.js';
import { GeneticOptimizer } from './optimizationEngine.js';
import { programmaticallyGeneratePackage } from './simulation.js';

let optimizer = null;
let isOptimizing = false;
let optimizationPanel = null; // This will store the reference to the correct panel
let fitnessCache = new Map();

// --- Configuration maps ---
const RECIPE_METRICS = {
    'sda-ase': [
        { id: 'maximize_sDA', name: 'Maximize sDA', file: '_sDA_final.ill' },
        { id: 'minimize_ASE', name: 'Minimize ASE', file: '_ASE_direct_only.ill' }
    ],
    'illuminance': [
        { id: 'maximize_avg', name: 'Maximize Avg Illuminance', file: '_illuminance.txt' },
        { id: 'minimize_avg', name: 'Minimize Avg Illuminance', file: '_illuminance.txt' },
        { id: 'maximize_uniformity', name: 'Maximize Uniformity (U0)', file: '_illuminance.txt' }
    ],
    'dgp': [
        { id: 'minimize_dgp', name: 'Minimize DGP', file: '_DGP.txt' }
    ],
    'imageless-glare': [
        { id: 'minimize_Annual_DGP_Avg', name: 'Minimize Annual Avg DGP', file: '.dgp' },
        { id: 'maximize_Glare_Autonomy_Avg', name: 'Maximize Glare Autonomy (Avg)', file: '.ga' },
        { id: 'maximize_sGA', name: 'Maximize sGA (Spatial Glare Autonomy)', file: '_sGA.txt' }
    ],
    'spectral-lark': [
        { id: 'maximize_CS_avg', name: 'Maximize Circadian Stimulus (CS)', file: 'circadian_summary.json' },
        { id: 'maximize_EML_avg', name: 'Maximize Melanopic Lux (EML)', file: 'circadian_summary.json' }
    ],
    'en17037': [
        { id: 'maximize_EN17037_sDA', name: 'Maximize EN 17037 Daylight Provision', file: 'EN17037_Daylight_Summary.json' },
        { id: 'minimize_EN17037_Glare_Hours', name: 'Minimize EN 17037 Glare Hours', file: 'EN17037_Glare_Summary.json' }
    ]
};

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

const PRESET_PROFILES = {
    "maximize-daylight": {
        recipe: "sda-ase",
        goal: "maximize_sDA",
        constraints: "ASE < 10",
        targetWall: "s", // South
        shadingType: "overhang",
        params: [
            { id: "depth", min: 0.1, max: 1.5, step: 0.1 },
            { id: "dist-above", min: 0.0, max: 0.5, step: 0.05 }
        ]
    },
    "minimize-glare": {
        recipe: "dgp",
        goal: "minimize_dgp",
        constraints: "DGP < 0.40",
        targetWall: "s", // South
        shadingType: "louver",
        params: [
            { id: "slat-angle", min: -45, max: 45, step: 5 }
        ]
    },
    "balanced-performance": {
        recipe: "sda-ase",
        goal: "maximize_sDA",
        constraints: "ASE < 15",
        targetWall: "s", // South
        shadingType: "lightshelf",
        params: [
            { id: "depth", min: 0.2, max: 1.2, step: 0.1 },
            { id: "tilt", min: 0, max: 30, step: 5 }
        ]
    }
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
    const optimizationProfileSelector = optimizationPanel.querySelector('#optimization-profile-selector');
    const startOptimizationBtn = optimizationPanel.querySelector('#start-optimization-btn');
    const quickOptimizeBtn = optimizationPanel.querySelector('#quick-optimize-btn');
    const resumeOptimizationBtn = optimizationPanel.querySelector('#resume-optimization-btn');
    const cancelOptimizationBtn = optimizationPanel.querySelector('#cancel-optimization-btn');
    const infoBtn = optimizationPanel.querySelector('#opt-info-btn');

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

    // In initOptimizationUI(optPanel)
    const applyBestDesignBtn = optimizationPanel.querySelector('#apply-best-design-btn');
    applyBestDesignBtn?.addEventListener('click', () => {
        if (optimizer && optimizer.bestDesign) {
            log('Applying best design from last run...');
            const settings = gatherSettings('full'); // Gather current settings to get wall/type
            applyDesignToScene(optimizer.bestDesign.params, settings);
            showAlert('Best design applied to scene.', 'Success');
        } else {
            showAlert('No best design found to apply.', 'Error');
        }
    });

    optSimulationRecipe?.addEventListener('change', () => {
    updateGoalMetrics();

    // Show/hide performance warning for expensive simulations
    const annualSimWarning = optimizationPanel.querySelector('#opt-warning-annual-sim');
    if (annualSimWarning) {
        const selectedRecipe = optSimulationRecipe.value;
        const isExpensive = ['imageless-glare', 'spectral-lark', 'en17037'].includes(selectedRecipe);
        annualSimWarning.classList.toggle('hidden', !isExpensive);
        }
    });
    
    startOptimizationBtn?.addEventListener('click', () => startOptimization('full'));
    quickOptimizeBtn?.addEventListener('click', () => startOptimization('quick'));
    resumeOptimizationBtn?.addEventListener('click', () => startOptimization('resume'));
    cancelOptimizationBtn?.addEventListener('click', cancelOptimization);
    optimizationProfileSelector?.addEventListener('change', applyPresetProfile);

    // Initial population
    populateParameters();
    updateGoalMetrics();

    // Listener for the new info button
    infoBtn?.addEventListener('click', () => {
        const modal = document.getElementById('optimization-info-modal');
    if (modal) {
        modal.classList.replace('hidden', 'flex'); // Use replace to set display:flex
        modal.style.zIndex = getNewZIndex();
        // We don't need initializePanelControls since it's a simple info modal
        }
    });

    // Listener for new Goal Type dropdown
    const optGoalType = optimizationPanel.querySelector('#opt-goal-type');
    const optTargetValueContainer = optimizationPanel.querySelector('#opt-target-value-container');

    optGoalType?.addEventListener('change', () => {
        const isTargetMode = optGoalType.value === 'set-target';
        optTargetValueContainer?.classList.toggle('hidden', !isTargetMode);
    });
}

function applyPresetProfile() {
    if (!optimizationPanel) return;

    const profileId = optimizationPanel.querySelector('#optimization-profile-selector').value;
    
    const allControls = getOptControls();
    allControls.forEach(control => control.disabled = false);

    if (profileId === 'custom') {
        return;
    }

    const profile = PRESET_PROFILES[profileId];
    if (!profile) return;

    // --- Handle Preset Profile ---

    // 1. Set high-level dropdowns
    const optTargetWall = optimizationPanel.querySelector('#opt-target-wall');
    const optShadingType = optimizationPanel.querySelector('#opt-shading-type');
    const optSimulationRecipe = optimizationPanel.querySelector('#opt-simulation-recipe');
    const optConstraint = optimizationPanel.querySelector('#opt-constraint');

    if (optTargetWall) optTargetWall.value = profile.targetWall;
    if (optShadingType) {
        optShadingType.value = profile.shadingType;
        optShadingType.dispatchEvent(new Event('change')); // This re-populates parameters
    }
    if (optSimulationRecipe) {
        optSimulationRecipe.value = profile.recipe;
        optSimulationRecipe.dispatchEvent(new Event('change')); // This re-populates goals
    }
    if (optConstraint) optConstraint.value = profile.constraints;

    // 2. Use timeouts to wait for UI to update from the dispatched events
    setTimeout(() => {
        // Set goal metric
        const optGoalMetric = optimizationPanel.querySelector('#opt-goal-metric');
        if (optGoalMetric) {
            optGoalMetric.value = profile.goal;
        }
    }, 150); // For goal to populate

    setTimeout(() => {
        const optParamsContainer = optimizationPanel.querySelector('#opt-params-container');
        if (!optParamsContainer) return;

        // Uncheck all parameters first
        optParamsContainer.querySelectorAll('.opt-param-toggle').forEach(toggle => {
            if (toggle.checked) toggle.click();
        });

        // Check and configure the ones in the profile
        profile.params.forEach(param => {
            const paramItem = optParamsContainer.querySelector(`[data-param-id="${param.id}"]`);
            if (paramItem) {
                const toggle = paramItem.querySelector('.opt-param-toggle');
                if (toggle && !toggle.checked) {
                    toggle.click();
                }
                const minInput = paramItem.querySelector('.opt-param-min');
                if (minInput) minInput.value = param.min;
                const maxInput = paramItem.querySelector('.opt-param-max');
                if (maxInput) maxInput.value = param.max;
                const stepInput = paramItem.querySelector('.opt-param-step');
                if (stepInput) stepInput.value = param.step;
            }
        });

    }, 300); // For parameters to populate
}

/**
 * Updates the parameter counter display based on checked items.
 */
function updateParameterCount() {
    if (!optimizationPanel) return;
    const optParamsContainer = optimizationPanel.querySelector('#opt-params-container');
    const optParamCount = optimizationPanel.querySelector('#opt-param-count');
    if (!optParamsContainer || !optParamCount) return;

    const checkedParams = optParamsContainer.querySelectorAll('.opt-param-toggle:checked').length;
    
    optParamCount.textContent = `${checkedParams} / 3 selected`;
    optParamCount.classList.toggle('text-[--danger-color]', checkedParams > 3);
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
            updateParameterCount(); // Update the counter
        });

        // Add listener for discrete selection as well
        const discreteSelect = clone.querySelector('.opt-param-options');
        if (discreteSelect) {
            discreteSelect.addEventListener('change', updateParameterCount);
        }

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
    const quickBtn = optimizationPanel.querySelector('#quick-optimize-btn'); // Get quick optimize btn
    const cancelBtn = optimizationPanel.querySelector('#cancel-optimization-btn');
    const applyBtn = optimizationPanel.querySelector('#apply-best-design-btn'); // Get new apply btn

    startBtn?.classList.toggle('hidden', locked);
    resumeBtn?.classList.toggle('hidden', locked);
    quickBtn?.classList.toggle('hidden', locked); // Hide quick optimize btn during run
    cancelBtn?.classList.toggle('hidden', !locked);

    // Only show the "Apply Best" button after a run is finished (locked=false) AND a best design exists
    applyBtn?.classList.toggle('hidden', locked || !optimizer?.bestDesign);

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

export async function startOptimization(mode = 'full') {
    if (isOptimizing) {
        showAlert('Optimization already running', 'Error');
        return;
    }

    const resume = mode === 'resume';

    try {
        setControlsLocked(true);
        if (!resume) {
            clearLog();
            fitnessCache.clear(); // Clear cache at the start of a new run
        }

        // 1. Gather settings
        const settings = gatherSettings(mode);
        log(`Starting optimization: ${settings.goalId}`);
        log(`  Wall: ${settings.wall.toUpperCase()}, Type: ${settings.shadingType}`);
        log(`  Params: ${settings.parameters.map(p => p.name).join(', ')}`);
        log(`  Population: ${settings.populationSize}, Max Evals: ${settings.maxEvaluations}`);

        // 2. Create optimizer
        optimizer = new GeneticOptimizer({
            populationSize: settings.populationSize,
            maxEvaluations: settings.maxEvaluations, // Changed from generations
            mutationRate: 0.1,
            parameterConstraints: settings.parameters
        });

        // 3. Handle resume
        if (resume) {
            await loadCheckpoint();
        }

        // 4. Define fitness function (evaluates ONE design)
        const fitnessFunction = async (designParams) => {
            if (optimizer.shouldStop) throw new Error('Optimization cancelled');

            log(`  Spawning evaluation for: ${JSON.stringify(designParams)}`);

            try {
                // evaluateDesignHeadless is our cached, headless function
                const fitness = await evaluateDesignHeadless(designParams, settings);
                // Return the full design object, including fitness and metric value
                const design = {
                    params: designParams,
                    fitness: fitness.score,
                    metricValue: fitness.value,
                    unit: fitness.unit
                };
                log(`    → Fitness: ${fitness.score.toFixed(2)} (${fitness.value.toFixed(2)}${fitness.unit})`);
                return design;
            } catch (err) {
                log(`    → FAILED: ${JSON.stringify(designParams)}: ${err.message}`);
                return {
                    params: designParams,
                    fitness: -Infinity, // Penalize failed designs
                    metricValue: 0,
                    unit: ''
                };
            }
        };

        // 5. Progress callback
        const progressCallback = async (evalsCompleted, bestDesign) => {
            const summaryList = optimizationPanel.querySelector('#optimization-summary-list');
            const placeholder = optimizationPanel.querySelector('#opt-summary-placeholder');
            if (placeholder) placeholder.style.display = 'none';

            // Only update the summary list if this is a new best
            const lastBestFitness = parseFloat(optimizationPanel.dataset.lastBestFitness || -Infinity);

            if (bestDesign.fitness > lastBestFitness) {
                const li = document.createElement('li');
                li.className = 'p-2 bg-[--grid-color] rounded';
                li.innerHTML = `<strong>Eval #${evalsCompleted}:</strong> New Best: ${bestDesign.metricValue.toFixed(2)}${bestDesign.unit} (Params: ${JSON.stringify(bestDesign.params)})`;
                summaryList.appendChild(li);
                summaryList.scrollTop = summaryList.scrollHeight; // Auto-scroll
                optimizationPanel.dataset.lastBestFitness = bestDesign.fitness;
            }

            log(`✓ Evals ${evalsCompleted}/${settings.maxEvaluations}. Best fitness: ${bestDesign.fitness.toFixed(2)}`);
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
        // Do not nullify optimizer here, so "Apply Best Design" can work
        // optimizer = null;
    }
}

// ==================== HELPER FUNCTIONS ====================

function gatherSettings(mode = 'full') {
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

    let populationSize = parseInt(optPopulationSize?.value || '10');
    // Read "Max Evaluations" from the UI, which was formerly "Generations"
    let maxEvaluations = parseInt(optGenerations?.value || '50');

    if (mode === 'quick') {
        populationSize = 8;
        maxEvaluations = 20; // e.g., 8 initial + 6 pairs
        log('?? Using Quick Optimize settings: 8 population, 20 max evaluations.');
    }

    if (selectedParams.length === 0) {
        throw new Error('No parameters selected. Please check at least one parameter to optimize.');
    }
    if (selectedParams.length > 3) {
        throw new Error('Maximum 3 parameters allowed for optimization.');
    }

    const optGoalType = optimizationPanel.querySelector('#opt-goal-type');
    const optGoalTargetValue = optimizationPanel.querySelector('#opt-goal-target-value');

return {
    wall: optTargetWall?.value || 's',
    shadingType: optShadingType?.value || 'overhang',
    recipe: optSimulationRecipe?.value || 'sda-ase',
    goalId: optGoalMetric?.value || 'maximize_sDA',
    goalType: optGoalType?.value || 'maximize', // NEW
    targetValue: parseFloat(optGoalTargetValue?.value || '0'), // NEW
    constraint: optConstraint?.value.trim() || '',
    populationSize: populationSize,
        maxEvaluations: maxEvaluations, // Changed from generations
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

    // Map optimization recipe IDs to their full template IDs from simulation.js
    const recipeTemplateMap = {
        'sda-ase': 'template-recipe-sda-ase',
        'illuminance': 'template-recipe-illuminance',
        'dgp': 'template-recipe-dgp',
        'imageless-glare': 'template-recipe-imageless-glare',
        'spectral-lark': 'template-recipe-spectral-lark',
        'en17037': 'template-recipe-en17037'
        // 'en-illuminance' is excluded as it's not for shading optimization
    };

    const templateId = recipeTemplateMap[recipe];

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
        if (settings.goalId.includes('avg')) {
            value = stats.avg;
        } else if (settings.goalId === 'maximize_uniformity') {
            // Calculate U0 = Emin / Eavg
            value = (stats.min > 0 && stats.avg > 0) ? (stats.min / stats.avg) : 0;
        }
        unit = settings.goalId === 'maximize_uniformity' ? ' (U0)' : ' lux';
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

/**
 * Reads a result file from the project directory using Electron backend.
 * @param {string} filePath - The relative path to the file.
 * @returns {Promise<File>} A promise that resolves with a File object.
 * @private
 */
async function _getFileFromElectron(filePath) {
    if (!window.electronAPI?.readFile || !project.dirPath) {
        throw new Error("File access requires Electron app and saved project.");
    }

    const result = await window.electronAPI.readFile({
        projectPath: project.dirPath,
        filePath: filePath
    });

    if (!result.success) {
        throw new Error(`Failed to read file: ${filePath}. ${result.error || 'File not found.'}`);
    }

    // Convert Electron's buffer (if any) to a File object
    const buffer = new Uint8Array(result.content.data).buffer;
    const blob = new Blob([buffer]);
    return new File([blob], result.name, { type: 'application/octet-stream' });
}

/**
 * Parses simulation results and calculates fitness score.
 * @param {string} recipe - The recipe ID.
 * @param {string} goalId - The goal being optimized (e.g., 'maximize_sDA').
 * @param {string} constraint - Optional constraint string (e.g., "ASE < 10").
 * @param {string} uniqueId - The unique ID for this simulation run.
 * @returns {Promise<object>} An object with score, metricValue, and unit.
 * @private
 */
async function _parseSimulationResult(recipe, goalId, constraint, uniqueId, goalType, targetValue) {
    const projectName = project.projectName || 'scene';
    const metrics = RECIPE_METRICS[recipe];
    const goalMetric = metrics.find(m => m.id === goalId);
    if (!goalMetric) throw new Error(`Unknown goal: ${goalId}`);

    // --- 1. Construct the correct file path ---
    let resultFileName, filePath;
    const baseName = `${projectName}_${uniqueId}`;

    switch (recipe) {
        case 'sda-ase':
            resultFileName = `${baseName}${goalMetric.file}`; // e.g., _sDA_final.ill
            filePath = `08_results/${resultFileName}`;
            break;
        case 'illuminance':
            resultFileName = `${baseName}${goalMetric.file}`; // e.g., _illuminance.txt
            filePath = `08_results/${resultFileName}`;
            break;
        case 'dgp':
            resultFileName = `${baseName}${goalMetric.file}`; // e.g., _DGP.txt
            filePath = `08_results/${resultFileName}`;
            break;
        case 'imageless-glare':
            if (goalId === 'maximize_sGA') {
                resultFileName = `${baseName}_sGA.txt`; // Assumes script outputs this
            } else if (goalId === 'maximize_Glare_Autonomy_Avg') {
                resultFileName = `${baseName}.ga`; // This is a per-point file
            } else {
                resultFileName = `${baseName}.dgp`; // This is a per-point, per-hour file
            }
            filePath = `08_results/${resultFileName}`;
            break;
        case 'spectral-lark':
            // This recipe outputs a JSON summary
            resultFileName = `circadian_summary.json`; // This file name is static from the recipe
            filePath = `08_results/spectral_9ch/${baseName}/${resultFileName}`;
            break;
        case 'en17037':
            // This recipe outputs multiple JSON summaries
            if (goalId.includes('Daylight')) {
                resultFileName = `EN17037_Daylight_Summary.json`;
            } else {
                resultFileName = `EN17037_Glare_Summary.json`;
            }
            filePath = `08_results/${baseName}/${resultFileName}`;
            break;
        default:
            throw new Error(`Fitness calculation not implemented for recipe: ${recipe}`);
    }

    try {
        const file = await _getFileFromElectron(filePath);
        const textContent = await file.text();

        // Load .ill data into results manager for sDA/ASE
        if (goalMetric.file.endsWith('.ill')) {
            await resultsManager.loadAndProcessFile(file, 'a');
        }

        // --- 2. Calculate metric value ---
        let value, unit, constraintValue, constraintMet = true;

        switch (recipe) {
            case 'sda-ase': {
                const annualMetrics = resultsManager.calculateAnnualMetrics('a', {});
                value = goalId.includes('sDA') ? annualMetrics.sDA : annualMetrics.ASE;
                unit = '%';
                if (constraint) {
                    const constMetricId = constraint.split(' ')[0].toUpperCase();
                    constraintValue = (constMetricId === 'ASE') ? annualMetrics.ASE : annualMetrics.sDA;
                    constraintMet = checkConstraint(constraintValue, constraint);
                }
                break;
            }
            case 'illuminance': {
                // .txt files are loaded as .ill
                const stats = resultsManager.getActiveStats();
                if (goalId.includes('avg')) {
                    value = stats.avg; unit = ' lux';
                } else { // uniformity
                    value = (stats.min > 0 && stats.avg > 0) ? (stats.min / stats.avg) : 0; unit = ' (U0)';
                }
                if (constraint) constraintMet = checkConstraint(value, constraint);
                break;
            }
            case 'dgp': {
                const match = textContent.match(/DGP:\s*([\d.]+)/);
                value = match ? parseFloat(match[1]) : 0; unit = '';
                if (constraint) constraintMet = checkConstraint(value, constraint);
                break;
            }
            case 'imageless-glare': {
                // This is complex. We need to parse different files.
                // This requires the .ga and .dgp files to be simple text files with one value per line.
                const data = textContent.split('\n').map(parseFloat).filter(v => !isNaN(v));
                if (data.length === 0) throw new Error('Empty results file for imageless glare.');

                if (goalId === 'maximize_sGA') {
                    value = parseFloat(textContent.trim()); // sGA.txt is just one number
                    unit = '%';
                } else {
                    // For Avg DGP or Avg GA, we take the average of all points
                    value = data.reduce((a, b) => a + b, 0) / data.length;
                    unit = goalId.includes('DGP') ? '' : '%';
                }
                if (constraint) constraintMet = checkConstraint(value, constraint);
                break;
            }
            case 'spectral-lark': {
                const data = JSON.parse(textContent);
                value = (goalId === 'maximize_CS_avg') ? data.space_average.CS : data.space_average.EML;
                unit = (goalId === 'maximize_CS_avg') ? '' : ' m-EDI lux';
                if (constraint) {
                    const constMetricId = constraint.split(' ')[0].toUpperCase();
                    constraintValue = (constMetricId === 'CS') ? data.space_average.CS : data.space_average.EML;
                    constraintMet = checkConstraint(constraintValue, constraint);
                }
                break;
            }
            case 'en17037': {
                const data = JSON.parse(textContent);
                if (goalId.includes('Daylight')) {
                    value = data.metrics.percent_area_passed_target; // e.g., 95.0
                    unit = '%';
                } else { // Glare
                    value = data.metrics.percent_time_failed; // e.g., 4.5
                    unit = '% time';
                }
                if (constraint) constraintMet = checkConstraint(value, constraint);
                break;
            }
            default:
                throw new Error(`Value parsing not implemented for recipe: ${recipe}`);
        }

        // --- 3. Calculate final score based on NEW Goal Type ---
        let score;
        if (goalType === 'maximize') {
            score = value;
        } else if (goalType === 'minimize') {
            score = -value;
        } else { // 'set-target'
            score = -Math.abs(value - targetValue); // Fitness is maximized when difference is 0
        }

        if (!constraintMet) {
            score = -Infinity; // Heavy penalty
            log(`    → Constraint FAILED (${constraint})`);
        }

        return { score, value, unit };

    } catch (error) {
        console.error(`Failed to parse simulation results from ${filePath}:`, error);
        return { score: -Infinity, value: 0, unit: '' }; // Return worst fitness
    }
}

/**
 * Generates a simulation script for a specific recipe and quality setting.
 * @param {string} recipe - The recipe ID (e.g., 'sda-ase').
 * @param {string} quality - The quality preset ('draft', 'medium', 'high').
 * @param {string} uniqueId - A unique identifier for this run.
 * @returns {Promise<string>} The shell script content.
 * @private
 */
async function _generateQuickSimScript(recipe, quality, uniqueId) {
    const recipeTemplates = {
        'sda-ase': 'template-recipe-sda-ase',
        'illuminance': 'template-recipe-illuminance',
        'dgp': 'template-recipe-dgp'
    };
    const templateId = recipeTemplates[recipe];
    if (!templateId) throw new Error(`Unknown recipe: ${recipe}`);

    // Find the recipe panel. It must be open in the UI to be configured.
    let panel = document.getElementById('recipe-parameters-container');
    if (!panel || panel.dataset.activeRecipeTemplate !== templateId) {
         // If not active in the main container, find its floating window
         panel = document.querySelector(`.floating-window[data-template-id="${templateId}"]`);
    }

    if (!panel) {
        throw new Error(`Could not find an open recipe panel for ${recipe}. Please open it in the UI first.`);
    }

    // Set quality preset on the recipe panel
    const qualitySelect = panel.querySelector(`[id^="quality-preset"]`);
    if (qualitySelect) {
        qualitySelect.value = quality;
        qualitySelect.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
        console.warn(`Could not find quality preset selector on panel ${panel.id}`);
    }

    // Generate package
    const scriptInfo = await programmaticallyGeneratePackage(panel, uniqueId);
    if (!scriptInfo || !scriptInfo.shFile) {
        throw new Error("Failed to generate simulation package or script info.");
    }

    // Read the script file content
    if (!window.electronAPI?.readFile) {
        throw new Error("Reading script files requires Electron API.");
    }

    const scriptFile = await window.electronAPI.readFile({
        projectPath: project.dirPath,
        filePath: `07_scripts/${scriptInfo.shFile}`
    });

    if (!scriptFile.success) {
        throw new Error(`Could not read generated script file: ${scriptInfo.shFile}`);
    }

    const decoder = new TextDecoder('utf-8');
    return decoder.decode(scriptFile.content.data);
}

// ==================== HEADLESS EVALUATION FUNCTIONS ====================

/**
 * Evaluates the fitness of a single design headlessly by running a simulation.
 * This function is called in parallel by the Genetic Optimizer.
 * @param {object} designParams - The design parameters to evaluate.
 * @param {object} settings - The optimization settings object.
 * @returns {Promise<object>} An object with score, value, and unit.
 */
async function evaluateDesignHeadless(designParams, settings) {
    // --- Caching Logic ---
    const designKey = JSON.stringify(designParams);
    if (fitnessCache.has(designKey)) {
        const cachedResult = fitnessCache.get(designKey);
        log(`    → (Cache HIT) Design ${designKey}. Fitness: ${cachedResult.score.toFixed(2)}`);
        return cachedResult;
    }
    // --- End Caching Logic ---

    const { wall, shadingType, recipe, goalId, constraint, quality } = settings;

    // 1. Apply the design parameters to the scene (for geometry generation)
    // This function needs to update the UI sliders so that `programmaticallyGeneratePackage`
    // can read the correct values to generate the geometry.
    await applyDesignToScene(designParams, settings);

    // 2. Generate the simulation script
    // We need a unique ID for this simulation to prevent file collisions
    const uniqueId = `opt_${optimizer.currentGeneration}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const scriptContent = await _generateQuickSimScript(recipe, quality, uniqueId);

    if (!window.electronAPI?.runScriptHeadless || !project.dirPath) {
        throw new Error("Optimization requires Electron app and a saved project directory.");
    }

    // 3. Run the script headlessly
    const result = await window.electronAPI.runScriptHeadless({
        projectPath: project.dirPath,
        scriptContent: scriptContent
    });

    if (!result.success) {
        console.warn(`Headless simulation failed for ${uniqueId}. Stderr:`, result.stderr);
        throw new Error(`Simulation run failed. See console for details.`);
    }

    // 4. Parse the results and calculate fitness
    // Use the uniqueId to find the correct result file
    const fitness = await _parseSimulationResult(recipe, goalId, constraint, uniqueId, settings.goalType, settings.targetValue);

// --- Caching Logic ---
    fitnessCache.set(designKey, fitness); // Store the new result
    // --- End Caching Logic ---

    return fitness;
}