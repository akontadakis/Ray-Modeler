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
    // This was the extra closing brace that was removed

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