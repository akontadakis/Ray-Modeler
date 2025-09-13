// scripts/ai-assistant.js

import { getDom, showAlert, getNewZIndex, togglePanelVisibility, highlightSensorPoint, clearSensorHighlights, clearAllResultsDisplay, getSensorGridParams } from './ui.js';
import { loadKnowledgeBase, searchKnowledgeBase } from './knowledgeBase.js';
import { project } from './project.js';
import { resultsManager } from './resultsManager.js';
import { openGlareRoseDiagram, openCombinedAnalysisPanel } from './annualDashboard.js';
import { openRecipePanelByType, programmaticallyGeneratePackage } from './simulation.js';

// Module-level cache for DOM elements
let dom;
// Stores the conversation history for context
const chatHistory = [];

// Define the tools the AI can use to interact with the application
const availableTools = [
    {
        "functionDeclarations": [
             {
                "name": "openSimulationRecipe",
                "description": "Opens a specific simulation recipe panel from the Simulation Modules sidebar if it is not already open.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "recipeType": { "type": "STRING", "description": "The type of recipe to open. Must be one of: 'illuminance', 'rendering', 'dgp', 'df', 'annual-3ph', 'sda-ase', 'annual-5ph', 'imageless-glare', 'spectral-lark'." }
                    },
                    "required": ["recipeType"]
                }
            },
            {
                "name": "validateProjectState",
                "description": "Analyzes the current project configuration for common errors, warnings, and readiness for a specific type of simulation.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "analysisType": { "type": "STRING", "description": "The type of analysis to validate for. Must be one of 'general', 'illuminance', 'rendering', 'dgp', 'annual', 'illuminance', 'df', 'imageless-glare'." }
                    },
                    "required": ["analysisType"]
                }
            },
            {
                "name": "setDimension",
                "description": "Sets a primary room dimension (width, length, or height) to a new value.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "dimension": { "type": "STRING", "description": "The dimension to change. Must be one of 'width', 'length', or 'height'." },
                        "value": { "type": "NUMBER", "description": "The new value for the dimension in meters." }
                    },
                    "required": ["dimension", "value"]
                }
            },
            {
                "name": "changeView",
                "description": "Changes the main 3D viewport to a standard orthographic or perspective view.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "view": { "type": "STRING", "description": "The desired view. Must be one of: 'perspective', 'top', 'front', 'back', 'left', 'right'." }
                    },
                    "required": ["view"]
                }
            },
            {
                "name": "setViewpointPosition",
                "description": "Moves the viewpoint camera (the 'vp' parameter in Radiance) to a specific coordinate within the room.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "x": { "type": "NUMBER", "description": "The X-coordinate (along the width)." },
                        "y": { "type": "NUMBER", "description": "The Y-coordinate (height from the floor)." },
                        "z": { "type": "NUMBER", "description": "The Z-coordinate (along the length)." }
                    },
                    "required": ["x", "y", "z"]
                }
            },
            {
                "name": "configureShading",
                "description": "Configures a shading device for a specific wall. Can enable/disable shading or set properties for a specific device type like an overhang.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "wall": { "type": "STRING", "description": "The wall to modify. Must be one of 'north', 'south', 'east', or 'west'." },
                        "enable": { "type": "BOOLEAN", "description": "Set to true to enable shading on this wall, or false to disable it." },
                        "deviceType": { "type": "STRING", "description": "The type of device to configure. E.g., 'overhang', 'louver', 'lightshelf'. Required if enabling or configuring." },
                        "depth": { "type": "NUMBER", "description": "The depth of the device in meters (e.g., for an overhang)." },
                        "tilt": { "type": "NUMBER", "description": "The tilt angle in degrees (e.g., for an overhang)." }
                    },
                    "required": ["wall"]
                }
            },
            {
                "name": "setSensorGrid",
                "description": "Configures parameters for the illuminance sensor grid on a specific surface.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "surface": { "type": "STRING", "description": "The surface to configure. Must be one of 'floor', 'ceiling', or 'walls'." },
                        "enable": { "type": "BOOLEAN", "description": "Set to true to enable the grid on this surface, or false to disable it." },
                        "spacing": { "type": "NUMBER", "description": "The spacing between sensor points in meters." },
                        "offset": { "type": "NUMBER", "description": "The offset from the surface in meters." }
                    },
                    "required": ["surface"]
                }
            },
            {
                "name": "setGlobalRadianceParameter",
                "description": "Sets a global Radiance simulation parameter, such as ambient bounces or ambient divisions.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "parameter": { "type": "STRING", "description": "The Radiance parameter to set. Must be one of 'ab' (ambient bounces), 'ad' (ambient divisions), 'as' (ambient supersamples), or 'aa' (ambient accuracy)." },
                        "value": { "type": "NUMBER", "description": "The numeric value for the parameter." }
                    },
                    "required": ["parameter", "value"]
                },
                },
            {
                "name": "configureDaylightingSystem",
                "description": "Configures the artificial lighting's daylighting control system.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "enable": { "type": "BOOLEAN", "description": "Set to true to enable daylighting controls, false to disable." },
                        "controlType": { "type": "STRING", "description": "The control strategy. Must be one of 'Continuous', 'Stepped', or 'ContinuousOff'." },
                        "setpoint": { "type": "NUMBER", "description": "The target illuminance in lux at the sensor." }
                    },
                    "required": ["enable"]
                }
            },
            {
                "name": "configureSimulationRecipe",
                "description": "Sets parameters within an already OPEN simulation recipe panel.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "recipeType": { "type": "STRING", "description": "The type of recipe to configure. E.g., 'illuminance', 'rendering', 'dgp'." },
                        "parameters": {
                            "type": "OBJECT",
                            "description": "A JSON object of key-value pairs to set. Keys must match the base ID of the input controls, e.g., 'pit-month', 'quality-preset', 'rpict-x'."
                        }
                    },
                    "required": ["recipeType", "parameters"]
                }
            },
            {
                "name": "showAnalysisDashboard",
                "description": "Opens a specific annual analysis dashboard if the required results files are loaded.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "dashboardType": { "type": "STRING", "description": "The dashboard to open. Must be one of 'glareRose' or 'combinedAnalysis'." }
                    },
                   "required": ["dashboardType"]
                }
            },
            {
                "name": "toggleUIPanel",
                "description": "Opens or closes a primary UI panel from the left toolbar, such as 'Project Setup' or 'Dimensions'.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "panelName": { "type": "STRING", "description": "The friendly name of the panel to toggle. Must be one of: 'project', 'dimensions', 'apertures', 'lighting', 'materials', 'sensors', 'viewpoint', 'viewOptions', 'info', 'aiAssistant'." },
                        "state": { "type": "STRING", "description": "The desired state for the panel. Must be 'open' or 'close'." }
                    },
                    "required": ["panelName", "state"]
                }
            },
            {
               "name": "runSimulation",
                "description": "Initiates a simulation by programmatically clicking the 'Run Simulation' button within an open and configured recipe panel.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "recipeType": { "type": "STRING", "description": "The type of recipe to run. Must match the recipe's internal type, e.g., 'illuminance', 'rendering', 'dgp', 'annual-3ph'." }
                    },
                    "required": ["recipeType"]
                }
            },
            {
                "name": "highlightResultPoint",
                "description": "Visually highlights sensor points in the 3D view that correspond to the minimum, maximum, or clears existing highlights.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "type": { "type": "STRING", "description": "The type of highlight to apply. Must be one of 'min', 'max', or 'clear'." }
                    },
                    "required": ["type"]
                }
            },
            {
                "name": "displayResultsForTime",
                "description": "Updates the 3D visualization to show the illuminance distribution for a specific hour of the year from a loaded annual simulation file.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "hour": { "type": "NUMBER", "description": "The hour of the year to display, from 0 to 8759." }
                    },
                    "required": ["hour"]
                }
            },
            {
                "name": "queryResultsData",
                "description": "Performs a simple query on the currently loaded results data and returns the numerical answer. Does not modify the UI.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "queryType": { "type": "STRING", "description": "The type of query to perform. Must be one of 'average', 'min', 'max', 'countBelow', 'countAbove'." },
                        "threshold": { "type": "NUMBER", "description": "The illuminance threshold in lux. Required only for 'countBelow' and 'countAbove' queries." }
                    },
                   "required": ["queryType"]
                }
            },
            {
                "name": "getDatasetStatistics",
                "description": "Retrieves the summary statistics (min, max, average, count) for a specific dataset (A or B), regardless of which one is currently active in the UI.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "dataset": { "type": "STRING", "description": "The dataset to query. Must be 'a' or 'b'." }
                    },
                    "required": ["dataset"]
                }
            },
            {
                "name": "saveProject",
                "description": "Saves the current project state by triggering a file download for the user.",
                "parameters": { "type": "OBJECT", "properties": {} }
            },
            {
                "name": "loadResultsFile",
                "description": "Opens the system's file dialog for the user to select a results file to load into a specific dataset.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "dataset": { "type": "STRING", "description": "The dataset to load the file into. Must be 'a' or 'b'." }
                    },
                    "required": ["dataset"]
                }
            },
            {
                "name": "clearResults",
                "description": "Clears all loaded simulation results data and resets the analysis UI panels.",
                "parameters": { "type": "OBJECT", "properties": {} }
            },
            {
                "name": "setMaterialProperty",
                "description": "Sets a specific material property for a surface in the scene, such as reflectance or roughness.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "surface": { "type": "STRING", "description": "The surface to modify. Must be one of 'wall', 'floor', 'ceiling', 'frame', 'shading', or 'glazing'." },
                        "property": { "type": "STRING", "description": "The property to change. Must be one of 'reflectance', 'specularity', 'roughness', or 'transmittance' (for glazing only)." },
                        "value": { "type": "NUMBER", "description": "The new value for the property, typically between 0.0 and 1.0." }
                    },
                    "required": ["surface", "property", "value"]
                }
            }
        ]
    }
];

// A shared map of recipe types to their template IDs. Used by multiple AI tools.
const recipeMap = {
    'illuminance': 'template-recipe-illuminance',
    'rendering': 'template-recipe-rendering',
    'dgp': 'template-recipe-dgp',
    'df': 'template-recipe-df',
    'annual-3ph': 'template-recipe-annual-3ph',
    'sda-ase': 'template-recipe-sda-ase',
    'annual-5ph': 'template-recipe-annual-5ph',
    'imageless-glare': 'template-recipe-imageless-glare',
    'spectral-lark': 'template-recipe-spectral-lark'
};

// Define the available models for each provider
const modelsByProvider = {
    gemini: [
        { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
        { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' }
    ],
    openrouter: [
        { id: 'google/gemini-2.5-flash-lite', name: 'Google Gemini 2.5 Flash Lite' },
        { id: 'google/gemini-2.5-flash', name: 'Google Gemini 2.5 Flash' },
        { id: 'google/gemini-2.5-pro', name: 'Google Gemini 2.5 Pro' },
        { id: 'openai/gpt-5', name: 'OpenAI GPT-5' },
        { id: 'openai/gpt-5-mini', name: 'OpenAI GPT-5 Mini' },
        { id: 'openai/gpt-4.1', name: 'OpenAI GPT-4.1' },
        { id: 'openai/o3', name: 'OpenAI o3' },
        { id: 'openai/o3-mini', name: 'OpenAI o3 Mini' },
        { id: 'openai/gpt-oss-120b:free', name: 'OpenAI GPT-OSS 120B (Free)' },
        { id: 'openai/gpt-oss-20b:free', name: 'OpenAI GPT-OSS 20B (Free)' },             
        { id: 'anthropic/claude-sonnet-4', name: 'Anthropic Claude Sonnet 4' },
        { id: 'anthropic/claude-3.7-sonnet', name: 'Anthropic Claude 3.7 Sonnet' },
        { id: 'deepseek/deepseek-chat-v3.1:free', name: 'DeepSeek Chat v3.1 (Free)' },
        { id: 'deepseek/deepseek-chat-v3.1', name: 'DeepSeek Chat v3.1' },
        { id: 'tngtech/deepseek-r1t2-chimera:free', name: 'TNG DeepSeek R1T2 Chimera (free)' },
        { id: 'deepseek/deepseek-r1-0528:free', name: 'DeepSeek R1 0528 (free)' },
        { id: 'qwen/qwen3-coder:free', name: 'Qwen Qwen3 Coder 480B A35B (free)' },
        { id: 'qwen/qwq-32b:free', name: 'Qwen QwQ 32B (free)' },
        { id: 'qwen/qwq-32b', name: 'Qwen QwQ 32B' },
        { id: 'qwen/qwen3-max', name: 'Qwen Qwen3 Max' },
        { id: 'mistralai/mistral-small-3.2-24b-instruct:free', name: 'Mistral Mistral Small 3.2 24B (free' },
        { id: 'moonshotai/kimi-k2:free', name: 'MoonshotAI Kimi K2 0711 (free)' },
        { id: 'moonshotai/kimi-dev-72b:free', name: 'MoonshotAI Kimi Dev 72B (free)' },
        { id: 'moonshotai/kimi-vl-a3b-thinking:free', name: 'MoonshotAI Kimi VL A3B Thinking (free)' },
        { id: 'deepseek/deepseek-r1-0528:free', name: 'DeepSeek R1 0528 (free)' }   
    ]
};

/**
 * Initializes the AI Assistant, setting up all necessary event listeners.
 */
function initAiAssistant() {
    dom = getDom(); // Cache the dom object from ui.js

    // Exit if the main button doesn't exist in the HTML
    if (!dom['ai-assistant-button']) {
        console.warn('AI Assistant button not found, feature disabled.');
        return;
    }
    
    // NOTE: The main button to open the panel is already handled by the generic
    // panel toggling logic in ui.js, so we don't need to add a listener for it here.

    dom['ai-chat-form']?.addEventListener('submit', handleSendMessage);
    dom['ai-settings-btn']?.addEventListener('click', openSettingsModal);
    dom['ai-settings-close-btn']?.addEventListener('click', closeSettingsModal);
    dom['ai-settings-form']?.addEventListener('submit', saveSettings);
    dom['ai-provider-select']?.addEventListener('change', (e) => {
        updateModelOptions(e.target.value);
        toggleProviderInfo(e.target.value);
    });

    loadSettings();
    loadKnowledgeBase(); // Load custom knowledge documents
    addMessage('ai', 'Hello! How can I help you with your simulation?');
}

/**
 * Populates the model selection dropdown based on the chosen provider.
 * @param {string} provider - The selected AI provider ('gemini' or 'openrouter').
 */
function updateModelOptions(provider) {
    const modelSelect = dom['ai-model-select'];
    if (!modelSelect) return;

    // Clear existing options
    modelSelect.innerHTML = '';

    const models = modelsByProvider[provider] || [];
    models.forEach(model => {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = model.name;
        modelSelect.appendChild(option);
    });
}

/**
 * Shows or hides the informational box specific to the OpenRouter provider.
 * @param {string} provider The selected AI provider.
 */
function toggleProviderInfo(provider) {
    const infoBox = dom['openrouter-info-box'];
    if (!infoBox) return;

    if (provider === 'openrouter') {
        infoBox.classList.remove('hidden');
    } else {
        infoBox.classList.add('hidden');
    }
}

/**
 * Adds a message to the chat window and the conversation history.
 * @param {'user' | 'ai'} sender - Who sent the message.
 * @param {string} text - The content of the message.
 */
function addMessage(sender, text) {
    const messagesContainer = dom['ai-chat-messages'];
    if (!messagesContainer) return;

    const messageWrapper = document.createElement('div');
    messageWrapper.className = `chat-message ${sender}-message`;

    const messageBubble = document.createElement('div');
    messageBubble.className = 'message-bubble';
    
    // Basic markdown for code blocks
    text = text.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    messageBubble.innerHTML = text;

    // Add to conversation history for context in future API calls
    const role = sender === 'ai' ? 'model' : 'user';
    chatHistory.push({ role: role, parts: [{ text: text }] });
    
    // Cap the history to avoid overly large payloads (last 20 messages)
    if(chatHistory.length > 20) {
        chatHistory.splice(0, chatHistory.length - 20);
    }

    messageWrapper.appendChild(messageBubble);
    messagesContainer.appendChild(messageWrapper);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

/**
 * Creates a comprehensive system prompt including the base persona, knowledge base context,
 * and the full current state of the application.
 * @param {string} userQuery - The user's most recent message.
 * @returns {Promise<string>} A promise that resolves to the complete system prompt string.
 * @private
 */
async function _createContextualSystemPrompt(userQuery) {
    // Base Persona for the AI
    let systemPrompt = "You are Helios, an expert AI assistant with deep knowledge of the Radiance Lighting Simulation Engine embedded within the Ray Modeler web application. Your purpose is to guide users through daylighting analysis, lighting simulation, and building performance modeling. You can explain Radiance concepts, troubleshoot errors, and interpret results. Your tone is that of a seasoned mentor: clear, precise, and encouraging.";

    // Part 1: Add context from the local knowledge base
    const contextChunks = searchKnowledgeBase(userQuery);
    if (contextChunks.length > 0) {
        const contextText = contextChunks.map(chunk => `Source: ${chunk.source}\nTopic: ${chunk.topic}\nContent: ${chunk.content}`).join('\n\n---\n\n');
        systemPrompt += `\n\nUse the following information from the application's knowledge base to help answer the user's question. Prioritize this information.\n\n--- KNOWLEDGE BASE CONTEXT ---\n${contextText}\n--- END OF CONTEXT ---`;
    }

    // Part 2: Gather and add the full current application state
    const projectData = await project.gatherAllProjectData();
    const resultsData = {
        datasetA: resultsManager.datasets.a ? { fileName: resultsManager.datasets.a.fileName, stats: resultsManager.datasets.a.stats, glareResult: !!resultsManager.datasets.a.glareResult, isAnnual: resultsManager.hasAnnualData('a') } : null,
        datasetB: resultsManager.datasets.b ? { fileName: resultsManager.datasets.b.fileName, stats: resultsManager.datasets.b.stats, glareResult: !!resultsManager.datasets.b.glareResult, isAnnual: resultsManager.hasAnnualData('b') } : null
    };

    // Sanitize project data for the prompt to avoid sending huge file contents
    const dataForPrompt = JSON.parse(JSON.stringify(projectData));
    dataForPrompt.epwFileContent = dataForPrompt.epwFileContent ? `[Loaded: ${dataForPrompt.projectInfo.epwFileName}]` : null;
    if (dataForPrompt.simulationFiles) {
        Object.values(dataForPrompt.simulationFiles).forEach(file => { if (file && file.content) file.content = `[Content Loaded for ${file.name}]`; });
    }

    const appState = {
        projectConfiguration: dataForPrompt,
        loadedResultsSummary: resultsData
    };

    const appStateJSON = JSON.stringify(appState, null, 2);

    systemPrompt += `\n\nCRITICAL: Analyze the user's query in the context of the current application state provided below in JSON format. This state represents all the user's current settings, inputs, and a summary of loaded data. Use this information as the primary source of truth to provide specific, context-aware answers about their current project.\n\n--- CURRENT APPLICATION STATE ---\n${appStateJSON}\n--- END OF STATE ---`;

    return systemPrompt;
}

/**
 * Handles the form submission for sending a new chat message.
 * @param {Event} event - The form submission event.
 */
async function handleSendMessage(event) {
    event.preventDefault();
    const input = dom['ai-chat-input'];
    const message = input.value.trim();

    if (!message) return;

    addMessage('user', message);
    input.value = '';

    setLoadingState(true);

    try {
        const apiKey = localStorage.getItem('ai_api_key');
        const provider = localStorage.getItem('ai_provider');
        const model = localStorage.getItem('ai_model');

        if (!apiKey || !provider || !model) {
            const errorMessage = 'AI settings are incomplete. Please configure the provider, model, and API key in settings (the ⚙️ icon).';
            showAlert(errorMessage, 'Configuration Needed');
            addMessage('ai', errorMessage);
            setLoadingState(false);
            return;
        }

        // Create the full contextual prompt by combining the base persona,
        // knowledge base search results, and the live application state.
        const systemPrompt = await _createContextualSystemPrompt(message);

        const responseText = await callGenerativeAI(apiKey, provider, model, systemPrompt);
        addMessage('ai', responseText);

    } catch (error) {
        console.error('AI Assistant Error:', error);
        const errorMessage = `Sorry, I encountered an error: ${error.message}`;
        addMessage('ai', errorMessage);
        showAlert(`Error communicating with the AI model: ${error.message}`, 'API Error');
    } finally {
        setLoadingState(false);
    }
}

/**
 * Executes a tool call requested by the AI model by programmatically changing UI elements.
 * @param {object} toolCall - The function call object from the AI response.
 * @returns {Promise<object>} A result object for the tool call.
 * @private
 */
async function _executeToolCall(toolCall) {
    const { name, args } = toolCall.functionCall;
    console.log(`👾 Executing tool: ${name}`, args);

    const updateUI = (elementId, value, property = 'value', parentElement = null) => {
        const context = parentElement || document;
        const element = context.querySelector(`#${elementId}`);
        if (element) {
            element[property] = value;
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }
        console.warn(`Tool execution failed: Element with ID '${elementId}' not found.`);
        return false;
    };

    try {
        switch (name) {
            case 'setDimension': {
                if (!['width', 'length', 'height'].includes(args.dimension)) throw new Error(`Invalid dimension: ${args.dimension}`);
                updateUI(args.dimension, args.value);
                return { success: true, message: `Set ${args.dimension} to ${args.value}m.` };
            }
            case 'changeView': {
                const { setCameraView } = await import('./ui.js');
                const viewMap = { 'perspective': 'persp', 'top': 'top', 'front': 'front', 'back': 'back', 'left': 'left', 'right': 'right' };
                if (!viewMap[args.view]) throw new Error(`Invalid view: ${args.view}`);
                setCameraView(viewMap[args.view]);
                return { success: true, message: `Changed view to ${args.view}.` };
            }
            case 'setViewpointPosition': {
                updateUI('view-pos-x', args.x);
                updateUI('view-pos-y', args.y);
                updateUI('view-pos-z', args.z);
                return { success: true, message: `Viewpoint moved to [${args.x}, ${args.y}, ${args.z}].` };
            }
            case 'configureShading': {
                const wallDir = args.wall?.charAt(0).toLowerCase();
                if (!['n', 's', 'e', 'w'].includes(wallDir)) throw new Error(`Invalid wall: ${args.wall}`);
                if (args.enable !== undefined) updateUI(`shading-${wallDir}-toggle`, args.enable, 'checked');
                if (args.deviceType) updateUI(`shading-type-${wallDir}`, args.deviceType);
                if (args.depth !== undefined) updateUI(`overhang-depth-${wallDir}`, args.depth);
                if (args.tilt !== undefined) updateUI(`overhang-tilt-${wallDir}`, args.tilt);
                return { success: true, message: `Configured shading for ${args.wall} wall.` };
            }
            case 'setSensorGrid': {
                const surfaceMap = { 'floor': 'floor', 'ceiling': 'ceiling', 'walls': 'wall' };
                const surfaceKey = surfaceMap[args.surface];
                if (!surfaceKey) throw new Error(`Invalid surface: ${args.surface}`);
                if (surfaceKey === 'wall') {
                    ['north', 'south', 'east', 'west'].forEach(dir => updateUI(`grid-${dir}-toggle`, args.enable, 'checked'));
                } else if (args.enable !== undefined) {
                    updateUI(`grid-${surfaceKey}-toggle`, args.enable, 'checked');
                }
                if (args.spacing !== undefined) updateUI(`${surfaceKey}-grid-spacing`, args.spacing);
                if (args.offset !== undefined) updateUI(`${surfaceKey}-grid-offset`, args.offset);
                return { success: true, message: `Configured sensor grid for ${args.surface}.` };
            }
            case 'setGlobalRadianceParameter': {
                const globalPanel = document.querySelector('[data-template-id="template-global-sim-params"]');
                if (!globalPanel) throw new Error("Global Simulation Parameters panel is not open.");
                // The global panel has static IDs, so we don't need a suffix.
                const paramId = args.parameter; 
                if (updateUI(paramId, args.value, 'value', globalPanel)) {
                    return { success: true, message: `Set global parameter -${args.parameter} to ${args.value}.` };
                } else {
                     throw new Error(`Could not find UI control for global parameter '${args.parameter}'.`);
                }
            }
            case 'configureDaylightingSystem': {
                updateUI('daylighting-enabled-toggle', args.enable, 'checked');
                if (args.enable) {
                    if (args.controlType) updateUI('daylighting-control-type', args.controlType);
                    if (args.setpoint !== undefined) updateUI('daylighting-setpoint', args.setpoint);
                }
                return { success: true, message: `Daylighting system ${args.enable ? 'enabled and configured' : 'disabled'}.` };
            }
            case 'configureSimulationRecipe': {
                const recipeMap = { 'illuminance': 'template-recipe-illuminance', 'rendering': 'template-recipe-rendering', 'dgp': 'template-recipe-dgp' };
                const templateId = recipeMap[args.recipeType];
                if (!templateId) throw new Error(`Unknown recipe type: ${args.recipeType}`);

                const panel = document.querySelector(`.floating-window[data-template-id="${templateId}"]`);
                if (!panel || panel.classList.contains('hidden')) {
                    throw new Error(`The '${args.recipeType}' recipe panel is not open. Please open it first.`);
                }
                const panelSuffix = panel.id.split('-').pop();
                let paramsSet = 0;
                for (const key in args.parameters) {
                    const elId = `${key}-${panelSuffix}`;
                    // Pass the specific panel element as the context for the query
                    if (updateUI(elId, args.parameters[key], 'value', panel)) {
                        paramsSet++;
                    }
                }
                return { success: true, message: `Successfully set ${paramsSet} parameters in the ${args.recipeType} recipe.` };
            }
            case 'openSimulationRecipe': {
                const { openRecipePanelByType } = await import('./simulation.js');
                const templateId = recipeMap[args.recipeType];
                if (!templateId) throw new Error(`Unknown recipe type: ${args.recipeType}`);
                
                const panel = openRecipePanelByType(templateId);
                if (panel) {
                    return { success: true, message: `Opened the ${args.recipeType} recipe panel.` };
                } else {
                    throw new Error(`Could not open the ${args.recipeType} recipe panel.`);
                }
            }
            case 'generateSimulationPackage': {
                const { programmaticallyGeneratePackage } = await import('./simulation.js');
                const templateId = recipeMap[args.recipeType];
                if (!templateId) throw new Error(`Unknown recipe type: ${args.recipeType}`);

                const panel = document.querySelector(`.floating-window[data-template-id="${templateId}"]`);
                if (!panel || panel.classList.contains('hidden')) {
                    throw new Error(`The '${args.recipeType}' recipe panel is not open. Please open it first.`);
                }
                
                const result = await programmaticallyGeneratePackage(panel);
                if (result) {
                    return { success: true, message: `Successfully generated simulation package for the ${args.recipeType} recipe.` };
                } else {
                    throw new Error(`Failed to generate simulation package for ${args.recipeType}.`);
                }
            }
            case 'validateProjectState': {
                const results = await _performValidationChecks(args.analysisType);
                let message;
                if (results.errors.length === 0 && results.warnings.length === 0) {
                    message = `Validation successful! The project appears to be correctly configured for a(n) ${args.analysisType} analysis.`;
                } else {
                    message = `Validation complete. Found ${results.errors.length} error(s) and ${results.warnings.length} warning(s).`;
                }
                return { success: true, message: message, details: results };
            }
            case 'showAnalysisDashboard': {
                if (args.dashboardType === 'glareRose') {
                    await openGlareRoseDiagram();
                    return { success: true, message: `Opening the Glare Rose diagram.` };
                } else if (args.dashboardType === 'combinedAnalysis') {
                    await openCombinedAnalysisPanel();
                    return { success: true, message: `Opening the Combined Daylight & Glare analysis.` };
                }
                throw new Error(`Unknown dashboard type: ${args.dashboardType}`);
            }
            case 'toggleUIPanel': {
                const panelMap = {
                    project: { panelId: 'panel-project', btnId: 'toggle-panel-project-btn' },
                    dimensions: { panelId: 'panel-dimensions', btnId: 'toggle-panel-dimensions-btn' },
                    apertures: { panelId: 'panel-aperture', btnId: 'toggle-panel-aperture-btn' },
                    lighting: { panelId: 'panel-lighting', btnId: 'toggle-panel-lighting-btn' },
                    materials: { panelId: 'panel-materials', btnId: 'toggle-panel-materials-btn' },
                    sensors: { panelId: 'panel-sensor', btnId: 'toggle-panel-sensor-btn' },
                    viewpoint: { panelId: 'panel-viewpoint', btnId: 'toggle-panel-viewpoint-btn' },
                    viewOptions: { panelId: 'panel-view-options', btnId: 'toggle-panel-view-options-btn' },
                    info: { panelId: 'panel-info', btnId: 'info-button' },
                    aiAssistant: { panelId: 'panel-ai-assistant', btnId: 'ai-assistant-button' }
                };
                const mapping = panelMap[args.panelName];
                if (!mapping) throw new Error(`Invalid panel name: ${args.panelName}`);

                const panel = document.getElementById(mapping.panelId);
                if (!panel) throw new Error(`Panel element '${mapping.panelId}' not found.`);

                const isHidden = panel.classList.contains('hidden');
                if (args.state === 'open' && isHidden) {
                    togglePanelVisibility(mapping.panelId, mapping.btnId);
                    return { success: true, message: `Opened the ${args.panelName} panel.` };
                } else if (args.state === 'close' && !isHidden) {
                    togglePanelVisibility(mapping.panelId, mapping.btnId);
                    return { success: true, message: `Closed the ${args.panelName} panel.` };
                }
                return { success: true, message: `The ${args.panelName} panel was already ${args.state}.` };
            }
           case 'runSimulation': {
                const templateId = recipeMap[args.recipeType];
                if (!templateId) throw new Error(`Unknown recipe type: ${args.recipeType}`);

                const panel = document.querySelector(`.floating-window[data-template-id="${templateId}"]`);
                if (!panel || panel.classList.contains('hidden')) {
                    throw new Error(`The '${args.recipeType}' recipe panel is not open. Please open it from the Simulation Modules sidebar first.`);
                }

                const runButton = panel.querySelector('[data-action="run"]');
                if (!runButton) throw new Error(`Could not find a run button in the '${args.recipeType}' panel.`);

                if (runButton.disabled) {
                    return { success: false, message: `Cannot run simulation. Please generate the simulation package first.` };
                }

               runButton.click();
                return { success: true, message: `Initiating the ${args.recipeType} simulation.` };
            }
            case 'highlightResultPoint': {
                if (!resultsManager.getActiveData() || resultsManager.getActiveData().length === 0) {
                    throw new Error("No results data is loaded to highlight.");
                }
                const { analysisType } = args;

                // --- General Sanity Checks ---
                if (projectData.mergedSimParams.ab < 1) {
                    warnings.push("Global parameter 'Ambient Bounces (-ab)' is set to 0. No indirect light will be calculated, which can lead to inaccurate results for most daylighting simulations.");
                }

                // --- Analysis-Specific Checks ---
                switch (analysisType) {
                    case 'dgp':
                        if (projectData.viewpoint['view-type'] !== 'h') {
                            errors.push("For a Daylight Glare Probability (DGP) analysis, the Viewpoint Type must be set to 'Fisheye'.");
                        }
                        if (!projectData.projectInfo.epwFileName) {
                            warnings.push("You are running a point-in-time glare analysis without a weather file. The sky will be generated using default values, not location-specific data.");
                        }
                        break;
                    
                    case 'annual-3ph':
                    case 'annual-5ph':
                    case 'sda-ase':
                        if (!projectData.simulationFiles['weather-file']) {
                            errors.push("An EPW weather file must be loaded in the Project Setup panel for any annual simulation.");
                        }
                        if (!projectData.simulationFiles['bsdf-file'] && analysisType !== 'sda-ase') { // sda-ase recipe has its own bsdf inputs
                            warnings.push("A BSDF file is typically required for multi-phase annual simulations. Please ensure one is loaded in the Materials panel if your glazing is complex.");
                        }
                        break;
                        
                    case 'illuminance':
                    case 'df':
                        if (!projectData.sensorGrid.illuminance.enabled) {
                            errors.push("An 'Illuminance Grid' must be enabled in the Sensor Grid panel for this analysis.");
                        }
                        break;
                        
                    case 'imageless-glare':
                        if (!projectData.sensorGrid.view.enabled) {
                            errors.push("A 'View Grid (for Glare)' must be enabled in the Sensor Grid panel for this analysis.");
                        }
                        if (!projectData.simulationFiles['weather-file']) {
                            errors.push("An EPW weather file must be loaded for an imageless annual glare simulation.");
                        }
                        break;
                }
                
                return { success: true, validationResult: { errors, warnings } };
            }
            case 'highlightResultPoint': {
                if (!resultsManager.getActiveData() || resultsManager.getActiveData().length === 0) {
                    throw new Error("No results data is loaded to highlight.");
                }
                if (args.type === 'clear') {
                    clearSensorHighlights();
                    return { success: true, message: `Cleared all highlights from the sensor grid.` };
                } else if (args.type === 'min' || args.type === 'max') {
                    highlightSensorPoint(args.type);
                    return { success: true, message: `Highlighted the sensor point(s) with the ${args.type} value.` };
                } else {
                    throw new Error(`Invalid highlight type: ${args.type}. Must be 'min', 'max', or 'clear'.`);
                }
            }
            case 'displayResultsForTime': {
                if (!resultsManager.hasAnnualData('a') && !resultsManager.hasAnnualData('b')) {
                    throw new Error("No annual simulation results are loaded. Cannot display results for a specific time.");
                }
                const timeScrubber = dom['time-scrubber'];
                if (!timeScrubber) {
                    throw new Error("The annual time-series explorer panel does not appear to be open.");
                }
                const hour = Math.max(0, Math.min(8759, args.hour));
                timeScrubber.value = hour;
                timeScrubber.dispatchEvent(new Event('input', { bubbles: true }));
                return { success: true, message: `3D view updated to show illuminance at hour ${hour}.` };
            }
            case 'queryResultsData': {
                const data = resultsManager.getActiveData();
                const stats = resultsManager.getActiveStats();
                if (!data || data.length === 0 || !stats) {
                    throw new Error("No results data is loaded to query.");
                }

                switch (args.queryType) {
                    case 'average': return { success: true, result: stats.avg, query: 'average' };
                    case 'min': return { success: true, result: stats.min, query: 'minimum' };
                    case 'max': return { success: true, result: stats.max, query: 'maximum' };
                    case 'countBelow': {
                        if (args.threshold === undefined) throw new Error("A 'threshold' is required for 'countBelow' query.");
                        const count = data.filter(v => v < args.threshold).length;
                        return { success: true, result: count, query: `count of points below ${args.threshold} lux` };
                    }
                    case 'countAbove': {
                        if (args.threshold === undefined) throw new Error("A 'threshold' is required for 'countAbove' query.");
                        const count = data.filter(v => v > args.threshold).length;
                        return { success: true, result: count, query: `count of points above ${args.threshold} lux` };
                    }
                    default: throw new Error(`Invalid queryType: ${args.queryType}`);
                }
            }
            case 'getDatasetStatistics': {
                const datasetKey = args.dataset.toLowerCase();
                if (datasetKey !== 'a' && datasetKey !== 'b') {
                    throw new Error("Invalid dataset specified. Must be 'a' or 'b'.");
                }
                const stats = resultsManager.datasets[datasetKey]?.stats;
                if (!stats) {
                    throw new Error(`Dataset ${datasetKey.toUpperCase()} is not loaded or has no statistics.`);
                }
                return { success: true, stats: stats };
            }
            case 'saveProject': {
                project.downloadProjectFile();
                return { success: true, message: "Project file download has been initiated." };
            }
            case 'loadResultsFile': {
                const datasetKey = args.dataset.toLowerCase();
                if (datasetKey !== 'a' && datasetKey !== 'b') {
                    throw new Error("Invalid dataset specified. Must be 'a' or 'b'.");
                }
                const fileInput = dom[`results-file-input-${datasetKey}`];
                if (!fileInput) {
                    throw new Error(`Could not find the file input for dataset ${datasetKey}.`);
                }
                fileInput.click();
                return { success: true, message: `Opening file dialog for the user to select a results file for dataset ${datasetKey.toUpperCase()}.` };
            }
            case 'clearResults': {
                resultsManager.clearDataset('a');
                resultsManager.clearDataset('b');
              clearAllResultsDisplay();
                return { success: true, message: "All results data and visualizations have been cleared." };
            }
            case 'setMaterialProperty': {
                const propMap = { reflectance: 'refl', specularity: 'spec', roughness: 'rough', transmittance: 'trans' };
                const validSurfaces = ['wall', 'floor', 'ceiling', 'frame', 'shading', 'glazing'];
                const validProperties = Object.keys(propMap);

                if (!validSurfaces.includes(args.surface)) throw new Error(`Invalid surface: '${args.surface}'.`);
                if (!validProperties.includes(args.property)) throw new Error(`Invalid property: '${args.property}'.`);
                if (args.property === 'transmittance' && args.surface !== 'glazing') throw new Error("The 'transmittance' property can only be set for the 'glazing' surface.");
                if (args.property !== 'transmittance' && args.surface === 'glazing') throw new Error(`The 'glazing' surface only accepts the 'transmittance' property.`);

                const propSuffix = propMap[args.property];
                const elementId = `${args.surface}-${propSuffix}`;
                
                // Clamp the value to the typical 0-1 range for these properties
                const clampedValue = Math.max(0, Math.min(1, args.value));

                if (updateUI(elementId, clampedValue)) {
                    return { success: true, message: `Set ${args.surface} ${args.property} to ${clampedValue.toFixed(2)}.` };
                } else {
                    throw new Error(`Could not find the UI control for ${args.surface} ${args.property} (ID: ${elementId}).`);
                }
            }
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    } catch (error) {
        console.error(`Error executing tool '${name}':`, error);
        return { success: false, message: `Error: ${error.message}` };
    }
}

/**
 * Performs validation checks on the current project state.
 * @param {string} analysisType - The type of simulation to validate for.
 * @returns {Promise<object>} An object containing lists of errors and warnings.
 * @private
 */
async function _performValidationChecks(analysisType) {
    const errors = [];
    const warnings = [];

    // --- General Checks (apply to all simulations) ---
    if (!project.dirHandle) {
        errors.push("No project directory has been selected. A directory is required to save simulation files.");
    }
    if (!dom['radiance-path']?.value) {
        warnings.push("The Radiance Installation Path is not set. The simulation may fail if Radiance is not in the system's PATH.");
    }
    const globalPanel = document.querySelector('[data-template-id="template-global-sim-params"]');
    if (globalPanel) {
        const abInput = globalPanel.querySelector('[id^="ab-"]');
        if (abInput && parseInt(abInput.value, 10) === 0) {
            warnings.push("Ambient Bounces (-ab) is set to 0 in Global Parameters. No indirect light will be calculated, which may lead to black images or unrealistic results.");
        }
    }

    // --- Analysis-Specific Checks ---
    switch (analysisType) {
        case 'dgp':
            const viewType = dom['view-type']?.value;
            if (viewType !== 'h' && viewType !== 'a') {
                errors.push("For a DGP (glare) analysis, the Viewpoint 'View Type' must be set to 'Fisheye' or 'Angular Fisheye'.");
            }
            break;

        case 'annual':
            if (!project.epwFileContent) {
                errors.push("An annual analysis requires a weather file. Please upload an .epw file in the Project Setup panel.");
            }
            // Check for BSDF file in any open annual recipe panel
            const annualRecipePanel = document.querySelector('.floating-window[data-template-id*="annual"]');
            if (annualRecipePanel) {
                const bsdfInput = annualRecipePanel.querySelector('input[type="file"][id*="bsdf-file"]');
                const bsdfFileInProject = project.simulationFiles['bsdf-file'];
                if (bsdfInput && !bsdfFileInProject) {
                    warnings.push("The annual simulation recipe panel is open, but no BSDF file has been loaded into the project.");
                }
            }
            break;

        case 'illuminance':
            const sensorParams = getSensorGridParams();
            if (!sensorParams?.illuminance?.enabled) {
                errors.push("An illuminance map requires an active sensor grid. Please enable the 'Illuminance Grid' and select at least one surface in the Sensor Grid panel.");
            }
            break;
    }

    return { success: true, errors, warnings };
}


/**
 * Calls the selected generative AI provider's API, now with tool-use capabilities.
 * @param {string} apiKey - The user's API key.
 * @param {string} provider - The selected provider ('gemini' or 'openrouter').
 * @returns {Promise<string>} The text response from the AI model.
 */
async function callGenerativeAI(apiKey, provider, model, systemPrompt) {
    if (provider !== 'gemini') {
        // For simplicity, this enhanced functionality is demonstrated for the Gemini API.
        // OpenRouter also supports function calling but has a slightly different API structure.
        addMessage('ai', "Sorry, AI-powered actions are only implemented for the Google Gemini provider in this example.");
        throw new Error("Tool use is only implemented for Gemini in this example.");
    }

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const headers = { 'Content-Type': 'application/json' };

    // Initial request payload
    let payload = {
        contents: chatHistory,
        systemInstruction: { parts: [{ text: systemPrompt }] },
        tools: availableTools
    };

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || `API Error: ${response.status}`);
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];

    // Check for safety blocks or invalid responses first
    if (!candidate) {
        const promptFeedback = data.promptFeedback;
        console.warn('Gemini response blocked.', { promptFeedback });
        return `I am unable to answer that. The prompt was blocked, likely due to safety filters (${promptFeedback?.blockReason}).`;
    }
    if (candidate.finishReason === "SAFETY") {
        return "I cannot provide a response due to safety filters. Please try rephrasing your query.";
    }

    const toolCalls = candidate.content?.parts?.filter(part => part.functionCall).map(part => part.functionCall);

    // If the AI wants to use a tool, execute it
    if (toolCalls && toolCalls.length > 0) {
        // Add the model's tool call request to history
        chatHistory.push(candidate.content);
        
        const toolCall = toolCalls[0]; // Handle one tool at a time for simplicity
        const toolResult = await _executeToolCall({ functionCall: toolCall });

        // Add the result of the tool execution to history
        chatHistory.push({
            role: 'tool',
            parts: [{
                functionResponse: {
                    name: toolCall.name,
                    response: {
                        name: toolCall.name,
                        content: toolResult,
                    }
                }
            }]
        });

        // Make a second API call with the tool result to get the final text response
        const secondResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ ...payload, contents: chatHistory }) // Send the updated history
        });
        
        if (!secondResponse.ok) throw new Error(`API Error after tool call: ${secondResponse.status}`);
        
        const secondData = await secondResponse.json();
        const text = secondData.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error('Received an invalid final response from Gemini API after tool call.');
        return text;
    } else {
        // If no tool is called, just return the text response
        const text = candidate.content?.parts?.[0]?.text;
        if (!text) throw new Error('Received an invalid response from Gemini API.');
        return text;
    }
}

/**
 * Toggles the UI state between loading and idle.
 * @param {boolean} isLoading - Whether the app is waiting for an AI response.
 */
function setLoadingState(isLoading) {
    const sendButton = dom['ai-chat-send'];
    const input = dom['ai-chat-input'];
    if (!sendButton || !input) return;

    if (isLoading) {
        sendButton.disabled = true;
        sendButton.innerHTML = '...'; // Simple loading indicator
        input.disabled = true;
    } else {
        sendButton.disabled = false;
        sendButton.innerHTML = 'Send';
        input.disabled = false;
        input.focus();
    }
}

// --- Settings Modal Logic ---

/** Opens the AI settings modal window. */
function openSettingsModal() {
    const modal = dom['ai-settings-modal'];
    if (!modal) return;
    modal.style.zIndex = getNewZIndex();
    modal.classList.replace('hidden', 'flex');
}

/** Closes the AI settings modal window. */
function closeSettingsModal() {
    dom['ai-settings-modal']?.classList.replace('flex', 'hidden');
}

/**
 * Saves the API key and provider to localStorage.
 * @param {Event} event - The form submission event.
 */
function saveSettings(event) {
    event.preventDefault();
    const keyInput = dom['ai-api-key-input'];
    const providerSelect = dom['ai-provider-select'];
    const modelSelect = dom['ai-model-select'];

    localStorage.setItem('ai_api_key', keyInput.value.trim());
    localStorage.setItem('ai_provider', providerSelect.value);
    localStorage.setItem('ai_model', modelSelect.value);

    showAlert('AI settings saved.', 'Success');
    closeSettingsModal();
}

/**
 * Loads the API key and provider from localStorage into the settings form.
 */
function loadSettings() {
    const keyInput = dom['ai-api-key-input'];
    const providerSelect = dom['ai-provider-select'];
    const modelSelect = dom['ai-model-select'];

    if (keyInput) {
        keyInput.value = localStorage.getItem('ai_api_key') || '';
    }

    if (providerSelect && modelSelect) {
        const savedProvider = localStorage.getItem('ai_provider') || 'gemini';
        providerSelect.value = savedProvider;

        // Populate the model dropdown for the saved provider
        updateModelOptions(savedProvider);

        // Show/hide the provider-specific info box
        toggleProviderInfo(savedProvider);

        // Select the saved model, or the first model as a default
        const savedModel = localStorage.getItem('ai_model');
        if (savedModel) {
            modelSelect.value = savedModel;
        } else if (modelsByProvider[savedProvider]?.length > 0) {
            modelSelect.value = modelsByProvider[savedProvider][0].id;
        }
    }
}

/**
 * Triggers a proactive suggestion based on a user action.
 * Bypasses the AI for speed and reliability, using predefined templates.
 * @param {'annual_illuminance_loaded' | 'annual_glare_loaded' | 'view_grid_enabled'} context
 */
export function triggerProactiveSuggestion(context) {
    let suggestionHTML = '';

    switch (context) {
        case 'annual_illuminance_loaded':
            suggestionHTML = `Annual data loaded. Try asking me to <strong data-action="open_results_dashboard">show the sDA & UDI dashboard</strong>, or <strong data-action="show_temporal_map_info">view the temporal map</strong> for a specific point.`;
            break;
        case 'annual_glare_loaded':
            suggestionHTML = `Annual glare data loaded. I can now <strong data-action="open_glare_rose">generate a Glare Rose diagram</strong> to visualize the results.`;
            break;
        case 'view_grid_enabled':
            suggestionHTML = `View Grid enabled. This is required for the <strong data-action="open_recipe:imageless-glare">Imageless Annual Glare</strong> recipe. Would you like to open it?`;
            break;
        case 'epw_loaded':
            suggestionHTML = `EPW file loaded. Ready for annual analysis. Would you like to open the <strong data-action="open_recipe:annual-3ph">Annual Daylight (3-Phase)</strong> recipe?`;
            break;
        case 'daylighting_controls_enabled':
            suggestionHTML = `Daylighting controls enabled. An annual simulation is needed to evaluate performance. Would you like to open the <strong data-action="open_recipe:annual-3ph">Annual Daylight (3-Phase)</strong> recipe?`;
            break;
        case 'bsdf_enabled':
            suggestionHTML = `BSDF file enabled. This is used for advanced multi-phase simulations. Would you like to open the <strong data-action="open_recipe:annual-5ph">Annual Daylight (5-Phase)</strong> recipe?`;
            break;
       case 'task_area_enabled':
            suggestionHTML = `Task Area grid defined. This is required for the <strong data-action="open_recipe:en-illuminance">EN 12464-1 Illuminance</strong> recipe. Would you like to open it?`;
            break;
        case 'ies_file_loaded':
            suggestionHTML = `IES file loaded. You can view the photometric plot in the lighting panel and adjust the light's position and rotation.`;
            break;
        case 'unrealistic_reflectance':
            suggestionHTML = `A material reflectance is outside the typical range (0.1 to 0.85). Unusually high or low values can be physically unrealistic and may increase simulation time.`;
            break;
        case 'louver_shading_enabled':
            suggestionHTML = `Louvers configured. For the most accurate annual analysis of complex shading, consider using the <strong data-action="open_recipe:annual-5ph">5-Phase method</strong>.`;
            break;
        case 'low_ambient_bounces':
            suggestionHTML = `Ambient Bounces (-ab) is set to a low value. This will limit or prevent indirect light calculation, which can lead to unrealistic, dark, or splotchy results.`;
            break;
        case 'dgp_recipe_bad_viewpoint':
            suggestionHTML = `The DGP recipe requires a fisheye view. Would you like to <strong data-action="set_view_fisheye">change the viewpoint to Fisheye</strong> to ensure correct results?`;
            break;
        default:
            return; // No suggestion for this context
    }

    // Dynamically import and call the UI function to display the suggestion
    import('./ui.js').then(({ displayProactiveSuggestion }) => {
        displayProactiveSuggestion(suggestionHTML);
    }).catch(err => console.error("Failed to display proactive suggestion:", err));
}

// Export the initializer function to be called from main.js
export { initAiAssistant };
