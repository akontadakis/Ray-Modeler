import { getDom } from './dom.js';
import { setUiValue, showAlert, setShadingState, getNewZIndex } from './ui.js';
import { project } from './project.js';
import { resultsManager } from './resultsManager.js';
import { GeneticOptimizer } from './optimizationEngine.js';
import { MultiObjectiveOptimizer } from './mogaOptimizer.js'; // ADDED
import { programmaticallyGeneratePackage } from './simulation.js';

let optimizer = null; // Can be instance of GeneticOptimizer or MultiObjectiveOptimizer
let isOptimizing = false;
let optimizationPanel = null; // This will store the reference to the correct panel
let fitnessCache = new Map(); // Cache evaluations: designKey -> metrics object
let selectedDesignParams = null; // Store params of the clicked-on result


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
    const dom = getDom(); // Get all GLOBAL DOM elements (though we don't use it here)

    // --- Get all controls ---
    // These elements are INSIDE the optPanel, so we must query it.
    const optType = optPanel.querySelector('#opt-type');
    const singleObjectiveControls = optPanel.querySelector('#opt-single-objective-controls');
    const multiObjectiveControls = optPanel.querySelector('#opt-multi-objective-controls');

    const optShadingType = optPanel.querySelector('#opt-shading-type');
    const optSimulationRecipe = optPanel.querySelector('#opt-simulation-recipe'); // SSGA recipe
    const optRecipe1 = optPanel.querySelector('#opt-recipe-1'); // MOGA recipe 1
    const optRecipe2 = optPanel.querySelector('#opt-recipe-2'); // MOGA recipe 2
    const optGoal1 = optPanel.querySelector('#opt-goal-1');
const optGoal2 = optPanel.querySelector('#opt-goal-2');
const optGoalMetric = optPanel.querySelector('#opt-goal-metric'); // SSGA metric

const optimizationProfileSelector = optPanel.querySelector('#optimization-profile-selector');
    const startOptimizationBtn = optPanel.querySelector('#start-optimization-btn');
    const quickOptimizeBtn = optPanel.querySelector('#quick-optimize-btn');
    const resumeOptimizationBtn = optPanel.querySelector('#resume-optimization-btn');
    const cancelOptimizationBtn = optPanel.querySelector('#cancel-optimization-btn');
    const infoBtn = optPanel.querySelector('#opt-info-btn');
    const applyBestDesignBtn = optPanel.querySelector('#apply-best-design-btn');
    const summaryList = optPanel.querySelector('#optimization-summary-list');

    // --- Attach Event Listeners ---

    // Main optimizer type selector
    optType?.addEventListener('change', () => {
        const isMOGA = optType.value === 'moga';
        singleObjectiveControls?.classList.toggle('hidden', isMOGA);
        multiObjectiveControls?.classList.toggle('hidden', !isMOGA);

        // Update the "Max Evals / Gens" label
        const generationsLabel = optimizationPanel.querySelector('label[for="opt-generations"]');
        if (generationsLabel) {
            generationsLabel.textContent = isMOGA ? 'Max Generations' : 'Max Evaluations';
        }
    });

    // Shading type selector
    if (optShadingType) {
        optShadingType.addEventListener('change', () => {
            populateParameters();
        });
    }

    // --- Recipe/Goal Selectors ---

    // Helper to populate a goal dropdown based on a recipe dropdown
    const populateGoals = (recipeSelect, goalSelect) => {
        const recipe = recipeSelect.value;
        goalSelect.innerHTML = '';
        const metrics = RECIPE_METRICS[recipe] || [];
        metrics.forEach(metric => {
            const option = document.createElement('option');
            option.value = metric.id;
            option.textContent = metric.name;
            goalSelect.appendChild(option);
        });
    };

    /// Populate all recipe dropdowns
[optSimulationRecipe, optRecipe1, optRecipe2].forEach(recipeSelect => {
    if (!recipeSelect) return;

    recipeSelect.innerHTML = ''; // Clear

    // Add placeholder ONLY for recipe 2
    if (recipeSelect.id === 'opt-recipe-2') {
        const placeholder = document.createElement('option');
        placeholder.value = "";
        placeholder.textContent = "(Same as Objective 1)";
        recipeSelect.appendChild(placeholder);
    }

    Object.keys(RECIPE_METRICS).forEach(recipeId => {
        const option = document.createElement('option');
        option.value = recipeId;
        option.textContent = recipeId.replace(/-/g, ' ').replace('sda ase', 'sDA/ASE');

        // Set default for SSGA and MOGA-1
        if(recipeId === 'sda-ase' && recipeSelect.id !== 'opt-recipe-2') {
            option.selected = true;
        }
        recipeSelect.appendChild(option);
    });
});

    // Add listeners to recipe dropdowns
    optSimulationRecipe?.addEventListener('change', () => {
        populateGoals(optSimulationRecipe, optGoalMetric);
        updateAnnualSimWarning(optSimulationRecipe.value);
    });

    optRecipe1?.addEventListener('change', () => {
        populateGoals(optRecipe1, optGoal1);
        // Sync recipe 2 dropdown if its value is "" (placeholder)
        if (optRecipe2 && optRecipe2.value === "") {
            optRecipe2.dispatchEvent(new Event('change')); // Trigger goal 2 update
        }
        updateAnnualSimWarning(optRecipe1.value);
    });

    optRecipe2?.addEventListener('change', () => {
        // If placeholder is selected, use recipe 1's value. Otherwise, use its own value.
        const recipeToUse = (optRecipe2.value === "") ? optRecipe1 : optRecipe2;
        populateGoals(recipeToUse, optGoal2);
    });

    // --- Initial Population of UI ---
    startOptimizationBtn?.addEventListener('click', () => startOptimization('full'));
    quickOptimizeBtn?.addEventListener('click', () => startOptimization('quick'));
    resumeOptimizationBtn?.addEventListener('click', () => startOptimization('resume'));
    cancelOptimizationBtn?.addEventListener('click', cancelOptimization);
    optimizationProfileSelector?.addEventListener('change', applyPresetProfile);

    // --- Results List Listeners ---
    summaryList?.addEventListener('click', (e) => {
        const li = e.target.closest('li[data-params]');
        if (li) {
            // Remove 'active' from all others
            summaryList.querySelectorAll('li').forEach(item => item.classList.remove('active-result'));
            // Add 'active' to clicked
            li.classList.add('active-result');
            // Store the params
            selectedDesignParams = JSON.parse(li.dataset.params);
            applyBestDesignBtn?.classList.remove('hidden');
            }
    });

    applyBestDesignBtn?.addEventListener('click', () => {
        if (selectedDesignParams) {
            log('Applying selected design...');
            const settings = gatherSettings('full'); // Gather current settings just to get wall/type
            applyDesignToScene(selectedDesignParams, settings);
            showAlert('Selected design applied to scene.', 'Success');
        } else {
            showAlert('No design selected from the list.', 'Error');
        }
    });

    // --- Info Button ---
    infoBtn?.addEventListener('click', () => {
        const modal = document.getElementById('optimization-info-modal');
        if (modal) {
            modal.classList.replace('hidden', 'flex');
            modal.style.zIndex = getNewZIndex();
        }
    });

    // --- Goal Type Dropdown (SSGA) ---
    const optGoalType = optimizationPanel.querySelector('#opt-goal-type');
    const optTargetValueContainer = optimizationPanel.querySelector('#opt-target-value-container');
    optGoalType?.addEventListener('change', () => {
        const isTargetMode = optGoalType.value === 'set-target';
        optTargetValueContainer?.classList.toggle('hidden', !isTargetMode);
    });

    // --- Initial Population of UI ---
    populateParameters();
    if (optSimulationRecipe && optGoalMetric) {
        populateGoals(optSimulationRecipe, optGoalMetric);
    }
    if (optRecipe1 && optGoal1) {
        populateGoals(optRecipe1, optGoal1);
    }
    if (optRecipe1 && optRecipe2 && optGoal2) {
    // Set default for Recipe 2 to match Recipe 1
    optRecipe2.value = optRecipe1.value; 

    // Populate Goal 2 based on Recipe 1 (since Recipe 2 is now synced)
    populateGoals(optRecipe1, optGoal2); 

    // Set default for Obj 2
    if (optGoal2.options.length > 1) {
        // Try to set a different default than obj 1
        if (optGoal1 && optGoal1.value === 'maximize_sDA' && optGoal2.querySelector('[value="minimize_ASE"]')) {
             optGoal2.value = 'minimize_ASE';
        } else if (optGoal1 && optGoal1.value === 'minimize_ASE' && optGoal2.querySelector('[value="maximize_sDA"]')) {
             optGoal2.value = 'maximize_sDA';
        } else {
            // fallback
            optGoal2.selectedIndex = Math.min(1, optGoal2.options.length - 1);
        }
    }
    }
}

/**
 * Helper to show/hide the annual sim performance warning
 */
function updateAnnualSimWarning(recipeId) {
    if (!optimizationPanel) return;
    const annualSimWarning = optimizationPanel.querySelector('#opt-warning-annual-sim');
    if (annualSimWarning) {
        const isExpensive = ['imageless-glare', 'spectral-lark', 'en17037'].includes(recipeId);
        annualSimWarning.classList.toggle('hidden', !isExpensive);
    }
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
    if (resume && !optimizer) {
        showAlert('No previous optimization run found to resume.', 'Error');
        return;
    }

    // Clear previous results list
    const summaryList = optimizationPanel.querySelector('#optimization-summary-list');
    const placeholder = optimizationPanel.querySelector('#opt-summary-placeholder');
    if (summaryList) summaryList.innerHTML = '';
    if (placeholder) placeholder.style.display = 'block';
    optimizationPanel.dataset.lastBestFitness = -Infinity;
    selectedDesignParams = null;
    dom['apply-best-design-btn']?.classList.add('hidden');

    try {
        setControlsLocked(true);
        if (!resume) {
            clearLog();
            fitnessCache.clear();
        }

        // 1. Gather settings
        const settings = gatherSettings(mode);

        if (settings.type === 'ssga') {
            // --- SINGLE-OBJECTIVE (SSGA) WORKFLOW ---
            log(`Starting Single-Objective (SSGA) optimization: ${settings.goalId}`);
            log(`  Wall: ${settings.wall.toUpperCase()}, Type: ${settings.shadingType}`);
            log(`  Params: ${settings.parameters.map(p => p.name).join(', ')}`);
            log(`  Population: ${settings.populationSize}, Max Evals: ${settings.maxEvaluations}`);

            optimizer = new GeneticOptimizer({
                populationSize: settings.populationSize,
                maxEvaluations: settings.maxEvaluations,
                mutationRate: 0.1,
                parameterConstraints: settings.parameters
            });

            if (resume) await loadCheckpoint();

            const fitnessFunction = async (designParams) => {
                if (optimizer.shouldStop) throw new Error('Optimization cancelled');
                const designKey = JSON.stringify(designParams);
                if (fitnessCache.has(designKey)) {
                    log(`    → (Cache HIT) ${designKey}`);
                    // Return the pre-calculated ssgaResult for the optimizer
                    return fitnessCache.get(designKey).ssgaResult;
                }

                log(`  Spawning eval for: ${designKey}`);
                const metrics = await evaluateDesignHeadless(designParams, settings);
                const fitness = _calculateSingleFitness(metrics, settings);

                const result = {
                    params: designParams,
                    fitness: fitness.score,
                    metricValue: fitness.value,
                    unit: fitness.unit
                };

                // Store BOTH the raw metrics (for AI analysis) and the processed result (for the SSGA)
                fitnessCache.set(designKey, { rawMetrics: metrics, ssgaResult: result });

                log(`    → Fitness: ${fitness.score.toFixed(2)} (${fitness.value.toFixed(2)}${fitness.unit})`);
                return result; // Return the processed result to the optimizer
            };

            const progressCallback = async (evalsCompleted, bestDesign) => {
                populateParetoFront([bestDesign], 'ssga'); // Use same display for single best
                log(`✓ Evals ${evalsCompleted}/${settings.maxEvaluations}. Best: ${bestDesign.metricValue.toFixed(2)}${bestDesign.unit}`);
                await saveCheckpoint();
            };

            const result = await optimizer.run(fitnessFunction, progressCallback);

            if (isOptimizing) { // Check if it finished, not cancelled
                log(`\n🎉 Optimization complete!`);
                log(`\nBest design:`);
                Object.entries(result.params).forEach(([key, val]) => log(`  ${key}: ${val.toFixed(3)}`));
                log(`  Final score: ${result.metricValue.toFixed(2)}${result.unit}`);

                await applyDesignToScene(result.params, settings);
                showAlert('Optimization complete! Best design applied to scene.', 'Success');
                dom['apply-best-design-btn']?.classList.add('hidden'); // No need to re-apply
            }

        } else {
            // --- MULTI-OBJECTIVE (MOGA) WORKFLOW ---
            log(`Starting Multi-Objective (MOGA) optimization...`);
            log(`  Objectives: ${settings.objectives.map(o => o.id).join(', ')}`);
            log(`  Params: ${settings.parameters.map(p => p.name).join(', ')}`);
            log(`  Population: ${settings.populationSize}, Max Gens: ${settings.maxGenerations}`);

            optimizer = new MultiObjectiveOptimizer({
                populationSize: settings.populationSize,
                maxGenerations: settings.maxGenerations,
                mutationRate: 0.1,
                parameterConstraints: settings.parameters,
                objectives: settings.objectives
            });

            if (resume) await loadCheckpoint();

            const fitnessFunction = async (designParams) => {
                if (optimizer.shouldStop) throw new Error('Optimization cancelled');
                const designKey = JSON.stringify(designParams);
                if (fitnessCache.has(designKey)) {
                    log(`    → (Cache HIT) ${designKey}`);
                    // Return the raw metrics for the MOGA optimizer
                    return fitnessCache.get(designKey).rawMetrics;
                }

                log(`  Spawning eval for: ${designKey}`);
                const metrics = await evaluateDesignHeadless(designParams, settings);

                // Store the raw metrics in the consistent cache structure
                fitnessCache.set(designKey, { rawMetrics: metrics });

                log(`    → Metrics: ${JSON.stringify(metrics)}`);
                return metrics; // Return raw metrics to the MOGA optimizer
            };

            const progressCallback = async (generation, paretoFront) => {
                populateParetoFront(paretoFront, 'moga', settings.objectives);
                log(`✓ Gen ${generation}/${settings.maxGenerations}. Pareto front size: ${paretoFront.length}`);
                await saveCheckpoint();
            };

            const finalParetoFront = await optimizer.run(fitnessFunction, progressCallback);

            if (isOptimizing) { // Check if it finished, not cancelled
                log(`\n🎉 Optimization complete!`);
                log(`Found ${finalParetoFront.length} non-dominated solutions (trade-offs).`);
                showAlert('Optimization complete! Select a solution from the Results list to apply it.', 'Success');
            }
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
        isOptimizing = false; 
    }
}

// ==================== HELPER FUNCTIONS ====================

function gatherSettings(mode = 'full') {
    if (!optimizationPanel) throw new Error("Optimization panel is not initialized.");
    // const dom = getDom(); // <-- BUG: This uses the global cache

    // --- Common Settings ---
    // Use optimizationPanel.querySelector to get dynamically loaded elements
    const optTargetWall = optimizationPanel.querySelector('#opt-target-wall');
    const optShadingType = optimizationPanel.querySelector('#opt-shading-type');
    const optPopulationSize = optimizationPanel.querySelector('#opt-population-size');
    const optGenerations = optimizationPanel.querySelector('#opt-generations'); // This ID now means "Max Evals / Gens"
    const optQuality = optimizationPanel.querySelector('#opt-quality');
    const optParamsContainer = optimizationPanel.querySelector('#opt-params-container');

    const selectedParams = [];
    if (optParamsContainer) {
        const currentShadingType = optShadingType?.value || 'overhang';
        const paramConfigs = SHADING_PARAMETERS[currentShadingType] || [];

        optParamsContainer.querySelectorAll('.opt-param-item').forEach(item => {
            const toggle = item.querySelector('.opt-param-toggle');
            if (toggle.checked) {
                const paramId = item.dataset.paramId;
                const paramConfig = paramConfigs.find(p => p.id === paramId);

                if (!paramConfig) {
                     console.warn(`Could not find config for param ${paramId}`);
                     return;
                }

                if (paramConfig.type === 'continuous') {
                    selectedParams.push({
                        name: paramId,
                        type: 'continuous',
                        min: parseFloat(item.querySelector('.opt-param-min').value),
                        max: parseFloat(item.querySelector('.opt-param-max').value),
                        step: parseFloat(item.querySelector('.opt-param-step').value)
                    });
                } else if (paramConfig.type === 'discrete') {
                    selectedParams.push({
                        name: paramId,
                        type: 'discrete',
                        options: [...item.querySelector('.opt-param-options').options].map(o => o.value)
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

    const quality = (mode === 'quick') ? 'draft' : (optQuality?.value || 'medium');
    let populationSize = parseInt(optPopulationSize?.value || '10');
    let evaluations = parseInt(optGenerations?.value || '50'); // This is Evals for SSGA, Gens for MOGA

    // --- Type-Specific Settings ---
    const optType = optimizationPanel.querySelector('#opt-type')?.value || 'ssga';

    if (optType === 'ssga') {
        if (mode === 'quick') {
            populationSize = 8;
            evaluations = 20; // Max Evaluations
            log('... Using Quick Optimize settings: 8 population, 20 max evaluations.');
        }

        return {
            type: 'ssga',
            wall: optTargetWall?.value || 's',
            shadingType: optShadingType?.value || 'overhang',
            recipe: optimizationPanel.querySelector('#opt-simulation-recipe')?.value || 'sda-ase',
            goalId: optimizationPanel.querySelector('#opt-goal-metric')?.value || 'maximize_sDA',
            goalType: optimizationPanel.querySelector('#opt-goal-type')?.value || 'maximize',
            targetValue: parseFloat(optimizationPanel.querySelector('#opt-goal-target-value')?.value || '0'),
            constraint: optimizationPanel.querySelector('#opt-constraint')?.value.trim() || '',
            populationSize: populationSize,
            maxEvaluations: evaluations, // For SSGA, this is Max Evals
            quality: quality,
            parameters: selectedParams
        };
    } else { // 'moga'
        if (mode === 'quick') {
            populationSize = 12;
            evaluations = 10; // Max Generations
            log('... Using Quick Optimize settings: 12 population, 10 generations.');
        }

        const objective1 = {
            id: optimizationPanel.querySelector('#opt-goal-1')?.value,
            goal: optimizationPanel.querySelector('#opt-goal-type-1')?.value
        };
        const objective2 = {
            id: optimizationPanel.querySelector('#opt-goal-2')?.value,
            goal: optimizationPanel.querySelector('#opt-goal-type-2')?.value
        };

        if (!objective1.id || !objective2.id) {
            throw new Error('Both Objective 1 and Objective 2 must be set for Multi-Objective Optimization.');
        }
        if (objective1.id === objective2.id) {
            throw new Error('Objective 1 and Objective 2 must be different metrics.');
        }

        return {
            type: 'moga',
            wall: optTargetWall?.value || 's',
            shadingType: optShadingType?.value || 'overhang',
            recipe: optimizationPanel.querySelector('#opt-recipe-1')?.value || 'sda-ase', // Both objectives MUST come from the same recipe
            objectives: [objective1, objective2],
            populationSize: populationSize,
            maxGenerations: evaluations, // For MOGA, this is Max Gens
            quality: quality,
            parameters: selectedParams
        };
    }
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
 * Parses all relevant metrics from a simulation run and returns a metrics object.
 * @param {object} settings - The optimization settings object.
 * @param {string} uniqueId - The unique ID for this simulation run.
 * @returns {Promise<object>} An object with metric key-value pairs (e.g., { sda: 70.1, ase: 8.5 }).
 * @private
 */
async function _parseSimulationResult(settings, uniqueId) {
    const { recipe, type } = settings;
    const projectName = project.projectName || 'scene';
    const baseName = `${projectName}_${uniqueId}`;
    const metricsToParse = (type === 'ssga') 
        ? [settings.goalId] // SSGA only needs the goal metric
        : settings.objectives.map(o => o.id); // MOGA needs all objectives

    // If SSGA has a constraint, we need to parse that metric too.
    if (type === 'ssga' && settings.constraint) {
        const constraintMetricId = settings.constraint.split(' ')[0].toLowerCase(); // e.g., "ase"
        // Find the full metric ID (e.g., "minimize_ASE")
        const allMetrics = RECIPE_METRICS[recipe].map(m => m.id);
        const fullConstraintMetric = allMetrics.find(m => m.toLowerCase().includes(`_${constraintMetricId}`));
        if (fullConstraintMetric && !metricsToParse.includes(fullConstraintMetric)) {
            metricsToParse.push(fullConstraintMetric);
        }
    }

    const metrics = {};
    let sdaMetrics = null; // Cache sDA/ASE calcs
    let illumStats = null; // Cache illuminance stats

    // Helper function to get stats for illuminance files
    const getIllumStats = async (filePath) => {
        if (illumStats) return illumStats;
        const file = await _getFileFromElectron(filePath);
        await resultsManager.loadAndProcessFile(file, 'a');
        illumStats = resultsManager.getActiveStats();
        return illumStats;
    };

    // Helper function to get metrics for sDA/ASE files
    const getSdaMetrics = async (filePath) => {
        if (sdaMetrics) return sdaMetrics;
        const file = await _getFileFromElectron(filePath);
        await resultsManager.loadAndProcessFile(file, 'a');
        sdaMetrics = resultsManager.calculateAnnualMetrics('a', {});
        return sdaMetrics;
    };

    for (const metricId of metricsToParse) {
        const goalMetric = RECIPE_METRICS[recipe].find(m => m.id === metricId);
        if (!goalMetric) {
            console.warn(`Could not find config for metric ${metricId}`);
            continue;
        }

        const metricKey = metricId.split('_')[1].toLowerCase(); // e.g., sda, ase, avg
        const filePath = `08_results/${baseName}${goalMetric.file}`;

        try {
            if (recipe === 'sda-ase') {
                const m = await getSdaMetrics(filePath);
                metrics[metricKey] = (metricKey === 'sda') ? m.sDA : m.ASE;
            } else if (recipe === 'illuminance') {
                const stats = await getIllumStats(filePath);
                if (metricKey === 'avg') {
                    metrics.avg = stats.avg;
                } else if (metricKey === 'uniformity') {
                    metrics.uniformity = (stats.min > 0 && stats.avg > 0) ? (stats.min / stats.avg) : 0;
                }
            } else if (recipe === 'dgp') {
                const file = await _getFileFromElectron(filePath);
                const textContent = await file.text();
                const match = textContent.match(/DGP:\s*([\d.]+)/);
                metrics.dgp = match ? parseFloat(match[1]) : 0;
            }
            // TODO: Add parsing logic for other MOGA-compatible recipes (imageless, spectral)
        } catch (err) {
            console.error(`Failed to parse metric ${metricId} from ${filePath}:`, err);
            metrics[metricKey] = 0; // Assign 0 for failed parses
        }
    }

    return metrics;
}

/**
 * Calculates a single fitness score from a metrics object for SSGA.
 * @param {object} metrics - The metrics object (e.g., {sda: 70, ase: 15}).
 * @param {object} settings - The SSGA settings object.
 * @returns {object} An object with { score, value, unit }.
 * @private
 */
function _calculateSingleFitness(metrics, settings) {
    const { goalId, goalType, targetValue, constraint } = settings;

    const metricKey = goalId.split('_')[1].toLowerCase(); // e.g., sda
    const value = metrics[metricKey];
    let unit = '';
    if (metricKey === 'sda' || metricKey === 'ase') unit = '%';
    if (metricKey === 'avg') unit = ' lux';
    if (metricKey === 'uniformity') unit = ' (U0)';

    let score;
    if (goalType === 'maximize') {
        score = value;
    } else if (goalType === 'minimize') {
        score = -value;
    } else { // 'set-target'
        score = -Math.abs(value - targetValue);
    }

    // Apply constraint penalty
    if (constraint) {
        const constraintKey = constraint.split(' ')[0].toLowerCase();
        const constraintValue = metrics[constraintKey];
        if (constraintValue === undefined) {
            console.warn(`Constraint metric "${constraintKey}" not found in results. Skipping constraint.`);
        } else if (!checkConstraint(constraintValue, constraint)) {
            score = -Infinity; // Heavy penalty
            log(`    → Constraint FAILED (${constraint})`);
        }
    }

    return { score, value, unit };
}

/**
 * Populates the results list UI with the Pareto front.
 * @param {Array<object>} paretoFront - The array of best solutions.
 * @param {string} type - 'ssga' or 'moga'.
 * @param {Array<object>} [objectives] - The MOGA objectives array (for headers).
 * @private
 */
function populateParetoFront(paretoFront, type, objectives = []) {
    if (!optimizationPanel) return;
    const summaryList = optimizationPanel.querySelector('#optimization-summary-list');
    const placeholder = optimizationPanel.querySelector('#opt-summary-placeholder');
    if (!summaryList || !placeholder) return;

    placeholder.style.display = 'none';
    summaryList.innerHTML = ''; // Clear list
    selectedDesignParams = null; // Clear selection
    dom['apply-best-design-btn']?.classList.add('hidden');

    if (type === 'ssga') {
        // --- Display single best for SSGA ---
        const best = paretoFront[0];
        if (!best) return;
        const li = document.createElement('li');
        li.className = 'p-2 bg-[--grid-color] rounded active-result'; // Auto-select the best
        li.dataset.params = JSON.stringify(best.params);
        li.innerHTML = `<strong>Best:</strong> ${best.metricValue.toFixed(2)}${best.unit} (Evals: ${optimizer.evaluationsCompleted}) <br> <span class="text-xs">${JSON.stringify(best.params)}</span>`;
        summaryList.appendChild(li);
        selectedDesignParams = best.params; // Pre-select it
        dom['apply-best-design-btn']?.classList.remove('hidden'); // Show apply button

    } else {
        // --- Display Pareto front for MOGA ---
        const obj1 = objectives[0];
        const obj2 = objectives[1];

        // Add header
        const header = document.createElement('li');
        header.className = 'p-2 text-[--text-secondary] sticky top-0 bg-[--panel-bg]';
        header.innerHTML = `<strong class="w-1/3 inline-block">${obj1.id.split('_')[1].toUpperCase()}</strong> <strong class="w-1/3 inline-block">${obj2.id.split('_')[1].toUpperCase()}</strong> <strong>Params</strong>`;
        summaryList.appendChild(header);

        paretoFront.forEach(ind => {
            const li = document.createElement('li');
            li.className = 'p-2 hover:bg-[--grid-color] rounded cursor-pointer';
            li.dataset.params = JSON.stringify(ind.params);
            li.innerHTML = `
                <span class="w-1/3 inline-block">${ind.metrics[obj1.id].toFixed(2)}</span>
                <span class="w-1/3 inline-block">${ind.metrics[obj2.id].toFixed(2)}</span>
                <span class="text-xs">${JSON.stringify(ind.params)}</span>
            `;
            summaryList.appendChild(li);
        });
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
        'dgp': 'template-recipe-dgp',
        'imageless-glare': 'template-recipe-imageless-glare',
        'spectral-lark': 'template-recipe-spectral-lark',
        'en17037': 'template-recipe-en17037'
    };
    const templateId = recipeTemplates[recipe];
    if (!templateId) throw new Error(`Unknown recipe: ${recipe}`);

    // 1. Get the main simulation panel
    const panel = document.getElementById('panel-simulation-modules');
    if (!panel) {
        throw new Error(`Could not find the main simulation panel (#panel-simulation-modules).`);
    }

    // 2. Find and set the recipe dropdown
    const recipeSelector = document.getElementById('recipe-selector');
    if (!recipeSelector) {
        throw new Error(`Could not find the recipe selector (#recipe-selector).`);
    }

    if (recipeSelector.value !== templateId) {
        recipeSelector.value = templateId;
        // Dispatch 'change' event to populate the recipe-parameters-container
        recipeSelector.dispatchEvent(new Event('change', { bubbles: true }));
        // Wait for the UI to update with the new recipe's parameters
        await new Promise(resolve => setTimeout(resolve, 200));
    }

    // 3. Set the quality preset
    // The quality preset is in the main panel, not the recipe-specific container
    const qualitySelect = panel.querySelector(`[id^="quality-preset"]`);
    if (qualitySelect) {
        qualitySelect.value = quality;
        // Dispatch 'change' to update global parameters (as defined in simulation.js)
        qualitySelect.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
        console.warn(`Could not find quality preset selector on panel ${panel.id}`);
    }

    // 4. Generate package using the main simulation panel
    // programmaticallyGeneratePackage will read the active recipe from the container
    const scriptInfo = await programmaticallyGeneratePackage(panel, uniqueId);
    if (!scriptInfo || !scriptInfo.shFile) {
        throw new Error("Failed to generate simulation package or script info.");
    }

    // 5. Read the script file content
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
    // Caching is now handled one level up in startOptimization's fitnessFunction

    const { wall, shadingType, recipe, quality } = settings;

    // 1. Apply the design parameters to the scene
    // This function updates the UI sliders, which programmaticallyGeneratePackage reads
    await applyDesignToScene(designParams, settings);

    // 2. Generate the simulation script
    const uniqueId = `opt_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
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

    // 4. Parse the results and return the full metrics object
    // This is the key change: evaluateDesignHeadless now returns the raw metrics.
    const metrics = await _parseSimulationResult(settings, uniqueId);
    return metrics;
}

/**
 * Provides read-only access to the fitness cache.
 * @returns {Map<string, object>} The fitness cache.
 */
export function getFitnessCache() {
    return fitnessCache;
}