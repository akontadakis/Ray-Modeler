// scripts/mogaOptimizer.js

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

/**
 * CANONICAL goal-id → metric-key mapping.
 *
 * Optimizer goal ids carry their direction as a prefix ("maximize_sDA",
 * "minimize_ASE", "minimize_Annual_DGP_Avg"), but the orchestrator stores the
 * parsed values under the stripped, lower-cased remainder ("sda", "ase",
 * "annual_dgp_avg"). BOTH the orchestrator's parser and NSGA-II must go through
 * this function: a mismatch makes every comparison undefined-vs-undefined,
 * which silently ranks the whole population as front 1.
 * @param {string} goalId
 * @returns {string}
 */
export function goalIdToMetricKey(goalId) {
    return String(goalId ?? '').replace(/^(minimize|maximize)_/i, '').toLowerCase();
}

/**
 * CANONICAL optimization direction, derived from the goal id itself rather than
 * from a separate dropdown that can disagree with it.
 * @param {string} goalId
 * @returns {'minimize'|'maximize'}
 */
export function goalIdToDirection(goalId) {
    return /^minimize_/i.test(String(goalId ?? '')) ? 'minimize' : 'maximize';
}

export class MultiObjectiveOptimizer {
    /**
     * Creates an instance of the Multi-Objective Genetic Algorithm (NSGA-II).
     * @param {object} options
     * @param {number} options.populationSize - The number of individuals in each generation.
     * @param {number} options.maxGenerations - The total number of generations to run.
     * @param {number} options.mutationRate - The probability (0.0 to 1.0) of a gene mutating.
     * @param {Array<object>} options.parameterConstraints - The definitions of the parameters to optimize.
     * @param {Array<object>} options.objectives - The objectives to optimize (e.g., [{id: 'sda', goal: 'maximize'}]).
     */
    constructor(options) {
        this.populationSize = options.populationSize || 20;
        this.maxGenerations = options.maxGenerations || 20;
        this.mutationRate = options.mutationRate || 0.1;
        this.parameterConstraints = options.parameterConstraints || [];
        this.objectives = options.objectives || []; // e.g., [{id: 'sda', goal: 'maximize'}, {id: 'ase', goal: 'minimize'}]

        this.currentGeneration = 0;
        this.population = []; // Array of individuals. { params: {...}, metrics: {...}, rank: 0, crowdingDistance: 0, ... }
        this.paretoFront = []; // The best (Rank 1) solutions
        this.shouldStop = false;
    }

    /**
     * Checks if individual p dominates individual q.
     * @param {object} p - Individual 1 { metrics: {...} }
     * @param {object} q - Individual 2 { metrics: {...} }
     * @returns {boolean} True if p dominates q.
     */
    _dominates(p, q) {
        let pIsBetter = false;
        for (const obj of this.objectives) {
            const key = goalIdToMetricKey(obj.id);
            const pVal = p.metrics?.[key];
            const qVal = q.metrics?.[key];

            // A missing metric cannot participate in dominance; skip the objective
            // rather than poisoning every comparison with NaN.
            if (!Number.isFinite(pVal) || !Number.isFinite(qVal)) continue;

            if ((obj.goal || goalIdToDirection(obj.id)) === 'maximize') {
                if (pVal < qVal) return false; // p is worse in at least one objective
                if (pVal > qVal) pIsBetter = true; // p is better in at least one
            } else { // 'minimize'
                if (pVal > qVal) return false; // p is worse in at least one objective
                if (pVal < qVal) pIsBetter = true; // p is better in at least one
            }
        }
        return pIsBetter; // Returns true only if p is not worse in any objective AND is better in at least one.
    }

    /**
     * Assigns ranks (fronts) to the entire population using fast non-dominated sorting.
     * @param {Array<object>} population - The population to sort.
     * @returns {Array<Array<object>>} An array of fronts, where each front is an array of individuals.
     */
    _fastNonDominatedSort(population) {
        const fronts = [[]];
        population.forEach(p => {
            p.dominationCount = 0;
            p.dominatedSet = [];
            population.forEach(q => {
                if (p === q) return;
                if (this._dominates(p, q)) {
                    p.dominatedSet.push(q);
                } else if (this._dominates(q, p)) {
                    p.dominationCount++;
                }
            });

            if (p.dominationCount === 0) {
                p.rank = 1;
                fronts[0].push(p);
            }
        });

        let i = 0;
        // Guard against `fronts[i]` being undefined on the terminal empty front
        // (the conditional assignment below never creates an empty trailing front).
        while (fronts[i] && fronts[i].length > 0) {
            const nextFront = [];
            for (const p of fronts[i]) {
                for (const q of p.dominatedSet) {
                    q.dominationCount--;
                    if (q.dominationCount === 0) {
                        q.rank = i + 2;
                        nextFront.push(q);
                    }
                }
            }
            i++;
            if (nextFront.length > 0) {
                fronts[i] = nextFront;
            }
        }
        return fronts;
    }

    /**
     * Calculates the crowding distance for all individuals in a single front.
     * @param {Array<object>} front - An array of individuals, all with the same rank.
     */
    _calculateCrowdingDistance(front) {
        if (front.length === 0) return;

        front.forEach(p => p.crowdingDistance = 0);

        for (const obj of this.objectives) {
            const key = goalIdToMetricKey(obj.id);
            const valueOf = (ind) => {
                const v = ind.metrics?.[key];
                return Number.isFinite(v) ? v : 0;
            };

            // Sort by the current objective's metric value
            front.sort((a, b) => valueOf(a) - valueOf(b));

            // Assign infinite distance to the boundary individuals
            front[0].crowdingDistance = Infinity;
            front[front.length - 1].crowdingDistance = Infinity;

            const minVal = valueOf(front[0]);
            const maxVal = valueOf(front[front.length - 1]);
            const range = maxVal - minVal;

            if (range === 0) continue; // All values are the same

            for (let i = 1; i < front.length - 1; i++) {
                front[i].crowdingDistance += (valueOf(front[i + 1]) - valueOf(front[i - 1])) / range;
            }
        }
    }

    /**
     * Ranks a population into fronts AND assigns a crowding distance to every
     * individual in EVERY front (not just the split front). Elites promoted from a
     * full front used to keep `crowdingDistance === undefined`, which made crowded
     * tournament selection compare against `undefined`.
     * @param {Array<object>} population
     * @returns {Array<Array<object>>} The fronts.
     */
    _assignRankAndCrowding(population) {
        const fronts = this._fastNonDominatedSort(population);
        fronts.forEach(front => this._calculateCrowdingDistance(front));
        return fronts;
    }

    /**
     * Selects one parent using crowded tournament selection (rank first, then crowding distance).
     * @returns {object} The selected parent individual.
     */
    _selectParent() {
        const tournamentSize = 2;
        let best = null;

        // Defensive defaults: an individual that somehow escaped ranking must not win
        // a tournament by comparing `undefined` against a real number.
        const rankOf = (ind) => Number.isFinite(ind?.rank) ? ind.rank : Number.MAX_SAFE_INTEGER;
        const crowdingOf = (ind) => (typeof ind?.crowdingDistance === 'number') ? ind.crowdingDistance : -Infinity;

        for (let i = 0; i < tournamentSize; i++) {
            const candidate = this.population[Math.floor(Math.random() * this.population.length)];
            if (best === null) {
                best = candidate;
            } else if (rankOf(candidate) < rankOf(best)) {
                best = candidate; // Better rank
            } else if (rankOf(candidate) === rankOf(best) && crowdingOf(candidate) > crowdingOf(best)) {
                best = candidate; // Same rank, better diversity
            }
        }
        return best;
    }

    /**
     * Creates a new child design by combining two parents.
     * (Copied from optimizationEngine.js)
     */
    crossover(parentA, parentB) {
        const child = {};
        this.parameterConstraints.forEach(param => {
            if (param.type === 'continuous') {
                const alpha = Math.random();
                const rawValue = alpha * parentA.params[param.name] + (1 - alpha) * parentB.params[param.name];
                child[param.name] = _snapToStep(rawValue, param.min, param.max, param.step);
            } else if (param.type === 'discrete') {
                child[param.name] = (Math.random() < 0.5) ? parentA.params[param.name] : parentB.params[param.name];
            }
        });
        return child;
    }

    /**
     * Randomly alters a design's parameters.
     * (Copied from optimizationEngine.js)
     */
    mutate(design) {
        const mutated = { ...design };
        this.parameterConstraints.forEach(param => {
            if (Math.random() < this.mutationRate) {
                if (param.type === 'continuous') {
                    const range = param.max - param.min;
                    const mutation = (Math.random() - 0.5) * range * 0.2;
                    const rawValue = mutated[param.name] + mutation;
                    mutated[param.name] = _snapToStep(rawValue, param.min, param.max, param.step);
                } else if (param.type === 'discrete') {
                    // Only mutate if there is more than one option, otherwise the
                    // "pick a different option" loop would never terminate.
                    if (param.options.length > 1) {
                        const currentOption = mutated[param.name];
                        let newOption = currentOption;
                        while (newOption === currentOption) {
                            const randIndex = Math.floor(Math.random() * param.options.length);
                            newOption = param.options[randIndex];
                        }
                        mutated[param.name] = newOption;
                    }
                }
            }
        });
        return mutated;
    }

    stop() {
        this.shouldStop = true;
    }

    /**
     * Runs the main MOGA optimization loop.
     * @param {Function} fitnessFunction - An async function that takes `params` and returns a `metrics` object (e.g., {sda: 80, ase: 5}).
     * @param {Function} progressCallback - An async function called after each generation: `(generation, paretoFront) => {}`.
     * @returns {Promise<Array<object>>} The final Pareto front.
     */
    async run(fitnessFunction, progressCallback) {
        this.shouldStop = false;

        // 1. Initialization (P0)
        // Guard on the population being ABSENT, not on the generation counter: a run
        // stopped during generation 0 is checkpointed with currentGeneration === 0, and
        // re-initialising here would throw away the loaded state.
        if (!Array.isArray(this.population) || this.population.length === 0) {
            this.population = [];
            for (let i = 0; i < this.populationSize; i++) {
                const params = {};
                this.parameterConstraints.forEach(param => {
                    if (param.type === 'continuous') {
                        const rawValue = Math.random() * (param.max - param.min) + param.min;
                        params[param.name] = _snapToStep(rawValue, param.min, param.max, param.step);
                    } else if (param.type === 'discrete') {
                        const randIndex = Math.floor(Math.random() * param.options.length);
                        params[param.name] = param.options[randIndex];
                    }
                });
                this.population.push({ params });
            }
        }

        // Evaluate any un-evaluated individuals SEQUENTIALLY. Each evaluation mutates
        // and reads the single shared UI/scene, so concurrent evaluation would
        // cross-contaminate results. Skipping already-evaluated individuals lets a
        // partially-evaluated resumed population continue where it left off.
        for (const ind of this.population) {
            if (this.shouldStop) throw new Error('Optimization cancelled');
            if (!ind.metrics) ind.metrics = await fitnessFunction(ind.params);
        }

        // 2. Start generational loop
        for (let g = this.currentGeneration; g < this.maxGenerations; g++) {
            if (this.shouldStop) throw new Error('Optimization cancelled');

            // Rank + crowding for the CURRENT population BEFORE any selection happens.
            // Without this, generation 0 selected among individuals that had no `rank`
            // at all, and promoted elites carried a stale/undefined crowding distance.
            this._assignRankAndCrowding(this.population);

            // 3. Create child population (Q_t)
            const childPopulation = [];
            for (let i = 0; i < this.populationSize; i++) {
                const parentA = this._selectParent();
                const parentB = this._selectParent();
                const childParams = this.mutate(this.crossover(parentA, parentB));
                childPopulation.push({ params: childParams });
            }

            // 4. Evaluate child population SEQUENTIALLY (shared UI/scene, see above).
            // Check the stop flag per individual so cancellation does not have to wait
            // for the whole generation's simulations to finish.
            for (const ind of childPopulation) {
                if (this.shouldStop) throw new Error('Optimization cancelled');
                ind.metrics = await fitnessFunction(ind.params);
            }
            const evaluatedChildren = childPopulation;

            // 5. Combine parent and child (R_t)
            const combinedPopulation = [...this.population, ...evaluatedChildren];

            // 6. Sort combined population into fronts and give EVERY front a crowding
            //    distance, so elites promoted whole in step 7 carry a real value.
            const fronts = this._assignRankAndCrowding(combinedPopulation);

            // 7. Build next generation (P_t+1)
            const nextPopulation = [];
            let frontIndex = 0;
            while (fronts[frontIndex] && nextPopulation.length + fronts[frontIndex].length <= this.populationSize) {
                nextPopulation.push(...fronts[frontIndex]);
                frontIndex++;
            }

            // 8. Handle the last, split front
            if (nextPopulation.length < this.populationSize && fronts[frontIndex]) {
                const lastFront = fronts[frontIndex];
                // Sort by crowding distance (descending)
                lastFront.sort((a, b) => b.crowdingDistance - a.crowdingDistance);

                const remainingSlots = this.populationSize - nextPopulation.length;
                nextPopulation.push(...lastFront.slice(0, remainingSlots));
            }

            this.population = nextPopulation;
            this.paretoFront = fronts[0] || [];

            // 9. Report progress. Mark generation `g` COMPLETE first: the progress
            //    callback is what writes the checkpoint, and recording `g` there made
            //    a resume re-run the generation that had just finished.
            this.currentGeneration = g + 1;
            if (progressCallback) {
                await progressCallback(g + 1, this.paretoFront);
            }
        }

        return this.paretoFront;
    }

    getState() {
        // Serialize ONLY the durable fields. `dominatedSet` holds references to other
        // individuals, so a naive deep copy expanded the domination graph into a huge
        // duplicated tree every generation, and `crowdingDistance` can be Infinity,
        // which JSON turns into null. Ranks and crowding are recomputed on resume.
        const snapshot = (ind) => ({
            params: { ...ind.params },
            metrics: ind.metrics ? { ...ind.metrics } : undefined
        });
        return {
            currentGeneration: this.currentGeneration,
            population: Array.isArray(this.population) ? this.population.map(snapshot) : [],
            paretoFront: Array.isArray(this.paretoFront) ? this.paretoFront.map(snapshot) : []
        };
    }

    loadState(state) {
        this.currentGeneration = state.currentGeneration || 0;
        this.population = Array.isArray(state.population) ? state.population : [];
        this.paretoFront = Array.isArray(state.paretoFront) ? state.paretoFront : [];
    }
}