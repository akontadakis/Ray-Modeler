/**
 * Helper function to snap a value to the nearest step.
 * @param {number} value - The value to snap.
 * @param {number} min - The minimum allowed value.
 * @param {number} max - The maximum allowed value.
 * @param {number} step - The step increment.
 * @returns {number} The snapped value.
 */
function _snapToStep(value, min, max, step) {
    if (step <= 0) return Math.max(min, Math.min(max, value));
    const snapped = Math.round((value - min) / step) * step + min;
    return Math.max(min, Math.min(max, snapped));
}

export class GeneticOptimizer {
    constructor(options) {
        this.populationSize = options.populationSize || 20;
        this.maxEvaluations = options.maxEvaluations || 50; // Changed from generations
        this.mutationRate = options.mutationRate || 0.1;
        this.parameterConstraints = options.parameterConstraints || [];
        this.evaluationsCompleted = 0; // Changed from currentGeneration
        this.population = [];
        this.bestDesign = null;
        this.shouldStop = false; // For cancellation
    }

    initializePopulation() {
        this.population = [];
        for (let i = 0; i < this.populationSize; i++) {
            const design = {};
            this.parameterConstraints.forEach(param => {
                if (param.type === 'continuous') {
                    const rawValue = Math.random() * (param.max - param.min) + param.min;
                    design[param.name] = _snapToStep(rawValue, param.min, param.max, param.step);
                } else if (param.type === 'discrete') {
                    // Randomly pick one of the discrete options
                    const randIndex = Math.floor(Math.random() * param.options.length);
                    design[param.name] = param.options[randIndex];
                }
            });
            this.population.push({ params: design, fitness: 0 });
        }
    }

    _selectOneParent(populationWithFitness) {
        // Tournament selection (size 3)
        let best = null;
        for (let j = 0; j < 3; j++) {
            const idx = Math.floor(Math.random() * populationWithFitness.length);
            const candidate = populationWithFitness[idx];
            if (!best || candidate.fitness > best.fitness) {
                best = candidate;
            }
        }
        return best;
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
            if (param.type === 'continuous') {
                // Blended crossover for continuous values
                const alpha = Math.random();
                const rawValue = alpha * parentA.params[param.name] + (1 - alpha) * parentB.params[param.name];
                child[param.name] = _snapToStep(rawValue, param.min, param.max, param.step);
            } else if (param.type === 'discrete') {
                // Uniform crossover for discrete values (50/50 chance)
                child[param.name] = (Math.random() < 0.5) ? parentA.params[param.name] : parentB.params[param.name];
            }
        });

        return child;
    }

    mutate(design) {
        const mutated = { ...design };
        this.parameterConstraints.forEach(param => {
            if (Math.random() < this.mutationRate) {
                if (param.type === 'continuous') {
                    const range = param.max - param.min;
                    const mutation = (Math.random() - 0.5) * range * 0.2; // 20% of range
                    const rawValue = mutated[param.name] + mutation;
                    mutated[param.name] = _snapToStep(rawValue, param.min, param.max, param.step);
                } else if (param.type === 'discrete') {
                    // Pick a *different* random option
                    const currentOption = mutated[param.name];
                    let newOption = currentOption;
                    while (newOption === currentOption) {
                        const randIndex = Math.floor(Math.random() * param.options.length);
                        newOption = param.options[randIndex];
                    }
                    mutated[param.name] = newOption;
                }
            }
        });
        return mutated;
    }

    _insertAndCull(newChildren, populationWithFitness) {
        // Add new children to the population
        const combined = [...populationWithFitness, ...newChildren];

        // Sort by fitness (highest first)
        combined.sort((a, b) => b.fitness - a.fitness);

        // Cull the worst, returning a population of the original size
        return combined.slice(0, this.populationSize);
    }

    stop() {
        this.shouldStop = true;
    }

    async run(fitnessFunction, progressCallback) {
    this.shouldStop = false;
    let populationWithFitness = [];

    // 1. Initialize and evaluate initial population if this is a new run
    if (this.evaluationsCompleted === 0) {
        this.initializePopulation();
        // Evaluate all individuals in the initial population
        const initialPromises = this.population.map(design => fitnessFunction(design.params));
        populationWithFitness = await Promise.all(initialPromises);
        this.evaluationsCompleted = this.populationSize;
    } else {
        // Resuming: population is already loaded with fitness values
        populationWithFitness = this.population;
    }

    // 2. Find initial best and report progress
    this.bestDesign = populationWithFitness.reduce((best, current) =>
        (current.fitness > best.fitness) ? current : best, populationWithFitness[0]
    );
    this.population = populationWithFitness; // Ensure internal population has fitness
    if (progressCallback) {
        await progressCallback(this.evaluationsCompleted, this.bestDesign);
    }

    // 3. Start steady-state evaluation loop
    while (this.evaluationsCompleted < this.maxEvaluations && !this.shouldStop) {
        // Select 2 parents
        const parentA = this._selectOneParent(populationWithFitness);
        const parentB = this._selectOneParent(populationWithFitness);

        // Create 2 children
        const childAParams = this.mutate(this.crossover(parentA, parentB));
        const childBParams = this.mutate(this.crossover(parentB, parentA));

        // Evaluate 2 new children
        const newChildren = await Promise.all([
            fitnessFunction(childAParams),
            fitnessFunction(childBParams)
        ]);
        this.evaluationsCompleted += 2;

        // Insert new children and cull the worst
        populationWithFitness = this._insertAndCull(newChildren, populationWithFitness);
        this.population = populationWithFitness; // Update internal population state for checkpointing

        // Update best design (it's always the first one after sorting)
        this.bestDesign = populationWithFitness[0]; 

        // Report progress
        if (progressCallback) {
            await progressCallback(this.evaluationsCompleted, this.bestDesign);
        }
    }

    return this.bestDesign;
}

    getState() {
    return {
        evaluationsCompleted: this.evaluationsCompleted,
        population: JSON.parse(JSON.stringify(this.population)), // Deep copy
        bestDesign: this.bestDesign ? JSON.parse(JSON.stringify(this.bestDesign)) : null
        };
    }

    loadState(state) {
        this.evaluationsCompleted = state.evaluationsCompleted;
        this.population = state.population;
        this.bestDesign = state.bestDesign;
    }
}