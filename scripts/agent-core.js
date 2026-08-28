// scripts/agent-core.js

/**
 * Manages long-term memory for the agent using localStorage.
 * Invisible to the user ("magic").
 */
export class MemoryManager {
    constructor() {
        this.storageKey = 'helios_memory';
        this.memory = this.load();
    }

    load() {
        try {
            const data = localStorage.getItem(this.storageKey);
            return data ? JSON.parse(data) : {
                userPreferences: {},
                projectFacts: {},
                interactions: []
            };
        } catch (e) {
            console.error('Failed to load memory', e);
            return { userPreferences: {}, projectFacts: {}, interactions: [] };
        }
    }

    save() {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this.memory));
        } catch (e) {
            console.error('Failed to save memory', e);
        }
    }

    rememberPreference(key, value) {
        this.memory.userPreferences[key] = value;
        this.save();
    }

    rememberFact(key, value) {
        this.memory.projectFacts[key] = value;
        this.save();
    }

    getSummary() {
        const prefs = Object.entries(this.memory.userPreferences)
            .map(([k, v]) => `- ${k}: ${v}`).join('\n');
        const facts = Object.entries(this.memory.projectFacts)
            .map(([k, v]) => `- ${k}: ${v}`).join('\n');

        return `
Long-Term Memory:
Preferences:
${prefs || '(None)'}
Project Facts:
${facts || '(None)'}
`;
    }
}

/**
 * The core Agent class that manages the Reason-Act-Observe loop.
 */
export class Agent {
    constructor(tools, systemPrompt) {
        this.tools = tools;
        this.systemPrompt = systemPrompt;
        this.memory = new MemoryManager();
        this.yoloMode = false;
        this.chatHistory = [];
        this.maxRetries = 3;
    }

    setYoloMode(enabled) {
        this.yoloMode = enabled;
    }

    /**
     * Main entry point for processing a user message.
     * @param {string} userMessage - The user's input.
     * @param {object} context - Current application state.
     * @param {function} onThought - Callback to stream thought process updates to UI.
     * @param {function} onToolCall - Callback when a tool is about to be called (returns Promise<boolean> for confirmation).
     * @param {function} llmExecutor - Function(messages) -> Promise<{text, toolCalls}>.
     * @param {function} toolExecutor - Function(name, args) -> Promise<result>.
     * @returns {Promise<string>} The final response.
     */
    async process(userMessage, context, onThought, onToolCall, llmExecutor, toolExecutor) {
        // Capture the history array ONCE. `chatHistory` is rebound when the user
        // switches conversation tabs, and an in-flight request must keep writing to
        // the conversation it started in.
        const history = this.chatHistory;

        // 1. Add user message to history
        history.push({ role: 'user', content: userMessage });

        // 2. Construct System Prompt with Context
        const memorySummary = this.memory.getSummary();
        const fullSystemPrompt = `
${this.systemPrompt}

## Current Context
${JSON.stringify(context, null, 2)}

${memorySummary}

## Agent Mode
You are in a ReAct loop. 
- If you need to use a tool, output the tool call.
- If you are done, output the final answer.
- Explain your reasoning before calling tools.
`;

        let loopCount = 0;
        const maxLoops = 10;
        let currentMessages = [...history];

        while (loopCount < maxLoops) {
            loopCount++;

            // Notify UI
            onThought(loopCount === 1 ? 'Thinking...' : 'Analyzing results...');

            // Call LLM
            const response = await llmExecutor(currentMessages, fullSystemPrompt);

            const hasToolCalls = response.toolCalls && response.toolCalls.length > 0;

            // Final Answer: text present with no tool calls -> we're done.
            if (response.text && !hasToolCalls) {
                history.push({ role: 'assistant', content: response.text });
                return response.text;
            }

            // Stream any reasoning text to the UI.
            if (response.text) {
                onThought(response.text);
            }

            // Add the assistant tool-call turn to history whenever there are tool calls
            // (content may be null/empty for tool-only turns, e.g. OpenAI returns content:null).
            // This MUST happen BEFORE the role:'tool' results are pushed, otherwise the
            // provider rejects tool results that aren't preceded by their tool-call turn.
            if (hasToolCalls || response.text) {
                const assistantTurn = {
                    role: 'assistant',
                    content: response.text || '',
                    tool_calls: hasToolCalls ? response.toolCalls : undefined
                };
                currentMessages.push(assistantTurn);
                // ALSO persist it: pushing tool turns only into `currentMessages`
                // meant the next user turn started from a transcript with no record
                // that a simulation had already been run, so the model ran it again.
                history.push(assistantTurn);
            }

            // Handle Tool Calls
            if (hasToolCalls) {
                for (const toolCall of response.toolCalls) {
                    const { name, args, id } = toolCall;

                    // Check Confirmation
                    const requiresConfirm = this.requiresConfirmation(name);
                    let allowed = true;

                    if (requiresConfirm) {
                        onThought(`Requesting confirmation for ${name}...`);
                        allowed = await onToolCall(name, args);
                    }

                    let result;
                    if (allowed) {
                        onThought(`Executing ${name}...`);
                        try {
                            // Retry ONLY transient failures. Retrying every thrown
                            // error re-ran deterministic failures (a missing panel, a
                            // bad argument) three times before giving up.
                            let attempts = 0;
                            while (attempts < this.maxRetries) {
                                try {
                                    result = await toolExecutor(name, args);
                                    break;
                                } catch (err) {
                                    attempts++;
                                    if (attempts >= this.maxRetries || !Agent.isTransientError(err)) throw err;
                                    onThought(`Tool failed (transient), retrying (${attempts}/${this.maxRetries})...`);
                                }
                            }
                        } catch (error) {
                            result = { error: error.message };
                        }
                    } else {
                        result = { error: "User denied permission." };
                    }

                    // Add result to BOTH the loop transcript and the persistent
                    // history, so a later turn can see what the tool already returned.
                    const toolTurn = {
                        role: 'tool',
                        tool_call_id: id,
                        name: name,
                        content: JSON.stringify(result)
                    };
                    currentMessages.push(toolTurn);
                    history.push(toolTurn);
                }
            }
        }

        return "I'm sorry, I got stuck in a loop and couldn't finish the task.";
    }

    /**
     * Decides whether a thrown tool error is worth retrying. Deterministic failures
     * (a missing element, an invalid argument, a denied permission) produce the same
     * error every time, so retrying them only wastes the user's time.
     * @param {Error|string} err
     * @returns {boolean}
     */
    static isTransientError(err) {
        const message = String(err?.message ?? err ?? '').toLowerCase();
        if (!message) return false;
        const transientPatterns = [
            'timeout', 'timed out', 'network', 'fetch failed', 'failed to fetch',
            'econnreset', 'econnrefused', 'etimedout', 'socket hang up',
            'temporarily', 'try again', 'rate limit', 'too many requests',
            'service unavailable', 'bad gateway', 'gateway timeout',
            'busy', 'locked', 'ebusy'
        ];
        return transientPatterns.some(p => message.includes(p));
    }

    /**
     * Checks if a tool requires confirmation based on YOLO mode and danger level.
     * @param {string} toolName 
     * @returns {boolean} True if confirmation is needed.
     */
    requiresConfirmation(toolName) {
        // setViewpointPosition is deliberately absent from this list: it writes the
        // view-position fields that the DGP and rendering recipes read, so it is a
        // simulation input rather than a camera move. changeView, by contrast, only
        // moves the editor camera.
        // Read-only tools answer a question without touching project state, so
        // confirming them adds friction and teaches the user to click through the
        // prompt. Everything not listed here changes the scene, the recipe, the
        // results, or a file on disk, and is confirmed in normal mode.
        const readOnlyTools = new Set([
            'getEn17037Summary', 'getEnIlluminanceSummary', 'getEnUgrSummary',
            'getCircadianMetricsSummary', 'getImagelessGlareSummary',
            'getLightingEnergySummary', 'compareMetrics', 'getGeometryMode',
            'listCustomWalls', 'getWallDetails', 'queryResultsData',
            'getDatasetStatistics', 'searchKnowledgeBase',
            'analyzeOptimizationResults',
            'showAnalysisDashboard', 'displayResultsForTime',
            'highlightResultPoint', 'filterAndHighlightPoints', 'filterDataTable',
            'toggleDataTable', 'toggleUIPanel', 'toggleHdrViewer',
            'configureHdrViewer', 'toggleComparisonMode', 'setTheme',
            'changeView', 'startWalkthrough',
            'endWalkthrough', 'toggleSunRayVisibility', 'openSimulationRecipe',
            'openOptimizationPanel'
        ]);

        // Destructive tools discard work that cannot be recovered from the UI, so
        // they are confirmed even in autonomous mode. Every name here is checked
        // against the live registry by the test in requiresConfirmation's spec.
        // `suggestOptimizationRanges` reads like a query but its handler rewrites the
        // optimizer's UI inputs and then runs `startOptimization('quick')` - a dozen
        // headless Radiance evaluations. It belongs here, not on the read-only list.
        const destructiveTools = new Set([
            'loadProject', 'clearResults', 'startOptimization', 'runSimulation',
            'suggestOptimizationRanges'
        ]);

        if (this.yoloMode) {
            return destructiveTools.has(toolName);
        }
        return !readOnlyTools.has(toolName);
    }
}
