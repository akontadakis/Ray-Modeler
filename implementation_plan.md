Shading Optimization Feature: Implementation Plan


Overview

This plan implements a generative optimization feature for shading devices using genetic algorithms. The feature allows users to define optimization goals (e.g., maximize sDA, minimize ASE) and parameters to optimize (e.g., overhang depth, louver angle), then runs sequential simulations to find optimal designs.
This revised plan uses the existing simulation and file-handling Electron APIs, ensuring compatibility with the current codebase.

Architecture

optimizationEngine.js: Core genetic algorithm engine (reusable, no UI or Electron dependencies).
optimizationOrchestrator.js: The "glue" logic that connects the GA engine to the UI. It reads settings, calls the engine, and uses existing simulation.js functions to run simulations sequentially.
index.html: Contains the new templates for the optimization panel and its components.
ai-assistant.js (Modified): Updated to include new AI tools for opening and configuring the panel. It dynamically loads the panel when the tab is clicked.
ui.js (Modified): Adds the setUiValue helper function.
project.js (Unchanged): No modifications are needed. The original plan to add generateSimulationPackageForDesign was incorrect and has been removed.

Critical Pre-Implementation Checks

Before starting implementation, verify these functions and APIs exist and are accessible:
✅ Electron API Functions Required (in preload.js):

JavaScript


window.electronAPI = {
    readFile: (args) => { /* ... */ },
    writeFile: (args) => { /* ... */ },
    runScript: (args) => { /* ... */ },
    onScriptExit: (callback) => { /* ... */ },
    onScriptOutput: (callback) => { /* ... */ }
};


✅ Required UI Functions (exported from ui.js):

JavaScript


export {
    setUiValue,      // NEW - To be added in Phase 0.2
    setShadingState, // existing
    showAlert,       // existing
    getDom           // existing
};


✅ Required Simulation Functions (exported from simulation.js):

JavaScript


export {
    openRecipePanelByType,           // existing
    programmaticallyGeneratePackage  // existing
};



Phase 0: Foundation Setup


Task 0.1: Create Optimization Engine (Pure Logic)

File: scripts/optimizationEngine.js (NEW FILE)
Action: Create this new file. This is a standalone genetic algorithm engine with NO UI dependencies. It includes a stop() method for cancellation and uses deep copies for state management.

JavaScript


export class GeneticOptimizer {
    constructor(options) {
        this.populationSize = options.populationSize || 20;
        this.generations = options.generations || 10;
        this.mutationRate = options.mutationRate || 0.1;
        this.parameterConstraints = options.parameterConstraints || [];
        this.currentGeneration = 0;
        this.population = [];
        this.bestDesign = null;
        this.shouldStop = false; // For cancellation
    }

    initializePopulation() {
        this.population = [];
        for (let i = 0; i < this.populationSize; i++) {
            const design = {};
            this.parameterConstraints.forEach(param => {
                const value = Math.random() * (param.max - param.min) + param.min;
                design[param.name] = value;
            });
            this.population.push({ params: design, fitness: 0 });
        }
    }

    selection(populationWithFitness) {
        // Tournament selection (size 3)
        const selected = [];
        for (let i = 0; i < this.populationSize; i++) {
            let best = null;
            for (let j = 0; j < 3; j++) {
                const idx = Math.floor(Math.random() * populationWithFitness.length);
                const candidate = populationWithFitness[idx];
                if (!best || candidate.fitness > best.fitness) {
                    best = candidate;
                }
            }
            selected.push(best);
        }
        return selected;
    }

    crossover(parentA, parentB) {
        const child = {};
        this.parameterConstraints.forEach(param => {
            const alpha = Math.random();
            const value = alpha * parentA.params[param.name] + (1 - alpha) * parentB.params[param.name];
            child[param.name] = Math.max(param.min, Math.min(param.max, value));
        });
        return child;
    }

    mutate(design) {
        const mutated = { ...design };
        this.parameterConstraints.forEach(param => {
            if (Math.random() < this.mutationRate) {
                const range = param.max - param.min;
                const mutation = (Math.random() - 0.5) * range * 0.2; // 20% of range
                const newValue = mutated[param.name] + mutation;
                mutated[param.name] = Math.max(param.min, Math.min(param.max, newValue));
            }
        });
        return mutated;
    }

    stop() {
        this.shouldStop = true;
    }

    async run(fitnessFunction, progressCallback) {
        this.shouldStop = false;
        
        // Only initialize if not resuming (population is empty)
        if (this.population.length === 0) {
            this.initializePopulation();
        }

        for (let gen = this.currentGeneration; gen < this.generations; gen++) {
            if (this.shouldStop) {
                throw new Error("Optimization cancelled by user");
            }
            this.currentGeneration = gen;

            // Evaluate fitness for entire population
            const populationWithFitness = await fitnessFunction(this.population);

            // Find best
            this.bestDesign = populationWithFitness.reduce((best, current) =>
                current.fitness > best.fitness ? current : best
            );

            // Report progress
            if (progressCallback) {
                await progressCallback(gen, this.bestDesign, populationWithFitness);
            }

            // Create next generation (skip on last iteration)
            if (gen < this.generations - 1 && !this.shouldStop) {
                const selected = this.selection(populationWithFitness);
                const nextPopulation = [];
                for (let i = 0; i < this.populationSize; i += 2) {
                    const parentA = selected[i];
                    const parentB = selected[Math.min(i + 1, selected.length - 1)];
                    const childA = this.crossover(parentA, parentB);
                    const childB = this.crossover(parentB, parentA);
                    nextPopulation.push(
                        { params: this.mutate(childA), fitness: 0 },
                        { params: this.mutate(childB), fitness: 0 }
                    );
                }
                this.population = nextPopulation.slice(0, this.populationSize);
            }
        }
        return this.bestDesign;
    }

    getState() {
        return {
            currentGeneration: this.currentGeneration,
            population: JSON.parse(JSON.stringify(this.population)), // Deep copy
            bestDesign: this.bestDesign ? JSON.parse(JSON.stringify(this.bestDesign)) : null
        };
    }

    loadState(state) {
        this.currentGeneration = state.currentGeneration;
        this.population = state.population;
        this.bestDesign = state.bestDesign;
    }
}



Task 0.2: Add UI Helper Function

File: scripts/ui.js
Location: At the end of the file, before the final closing brace (if any) or just at the end.
Action: ADD this exported function.

JavaScript


/**
 * Programmatically sets a UI control value and triggers events.
 * @param {string} id - Element ID
 * @param {*} value - Value to set
 */
export function setUiValue(id, value) {
    const element = dom[id] || document.getElementById(id);
    if (!element) {
        console.warn(`[setUiValue] Element '${id}' not found`);
        return false;
    }

    if (element.type === 'checkbox') {
        element.checked = !!value;
    } else {
        element.value = value;
    }
    
    // Dispatch events to ensure labels and other listeners update
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
}



Phase 1: UI Templates


Task 1.1: Add Optimization Tab Button

File: index.html
Location: Inside <div id="ai-chat-tabs"> (around line 3010)
Action: ADD this button after the existing chat tab buttons.

HTML


    <button id="ai-chat-tab-1" class="ai-chat-tab active" data-tab="1">Chat 1</button>
    <button id="helios-optimization-tab-btn"
            class="ai-chat-tab hidden"
            data-tab="optimization">
        Optimization
    </button>
    ```

### Task 1.2: Add Optimization Panel Template

**File:** `index.html`
**Location:** Inside `<div id="templates" class="hidden">` (around line 4272)
**Action:** ADD this complete panel template.

```html
<template id="template-optimization-panel">
    <div id="helios-optimization-content" class="flex-grow p-4 space-y-4 overflow-y-auto">
        <p class="text-sm text-[--text-secondary]">
            Configure and run generative optimization for shading devices.
        </p>
        
        <div class="form-grid">
            <div>
                <label for="opt-target-wall" class="label">Target Wall</label>
                <select id="opt-target-wall" class="w-full">
                    <option value="n">North</option>
                    <option value="s" selected>South</option>
                    <option value="e">East</option>
                    <option value="w">West</option>
                </select>
            </div>
            <div>
                <label for="opt-shading-type" class="label">Shading Type</label>
                <select id="opt-shading-type" class="w-full">
                    <option value="overhang">Overhang</option>
                    <option value="louver">Louver</option>
                    <option value="lightshelf">Light Shelf</option>
                </select>
            </div>
        </div>
        
        <div class="border-t border-[--grid-color] pt-4">
            <h4 class="label mb-2">Parameters to Optimize</h4>
            <p class="text-xs text-[--text-secondary] mb-3">
                Select up to 3 parameters and define their ranges.
            </p>
            <div id="opt-params-container" class="space-y-2">
                </div>
        </div>
        
        <div class="border-t border-[--grid-color] pt-4">
            <h4 class="label mb-2">Optimization Goal</h4>
            <div class="form-grid">
                <div>
                    <label for="opt-simulation-recipe" class="label">Recipe</label>
                    <select id="opt-simulation-recipe" class="w-full">
                        <option value="sda-ase">sDA & ASE</option>
                        <option value="illuminance">Illuminance</option>
                        <option value="dgp">DGP</option>
                    </select>
                </div>
                <div>
                    <label for="opt-goal-metric" class="label">Metric</label>
                    <select id="opt-goal-metric" class="w-full">
                        </select>
                </div>
            </div>
            <div class="mt-2">
                <label for="opt-constraint" class="label">Constraint (Optional)</label>
                <input type="text"
                       id="opt-constraint"
                       placeholder="e.g., ASE < 10"
                       class="w-full">
            </div>
        </div>
        
        <div class="border-t border-[--grid-color] pt-4">
            <h4 class="label mb-2">Settings</h4>
            <div class="grid grid-cols-3 gap-2">
                <div>
                    <label for="opt-population-size" class="label text-xs">Population</label>
                    <input type="number" id="opt-population-size" value="10" min="4" max="50" class="w-full">
                </div>
                <div>
                    <label for="opt-generations" class="label text-xs">Generations</label>
                    <input type="number" id="opt-generations" value="5" min="2" max="20" class="w-full">
                </div>
                <div>
                    <label for="opt-quality" class="label text-xs">Quality</label>
                    <select id="opt-quality" class="w-full">
                        <option value="draft">Draft</option>
                        <option value="medium" selected>Medium</option>
                        <option value="high">High</option>
                    </select>
                </div>
            </div>
        </div>
        
        <div class="flex gap-2 pt-4">
            <button id="start-optimization-btn" class="btn btn-primary flex-1">
                Start Optimization
            </button>
            <button id="resume-optimization-btn" class="btn btn-secondary">
                Resume
            </button>
            <button id="cancel-optimization-btn" class="btn btn-danger hidden">
                Cancel
            </button>
        </div>
        
        <div class="border-t border-[--grid-color] pt-4">
            <h4 class="label mb-2">Progress Log</h4>
            <pre id="optimization-log"
                 class="w-full h-64 p-3 bg-[--grid-color] rounded overflow-y-auto font-mono text-xs whitespace-pre-wrap">Ready to optimize...
            </pre>
        </div>
    </div>
</template>



Task 1.3: Add Parameter Item Template

File: index.html
Location: Right after the optimization panel template (from Task 1.2).
Action: ADD this template.

HTML


<template id="template-opt-param">
    <div class="opt-param-item p-3 border border-[--grid-color] rounded">
        <label class="flex items-center cursor-pointer">
            <input type="checkbox" class="opt-param-toggle mr-3">
            <span class="opt-param-name font-medium">Parameter Name</span>
        </label>
        <div class="opt-param-controls grid grid-cols-2 gap-2 mt-2 pl-8 hidden">
            <div>
                <label class="label text-xs">Min</label>
                <input type="number" class="opt-param-min w-full" step="0.1">
            </div>
            <div>
                <label class="label text-xs">Max</label>
                <input type="number" class="opt-param-max w-full" step="0.1">
            </div>
        </div>
    </div>
</template>



Phase 2: Orchestrator Logic


Task 2.1: Create Orchestrator File

File: scripts/optimizationOrchestrator.js (NEW FILE)
Action: Create this new file. This version uses sequential simulation by leveraging existing functions from simulation.js.

JavaScript


import { getDom } from './dom.js';
import { setUiValue, showAlert, setShadingState } from './ui.js';
import { project } from './project.js';
import { resultsManager } from './resultsManager.js';
import { GeneticOptimizer } from './optimizationEngine.js';

let dom;
let optimizer = null;
let isOptimizing = false;

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

const SHADING_PARAMETERS = {
    'overhang': [
        { id: 'depth', name: 'Depth (m)', min: 0.1, max: 2.0, step: 0.1 },
        { id: 'tilt', name: 'Tilt (deg)', min: -45, max: 45, step: 5 },
        { id: 'distAbove', name: 'Distance Above (m)', min: 0, max: 1.0, step: 0.05 }
    ],
    'louver': [
        { id: 'slatWidth', name: 'Slat Width (m)', min: 0.01, max: 0.5, step: 0.01 },
        { id: 'slatSep', name: 'Slat Spacing (m)', min: 0.01, max: 0.5, step: 0.01 },
        { id: 'slatAngle', name: 'Slat Angle (deg)', min: -90, max: 90, step: 5 }
    ],
    'lightshelf': [
        { id: 'depthExt', name: 'Exterior Depth (m)', min: 0, max: 2.0, step: 0.1 },
        { id: 'depthInt', name: 'Interior Depth (m)', min: 0, max: 2.0, step: 0.1 },
        { id: 'tiltExt', name: 'Exterior Tilt (deg)', min: -30, max: 30, step: 5 },
        { id: 'tiltInt', name: 'Interior Tilt (deg)', min: -30, max: 30, step: 5 }
    ]
};

// ==================== PUBLIC API ====================

/**
 * Initializes all event listeners for the optimization panel.
 * This is called by ai-assistant.js once the panel is in the DOM.
 */
export function initOptimizationUI() {
    dom = getDom();
    
    // Setup event listeners
    dom['opt-shading-type']?.addEventListener('change', populateParameters);
    dom['opt-simulation-recipe']?.addEventListener('change', updateGoalMetrics);
    dom['start-optimization-btn']?.addEventListener('click', () => startOptimization(false));
    dom['resume-optimization-btn']?.addEventListener('click', () => startOptimization(true));
    dom['cancel-optimization-btn']?.addEventListener('click', cancelOptimization);

    // Parameter toggle listener
    dom['opt-params-container']?.addEventListener('change', (e) => {
        if (e.target.classList.contains('opt-param-toggle')) {
            const controls = e.target.closest('.opt-param-item').querySelector('.opt-param-controls');
            controls.classList.toggle('hidden', !e.target.checked);
        }
    });

    // Initial population
    populateParameters();
    updateGoalMetrics();
}

// ==================== UI MANAGEMENT ====================

function populateParameters() {
    const type = dom['opt-shading-type'].value;
    const container = dom['opt-params-container'];
    const template = document.getElementById('template-opt-param');
    container.innerHTML = ''; // Clear existing
    
    const params = SHADING_PARAMETERS[type] || [];
    params.forEach(param => {
        const clone = template.content.cloneNode(true);
        const item = clone.querySelector('.opt-param-item');
        item.dataset.paramId = param.id;
        clone.querySelector('.opt-param-name').textContent = param.name;
        clone.querySelector('.opt-param-min').value = param.min;
        clone.querySelector('.opt-param-max').value = param.max;
        clone.querySelector('.opt-param-min').step = param.step;
        clone.querySelector('.opt-param-max').step = param.step;
        container.appendChild(clone);
    });
}

function updateGoalMetrics() {
    const recipe = dom['opt-simulation-recipe'].value;
    const select = dom['opt-goal-metric'];
    select.innerHTML = '';
    
    const metrics = RECIPE_METRICS[recipe] || [];
    metrics.forEach(metric => {
        const option = document.createElement('option');
        option.value = metric.id;
        option.textContent = metric.name;
        select.appendChild(option);
    });
}

function setControlsLocked(locked) {
    isOptimizing = locked;
    dom['start-optimization-btn'].classList.toggle('hidden', locked);
    dom['resume-optimization-btn'].classList.toggle('hidden', locked);
    dom['cancel-optimization-btn'].classList.toggle('hidden', !locked);
    
    [
        'opt-target-wall', 'opt-shading-type', 'opt-simulation-recipe',
        'opt-goal-metric', 'opt-constraint', 'opt-population-size',
        'opt-generations', 'opt-quality'
    ].forEach(id => {
        if (dom[id]) dom[id].disabled = locked;
    });
    
    // Disable parameter checkboxes and inputs
    dom.querySelectorAll('.opt-param-item input').forEach(input => {
        input.disabled = locked;
    });
}

// ==================== LOGGING ====================

function log(message) {
    const logEl = dom['optimization-log'];
    if (logEl) {
        logEl.textContent += `${message}\n`;
        logEl.scrollTop = logEl.scrollHeight;
    }
    console.log(`[Optimization] ${message}`);
}

function clearLog() {
    if (dom['optimization-log']) {
        dom['optimization-log'].textContent = '';
    }
}

// ==================== OPTIMIZATION CONTROL ====================

function cancelOptimization() {
    if (optimizer) {
        optimizer.stop();
        log('❌ Cancellation requested - will stop after current generation');
        dom['cancel-optimization-btn'].disabled = true;
        dom['cancel-optimization-btn'].textContent = 'Cancelling...';
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
        dom['cancel-optimization-btn'].disabled = false;
        dom['cancel-optimization-btn'].textContent = 'Cancel';
        optimizer = null;
    }
}

// ==================== HELPER FUNCTIONS ====================

function gatherSettings() {
    const selectedParams = [];
    dom['opt-params-container'].querySelectorAll('.opt-param-item').forEach(item => {
        const toggle = item.querySelector('.opt-param-toggle');
        if (toggle.checked) {
            selectedParams.push({
                name: item.dataset.paramId,
                min: parseFloat(item.querySelector('.opt-param-min').value),
                max: parseFloat(item.querySelector('.opt-param-max').value)
            });
        }
    });

    if (selectedParams.length === 0) {
        throw new Error('No parameters selected. Please check at least one parameter to optimize.');
    }
    if (selectedParams.length > 3) {
        throw new Error('Maximum 3 parameters allowed for optimization.');
    }

    return {
        wall: dom['opt-target-wall'].value,
        shadingType: dom['opt-shading-type'].value,
        recipe: dom['opt-simulation-recipe'].value,
        goalId: dom['opt-goal-metric'].value,
        constraint: dom['opt-constraint'].value.trim(),
        populationSize: parseInt(dom['opt-population-size'].value),
        generations: parseInt(dom['opt-generations'].value),
        quality: dom['opt-quality'].value,
        parameters: selectedParams
    };
}

async function applyDesignToScene(params, settings) {
    const { wall, shadingType } = settings;
    
    // Enable shading for this wall
    setShadingState(wall, { enabled: true, type: shadingType });

    // Set each parameter value in the UI
    for (const [paramName, value] of Object.entries(params)) {
        // e.g., 'overhang-depth-s'
        const elementId = `${shadingType}-${paramName}-${wall}`; 
        setUiValue(elementId, value);
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
    const panelSuffix = panel.id.split('-').pop(); // Get the unique panel ID suffix
    const qualitySelect = panel.querySelector(`#quality-preset-${panelSuffix}`);
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



Phase 3: Integration with AI Assistant


Task 3.1: Add Tool Definitions

File: scripts/ai-assistant.js
Location: Inside the availableTools[0].functionDeclarations array (around line 50-500).
Action: ADD these two tool definitions. These replace the original startShadingOptimization and runGenerativeOptimization tools.

JavaScript


// ... existing tools ...
{
    "name": "openOptimizationPanel",
    "description": "Opens the generative shading optimization panel to set up an optimization study.",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "wall": {
                "type": "STRING",
                "description": "The wall to optimize: 'north', 'south', 'east', or 'west'."
            },
            "shadingType": {
                "type": "STRING",
                "description": "The shading device type: 'overhang', 'louver', or 'lightshelf'."
            }
        }
    }
},
{
    "name": "configureOptimization",
    "description": "Pre-configures optimization settings in the panel before the user starts the run. Does not start the optimization.",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "parameters": {
                "type": "OBJECT",
                "description": "Parameter names and their min/max ranges, e.g., {'depth': [0.5, 2.0], 'tilt': [0, 30]}"
            },
            "goal": {
                "type": "STRING",
                "description": "The optimization goal metric, e.g., 'maximize_sDA' or 'minimize_ASE'"
            },
            "constraint": {
                "type": "STRING",
                "description": "Optional constraint, e.g., 'ASE < 10' or '> 300'"
            },
            "populationSize": {
                "type": "NUMBER",
                "description": "Number of designs per generation (recommended 4-50)"
            },
            "generations": {
                "type": "NUMBER",
                "description": "Number of generations to run (recommended 2-20)"
            }
        }
    }
},
// ... rest of existing tools ...



Task 3.2: Add Tool Handlers

File: scripts/ai-assistant.js
Location: In the toolHandlers object (around line 1150).
Action: ADD these handlers for the new tools.

JavaScript


// ... existing tool handlers ...
'openOptimizationPanel': async (args) => {
    // Open AI assistant panel if not open
    if (dom['ai-assistant-panel'].classList.contains('hidden')) {
        dom['ai-assistant-button']?.click();
    }
        
    // Switch to optimization tab
    dom['helios-optimization-tab-btn']?.classList.remove('hidden');
    dom['helios-optimization-tab-btn']?.click();
    
    // Pre-fill settings if provided
    if (args.wall) {
        setUiValue('opt-target-wall', args.wall.charAt(0).toLowerCase());
    }
    if (args.shadingType) {
        setUiValue('opt-shading-type', args.shadingType);
        // Trigger parameter population
        dom['opt-shading-type']?.dispatchEvent(new Event('change', { bubbles: true }));
    }
    
    return {
        success: true,
        message: `Opened the optimization panel for ${args.shadingType || 'shading'} on the ${args.wall || 'selected'} wall. Please review the parameters and click 'Start Optimization' when ready.`
    };
},

'configureOptimization': async (args) => {
    const { parameters, goal, constraint, populationSize, generations } = args;
    let messages = ['Optimization configured:'];

    // Set goal and constraint
    if (goal) {
        // Parse goal to auto-select recipe
        const recipeMap = {
            'sDA': 'sda-ase',
            'ASE': 'sda-ase',
            'avg': 'illuminance',
            'dgp': 'dgp'
        };
        const metricKey = goal.split('_')[1]; // e.g., "sDA" from "maximize_sDA"
        const recipe = recipeMap[metricKey] || 'sda-ase';
        
        setUiValue('opt-simulation-recipe', recipe);
        // Trigger metric update
        dom['opt-simulation-recipe']?.dispatchEvent(new Event('change', { bubbles: true }));
        
        // Wait for metrics to populate
        await new Promise(resolve => setTimeout(resolve, 100));
        
        setUiValue('opt-goal-metric', goal);
        messages.push(`- Goal set to ${goal}`);
    }
    if (constraint) {
        setUiValue('opt-constraint', constraint);
        messages.push(`- Constraint set to ${constraint}`);
    }

    // Set population and generations
    if (populationSize) {
        setUiValue('opt-population-size', Math.min(50, Math.max(4, populationSize)));
        messages.push(`- Population size set to ${populationSize}`);
    }
    if (generations) {
        setUiValue('opt-generations', Math.min(20, Math.max(2, generations)));
        messages.push(`- Generations set to ${generations}`);
    }

    // Configure parameters
    if (parameters) {
        const container = dom['opt-params-container'];
        if (!container) return { success: false, message: 'Parameter container not found.' };

        for (const [paramName, range] of Object.entries(parameters)) {
            const item = container.querySelector(`[data-param-id="${paramName}"]`);
            if (item) {
                const toggle = item.querySelector('.opt-param-toggle');
                const minInput = item.querySelector('.opt-param-min');
                const maxInput = item.querySelector('.opt-param-max');
                
                toggle.checked = true;
                // Trigger controls to show
                toggle.dispatchEvent(new Event('change', { bubbles: true })); 
                
                if (Array.isArray(range) && range.length === 2) {
                    minInput.value = range[0];
                    maxInput.value = range[1];
                }
                messages.push(`- Parameter ${paramName} enabled with range [${range[0]}, ${range[1]}]`);
            } else {
                messages.push(`- Warning: Parameter ${paramName} not found for current shading type.`);
            }
        }
    }
    
    return {
        success: true,
        message: messages.length > 1 ? messages.join('\n') : 'No settings provided to configure.'
    };
},
// ... rest of existing tool handlers ...



Task 3.3: Add Import Statement

File: scripts/ai-assistant.js
Location: At the top with other imports (around line 1-15).
Action: ADD this import.

JavaScript


// ... other imports
import { initOptimizationUI } from './optimizationOrchestrator.js';
// ... other imports



Task 3.4: Initialize Optimization Panel

File: scripts/ai-assistant.js
Location: In the initAiAssistant() function (around line 640).
Action: ADD this new logic to handle the optimization tab click and lazy-load the panel.

JavaScript


function initAiAssistant() {
    dom = getDom();
    if (!dom['ai-assistant-button']) {
        console.warn('AI Assistant button not found, feature disabled.');
        return;
    }

    // ... existing event listeners for ai-assistant-button, close button, etc. ...

    // ADD THIS: Event listener for the new optimization tab
    const optTab = dom['helios-optimization-tab-btn'];
    if (optTab) {
        optTab.addEventListener('click', (e) => {
            // Get all tabs and content panels
            const tabs = e.target.parentElement.querySelectorAll('.ai-chat-tab');
            const chatContainer = dom['ai-chat-messages']?.parentElement;
            if (!chatContainer) return;
            
            const contents = [
                dom['ai-chat-messages'],
                dom['ai-inspector-results'],
                dom['ai-critique-results'],
                chatContainer.querySelector('#helios-optimization-content') // Find existing panel
            ];

            // Deactivate all
            tabs.forEach(t => t.classList.remove('active'));
            contents.forEach(c => c?.classList.add('hidden'));

            // Activate this tab
            optTab.classList.add('active');
            
            // Show optimization panel (create it if it doesn't exist)
            let optPanel = chatContainer.querySelector('#helios-optimization-content');
            if (!optPanel) {
                const template = document.getElementById('template-optimization-panel');
                if (template) {
                    const clone = template.content.cloneNode(true);
                    chatContainer.appendChild(clone);
                    optPanel = chatContainer.querySelector('#helios-optimization-content');
                }
            }
            
            if (optPanel) {
                optPanel.classList.remove('hidden');
                // Initialize UI listeners if this is the first time
                if (!optPanel.dataset.initialized) {
                    initOptimizationUI();
                    optPanel.dataset.initialized = 'true';
                }
            }
        });
    }

    // Logic for other tabs (Chat 1, Inspector, Critique)
    // Ensure they hide the optimization panel
    dom['ai-chat-tab-1']?.addEventListener('click', (e) => {
        // ... (existing logic) ...
        // Add this line:
        chatContainer.querySelector('#helios-optimization-content')?.classList.add('hidden');
    });

    dom['ai-inspector-tab-btn']?.addEventListener('click', (e) => {
        // ... (existing logic) ...
        // Add this line:
        chatContainer.querySelector('#helios-optimization-content')?.classList.add('hidden');
    });

    dom['ai-critique-tab-btn']?.addEventListener('click', (e) => {
        // ... (existing logic) ...
        // Add this line:
        chatContainer.querySelector('#helios-optimization-content')?.classList.add('hidden');
    });


    // ... rest of existing code in initAiAssistant() ...
}



Phase 4: Main Script Registration


Task 4.1: Add Import to Main

File: scripts/main.js
Location: Near the top with other imports.
Action: ADD this import. (Note: The initialization is handled by ai-assistant.js when the tab is clicked, so only the import is needed here to ensure the module is bundled).

JavaScript


// ... other imports
import './optimizationEngine.js'; // Import engine
import './optimizationOrchestrator.js'; // Import orchestrator
// ... other imports



Phase 5: Testing Checklist

This replaces the original Phase 5/6.
[ ] 5.1 UI Tests
[ ] Open AI Assistant panel.
[ ] Ask AI to "open optimization panel". Verify tab appears and panel renders.
[ ] Manually click tab (if already visible). Verify panel renders.
[ ] Test parameter population: Change "Shading Type" dropdown and verify "Parameters to Optimize" section updates correctly for overhang, louver, and lightshelf.
[ ] Test goal metrics: Change "Recipe" dropdown and verify "Metric" dropdown updates.
[ ] Verify parameter checkboxes show/hide the min/max input fields.
[ ] 5.2 Configuration Tests
[ ] Ask AI: "configure optimization for overhang depth between 0.5 and 1.5 and tilt from 0 to 20, with a goal to minimize ASE and a constraint of sDA > 55".
[ ] Verify all UI controls (parameters, goal, constraint) are set correctly by the AI.
[ ] Manually configure a setup (e.g., 2 parameters, pop 10, gen 5).
[ ] 5.3 Execution Tests
[ ] Start optimization with a valid setup (e.g., 1 parameter, pop 4, gen 2, draft quality).
[ ] Verify log shows progress messages for each generation and design.
[ ] Verify the 3D model geometry updates for each sequential design evaluation.
[ ] Confirm simulations run sequentially (one after another).
[ ] Test Cancel button during a run. Verify the log shows a cancellation message and the process stops after the current generation.
[ ] Verify controls are locked during a run and unlocked after completion or cancellation.
[ ] 5.4 Results & Checkpointing Tests
[ ] Let a small optimization (pop 4, gen 2) run to completion.
[ ] Verify fitness calculation in the log is correct.
[ ] Verify the final best design is applied to the UI controls (e.g., the "Depth" slider).
[ ] Run an optimization for 1 generation (out of 5). Click Cancel.
[ ] Verify a optimization_checkpoint.json file is created in 11_files/.
[ ] Click the Resume button.
[ ] Verify the log shows "Resumed from generation 2" and completes the remaining generations.

Known Limitations & Future Enhancements

Current Limitation: Sequential Execution
Simulations run one at a time, which can be slow for large populations or high-quality settings.
Future Enhancement: Implement a true parallel execution queue in electron.js that manages a pool of simulation workers (e.g., based on CPU cores).
Current Limitation: Simple Constraint
The current fitness function only applies constraints to the primary goal metric (e.g., if optimizing for sDA, it can't easily constrain ASE without more complex parsing).
Future Enhancement: Improve calculateFitness to parse all relevant result files for a recipe, allowing for multi-faceted constraints (e.g., maximize_sDA with ASE < 10).
Current Limitation: No Multi-Objective
The optimizer can only target one goal (e.g., "maximize sDA" OR "minimize ASE").
Future Enhancement: Implement a multi-objective algorithm (like NSGA-II) to find a Pareto frontier of non-dominated solutions (e.g., the best trade-offs between sDA and ASE).
Enhancement Idea: Progress Visualization
Add a simple chart (using Chart.js) to the optimization panel to plot the "Best Fitness" and "Average Fitness" for each generation.
Enhancement Idea: Design Archive
Save all evaluated designs (parameters and fitness) to a JSON or CSV file in 11_files/ for later analysis.

Error Handling Strategy

All asynchronous operations (especially startOptimization) must be wrapped in a try...catch...finally block to ensure the UI is never left in a locked state.

JavaScript


try {
    // ... optimization code ...
} catch (err) {
    if (err.message.includes('cancelled')) {
        log('User cancelled optimization');
        showAlert('Optimization cancelled', 'Info');
    } else if (err.message.includes('Electron') || err.message.includes('File access')) {
        log('System error: ' + err.message);
        showAlert('A system file error occurred. Please save your project.', 'Error');
    } else {
        log('Unexpected error: ' + err.message);
        console.error('[Optimization] Error:', err);
        showAlert('An unexpected error occurred. Check the console for details.', 'Error');
    }
} finally {
    // ALWAYS clean up the UI
    setControlsLocked(false);
    dom['cancel-optimization-btn'].disabled = false;
    dom['cancel-optimization-btn'].textContent = 'Cancel';
    optimizer = null;
}
