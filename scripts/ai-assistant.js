// scripts/ai-assistant.js

import { showAlert, getNewZIndex, togglePanelVisibility, highlightSensorPoint, clearSensorHighlights, clearAllResultsDisplay, getSensorGridParams, setCameraView, scheduleUpdate } from './ui.js';
import { getDom } from './dom.js';
import { loadKnowledgeBase, searchKnowledgeBase } from './knowledgeBase.js';
import { project } from './project.js';
import { resultsManager } from './resultsManager.js';
import { openGlareRoseDiagram, openCombinedAnalysisPanel } from './annualDashboard.js';
import { openRecipePanelByType, programmaticallyGeneratePackage } from './simulation.js';
import { addFurniture, addVegetation } from './geometry.js';
import * as THREE from 'three';

// Module-level cache for DOM elements
let dom;

// State management for tabbed conversations
let conversations = {};
let activeConversationId = null;
let conversationCounter = 0; // Simple incrementing ID for new conversations

// Master mode configuration - combines all previous modes
const MASTER_MODE = {
    name: 'master',
    title: 'Helios AI Assistant',
    description: 'I am Helios, your unified AI assistant. Ask me anything about your project, or click the ℹ️ button to see my full capabilities.',
    placeholder: 'Ex tenebris lux...',
    welcomeMessage: 'Hello! I\'m Helios.' +
                   'You can ask me to create designs, analyze your project, critique results, explore data, or guide you through workflows. ' +
                   'What would you like to work on today?'
};

// Define the tools the AI can use to interact with the application
const availableTools = [
    {
        "functionDeclarations": [
            {
                "name": "placeAsset",
                "description": "Places a 3D asset, such as furniture or vegetation, into the scene at a specific coordinate. The coordinate system's origin (0,0,0) is at the center of the room's floor.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "assetType": { "type": "STRING", "description": "The type of asset to place. Must be one of 'desk', 'chair', 'partition', 'shelf', 'tree-deciduous', 'tree-coniferous', 'bush'." },
                        "x": { "type": "NUMBER", "description": "The X-coordinate for the asset's center (along the room's width)." },
                        "y": { "type": "NUMBER", "description": "The Y-coordinate for the asset's base (height from the floor). Should usually be 0." },
                        "z": { "type": "NUMBER", "description": "The Z-coordinate for the asset's center (along the room's length)." }
                    },
                    "required": ["assetType", "x", "y", "z"]
                }
            },
            {
                "name": "compareMetrics",
                "description": "Compares a specific performance metric between the two loaded datasets (A and B).",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "metric": {
                            "type": "STRING",
                            "description": "The metric to compare. Must be one of 'sDA' (Spatial Daylight Autonomy), 'ASE' (Annual Sunlight Exposure), 'UDI' (Useful Daylight Illuminance), 'averageIlluminance', or 'uniformity'."
                        }
                    },
                    "required": ["metric"]
                }
            },
            {
                "name": "filterAndHighlightPoints",
                "description": "Finds all sensor points in a specified dataset that meet a numerical condition (e.g., illuminance below 300 lux) and highlights them in the 3D view.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "dataset": { "type": "STRING", "description": "The dataset to query. Must be 'a' or 'b'." },
                        "condition": { "type": "STRING", "description": "The comparison operator. Must be one of '<', '>', '<=', '>='." },
                        "value": { "type": "NUMBER", "description": "The numerical value to compare against (e.g., an illuminance value in lux)." }
                    },
                    "required": ["dataset", "condition", "value"]
                }
            },
            {
                "name": "addAperture",
                "description": "Adds one or more windows (apertures) to a specific wall. This action replaces any existing windows on that wall.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "wall": { "type": "STRING", "description": "The wall to add the window to. Must be one of 'north', 'south', 'east', or 'west'." },
                        "count": { "type": "NUMBER", "description": "The number of identical windows to add." },
                        "width": { "type": "NUMBER", "description": "The width of a single window in meters." },
                        "height": { "type": "NUMBER", "description": "The height of a single window in meters." },
                        "sillHeight": { "type": "NUMBER", "description": "The height of the bottom of the window from the floor in meters." }
                    },
                    "required": ["wall", "count", "width", "height", "sillHeight"]
                }
            },
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
                "name": "runGenerativeDesign",
                "description": "Runs an iterative design study to optimize a parameter based on a goal and constraints. For example, 'find the best overhang depth to maximize sDA while keeping ASE below 10%'. This is a long-running process that runs simulations in the background and reports the result when complete.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "goal": { "type": "STRING", "description": "The optimization objective. Must be 'maximize sDA' or 'minimize ASE'." },
                        "variable": { "type": "STRING", "description": "The design parameter to iterate. Currently, only 'overhang depth' is supported." },
                        "targetElement": { "type": "STRING", "description": "The scene element to modify. For 'overhang depth', this must be the wall, e.g., 'south'." },
                        "range": { "type": "ARRAY", "description": "A two-element array with the [min, max] values for the variable in meters." },
                        "steps": { "type": "NUMBER", "description": "The number of simulations to run within the range (e.g., 5)." },
                        "constraints": { "type": "STRING", "description": "The constraint for valid solutions, e.g., 'ASE < 10' or 'sDA >= 60'." }
                },
                "required": ["goal", "variable", "targetElement", "range", "steps", "constraints"]
            }
        },
        {
            "name": "startWalkthrough",
            "description": "Initiates a step-by-step interactive tutorial to guide the user through a specific simulation workflow, such as Daylight Factor (df), Daylight Glare Probability (dgp), or Spatial Daylight Autonomy (sda).",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "topic": {
                        "type": "STRING",
                        "description": "The simulation topic for the walkthrough. Must be one of 'dgp', 'df', or 'sda'."
                    }
                },
                "required": ["topic"]
            }
        },
        {
            "name": "endWalkthrough",
            "description": "Ends the current interactive walkthrough or tutorial mode.",
            "parameters": { "type": "OBJECT", "properties": {} }
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
        },
        {
            "name": "searchKnowledgeBase",
            "description": "Searches the application's built-in help documentation and knowledge base for topics related to a query. Useful for defining terms (e.g., 'What is Daylight Factor?') or explaining concepts.",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "query": { "type": "STRING", "description": "The search term or question to look up in the knowledge base." }
                },
                "required": ["query"]
            }
        },
        {
            "name": "traceSunRays",
            "description": "Configures and runs the Sun Ray Tracing visualization. Sets the date, time, number of rays, and max bounces, then initiates the trace. Requires an EPW file to be loaded.",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "date": { "type": "STRING", "description": "The date for the sun position, formatted as 'Month Day', e.g., 'Jun 21' or 'Dec 21'." },
                    "time": { "type": "STRING", "description": "The 24-hour time for the sun position, formatted as 'HH:MM', e.g., '14:30'." },
                    "rayCount": { "type": "NUMBER", "description": "The total number of sun rays to trace through all glazing. e.g., 200." },
                    "maxBounces": { "type": "NUMBER", "description": "The maximum number of times a ray can bounce inside the room after entering. e.g., 3." }
                },
                "required": ["date", "time", "rayCount", "maxBounces"]
            }
        },
        {
            "name": "toggleSunRayVisibility",
            "description": "Shows or hides the currently displayed sun ray traces in the 3D view.",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "visible": { "type": "BOOLEAN", "description": "Set to true to show the rays, false to hide them." }
                },
                "required": ["visible"]
            }
        },
        {
            "name": "generateReport",
            "description": "Generates and downloads a PDF summary report of the current project state and loaded simulation results.",
            "parameters": { "type": "OBJECT", "properties": {} }
        },
        {
            "name": "toggleDataTable",
            "description": "Shows or hides the interactive data table for the currently loaded results.",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "show": { "type": "BOOLEAN", "description": "Set to true to show the data table, false to hide it." }
                },
                "required": ["show"]
            }
        },
        {
            "name": "filterDataTable",
            "description": "Applies a filter to the interactive data table to show only specific rows. The query should be a simple comparison operator followed by a number.",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "query": { "type": "STRING", "description": "The filter query, e.g., '> 500', '<= 100', '== 0'." }
                },
                "required": ["query"]
            }
        },
        {
            "name": "toggleHdrViewer",
            "description": "Opens or closes the High Dynamic Range (HDR) image viewer, if an HDR result file has been loaded.",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "show": { "type": "BOOLEAN", "description": "Set to true to show the HDR viewer, false to hide it." }
                },
                "required": ["show"]
            }
        },
        {
            "name": "configureHdrViewer",
            "description": "Adjusts the settings of the currently open HDR viewer.",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "exposure": { "type": "NUMBER", "description": "Sets the exposure level (EV). Can be positive or negative." },
                    "falseColor": { "type": "BOOLEAN", "description": "Set to true to enable the false color luminance view, false to disable it." }
                }
            }
        },
        {
            "name": "setTheme",
            "description": "Changes the visual theme of the application.",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "themeName": { "type": "STRING", "description": "The name of the theme to apply. Must be one of: 'light', 'dark', 'cyber', 'cafe58'." }
                },
                "required": ["themeName"]
            }
        },
        {
            "name": "loadProject",
            "description": "Initiates the process to load a previously saved project file by opening the system's file dialog for the user.",
            "parameters": { "type": "OBJECT", "properties": {} }
        },
        {
            "name": "toggleComparisonMode",
            "description": "Enables or disables the comparative analysis mode in the results panel, which allows loading a second dataset.",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "enable": { "type": "BOOLEAN", "description": "Set to true to enable comparison mode, false to disable it." }
                },
                "required": ["enable"]
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
    openrouter: [
        // Google
        { id: 'google/gemini-2.5-flash-lite', name: 'Google Gemini 2.5 Flash Lite' },
        { id: 'google/gemini-2.5-flash', name: 'Google Gemini 2.5 Flash' },
        { id: 'google/gemini-2.5-pro', name: 'Google Gemini 2.5 Pro' },

        // OpenAI
        { id: 'openai/gpt-5', name: 'OpenAI GPT-5' },
        { id: 'openai/gpt-5-mini', name: 'OpenAI GPT-5 Mini' },
        { id: 'openai/gpt-5-nano', name: 'OpenAI GPT-5 Nano' },
        { id: 'openai/gpt-4.1', name: 'OpenAI GPT-4.1' },
        { id: 'openai/gpt-4o', name: 'OpenAI GPT-4o' },
        { id: 'openai/gpt-4o-mini', name: 'OpenAI GPT-4o Mini' },
        // OpenAI Free Models
        { id: 'openai/gpt-oss-120b:free', name: 'OpenAI GPT-OSS 120B (Free)' },
        { id: 'openai/gpt-oss-20b:free', name: 'OpenAI GPT-OSS 20B (Free)' },

        // Anthropic
        { id: 'anthropic/claude-sonnet-4.5', name: 'Anthropic Claude 4.5 Sonnet' },
        { id: 'anthropic/claude-sonnet-4', name: 'Anthropic Claude 4 Sonnet' },
        { id: 'anthropic/claude-3.7-sonnet', name: 'Anthropic Claude 3.7 Sonnet' },
        { id: 'anthropic/claude-3.7-sonnet:thinking', name: 'Anthropic Claude 3.7 Sonnet Thinking' },
        { id: 'anthropic/claude-haiku-4.5', name: 'Anthropic Claude 4.5 Haiku' },
        { id: 'anthropic/claude-3.5-haiku', name: 'Anthropic Claude 3.5 Haiku' },

        // xAI
        { id: 'x-ai/grok-code-fast-1', name: 'xAI Grok Code Fast 1' },
        { id: 'x-ai/grok-4-fast', name: 'xAI Grok 4 Fast' },
        { id: 'x-ai/grok-4', name: 'xAI Grok 4' },

        // Meta
        { id: 'meta-llama/llama-3.1-405b-instruct', name: 'Meta Llama 3.1 405B' },
        { id: 'meta-llama/llama-3.1-70b-instruct', name: 'Meta Llama 3.1 70B' },
        { id: 'meta-llama/llama-3-8b-instruct', name: 'Meta Llama 3 8B Instruct' },

        // NVIDIA
        { id: 'nvidia/nemotron-nano-9b-v2:free', name: 'NVIDIA Nemotron Nano V2 (free)' }, 

        // Mistral
        { id: 'mistralai/mistral-large-2', name: 'Mistral Large 2' },
        { id: 'mistralai/mixtral-8x22b-instruct', name: 'Mistral Mixtral 8x22B Instruct' },

        // DeepSeek
        { id: 'deepseek/deepseek-chat-v3.1:free', name: 'DeepSeek Chat v3.1 (Free)' },
        { id: 'deepseek/deepseek-r1-0528:free', name: 'DeepSeek R1 0528 (Free)' },
        { id: 'qwen/qwen2-72b-instruct', name: 'Qwen 2 72B Instruct' },

        // Other Models
        { id: 'microsoft/wizardlm-2-8x22b', name: 'Microsoft WizardLM-2 8x22B' },

        // Free Models
        { id: 'z-ai/glm-4.5-air:free', name: 'GLM 4.5 Air (Free)' },
        { id: 'qwen/qwen3-coder:free', name: 'Qwen 3 Coder (Free)' },
        { id: 'google/gemma-3n-e2b-it:free', name: 'Google Gemma 3N E2B IT (Free)' },
        { id: 'tngtech/deepseek-r1t2-chimera:free', name: 'DeepSeek R1T2 Chimera (Free)' },
        { id: 'qwen/qwen3-4b:free', name: 'Qwen 3 4B (Free)' },
        { id: 'meta-llama/llama-4-maverick:free', name: 'Meta Llama 4 Maverick (Free)' },
        { id: 'moonshotai/kimi-k2:free', name: 'MoonshotAI Kimi K2 0711 (Free)' },
    ],
    openai: [
        { id: 'gpt-4o', name: 'GPT-4o' },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
        { id: 'gpt-5', name: 'GPT-5' },
        { id: 'gpt-5-mini', name: 'GPT-5 Mini' },
        { id: 'gpt-5-nano', name: 'GPT-5 Nano' }
    ],
    gemini: [
        { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
        { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
    ],
    anthropic: [
        { id: 'claude-sonnet-4-5-20250929', name: 'Claude 4.5 Sonnet' },
        { id: 'claude-sonnet-4-20250514', name: 'Claude 4 Sonnet' },
        { id: 'claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet' },
        { id: 'claude-haiku-4-5-20251001', name: 'Claude 4.5 Haiku' },
        { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' }
    ]
};

/**
Initializes the AI Assistant, setting up all necessary event listeners.
*/
function initAiAssistant() {
    dom = getDom(); // Cache the dom object from ui.js

    // Exit if the main button doesn't exist in the HTML
    if (!dom['ai-assistant-button']) {
    console.warn('AI Assistant button not found, feature disabled.');
    return;
    }

    dom['ai-chat-form']?.addEventListener('submit', handleSendMessage);
    dom['ai-settings-btn']?.addEventListener('click', openSettingsModal);
    dom['ai-settings-close-btn']?.addEventListener('click', closeSettingsModal);
    dom['ai-settings-form']?.addEventListener('submit', saveSettings);
    dom['ai-info-btn']?.addEventListener('click', openCapabilitiesModal);
    dom['helios-capabilities-close-btn']?.addEventListener('click', closeCapabilitiesModal);



    dom['ai-provider-select']?.addEventListener('change', (e) => {
    const provider = e.target.value;
    updateModelOptions(provider);
    toggleProviderInfo(provider);
    updateApiKeyInput(provider);
    });

    // Add auto-resizing functionality to the chat input
    dom['ai-chat-input']?.addEventListener('input', () => {
        const input = dom['ai-chat-input'];
        input.style.height = 'auto';
        input.style.height = `${input.scrollHeight}px`;
    });

    dom['run-inspector-btn']?.addEventListener('click', handleRunInspector);
    dom['ai-inspector-results']?.addEventListener('click', handleInspectorActionClick);

    dom['run-critique-btn']?.addEventListener('click', handleRunCritique);
    dom['ai-critique-results']?.addEventListener('click', handleCritiqueActionClick);

    loadSettings();
    loadKnowledgeBase();

    // Start with a default master mode conversation
    createNewConversation();
}

// --- START: Tabbed Conversation Management ---

/**
* Creates a new conversation using the master mode, adds it to the state, and makes it active.
* @param {string} conversationName - Optional name for the conversation tab.
*/
function createNewConversation(conversationName = null) {
    // Check if we're at the total tab limit.
    if (Object.keys(conversations).length >= 6) {
        showAlert("You can have a maximum of 6 active conversations.", "Tab Limit Reached");
        return;
    }

    // Proceed with creating a new conversation
    conversationCounter++;
    const newId = `conv-${conversationCounter}`;
    const tabTitle = conversationName || `Chat ${conversationCounter}`;

    conversations[newId] = {
        id: newId,
        mode: MASTER_MODE.name,
        title: tabTitle,
        history: [],
        isActive: false // Will be set to true by switchConversation
    };

    // Add master mode welcome message
    conversations[newId].history.push({
        role: 'model',
        parts: [{ text: MASTER_MODE.welcomeMessage }]
    });

    switchConversation(newId);
}


/**
Switches the active conversation and re-renders the UI.
* @param {string} conversationId - The ID of the conversation to activate.
*/
function switchConversation(conversationId) {
    if (!conversations[conversationId]) return;

    activeConversationId = conversationId;

    // Update active status for all conversations
    for (const id in conversations) {
    conversations[id].isActive = (id === conversationId);
    }

    renderTabs();
    renderActiveConversation();
}

/**
* Closes a conversation, removes its tab, and switches to another conversation.
* @param {Event} event - The click event from the close button.
* @param {string} conversationId - The ID of the conversation to close.
*/
function closeConversation(event, conversationId) {
    event.stopPropagation(); // Prevent the tab click from firing

    delete conversations[conversationId];

    // If we closed the active tab, we need to activate a new one
    if (activeConversationId === conversationId) {
    const remainingIds = Object.keys(conversations);
    if (remainingIds.length > 0) {
    
    // Switch to the last remaining conversation
    switchConversation(remainingIds[remainingIds.length - 1]);
    } else {
    
    // If no tabs are left, create a new default chat
    createNewConversation('chat');
    }
    } else {
    
    // If we closed an inactive tab, just re-render the tabs
    renderTabs();
    }
}

/**
* Renders the tab UI based on the current conversations state.
*/
function renderTabs() {
    const tabsContainer = dom['ai-chat-tabs'];
    
    if (!tabsContainer) return;
    tabsContainer.innerHTML = '';

    Object.values(conversations).forEach(conv => {
    const tab = document.createElement('button');
    tab.className = 'ai-chat-tab';
    tab.textContent = conv.title;
    if (conv.isActive) {
    tab.classList.add('active');
    }
    
    tab.onclick = () => switchConversation(conv.id);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'ai-tab-close-btn';
    closeBtn.innerHTML = '&times;';
    closeBtn.ariaLabel = `Close ${conv.title}`;
    closeBtn.onclick = (e) => closeConversation(e, conv.id);

    tab.appendChild(closeBtn);
    tabsContainer.appendChild(tab);
    });
}

/**
* Renders the content for the currently active conversation.
* In master mode, always show the chat interface since all functionality is unified.
*/
function renderActiveConversation() {
    const conv = conversations[activeConversationId];
    if (!conv) {
        // Handle case where there are no conversations. Check for element existence.
        if (dom['ai-chat-messages']) {
            dom['ai-chat-messages'].innerHTML = '';
        }
        updateModeDescription('master');
        return;
    }

    // In master mode, always show the chat interface
    // Hide inspector/critique specific UI elements since they're handled through chat
    dom['ai-chat-messages']?.classList.remove('hidden');
    dom['ai-chat-form']?.classList.remove('hidden');
    dom['ai-inspector-results']?.classList.add('hidden');
    dom['run-inspector-btn']?.classList.add('hidden');
    dom['ai-critique-results']?.classList.add('hidden');
    dom['run-critique-btn']?.classList.add('hidden');

    updateModeDescription('master');

    // Render chat history
    const messagesContainer = dom['ai-chat-messages'];
    if (messagesContainer) {
        messagesContainer.innerHTML = '';
        conv.history.forEach(msg => {
            const sender = msg.role === 'model' ? 'ai' : 'user';
            addMessageToDOM(sender, msg.parts[0].text, messagesContainer);
        });
    }

    if (dom['ai-chat-input']) {
        dom['ai-chat-input'].placeholder = MASTER_MODE.placeholder;
        dom['ai-chat-input'].focus();
    }
}

/**
* Gets the appropriate placeholder text for the chat input based on the mode.
* @param {string} mode
* @returns {string}
*/
function getPlaceholderText(mode) {
    switch (mode) {
        case 'generate': return 'e.g., A 10m x 8m office with 2 south windows...';
        case 'tutor': return "e.g., 'Teach me about glare analysis'";
        default: return 'Ask about Radiance or this app...';
    }
}

/**
* Updates the description box to show the master mode capabilities.
* @param {string} mode - The mode (should always be 'master' now).
*/
function updateModeDescription(mode) {
    const descriptionText = dom['ai-mode-description-text'];
    if (descriptionText) {
        descriptionText.innerHTML = MASTER_MODE.description;
    }
}

/**
 * Updates the API key input field when the provider is changed.
 * @param {string} provider The selected AI provider.
 */
function updateApiKeyInput(provider) {
    const keyInput = dom['ai-api-key-input'];
    if (keyInput) {
        const storageKey = `ai_api_key_${provider}`;
        keyInput.value = localStorage.getItem(storageKey) || '';
    }
}async function handleRunInspector() {
    const resultsContainer = dom['ai-inspector-results'];
    if (!resultsContainer) return;

    resultsContainer.innerHTML = '<div class="text-center p-4">🔍 Consulting AI expert for project analysis...</div>';
    setLoadingState(true);

    try {
        const findings = await performAIInspection();
        displayInspectorResults(findings);
    } catch (error) {
        console.error("AI Design Inspector failed:", error);
        resultsContainer.innerHTML = `<div class="p-4 text-red-500">An error occurred during AI inspection: ${error.message}</div>`;
        showAlert(`AI Inspector failed: ${error.message}`, 'Error');
    } finally {
        setLoadingState(false);
    }
}

async function handleRunCritique() {
    const resultsContainer = dom['ai-critique-results'];
    if (!resultsContainer) return;

    // Check if results are loaded
    if (!resultsManager.getActiveData() || resultsManager.getActiveData().length === 0) {
        showAlert("Please load a simulation results file before running the critique.", "No Results Loaded");
        return;
    }

    resultsContainer.innerHTML = '<div class="text-center p-4">🔍 AI is analyzing your simulation results...</div>';
    setLoadingState(true);

    try {
        const findings = await _performAICritique();
        displayCritiqueResults(findings);
    } catch (error) {
        console.error("AI Results Critique failed:", error);
        resultsContainer.innerHTML = `<div class="p-4 text-red-500">An error occurred during AI critique: ${error.message}</div>`;
        showAlert(`AI Critique failed: ${error.message}`, 'Error');
    } finally {
        setLoadingState(false);
    }
}

/**
 * Renders the findings from the inspector into the UI.
 * @param {object} findings - An object with arrays for errors, warnings, and suggestions.
 */
function displayInspectorResults(findings) {
    const container = dom['ai-inspector-results'];
    container.innerHTML = ''; // Clear previous results

    if (findings.errors.length === 0 && findings.warnings.length === 0 && findings.suggestions.length === 0) {
        container.innerHTML = `
            <div class="inspector-finding type-success">
                <div class="finding-icon">✅</div>
                <div class="finding-content">
                    <p class="finding-message"><strong>All Clear!</strong> No immediate issues found in your project setup.</p>
                </div>
            </div>`;
        return;
    }

    const createFindingElement = (finding, type) => {
        const el = document.createElement('div');
        el.className = `inspector-finding type-${type}`;

        const icons = {
            error: '❌',
            warning: '⚠️',
            suggestion: '💡'
        };

        let actionButton = '';
        if (finding.action) {
        // Encode params as a JSON string. Use single quotes for the attribute to contain the double-quoted JSON string.
        const paramsJson = JSON.stringify(finding.params || {});
        actionButton = `<button class="btn btn-xs btn-secondary finding-action-btn" data-action="${finding.action}" data-params='${paramsJson}'>${finding.actionLabel || 'Fix It'}</button>`;
        }

        el.innerHTML = `
            <div class="finding-icon">${icons[type]}</div>
            <div class="finding-content">
                <p class="finding-message">${finding.message}</p>
                ${actionButton}
            </div>
        `;
        return el;
    };

    findings.errors.forEach(f => container.appendChild(createFindingElement(f, 'error')));
    findings.warnings.forEach(f => container.appendChild(createFindingElement(f, 'warning')));
    findings.suggestions.forEach(f => container.appendChild(createFindingElement(f, 'suggestion')));
}

/**
* Renders the findings from the critique into the UI.
* @param {object} critique - An object with an array of findings.
*/
function displayCritiqueResults(critique) {
  const container = dom['ai-critique-results'];
  container.innerHTML = ''; // Clear previous results

  if (critique.findings.length === 0) {
      container.innerHTML = `
          <div class="inspector-finding type-success">
              <div class="finding-icon">✅</div>
              <div class="finding-content">
                  <p class="finding-message"><strong>Analysis Complete!</strong> The AI found no immediate issues or suggestions based on the current results.</p>
              </div>
          </div>`;
      return;
  }

  const createFindingElement = (finding) => {
      const el = document.createElement('div');
      // Reuse the inspector's styling by mapping critique types
      const typeClass = finding.type === 'positive' ? 'success' : 'critique';
      el.className = `inspector-finding type-${typeClass}`;

      const icons = {
          critique: '🧐',
          suggestion: '💡',
          positive: '✅'
      };

      let actionButton = '';
      if (finding.action) {
          const paramsJson = JSON.stringify(finding.params || {});
          actionButton = `<button class="btn btn-xs btn-secondary finding-action-btn" data-action="${finding.action}" data-params='${paramsJson}'>${finding.actionLabel || 'Apply Fix'}</button>`;
      }

      el.innerHTML = `
          <div class="finding-icon">${icons[finding.type] || '🧐'}</div>
          <div class="finding-content">
              <p class="finding-message">${finding.message}</p>
              ${actionButton}
          </div>
      `;
      return el;
  };

  critique.findings.forEach(f => container.appendChild(createFindingElement(f)));
}

/**
* Handles clicks on action buttons within the critique results.
* @param {MouseEvent} event 
*/
async function handleCritiqueActionClick(event) {
  const button = event.target.closest('.finding-action-btn');
  if (!button) return;

  const action = button.dataset.action;
  const params = JSON.parse(button.dataset.params);

  console.log(`Critique action clicked: ${action}`, params);

  try {
      const result = await _executeToolCall({ functionCall: { name: action, args: params } });
      if (result.success) {
          showAlert(result.message, 'Action Complete');
      } else {
          throw new Error(result.message);
      }
      
  } catch (error) {
      console.error(`Failed to execute critique action '${action}':`, error);
      showAlert(`Action failed: ${error.message}`, 'Error');
  }
}

/**
 * Handles clicks on action buttons within the inspector results.
 * @param {MouseEvent} event 
 */
async function handleInspectorActionClick(event) {
  const button = event.target.closest('.finding-action-btn');
  if (!button) return;

  const action = button.dataset.action;
  const params = JSON.parse(button.dataset.params);

  console.log(`Inspector action clicked: ${action}`, params);

  try {
      // REFACTORED: Use the central tool execution function
      const result = await _executeToolCall({ functionCall: { name: action, args: params } });
      if (result.success) {
          showAlert(result.message, 'Action Complete');
      } else {
          throw new Error(result.message);
      }

      await handleRunInspector(); // Re-run to confirm the fix

  } catch (error) {
      console.error(`Failed to execute inspector action '${action}':`, error);
      showAlert(`Action failed: ${error.message}`, 'Error');
  }
}

/**
 * Populates the model selection dropdown based on the chosen provider.
 * @param {string} provider - The selected AI provider ('gemini' or 'openrouter').
 */
function updateModelOptions(provider) {
    const modelSelect = dom['ai-model-select'];
    if (!modelSelect) return;

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

    infoBox.classList.toggle('hidden', provider !== 'openrouter');
}

/**
 * Adds a message to the active conversation history and the DOM.
 * @param {'user' | 'ai'} sender - Who sent the message.
 * @param {string} text - The content of the message.
 */
function addMessage(sender, text) {
    const conv = conversations[activeConversationId];
    if (!conv) return;

    const messagesContainer = dom['ai-chat-messages'];
    if (!messagesContainer) return;
    
    // Add to history object
    const role = sender === 'ai' ? 'model' : 'user';
    conv.history.push({ role: role, parts: [{ text: text }] });
    
    // Keep history from getting too long
    if (conv.history.length > 30) {
        conv.history.splice(0, conv.history.length - 30);
    }

    // Add to the DOM
    const messageWrapper = addMessageToDOM(sender, text, messagesContainer);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    return messageWrapper;
}

/**
 * Creates and appends a message element to the DOM. (Helper for rendering)
 * @param {string} sender - 'user' or 'ai'.
 * @param {string} text - The message content.
 * @param {HTMLElement} container - The container to append to.
 * @returns {HTMLElement} The created message wrapper element.
 */
function addMessageToDOM(sender, text, container) {
    const messageWrapper = document.createElement('div');
    messageWrapper.className = `chat-message ${sender}-message`;

    const messageBubble = document.createElement('div');
    messageBubble.className = 'message-bubble';

    // Convert markdown code blocks to pre tags
    text = text.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    messageBubble.innerHTML = text;

    messageWrapper.appendChild(messageBubble);
    container.appendChild(messageWrapper);
    return messageWrapper;
}

/**
 * Creates a comprehensive system prompt that includes all capabilities from all previous modes.
 * @param {string} userMessage - The user's message to provide context.
 * @returns {Promise<string>} The complete system prompt.
 * @private
 */
async function _createContextualSystemPrompt(userMessage) {
    try {
        const projectData = await project.gatherAllProjectData();
        const dataForPrompt = JSON.parse(JSON.stringify(projectData));
        dataForPrompt.epwFileContent = dataForPrompt.epwFileContent ? `[Loaded: ${dataForPrompt.projectInfo.epwFileName}]` : null;
        if (dataForPrompt.simulationFiles) {
            Object.values(dataForPrompt.simulationFiles).forEach(file => {
                if (file && file.content) file.content = `[Content Loaded for ${file.name}]`;
            });
        }

        const resultsData = {
            datasetA: resultsManager.datasets.a ? {
                fileName: resultsManager.datasets.a.fileName,
                stats: resultsManager.datasets.a.stats,
                glareResult: !!resultsManager.datasets.a.glareResult,
                isAnnual: resultsManager.hasAnnualData('a')
            } : null,
            datasetB: resultsManager.datasets.b ? {
                fileName: resultsManager.datasets.b.fileName,
                stats: resultsManager.datasets.b.stats,
                glareResult: !!resultsManager.datasets.b.glareResult,
                isAnnual: resultsManager.hasAnnualData('b')
            } : null
        };

        const appState = { projectConfiguration: dataForPrompt, loadedResultsSummary: resultsData };
        const appStateJSON = JSON.stringify(appState, null, 2);

        const systemPrompt = `You are Ray Modeler's Master AI Assistant - a comprehensive, unified assistant that combines all capabilities in one interface. You have access to extensive tools and can help users with any aspect of their daylighting simulation project.

## Your Core Capabilities

### 💬 General Chat & Help
- Answer questions about Radiance and daylighting concepts
- Provide guidance on simulation best practices
- Help troubleshoot issues and explain results
- Offer suggestions for improving simulation accuracy

### 🎨 Generative Design
- Create complete scenes from natural language descriptions
- Place furniture, vegetation, and other assets
- Configure complex shading systems and apertures
- Set material properties and lighting systems

### 🔍 Design Inspector
- Analyze project configurations for potential issues
- Check for conflicting settings or unrealistic parameters
- Identify best practice violations
- Suggest specific fixes for common problems

### 📊 Results Critique
- Analyze loaded simulation results
- Identify performance issues (high glare, low daylight, poor uniformity)
- Correlate problems with project configuration
- Suggest actionable design improvements

### 🗂️ Data Explorer
- Query loaded datasets using natural language
- Compare metrics between datasets
- Filter and highlight points based on conditions
- Generate statistical summaries and insights

### 👨‍🏫 Interactive Tutor
- Provide step-by-step guidance through complex workflows
- Teach users about specific simulation methods
- Walk through recipe configuration and execution

## How You Work

1. **Tool-First Approach**: When users ask you to do something specific, use the available tools to execute actions directly rather than just explaining.

2. **Context Awareness**: You have access to the current project state and loaded results. Use this information to provide relevant, specific guidance.

3. **Proactive Assistance**: Look for opportunities to be helpful beyond the immediate question. If you notice potential issues or improvements, mention them.

4. **Educational Style**: When appropriate, explain not just what you're doing, but why, to help users learn.

## Available Tools

You have access to ${availableTools[0].functionDeclarations.length} different tools that allow you to:
- Manipulate the 3D scene (place assets, set dimensions, configure materials)
- Control the user interface (open panels, change views, toggle settings)
- Run simulations and manage results
- Query and analyze data
- Generate reports and export data

## Response Guidelines

- **Be Direct**: Users can ask you to do anything, and you'll use the appropriate tools automatically
- **Show Your Work**: When using tools, explain what you're doing and why
- **Be Comprehensive**: Consider the full context of the user's project
- **Offer Next Steps**: Suggest logical follow-up actions when appropriate

## Current Context

Project State: ${appStateJSON}

User Message: "${userMessage}"

Based on the user's request and the current project context, determine the best way to help them. This might involve:
- Using tools to make changes to their scene
- Running analysis on their project configuration
- Querying their results data
- Providing educational guidance
- Opening relevant UI panels
- Any combination of the above

Always prioritize being helpful and using your tools to take direct action when requested.`;

        return systemPrompt;

    } catch (error) {
        console.error("Failed to create contextual system prompt:", error);
        // Fallback to a basic system prompt
        return `You are Ray Modeler's Master AI Assistant with comprehensive capabilities for daylighting simulation.

## Your Capabilities:
- **Scene Design**: Create and modify 3D scenes using natural language
- **Project Analysis**: Inspect configurations and identify issues
- **Results Analysis**: Critique simulation results and suggest improvements
- **Data Exploration**: Query and compare loaded datasets
- **Educational Guidance**: Provide step-by-step workflow guidance
- **Direct Action**: Use tools to manipulate the scene, run simulations, and control the UI

## Current Context:
User Message: "${userMessage}"

Please help the user with their request using any of your available capabilities.`;
    }
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
        const provider = localStorage.getItem('ai_provider');
        const apiKey = localStorage.getItem(`ai_api_key_${provider}`);
        let model = localStorage.getItem('ai_model');
        const customModel = localStorage.getItem('ai_custom_model');

        // Use custom model if provided, otherwise use selected model
        if (customModel && customModel.trim()) {
            model = customModel.trim();
        }

        if (!apiKey || !provider || !model) {
        const errorMessage = 'AI settings are incomplete. Please configure the provider, model, and API key in settings.';
        showAlert(errorMessage, 'Configuration Needed');
        addMessage('ai', errorMessage);
        setLoadingState(false);
            return;
        }

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
const _updateUI = (elementId, value, property = 'value', parentElement = null) => {
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

async function _handleSceneTool(name, args) {
    switch (name) {
        case 'addAperture': {
            const wallDir = args.wall?.charAt(0).toLowerCase();
            if (!['n', 's', 'e', 'w'].includes(wallDir)) throw new Error(`Invalid wall: ${args.wall}`);
            _updateUI(`aperture-${wallDir}-toggle`, true, 'checked');
            const manualModeBtn = document.getElementById(`mode-manual-btn-${wallDir}`);
            if (manualModeBtn) manualModeBtn.click();
            _updateUI(`win-count-${wallDir}`, args.count);
            _updateUI(`win-width-${wallDir}`, args.width);
            _updateUI(`win-height-${wallDir}`, args.height);
            _updateUI(`sill-height-${wallDir}`, args.sillHeight);
            return { success: true, message: `Added ${args.count} window(s) to the ${args.wall} wall.` };
        }
        case 'placeAsset': {
            const position = new THREE.Vector3(args.x, args.y, args.z);
            const vegetationTypes = ['tree-deciduous', 'tree-coniferous', 'bush'];
            let newAsset;
            if (vegetationTypes.includes(args.assetType)) {
                newAsset = addVegetation(args.assetType, position, false);
            } else {
                newAsset = addFurniture(args.assetType, position, false);
            }
            if (newAsset) return { success: true, message: `Placed a ${args.assetType} at (${args.x}, ${args.y}, ${args.z}).` };
            throw new Error(`Could not create an asset of type '${args.assetType}'.`);
        }
        case 'setDimension': {
            if (!['width', 'length', 'height'].includes(args.dimension)) throw new Error(`Invalid dimension: ${args.dimension}`);
            _updateUI(args.dimension, args.value);
            return { success: true, message: `Set ${args.dimension} to ${args.value}m.` };
        }
        case 'configureShading': {
            const wallDir = args.wall?.charAt(0).toLowerCase();
            if (!['n', 's', 'e', 'w'].includes(wallDir)) throw new Error(`Invalid wall: ${args.wall}`);
            if (args.enable !== undefined) _updateUI(`shading-${wallDir}-toggle`, args.enable, 'checked');
            if (args.deviceType) _updateUI(`shading-type-${wallDir}`, args.deviceType);
            if (args.depth !== undefined) _updateUI(`overhang-depth-${wallDir}`, args.depth);
            if (args.tilt !== undefined) _updateUI(`overhang-tilt-${wallDir}`, args.tilt);
            return { success: true, message: `Configured shading for ${args.wall} wall.` };
        }
        case 'setSensorGrid': {
            const surfaceMap = { 'floor': 'floor', 'ceiling': 'ceiling', 'walls': 'wall' };
            const surfaceKey = surfaceMap[args.surface];
            if (!surfaceKey) throw new Error(`Invalid surface: ${args.surface}`);
            if (surfaceKey === 'wall') {
                ['north', 'south', 'east', 'west'].forEach(dir => _updateUI(`grid-${dir}-toggle`, args.enable, 'checked'));
            } else if (args.enable !== undefined) {
                _updateUI(`grid-${surfaceKey}-toggle`, args.enable, 'checked');
            }
            if (args.spacing !== undefined) _updateUI(`${surfaceKey}-grid-spacing`, args.spacing);
            if (args.offset !== undefined) _updateUI(`${surfaceKey}-grid-offset`, args.offset);
            return { success: true, message: `Configured sensor grid for ${args.surface}.` };
        }
        case 'setMaterialProperty': {
            const propMap = { reflectance: 'refl', specularity: 'spec', roughness: 'rough', transmittance: 'trans' };
            const validSurfaces = ['wall', 'floor', 'ceiling', 'frame', 'shading', 'glazing'];
            if (!validSurfaces.includes(args.surface)) throw new Error(`Invalid surface: '${args.surface}'.`);
            if (!Object.keys(propMap).includes(args.property)) throw new Error(`Invalid property: '${args.property}'.`);
            if (args.property === 'transmittance' && args.surface !== 'glazing') throw new Error("The 'transmittance' property can only be set for the 'glazing' surface.");
            if (args.property !== 'transmittance' && args.surface === 'glazing') throw new Error("The 'glazing' surface only accepts the 'transmittance' property.");
            const elementId = `${args.surface}-${propMap[args.property]}`;
            const clampedValue = Math.max(0, Math.min(1, args.value));
            if (_updateUI(elementId, clampedValue)) {
                return { success: true, message: `Set ${args.surface} ${args.property} to ${clampedValue.toFixed(2)}.` };
            }
            throw new Error(`Could not find the UI control for ${args.surface} ${args.property} (ID: ${elementId}).`);
        }
        case 'traceSunRays': {
            const traceSection = dom['sun-ray-trace-section'];
            if (!traceSection) throw new Error("The Sun Ray Tracing panel doesn't appear to be available.");
            if (traceSection.classList.contains('hidden')) {
                const activeToggle = document.querySelector('input[id^="sun-ray-tracing-toggle-"]:checked');
                if (!activeToggle) dom['sun-ray-tracing-toggle-s']?.click();
            }
            _updateUI('sun-ray-date', args.date);
            _updateUI('sun-ray-time', args.time);
            _updateUI('sun-ray-count', args.rayCount);
            _updateUI('sun-ray-bounces', args.maxBounces);
            setTimeout(() => dom['trace-sun-rays-btn']?.click(), 100);
            return { success: true, message: `Initiating sun ray trace for ${args.date} at ${args.time}.` };
        }
        case 'toggleSunRayVisibility': {
            const toggle = dom['sun-rays-visibility-toggle'];
            if (!toggle) throw new Error("Sun ray visibility toggle not found.");
            toggle.checked = args.visible;
            toggle.dispatchEvent(new Event('change', { bubbles: true }));
            return { success: true, message: `Sun ray traces are now ${args.visible ? 'visible' : 'hidden'}.` };
        }
        default:
            throw new Error(`Unknown scene tool: ${name}`);
    }
}

async function _handleViewTool(name, args) {
    switch (name) {
        case 'changeView': {
            
            const viewMap = { 'perspective': 'persp', 'top': 'top', 'front': 'front', 'back': 'back', 'left': 'left', 'right': 'right' };
            if (!viewMap[args.view]) throw new Error(`Invalid view: ${args.view}`);
            setCameraView(viewMap[args.view]);
            return { success: true, message: `Changed view to ${args.view}.` };
        }
        case 'setViewpointPosition': {
            _updateUI('view-pos-x', args.x);
            _updateUI('view-pos-y', args.y);
            _updateUI('view-pos-z', args.z);
            return { success: true, message: `Viewpoint moved to [${args.x}, ${args.y}, ${args.z}].` };
        }
        default:
            throw new Error(`Unknown view tool: ${name}`);
    }
}

async function _handleResultsTool(name, args) {
    switch (name) {
        case 'compareMetrics': {
            if (!resultsManager.datasets.a?.stats || !resultsManager.datasets.b?.stats) throw new Error("Both dataset A and dataset B must be loaded to compare.");
            let resultA, resultB;
            const metric = args.metric;
            if (['sDA', 'ASE', 'UDI'].includes(metric)) {
                if (!resultsManager.hasAnnualData('a') || !resultsManager.hasAnnualData('b')) throw new Error(`Annual data must be loaded for both datasets to compare ${metric}.`);
                const metricsA = resultsManager.calculateAnnualMetrics('a', {});
                const metricsB = resultsManager.calculateAnnualMetrics('b', {});
                resultA = metric === 'UDI' ? metricsA.UDI.autonomous : metricsA[metric];
                resultB = metric === 'UDI' ? metricsB.UDI.autonomous : metricsB[metric];
            } else if (metric === 'averageIlluminance') {
                resultA = resultsManager.datasets.a.stats.avg;
                resultB = resultsManager.datasets.b.stats.avg;
            } else if (metric === 'uniformity') {
                const statsA = resultsManager.datasets.a.stats;
                const statsB = resultsManager.datasets.b.stats;
                resultA = statsA.avg > 0 ? statsA.min / statsA.avg : 0;
                resultB = statsB.avg > 0 ? statsB.min / statsB.avg : 0;
            } else {
                throw new Error(`Unsupported metric for comparison: ${metric}`);
            }
            const winner = resultA > resultB ? 'a' : (resultB > resultA ? 'b' : 'tie');
            const comparison = { metric, datasetA_value: resultA, datasetB_value: resultB, winner, summary: `For ${metric}, Dataset A scored ${resultA.toFixed(2)} and Dataset B scored ${resultB.toFixed(2)}. Dataset ${winner.toUpperCase()} performed better.` };
            return { success: true, comparison, message: `Comparison for ${metric} complete.` };
        }
        case 'filterAndHighlightPoints': {
            const { dataset, condition, value } = args;
            const key = dataset.toLowerCase();
            if (!['a', 'b'].includes(key)) throw new Error("Dataset must be 'a' or 'b'.");
            if (!resultsManager.datasets[key]?.data?.length) throw new Error(`Dataset ${key.toUpperCase()} has no data loaded.`);
            const indices = resultsManager.getPointIndicesByCondition(key, condition, value);
            if (indices.length === 0) return { success: true, message: `No points in Dataset ${key.toUpperCase()} met the condition.` };
            const { highlightPointsByIndices } = await import('./ui.js');
            highlightPointsByIndices(indices);
            return { success: true, message: `Highlighted ${indices.length} sensor point(s) in Dataset ${key.toUpperCase()} where the value is ${condition} ${value}.` };
        }
        case 'highlightResultPoint': {
            if (!resultsManager.getActiveData()?.length) throw new Error("No results data is loaded to highlight.");
            if (args.type === 'clear') {
                clearSensorHighlights();
                return { success: true, message: `Cleared all highlights from the sensor grid.` };
            }
            if (['min', 'max'].includes(args.type)) {
                highlightSensorPoint(args.type);
                return { success: true, message: `Highlighted the sensor point(s) with the ${args.type} value.` };
            }
            throw new Error(`Invalid highlight type: ${args.type}. Must be 'min', 'max', or 'clear'.`);
        }
        case 'displayResultsForTime': {
            if (!resultsManager.hasAnnualData('a') && !resultsManager.hasAnnualData('b')) throw new Error("No annual simulation results are loaded.");
            const timeScrubber = dom['time-scrubber'];
            if (!timeScrubber) throw new Error("The annual time-series explorer panel does not appear to be open.");
            const hour = Math.max(0, Math.min(8759, args.hour));
            timeScrubber.value = hour;
            timeScrubber.dispatchEvent(new Event('input', { bubbles: true }));
            return { success: true, message: `3D view updated to show illuminance at hour ${hour}.` };
        }
        case 'queryResultsData': {
            const data = resultsManager.getActiveData();
            const stats = resultsManager.getActiveStats();
            if (!data?.length || !stats) throw new Error("No results data is loaded to query.");
            switch (args.queryType) {
                case 'average': return { success: true, result: stats.avg, query: 'average' };
                case 'min': return { success: true, result: stats.min, query: 'minimum' };
                case 'max': return { success: true, result: stats.max, query: 'maximum' };
                case 'countBelow':
                    if (args.threshold === undefined) throw new Error("A 'threshold' is required for 'countBelow' query.");
                    return { success: true, result: data.filter(v => v < args.threshold).length, query: `count of points below ${args.threshold} lux` };
                case 'countAbove':
                    if (args.threshold === undefined) throw new Error("A 'threshold' is required for 'countAbove' query.");
                    return { success: true, result: data.filter(v => v > args.threshold).length, query: `count of points above ${args.threshold} lux` };
                default: throw new Error(`Invalid queryType: ${args.queryType}`);
            }
        }
        case 'getDatasetStatistics': {
            const datasetKey = args.dataset.toLowerCase();
            if (!['a', 'b'].includes(datasetKey)) throw new Error("Invalid dataset specified. Must be 'a' or 'b'.");
            const stats = resultsManager.datasets[datasetKey]?.stats;
            if (!stats) throw new Error(`Dataset ${datasetKey.toUpperCase()} is not loaded or has no statistics.`);
            return { success: true, stats: stats };
        }
        case 'showAnalysisDashboard': {
            if (args.dashboardType === 'glareRose') {
                openGlareRoseDiagram();
                return { success: true, message: `Opening the Glare Rose diagram.` };
            } else if (args.dashboardType === 'combinedAnalysis') {
                await openCombinedAnalysisPanel();
                return { success: true, message: `Opening the Combined Daylight & Glare analysis.` };
            }
            throw new Error(`Unknown dashboard type: ${args.dashboardType}`);
        }
        case 'loadResultsFile': {
            const datasetKey = args.dataset.toLowerCase();
            if (!['a', 'b'].includes(datasetKey)) throw new Error("Invalid dataset specified. Must be 'a' or 'b'.");
            const fileInput = dom[`results-file-input-${datasetKey}`];
            if (!fileInput) throw new Error(`Could not find the file input for dataset ${datasetKey}.`);
            fileInput.click();
            return { success: true, message: `Opening file dialog for dataset ${datasetKey.toUpperCase()}.` };
        }
        case 'clearResults': {
            resultsManager.clearDataset('a');
            resultsManager.clearDataset('b');
            clearAllResultsDisplay();
            return { success: true, message: "All results data and visualizations have been cleared." };
        }
        default:
            throw new Error(`Unknown results tool: ${name}`);
    }
}



async function _handleSimulationTool(name, args) {
    switch (name) {
        case 'openSimulationRecipe': {
            const templateId = recipeMap[args.recipeType];
            if (!templateId) throw new Error(`Unknown recipe type: ${args.recipeType}`);
            if (args.recipeType === 'dgp' && dom['view-type']?.value !== 'h' && dom['view-type']?.value !== 'a') {
                triggerProactiveSuggestion('dgp_recipe_bad_viewpoint');
            }
            const panel = openRecipePanelByType(templateId);
            if (panel) return { success: true, message: `Opened the ${args.recipeType} recipe panel.` };
            throw new Error(`Could not open the ${args.recipeType} recipe panel.`);
        }
        case 'configureSimulationRecipe': {
            const templateId = recipeMap[args.recipeType];
            if (!templateId) throw new Error(`Unknown recipe type: ${args.recipeType}`);
            const panel = document.querySelector(`.floating-window[data-template-id="${templateId}"]`);
            if (!panel || panel.classList.contains('hidden')) throw new Error(`The '${args.recipeType}' recipe panel is not open.`);
            const panelSuffix = panel.id.split('-').pop();
            let paramsSet = 0;
            for (const key in args.parameters) {
                if (_updateUI(`${key}-${panelSuffix}`, args.parameters[key], 'value', panel)) paramsSet++;
            }
            return { success: true, message: `Successfully set ${paramsSet} parameters in the ${args.recipeType} recipe.` };
        }
        case 'runSimulation': {
            const templateId = recipeMap[args.recipeType];
            if (!templateId) throw new Error(`Unknown recipe type: ${args.recipeType}`);
            const panel = document.querySelector(`.floating-window[data-template-id="${templateId}"]`);
            if (!panel || panel.classList.contains('hidden')) throw new Error(`The '${args.recipeType}' recipe panel is not open.`);
            const runButton = panel.querySelector('[data-action="run"]');
            if (!runButton) throw new Error(`Could not find a run button in the '${args.recipeType}' panel.`);
            if (runButton.disabled) return { success: false, message: `Cannot run simulation. Please generate the simulation package first.` };
            runButton.click();
            return { success: true, message: `Initiating the ${args.recipeType} simulation.` };
        }
        case 'setGlobalRadianceParameter': {
            const globalPanel = document.querySelector('[data-template-id="template-global-sim-params"]');
            if (!globalPanel) throw new Error("Global Simulation Parameters panel is not open.");
            if (_updateUI(args.parameter, args.value, 'value', globalPanel)) {
                return { success: true, message: `Set global parameter -${args.parameter} to ${args.value}.` };
            }
            throw new Error(`Could not find UI control for global parameter '${args.parameter}'.`);
        }
        case 'configureDaylightingSystem': {
            _updateUI('daylighting-enabled-toggle', args.enable, 'checked');
            if (args.enable) {
                if (args.controlType) _updateUI('daylighting-control-type', args.controlType);
                if (args.setpoint !== undefined) _updateUI('daylighting-setpoint', args.setpoint);
            }
            return { success: true, message: `Daylighting system ${args.enable ? 'enabled and configured' : 'disabled'}.` };
        }
        default:
            throw new Error(`Unknown simulation tool: ${name}`);
    }
}

async function _handleUITool(name, args) {
    switch (name) {
        case 'toggleUIPanel': {
            const panelMap = { project: 'panel-project', dimensions: 'panel-dimensions', apertures: 'panel-aperture', lighting: 'panel-lighting', materials: 'panel-materials', sensors: 'panel-sensor', viewpoint: 'panel-viewpoint', viewOptions: 'panel-view-options', info: 'panel-info', aiAssistant: 'panel-ai-assistant' };
            const panelId = panelMap[args.panelName];
            if (!panelId) throw new Error(`Invalid panel name: ${args.panelName}`);
            const panel = document.getElementById(panelId);
            if (!panel) throw new Error(`Panel element '${panelId}' not found.`);
            const isHidden = panel.classList.contains('hidden');
            if ((args.state === 'open' && isHidden) || (args.state === 'close' && !isHidden)) {
                togglePanelVisibility(panelId, `toggle-${panelId}-btn`);
            }
            return { success: true, message: `The ${args.panelName} panel is now ${args.state}.` };
        }
        case 'toggleDataTable': {
            const btn = dom['data-table-btn'];
            if (!btn) throw new Error("Data table button not found.");
            const isVisible = !dom['data-table-panel'].classList.contains('hidden');
            if (args.show !== isVisible) btn.click();
            return { success: true, message: `Data table is now ${args.show ? 'shown' : 'hidden'}.` };
        }
        case 'filterDataTable': {
            const input = dom['data-table-filter-input'];
            if (!input) throw new Error("Data table filter input not found.");
            input.value = args.query;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            return { success: true, message: `Applied filter '${args.query}' to the data table.` };
        }
        case 'toggleHdrViewer': {
            const btn = dom['view-hdr-btn'];
            if (!btn || btn.disabled) throw new Error("HDR viewer is not available. Load an HDR file first.");
            const isVisible = !dom['hdr-viewer-panel'].classList.contains('hidden');
            if (args.show !== isVisible) btn.click();
            return { success: true, message: `HDR viewer is now ${args.show ? 'shown' : 'hidden'}.` };
        }
        case 'configureHdrViewer': {
            const { setHdrExposure, toggleHdrFalseColor } = await import('./hdrViewer.js');
            if (args.exposure !== undefined) setHdrExposure(args.exposure);
            if (args.falseColor !== undefined) toggleHdrFalseColor(args.falseColor);
            return { success: true, message: "HDR viewer settings updated." };
        }
        case 'setTheme': {
            const themeBtn = dom[`theme-btn-${args.themeName}`];
            if (!themeBtn) throw new Error(`Invalid theme name: ${args.themeName}`);
            themeBtn.click();
            return { success: true, message: `Theme changed to ${args.themeName}.` };
        }
        case 'toggleComparisonMode': {
            const toggle = dom['compare-mode-toggle'];
            if (!toggle) throw new Error("Comparison mode toggle not found.");
            if (toggle.checked !== args.enable) toggle.click();
            return { success: true, message: `Comparison mode is now ${args.enable ? 'enabled' : 'disabled'}.` };
        }
        default:
            throw new Error(`Unknown UI tool: ${name}`);
    }
}

async function _handleProjectTool(name, args) {
    switch (name) {
        case 'saveProject': {
            project.downloadProjectFile();
            return { success: true, message: "Project file download has been initiated." };
        }
        case 'loadProject': {
            dom['load-project-button']?.click();
            return { success: true, message: "Opening file dialog to load a project." };
        }
        case 'generateReport': {
            const { reportGenerator } = await import('./reportGenerator.js');
            reportGenerator.generate();
            return { success: true, message: "Generating and downloading project report." };
        }
        case 'searchKnowledgeBase': {
            const results = searchKnowledgeBase(args.query);
            if (results.length > 0) {
                const formattedResults = results.map(r => `Topic: ${r.topic}\nContent: ${r.content}`).join('\n---\n');
                return { success: true, message: `Found ${results.length} relevant documents.`, results: formattedResults };
            }
            return { success: true, message: "No relevant documents found in the knowledge base." };
        }
        default:
            throw new Error(`Unknown project tool: ${name}`);
    }
}

async function _handleTutorTool(name, args) {
    switch (name) {
        case 'startWalkthrough': {
            activeWalkthrough = { topic: args.topic, step: 1 };
            switchToTutorMode();
            return { success: true, message: `Walkthrough for topic '${args.topic}' has been initiated.` };
        }
        case 'endWalkthrough': {
            activeWalkthrough = null;
            switchToChatMode();
            return { success: true, message: 'Walkthrough ended successfully.' };
        }
        default:
            throw new Error(`Unknown tutor tool: ${name}`);
    }
}

// Tool registry - maps tool names to their handler functions
const toolHandlers = {
    // Scene tools
    'addAperture': (args) => _handleSceneTool('addAperture', args),
    'placeAsset': (args) => _handleSceneTool('placeAsset', args),
    'setDimension': (args) => _handleSceneTool('setDimension', args),
    'configureShading': (args) => _handleSceneTool('configureShading', args),
    'setSensorGrid': (args) => _handleSceneTool('setSensorGrid', args),
    'setMaterialProperty': (args) => _handleSceneTool('setMaterialProperty', args),
    'traceSunRays': (args) => _handleSceneTool('traceSunRays', args),
    'toggleSunRayVisibility': (args) => _handleSceneTool('toggleSunRayVisibility', args),

    // View tools
    'changeView': (args) => _handleViewTool('changeView', args),
    'setViewpointPosition': (args) => _handleViewTool('setViewpointPosition', args),

    // Results tools
    'compareMetrics': (args) => _handleResultsTool('compareMetrics', args),
    'filterAndHighlightPoints': (args) => _handleResultsTool('filterAndHighlightPoints', args),
    'queryResultsData': (args) => _handleResultsTool('queryResultsData', args),
    'getDatasetStatistics': (args) => _handleResultsTool('getDatasetStatistics', args),
    'highlightResultPoint': (args) => _handleResultsTool('highlightResultPoint', args),
    'displayResultsForTime': (args) => _handleResultsTool('displayResultsForTime', args),
    'showAnalysisDashboard': (args) => _handleResultsTool('showAnalysisDashboard', args),
    'clearResults': (args) => _handleResultsTool('clearResults', args),
    'loadResultsFile': (args) => _handleResultsTool('loadResultsFile', args),

    // Simulation tools
    'openSimulationRecipe': (args) => _handleSimulationTool('openSimulationRecipe', args),
    'configureSimulationRecipe': (args) => _handleSimulationTool('configureSimulationRecipe', args),
    'runSimulation': (args) => _handleSimulationTool('runSimulation', args),
    'setGlobalRadianceParameter': (args) => _handleSimulationTool('setGlobalRadianceParameter', args),
    'configureDaylightingSystem': (args) => _handleSimulationTool('configureDaylightingSystem', args),

    // UI tools
    'toggleUIPanel': (args) => _handleUITool('toggleUIPanel', args),
    'toggleDataTable': (args) => _handleUITool('toggleDataTable', args),
    'filterDataTable': (args) => _handleUITool('filterDataTable', args),
    'toggleHdrViewer': (args) => _handleUITool('toggleHdrViewer', args),
    'configureHdrViewer': (args) => _handleUITool('configureHdrViewer', args),
    'setTheme': (args) => _handleUITool('setTheme', args),
    'toggleComparisonMode': (args) => _handleUITool('toggleComparisonMode', args),

    // Project tools
    'saveProject': (args) => _handleProjectTool('saveProject', args),
    'loadProject': (args) => _handleProjectTool('loadProject', args),
    'generateReport': (args) => _handleProjectTool('generateReport', args),
    'searchKnowledgeBase': (args) => _handleProjectTool('searchKnowledgeBase', args),

    // Tutor tools
    'startWalkthrough': (args) => _handleTutorTool('startWalkthrough', args),
    'endWalkthrough': (args) => _handleTutorTool('endWalkthrough', args),

    // Special tools (handled directly)
    'runDesignInspector': async (args) => {
        // These are handled by their own top-level functions, not this executor
        return { success: true, message: "Inspector/Critique initiated." };
    },
    'runResultsCritique': async (args) => {
        // These are handled by their own top-level functions, not this executor
        return { success: true, message: "Inspector/Critique initiated." };
    }
};

async function _executeToolCall(toolCall) {
    const { name, args } = toolCall.functionCall;
    console.log(`👾 Executing tool: ${name}`, args);

    try {
        const handler = toolHandlers[name];
        if (handler) {
            return await handler(args);
        }

        throw new Error(`Unknown tool: ${name}`);
    } catch (error) {
        console.error(`Tool execution failed for '${name}':`, error);
        return { success: false, message: error.message };
    }
}

/**
 * Centralized helper to call the appropriate AI model API.
 * @param {object} payload - The request body for the API call.
 * @param {string} provider - The AI provider ('openrouter', 'openai', 'gemini', 'anthropic').
 * @param {string} apiKey - The user's API key.
 * @param {string} model - The model identifier (needed for Gemini).
 * @returns {Promise<object>} The parsed JSON response from the API.
 * @private
 */
async function _callModelAPI(payload, provider, apiKey, model) {
    let apiUrl, headers = { 'Content-Type': 'application/json' };

    switch (provider) {
        case 'openrouter':
            apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
            headers['Authorization'] = `Bearer ${apiKey}`;
            headers['HTTP-Referer'] = 'http://localhost'; // Replace with your actual site
            headers['X-Title'] = 'Ray Modeler';
            break;
        case 'openai':
            apiUrl = 'https://api.openai.com/v1/chat/completions';
            headers['Authorization'] = `Bearer ${apiKey}`;
            break;
        case 'gemini':
            apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
            break;
        case 'anthropic':
            apiUrl = 'https://api.anthropic.com/v1/messages';
            headers['x-api-key'] = apiKey;
            headers['anthropic-version'] = '2023-06-01';
            break;
        default:
            throw new Error(`Unsupported provider: ${provider}`);
    }

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || errorData.message || `API Error: ${response.status}`);
    }

    return response.json();
}

/**
 * Performs a comprehensive AI-driven analysis of the project configuration.
 * @returns {Promise<object>} An object containing lists of errors, warnings, and suggestions.
 * @private
 */
async function performAIInspection() {
    try {
        const provider = localStorage.getItem('ai_provider') || 'openrouter';
        const apiKey = localStorage.getItem(`ai_api_key_${provider}`);
        let model = localStorage.getItem('ai_model');
        const customModel = localStorage.getItem('ai_custom_model');

        if (customModel && customModel.trim()) {
            model = customModel.trim();
        }

        if (!apiKey || !provider || !model) {
            throw new Error('AI settings are incomplete. Please configure them first.');
        }

        if (provider !== 'openrouter' && provider !== 'openai') {
            throw new Error(`AI Inspection currently requires an OpenAI or OpenRouter provider that supports JSON mode.`);
        }

        const projectData = await project.gatherAllProjectData();
        const dataForPrompt = JSON.parse(JSON.stringify(projectData));
        dataForPrompt.epwFileContent = dataForPrompt.epwFileContent ? `[Loaded: ${dataForPrompt.projectInfo.epwFileName}]` : null;
        if (dataForPrompt.simulationFiles) {
            Object.values(dataForPrompt.simulationFiles).forEach(file => { if (file && file.content) file.content = `[Content Loaded for ${file.name}]`; });
        }
        const appStateJSON = JSON.stringify(dataForPrompt, null, 2);

        const systemPrompt = `You are a building performance simulation expert for the Radiance Lighting Simulation Engine. Your task is to analyze a project's configuration provided in JSON format and identify potential issues. Analyze the following project state. Identify potential issues, common mistakes, or combinations of parameters that could lead to inaccurate results, long simulation times, or runtime errors. For each issue, explain the problem and its consequences in simple terms. If a simple, direct fix is possible using one of the available tools, suggest it. CRITICAL: Respond ONLY with a single, valid JSON object. Do not include any text, notes, or markdown before or after the JSON. The JSON object must have three keys: "errors", "warnings", and "suggestions". Each key should be an array of objects. Each object in the arrays must have a "message" key (string). Optionally, an object can have "action" (string, must be a valid tool name like 'addOverhang' or 'openPanel'), "actionLabel" (string, e.g., 'Add 0.8m Overhang'), and "params" (an object of parameters for the action). Now, analyze the user's project.`;
        const userMessage = `Project JSON to analyze: \n\n${appStateJSON}`;

        const messages = [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }];
        const payload = { model: model, messages: messages, response_format: { type: "json_object" } };

        const data = await _callModelAPI(payload, provider, apiKey, model);
        const responseText = data.choices?.[0]?.message?.content;

        if (!responseText) {
            throw new Error("Received an empty response from the AI model.");
        }

        const findings = JSON.parse(responseText);

        return {
            errors: Array.isArray(findings.errors) ? findings.errors : [],
            warnings: Array.isArray(findings.warnings) ? findings.warnings : [],
            suggestions: Array.isArray(findings.suggestions) ? findings.suggestions : []
        };

    } catch (error) {
        console.error("AI Design Inspector failed:", error);
        return {
            errors: [{ message: `An error occurred during AI inspection: ${error.message}` }],
            warnings: [],
            suggestions: []
        };
    }
}

/**

Performs an AI-driven analysis of the simulation results.

@returns {Promise<object>} An object containing lists of findings and suggestions.

@private
*/
async function _performAICritique() {
    try {
        const provider = localStorage.getItem('ai_provider') || 'openrouter';
        const apiKey = localStorage.getItem(`ai_api_key_${provider}`);
        let model = localStorage.getItem('ai_model');
        const customModel = localStorage.getItem('ai_custom_model');

        if (customModel && customModel.trim()) {
            model = customModel.trim();
        }

        if (!apiKey || !provider || !model) {
            throw new Error('AI settings are incomplete. Please configure them first.');
        }

        if (provider !== 'openrouter' && provider !== 'openai') {
            throw new Error(`AI Critique currently requires an OpenAI or OpenRouter provider that supports JSON mode.`);
        }

        const projectData = await project.gatherAllProjectData();
        const dataForPrompt = JSON.parse(JSON.stringify(projectData));
        dataForPrompt.epwFileContent = dataForPrompt.epwFileContent ? `[Loaded: ${dataForPrompt.projectInfo.epwFileName}]` : null;
        if (dataForPrompt.simulationFiles) {
            Object.values(dataForPrompt.simulationFiles).forEach(file => { if (file && file.content) file.content = `[Content Loaded for ${file.name}]`; });
        }

        const resultsData = {
            datasetA: resultsManager.datasets.a ? { fileName: resultsManager.datasets.a.fileName, stats: resultsManager.datasets.a.stats, glareResult: !!resultsManager.datasets.a.glareResult, isAnnual: resultsManager.hasAnnualData('a') } : null,
            datasetB: resultsManager.datasets.b ? { fileName: resultsManager.datasets.b.fileName, stats: resultsManager.datasets.b.stats, glareResult: !!resultsManager.datasets.b.glareResult, isAnnual: resultsManager.hasAnnualData('b') } : null
        };
        const appState = { projectConfiguration: dataForPrompt, loadedResultsSummary: resultsData };
        const appStateJSON = JSON.stringify(appState, null, 2);

        const systemPrompt = `You are a building performance simulation expert for the Radiance Lighting Simulation Engine. Your task is to analyze a project's configuration and its simulation results, provided in JSON format, and provide a design critique. 1. Identify key findings from the results (e.g., high DGP, low average illuminance, poor uniformity). 2. Correlate these findings with the project configuration (e.g., "high DGP is likely due to the unshaded south-facing window at this time of day"). 3. Propose specific, actionable solutions using the available tools. 4. Explain your reasoning clearly and concisely for each suggestion. CRITICAL: Respond ONLY with a single, valid JSON object. Do not include any text, notes, or markdown before or after the JSON. The JSON object must have one key: "findings". This key should be an array of objects. Each object in the array must have a "message" key (string, explaining the issue and suggestion) and a "type" key (string: 'critique', 'suggestion', or 'positive'). Optionally, an object can have "action" (string, a valid tool name), "actionLabel" (string, e.g., 'Add 0.8m Overhang'), and "params" (an object of parameters for the action). Now, analyze the user's project and results.`;
        const userMessage = `Project and Results JSON to analyze: \n\n${appStateJSON}`;

        const messages = [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }];
        const payload = { model: model, messages: messages, response_format: { type: "json_object" } };

        const data = await _callModelAPI(payload, provider, apiKey, model);
        const responseText = data.choices?.[0]?.message?.content;

        if (!responseText) {
            throw new Error("Received an empty response from the AI model.");
        }

        const critique = JSON.parse(responseText);

        return {
            findings: Array.isArray(critique.findings) ? critique.findings : []
        };
    } catch (error) {
        console.error("AI Results Critique failed:", error);
        return {
            findings: [{ type: 'critique', message: `An error occurred during AI critique: ${error.message}` }]
        };
    }
}

/**
 * Calls the AI API with tool-use capabilities, supporting multiple providers.
 * @param {string} apiKey - The user's API key.
 * @param {string} provider - The selected provider ('openrouter', 'openai', 'gemini', 'anthropic').
 * @param {string} model - The specific model identifier.
 * @param {string} systemPrompt - The generated system prompt with context.
 * @returns {Promise<string>} The text response from the AI model.
 */
async function callGenerativeAI(apiKey, provider, model, systemPrompt) {
    let payload;

    const activeConversation = conversations[activeConversationId];
    if (!activeConversation) throw new Error("No active conversation found.");

    // Prepare message history, converting to 'assistant' role where needed.
    let messages = activeConversation.history.map(msg => ({
        role: msg.role === 'model' ? 'assistant' : 'user',
        content: msg.parts[0].text
    }));
    messages.unshift({ role: 'system', content: systemPrompt });

    const openAITools = convertGeminiToolsToOpenAI(availableTools);

    // Construct the provider-specific payload
    if (provider === 'openrouter' || provider === 'openai') {
        payload = { model: model, messages: messages, tools: openAITools, tool_choice: "auto" };
    } else if (provider === 'gemini') {
        const userMessages = messages.filter(m => m.role === 'user' || m.role === 'model' || m.role === 'tool');
        const geminiContents = userMessages.map(m => ({
            role: m.role === 'tool' ? 'tool' : (m.role === 'user' ? 'user' : 'model'),
            parts: m.role === 'tool' ? [{ functionResponse: { name: m.name, response: JSON.parse(m.content) } }] : [{ text: m.content }]
        }));
        payload = {
            contents: geminiContents,
            systemInstruction: { parts: [{ text: systemPrompt }] },
            tools: availableTools
        };
    } else if (provider === 'anthropic') {
        const anthropicMessages = messages.map(m => ({
            role: m.role === 'user' ? 'user' : 'assistant',
            content: m.content
        }));
        payload = { model: model, max_tokens: 4096, messages: anthropicMessages, system: systemPrompt };
    } else {
        throw new Error(`Unsupported provider: ${provider}`);
    }

    const data = await _callModelAPI(payload, provider, apiKey, model);

    // Process the response to check for tool calls
    let responseMessage, toolCalls, text;
    if (provider === 'openrouter' || provider === 'openai') {
        responseMessage = data.choices?.[0]?.message;
        if (!responseMessage) throw new Error("Invalid response structure from API.");
        toolCalls = responseMessage.tool_calls;
        text = responseMessage.content;
    } else if (provider === 'gemini') {
        responseMessage = data.candidates?.[0]?.content;
        if (!responseMessage) throw new Error("Invalid response structure from Gemini API.");
        // TODO: Add full Gemini tool call handling if needed
        text = responseMessage.parts?.[0]?.text || '';
    } else if (provider === 'anthropic') {
        // TODO: Add full Anthropic tool call handling if needed
        text = data.content?.[0]?.text || '';
    }

    // Handle tool calls for supported providers
    if (toolCalls && toolCalls.length > 0 && (provider === 'openrouter' || provider === 'openai')) {
        const toolPromises = toolCalls.map(tc => _executeToolCall({ functionCall: { name: tc.function.name, args: JSON.parse(tc.function.arguments) } }));
        const toolResults = await Promise.all(toolPromises);

        messages.push(responseMessage); // Add original assistant message with tool calls
        toolResults.forEach((result, i) => {
            messages.push({
                role: 'tool',
                tool_call_id: toolCalls[i].id,
                name: toolCalls[i].function.name,
                content: JSON.stringify(result)
            });
        });

        // Make the second API call with the tool results
        const secondPayload = { ...payload, messages: messages };
        const secondData = await _callModelAPI(secondPayload, provider, apiKey, model);
        const finalText = secondData.choices?.[0]?.message?.content;

        if (finalText === null || finalText === undefined) {
            throw new Error('Received an invalid final response from API after tool call.');
        }
        return finalText;
    } else {
        if (text === null || text === undefined) {
            throw new Error('Received an invalid response from API.');
        }
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
    const inspectorButton = dom['run-inspector-btn'];

    const elements = [sendButton, input, inspectorButton].filter(Boolean);

    if (isLoading) {
        elements.forEach(el => el.disabled = true);
        if (sendButton) sendButton.innerHTML = '...';
    } else {
        elements.forEach(el => el.disabled = false);
        if (sendButton) sendButton.innerHTML = 'Send';
        if (input) input.focus();
    }
}

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

/** Opens the Helios capabilities modal window. */
function openCapabilitiesModal() {
    const modal = dom['helios-capabilities-modal'];
    if (!modal) return;
    modal.style.zIndex = getNewZIndex();
    modal.classList.replace('hidden', 'flex');
}

/** Closes the Helios capabilities modal window. */
function closeCapabilitiesModal() {
    dom['helios-capabilities-modal']?.classList.replace('flex', 'hidden');
}

/**
 * Saves the API key and provider to localStorage.
 * @param {Event} event - The form submission event.
 */
function saveSettings(event) {
    event.preventDefault();
    const keyInput = dom['ai-secret-field'];
    const providerSelect = dom['ai-provider-select'];
    const modelSelect = dom['ai-model-select'];
    const customModelInput = dom['ai-custom-model-input'];

    const provider = providerSelect.value;
    const storageKey = `ai_api_key_${provider}`;
    localStorage.setItem(storageKey, keyInput.value.trim());

    localStorage.setItem('ai_provider', provider);
    localStorage.setItem('ai_model', modelSelect.value);
    localStorage.setItem('ai_custom_model', customModelInput.value.trim());

    showAlert('AI settings saved.', 'Success');
    closeSettingsModal();
}

/**
 * Loads the API key and provider from localStorage into the settings form.
 */
function loadSettings() {
    const keyInput = dom['ai-secret-field'];
    const providerSelect = dom['ai-provider-select'];
    const modelSelect = dom['ai-model-select'];
    const customModelInput = dom['ai-custom-model-input'];

   if (providerSelect && modelSelect && customModelInput && keyInput) {
        const savedProvider = localStorage.getItem('ai_provider') || 'openrouter';
        providerSelect.value = savedProvider;

        // Load the API key for the saved provider
        const storageKey = `ai_api_key_${savedProvider}`;
        keyInput.value = localStorage.getItem(storageKey) || '';

        updateModelOptions(savedProvider);
        toggleProviderInfo(savedProvider);

        const savedModel = localStorage.getItem('ai_model');
        const savedCustomModel = localStorage.getItem('ai_custom_model');
        if (savedCustomModel) {
            customModelInput.value = savedCustomModel;
        }
        if (savedModel) {
            modelSelect.value = savedModel;
        } else if (modelsByProvider[savedProvider]?.length > 0) {
            modelSelect.value = modelsByProvider[savedProvider][0].id;
        }
    }
}

/**
 * Converts a Gemini-formatted tool array to the OpenAI format required by OpenRouter.
 * @param {Array} geminiTools - The tool array in Gemini's format.
 * @returns {Array} The tool array in OpenAI's format.
 */
function convertGeminiToolsToOpenAI(geminiTools) {
    if (!geminiTools || !geminiTools.length || !geminiTools[0].functionDeclarations) {
        return [];
    }

    const convertParameters = (params) => {
        if (!params) return { type: 'object', properties: {} };
        const newParams = JSON.parse(JSON.stringify(params)); // Deep copy to avoid mutation

        const lowercaseTypes = (obj) => {
            if (obj.type) obj.type = obj.type.toLowerCase();
            if (obj.properties) {
                for (const key in obj.properties) {
                    lowercaseTypes(obj.properties[key]);
                }
            }
            if (obj.items) lowercaseTypes(obj.items);
        };
        lowercaseTypes(newParams);
        return newParams;
    };

    return geminiTools[0].functionDeclarations.map(func => ({
        type: 'function',
        function: {
            name: func.name,
            description: func.description,
            parameters: convertParameters(func.parameters)
        }
    }));
}

/**
 * Triggers a proactive suggestion based on a user action.
 * @param {string} context - The context of the user's action.
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
            return;
    }

    import('./ui.js').then(({ displayProactiveSuggestion }) => {
        displayProactiveSuggestion(suggestionHTML);
    }).catch(err => console.error("Failed to display proactive suggestion:", err));
}

export { initAiAssistant };

/**
 * Updates a message bubble in the chat UI with new content.
 * @param {HTMLElement} messageElement - The DOM element of the message to update.
 * @param {string} newHtml - The new HTML content for the message bubble.
 * @private
 */
function _updateProgressMessage(messageElement, newHtml) {
    if (messageElement && messageElement.querySelector) {
        messageElement.querySelector('.message-bubble').innerHTML = newHtml;
    }
}

/**
 * Runs a single simulation iteration for a generative design study.
 * @param {string} variable - The design parameter being iterated (e.g., 'overhang depth').
 * @param {string} targetElement - The scene element to modify (e.g., 'south').
 * @param {number} currentValue - The value of the design parameter for this iteration.
 * @returns {Promise<object>} A promise that resolves with the sDA and ASE results for the iteration.
 * @private
 */
async function _runGenerativeDesignIteration(variable, targetElement, currentValue) {
    // 1. Configure the design variable for this iteration.
    if (variable === 'overhang depth') {
        await _executeToolCall({
            functionCall: {
                name: 'configureShading',
                args: { wall: targetElement, enable: true, deviceType: 'overhang', depth: currentValue }
            }
        });
    } else {
        throw new Error(`This generative design workflow currently only supports the 'overhang depth' variable.`);
    }

    // 2. Generate the simulation package and run the script.
    const sdaPanel = document.querySelector('[data-template-id="template-recipe-sda-ase"]');
    if (!sdaPanel) throw new Error("sDA/ASE recipe panel could not be found.");

    const scriptInfo = await programmaticallyGeneratePackage(sdaPanel);
    await runScriptAndWait(scriptInfo.shFile);

    // 3. Load and query results from the output files.
    const projectName = project.projectName || 'scene';
    const aseFile = await _getFileFromElectron(`08_results/${projectName}_ASE_direct_only.ill`);
    const sdaFile = await _getFileFromElectron(`08_results/${projectName}_sDA_final.ill`);

    await resultsManager.loadAndProcessFile(aseFile, 'a');
    const aseMetrics = resultsManager.calculateAnnualMetrics('a', {});

    await resultsManager.loadAndProcessFile(sdaFile, 'a');
    const sdaMetrics = resultsManager.calculateAnnualMetrics('a', {});

    return {
        variableValue: currentValue,
        sDA: sdaMetrics.sDA,
        ASE: aseMetrics.ASE
    };
}

/**
 * Analyzes the results of a generative study to find the best option.
 * @param {Array<object>} results - An array of result objects from each iteration.
 * @param {string} goal - The optimization objective (e.g., 'maximize sDA').
 * @param {string} constraints - The constraint for valid solutions (e.g., 'ASE < 10').
 * @returns {{bestOption: object, validOptions: Array<object>}} The best result and all valid options.
 * @private
 */
function _analyzeGenerativeDesignResults(results, goal, constraints) {
    const constraintRegex = /(sDA|ASE)\s*(<|<=|>|>=)\s*(\d+\.?\d*)/;
    const constraintMatch = constraints.match(constraintRegex);
    if (!constraintMatch) throw new Error("Could not parse the provided constraint string: " + constraints);

    const [, constraintMetric, operator, constraintValueStr] = constraintMatch;
    const constraintValue = parseFloat(constraintValueStr);

    const validOptions = results.filter(res => {
        const metricValue = res[constraintMetric];
        switch (operator) {
            case '<': return metricValue < constraintValue;
            case '<=': return metricValue <= constraintValue;
            case '>': return metricValue > constraintValue;
            case '>=': return metricValue >= constraintValue;
            default: return false;
        }
    });

    if (validOptions.length === 0) {
        return { bestOption: null, validOptions: [] };
    }

    const goalMetric = goal.includes('sDA') ? 'sDA' : 'ASE';
    const sortDirection = goal.startsWith('maximize') ? -1 : 1;

    validOptions.sort((a, b) => (a[goalMetric] - b[goalMetric]) * sortDirection);

    return { bestOption: validOptions[0], validOptions };
}

/**
 * Formats the final summary message for a completed optimization run.
 * @param {object} bestDesign - The best design object found by the optimizer.
 * @param {object} args - The original arguments for the optimization.
 * @returns {string} A formatted markdown string for the chat window.
 * @private
 */
function _formatOptimizationSummary(bestDesign, args) {
    const { patternType, targetWall, optimizationGoal, targetConstraint } = args;

    let summary = `✅ **Optimization Complete!**\n\n### 🏆 Best Design Found\n\n`;
    summary += `**Pattern Type:** ${patternType}\n`;
    summary += `**Target Wall:** ${targetWall}\n`;
    summary += `**${optimizationGoal.replace(/_/g, ' ')}:** ${bestDesign.fitness.metricValue.toFixed(2)}${bestDesign.fitness.unit}\n\n`;

    summary += `**Parameters:**\n`;
    for (const [key, value] of Object.entries(bestDesign.params)) {
        summary += `- \`${key}\`: ${value.toFixed(3)}\n`;
    }

    if (targetConstraint) {
        summary += `\n**Constraint Met:** ${targetConstraint} ✓\n`;
    }

    summary += `\nThe optimized design has been applied to your scene.`;
    return summary;
}

/**
 * Applies a set of design parameters to the scene and waits for the geometry to update.
 * @param {object} designParams - The parameters for the generative shading pattern.
 * @param {string} targetWall - The wall to apply the pattern to (e.g., 'S').
 * @param {string} patternType - The type of pattern (e.g., 'voronoi').
 * @private
 */
async function _applyDesignAndWaitForUpdate(designParams, targetWall, patternType) {
    const wallDir = targetWall.toLowerCase();
    const { setShadingState, storeGenerativeParams, setGenerativeSliderValues, scheduleUpdate } = await import('./ui.js');

    setShadingState(wallDir, { enabled: true, type: 'generative' });
    storeGenerativeParams(wallDir, patternType, designParams);
    setGenerativeSliderValues(wallDir, designParams);

    // Wait for the scene update to complete
    await new Promise(resolve => {
        scheduleUpdate('optimizationFitnessEval');
        // A short timeout gives the renderer time to process the new geometry
        setTimeout(resolve, 300); 
    });
}

/**
 * Executes the full generative design workflow asynchronously.
 * @param {object} args - The arguments for the design study from the AI tool call.
 * @returns {Promise<object>} A promise that resolves with the final summary message.
 * @private
 */
async function _performGenerativeDesign(args) {
    const { goal, variable, targetElement, range, steps, constraints } = args;
    const [min, max] = range;
    const results = [];
    let progressMessage = `Running generative design study...\n\n**Goal:** ${goal}\n**Constraint:** ${constraints}\n\n`;

    // The generative design feature requires the sDA/ASE recipe.
    const recipeToRun = 'sda-ase';

    // Ensure the necessary recipe panel is open for configuration.
    await _executeToolCall({ functionCall: { name: 'openSimulationRecipe', args: { recipeType: recipeToRun } } });
    
    // Add a status message to the chat that we can update with progress.
    const statusMessageElement = addMessage('ai', progressMessage + `Initializing (0/${steps})...`);

    // The user must generate the 3-Phase matrices first. We'll check for this.
    // NOTE: This assumes an Electron API function `checkFileExists` is available.
    if (window.electronAPI?.checkFileExists) {
        const matrixFileExists = await window.electronAPI.checkFileExists({
            projectPath: project.dirPath,
            filePath: `08_results/matrices/view.mtx`
        });
        if (!matrixFileExists) {
            throw new Error("The required 3-Phase matrix files (e.g., view.mtx) were not found. Please run the 'Annual Daylight (3-Phase)' recipe's matrix generation script first.");
        }
    }

for (let i = 0; i < steps; i++) {
    const currentValue = min + (i / (steps - 1)) * (max - min);
    try {
        // 1. Configure the design variable for this iteration.
        if (variable === 'overhang depth') {
            await _executeToolCall({
                functionCall: {
                    name: 'configureShading',
                    args: { wall: targetElement, enable: true, deviceType: 'overhang', depth: currentValue }
                }
            });
        } else {
            throw new Error(`This generative design workflow currently only supports the 'overhang depth' variable.`);
        }

        // Update progress message in the chat window.
        statusMessageElement.querySelector('.message-bubble').innerHTML = progressMessage + `<p>Running simulation ${i + 1}/${steps} with depth ${currentValue.toFixed(2)}m...</p>`;

        // 2. Generate the simulation package and run the script, waiting for completion.
        const sdaPanel = document.querySelector('[data-template-id="template-recipe-sda-ase"]');
        if (!sdaPanel) throw new Error("sDA/ASE recipe panel could not be found.");

        const scriptInfo = await programmaticallyGeneratePackage(sdaPanel);
        await runScriptAndWait(scriptInfo.shFile);

        // 3. Load and query results from the output files.
        const projectName = project.projectName || 'scene';
        const aseFile = await _getFileFromElectron(`08_results/${projectName}_ASE_direct_only.ill`);
        const sdaFile = await _getFileFromElectron(`08_results/${projectName}_sDA_final.ill`);

        // Load into the results manager to calculate metrics.
        await resultsManager.loadAndProcessFile(aseFile, 'a');
        const aseMetrics = resultsManager.calculateAnnualMetrics('a', {});

        await resultsManager.loadAndProcessFile(sdaFile, 'a');
        const sdaMetrics = resultsManager.calculateAnnualMetrics('a', {});

        const iterationResult = {
            variableValue: currentValue,
            sDA: sdaMetrics.sDA,
            ASE: aseMetrics.ASE
        };
        results.push(iterationResult);

        // Append this step's results to the progress message.
        progressMessage += `<p>✅ Step ${i + 1}: Depth ${currentValue.toFixed(2)}m → sDA: ${iterationResult.sDA.toFixed(1)}%, ASE: ${iterationResult.ASE.toFixed(1)}%</p>`;
        statusMessageElement.querySelector('.message-bubble').innerHTML = progressMessage;

    } catch (error) {
        console.error(`Generative design iteration ${i + 1} failed for value ${currentValue.toFixed(2)}m:`, error);

        // Assign a "worst" fitness score and continue
        results.push({
            variableValue: currentValue,
            sDA: 0, // Worst possible sDA
            ASE: 100 // Worst possible ASE
        });

        // Update the UI to show the failure for this step
        progressMessage += `<p>❌ Step ${i + 1} (Depth ${currentValue.toFixed(2)}m): Simulation failed. Assigning worst result and continuing.</p>`;
        statusMessageElement.querySelector('.message-bubble').innerHTML = progressMessage;

        continue; // Move to the next iteration
    }
}

    // 4. Analyze all results to find the best option.
    const constraintRegex = /(sDA|ASE)\s*(<|<=|>|>=)\s*(\d+\.?\d*)/;
    const constraintMatch = constraints.match(constraintRegex);
    if (!constraintMatch) throw new Error("Could not parse the provided constraint string: " + constraints);
    
    const [, constraintMetric, operator, constraintValueStr] = constraintMatch;
    const constraintValue = parseFloat(constraintValueStr);

    const validOptions = results.filter(res => {
        const metricValue = res[constraintMetric];
        switch (operator) {
            case '<': return metricValue < constraintValue;
            case '<=': return metricValue <= constraintValue;
            case '>': return metricValue > constraintValue;
            case '>=': return metricValue >= constraintValue;
            default: return false;
        }
    });

    if (validOptions.length === 0) {
        return { message: "✅ **Generative Design Complete.**\n\nUnfortunately, none of the tested options met your constraint." };
    }

    const goalMetric = goal.includes('sDA') ? 'sDA' : 'ASE';
    const sortDirection = goal.startsWith('maximize') ? -1 : 1;

    validOptions.sort((a, b) => (a[goalMetric] - b[goalMetric]) * sortDirection);
    
    const bestOption = validOptions[0];

    let summary = `✅ **Generative Design Complete!**\n\nFound ${validOptions.length} valid options that met your constraint (${constraints}).\n\n**🏆 Best Result:**\n`;
    summary += `* **${variable}:** ${bestOption.variableValue.toFixed(2)}m\n`;
    summary += `* **sDA:** ${bestOption.sDA.toFixed(1)}%\n`;
    summary += `* **ASE:** ${bestOption.ASE.toFixed(1)}%\n\n`;
    summary += `This option provides the best performance for your goal ("${goal}").`;

    // Clean up the progress message by replacing it with the final summary.
    statusMessageElement.querySelector('.message-bubble').innerHTML = summary;

    return { message: summary }; // This return is for the internal promise handling.
}

/**
 * Wraps the Electron script execution process in a promise.
 * @param {string} scriptName - The name of the script to run (e.g., 'RUN_project_sDA_ASE.sh').
 * @returns {Promise<object>} A promise that resolves on success or rejects on failure.
 * @private
 */
function runScriptAndWait(scriptName) {
    return new Promise((resolve, reject) => {
        if (!window.electronAPI?.runScript || !project.dirPath) {
            return reject(new Error("Simulation execution requires the Electron app and a saved project directory."));
        }
        
        let output = '';
        const handleExit = (code) => {
            unsubscribeExit();
            unsubscribeOutput();
            if (code === 0) resolve({ success: true, output: output });
            else reject(new Error(`Script '${scriptName}' failed with exit code ${code}. See console for full output.`));
        };

        const handleOutput = (data) => {
            output += data;
            console.log(`[Sim Output] ${data}`); // Log output for debugging
        };

        const unsubscribeExit = window.electronAPI.onScriptExit(handleExit);
        const unsubscribeOutput = window.electronAPI.onScriptOutput(handleOutput);

        window.electronAPI.runScript({
            projectPath: project.dirPath,
            scriptName: scriptName
        });
    });
}


/**
 * Executes the full generative shading optimization workflow.
 * @param {object} args - The arguments for the optimization from the AI tool call.
 * @returns {Promise<object>} A promise that resolves with the final summary message.
 * @private
 */
async function _performGenerativeOptimization(args) {
    const { 
        targetWall, 
        patternType, 
        optimizationGoal, 
        constraints, 
        targetConstraint,
        generations = 10, 
        populationSize = 20,
        quality = 'medium'
    } = args;

    // Import the optimizer
    const { GeneticOptimizer } = await import('./optimizationEngine.js');
    
    // Initialize the optimizer with the parameter constraints
    const optimizer = new GeneticOptimizer({
        populationSize: populationSize,
        generations: generations,
        mutationRate: 0.15,
        constraints: constraints,
        patternType: patternType
    });

    let progressMessage = `## Optimization Progress\n\n`;
    let bestOverall = null;
    let bestOverallFitness = -Infinity;
    
    // Add a status message that we can update
    const conv = conversations[activeConversationId];
    const messagesContainer = dom['ai-chat-messages'];
    const statusMessageElement = addMessageToDOM('ai', progressMessage + `**Generation 0/${generations}**: Initializing...`, messagesContainer);

    try {
        // Run the optimization
        const result = await optimizer.run(async (designParams, generationNum, individualNum) => {
            // Update progress
            if (individualNum === 0) {
                progressMessage += `\n**Generation ${generationNum}/${generations}**: Evaluating ${populationSize} designs...\n`;
                statusMessageElement.querySelector('.message-bubble').innerHTML = progressMessage;
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }

            // Evaluate this design
            const fitness = await _evaluateFitness(designParams, targetWall, patternType, optimizationGoal, targetConstraint, quality);
            
            // Track the best overall
            if (fitness.score > bestOverallFitness) {
                bestOverallFitness = fitness.score;
                bestOverall = { params: designParams, fitness: fitness };
                
                // Report new best
                progressMessage += `  ✨ New best: ${fitness.metricValue.toFixed(2)} (fitness: ${fitness.score.toFixed(2)})\n`;
                statusMessageElement.querySelector('.message-bubble').innerHTML = progressMessage;
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }

            return fitness.score;
        });

        // Apply the best design
        progressMessage += `\n---\n\n✅ **Optimization Complete!**\n\n`;
        statusMessageElement.querySelector('.message-bubble').innerHTML = progressMessage;

        if (!bestOverall) {
            throw new Error("No valid solutions found during optimization.");
        }

        // Apply the best design to the scene
        await _executeToolCall({ 
            functionCall: { 
                name: 'createShadingPattern', 
                args: {
                    targetWall: targetWall,
                    patternType: patternType,
                    parameters: bestOverall.params
                } 
            } 
        });

        // Build summary message
        let summary = `### 🏆 Best Design Found\n\n`;
        summary += `**Pattern Type:** ${patternType}\n`;
        summary += `**Target Wall:** ${targetWall}\n`;
        summary += `**${optimizationGoal.replace('_', ' ')}:** ${bestOverall.fitness.metricValue.toFixed(2)}${bestOverall.fitness.unit}\n\n`;
        
        summary += `**Parameters:**\n`;
        for (const [key, value] of Object.entries(bestOverall.params)) {
            summary += `- ${key}: ${value.toFixed(3)}\n`;
        }
        
        if (targetConstraint) {
            summary += `\n**Constraint Met:** ${targetConstraint} ✓\n`;
        }

        summary += `\nThe optimized design has been applied to your scene. You can now adjust the parameters manually if needed.`;

        return { message: summary };

    } catch (error) {
        throw error;
    }
}

/**
 * Evaluates the fitness of a design by running a simulation and calculating the metric.
 * @param {object} designParams - The design parameters to evaluate.
 * @param {string} targetWall - The wall direction (n, s, e, w).
 * @param {string} patternType - The pattern type.
 * @param {string} optimizationGoal - The goal to optimize for.
 * @param {string} targetConstraint - Optional constraint string (e.g., "ASE < 10").
 * @param {string} quality - Simulation quality preset.
 * @returns {Promise<object>} An object with score, metricValue, and unit.
 * @private
 */
async function _evaluateFitness(designParams, targetWall, patternType, optimizationGoal, targetConstraint, quality) {
    const wallDir = targetWall.toLowerCase();
    
    // Step 1: Apply the design parameters to the scene
    const { setShadingState, storeGenerativeParams, setGenerativeSliderValues, scheduleUpdate } = await import('./ui.js');
    
    setShadingState(wallDir, { enabled: true, type: 'generative' });
    storeGenerativeParams(wallDir, patternType, designParams);
    setGenerativeSliderValues(wallDir, designParams);
    
    // Wait for scene update to complete
    await new Promise(resolve => {
        scheduleUpdate('optimizationFitnessEval');
        setTimeout(resolve, 500); // Give time for geometry to update
    });

    // Step 2: Generate and run the simulation script
    const scriptContent = await _generateQuickSimScript(optimizationGoal, quality);
    
    if (!window.electronAPI?.runScriptHeadless || !project.dirPath) {
        throw new Error("Optimization requires Electron app and a saved project directory.");
    }

    const result = await window.electronAPI.runScriptHeadless({
        projectPath: project.dirPath,
        scriptContent: scriptContent
    });

    if (!result.success) {
        console.warn("Simulation failed, assigning worst fitness:", result.stderr);
        return { score: -Infinity, metricValue: 0, unit: '' };
    }

    // Step 3: Parse the results and calculate fitness
    const fitness = await _parseSimulationResult(optimizationGoal, targetConstraint);
    
    return fitness;
}

/**
 * Generates a quick simulation script for fitness evaluation.
 * @param {string} optimizationGoal - The goal being optimized.
 * @param {string} quality - The quality preset (draft, medium, high).
 * @returns {Promise<string>} The shell script content.
 * @private
 */
async function _generateQuickSimScript(optimizationGoal, quality) {
    // Determine which recipe to use based on the goal
    const recipeType = optimizationGoal.includes('DGP') ? 'dgp' : 'sda-ase';
    
    // Open the appropriate recipe panel (if not already open)
    const templateId = recipeMap[recipeType];
    let panel = document.querySelector(`.floating-window[data-template-id="${templateId}"]`);
    
    if (!panel || panel.classList.contains('hidden')) {
        panel = openRecipePanelByType(templateId);
        if (!panel) {
            throw new Error(`Could not open ${recipeType} recipe panel for optimization.`);
        }
        // Wait a moment for panel to initialize
        await new Promise(resolve => setTimeout(resolve, 200));
    }

    // Set quality preset
    const qualityMap = { draft: 'draft', medium: 'medium', high: 'high' };
    const panelSuffix = panel.id.split('-').pop();
    const qualitySelect = panel.querySelector(`#quality-preset-${panelSuffix}`);
    if (qualitySelect) {
        qualitySelect.value = qualityMap[quality] || 'medium';
        qualitySelect.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Generate the simulation package
    const scriptInfo = await programmaticallyGeneratePackage(panel);
    
    // Read the script file content
    if (!window.electronAPI?.readFile) {
        throw new Error("Reading script files requires Electron API.");
    }
    
    const scriptFile = await window.electronAPI.readFile({
        projectPath: project.dirPath,
        filePath: `07_scripts/${scriptInfo.shFile}`
    });

    if (!scriptFile.success) {
        throw new Error("Could not read generated script file.");
    }

    // Convert buffer to string
    const decoder = new TextDecoder('utf-8');
    const scriptContent = decoder.decode(scriptFile.content.data);
    
    return scriptContent;
}

/**
 * Parses simulation results and calculates fitness score.
 * @param {string} optimizationGoal - The goal being optimized.
 * @param {string} targetConstraint - Optional constraint string.
 * @returns {Promise<object>} An object with score, metricValue, and unit.
 * @private
 */
async function _parseSimulationResult(optimizationGoal, targetConstraint) {
    const projectName = project.projectName || 'scene';
    
    try {
        let metricValue = 0;
        let unit = '';

        if (optimizationGoal === 'maximize_sDA') {
            // Load sDA result file
            const sdaFile = await _getFileFromElectron(`08_results/${projectName}_sDA_final.ill`);
            await resultsManager.loadAndProcessFile(sdaFile, 'a');
            const metrics = resultsManager.calculateAnnualMetrics('a', {});
            metricValue = metrics.sDA;
            unit = '%';
            
        } else if (optimizationGoal === 'minimize_ASE') {
            // Load ASE result file
            const aseFile = await _getFileFromElectron(`08_results/${projectName}_ASE_direct_only.ill`);
            await resultsManager.loadAndProcessFile(aseFile, 'a');
            const metrics = resultsManager.calculateAnnualMetrics('a', {});
            metricValue = metrics.ASE;
            unit = '%';
            
        } else if (optimizationGoal === 'minimize_DGP_average') {
            // For DGP, we need to parse the output file
            // This is a simplified approach - you may need to adjust based on your DGP output format
            const dgpFile = await _getFileFromElectron(`08_results/${projectName}_DGP.txt`);
            const text = await dgpFile.text();
            // Extract average DGP (this regex may need adjustment)
            const match = text.match(/Average DGP:\s*([\d.]+)/);
            metricValue = match ? parseFloat(match[1]) : 0;
            unit = '';
        }

        // Calculate fitness score
        let fitness = 0;
        if (optimizationGoal.startsWith('maximize')) {
            fitness = metricValue; // Higher is better
        } else if (optimizationGoal.startsWith('minimize')) {
            fitness = -metricValue; // Lower is better (negated)
        }

        // Apply constraint penalty if provided
        if (targetConstraint) {
            const constraintMet = _checkConstraint(metricValue, targetConstraint);
            if (!constraintMet) {
                fitness = -Infinity; // Invalid solution
            }
        }

        return { score: fitness, metricValue: metricValue, unit: unit };

    } catch (error) {
        console.error("Failed to parse simulation results:", error);
        return { score: -Infinity, metricValue: 0, unit: '' };
    }
}

/**
 * Checks if a value meets a constraint.
 * @param {number} value - The metric value to check.
 * @param {string} constraint - Constraint string (e.g., "ASE < 10" or "sDA >= 60").
 * @returns {boolean} True if constraint is met.
 * @private
 */
function _checkConstraint(value, constraint) {
    const regex = /([\w]+)\s*(<|<=|>|>=|==)\s*([\d.]+)/;
    const match = constraint.match(regex);
    if (!match) return true; // No valid constraint, pass by default
    
    const [, metric, operator, thresholdStr] = match;
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
    
    const { content, name } = await window.electronAPI.readFile({
        projectPath: project.dirPath,
        filePath: filePath
    });
    
    const buffer = new Uint8Array(content.data).buffer;
    const blob = new Blob([buffer]);
    return new File([blob], name, { type: 'application/octet-stream' });
}
