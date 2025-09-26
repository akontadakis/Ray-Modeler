// scripts/project.js

import * as THREE from 'three';
import { generateRadFileContent, generateViewpointFileContent, transformThreePointToRadianceArray, transformThreeVectorToRadianceArray } from './radiance.js';
import { updateScene } from './geometry.js';
import { recreateSimulationPanels } from './simulation.js';
// Import the manager instance (reverted to the simpler direct import)
import { lightingManager } from './lighting.js';
import { generateScripts } from './scriptGenerator.js';

// The local helper functions are removed from here as they will be moved.
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

        // 2. Gather parameters for each individual recipe panel
        const recipePanels = document.querySelectorAll('.floating-window[data-template-id^="template-recipe-"]');
        recipePanels.forEach(panel => {
            const templateId = panel.dataset.templateId;
            const panelIdSuffix = panel.id.replace(`${templateId}-panel-`, '');
            const recipeData = {
                templateId: templateId,
                values: {}
            };

            panel.querySelectorAll('input, select').forEach(input => {
                const key = input.id.replace(`-${panelIdSuffix}`, '');

                if (input.type === 'file') {
                // The key for simulationFiles is the base key (without suffix)
                if (this.simulationFiles[key]) {
                    recipeData.values[key] = { name: this.simulationFiles[key].name };
                } else {
                    recipeData.values[key] = null;
                    }
                } else {
                    recipeData.values[key] = (input.type === 'checkbox' || input.type === 'radio') ? input.checked : input.value;
                }
            });

            simParams.recipes.push(recipeData);
        });

    return simParams;
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

async gatherAllProjectData() {
    // Import UI module to get access to dom
        const ui = await import('./ui.js');
        const dom = ui.getDom();

        this.projectName = dom['project-name'].value || 'default-project';
        const getValue = (id, parser = val => val) => (dom[id] ? parser(dom[id].value) : null);
        const getChecked = (id) => (dom[id] ? dom[id].checked : null);

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
                epwFileName: this.epwFileContent ? (dom['epw-file-name'].textContent || 'climate.epw') : null,
            },
            geometry: {
                room: {
                    width: getValue('width', parseFloat),
                    length: getValue('length', parseFloat),
                    height: getValue('height', parseFloat),
                    'room-orientation': getValue('room-orientation', parseFloat),
                },
                apertures: getAllWindowParams(),
                shading: getAllShadingParams(),
                frames: {
                    enabled: getChecked('frame-toggle'),
                    thickness: getValue('frame-thick', parseFloat),
                    depth: getValue('frame-depth', parseFloat)
                }
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
                        color: getValue(`${type}-color`),
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
                    frame: { type: getValue('frame-mat-type'), reflectance: getValue('frame-refl', parseFloat), specularity: getValue('frame-spec', parseFloat), roughness: getValue('frame-rough', parseFloat), color: getValue('frame-color') },
                    shading: { type: getValue('shading-mat-type'), reflectance: getValue('shading-refl', parseFloat), specularity: getValue('shading-spec', parseFloat), roughness: getValue('shading-rough', parseFloat), color: getValue('shading-color') },
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
            projection: dom['proj-btn-persp'].classList.contains('active') ? 'perspective' : 'orthographic',
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
            visualization: {
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
        
        return projectData;
    }

    async generateSimulationPackage(panelElement) {
        const { showAlert } = await import('./ui.js');
        const { generateRadFileContent, generateRayFileContent } = await import('./radiance.js');
    
        // 1. Check if a project directory is open
        if (!this.dirHandle && !this.dirPath) {
            showAlert('Please save or load a project directory first before generating scripts.', 'Project Directory Not Set');
            return null;
        }
    
        // 2. Gather data and generate script content
        const projectData = await this.gatherAllProjectData();
        const projectName = projectData.projectInfo['project-name']?.replace(/\s+/g, '_') || 'scene';
        this.projectName = projectName;
    
        const globalParams = projectData.simulationParameters.global || {};
        const recipeOverrides = {};
        const panelTemplateId = panelElement.dataset.templateId;
        const panelIdSuffix = panelElement.id.replace(`${panelTemplateId}-panel-`, '');
    
        panelElement.querySelectorAll('input, select').forEach(input => {
            const key = input.id.replace(`-${panelIdSuffix}`, '');
            if (input.type === 'file') {
                if (this.simulationFiles[key]) {
                    recipeOverrides[key] = { name: this.simulationFiles[key].name, content: this.simulationFiles[key].content };
                } else {
                    recipeOverrides[key] = null;
                }
            } else {
                recipeOverrides[key] = (input.type === 'checkbox' || input.type === 'radio') ? input.checked : input.value;
            }
        });
    
        projectData.mergedSimParams = { ...globalParams, ...recipeOverrides };

        // Generate all necessary input files in memory first.
        const { materials, geometry } = generateRadFileContent();
        const viewpointContent = generateViewpointFileContent(projectData.viewpoint, projectData.geometry.room);
        const fisheyeVpData = { ...projectData.viewpoint, 'view-type': 'h' };
        const fisheyeContent = generateViewpointFileContent(fisheyeVpData, projectData.geometry.room);
        const allPtsContent = await this._generateSensorPointsContent('all');
        const taskPtsContent = await this._generateSensorPointsContent('task');
        const surroundingPtsContent = await this._generateSensorPointsContent('surrounding');
        const rayContent = await generateRayFileContent();
    
        const recipeType = panelElement.dataset.templateId;
        const scriptsToGenerate = generateScripts(projectData, recipeType);
    
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
        scriptsToGenerate.push({fileName: 'make_executable.sh', content: makeExecutableContent});

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
        const allPtsContent = await this._generateSensorPointsContent('all');
            const taskPtsContent = await this._generateSensorPointsContent('task');
            const surroundingPtsContent = await this._generateSensorPointsContent('surrounding');
            const daylightingPtsContent = await this._generateDaylightingPointsContent();
            const rayContent = await generateRayFileContent();

            // Generate .vf files for each saved camera view
            const { generateViewpointFileContentFromState } = await import('./radiance.js');
            const savedViewsData = projectData.savedViews || [];
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

            // Sanitize the project data for JSON serialization by removing large file contents.
            const dataForJson = JSON.parse(JSON.stringify(projectData));
            dataForJson.epwFileContent = null;
    
        // 1. Check for a valid save location (either an Electron path or a Browser handle).
        // If none exists, prompt the user to select one.
        if (!this.dirPath && !this.dirHandle) {
             const gotLocation = await this.requestProjectDirectory();
             // Abort the save if the user cancels the directory selection dialog.
             if (!gotLocation) return;
        }
    
        try {
            const { generateRadFileContent, generateRayFileContent } = await import('./radiance.js');
            const projectData = await this.gatherAllProjectData();
            const projectName = this.projectName || 'project';

            // 2. Generate all file contents in memory first.
            const { materials, geometry } = generateRadFileContent();
            const viewpointContent = generateViewpointFileContent(projectData.viewpoint, projectData.geometry.room);
            const fisheyeVpData = { ...projectData.viewpoint, 'view-type': 'h' };
            const fisheyeContent = generateViewpointFileContent(fisheyeVpData, projectData.geometry.room);
            const allPtsContent = await this._generateSensorPointsContent('all');
            const taskPtsContent = await this._generateSensorPointsContent('task');
            const surroundingPtsContent = await this._generateSensorPointsContent('surrounding');
            const daylightingPtsContent = await this._generateDaylightingPointsContent();
            const rayContent = await generateRayFileContent();

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
            if (daylightingPtsContent) {
                filesToWrite.push({ path: ['08_results', 'daylighting_sensors.pts'], content: daylightingPtsContent });
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
        const { generateRadFileContent, generateViewpointFileContent } = await import('./radiance.js');
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

        const { materials, geometry } = generateRadFileContent();
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
    const { dom, showAlert, getSensorGridParams } = await import('./ui.js');
    const points = [];
    const W = parseFloat(dom.width.value);
    const L = parseFloat(dom.length.value);
    const H = parseFloat(dom.height.value);
    const alphaRad = THREE.MathUtils.degToRad(parseFloat(dom['room-orientation'].value));
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
        const spacing = parseFloat(dom['floor-grid-spacing'].value);
        const offset = parseFloat(dom['floor-grid-offset'].value);
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

        const spacing = parseFloat(dom['floor-grid-spacing'].value);
        const offset = parseFloat(dom['floor-grid-offset'].value);
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
        // This is the original logic of the function
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
                spacing = parseFloat(dom[`${name}-grid-spacing`].value);
                offset = parseFloat(dom[`${name}-grid-offset`].value);
                points1 = generateCenteredPoints(W, spacing);
                points2 = generateCenteredPoints(L, spacing);
                // CORRECTED: Define normals in Three.js coordinate system (Y-up)
                normalVector = (name === 'floor') ? [0, 1, 0] : [0, -1, 0];
                positionFunc = (p1, p2) => [p1, name === 'floor' ? offset : H + offset, p2]; // Y is height
            } else {
                spacing = parseFloat(dom['wall-grid-spacing'].value);
                offset = parseFloat(dom['wall-grid-offset'].value);
                points2 = generateCenteredPoints(H, spacing); // Height is vertical span
                const wallLength = (name === 'north' || name === 'south') ? W : L;
                points1 = generateCenteredPoints(wallLength, spacing); // Width/Length is horizontal span

                // CORRECTED: Define normals in Three.js coordinate system (Y-up) and adjust positionFunc
                switch (name) {
                    case 'north': normalVector = [0, 0, 1]; positionFunc = (p1, p2) => [p1, p2, offset]; break;
                    case 'south': normalVector = [0, 0, -1]; positionFunc = (p1, p2) => [p1, p2, L - offset]; break;
                    case 'west':  normalVector = [1, 0, 0]; positionFunc = (p1, p2) => [offset, p2, p1]; break;
                    case 'east':  normalVector = [-1, 0, 0]; positionFunc = (p1, p2) => [W - offset, p2, p1]; break;
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

        const { dom } = await import('./ui.js');
        const W = parseFloat(dom.width.value);
        const L = parseFloat(dom.length.value);
        const rotationY = parseFloat(dom['room-orientation'].value);
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
                await Promise.all(filePromises);
            }

            await this.applySettings(settings, showAlert);

            // Hide the initial prompt since a directory is now successfully loaded.
            const { dom } = await import('./ui.js');
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
                ui.handleShadingTypeChange(dir, false);
                if (shadingData.overhang) Object.keys(shadingData.overhang).forEach(p => setValue(`overhang-${p}-${dir}`, shadingData.overhang[p]));
                if (shadingData.lightshelf) Object.keys(shadingData.lightshelf).forEach(p => setValue(`lightshelf-${p}-${dir}`, shadingData.lightshelf[p]));
                if (shadingData.louver) Object.keys(shadingData.louver).forEach(p => setValue(`louver-${p}-${dir}`, shadingData.louver[p]));
            }
        });

       // --- Frames & Materials ---
        setChecked('frame-toggle', settings.geometry.frames.enabled);
        setValue('frame-thick', settings.geometry.frames.thickness);
        setValue('frame-depth', settings.geometry.frames.depth);
        ['wall', 'floor', 'ceiling', 'frame', 'shading', 'glazing'].forEach(type => {
            if(settings.materials[type]) {
                const mat = settings.materials[type];
                if(mat.type) setValue(`${type}-mat-type`, mat.type);
                if(mat.reflectance) setValue(`${type}-refl`, mat.reflectance);
                if(mat.specularity) setValue(`${type}-spec`, mat.specularity);
                if(mat.color) setValue(`${type}-color`, mat.color);
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
                if(mat.roughness) setValue(`${type}-rough`, mat.roughness);
                if(mat.transmittance) setValue(`${type}-trans`, mat.transmittance);
            }
        });
        setChecked('bsdf-toggle', settings.materials.glazing.bsdfEnabled);

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
                dom['proj-btn-ortho']?.click();
            } else {
                dom['proj-btn-persp']?.click();
            }
            setChecked('transparent-toggle', vo.transparent);
            setChecked('ground-plane-toggle', vo.ground);
            setChecked('world-axes-toggle', vo.worldAxes);
            setValue('world-axes-size', vo.worldAxesSize);
            if(vo.hSection) { setChecked('h-section-toggle', vo.hSection.enabled); setValue('h-section-dist', vo.hSection.dist); }
            if(vo.vSection) { setChecked('v-section-toggle', vo.vSection.enabled); setValue('v-section-dist', vo.vSection.dist); }
        }

        // --- Sensor Grids ---
        if (settings.sensorGrids) {
        const sg = settings.sensorGrids;
            if (sg.floor) { setChecked('grid-floor-toggle', sg.floor.enabled); setValue('floor-grid-spacing', sg.floor.spacing); setValue('floor-grid-offset', sg.floor.offset); setChecked('show-floor-grid-3d-toggle', sg.floor.showIn3D); }
            if (sg.ceiling) { setChecked('grid-ceiling-toggle', sg.ceiling.enabled); setValue('ceiling-grid-spacing', sg.ceiling.spacing); setValue('ceiling-grid-offset', sg.ceiling.offset); }
            if (sg.walls) {
                setValue('wall-grid-spacing', sg.walls.spacing); setValue('wall-grid-offset', sg.walls.offset);
                setChecked('grid-north-toggle', sg.walls.surfaces.n); setChecked('grid-south-toggle', sg.walls.surfaces.s);
                setChecked('grid-east-toggle', sg.walls.surfaces.e); setChecked('grid-west-toggle', sg.walls.surfaces.w);
            }
            if (sg.view) {
                setChecked('view-grid-toggle', sg.view.enabled); setChecked('show-view-grid-3d-toggle', sg.view.showIn3D); setValue('view-grid-spacing', sg.view.spacing);
                setValue('view-grid-offset', sg.view.offset); setValue('view-grid-directions', sg.view.numDirs);
                if(sg.view.startVec) {
                    setValue('view-grid-start-vec-x', sg.view.startVec.x);
                    setValue('view-grid-start-vec-y', sg.view.startVec.y);
                    setValue('view-grid-start-vec-z', sg.view.startVec.z);
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

    // --- Visualization Colors ---
    if (settings.visualization) {
        Object.keys(settings.visualization).forEach(key => setValue(key, settings.visualization[key]));
    }

    // --- Simulation Panels ---
    if (settings.simulationParameters) {
        const { recreateSimulationPanels } = await import('./simulation.js');
        recreateSimulationPanels(settings.simulationParameters, this.simulationFiles, ui);
    }

    // --- Saved Views ---
    if (settings.savedViews) {
        const viewsToLoad = settings.savedViews.map(view => ({
            ...view,
            cameraState: {
                position: new THREE.Vector3().fromArray(view.cameraState.position),
                quaternion: new THREE.Quaternion().fromArray(view.cameraState.quaternion),
                zoom: view.cameraState.zoom,
                target: new THREE.Vector3().fromArray(view.cameraState.target),
                viewType: view.cameraState.viewType,
                fov: view.cameraState.fov
            }
        }));
        ui.loadSavedViews(viewsToLoad);
    } else {
        ui.loadSavedViews([]); // Clear views if none are in the project file
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