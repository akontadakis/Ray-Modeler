// scripts/project.js

import * as THREE from 'three';
import { generateRadFileContent, generateViewpointFileContent, transformThreePointToRadianceArray, transformThreeVectorToRadianceArray, generateViewpointFileContentFromState, generateRayFileContent, generateCenteredPoints } from './radiance.js';
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
import './recipes/spectral9ChRecipe.js';

// Version of the saved project JSON schema. Bump whenever the persisted shape
// changes in a way that older/newer readers need to know about.
export const PROJECT_SCHEMA_VERSION = 2;

// Directory (inside the project folder) each simulationFiles key is written to
// and read back from. Keep the save, generate and load paths using this single
// mapping so a file always lands where the generated scripts look for it.
function simulationFileDirectory(key) {
    if (key.includes('weather')) return '04_skies';   // scripts read ../04_skies/<epw>
    if (key.includes('bsdf')) return '05_bsdf';
    if (key.includes('schedule')) return '10_schedules';
    if (key.includes('topo')) return '12_topography';
    return '11_files';
}

// getAllShadingParams() stores camelCase keys; every control id is kebab-case.
function camelToKebab(key) {
    return key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

// The few saved shading keys whose control is not a plain `<prefix>-<kebab>-<dir>`
// value input. Verified against the ids AperturePanelUI.js creates.
const SHADING_PARAM_RESTORERS = {
    'lightshelf.placeExt': (dir, v, { setActiveButton }) => setActiveButton(`lightshelf-placement-ext-${dir}`, v),
    'lightshelf.placeInt': (dir, v, { setActiveButton }) => setActiveButton(`lightshelf-placement-int-${dir}`, v),
    'lightshelf.placeBoth': (dir, v, { setActiveButton }) => setActiveButton(`lightshelf-placement-both-${dir}`, v),
    'louver.isExterior': (dir, v, { setActiveButton }) => setActiveButton(
        v ? `louver-placement-ext-${dir}` : `louver-placement-int-${dir}`, true
    ),
    'louver.isHorizontal': (dir, v, { setValue }) => setValue(
        `louver-slat-orientation-${dir}`, v ? 'horizontal' : 'vertical'
    )
};

class Project {
    constructor() {
        this.projectName = 'default-project';
        this.epwFileContent = null;
        this.simulationFiles = {};
        this.dirHandle = null; // For Web File System Access API (browser)
        this.dirPath = null;   // For Node.js fs module path (Electron)
        this._projectDataCache = null; // Last full snapshot from gatherAllProjectData().
    }

    /**
     * A synchronous view of the current project for consumers that cannot await
     * `gatherAllProjectData()`.
     *
     * This property was read by resultsManager's sun-path and report paths but was never
     * assigned anywhere, so it was permanently `undefined`: `getSunPathData()` always
     * returned null and every sun position silently fell back to latitude 40 / longitude 0.
     *
     * Site information is re-read from the DOM on every access rather than served from the
     * cache, because latitude and longitude change without a save and a stale snapshot would
     * put the sun in the wrong place. Everything else comes from the last full snapshot, and
     * is null until one has been taken.
     */
    get projectData() {
        const num = (id) => {
            const parsed = parseFloat(document.getElementById(id)?.value);
            return Number.isFinite(parsed) ? parsed : undefined;
        };

        const liveInfo = {
            'project-name': document.getElementById('project-name')?.value || this.projectName,
            latitude: num('latitude'),
            longitude: num('longitude'),
            epwFileName: this.simulationFiles['weather-file']?.name || null,
        };

        if (!this._projectDataCache) return { projectInfo: liveInfo };

        return {
            ...this._projectDataCache,
            projectInfo: { ...this._projectDataCache.projectInfo, ...liveInfo },
        };
    }

    setEpwData(epwData, fileName = null) {
        this.epwFileContent = epwData;
        // The recipes and generated scripts look the weather file up in
        // simulationFiles['weather-file']; the project-level EPW loader only set
        // epwFileContent, so keep the two in sync here.
        this.registerEpwSimulationFile(fileName);
    }

    /**
     * Publishes the project-level EPW into simulationFiles under the key every
     * recipe / script generator reads ('weather-file'). Safe to call repeatedly.
     * @param {string|null} fileName Optional explicit file name.
     */
    registerEpwSimulationFile(fileName = null) {
        if (!this.epwFileContent) {
            delete this.simulationFiles['weather-file'];
            return;
        }
        const displayed = document.getElementById('epw-file-name')?.textContent?.trim();
        let resolved = fileName
            || this.simulationFiles['weather-file']?.name
            || (displayed && displayed !== 'No file selected' ? displayed : null)
            || 'climate.epw';
        if (!/\.epw$/i.test(resolved)) resolved = `${resolved}.epw`;
        this.addSimulationFile('weather-file', resolved, this.epwFileContent);
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

        // 1. Gather Global Parameters directly from the main simulation panel.
        // The global quality sliders (#ab,#ad,#as,#ar,#aa,#lw), advanced Radiance
        // params, and the quality preset live directly inside
        // #panel-simulation-modules (not a floating window / dedicated panel).
        const globalPanel = document.getElementById('panel-simulation-modules');
        if (globalPanel) {
            const panelData = {};
            // The active recipe's inputs live inside #recipe-parameters-container and
            // are gathered separately below; exclude them from the global set.
            const recipeContainer = globalPanel.querySelector('#recipe-parameters-container');
            globalPanel.querySelectorAll('input, select').forEach(input => {
                if (recipeContainer && recipeContainer.contains(input)) return;
                const key = input.id;
                if (!key) return;
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
            // Only derive a suffix when the panel actually has a hyphenated id.
            // The sidebar's firstElementChild is an id-less <div class="param-section">,
            // so stripping a "-" suffix would corrupt input ids (e.g. pit-month -> pitmonth).
            const panelIdSuffix = (activePanel.id && activePanel.id.includes('-'))
                ? activePanel.id.split('-').pop()
                : '';
            const activeValues = {};

            // Scan the whole container, not just its first child. A cloned recipe
            // template contributes every child of its .window-content, so most
            // recipes place inputs across several sibling sections.
            sidebarContainer.querySelectorAll('input, select').forEach(input => {
                const key = panelIdSuffix ? input.id.replace(`-${panelIdSuffix}`, '') : input.id;
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
            schemaVersion: PROJECT_SCHEMA_VERSION,
            projectInfo: {
                'project-name': this.projectName,
                'project-desc': getValue('project-desc'),
                'building-type': getValue('building-type'),
                'radiance-path': getValue('radiance-path'),
                'latitude': getValue('latitude'),
                'longitude': getValue('longitude'),
                // Prefer the name registered under simulationFiles['weather-file'] so
                // the JSON, the 04_skies copy and the scripts all agree on one name.
                epwFileName: this.epwFileContent
                    ? (this.simulationFiles['weather-file']?.name || getTextContent('epw-file-name') || 'climate.epw')
                    : null,
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
                    const { isCustomGeometry, currentImportedModel } = await import('./geometry.js');
                    if (isCustomGeometry) return 'custom';
                    // There is no #mode-import-btn in index.html, so the old
                    // classList probe was always false and every imported project
                    // was saved as 'parametric'. Ask the geometry module instead,
                    // falling back to the visibility of the import controls panel.
                    if (currentImportedModel) return 'imported';
                    const importPanel = dom['import-controls'] || document.getElementById('import-controls');
                    return importPanel && !importPanel.classList.contains('hidden') ? 'imported' : 'parametric';
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
                // The real ids are view-btn-persp / view-btn-ortho; 'proj-btn-persp'
                // exists nowhere, so this always reported 'orthographic'.
                projection: getClassListContains('view-btn-persp', 'active') ? 'perspective' : 'orthographic',
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
                    // A saved view without a target must not abort the whole save.
                    target: view.cameraState.target?.toArray ? view.cameraState.target.toArray() : [0, 0, 0],
                    viewType: view.cameraState.viewType,
                    fov: view.cameraState.fov
                }
            })),
            topography: {
                // #context-mode-topo is a <button>, not a checkbox: read its
                // active state, otherwise `enabled` is undefined and is dropped
                // by JSON.stringify so topography never restores.
                enabled: getClassListContains('context-mode-topo', 'active'),
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

        // getWindowParamsForWall() consumes the WWR slider to derive ww/wh and does
        // not return it, so restore it here or the value is lost on the first
        // save/load round trip.
        ['n', 's', 'e', 'w'].forEach(dir => {
            const ap = projectData.geometry.apertures?.[dir.toUpperCase()];
            if (!ap || ap.mode !== 'wwr') return;
            const fromDom = getValue(`wwr-${dir}`, parseFloat);
            if (fromDom !== null) {
                ap.wwr = fromDom;
                return;
            }
            const wallArea = (ap.wallWidth || 0) * (projectData.geometry.room.height || 0);
            ap.wwr = wallArea > 0 ? (ap.winCount * ap.ww * ap.wh) / wallArea : 0;
        });

        // Await the promises from the async IIFEs to get the actual data
        projectData.geometry.furniture = await projectData.geometry.furniture;
        projectData.geometry.vegetation = await projectData.geometry.vegetation;
        projectData.geometry.contextMassing = await projectData.geometry.contextMassing;
        projectData.geometry.customGeometry = await projectData.geometry.customGeometry;

        // Cache the snapshot on the singleton. Consumers outside the save path read
        // `project.projectData` rather than calling this method themselves — notably
        // resultsManager's sun-position, lighting-power and report paths. Without this the
        // property was never assigned at all, so those paths silently fell back to their
        // defaults (latitude 40 / longitude 0) or returned null.
        this._projectDataCache = projectData;

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

    /**
     * Builds the full set of Radiance *input* files for a project (geometry,
     * materials, views, sensor grids and every uploaded/generated resource).
     *
     * Both the "Save Project" and the "Generate Package" paths call this so the
     * two can never write different layouts — previously only the save path
     * wrote the EPW / BSDF / IES / SPD / schedule files, which made
     * Generate-then-Run fail with `epw2wea: cannot open ...`.
     *
     * @param {object} projectData Result of gatherAllProjectData().
     * @param {string} projectName Sanitised project name used in file names.
     * @returns {Promise<Array<{path: string[], content: any}>>}
     */
    async _collectProjectInputFiles(projectData, projectName) {
        const { materials, geometry } = await generateRadFileContent(projectData);
        const viewpointContent = generateViewpointFileContent(projectData.viewpoint, projectData.geometry.room);
        const fisheyeVpData = { ...projectData.viewpoint, 'view-type': 'h' };
        const fisheyeContent = generateViewpointFileContent(fisheyeVpData, projectData.geometry.room);
        const allPtsContent = await this._generateSensorPointsContent('all');
        const taskPtsContent = await this._generateSensorPointsContent('task');
        const surroundingPtsContent = await this._generateSensorPointsContent('surrounding');
        const facadePtsContent = await this._generateSensorPointsContent('facade');
        const daylightingPtsContent = await this._generateDaylightingPointsContent();
        const rayContent = await generateRayFileContent();

        const files = [
            { path: ['01_geometry', `${projectName}.rad`], content: geometry },
            { path: ['02_materials', `${projectName}_materials.rad`], content: materials },
            { path: ['03_views', 'viewpoint.vf'], content: viewpointContent },
            { path: ['03_views', 'viewpoint_fisheye.vf'], content: fisheyeContent },
            { path: ['08_results', 'grid.pts'], content: allPtsContent },
            { path: ['08_results', 'task_grid.pts'], content: taskPtsContent },
            { path: ['08_results', 'surrounding_grid.pts'], content: surroundingPtsContent },
            { path: ['08_results', 'facade_grid.pts'], content: facadePtsContent },
            { path: ['08_results', 'daylighting_sensors.pts'], content: daylightingPtsContent },
            { path: ['08_results', 'view_grid.ray'], content: rayContent }
        ];

        // One .vf per saved camera view.
        (projectData.savedViews || []).forEach((view, index) => {
            const cameraStateForVf = {
                position: new THREE.Vector3().fromArray(view.cameraState.position),
                quaternion: new THREE.Quaternion().fromArray(view.cameraState.quaternion),
                viewType: view.cameraState.viewType,
                fov: view.cameraState.fov,
            };
            const viewFileContent = generateViewpointFileContentFromState(cameraStateForVf);
            if (viewFileContent) {
                files.push({ path: ['03_views', `saved_view_${index + 1}.vf`], content: viewFileContent });
            }
        });

        // The project-level EPW. Every annual script reads ../04_skies/<name>.
        if (projectData.epwFileContent && projectData.projectInfo?.epwFileName) {
            files.push({ path: ['04_skies', projectData.projectInfo.epwFileName], content: projectData.epwFileContent });
        }

        // Uploaded / generated resources: weather, BSDF, IES, SPD, schedules,
        // topography heightmap and anything else registered by the UI.
        const simFiles = projectData.simulationFiles || this.simulationFiles || {};
        for (const key in simFiles) {
            const fileData = simFiles[key];
            if (fileData?.name && fileData.content) {
                files.push({ path: [simulationFileDirectory(key), fileData.name], content: fileData.content });
            }
        }

        // Drop empty entries and de-duplicate by destination path so the same
        // EPW is not written twice under two different keys.
        const byPath = new Map();
        files
            .filter(f => f.content !== null && f.content !== undefined)
            .forEach(f => byPath.set(f.path.join('/'), f));
        return Array.from(byPath.values());
    }

    /**
     * Converts any Blob file contents into Uint8Arrays. Electron's contextBridge
     * cannot structured-clone a Blob, and fs.writeFile cannot consume one.
     * @param {Array<{path: string[], content: any}>} files
     */
    static async _serializeFilesForIpc(files) {
        return Promise.all(files.map(async file => {
            if (file.content instanceof Blob) {
                return { ...file, content: new Uint8Array(await file.content.arrayBuffer()) };
            }
            return file;
        }));
    }

    async generateSimulationPackage(panelElement, uniqueId = null) {
        const { showAlert } = await import('./ui.js');
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
        // panelElement may be the outer #panel-simulation-modules (sidebar flow),
        // the #recipe-parameters-container itself (optimization/AI flow), or a legacy
        // floating window. Resolve the container in all cases.
        const recipeContainer = (panelElement.id === 'recipe-parameters-container')
            ? panelElement
            : panelElement.querySelector('#recipe-parameters-container');
        const activeRecipePanel = recipeContainer ? recipeContainer.firstElementChild : null;

        if (activeRecipePanel) {
            // The sidebar's active panel is an id-less <div class="param-section">.
            // Only strip a suffix when the panel has a real hyphenated id; otherwise
            // keep input ids intact (stripping "-" would corrupt keys like pit-month).
            const panelIdSuffix = (activeRecipePanel.id && activeRecipePanel.id.includes('-'))
                ? activeRecipePanel.id.split('-').pop()
                : '';
            // Scan the whole container, not just its first child (see note above).
            recipeContainer.querySelectorAll('input, select').forEach(input => {
                const key = panelIdSuffix ? input.id.replace(`-${panelIdSuffix}`, '') : input.id;
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

        // Some file-backed inputs the script generator reads are not rendered inside
        // the recipe panel: the project-level EPW and the generated occupancy CSV.
        // Surface them under the keys the generator looks up so they resolve in
        // mergedSimParams (and in config._raw.recipeOverrides for registry recipes).
        ['weather-file', 'occupancy-schedule'].forEach(key => {
            const fileData = this.simulationFiles[key];
            if (fileData?.name && !recipeOverrides[key]) {
                recipeOverrides[key] = { name: fileData.name, content: fileData.content };
            }
        });

        // Keep legacy mergedSimParams for non-registry recipes.
        projectData.mergedSimParams = { ...globalParams, ...recipeOverrides };

        // Sync the active recipe overrides into simulationParameters so that
        // configMappers + RecipeRegistry see the same values the user edits
        // in the sidebar. This enforces "one package = one active recipe".
        // Resolve the active recipe type across every flow:
        //  - legacy floating panels set data-template-id on panelElement itself
        //  - the sidebar sets data-activeRecipeTemplate on #recipe-parameters-container
        //  - AI/optimization pass the container directly as panelElement
        const recipeType = panelElement.dataset.templateId
            || panelElement.dataset.activeRecipeTemplate
            || recipeContainer?.dataset?.activeRecipeTemplate
            || panelElement.querySelector('[data-template-id]')?.dataset?.templateId;
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
        const inputFiles = await this._collectProjectInputFiles(projectData, projectName);

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
                const { showAlertHtml, escapeHtml } = await import('./ui.js');
                const errorHtml =
                    '<p>The selected simulation recipe configuration is invalid:</p>' +
                    '<ul class="list-disc pl-5 space-y-1">' +
                    validation.errors.map(e => `<li>${escapeHtml(e)}</li>`).join('') +
                    '</ul>';
                showAlertHtml(errorHtml, 'Cannot Generate Package: Invalid Configuration');
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
        const filesToWrite = [...inputFiles];

        const makeExecutableContent = `#!/bin/bash\n# Makes all .sh scripts in this directory executable.\nchmod +x ./*.sh\necho "All scripts are now executable."`;
        scriptsToGenerate.push({ fileName: 'make_executable.sh', content: makeExecutableContent });

        scriptsToGenerate.forEach(script => {
            filesToWrite.push({ path: ['07_scripts', script.fileName], content: script.content });
        });

        // 4. Write all files using the appropriate method for the environment
        try {
            if (window.electronAPI && this.dirPath) {
                // Electron Method
                await window.electronAPI.saveProject({
                    projectPath: this.dirPath,
                    files: await Project._serializeFilesForIpc(filesToWrite)
                });
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

            if (!displayContent) {
                // The package was written, but nothing in it can be shown in the
                // command centre. Say so: this was the one null path that returned
                // without telling the user anything.
                showAlert(
                    'The package was written, but it contains no runnable script to display.',
                    'Generation Incomplete'
                );
                return null;
            }

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

            // 2. Generate all file contents in memory first. This is the exact same
            // set the "Generate Package" path writes, so the two layouts match.
            const inputFiles = await this._collectProjectInputFiles(projectData, projectName);

            // Sanitize the project data for JSON serialization by removing large file contents.
            const dataForJson = JSON.parse(JSON.stringify(projectData));
            dataForJson.epwFileContent = null;
            if (dataForJson.simulationFiles) {
                Object.values(dataForJson.simulationFiles).forEach(file => { if (file) file.content = null; });
            }
            const projectJsonContent = JSON.stringify(dataForJson, null, 2);

            // 3. Structure all generated content into a list of file objects.
            const filesToWrite = [
                ...inputFiles,
                { path: [`${projectName}.json`], content: projectJsonContent }
            ];

            // 4. Write the files using the appropriate method based on the environment.
            if (window.electronAPI && this.dirPath) {
                // Electron Method: Send all data to the main process for efficient file writing.
                // Blobs cannot cross the contextBridge, so serialize them first.
                await window.electronAPI.saveProject({
                    projectPath: this.dirPath,
                    files: await Project._serializeFilesForIpc(filesToWrite)
                });
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
            // Three.js ordering: [X_width, Y_height, Z_depth]. Up is +Y.
            const normalVector = [0, 1, 0];

            for (const p of taskPoints) {
                const localPos = [p.x, offset, p.z];
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
            // Three.js ordering: [X_width, Y_height, Z_depth]. Up is +Y.
            const normalVector = [0, 1, 0];

            for (const p of outerPoints) {
                // Check if the point is OUTSIDE the inner task area
                const isOutsideTask = (p.x < task.x || p.x > task.x + task.width || p.z < task.z || p.z > task.z + task.depth);
                if (isOutsideTask) {
                    const localPos = [p.x, offset, p.z];
                    const worldPos = transformPoint(localPos);
                    const worldNorm = transformVector(normalVector);
                    points.push(`${worldPos.map(c => c.toFixed(4)).join(' ')} ${worldNorm.map(c => c.toFixed(4)).join(' ')}`);
                }
            }
        } else if (gridType === 'facade') {
            // Vertical analysis plane sitting in front of one facade, used by the
            // Facade Irradiation recipe (which reads ../08_results/facade_grid.pts).
            // The three controls live in the recipe template, so they only exist
            // in the document while that recipe is the active one.
            const readRecipeField = (id) => dom[id] || document.getElementById(id);
            const selectionEl = readRecipeField('facade-selection');
            if (!selectionEl) return null;

            const selection = String(selectionEl.value || 'S').trim().toUpperCase().charAt(0);
            const parseField = (id, fallback) => {
                const el = readRecipeField(id);
                const value = el ? parseFloat(el.value) : NaN;
                return isNaN(value) ? fallback : value;
            };
            const spacing = parseField('facade-grid-spacing', 0.5);
            const facadeOffset = parseField('facade-offset', 0.05);
            if (spacing <= 0 || H <= 0) return null;

            // North is the z = 0 wall, South z = L, West x = 0, East x = W.
            // The plane is pushed OUTWARD, so its normal is the outward one.
            const layouts = {
                N: { length: W, normal: [0, 0, -1], position: (h, v) => [h, v, -facadeOffset] },
                S: { length: W, normal: [0, 0, 1], position: (h, v) => [h, v, L + facadeOffset] },
                W: { length: L, normal: [-1, 0, 0], position: (h, v) => [-facadeOffset, v, h] },
                E: { length: L, normal: [1, 0, 0], position: (h, v) => [W + facadeOffset, v, h] }
            };
            const layout = layouts[selection];
            if (!layout) {
                console.warn(`Unknown facade selection '${selection}'; facade_grid.pts not generated.`);
                return null;
            }

            const horizontal = generateCenteredPoints(layout.length, spacing);
            const vertical = generateCenteredPoints(H, spacing);
            const worldNorm = transformVector(layout.normal);

            for (const h of horizontal) {
                for (const v of vertical) {
                    const worldPos = transformPoint(layout.position(h, v));
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

                // Custom rooms are built from the raw drawn polygon and live inside
                // roomObject, which updateScene() rotates by the room orientation.
                // The custom geometry export writes the BAKED WORLD coordinates of
                // that group, so these sensor points must be rotated the same way
                // and then mapped with the canonical (x, y, z)_three -> (x, -z, y)_rad
                // transform (determinant +1). This mirrors generateRayFileContent()'s
                // custom branch in radiance.js exactly. Note: NOT centred on W/L —
                // custom geometry is exported in world coordinates.
                const upVector = new THREE.Vector3(0, 1, 0);
                const rotateToWorld = (x, y, z) =>
                    new THREE.Vector3(x, y, z).applyAxisAngle(upVector, alphaRad).toArray();
                const toRadiance = (p) => `${p[0].toFixed(4)} ${(-p[2]).toFixed(4)} ${p[1].toFixed(4)}`;

                // --- Floor Grid ---
                if (dom['grid-floor-toggle']?.checked) {
                    const spacing = getDimension('floor-grid-spacing');
                    const offset = getDimension('floor-grid-offset');
                    console.log('[DEBUG] Generating floor grid: spacing=', spacing, 'offset=', offset);
                    const gridPoints = generatePolygonGridPoints(polygonPoints, spacing, offset, 0); // y = offset
                    console.log('[DEBUG] Generated', gridPoints.length, 'floor grid points');

                    // Three.js up (0,1,0) maps to Radiance (0,0,1); rotation about the
                    // up axis leaves it unchanged.
                    const radNormal = "0 0 1";

                    for (const pt of gridPoints) {
                        points.push(`${toRadiance(rotateToWorld(pt.x, pt.y, pt.z))} ${radNormal}`);
                    }
                }

                // --- Ceiling Grid ---
                if (dom['grid-ceiling-toggle']?.checked) {
                    const spacing = getDimension('ceiling-grid-spacing');
                    const offset = getDimension('ceiling-grid-offset');
                    // #ceiling-grid-offset is negative-only (-1.0 .. 0), so the level
                    // is H + offset. geometry.js's viewer grid uses the same
                    // expression; H - offset put the custom-room grid above the ceiling.
                    const gridPoints = generatePolygonGridPoints(polygonPoints, spacing, H + offset, 0); // y = H + offset

                    // Three.js down (0,-1,0) maps to Radiance (0,0,-1).
                    const radNormal = "0 0 -1";

                    for (const pt of gridPoints) {
                        points.push(`${toRadiance(rotateToWorld(pt.x, pt.y, pt.z))} ${radNormal}`);
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

                            // Wall normal in Three.js is (nx, 0, nz). Rotate it with
                            // the room, then apply (x, y, z)_three -> (x, -z, y)_rad.
                            const radNormStr = toRadiance(rotateToWorld(nx, 0, nz));

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
                                    points.push(`${toRadiance(rotateToWorld(finalX, yHeight, finalZ))} ${radNormStr}`);
                                }
                            }
                        }
                    }
                }

            } else {
                // Parametric Logic (Original). generateCenteredPoints is imported
                // from radiance.js so the exported grid and the viewer's preview
                // grid can never disagree about short surfaces.
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
                        // #ceiling-grid-offset is a negative-only slider (-1.0 .. 0),
                        // so H + offset already hangs the grid below the ceiling.
                        // This matches geometry.js's viewer grid exactly.
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
        // NO header comment. rtrace does not skip a leading '#' line and continue -- it
        // discards the ENTIRE file and exits 0, so every recipe produced a 0-byte result
        // and the app reported "No valid numerical data found". Verified against Radiance
        // 6.1a on a real 59-point grid: 0 rows with the header, 59 without.
        // Column order is X Y Z Vx Vy Vz.
        return points.join('\n') + '\n';
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
            // COORDINATE CONVENTION (shared contract with lighting.js):
            // daylighting sensor x/z are CENTRED on the room (sliders run -10..10
            // with the room centre at 0), while transformThreePointToRadianceArray
            // expects CORNER-ORIGIN coordinates and subtracts W/2 and L/2 itself.
            // Shift here, or the photocell gets centred twice and lands in the
            // floor/wall corner. y is already an absolute height. Note that the
            // sibling lightDef.position is corner-origin already — only these
            // sensor coordinates need the shift.
            const posThree = [sensor.x + W / 2, sensor.y, sensor.z + L / 2];
            const dirThree = [sensor.direction.x, sensor.direction.y, sensor.direction.z];

            // Use the new, centralized utility functions
            const worldPosArray = transformThreePointToRadianceArray(posThree, W, L, cosA, sinA);
            const worldNormArray = transformThreeVectorToRadianceArray(dirThree, cosA, sinA);

            const worldPos = worldPosArray.map(c => c.toFixed(4)).join(' ');
            const worldNorm = worldNormArray.map(c => c.toFixed(4)).join(' ');

            return `${worldPos} ${worldNorm}`;
        });

        // NO header comment -- rtrace discards a whole file whose first line is '#'.
        // Column order is X Y Z Vx Vy Vz.
        return points.join('\n') + '\n';
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
            this._projectDataCache = null;
            // Clear any existing saved views before loading new ones.
            // resetBsdfCache is required here too: ui.js only invalidates its parsed-BSDF
            // cache on manual file selection, so without this the BSDF viewer would show
            // the previous project's data after a load.
            const { loadSavedViews, resetBsdfCache } = await import('./ui.js');
            loadSavedViews([]);
            resetBsdfCache();

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
                if (content) this.setEpwData(content, settings.projectInfo.epwFileName);
            }

            if (settings.simulationFiles) {
                const filePromises = Object.entries(settings.simulationFiles).map(async ([key, fileData]) => {
                    if (fileData?.name) {
                        // Mirror the directory mapping used when writing.
                        const targetDir = simulationFileDirectory(key);
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

                await Promise.all(filePromises);
            }

            // Load topography heightmap as a Blob. This must run independently of the
            // simulationFiles block so a project with topography but no simulationFiles
            // still restores its heightmap.
            if (settings.topography?.heightmapFile?.name) {
                const blob = await readFileAsBlob(['12_topography', settings.topography.heightmapFile.name]);
                if (blob) {
                    // Store the blob directly, ui.js will create a URL from it
                    this.addSimulationFile('topo-heightmap-file', settings.topography.heightmapFile.name, blob);
                }
            }

            await this.applySettings(settings, showAlert);

            // Hide the initial prompt since a directory is now successfully loaded.
            const { getDom } = await import('./ui.js');
            const dom = getDom();
            dom['project-access-prompt']?.classList.add('hidden');

            // Under Electron the FileSystemAccess handle is enough to READ the
            // project, but running scripts needs a real filesystem path. Without
            // it simulation.js would fall back to dirHandle.name — a bare folder
            // name that resolves against the app's CWD. Ask for the path now.
            if (window.electronAPI && !this.dirPath) {
                showAlert(
                    'Project loaded. Select the same folder once more so simulations can be executed from it.',
                    'Confirm Project Folder'
                );
                await this.requestProjectDirectory();
            }

        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error("Failed to load project:", error);
                const { showAlert } = await import('./ui.js');
                showAlert(`Error loading project: ${error.message}`, 'Load Error');
            }
        }
    }

    /**
     * Restores every control in the project-authoring panels to the default
     * declared in index.html (`value` / `checked` / `selected` attributes, which
     * the DOM exposes as defaultValue / defaultChecked / defaultSelected).
     *
     * Called immediately before applySettings() writes a loaded file, so a field
     * that project B omits falls back to its markup default instead of silently
     * inheriting project A's value.
     *
     * #panel-simulation-modules is deliberately excluded: its recipe UI is torn
     * down and rebuilt by recreateSimulationPanels().
     */
    _resetUiToDefaults() {
        const scopes = [
            'panel-project', 'panel-dimensions', 'panel-aperture', 'panel-materials',
            'panel-sensor', 'panel-viewpoint', 'panel-scene-elements', 'panel-lighting',
            'panel-analysis-modules'
        ];

        scopes.forEach(scopeId => {
            const scope = document.getElementById(scopeId);
            if (!scope) return;

            scope.querySelectorAll('input, select, textarea').forEach(el => {
                const type = (el.type || '').toLowerCase();
                if (type === 'file' || type === 'button' || type === 'submit' || type === 'reset') return;

                let changed = false;
                if (el.tagName === 'SELECT') {
                    Array.from(el.options).forEach(option => {
                        if (option.selected !== option.defaultSelected) {
                            option.selected = option.defaultSelected;
                            changed = true;
                        }
                    });
                } else if (type === 'checkbox' || type === 'radio') {
                    if (el.checked !== el.defaultChecked) {
                        el.checked = el.defaultChecked;
                        changed = true;
                    }
                } else if (el.value !== el.defaultValue) {
                    el.value = el.defaultValue;
                    changed = true;
                }

                if (changed) {
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                }
            });
        });
    }

    async applySettings(settings, showAlertCallback) {
        // Dynamically import the UI module ONLY when settings are being applied.
        const ui = await import('./ui.js');
        const dom = ui.getDom(); // Get the dom cache from the loaded module

        // Wait a bit to ensure DOM is fully ready
        await new Promise(resolve => setTimeout(resolve, 100));

        if (settings.schemaVersion && settings.schemaVersion > PROJECT_SCHEMA_VERSION) {
            console.warn(
                `Project schema version ${settings.schemaVersion} is newer than this build (${PROJECT_SCHEMA_VERSION}). Some settings may not load.`
            );
        }

        // A saved project only stores the keys it had. Without this pass every
        // field the incoming file omits would silently keep the value of the
        // project that was open before it.
        this._resetUiToDefaults();

        // Define helper functions here, now that `dom` is guaranteed to be available.
        // A MISSING KEY means "apply the markup default" (already done by the reset
        // above, so there is nothing to write); a MISSING ELEMENT is a bug and is
        // reported. The two used to be indistinguishable silent no-ops.
        const resolveEl = (id) => dom[id] || document.getElementById(id);
        const setValue = (id, value) => {
            if (value === null || value === undefined) return; // key absent: keep the default
            const el = resolveEl(id);
            if (!el) {
                console.warn(`applySettings: no element with id '${id}'; value not restored.`);
                return;
            }
            el.value = value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        };
        const setChecked = (id, isChecked) => {
            if (isChecked === null || isChecked === undefined) return; // key absent: keep the default
            const el = resolveEl(id);
            if (!el) {
                console.warn(`applySettings: no element with id '${id}'; checked state not restored.`);
                return;
            }
            el.checked = isChecked;
            el.dispatchEvent(new Event('change', { bubbles: true }));
        };
        // Button-backed booleans (btn-group members) are not inputs: restore them
        // by clicking so the group's own handler keeps the .active class in sync.
        const setActiveButton = (id, isActive) => {
            if (isActive === null || isActive === undefined) return;
            const el = resolveEl(id);
            if (!el) {
                console.warn(`applySettings: no element with id '${id}'; active state not restored.`);
                return;
            }
            if (isActive && !el.classList.contains('active')) el.click();
        };

        // --- Project Info & EPW ---
        if (settings.projectInfo) {
            Object.keys(settings.projectInfo).forEach(key => setValue(key, settings.projectInfo[key]));
        }
        if (this.epwFileContent && dom['epw-file-name']) {
            dom['epw-file-name'].textContent = settings.projectInfo?.epwFileName || 'climate.epw';
        }

        // --- Geometry & Apertures ---
        // switchGeometryMode() is async (it suspends on a dynamic import and then
        // resets the dimension inputs). It MUST be awaited before the saved room
        // dimensions are written, or its continuation overwrites them.
        // ui.js accepts 'import', not 'imported'.
        if (settings.geometry?.mode === 'imported') {
            showAlertCallback("This project uses an imported model. Please re-import the original .obj and .mtl files to continue.", "Model Import Required");
            await ui.switchGeometryMode('import');
        } else {
            await ui.switchGeometryMode('parametric');
        }
        if (settings.geometry?.room) {
            Object.keys(settings.geometry.room).forEach(key => setValue(key, settings.geometry.room[key]));
        }
        ['n', 's', 'e', 'w'].forEach(dir => {
            const key = dir.toUpperCase();
            const apertureData = settings.geometry?.apertures?.[key];
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
            const shadingData = settings.geometry?.shading?.[key];
            setChecked(`shading-${dir}-toggle`, !!shadingData);
            if (shadingData) {
                setValue(`shading-type-${dir}`, shadingData.type);
                ui.handleShadingTypeChange(dir, false); // This reveals the correct controls panel

                // Handle existing, non-generative shading types.
                // getAllShadingParams() saves camelCase keys but the controls are
                // kebab-cased (distAbove -> overhang-dist-above-n), so every param
                // used to be dropped on load. A handful of keys are backed by
                // buttons or a select instead of a value input; those are listed
                // explicitly below.
                const restoreShadingGroup = (group, prefix, data) => {
                    if (!data) return;
                    Object.keys(data).forEach(param => {
                        const special = SHADING_PARAM_RESTORERS[`${group}.${param}`];
                        if (special) {
                            special(dir, data[param], { setValue, setActiveButton });
                            return;
                        }
                        setValue(`${prefix}-${camelToKebab(param)}-${dir}`, data[param]);
                    });
                };
                restoreShadingGroup('overhang', 'overhang', shadingData.overhang);
                restoreShadingGroup('lightshelf', 'lightshelf', shadingData.lightshelf);
                restoreShadingGroup('louver', 'louver', shadingData.louver);
                restoreShadingGroup('roller', 'roller', shadingData.roller);

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
        setChecked('frame-toggle', settings.geometry?.frames?.enabled);
        setValue('frame-thick', settings.geometry?.frames?.thickness);
        setValue('frame-depth', settings.geometry?.frames?.depth);
        ['wall', 'floor', 'ceiling', 'frame', 'shading', 'glazing', 'furniture'].forEach(type => {
            if (settings.materials?.[type]) {
                const mat = settings.materials[type];
                if (mat.type) setValue(`${type}-mat-type`, mat.type);
                if (mat.reflectance != null) setValue(`${type}-refl`, mat.reflectance);
                if (mat.specularity != null) setValue(`${type}-spec`, mat.specularity);
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
                if (mat.roughness != null) setValue(`${type}-rough`, mat.roughness);
                if (mat.transmittance != null) setValue(`${type}-trans`, mat.transmittance);
            }
        });
        setChecked('bsdf-toggle', settings.materials?.glazing?.bsdfEnabled);

        // --- Furniture ---
        if (settings.geometry.furniture && Array.isArray(settings.geometry.furniture)) {
            const { addFurniture, furnitureObject } = await import('./geometry.js');
            // Clear any existing furniture before loading. Only the CONTENTS of
            // the container are removed: addFurniture() adds into
            // furnitureObject.children[0], so removing the container itself would
            // make every restored item invisible.
            const furnitureContainer = furnitureObject.children[0];
            if (furnitureContainer) {
                while (furnitureContainer.children.length > 0) furnitureContainer.remove(furnitureContainer.children[0]);
            }

            settings.geometry.furniture.forEach(item => {
                const newObj = addFurniture(item.assetType, new THREE.Vector3(0, 0, 0)); // Add at origin first
                if (newObj) {
                    newObj.position.fromArray(item.position);
                    newObj.quaternion.fromArray(item.quaternion);
                    newObj.scale.fromArray(item.scale);
                }
            });
        }

        // --- Vegetation ---
        // Vegetation was gathered and awaited on save but never restored, so trees
        // vanished on reload and the next save deleted them permanently.
        if (settings.geometry.vegetation && Array.isArray(settings.geometry.vegetation)) {
            const { addVegetation, vegetationObject } = await import('./geometry.js');
            const vegetationContainer = vegetationObject.children[0];
            if (vegetationContainer) {
                while (vegetationContainer.children.length > 0) vegetationContainer.remove(vegetationContainer.children[0]);
            }

            settings.geometry.vegetation.forEach(item => {
                const newObj = addVegetation(item.assetType, new THREE.Vector3(0, 0, 0), false); // Add at origin first
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
            // These two were saved but never restored, and every `sg.illuminance.x`
            // below threw on a project whose JSON has sensorGrids but no illuminance.
            setChecked('illuminance-grid-toggle', sg.illuminance?.enabled);
            setChecked('show-floor-grid-3d-toggle', sg.illuminance?.showIn3D);
            if (sg.illuminance?.floor) {
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
            if (sg.illuminance?.ceiling) {
                setChecked('grid-ceiling-toggle', sg.illuminance.ceiling.enabled);
                setValue('ceiling-grid-spacing', sg.illuminance.ceiling.spacing);
                setValue('ceiling-grid-offset', sg.illuminance.ceiling.offset);
            }
            if (sg.illuminance?.walls) {
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

            // activeView was saved with no restore site. Ids are view-mode-a-btn /
            // view-mode-b-btn / view-mode-diff-btn.
            if (viz.activeView) {
                setActiveButton(`view-mode-${viz.activeView}-btn`, true);
            }

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
            const { createCustomRoom, updateCustomWall } = await import('./customGeometryManager.js');
            const { getCustomWallData } = await import('./customApertureManager.js');
            const { setIsCustomGeometry } = await import('./geometry.js');

            // 1. Set the flag and rebuild the shell. createCustomRoom() calls
            // clearCustomWalls() and re-registers every wall with defaults, so any
            // registration done BEFORE this point is discarded (the old code
            // registered each wall twice for that reason).
            setIsCustomGeometry(true);
            const points = cg.points.map(p => new THREE.Vector3(p.x, p.y, p.z));
            createCustomRoom(points, cg.height);

            // 2. Merge the saved per-wall data over those defaults and rebuild each
            // wall's content so apertures, shading and frames actually reappear.
            if (Array.isArray(cg.walls)) {
                cg.walls.forEach(wall => {
                    const data = getCustomWallData(wall.id);
                    if (!data || !wall.data) return;
                    if (wall.data.apertures) Object.assign(data.apertures, wall.data.apertures);
                    if (wall.data.shading) Object.assign(data.shading, wall.data.shading);
                    if (wall.data.frame) Object.assign(data.frame, wall.data.frame);
                    updateCustomWall(wall.id);
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
