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
        // 1. Add user message to history
        this.chatHistory.push({ role: 'user', content: userMessage });

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
        let currentMessages = [...this.chatHistory];

        while (loopCount < maxLoops) {
            loopCount++;

            // Notify UI
            onThought(loopCount === 1 ? 'Thinking...' : 'Analyzing results...');

            // Call LLM
            const response = await llmExecutor(currentMessages, fullSystemPrompt);

            // Handle Text (Thought or Final Answer)
            if (response.text) {
                // If we have tool calls, the text is likely "reasoning".
                // If no tool calls, it's the final answer.
                if (!response.toolCalls || response.toolCalls.length === 0) {
                    this.chatHistory.push({ role: 'assistant', content: response.text });
                    return response.text;
                }

                // It's reasoning/thought
                onThought(response.text);
                currentMessages.push({ role: 'assistant', content: response.text, tool_calls: response.toolCalls });
            }

            // Handle Tool Calls
            if (response.toolCalls && response.toolCalls.length > 0) {
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
                            // Retry logic
                            let attempts = 0;
                            while (attempts < this.maxRetries) {
                                try {
                                    result = await toolExecutor(name, args);
                                    break;
                                } catch (err) {
                                    attempts++;
                                    if (attempts >= this.maxRetries) throw err;
                                    onThought(`Tool failed, retrying (${attempts}/${this.maxRetries})...`);
                                }
                            }
                        } catch (error) {
                            result = { error: error.message };
                        }
                    } else {
                        result = { error: "User denied permission." };
                    }

                    // Add result to history for the next loop iteration
                    currentMessages.push({
                        role: 'tool',
                        tool_call_id: id,
                        name: name,
                        content: JSON.stringify(result)
                    });
                }
            }
        }

        return "I'm sorry, I got stuck in a loop and couldn't finish the task.";
    }

    /**
     * Checks if a tool requires confirmation based on YOLO mode and danger level.
     * @param {string} toolName 
     * @returns {boolean} True if confirmation is needed.
     */
    requiresConfirmation(toolName) {
        const dangerTools = ['deleteGeometry', 'resetProject', 'overwriteFiles']; // Example
        const isDangerous = dangerTools.includes(toolName);

        if (this.yoloMode) {
            return isDangerous; // In YOLO, only dangerous tools need confirm
        }
        return true; // In normal mode, most "action" tools might need confirm, or maybe just dangerous ones?
        // User said: "Disable YOLO -> Verify it asks 'I am about to add 5 windows. Proceed?'"
        // So in normal mode, ALL state-changing tools should likely ask.
    }
}
