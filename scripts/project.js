// scripts/project.js

import * as THREE from 'three';
import { generateRadFileContent, generateViewpointFileContent, transformThreePointToRadianceArray, transformThreeVectorToRadianceArray, generateViewpointFileContentFromState, generateRayFileContent } from './radiance.js';
import { updateScene } from './geometry.js';
import { recreateSimulationPanels } from './simulation.js';
import { lightingManager } from './lighting.js';
import { generateScripts } from './scriptGenerator.js';
import { getRecipeById } from './recipes/RecipeRegistry.js';
import { getActiveRecipeSelection, buildRecipeConfig } from './recipes/configMappers.js';
import './recipes/illuminanceRecipe.js';
import './recipes/renderingRecipe.js';
import './recipes/daylightFactorRecipe.js';
import './recipes/annual3PhaseRecipe.js';
import './recipes/dgpRecipe.js';
import './recipes/sdaAseRecipe.js';
import './recipes/annual5PhaseRecipe.js';
import './recipes/imagelessGlareRecipe.js';
import './recipes/enIlluminanceRecipe.js';
import './recipes/enUgrRecipe.js';
import './recipes/en17037Recipe.js';
import './recipes/lightingEnergyRecipe.js';
import './recipes/facadeIrradiationRecipe.js';
import './recipes/annualRadiationRecipe.js';
import './recipes/spectralLarkRecipe.js';

class Project {
    constructor() {
        this.projectName = 'default-project';
        this.epwFileContent = null;
        this.simulationFiles = {};
        this.dirHandle = null; // For Web File System Access API (browser)
        this.dirPath = null;   // For Node.js fs module path (Electron)
    }

    setEpwData(epwData) {
        this.epwFileContent = epwData;
    }

    addSimulationFile(inputId, fileName, content) {
        if (!fileName || !content) {
            delete this.simulationFiles[inputId];
        } else {
            this.simulationFiles[inputId] = {
                name: fileName,
                content: content
            };
        }
    }

    gatherSimulationParameters() {
        const simParams = {
            global: {},
            recipes: []
        };

        // 1. Gather Global Parameters from the dedicated panel
        const globalPanel = document.querySelector('.floating-window[data-template-id="template-global-sim-params"]');
        if (globalPanel) {
            const panelData = {};
            // Assuming global panel inputs have simple IDs without suffixes
            globalPanel.querySelectorAll('input, select').forEach(input => {
                const key = input.id;
                panelData[key] = (input.type === 'checkbox' || input.type === 'radio') ? input.checked : input.value;
            });
            simParams.global = panelData;
        }

        // 2. Gather parameters from ALL legacy floating recipe panels (backwards compatibility)
        document.querySelectorAll('.floating-window[data-template-id^="template-recipe-"]').forEach(panel => {
            const templateId = panel.dataset.templateId;
            const panelIdSuffix = panel.id.split('-').pop();

            const recipeData = {
                templateId,
                values: {}
            };

            panel.querySelectorAll('input, select').forEach(input => {
                // Reconstruct the original base ID by removing the unique suffix
                const key = input.id.replace(`-${panelIdSuffix}`, '');
                if (!key) return;

                if (input.type === 'file') {
                    // For files, we save a reference; the actual content is saved elsewhere
                    if (this.simulationFiles[key]) {
                        recipeData.values[key] = { name: this.simulationFiles[key].name };
                    } else {
                        recipeData.values[key] = null;
                    }
                } else {
                    recipeData.values[key] =
                        (input.type === 'checkbox' || input.type === 'radio')
                            ? input.checked
                            : input.value;
                }
            });

            if (Object.keys(recipeData.values).length > 0) {
                simParams.recipes.push(recipeData);
            }
        });

        // 3. New canonical: capture the single active recipe from the sidebar container, if present.
        const sidebarContainer = document.querySelector('#recipe-parameters-container');
        const activeTemplateId = sidebarContainer?.dataset?.activeRecipeTemplate;
        const activePanel = sidebarContainer ? sidebarContainer.firstElementChild : null;

        if (activeTemplateId && activePanel) {
            const panelIdSuffix = activePanel.id.split('-').pop();
            const activeValues = {};

            activePanel.querySelectorAll('input, select').forEach(input => {
                const key = input.id.replace(`-${panelIdSuffix}`, '');
                if (!key) return;

                if (input.type === 'file') {
                    if (this.simulationFiles[key]) {
                        activeValues[key] = { name: this.simulationFiles[key].name };
                    } else {
                        activeValues[key] = null;
                    }
                } else {
                    activeValues[key] =
                        (input.type === 'checkbox' || input.type === 'radio')
                            ? input.checked
                            : input.value;
                }
            });

            // Only set activeRecipe if we actually collected something.
            if (Object.keys(activeValues).length > 0) {
                simParams.activeRecipe = {
                    templateId: activeTemplateId,
                    values: activeValues
                };
            }

            // For backwards compatibility, ensure recipes[] contains this active recipe as first entry.
            if (simParams.activeRecipe) {
                // Remove previous entries for this templateId
                simParams.recipes = simParams.recipes.filter(r => r.templateId !== activeTemplateId);
                simParams.recipes.unshift({
                    templateId: activeTemplateId,
                    values: activeValues
                });
            }
        }

        return simParams;
    }

    async gatherAllProjectData() {
        // Import UI module to get access to dom
        const ui = await import('./ui.js');
        const dom = ui.getDom();

        const getValue = (id, parser = val => val) => {
            if (!dom[id]) {
                console.warn(`DOM element with id '${id}' not found`);
                return null;
            }
            const value = dom[id].value;
            if (value === undefined || value === null || value === '') return null;
            try {
                const parsed = parser(value);
                // Check if parseFloat returned NaN
                if (parser === parseFloat && isNaN(parsed)) {
                    console.warn(`Failed to parse numeric value for '${id}': "${value}"`);
                    return null;
                }
                return parsed;
            } catch (error) {
                console.error(`Error parsing value for '${id}':`, error);
                return null;
            }
        };
        const getChecked = (id) => {
            if (!dom[id]) {
                console.warn(`DOM element with id '${id}' not found`);
                return null;
            }
            return dom[id].checked;
        };
        const getTextContent = (id) => {
            if (!dom[id]) {
                console.warn(`DOM element with id '${id}' not found`);
                return null;
            }
            return dom[id].textContent;
        };
        const getClassListContains = (id, className) => {
            if (!dom[id]) {
                console.warn(`DOM element with id '${id}' not found`);
                return false;
            }
            return dom[id].classList.contains(className);
        };

        this.projectName = getValue('project-name') || 'default-project';

        // Import helper functions from UI module
        const { getAllWindowParams, getAllShadingParams, getSavedViews } = ui;

        const projectData = {
            projectInfo: {
                'project-name': this.projectName,
                'project-desc': getValue('project-desc'),
                'building-type': getValue('building-type'),
                'radiance-path': getValue('radiance-path'),
                'latitude': getValue('latitude'),
                'longitude': getValue('longitude'),
                epwFileName: this.epwFileContent ? (getTextContent('epw-file-name') || 'climate.epw') : null,
            },
            geometry: {
                room: {
                    width: getValue('width', parseFloat),
                    length: getValue('length', parseFloat),
                    height: getValue('height', parseFloat),
                    elevation: getValue('elevation', parseFloat),
                    'room-orientation': getValue('room-orientation', parseFloat),
                },
                mode: await (async () => {
                    const { isCustomGeometry } = await import('./geometry.js');
                    if (isCustomGeometry) return 'custom';
                    return dom['mode-import-btn']?.classList.contains('active') ? 'imported' : 'parametric';
                })(),
                apertures: getAllWindowParams(),
                shading: getAllShadingParams(),
                frames: {
                    enabled: getChecked('frame-toggle'),
                    thickness: getValue('frame-thick', parseFloat),
                    depth: getValue('frame-depth', parseFloat)
                },
                furniture: (async () => {
                    const { furnitureObject } = await import('./geometry.js');
                    const furnitureData = [];
                    // The container is now guaranteed to be the first child.
                    if (furnitureObject.children.length > 0 && furnitureObject.children[0].children) {
                        const furnitureContainer = furnitureObject.children[0];
                        furnitureContainer.children.forEach(obj => {
                            furnitureData.push({
                                assetType: obj.userData.assetType,
                                position: obj.position.toArray(),
                                quaternion: obj.quaternion.toArray(),
                                scale: obj.scale.toArray(),
                            });
                        });
                    }
                    return furnitureData;
                })(),
                vegetation: (async () => {
                    const { vegetationObject } = await import('./geometry.js');
                    const vegetationData = [];
                    if (vegetationObject.children.length > 0 && vegetationObject.children[0].children) {
                        const vegetationContainer = vegetationObject.children[0];
                        vegetationContainer.children.forEach(obj => {
                            vegetationData.push({
                                assetType: obj.userData.assetType,
                                position: obj.position.toArray(),
                                quaternion: obj.quaternion.toArray(),
                                scale: obj.scale.toArray(),
                            });
                        });
                    }
                    return vegetationData;
                })(),
                contextMassing: (async () => {
                    const { contextObject } = await import('./geometry.js');
                    const massingData = [];
                    contextObject.children.forEach(obj => {
                        if (obj.userData.isMassingBlock) {
                            // Combine userData (for geometry) with live transform data
                            const dataToSave = {
                                ...obj.userData,
                                position: obj.position.toArray(), // Overwrite userData.position with the live one
                                quaternion: obj.quaternion.toArray(),
                                scale: obj.scale.toArray()
                            };
                            massingData.push(dataToSave);
                        }
                    });
                    return massingData;
                })(),
                customGeometry: (async () => {
                    const { isCustomGeometry, wallSelectionGroup } = await import('./geometry.js');
                    if (!isCustomGeometry) return null;

                    const { getCustomWallData } = await import('./customApertureManager.js');
                    const wallContainer = wallSelectionGroup.children[0];
                    if (!wallContainer) return null;

                    // Reconstruct points from wall data
                    // We stored p1, p2 in userData
                    const points = [];
                    // We only need p1 from each wall, plus p2 of the last wall?
                    // Or just all p1s.
                    // The walls are ordered wall_0, wall_1...
                    // Let's iterate by ID
                    const walls = [];
                    let height = 3.0; // Default

                    // Sort children by ID to ensure order
                    const sortedChildren = [...wallContainer.children].sort((a, b) => {
                        const idA = parseInt(a.userData.canonicalId.split('_')[1]);
                        const idB = parseInt(b.userData.canonicalId.split('_')[1]);
                        return idA - idB;
                    });

                    sortedChildren.forEach(wallGroup => {
                        points.push(wallGroup.userData.p1);
                        // Store wall specific data (apertures, shading)
                        const wallData = getCustomWallData(wallGroup.userData.canonicalId);
                        if (wallData) {
                            walls.push({
                                id: wallGroup.userData.canonicalId,
                                data: wallData
                            });
                            height = wallData.dimensions.height; // Assume uniform height
                        }
                    });

                    return {
                        points: points,
                        height: height,
                        walls: walls
                    };
                })(),
            },
            materials: (() => {
                const getMaterialData = (type) => {
                    const mode = dom[`${type}-mode-srd`]?.classList.contains('active') ? 'srd' : 'refl';
                    const data = {
                        type: getValue(`${type}-mat-type`),
                        mode: mode,
                        reflectance: getValue(`${type}-refl`, parseFloat),
                        specularity: getValue(`${type}-spec`, parseFloat),
                        roughness: getValue(`${type}-rough`, parseFloat),
                        srdFile: null
                    };
                    if (mode === 'srd' && this.simulationFiles[`${type}-srd-file`]) {
                        data.srdFile = {
                            inputId: `${type}-srd-file`,
                            name: this.simulationFiles[`${type}-srd-file`].name
                        };
                    }
                    return data;
                };

                return {
                    wall: getMaterialData('wall'),
                    floor: getMaterialData('floor'),
                    ceiling: getMaterialData('ceiling'),
                    frame: { type: getValue('frame-mat-type'), reflectance: getValue('frame-refl', parseFloat), specularity: getValue('frame-spec', parseFloat), roughness: getValue('frame-rough', parseFloat) },
                    shading: { type: getValue('shading-mat-type'), reflectance: getValue('shading-refl', parseFloat), specularity: getValue('shading-spec', parseFloat), roughness: getValue('shading-rough', parseFloat) },
                    furniture: { type: getValue('furniture-mat-type'), reflectance: getValue('furniture-refl', parseFloat), specularity: getValue('furniture-spec', parseFloat), roughness: getValue('furniture-rough', parseFloat) },
                    glazing: {
                        transmittance: getValue('glazing-trans', parseFloat),
                        bsdfEnabled: getChecked('bsdf-toggle'),
                        bsdfFile: getChecked('bsdf-toggle') && this.simulationFiles['bsdf-file'] ? { inputId: 'bsdf-file', name: this.simulationFiles['bsdf-file'].name } : null
                    },
                };
            })(),
            lighting: lightingManager.getCurrentState(),
            sensorGrids: ui.getSensorGridParams(),
            viewpoint: {
                'view-type': getValue('view-type'), 'gizmo-toggle': getChecked('gizmo-toggle'),
                'view-pos-x': getValue('view-pos-x', parseFloat), 'view-pos-y': getValue('view-pos-y', parseFloat), 'view-pos-z': getValue('view-pos-z', parseFloat),
                'view-dir-x': getValue('view-dir-x', parseFloat), 'view-dir-y': getValue('view-dir-y', parseFloat), 'view-dir-z': getValue('view-dir-z', parseFloat),
                'view-fov': getValue('view-fov', parseFloat), 'view-dist': getValue('view-dist', parseFloat)
            },
            viewOptions: {
                projection: dom['proj-btn-persp']?.classList.contains('active') ? 'perspective' : 'orthographic',
                transparent: getChecked('transparent-toggle'),
                ground: getChecked('ground-plane-toggle'),
                worldAxes: getChecked('world-axes-toggle'),
                worldAxesSize: getValue('world-axes-size', parseFloat),
                hSection: { enabled: getChecked('h-section-toggle'), dist: getValue('h-section-dist', parseFloat) },
                vSection: { enabled: getChecked('v-section-toggle'), dist: getValue('v-section-dist', parseFloat) }
            },
            savedViews: getSavedViews().map(view => ({
                name: view.name,
                thumbnail: view.thumbnail,
                cameraState: {
                    position: view.cameraState.position.toArray(),
                    quaternion: view.cameraState.quaternion.toArray(),
                    zoom: view.cameraState.zoom,
                    target: view.cameraState.target.toArray(),
                    viewType: view.cameraState.viewType,
                    fov: view.cameraState.fov
                }
            })),
            topography: {
                enabled: getChecked('context-mode-topo'),
                heightmapFile: this.simulationFiles['topo-heightmap-file'] ? {
                    inputId: 'topo-heightmap-file',
                    name: this.simulationFiles['topo-heightmap-file'].name
                } : null,
                planeSize: getValue('topo-plane-size', parseFloat),
                verticalScale: getValue('topo-vertical-scale', parseFloat)
            },
            visualization: {
                compareMode: getChecked('compare-mode-toggle'),
                activeView: document.querySelector('#view-mode-selector .btn.active')?.id.replace('view-mode-', '').replace('-btn', '') || 'a',
                scaleMin: getValue('results-scale-min', parseFloat),
                scaleMax: getValue('results-scale-max', parseFloat),
                palette: getValue('results-palette'),
                activeMetric: getValue('metric-selector'),
            },
            occupancy: {
                enabled: getChecked('occupancy-toggle'),
                fileName: getValue('occupancy-schedule-filename'),
                timeStart: getValue('occupancy-time-range-start', parseFloat),
                timeEnd: getValue('occupancy-time-range-end', parseFloat),
                days: (() => {
                    const days = {};
                    const dayMap = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
                    document.querySelectorAll('.occupancy-day').forEach((el, i) => {
                        days[dayMap[i]] = el.checked;
                    });
                    return days;
                })()
            },
            epwFileContent: this.epwFileContent,
            simulationFiles: this.simulationFiles,
            simulationParameters: this.gatherSimulationParameters()
        };

        // Await the promises from the async IIFEs to get the actual data
        projectData.geometry.furniture = await projectData.geometry.furniture;
        projectData.geometry.vegetation = await projectData.geometry.vegetation;
        projectData.geometry.contextMassing = await projectData.geometry.contextMassing;
        projectData.geometry.customGeometry = await projectData.geometry.customGeometry;

        return projectData;
    }

    async requestProjectDirectory() {
        const { showAlert, getDom } = await import('./ui.js');
        const dom = getDom();

        // --- Electron Environment ---
        if (window.electronAPI) {
            const path = await window.electronAPI.openDirectory();
            if (path) {
                this.dirPath = path;
                this.dirHandle = null; // Clear the handle if we're using a path in Electron
                dom['project-access-prompt']?.classList.add('hidden');
                showAlert(`Project folder set to: ${path}`, 'Directory Set');
                return true;
            }
            return false;
        }

        // --- Browser Environment Fallback (for testing in browser without Electron) ---
        if (!window.showDirectoryPicker) {
            showAlert("Your browser does not support the File System Access API. Please use a modern browser like Chrome or Edge.", "Feature Not Supported");
            return false;
        }
        try {
            const dirHandle = await window.showDirectoryPicker();
            this.dirHandle = dirHandle;
            this.dirPath = null; // Clear the path if we're using a handle
            dom['project-access-prompt']?.classList.add('hidden');
            showAlert('Project folder selected. Future saves will go here directly.', 'Directory Set');
            return true;
        } catch (error) {
            if (error.name !== 'AbortError') console.error("Error selecting directory:", error);
            return false;
        }
    }

    async generateSimulationPackage(panelElement, uniqueId = null) {
        const { showAlert } = await import('./ui.js');
        const { generateRadFileContent, generateRayFileContent } = await import('./radiance.js');
        const { GeometryOptimizer } = await import('./geometryOptimizer.js');

        // 1. Check if a project directory is open
        if (!this.dirHandle && !this.dirPath) {
            showAlert('Please save or load a project directory first before generating scripts.', 'Project Directory Not Set');
            return null;
        }

        // --- NEW: Optimization Step ---
        const optimizer = new GeometryOptimizer();
        const optimizedGroup = await optimizer.run();

        // 2. Gather data and generate script content
        const projectData = await this.gatherAllProjectData();

        // Inject optimized geometry if available
        if (optimizedGroup) {
            projectData.geometry.optimizedGeometry = optimizedGroup;
        }

        const projectName = projectData.projectInfo['project-name']?.replace(/\s+/g, '_') || 'scene';
        this.projectName = projectName;

        const simParams = projectData.simulationParameters || { global: {}, recipes: [] };
        const globalParams = simParams.global || {};
        const recipeOverrides = {};
        const recipeContainer = panelElement.querySelector('#recipe-parameters-container');
        const activeRecipePanel = recipeContainer ? recipeContainer.firstElementChild : null;

        if (activeRecipePanel) {
            const panelIdSuffix = activeRecipePanel.id.split('-').pop();
            activeRecipePanel.querySelectorAll('input, select').forEach(input => {
                const key = input.id.replace(`-${panelIdSuffix}`, '');
                if (!key) return;

                if (input.type === 'file') {
                    if (this.simulationFiles[key]) {
                        recipeOverrides[key] = {
                            name: this.simulationFiles[key].name,
                            content: this.simulationFiles[key].content
                        };
                    } else {
                        recipeOverrides[key] = null;
                    }
                } else {
                    recipeOverrides[key] =
                        input.type === 'checkbox' || input.type === 'radio'
                            ? input.checked
                            : input.value;
                }
            });
        }

        // Keep legacy mergedSimParams for non-registry recipes.
        projectData.mergedSimParams = { ...globalParams, ...recipeOverrides };

        // Sync the active recipe overrides into simulationParameters so that
        // configMappers + RecipeRegistry see the same values the user edits
        // in the sidebar. This enforces "one package = one active recipe".
        const recipeType = panelElement.dataset.templateId;
        if (recipeType) {
            const syncedSimParams = {
                global: globalParams,
                recipes: Array.isArray(simParams.recipes) ? [...simParams.recipes] : []
            };

            // Remove any existing entry for this recipeType
            for (let i = syncedSimParams.recipes.length - 1; i >= 0; i--) {
                if (syncedSimParams.recipes[i].templateId === recipeType) {
                    syncedSimParams.recipes.splice(i, 1);
                }
            }

            // Add current active overrides as the canonical entry (single active recipe per run)
            const activeEntry = {
                templateId: recipeType,
                values: recipeOverrides
            };
            syncedSimParams.recipes.push(activeEntry);

            // Also expose canonical activeRecipe for configMappers / registry consumers
            syncedSimParams.activeRecipe = activeEntry;

            projectData.simulationParameters = syncedSimParams;
        }

        // --- Add uniqueId to projectData for generateScripts ---
        if (uniqueId) {
            projectData.uniqueId = uniqueId;
        }
        // --- End of addition ---

        // Generate all necessary input files in memory first.
        const { materials, geometry } = await generateRadFileContent(projectData);
        const viewpointContent = generateViewpointFileContent(projectData.viewpoint, projectData.geometry.room);
        const fisheyeVpData = { ...projectData.viewpoint, 'view-type': 'h' };
        const fisheyeContent = generateViewpointFileContent(fisheyeVpData, projectData.geometry.room);
        const allPtsContent = await this._generateSensorPointsContent('all');
        const taskPtsContent = await this._generateSensorPointsContent('task');
        const surroundingPtsContent = await this._generateSensorPointsContent('surrounding');
        const rayContent = await generateRayFileContent();

        // Determine active recipe definition (if any) from the registry.
        const recipeDef = getRecipeById(recipeType);

        let scriptsToGenerate;
        if (recipeDef) {
            // New path: use RecipeRegistry-based definition (non-breaking).
            // Build config from current simulation parameters and active selection.
            const simParamsForConfig = projectData.simulationParameters || { global: {}, recipes: [] };
            const activeSelection = getActiveRecipeSelection(panelElement, simParamsForConfig);
            const config = buildRecipeConfig(
                recipeDef,
                projectData,
                simParamsForConfig,
                this.simulationFiles,
                activeSelection
            );

            const validation = recipeDef.validate(projectData, config);
            if (validation.errors && validation.errors.length > 0) {
                const { showAlert } = await import('./ui.js');
                const errorHtml =
                    '<p>The selected simulation recipe configuration is invalid:</p>' +
                    '<ul class="list-disc pl-5 space-y-1">' +
                    validation.errors.map(e => `<li>${e}</li>`).join('') +
                    '</ul>';
                showAlert(errorHtml, 'Cannot Generate Package: Invalid Configuration');
                return null;
            }
            if (validation.warnings && validation.warnings.length > 0) {
                console.warn('Simulation recipe warnings:', validation.warnings);
            }

            scriptsToGenerate = recipeDef.generateScripts(projectData, config);
        } else {
            // Fallback to legacy behavior for recipes not yet migrated.
            scriptsToGenerate = generateScripts(projectData, recipeType);
        }

        if (scriptsToGenerate.length === 0) {
            showAlert('Could not generate any scripts for this recipe.', 'Generation Failed');
            return null;
        }

        // 3. Structure all files to be written
        const filesToWrite = [
            { path: ['01_geometry', `${projectName}.rad`], content: geometry },
            { path: ['02_materials', `${projectName}_materials.rad`], content: materials },
            { path: ['03_views', 'viewpoint.vf'], content: viewpointContent },
            { path: ['03_views', 'viewpoint_fisheye.vf'], content: fisheyeContent },
            { path: ['08_results', 'grid.pts'], content: allPtsContent },
            { path: ['08_results', 'task_grid.pts'], content: taskPtsContent },
            { path: ['08_results', 'surrounding_grid.pts'], content: surroundingPtsContent },
            { path: ['08_results', 'view_grid.ray'], content: rayContent }
        ].filter(f => f.content !== null && f.content !== undefined);

        const makeExecutableContent = `#!/bin/bash\n# Makes all .sh scripts in this directory executable.\nchmod +x ./*.sh\necho "All scripts are now executable."`;
        scriptsToGenerate.push({ fileName: 'make_executable.sh', content: makeExecutableContent });

        scriptsToGenerate.forEach(script => {
            filesToWrite.push({ path: ['07_scripts', script.fileName], content: script.content });
        });

        // 4. Write all files using the appropriate method for the environment
        try {
            if (window.electronAPI && this.dirPath) {
                // Electron Method
                await window.electronAPI.saveProject({ projectPath: this.dirPath, files: filesToWrite });
            } else if (this.dirHandle) {
                // Browser Method
                const writeFile = async (dirHandle, filename, content) => {
                    if (content === null || content === undefined) return;
                    const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
                    const writable = await fileHandle.createWritable();
                    await writable.write(content);
                    await writable.close();
                };

                for (const file of filesToWrite) {
                    let currentHandle = this.dirHandle;
                    for (let i = 0; i < file.path.length - 1; i++) {
                        currentHandle = await currentHandle.getDirectoryHandle(file.path[i], { create: true });
                    }
                    await writeFile(currentHandle, file.path[file.path.length - 1], file.content);
                }
            } else {
                throw new Error("No valid directory path or handle is available for saving.");
            }

            showAlert(`Scripts and input files saved successfully to your project directory.`, 'Package Generated');

            // 5. Return the script details for the UI
            const shScript = scriptsToGenerate.find(s => s.fileName.endsWith('.sh'));
            const batScript = scriptsToGenerate.find(s => s.fileName.endsWith('.bat'));
            const displayContent = shScript ? shScript.content : (batScript ? batScript.content : null);

            if (!displayContent) return null;

            return {
                content: displayContent,
                shFile: shScript ? shScript.fileName : null,
                batFile: batScript ? batScript.fileName : null
            };

        } catch (error) {
            console.error("Failed to write simulation package to project directory:", error);
            showAlert(`Error saving package: ${error.message}`, 'File System Error');
            return null;
        }
    }

    async downloadProjectFile() {
        const { showAlert } = await import('./ui.js');

        // 1. Check for a valid save location (either an Electron path or a Browser handle).
        // If none exists, prompt the user to select one.
        if (!this.dirPath && !this.dirHandle) {
            const gotLocation = await this.requestProjectDirectory();
            // Abort the save if the user cancels the directory selection dialog.
            if (!gotLocation) return;
        }

        try {
            const projectData = await this.gatherAllProjectData();
            const projectName = this.projectName || 'project';

            // Ensure the canonical activeRecipe is present for persisted settings
            if (projectData.simulationParameters && projectData.simulationParameters.activeRecipe) {
                const { templateId, values } = projectData.simulationParameters.activeRecipe;
                if (templateId && values) {
                    projectData.simulationParameters.recipes = Array.isArray(projectData.simulationParameters.recipes)
                        ? projectData.simulationParameters.recipes.filter(r => r.templateId !== templateId)
                        : [];
                    projectData.simulationParameters.recipes.unshift({ templateId, values });
                }
            }

            // 2. Generate all file contents in memory first.
            const { materials, geometry } = await generateRadFileContent(projectData);
            const viewpointContent = generateViewpointFileContent(projectData.viewpoint, projectData.geometry.room);
            const fisheyeVpData = { ...projectData.viewpoint, 'view-type': 'h' };
            const fisheyeContent = generateViewpointFileContent(fisheyeVpData, projectData.geometry.room);
            const allPtsContent = await this._generateSensorPointsContent('all');
            const taskPtsContent = await this._generateSensorPointsContent('task');
            const surroundingPtsContent = await this._generateSensorPointsContent('surrounding');
            const daylightingPtsContent = await this._generateDaylightingPointsContent();
            const rayContent = await generateRayFileContent();

            // Generate .vf files for each saved camera view
            const savedViewsData = projectData.savedViews || [];

            // Sanitize the project data for JSON serialization by removing large file contents.
            const dataForJson = JSON.parse(JSON.stringify(projectData));
            dataForJson.epwFileContent = null;
            if (dataForJson.simulationFiles) {
                Object.values(dataForJson.simulationFiles).forEach(file => { if (file) file.content = null; });
            }
            const projectJsonContent = JSON.stringify(dataForJson, null, 2);

            // 3. Structure all generated content into a list of file objects.
            let filesToWrite = [
                { path: ['01_geometry', `${projectName}.rad`], content: geometry },
                { path: ['02_materials', `${projectName}_materials.rad`], content: materials },
                { path: ['03_views', 'viewpoint.vf'], content: viewpointContent },
                { path: ['03_views', 'viewpoint_fisheye.vf'], content: fisheyeContent },
                { path: ['08_results', 'grid.pts'], content: allPtsContent },
                { path: ['08_results', 'task_grid.pts'], content: taskPtsContent },
                { path: ['08_results', 'surrounding_grid.pts'], content: surroundingPtsContent },
                { path: ['08_results', 'view_grid.ray'], content: rayContent },
                { path: [`${projectName}.json`], content: projectJsonContent }
            ];

            savedViewsData.forEach((view, index) => {
                // De-serialize the state for the generation function
                const cameraStateForVf = {
                    position: new THREE.Vector3().fromArray(view.cameraState.position),
                    quaternion: new THREE.Quaternion().fromArray(view.cameraState.quaternion),
                    viewType: view.cameraState.viewType,
                    fov: view.cameraState.fov,
                };
                const viewFileContent = generateViewpointFileContentFromState(cameraStateForVf);
                if (viewFileContent) {
                    filesToWrite.push({ path: ['03_views', `saved_view_${index + 1}.vf`], content: viewFileContent });
                }
            });

            if (daylightingPtsContent) {
                filesToWrite.push({ path: ['08_results', 'daylighting_sensors.pts'], content: daylightingPtsContent });
            }
            // Add topography heightmap to the files to be written
            const topoFile = this.simulationFiles['topo-heightmap-file'];
            if (topoFile?.name && topoFile.content) {
                filesToWrite.push({ path: ['12_topography', topoFile.name], content: topoFile.content });
            }
            if (projectData.epwFileContent && projectData.projectInfo.epwFileName) {
                filesToWrite.push({ path: ['04_skies', projectData.projectInfo.epwFileName], content: projectData.epwFileContent });
            }
            if (projectData.simulationFiles) {
                for (const key in projectData.simulationFiles) {
                    const fileData = projectData.simulationFiles[key];
                    if (fileData?.name && fileData.content) {
                        const targetDir = key.includes('bsdf') ? '05_bsdf' : key.includes('schedule') ? '10_schedules' : '11_files';
                        filesToWrite.push({ path: [targetDir, fileData.name], content: fileData.content });
                    }
                }
            }
            // Filter out any files that might not have content.
            filesToWrite = filesToWrite.filter(f => f.content !== null && f.content !== undefined);

            // 4. Write the files using the appropriate method based on the environment.
            if (window.electronAPI && this.dirPath) {
                // Electron Method: Send all data to the main process for efficient file writing.
                await window.electronAPI.saveProject({ projectPath: this.dirPath, files: filesToWrite });
            } else if (this.dirHandle) {
                // Browser Method: Use the File System Access API to write files one by one.
                for (const file of filesToWrite) {
                    let currentHandle = this.dirHandle;
                    // Create subdirectories as needed.
                    for (let i = 0; i < file.path.length - 1; i++) {
                        currentHandle = await currentHandle.getDirectoryHandle(file.path[i], { create: true });
                    }
                    const fileHandle = await currentHandle.getFileHandle(file.path[file.path.length - 1], { create: true });
                    const writable = await fileHandle.createWritable();

                    let contentToWrite = file.content;
                    // Safeguard: If content is a plain object, stringify it before writing.
                    if (typeof contentToWrite === 'object' && contentToWrite !== null && !(contentToWrite instanceof Blob) && !(contentToWrite instanceof ArrayBuffer) && !ArrayBuffer.isView(contentToWrite)) {
                        console.warn(`Content for ${file.path.join('/')} was an object. Auto-stringifying.`, contentToWrite);
                        contentToWrite = JSON.stringify(contentToWrite, null, 2);
                    }

                    await writable.write(contentToWrite);
                    await writable.close();
                }
            } else {
                throw new Error("No valid directory path or handle is available for saving.");
            }

            showAlert(`Project '${projectName}' saved successfully.`, 'Project Saved');

        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error("Failed to save project:", error);
                showAlert(`Error saving project: ${error.message}`, 'Save Error');
            }
        }
    }

    async runLivePreviewRender() {
        if (!window.electronAPI || !window.electronAPI.runLiveRender) {
            throw new Error("Live rendering is not supported in this environment.");
        }

        const { getDom } = await import('./ui.js');
        const dom = getDom();

        const projectData = await this.gatherAllProjectData();
        const date = dom['preview-date']._flatpickr.selectedDates[0];
        const time = dom['preview-time'].value;

        if (!date || !time) {
            throw new Error("Please select a valid date and time for the preview.");
        }

        const month = date.getMonth() + 1;
        const day = date.getDate();
        const [hour, minute] = time.split(':');
        const decimalTime = parseInt(hour, 10) + parseInt(minute, 10) / 60;

        const { materials, geometry } = await generateRadFileContent(projectData);
        const viewpointContent = generateViewpointFileContent(projectData.viewpoint, projectData.geometry.room);

        const payload = {
            epwContent: this.epwFileContent,
            geometryContent: geometry,
            materialsContent: materials,
            viewpointContent: viewpointContent,
            month,
            day,
            time: decimalTime
        };

        // Call the backend to perform the render
        const result = await window.electronAPI.runLiveRender(payload);
        return result;
    }

    async _generateSensorPointsContent(gridType = 'all') {
        const { getDom, showAlert, getSensorGridParams } = await import('./ui.js');
        const dom = getDom();
        const points = [];

        // Safely get dimension values
        const getDimension = (id) => {
            if (!dom[id]) {
                console.warn(`DOM element with id '${id}' not found`);
                return 0;
            }
            const value = parseFloat(dom[id].value);
            return isNaN(value) ? 0 : value;
        };
        const W = getDimension('width');
        const L = getDimension('length');
        const H = getDimension('height');
        const alphaRad = THREE.MathUtils.degToRad(getDimension('room-orientation'));
        const cosA = Math.cos(alphaRad);
        const sinA = Math.sin(alphaRad);

        // Use the new, centralized utility functions from radiance.js
        const transformPoint = (localPoint) => transformThreePointToRadianceArray(localPoint, W, L, cosA, sinA);
        const transformVector = (localVector) => transformThreeVectorToRadianceArray(localVector, cosA, sinA);

        const generatePointsInRect = (x, z, width, depth, spacing) => {
            if (spacing <= 0 || width <= 0 || depth <= 0) return [];
            const rectPositions = [];
            const numX = Math.floor(width / spacing);
            const numZ = Math.floor(depth / spacing);
            if (numX === 0 || numZ === 0) return [];

            const startX = x + (width - (numX > 1 ? (numX - 1) * spacing : 0)) / 2;
            const startZ = z + (depth - (numZ > 1 ? (numZ - 1) * spacing : 0)) / 2;

            for (let i = 0; i < numX; i++) {
                for (let j = 0; j < numZ; j++) {
                    rectPositions.push({ x: startX + i * spacing, z: startZ + j * spacing });
                }
            }
            return rectPositions;
        };

        const enGridParams = getSensorGridParams()?.illuminance?.floor;

        if (gridType === 'task') {
            if (!enGridParams?.isTaskArea) return null;
            const spacing = getDimension('floor-grid-spacing');
            const offset = getDimension('floor-grid-offset');
            if (spacing <= 0) return null;
            const { x, z, width, depth } = enGridParams.task;

            const taskPoints = generatePointsInRect(x, z, width, depth, spacing);
            const normalVector = [0, 0, 1]; // Normal for a horizontal plane

            for (const p of taskPoints) {
                const localPos = [p.x, p.z, offset];
                const worldPos = transformPoint(localPos);
                const worldNorm = transformVector(normalVector);
                points.push(`${worldPos.map(c => c.toFixed(4)).join(' ')} ${worldNorm.map(c => c.toFixed(4)).join(' ')}`);
            }
        } else if (gridType === 'surrounding') {
            if (!enGridParams?.isTaskArea || !enGridParams?.hasSurrounding) return null;

            const spacing = getDimension('floor-grid-spacing');
            const offset = getDimension('floor-grid-offset');
            if (spacing <= 0) return null;
            const task = enGridParams.task;
            const bandWidth = enGridParams.surroundingWidth;

            // Define outer rectangle (task area + surrounding band), clamped to room dimensions
            const outerX = Math.max(0, task.x - bandWidth);
            const outerZ = Math.max(0, task.z - bandWidth);
            const outerW = Math.min(W - outerX, task.width + 2 * bandWidth);
            const outerD = Math.min(L - outerZ, task.depth + 2 * bandWidth);

            const outerPoints = generatePointsInRect(outerX, outerZ, outerW, outerD, spacing);
            const normalVector = [0, 0, 1];

            for (const p of outerPoints) {
                // Check if the point is OUTSIDE the inner task area
                const isOutsideTask = (p.x < task.x || p.x > task.x + task.width || p.z < task.z || p.z > task.z + task.depth);
                if (isOutsideTask) {
                    const localPos = [p.x, p.z, offset];
                    const worldPos = transformPoint(localPos);
                    const worldNorm = transformVector(normalVector);
                    points.push(`${worldPos.map(c => c.toFixed(4)).join(' ')} ${worldNorm.map(c => c.toFixed(4)).join(' ')}`);
                }
            }
        } else { // gridType === 'all'
            // Handle Custom Geometry vs Parametric
            const projectData = await this.gatherAllProjectData();
            const customGeom = projectData.geometry.customGeometry;
            const isCustom = projectData.geometry.mode === 'custom' || (customGeom && customGeom.points && customGeom.points.length > 2);

            console.log('[DEBUG] _generateSensorPointsContent:');
            console.log('  gridType:', gridType);
            console.log('  geometry.mode:', projectData.geometry.mode);
            console.log('  isCustom:', isCustom);
            console.log('  customGeom:', customGeom);
            if (customGeom && customGeom.points) {
                console.log('  customGeom.points.length:', customGeom.points.length);
                console.log('  customGeom.points[0]:', customGeom.points[0]);
            }

            if (isCustom) {
                console.log('[DEBUG] Using custom geometry grid generation');
                const { generatePolygonGridPoints } = await import('./radiance.js');
                const polygonPoints = customGeom.points; // {x, z}

                // --- Floor Grid ---
                if (dom['grid-floor-toggle']?.checked) {
                    const spacing = getDimension('floor-grid-spacing');
                    const offset = getDimension('floor-grid-offset');
                    console.log('[DEBUG] Generating floor grid: spacing=', spacing, 'offset=', offset);
                    const gridPoints = generatePolygonGridPoints(polygonPoints, spacing, offset, 0); // y = offset
                    console.log('[DEBUG] Generated', gridPoints.length, 'floor grid points');

                    // Radiance Up Vector (Z-up) corresponds to Three.js Y-up (0,1,0)
                    // Normal in Radiance format: 0 0 1
                    const radNormal = "0 0 1";

                    for (const pt of gridPoints) {
                        // pt is Three {x, y, z}. Radiance is {x, z, y}
                        points.push(`${pt.x.toFixed(4)} ${pt.z.toFixed(4)} ${pt.y.toFixed(4)} ${radNormal}`);
                    }
                }

                // --- Ceiling Grid ---
                if (dom['grid-ceiling-toggle']?.checked) {
                    const spacing = getDimension('ceiling-grid-spacing');
                    const offset = getDimension('ceiling-grid-offset');
                    const gridPoints = generatePolygonGridPoints(polygonPoints, spacing, H - offset, 0); // y = H - offset

                    // Normal in Radiance format: 0 0 -1 (Down)
                    const radNormal = "0 0 -1";

                    for (const pt of gridPoints) {
                        points.push(`${pt.x.toFixed(4)} ${pt.z.toFixed(4)} ${pt.y.toFixed(4)} ${radNormal}`);
                    }
                }

                // --- Wall Grids ---
                // If ANY wall grid is enabled, we assume user wants wall grids for the custom room
                const wallGridEnabled = dom['grid-north-toggle']?.checked || dom['grid-south-toggle']?.checked ||
                    dom['grid-east-toggle']?.checked || dom['grid-west-toggle']?.checked;

                if (wallGridEnabled) {
                    const spacing = getDimension('wall-grid-spacing');
                    const offset = getDimension('wall-grid-offset'); // Inward offset from wall surface

                    if (spacing > 0) {
                        for (let i = 0; i < polygonPoints.length; i++) {
                            const p1 = polygonPoints[i];
                            const p2 = polygonPoints[(i + 1) % polygonPoints.length];

                            const dx = p2.x - p1.x;
                            const dz = p2.z - p1.z;
                            const len = Math.sqrt(dx * dx + dz * dz);
                            if (len <= 0) continue;

                            // Calculate segment normal (Inward for CCW logic?)
                            // If points are CCW, normal (-dy, dx) is Inward (Left turn).
                            // We want to offset INWARD.
                            // Unit Normal
                            const nx = -dz / len;
                            const nz = dx / len;

                            // Grid iterations
                            const numH = Math.floor(len / spacing);
                            const numV = Math.floor(H / spacing);

                            // Center checks
                            // We'll just start from edge + spacing? Or center?
                            // Parametric logic centers it.
                            const totalLenH = (numH - 1) * spacing;
                            const startH = (len - totalLenH) / 2;

                            const totalLenV = (numV - 1) * spacing;
                            const startV = (H - totalLenV) / 2;

                            // Radiance Normal for this wall
                            // Wall Normal in Three: (nx, 0, nz)
                            // Radiance: (nx, nz, 0)
                            const radNormStr = `${nx.toFixed(4)} ${nz.toFixed(4)} 0`;

                            for (let u = 0; u < numH; u++) {
                                const hDist = startH + u * spacing;
                                // Point on line
                                const onLineX = p1.x + (dx / len) * hDist;
                                const onLineZ = p1.z + (dz / len) * hDist;

                                // Apply Inward Offset
                                const finalX = onLineX + nx * offset;
                                const finalZ = onLineZ + nz * offset;

                                for (let v = 0; v < numV; v++) {
                                    const yHeight = startV + v * spacing;
                                    // Radiance Point: X, Z, Y
                                    points.push(`${finalX.toFixed(4)} ${finalZ.toFixed(4)} ${yHeight.toFixed(4)} ${radNormStr}`);
                                }
                            }
                        }
                    }
                }

            } else {
                // Parametric Logic (Original)
                const generateCenteredPoints = (totalLength, spacing) => {
                    if (spacing <= 0 || totalLength <= 0) return [];
                    const numPoints = Math.floor(totalLength / spacing);
                    if (numPoints === 0) return [totalLength / 2];
                    const totalGridLength = (numPoints - 1) * spacing;
                    const start = (totalLength - totalGridLength) / 2;
                    return Array.from({ length: numPoints }, (_, i) => start + i * spacing);
                };

                const surfaces = [
                    { name: 'floor', enabled: dom['grid-floor-toggle']?.checked }, { name: 'ceiling', enabled: dom['grid-ceiling-toggle']?.checked },
                    { name: 'north', enabled: dom['grid-north-toggle']?.checked }, { name: 'south', enabled: dom['grid-south-toggle']?.checked },
                    { name: 'east', enabled: dom['grid-east-toggle']?.checked }, { name: 'west', enabled: dom['grid-west-toggle']?.checked },
                ];

                surfaces.forEach(({ name, enabled }) => {
                    if (!enabled) return;
                    let spacing, offset, points1, points2, positionFunc, normalVector;
                    if (name === 'floor' || name === 'ceiling') {
                        spacing = getDimension(`${name}-grid-spacing`);
                        offset = getDimension(`${name}-grid-offset`);
                        points1 = generateCenteredPoints(W, spacing);
                        points2 = generateCenteredPoints(L, spacing);
                        // CORRECTED: Define normals in Three.js coordinate system (Y-up)
                        normalVector = (name === 'floor') ? [0, 1, 0] : [0, -1, 0];
                        positionFunc = (p1, p2) => [p1, name === 'floor' ? offset : H + offset, p2]; // Y is height
                    } else {
                        spacing = getDimension('wall-grid-spacing');
                        offset = getDimension('wall-grid-offset');
                        points2 = generateCenteredPoints(H, spacing); // Height is vertical span
                        const wallLength = (name === 'north' || name === 'south') ? W : L;
                        points1 = generateCenteredPoints(wallLength, spacing); // Width/Length is horizontal span

                        // CORRECTED: Define normals in Three.js coordinate system (Y-up) and adjust positionFunc
                        switch (name) {
                            case 'north': normalVector = [0, 0, 1]; positionFunc = (p1, p2) => [p1, p2, offset]; break;
                            case 'south': normalVector = [0, 0, -1]; positionFunc = (p1, p2) => [p1, p2, L - offset]; break;
                            case 'west': normalVector = [1, 0, 0]; positionFunc = (p1, p2) => [offset, p2, p1]; break;
                            case 'east': normalVector = [-1, 0, 0]; positionFunc = (p1, p2) => [W - offset, p2, p1]; break;
                        }
                    }
                    for (const p1 of points1) {
                        for (const p2 of points2) {
                            const localPos = positionFunc(p1, p2);
                            const worldPos = transformPoint(localPos);
                            const worldNorm = transformVector(normalVector);
                            points.push(`${worldPos.map(c => c.toFixed(4)).join(' ')} ${worldNorm.map(c => c.toFixed(4)).join(' ')}`);
                        }
                    }
                });
            }
        }

        if (points.length === 0) {
            if (gridType === 'all') { // Only show alert for the main grid generation
                showAlert("No sensor grids enabled; sensor points file will be empty.", "Info");
            }
            return null;
        }
        return "# Radiance Sensor Points (X Y Z Vx Vy Vz)\n" + points.join('\n');
    }

    async _generateDaylightingPointsContent() {
        const lightingState = lightingManager.getCurrentState();
        if (!lightingState?.daylighting?.enabled || !lightingState.daylighting.sensors?.length) {
            return null; // No sensors to write
        }

        const { getDom } = await import('./ui.js');
        const dom = getDom();

        // Safely get dimension values
        const getDimension = (id) => {
            if (!dom[id]) {
                console.warn(`DOM element with id '${id}' not found`);
                return 0;
            }
            const value = parseFloat(dom[id].value);
            return isNaN(value) ? 0 : value;
        };
        const W = getDimension('width');
        const L = getDimension('length');
        const rotationY = getDimension('room-orientation');
        const alphaRad = THREE.MathUtils.degToRad(rotationY);
        const cosA = Math.cos(alphaRad);
        const sinA = Math.sin(alphaRad);

        const points = lightingState.daylighting.sensors.map(sensor => {
            // The sensor object contains {x, y, z} position and {x, y, z} direction
            const posThree = [sensor.x, sensor.y, sensor.z];
            const dirThree = [sensor.direction.x, sensor.direction.y, sensor.direction.z];

            // Use the new, centralized utility functions
            const worldPosArray = transformThreePointToRadianceArray(posThree, W, L, cosA, sinA);
            const worldNormArray = transformThreeVectorToRadianceArray(dirThree, cosA, sinA);

            const worldPos = worldPosArray.map(c => c.toFixed(4)).join(' ');
            const worldNorm = worldNormArray.map(c => c.toFixed(4)).join(' ');

            return `${worldPos} ${worldNorm}`;
        });

        return "# Radiance Daylighting Control Sensor Points (X Y Z Vx Vy Vz)\n" + points.join('\n');
    }

    async loadProject() {
        if (!window.showDirectoryPicker) {
            const { showAlert } = await import('./ui.js');
            showAlert("Your browser does not support the File System Access API, which is required to load project folders. Please use a modern browser like Chrome or Edge.", "Feature Not Supported");
            return;
        }

        try {
            const { showAlert } = await import('./ui.js');
            const dirHandle = await window.showDirectoryPicker();
            this.dirHandle = dirHandle; // Store the directory handle

            let jsonFileHandle;
            for await (const entry of dirHandle.values()) {
                if (entry.kind === 'file' && entry.name.endsWith('.json')) {
                    jsonFileHandle = entry;
                    break;
                }
            }
            if (!jsonFileHandle) throw new Error("No project .json file found in the selected directory.");

            const file = await jsonFileHandle.getFile();
            const settings = JSON.parse(await file.text());

            this.simulationFiles = {};
            this.epwFileContent = null;
            // Clear any existing saved views before loading new ones
            const { loadSavedViews } = await import('./ui.js');
            loadSavedViews([]);

            const readFileContent = async (pathSegments) => {
                try {
                    let currentHandle = dirHandle;
                    for (let i = 0; i < pathSegments.length - 1; i++) {
                        currentHandle = await currentHandle.getDirectoryHandle(pathSegments[i]);
                    }
                    const fileHandle = await currentHandle.getFileHandle(pathSegments[pathSegments.length - 1]);
                    return await (await fileHandle.getFile()).text();
                } catch (e) {
                    console.warn(`Could not read file at path: ${pathSegments.join('/')}`, e);
                    return null;
                }
            };

            const readFileAsBlob = async (pathSegments) => {
                try {
                    let currentHandle = dirHandle;
                    for (let i = 0; i < pathSegments.length - 1; i++) {
                        currentHandle = await currentHandle.getDirectoryHandle(pathSegments[i]);
                    }
                    const fileHandle = await currentHandle.getFileHandle(pathSegments[pathSegments.length - 1]);
                    return await fileHandle.getFile(); // Returns a File object (which is a Blob)
                } catch (e) {
                    console.warn(`Could not read file blob at path: ${pathSegments.join('/')}`, e);
                    return null;
                }
            };

            if (settings.projectInfo?.epwFileName) {
                const content = await readFileContent(['04_skies', settings.projectInfo.epwFileName]);
                if (content) this.setEpwData(content);
            }

            if (settings.simulationFiles) {
                const filePromises = Object.entries(settings.simulationFiles).map(async ([key, fileData]) => {
                    if (fileData?.name) {
                        const targetDir = key.includes('bsdf') ? '05_bsdf' : key.includes('schedule') ? '10_schedules' : '11_files';
                        const content = await readFileContent([targetDir, fileData.name]);
                        if (content) this.addSimulationFile(key, fileData.name, content);
                    }
                });
                // Restore the daylighting schedule file if it was saved with the lighting state
                const lightingScheduleInfo = settings.lighting?.daylighting?.scheduleFile;
                if (lightingScheduleInfo?.name) {
                    const content = await readFileContent(['10_schedules', lightingScheduleInfo.name]);
                    if (content) {
                        this.addSimulationFile('daylighting-availability-schedule', lightingScheduleInfo.name, content);
                    }
                }

                // Load topography heightmap as a Blob
                if (settings.topography?.heightmapFile?.name) {
                    const blob = await readFileAsBlob(['12_topography', settings.topography.heightmapFile.name]);
                    if (blob) {
                        // Store the blob directly, ui.js will create a URL from it
                        this.addSimulationFile('topo-heightmap-file', settings.topography.heightmapFile.name, blob);
                    }
                }

                await Promise.all(filePromises);
            }

            await this.applySettings(settings, showAlert);

            // Hide the initial prompt since a directory is now successfully loaded.
            const { getDom } = await import('./ui.js');
            const dom = getDom();
            dom['project-access-prompt']?.classList.add('hidden');

        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error("Failed to load project:", error);
                const { showAlert } = await import('./ui.js');
                showAlert(`Error loading project: ${error.message}`, 'Load Error');
            }
        }
    }

    async applySettings(settings, showAlertCallback) {
        // Dynamically import the UI module ONLY when settings are being applied.
        const ui = await import('./ui.js');
        const dom = ui.getDom(); // Get the dom cache from the loaded module

        // Wait a bit to ensure DOM is fully ready
        await new Promise(resolve => setTimeout(resolve, 100));

        // Define helper functions here, now that `dom` is guaranteed to be available.
        const setValue = (id, value) => {
            if (dom[id] && value !== null && value !== undefined) {
                dom[id].value = value;
                dom[id].dispatchEvent(new Event('input', { bubbles: true }));
                dom[id].dispatchEvent(new Event('change', { bubbles: true }));
            }
        };
        const setChecked = (id, isChecked) => {
            if (dom[id] && isChecked !== null && isChecked !== undefined) {
                dom[id].checked = isChecked;
                dom[id].dispatchEvent(new Event('change', { bubbles: true }));
            }
        };

        // --- Project Info & EPW ---
        Object.keys(settings.projectInfo).forEach(key => setValue(key, settings.projectInfo[key]));
        if (this.epwFileContent) {
            dom['epw-file-name'].textContent = settings.projectInfo.epwFileName || 'climate.epw';
        }

        // --- Geometry & Apertures ---
        if (settings.geometry.mode === 'imported') {
            showAlertCallback("This project uses an imported model. Please re-import the original .obj and .mtl files to continue.", "Model Import Required");
            ui.switchGeometryMode('imported');
        } else {
            ui.switchGeometryMode('parametric');
        }
        Object.keys(settings.geometry.room).forEach(key => setValue(key, settings.geometry.room[key]));
        ['n', 's', 'e', 'w'].forEach(dir => {
            const key = dir.toUpperCase();
            const apertureData = settings.geometry.apertures[key];
            setChecked(`aperture-${dir}-toggle`, !!apertureData);
            if (apertureData) {
                ui.setWindowMode(dir, apertureData.mode, false);
                setValue(`win-count-${dir}`, apertureData.winCount);
                if (apertureData.mode === 'wwr') {
                    setValue(`wwr-${dir}`, apertureData.wwr);
                    setValue(`wwr-sill-height-${dir}`, apertureData.sh);
                } else {
                    setValue(`win-width-${dir}`, apertureData.ww);
                    setValue(`win-height-${dir}`, apertureData.wh);
                    setValue(`sill-height-${dir}`, apertureData.sh);
                }

                // Always set window depth position if aperture data exists
                setValue(`win-depth-pos-${dir}`, apertureData.winDepthPos);
                setValue(`win-depth-pos-${dir}-manual`, apertureData.winDepthPos);
            }
            const shadingData = settings.geometry.shading[key];
            setChecked(`shading-${dir}-toggle`, !!shadingData);
            if (shadingData) {
                setValue(`shading-type-${dir}`, shadingData.type);
                ui.handleShadingTypeChange(dir, false); // This reveals the correct controls panel

                // Handle existing, non-generative shading types
                if (shadingData.overhang) Object.keys(shadingData.overhang).forEach(p => setValue(`overhang-${p}-${dir}`, shadingData.overhang[p]));
                if (shadingData.lightshelf) Object.keys(shadingData.lightshelf).forEach(p => setValue(`lightshelf-${p}-${dir}`, shadingData.lightshelf[p]));
                if (shadingData.louver) Object.keys(shadingData.louver).forEach(p => setValue(`louver-${p}-${dir}`, shadingData.louver[p]));
                if (shadingData.roller) Object.keys(shadingData.roller).forEach(p => setValue(`roller-${p}-${dir}`, shadingData.roller[p]));

                if (shadingData.generative) {
                    // Restore the state object for generative shading
                    if (!this.generativeShadingParams) this.generativeShadingParams = {};
                    this.generativeShadingParams[dir] = shadingData.generative;

                    // If the UI has specific inputs for generative params that need to be populated, do it here.
                    // However, generative UI is often dynamic. The important part is restoring the state 
                    // so that when the user switches to 'generative', the params are there.
                    // We might need to trigger a UI update if the panel is active.
                }
            }
        });

        // --- Frames & Materials ---
        setChecked('frame-toggle', settings.geometry.frames.enabled);
        setValue('frame-thick', settings.geometry.frames.thickness);
        setValue('frame-depth', settings.geometry.frames.depth);
        ['wall', 'floor', 'ceiling', 'frame', 'shading', 'glazing', 'furniture'].forEach(type => {
            if (settings.materials[type]) {
                const mat = settings.materials[type];
                if (mat.type) setValue(`${type}-mat-type`, mat.type);
                if (mat.reflectance) setValue(`${type}-refl`, mat.reflectance);
                if (mat.specularity) setValue(`${type}-spec`, mat.specularity);
                if ((type === 'wall' || type === 'floor' || type === 'ceiling') && mat.mode === 'srd') {
                    dom[`${type}-mode-srd`]?.click();
                    if (mat.srdFile?.name && dom[`${type}-srd-file`]) {
                        let display = dom[`${type}-srd-file`].parentElement.querySelector('span[data-file-display-for]');
                        if (display) {
                            display.textContent = mat.srdFile.name;
                            display.title = mat.srdFile.name;
                        }
                    }
                }
                if (mat.roughness) setValue(`${type}-rough`, mat.roughness);
                if (mat.transmittance) setValue(`${type}-trans`, mat.transmittance);
            }
        });
        setChecked('bsdf-toggle', settings.materials.glazing.bsdfEnabled);

        // --- Furniture ---
        if (settings.geometry.furniture && Array.isArray(settings.geometry.furniture)) {
            const { addFurniture, furnitureObject } = await import('./geometry.js');
            // Clear any existing furniture before loading
            while (furnitureObject.children.length > 0) furnitureObject.remove(furnitureObject.children[0]);

            settings.geometry.furniture.forEach(item => {
                const newObj = addFurniture(item.assetType, new THREE.Vector3(0, 0, 0)); // Add at origin first
                if (newObj) {
                    newObj.position.fromArray(item.position);
                    newObj.quaternion.fromArray(item.quaternion);
                    newObj.scale.fromArray(item.scale);
                }
            });
        }

        // --- Context Massing ---
        if (settings.geometry.contextMassing && Array.isArray(settings.geometry.contextMassing)) {
            const { addMassingBlock, contextObject } = await import('./geometry.js');
            // Clear any default or existing massing blocks before loading
            const existingBlocks = contextObject.children.filter(c => c.userData.isMassingBlock);
            existingBlocks.forEach(b => contextObject.remove(b));

            settings.geometry.contextMassing.forEach(item => {
                // Prepare params for addMassingBlock, mapping position array to individual coords
                const params = {
                    ...item, // Pass shape, dimensions, name etc.
                    positionX: item.position[0],
                    positionY: item.position[1],
                    positionZ: item.position[2]
                };

                const newBlock = addMassingBlock(params);
                if (newBlock) {
                    // The position is already set by addMassingBlock from params.
                    // Just need to apply quaternion and scale.
                    newBlock.quaternion.fromArray(item.quaternion);
                    newBlock.scale.fromArray(item.scale);
                }
            });
        }

        // --- Artificial Lighting ---
        // Manually update the file input display for daylighting schedule if it exists
        if (settings.lighting?.daylighting?.scheduleFile?.name && dom['daylighting-availability-schedule']) {
            const input = dom['daylighting-availability-schedule'];
            const inputId = input.id;
            let display = input.parentElement.querySelector(`span[data-file-display-for="${inputId}"]`);
            if (!display) {
                display = document.createElement('span');
                display.className = 'text-xs text-gray-400 ml-2';
                display.dataset.fileDisplayFor = inputId;
                input.after(display);
            }
            display.textContent = settings.lighting.daylighting.scheduleFile.name;
            display.title = settings.lighting.daylighting.scheduleFile.name;
        }

        lightingManager.applyState(settings.lighting);

        // --- Viewpoint ---
        if (settings.viewpoint) {
            const vp = settings.viewpoint;
            Object.keys(vp).forEach(key => {
                if (key !== 'gizmoMode' && key !== 'gizmo-toggle') {
                    setValue(key, vp[key]);
                }
            });
            setChecked('gizmo-toggle', vp['gizmo-toggle']);
        }

        // --- View Options ---
        if (settings.viewOptions) {
            const vo = settings.viewOptions;
            if (vo.projection === 'orthographic') {
                dom['view-btn-ortho']?.click();
            } else {
                dom['view-btn-persp']?.click();
            }
            setChecked('transparent-toggle', vo.transparent);
            setChecked('ground-plane-toggle', vo.ground);
            setChecked('world-axes-toggle', vo.worldAxes);
            setValue('world-axes-size', vo.worldAxesSize);
            if (vo.hSection) { setChecked('h-section-toggle', vo.hSection.enabled); setValue('h-section-dist', vo.hSection.dist); }
            if (vo.vSection) { setChecked('v-section-toggle', vo.vSection.enabled); setValue('v-section-dist', vo.vSection.dist); }
        }

        // --- Sensor Grids ---
        if (settings.sensorGrids) {
            const sg = settings.sensorGrids;
            if (sg.illuminance.floor) {
                const floor = sg.illuminance.floor;
                setChecked('grid-floor-toggle', floor.enabled);
                setValue('floor-grid-spacing', floor.spacing);
                setValue('floor-grid-offset', floor.offset);
                setChecked('show-floor-grid-3d-toggle', floor.showIn3D);
                setChecked('task-area-toggle', floor.isTaskArea);
                if (floor.task) {
                    setValue('task-area-start-x', floor.task.x);
                    setValue('task-area-start-z', floor.task.z);
                    setValue('task-area-width', floor.task.width);
                    setValue('task-area-depth', floor.task.depth);
                }
                setChecked('surrounding-area-toggle', floor.hasSurrounding);
                setValue('surrounding-area-width', floor.surroundingWidth);
            }
            if (sg.illuminance.ceiling) {
                setChecked('grid-ceiling-toggle', sg.illuminance.ceiling.enabled);
                setValue('ceiling-grid-spacing', sg.illuminance.ceiling.spacing);
                setValue('ceiling-grid-offset', sg.illuminance.ceiling.offset);
            }
            if (sg.illuminance.walls) {
                const walls = sg.illuminance.walls;
                setValue('wall-grid-spacing', walls.spacing);
                setValue('wall-grid-offset', walls.offset);
                if (walls.surfaces) {
                    setChecked('grid-north-toggle', walls.surfaces.n);
                    setChecked('grid-south-toggle', walls.surfaces.s);
                    setChecked('grid-east-toggle', walls.surfaces.e);
                    setChecked('grid-west-toggle', walls.surfaces.w);
                }
            }
            if (sg.view) {
                setChecked('view-grid-toggle', sg.view.enabled); setChecked('show-view-grid-3d-toggle', sg.view.showIn3D); setValue('view-grid-spacing', sg.view.spacing);
                setValue('view-grid-offset', sg.view.offset); setValue('view-grid-directions', sg.view.numDirs);
                if (sg.view.startVec && Array.isArray(sg.view.startVec)) {
                    setValue('view-grid-start-vec-x', sg.view.startVec[0]);
                    setValue('view-grid-start-vec-y', sg.view.startVec[1]);
                    setValue('view-grid-start-vec-z', sg.view.startVec[2]);
                }
            }
        }

        // --- Occupancy Schedule ---
        if (settings.occupancy) {
            setChecked('occupancy-toggle', settings.occupancy.enabled);
            setValue('occupancy-schedule-filename', settings.occupancy.fileName);
            setValue('occupancy-time-range-start', settings.occupancy.timeStart);
            setValue('occupancy-time-range-end', settings.occupancy.timeEnd);
            if (settings.occupancy.days) {
                const dayMap = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
                document.querySelectorAll('.occupancy-day').forEach((el, i) => {
                    const dayKey = dayMap[i];
                    if (settings.occupancy.days[dayKey] !== undefined) {
                        el.checked = settings.occupancy.days[dayKey];
                    }
                });
            }
            // Manually trigger the UI update and file generation if enabled
            dom['occupancy-controls']?.classList.toggle('hidden', !settings.occupancy.enabled);
            ui.updateOccupancyTimeRangeDisplay();
            if (settings.occupancy.enabled) {
                ui.generateAndStoreOccupancyCsv();
            }
        }

        // --- Visualization Colors & Analysis Panel State ---
        if (settings.visualization) {
            const viz = settings.visualization;
            // Set simple values first
            setChecked('compare-mode-toggle', viz.compareMode);
            setValue('results-scale-min', viz.scaleMin);
            setValue('results-scale-max', viz.scaleMax);
            setValue('results-palette', viz.palette);
            setValue('metric-selector', viz.activeMetric);

            // Trigger UI updates that depend on these values
            if (dom['compare-mode-toggle']) {
                dom['compare-mode-toggle'].dispatchEvent(new Event('change', { bubbles: true }));
            }
            if (dom['metric-selector']) {
                dom['metric-selector'].dispatchEvent(new Event('change', { bubbles: true }));
            }
        }

        // --- Simulation Panels ---
        if (settings.simulationParameters) {
            recreateSimulationPanels(settings.simulationParameters, this.simulationFiles, ui);
        }

        // --- Saved Views ---
        if (settings.savedViews) {
            const viewsToLoad = settings.savedViews.map(view => ({
                ...view,
                cameraState: {
                    ...view.cameraState,
                    position: new THREE.Vector3().fromArray(view.cameraState.position),
                    quaternion: new THREE.Quaternion().fromArray(view.cameraState.quaternion),
                    target: new THREE.Vector3().fromArray(view.cameraState.target)
                }
            }));
            ui.loadSavedViews(viewsToLoad);
        }

        // --- Custom Geometry ---
        if (settings.geometry.customGeometry) {
            const cg = settings.geometry.customGeometry;
            const { createCustomRoom } = await import('./customGeometryManager.js');
            const { registerCustomWall } = await import('./customApertureManager.js');
            const { setIsCustomGeometry } = await import('./geometry.js');

            // 1. Set Flag
            setIsCustomGeometry(true);

            // 2. Restore Wall Data
            // 2. Restore Wall Data
            if (cg.walls) {
                // Import outside the loop
                const { getCustomWallData } = await import('./customApertureManager.js');

                cg.walls.forEach(wall => {
                    registerCustomWall(wall.id, wall.data.dimensions);
                    // We need to fully restore the aperture/shading data
                    // We already have registerCustomWall.
                    // But registerCustomWall resets data to default.
                    // We need a way to set full data.
                    // Let's modify customApertureManager to allow setting full data or update it here.
                });

                // Better approach: Modify registerCustomWall or add setCustomWallData
                // For now, let's just manually update the map if we can access it? No, it's private.
                // We need to export a restore function in customApertureManager.
            }

            // Reconstruct points
            const points = cg.points.map(p => new THREE.Vector3(p.x, p.y, p.z));

            // 3. Create Room
            createCustomRoom(points, cg.height);

            // 4. Apply saved aperture data
            // We need to do this AFTER createCustomRoom because createCustomRoom calls registerCustomWall (reseting it).
            // Wait, createCustomRoom calls registerCustomWall.
            // So we should pass the saved data TO createCustomRoom?
            // Or we should update the data AFTER createCustomRoom.

            if (cg.walls) {
                const { getCustomWallData: getCWD } = await import('./customApertureManager.js');

                cg.walls.forEach(wall => {
                    const data = getCWD(wall.id);
                    if (data) {
                        // Merge saved data
                        Object.assign(data.apertures, wall.data.apertures);
                        Object.assign(data.shading, wall.data.shading);
                        // Trigger update
                        // We need to import updateCustomWall from customGeometryManager
                    }
                });

                // We need to call updateCustomWall for each wall to reflect changes?
                // createCustomRoom creates geometry based on current data.
                // If createCustomRoom resets data, we are in trouble.
                // Let's check createCustomRoom.
                // It calls registerCustomWall.
                // registerCustomWall overwrites with defaults.

                // FIX: We need createCustomRoom to NOT reset if data exists?
                // Or we restore data AFTER createCustomRoom, then regenerate?
                // Regenerating everything twice is bad.

                // Better: createCustomRoom should take optional "restoreData" or we separate registration.
                // Let's go with: Restore data AFTER, then update all.
                // Or modify customApertureManager to have a `restoreCustomWalls` function that sets the map,
                // and modify createCustomRoom to NOT register if already exists?

                // Let's stick to the plan:
                // 1. createCustomRoom will register (reset) everything.
                // 2. We overwrite with saved data.
                // 3. We call updateCustomWall for each wall.

                const { updateCustomWall } = await import('./customGeometryManager.js');
                cg.walls.forEach(wall => {
                    const data = getCWD(wall.id);
                    if (data) {
                        Object.assign(data.apertures, wall.data.apertures);
                        Object.assign(data.shading, wall.data.shading);
                        updateCustomWall(wall.id);
                    }
                });
            }
        } else {
            // Ensure flag is false if not custom
            const { setIsCustomGeometry } = await import('./geometry.js');
            setIsCustomGeometry(false);
        }

        // --- Topography ---
        if (settings.topography) {
            if (settings.topography.enabled) {
                dom['context-mode-topo']?.click();
                setValue('topo-plane-size', settings.topography.planeSize);
                setValue('topo-vertical-scale', settings.topography.verticalScale);
                // The file content (as a Blob) is already in `this.simulationFiles`.
                // We need to trigger the geometry creation from the UI handler.
                const topoFile = this.simulationFiles['topo-heightmap-file'];
                if (topoFile && topoFile.content) { // content is a Blob
                    const event = new Event('change');
                    // Simulate a file input change event for ui.js to handle
                    Object.defineProperty(event, 'target', { writable: false, value: { files: [topoFile.content] } });
                    dom['topo-heightmap-file']?.dispatchEvent(event);
                }
            }
        }

        // --- Final UI & Scene Updates ---
        ui.updateAllLabels();
        updateScene();

        // Finally, show the success message
        if (showAlertCallback) {
            showAlertCallback(`Project "${settings.projectInfo['project-name']}" loaded successfully.`, 'Project Loaded');
        }
    }
}

export const project = new Project();
