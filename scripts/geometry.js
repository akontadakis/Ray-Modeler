// scripts/geometry.js

import * as THREE from 'three';
import { renderer, horizontalClipPlane, verticalClipPlane, sensorTransformControls, importedModelObject } from './scene.js';
import { getAllWindowParams, getAllShadingParams, validateInputs, getWindowParamsForWall, getSensorGridParams, scheduleUpdate } from './ui.js';
import { getDom } from './dom.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { resultsManager } from './resultsManager.js';
import { project } from './project.js';

/**
 * Surface type classification system for ray interaction behavior.
 */
const SURFACE_TYPES = {
    EXTERIOR_WALL: 'EXTERIOR_WALL',
    EXTERIOR_CEILING: 'EXTERIOR_CEILING',
    EXTERIOR_FLOOR: 'EXTERIOR_FLOOR',
    INTERIOR_WALL: 'INTERIOR_WALL',
    INTERIOR_CEILING: 'INTERIOR_CEILING',
    INTERIOR_FLOOR: 'INTERIOR_FLOOR',
    GLAZING: 'GLAZING',
    FRAME: 'FRAME',
    SHADING_DEVICE: 'SHADING_DEVICE'
};

// --- GEOMETRY GROUPS ---
export const roomObject = new THREE.Group();
export const shadingObject = new THREE.Group();
export const sensorGridObject = new THREE.Group();
export const resizeHandlesObject = new THREE.Group();
export const wallSelectionGroup = new THREE.Group(); // Group for selectable walls
export const axesObject = new THREE.Group();
export const groundObject = new THREE.Group();
export const northArrowObject = new THREE.Group();
export const furnitureObject = new THREE.Group();
const furnitureContainer = new THREE.Group();
furnitureObject.add(furnitureContainer);

export const contextObject = new THREE.Group();
export const vegetationObject = new THREE.Group();
const vegetationContainer = new THREE.Group();
vegetationObject.add(vegetationContainer);

export const daylightingSensorsGroup = new THREE.Group();
const taskAreaHelpersGroup = new THREE.Group();

// --- MODULE STATE & SHARED RESOURCES ---
export let currentImportedModel = null;
export let sensorMeshes = []; // Store references to instanced meshes for results
export let daylightingSensorMeshes = []; // Store references to individual sensor meshes for gizmo control
export let importedShadingObjects = []; // Store references to imported OBJ meshes for selection

// Context Object Management System
export let contextObjects = new Map(); // Store context objects with unique IDs
let nextContextObjectId = 1;

const highlightMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--highlight-color').trim() || '#3b82f6'),
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.5,
    depthTest: false // Ensure highlight is always visible
});
let highlightedWall = { object: null, originalMaterial: null };

const shared = {
    lineColor: '#343434',
    gridMinorColor: '#565656',
    sensorGeom: new THREE.SphereGeometry(0.033, 8, 8),
    sensorMat: new THREE.MeshBasicMaterial({ color: '#343434' }), // Fallback color
    wireMat: new THREE.LineBasicMaterial({ color: '#343434' }),
    furnitureMat: new THREE.MeshBasicMaterial({
        color: new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--furniture-color').trim() || '#8D6E63'),
    }),
    shadeMat: new THREE.MeshBasicMaterial({ color: '#1a1a1a', side: THREE.DoubleSide }), // Fallback color
    taskAreaMat: new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.2, side: THREE.DoubleSide }),
    surroundingAreaMat: new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.2, side: THREE.DoubleSide }),
    contextMat: new THREE.MeshBasicMaterial({ color: 0x888888, side: THREE.DoubleSide }),
    vegetationCanopyMat: new THREE.MeshBasicMaterial({ color: 0x4caf50, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
};

// --- HELPER FUNCTIONS ---

/**
 * Updates the color of the selection highlight material based on the current theme.
 */
export function updateHighlightColor() {
    if (highlightMaterial) {
        const newColor = getComputedStyle(document.documentElement).getPropertyValue('--highlight-color').trim() || '#3b82f6';
        highlightMaterial.color.set(newColor);
    }
}

/**
 * Updates the color of all furniture objects to match the current theme.
 */
export function updateFurnitureColor() {
    // Read the color directly from the CSS variables for the active theme.
    const newColor = getComputedStyle(document.documentElement).getPropertyValue('--furniture-color').trim() || '#8D6E63';

    // Since all furniture shares one material instance, we only need to update that single instance.
    shared.furnitureMat.color.set(newColor);
}

function applyClippingToMaterial(mat, clippingPlanes) {
    if (!mat) return;
    mat.clippingPlanes = clippingPlanes;
    mat.clipIntersection = true;
}

function disposeMeshLike(obj) {
    if (obj.geometry) obj.geometry.dispose?.();
    if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose?.());
        else obj.material.dispose?.();
    }
}

function clearGroup(group) {
    if (group === sensorGridObject) {
        sensorMeshes.length = 0; // Clear the references when clearing the group
    }
    if (group === resizeHandlesObject) {
        // No specific cleanup needed yet, but good to have the case
    }
    if (group === wallSelectionGroup) {
        highlightedWall = { object: null, originalMaterial: null };
    }
    if (group === furnitureObject) {
        // Any specific cleanup for furniture can go here
    }
    if (group === daylightingSensorsGroup) {
        daylightingSensorMeshes.length = 0;
    }
    if (group === shadingObject) {
        importedShadingObjects.length = 0;
    }
    if (group === contextObject) {
        // No specific cleanup needed yet, but good to have the case
    }
    if (group === vegetationObject) {
        // No specific cleanup needed
    }
    group.traverse(child => {
        if (child.element && child.removeFromParent) {
            child.element.remove();
        }
        disposeMeshLike(child);
    });
    while (group.children.length) group.remove(group.children[0]);
}

function readParams() {
    const dom = getDom();
    const W = parseFloat(dom.width.value);
    const L = parseFloat(dom.length.value);
    const H = parseFloat(dom.height.value);
    const elevation = parseFloat(dom.elevation.value);
    const rotationY = THREE.MathUtils.degToRad(parseFloat(dom['room-orientation'].value));
    const surfaceThickness = parseFloat(dom['surface-thickness'].value);
    return { W, L, H, elevation, rotationY, wallThickness: surfaceThickness, floorThickness: surfaceThickness, ceilingThickness: surfaceThickness };
}

// --- MAIN UPDATE FUNCTION ---

/**
 * The main function to update all geometric aspects of the scene.
 * @param {string|null} changedId The ID of the input element that triggered the update.
 */
export async function updateScene(changedId = null) {
    if (!renderer) return;
    const dom = getDom();

    validateInputs(changedId);
    const { W, L, H, rotationY, elevation } = readParams();

    // Apply room rotation and elevation to all relevant geometry groups
    const groupsToTransform = [roomObject, shadingObject, sensorGridObject, wallSelectionGroup, furnitureObject, daylightingSensorsGroup, resizeHandlesObject, vegetationObject];
    groupsToTransform.forEach(group => {
        group.rotation.y = rotationY;
        group.position.y = elevation;
    });

    const showGround = dom['ground-plane-toggle'].checked;
    groundObject.visible = showGround;
    northArrowObject.visible = true; // North Arrow is now always visible

    // Update clipping planes
    const activeClippingPlanes = [];
    if (dom['h-section-toggle'].checked) {
        horizontalClipPlane.constant = parseFloat(dom['h-section-dist'].value);
        activeClippingPlanes.push(horizontalClipPlane);
    }
    if (dom['v-section-toggle'].checked) {
        const vDist = parseFloat(dom['v-section-dist'].value);
        verticalClipPlane.constant = vDist - W / 2;
        activeClippingPlanes.push(verticalClipPlane);
    }
    renderer.clippingPlanes = activeClippingPlanes;

    // If the room orientation changed, re-sync the viewpoint camera from the UI sliders.
    if (changedId === 'room-orientation') {
        updateViewpointFromSliders();
    }

    // Recreate all geometry based on the new parameters
    createRoomGeometry();
    createShadingDevices();
    createSensorGrid();
    createGroundPlane();
    createNorthArrow();
    createResizeHandles();
    updateDaylightingSensorVisuals();

    // Create or update the world axes helper
    let axesHelper = axesObject.getObjectByName('axesHelper');
    if (!axesHelper) {
        axesHelper = new THREE.AxesHelper(1); // Create with a unit size of 1
        axesHelper.name = 'axesHelper';
        axesObject.add(axesHelper);
    }
    const axesSize = dom['world-axes-size'] ? parseFloat(dom['world-axes-size'].value) : 1.5;
    axesObject.scale.set(axesSize, axesSize, axesSize); // Scale the parent group
    axesObject.position.set(0, 0.01, 0); // Lift slightly off the ground plane
    axesObject.visible = dom['world-axes-toggle']?.checked ?? true;

    // After rebuilding geometry, re-apply the highlight if a wall was selected
    const { selectedWallId } = await import('./ui.js');
    if (selectedWallId) {
        const wallContainer = wallSelectionGroup.children[0];
        if (wallContainer) {
            const wallToHighlight = wallContainer.children.find(
                group => group.userData.canonicalId === selectedWallId
            );
            if (wallToHighlight) {
                const wallMesh = wallToHighlight.children.find(c => c.isMesh && c.userData.isSelectableWall);
                if (wallMesh) {
                    highlightWall(wallMesh);
                }
            }
        }
    }
}

// --- GEOMETRY CREATION FUNCTIONS ---

/**
 * Creates a mesh with a wireframe outline.
 * @param {THREE.BufferGeometry} geometry The geometry for the mesh.
 * @param {THREE.Group} group The group to add the mesh and wireframe to.
 * @param {THREE.Material} material The material for the mesh's surfaces.
 * @param {string} [surfaceType] - Optional surface type for ray tracing classification.
 */
function createSchematicObject(geometry, group, material, surfaceType) {
    const mesh = new THREE.Mesh(geometry, material);
    if (surfaceType) {
        mesh.userData.surfaceType = surfaceType;
    }
    applyClippingToMaterial(mesh.material, renderer.clippingPlanes);

    const edges = new THREE.EdgesGeometry(geometry);
    let wireMat = shared.wireMat;
    if (renderer.clippingPlanes.length > 0) {
        wireMat = wireMat.clone();
        applyClippingToMaterial(wireMat, renderer.clippingPlanes);
    }
    const wireframe = new THREE.LineSegments(edges, wireMat);
    group.add(mesh, wireframe);
    return mesh;
}

/**
 * Creates the ground plane, which can be a flat grid or a 3D topography.
 */
function createGroundPlane() {
    clearGroup(groundObject);
    const dom = getDom();
    const { W, L } = readParams();

    // Read grid size and divisions from the UI
    const gridSize = dom['ground-grid-size'] ? parseFloat(dom['ground-grid-size'].value) : 50;
    const gridDivisions = dom['ground-grid-divisions'] ? parseInt(dom['ground-grid-divisions'].value, 10) : 50;

    const isTopoMode = dom['context-mode-topo']?.classList.contains('active');
    const topoFile = project.simulationFiles['topo-heightmap-file'];

    if (isTopoMode && topoFile && topoFile.content instanceof Blob) {
        // --- Create Topography from Heightmap ---
        const imageUrl = URL.createObjectURL(topoFile.content);
        const planeSize = parseFloat(dom['topo-plane-size'].value);
        const verticalScale = parseFloat(dom['topo-vertical-scale'].value);

        const img = new Image();
        img.onerror = () => {
            import('./ui.js').then(({ showAlert }) => {
                showAlert(`Failed to load the specified heightmap image: ${topoFile.name}. Please check if the file is a valid image.`, 'Topography Error');
            });
            URL.revokeObjectURL(imageUrl); // Clean up
        };
        img.onload = () => {
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = img.width;
            tempCanvas.height = img.height;
            const ctx = tempCanvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const imageData = ctx.getImageData(0, 0, img.width, img.height);
            const data = imageData.data;

            const geometry = new THREE.PlaneGeometry(planeSize, planeSize, img.width - 1, img.height - 1);
            const vertices = geometry.attributes.position;

            for (let i = 0; i < vertices.count; i++) {
                const u = (vertices.getX(i) / planeSize + 0.5);
                const v = 1 - (vertices.getY(i) / planeSize + 0.5);
                const px = Math.floor(u * (img.width - 1));
                const py = Math.floor(v * (img.height - 1));
                const pixelIndex = (py * img.width + px) * 4;
                const height = data[pixelIndex] / 255.0; // Use red channel as height
                vertices.setZ(i, height * verticalScale);
            }
            vertices.needsUpdate = true;
            geometry.computeVertexNormals();

            const groundMaterial = new THREE.MeshStandardMaterial({
                color: 0x5a687a,
                wireframe: true,
                side: THREE.DoubleSide
            });
            applyClippingToMaterial(groundMaterial, renderer.clippingPlanes);

            const mesh = new THREE.Mesh(geometry, groundMaterial);
            mesh.rotation.x = -Math.PI / 2; // Orient plane correctly
            mesh.userData.isGround = true; // Flag for Radiance export
            groundObject.add(mesh);
            URL.revokeObjectURL(imageUrl); // Clean up
        };
        img.onerror = () => {
            console.error("Failed to load heightmap image.");
            URL.revokeObjectURL(imageUrl);
        };
        img.src = imageUrl;
    } else {
        // --- Create Default Flat Grid ---
        // Use the values from the UI sliders
        const size = gridSize;
        const gridHelper = new THREE.GridHelper(size, gridDivisions, shared.lineColor, shared.gridMinorColor);
        gridHelper.position.set(0, -0.001, 0);

        const mat = new THREE.MeshBasicMaterial({
            color: 0xdddddd,
            transparent: true,
            opacity: 0.15,
            side: THREE.DoubleSide
        });
        applyClippingToMaterial(mat, renderer.clippingPlanes);
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
        plane.rotation.x = -Math.PI / 2;
        plane.position.y = -0.002;
        plane.userData.isGround = true; // Flag for Radiance export
        groundObject.add(gridHelper, plane);
    }
}

/**
 * Creates the entire room geometry, including walls, floor, ceiling, windows, and frames.
 * Walls are now individual, selectable meshes.
 */
function createRoomGeometry() {
    // If an imported model is active, do not generate parametric geometry.
    if (currentImportedModel) {
        clearGroup(roomObject);
        clearGroup(wallSelectionGroup);
        return;
    }
    clearGroup(roomObject);
    clearGroup(wallSelectionGroup);

    const { W, L, H, wallThickness, floorThickness, ceilingThickness } = readParams();
    const roomContainer = new THREE.Group();
    roomContainer.position.set(-W / 2, 0, -L / 2);

    _createFloor(roomContainer, { W, L, floorThickness, wallThickness });
    _createCeiling(roomContainer, { W, L, H, ceilingThickness, wallThickness });
    _createWalls({ W, L, H, wallThickness });

    roomObject.add(roomContainer);
}

/**
 * Creates the floor geometry and adds it to the room container.
 * @param {THREE.Group} roomContainer - The parent group for the floor.
 * @param {object} dims - Dimensions object { W, L, floorThickness, wallThickness }.
 * @private
 */
function _createFloor(roomContainer, { W, L, floorThickness, wallThickness }) {
    const isTransparent = getDom()['transparent-toggle'].checked;
    const surfaceOpacity = isTransparent ? parseFloat(getDom()['surface-opacity'].value) : 1.0;
    const materialProperties = { side: THREE.DoubleSide, clippingPlanes: renderer.clippingPlanes, clipIntersection: true, transparent: isTransparent, opacity: surfaceOpacity };
    const floorMaterial = new THREE.MeshBasicMaterial({ ...materialProperties, color: new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--floor-color').trim()) });

    const floorGeom = new THREE.BoxGeometry(W + 2 * wallThickness, L + 2 * wallThickness, floorThickness);
    const floorGroup = new THREE.Group();
    floorGroup.rotation.x = -Math.PI / 2;
    floorGroup.position.set(W / 2, -floorThickness / 2 - 0.001, L / 2); // Lower slightly to avoid Z-fighting
    createSchematicObject(floorGeom, floorGroup, floorMaterial, SURFACE_TYPES.INTERIOR_FLOOR);
    roomContainer.add(floorGroup);
}

/**
 * Creates the ceiling geometry and adds it to the room container.
 * @param {THREE.Group} roomContainer - The parent group for the ceiling.
 * @param {object} dims - Dimensions object { W, L, H, ceilingThickness, wallThickness }.
 * @private
 */
function _createCeiling(roomContainer, { W, L, H, ceilingThickness, wallThickness }) {
    const isTransparent = getDom()['transparent-toggle'].checked;
    const surfaceOpacity = isTransparent ? parseFloat(getDom()['surface-opacity'].value) : 1.0;
    const materialProperties = { side: THREE.DoubleSide, clippingPlanes: renderer.clippingPlanes, clipIntersection: true, transparent: isTransparent, opacity: surfaceOpacity };
    const ceilingMaterial = new THREE.MeshBasicMaterial({ ...materialProperties, color: new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--ceiling-color').trim()) });

    const ceilingGeom = new THREE.BoxGeometry(W + 2 * wallThickness, L + 2 * wallThickness, ceilingThickness);
    const ceilingGroup = new THREE.Group();
    ceilingGroup.rotation.x = -Math.PI / 2;
    ceilingGroup.position.set(W / 2, H + ceilingThickness / 2 + 0.001, L / 2); // Raise slightly to avoid Z-fighting
    createSchematicObject(ceilingGeom, ceilingGroup, ceilingMaterial, SURFACE_TYPES.INTERIOR_CEILING);
    roomContainer.add(ceilingGroup);
}

/**
 * Creates all four walls and adds them to the selectable wall group.
 * @param {object} dims - Dimensions object { W, L, H, wallThickness }.
 * @private
 */
function _createWalls({ W, L, H, wallThickness }) {
    const wallContainer = new THREE.Group();
    wallContainer.position.set(-W / 2, 0, -L / 2);

    const allWindows = getAllWindowParams();
    const walls = {
        n: { s: [W, H], p: [W / 2, H / 2, 0], r: [0, Math.PI, 0] },
        s: { s: [W, H], p: [W / 2, H / 2, L], r: [0, 0, 0] },
        w: { s: [L, H], p: [0, H / 2, L / 2], r: [0, -Math.PI / 2, 0] },
        e: { s: [L, H], p: [W, H / 2, L / 2], r: [0, -Math.PI / 2, 0] },
    };

    for (const [key, props] of Object.entries(walls)) {
        const wallSegment = _createWallSegment(key, props, allWindows[key.toUpperCase()], { H, wallThickness });
        wallContainer.add(wallSegment);
    }
    wallSelectionGroup.add(wallContainer);
}

/**
 * Creates a single wall segment, including windows and frames.
 * @param {string} key - The wall identifier ('n', 's', 'e', 'w').
 * @param {object} props - The wall's properties (size, position, rotation).
 * @param {object} winParams - The window parameters for this wall.
 * @param {object} roomDims - Room dimensions { H, wallThickness }.
 * @returns {THREE.Group} The group containing the wall mesh and its components.
 * @private
 */
function _createWallSegment(key, props, winParams, { H, wallThickness }) {
    const dom = getDom();
    const isTransparent = dom['transparent-toggle'].checked;
    const surfaceOpacity = isTransparent ? parseFloat(dom['surface-opacity'].value) : 1.0;
    const materialProperties = { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, side: THREE.DoubleSide, clippingPlanes: renderer.clippingPlanes, clipIntersection: true, transparent: isTransparent, opacity: surfaceOpacity };
    const wallMaterial = new THREE.MeshBasicMaterial({ ...materialProperties, color: new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--wall-color').trim()) });
    const windowMaterial = new THREE.MeshBasicMaterial({ color: 0xb3ecff, side: THREE.DoubleSide, transparent: true, opacity: parseFloat(dom['glazing-trans'].value), clippingPlanes: renderer.clippingPlanes, clipIntersection: true, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 1 });
    const frameMaterial = new THREE.MeshBasicMaterial({ ...materialProperties, color: new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--frame-color').trim()) });

    const wallMeshGroup = new THREE.Group();
    wallMeshGroup.position.set(...props.p);
    wallMeshGroup.rotation.set(...props.r);
    wallMeshGroup.userData = { canonicalId: key };

    const isEW = key === 'e' || key === 'w';
    let wallW = props.s[0];
    const wallH = props.s[1];
    if (isEW) wallW += (2 * wallThickness);

    if (winParams && winParams.ww > 0 && winParams.wh > 0 && winParams.winCount > 0) {
        const { ww, wh, sh, winCount, mode, winDepthPos } = winParams;
        const wallShape = new THREE.Shape();
        wallShape.moveTo(-wallW / 2, -wallH / 2);
        wallShape.lineTo(wallW / 2, -wallH / 2);
        wallShape.lineTo(wallW / 2, wallH / 2);
        wallShape.lineTo(-wallW / 2, wallH / 2);
        wallShape.closePath();

        const spacing = mode === 'wwr' ? 0.1 : ww / 2;
        const groupWidth = winCount * ww + Math.max(0, winCount - 1) * spacing;
        const startX = -groupWidth / 2;

        // Safely check for frame toggle and values
        const addFrame = dom['frame-toggle']?.checked ?? false;
        const ft = addFrame ? (parseFloat(dom['frame-thick']?.value) || 0) : 0;
        const frameDepth = addFrame ? (parseFloat(dom['frame-depth']?.value) || 0) : 0;

        for (let i = 0; i < winCount; i++) {
            const winCenterX = startX + ww / 2 + i * (ww + spacing);
            const winCenterY = sh + wh / 2 - H / 2;
            const holePath = new THREE.Path();
            holePath.moveTo(winCenterX - ww / 2, winCenterY - wh / 2);
            holePath.lineTo(winCenterX + ww / 2, winCenterY - wh / 2);
            holePath.lineTo(winCenterX + ww / 2, winCenterY + wh / 2);
            holePath.lineTo(winCenterX - ww / 2, winCenterY + wh / 2);
            holePath.closePath();
            wallShape.holes.push(holePath);

            const effectiveWinDepthPos = (isEW) ? -winDepthPos : winDepthPos;
            const glassWidth = Math.max(0, ww - 2 * ft);
            const glassHeight = Math.max(0, wh - 2 * ft);

            if (glassWidth > 0 && glassHeight > 0) {
                const glass = new THREE.Mesh(new THREE.PlaneGeometry(glassWidth, glassHeight), windowMaterial);
                glass.userData.surfaceType = SURFACE_TYPES.GLAZING;
                applyClippingToMaterial(glass.material, renderer.clippingPlanes);
                glass.position.set(winCenterX, winCenterY, effectiveWinDepthPos);
                wallMeshGroup.add(glass);
            }

            if (addFrame && ft > 0) {
                const frameShape = new THREE.Shape();
                frameShape.moveTo(winCenterX - ww / 2, winCenterY - wh / 2);
                frameShape.lineTo(winCenterX + ww / 2, winCenterY - wh / 2);
                frameShape.lineTo(winCenterX + ww / 2, winCenterY + wh / 2);
                frameShape.lineTo(winCenterX - ww / 2, winCenterY + wh / 2);
                frameShape.closePath();
                const frameHole = new THREE.Path();
                frameHole.moveTo(winCenterX - glassWidth / 2, winCenterY - glassHeight / 2);
                frameHole.lineTo(winCenterX + glassWidth / 2, winCenterY - glassHeight / 2);
                frameHole.lineTo(winCenterX + glassWidth / 2, winCenterY + glassHeight / 2);
                frameHole.lineTo(winCenterX - glassWidth / 2, winCenterY + glassHeight / 2);
                frameHole.closePath();
                frameShape.holes.push(frameHole);

                const frameExtrudeSettings = { steps: 1, depth: frameDepth, bevelEnabled: false };
                const frameGeometry = new THREE.ExtrudeGeometry(frameShape, frameExtrudeSettings);
                frameGeometry.translate(0, 0, effectiveWinDepthPos - (frameDepth / 2));
                const frameMesh = new THREE.Mesh(frameGeometry, frameMaterial);
                frameMesh.userData.surfaceType = SURFACE_TYPES.FRAME;
                applyClippingToMaterial(frameMesh.material, renderer.clippingPlanes);
                wallMeshGroup.add(frameMesh);
            }
        }

        const extrudeSettings = { steps: 1, depth: wallThickness, bevelEnabled: false };
        const wallGeometry = new THREE.ExtrudeGeometry(wallShape, extrudeSettings);
        if (isEW) wallGeometry.translate(0, 0, -wallThickness);
        const wallMeshWithHoles = createSchematicObject(wallGeometry, wallMeshGroup, wallMaterial, SURFACE_TYPES.INTERIOR_WALL);
        wallMeshWithHoles.userData.isSelectableWall = true;
    } else {
        const wallGeometry = new THREE.BoxGeometry(wallW, wallH, wallThickness);
        const z_translation = isEW ? -wallThickness / 2 : wallThickness / 2;
        wallGeometry.translate(0, 0, z_translation);
        const wallMesh = createSchematicObject(wallGeometry, wallMeshGroup, wallMaterial, SURFACE_TYPES.INTERIOR_WALL);
        wallMesh.userData.isSelectableWall = true;
    }
    return wallMeshGroup;
}

/**
 * Creates the sensor grid geometry for all selected surfaces.
 */
export function createSensorGrid() {
    clearGroup(sensorGridObject);
    const dom = getDom();
    const { W, L, H } = readParams();
    const gridParams = getSensorGridParams();
    if (!gridParams) return;

    const gridContainer = new THREE.Group();
    gridContainer.position.set(-W / 2, 0, -L / 2);

    // Visualize Illuminance Grids (Spheres)
    if (gridParams.illuminance.enabled && gridParams.illuminance.showIn3D) {
        const surfaces = ['floor', 'ceiling', 'north', 'south', 'east', 'west'];
        surfaces.forEach(surface => {
            if (dom[`grid-${surface}-toggle`]?.checked) {
                createGridForSurface(surface, W, L, H, gridContainer, 'illuminance', gridParams);
            }
        });
        // Add visual helpers for task/surrounding areas
        _createTaskAreaVisuals(W, L, gridContainer, gridParams);
    }

    // Visualize View Grids (Arrows on floor)
    if (gridParams.view.enabled && gridParams.view.showIn3D) {
        createGridForSurface('floor', W, L, H, gridContainer, 'view', gridParams);
    }

    sensorGridObject.add(gridContainer);
}

/**
 * Generates an array of centered point coordinates along a single axis.
 * @param {number} totalLength The total length of the surface.
 * @param {number} spacing The distance between points.
 * @returns {number[]} An array of coordinate values.
 */
function generateCenteredPoints(totalLength, spacing) {
    if (spacing <= 0 || totalLength <= 0) return [];

    const numPoints = Math.floor(totalLength / spacing);
    if (numPoints === 0) return [];

    // If there's only one point, it should be in the center.
    if (numPoints === 1) {
        return [totalLength / 2];
    }

    const totalGridLength = (numPoints - 1) * spacing;
    const start = (totalLength - totalGridLength) / 2;

    return Array.from({ length: numPoints }, (_, i) => start + i * spacing);
}

/**
 * Generates an array of Vector3 positions for a grid on a specific surface.
 * @param {string} surface - The name of the surface ('floor', 'north', etc.).
 * @param {number} W - Room width.
 * @param {number} L - Room length.
 * @param {number} H - Room height.
 * @returns {THREE.Vector3[]} An array of sensor positions.
 */
function _generateGridPositions(surface, W, L, H) {
    const gridParams = getSensorGridParams();
    const positions = [];

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

    const strategies = {
        floor: () => {
            const params = gridParams.illuminance.floor;
            if (!params.isTaskArea) {
                const pointsX = generateCenteredPoints(W, params.spacing);
                const pointsZ = generateCenteredPoints(L, params.spacing);
                for (const x of pointsX) for (const z of pointsZ) positions.push(new THREE.Vector3(x, params.offset, z));
            } else {
                const task = params.task;
                generatePointsInRect(task.x, task.z, task.width, task.depth, params.spacing)
                    .forEach(p => positions.push(new THREE.Vector3(p.x, params.offset, p.z)));
                if (params.hasSurrounding) {
                    const band = params.surroundingWidth;
                    const outerX = Math.max(0, task.x - band);
                    const outerZ = Math.max(0, task.z - band);
                    const outerW = Math.min(W - outerX, task.width + 2 * band);
                    const outerD = Math.min(L - outerZ, task.depth + 2 * band);
                    generatePointsInRect(outerX, outerZ, outerW, outerD, params.spacing).forEach(p => {
                        if (p.x < task.x || p.x > task.x + task.width || p.z < task.z || p.z > task.z + task.depth) {
                            positions.push(new THREE.Vector3(p.x, params.offset, p.z));
                        }
                    });
                }
            }
        },
        ceiling: () => {
            const params = gridParams.illuminance.ceiling;
            const pointsX = generateCenteredPoints(W, params.spacing);
            const pointsZ = generateCenteredPoints(L, params.spacing);
            for (const x of pointsX) for (const z of pointsZ) positions.push(new THREE.Vector3(x, H + params.offset, z));
        },
        walls: (orientation) => {
            const params = gridParams.illuminance.walls;
            const wallLength = (orientation === 'north' || orientation === 'south') ? W : L;
            const points1 = generateCenteredPoints(wallLength, params.spacing);
            const points2 = generateCenteredPoints(H, params.spacing);
            const positionFuncs = {
                north: (p1, p2) => new THREE.Vector3(p1, p2, params.offset),
                south: (p1, p2) => new THREE.Vector3(p1, p2, L - params.offset),
                west: (p1, p2) => new THREE.Vector3(params.offset, p2, p1),
                east: (p1, p2) => new THREE.Vector3(W - params.offset, p2, p1),
            };
            for (const p1 of points1) for (const p2 of points2) positions.push(positionFuncs[orientation](p1, p2));
        }
    };

    if (surface === 'ceiling' || surface === 'floor') {
        strategies[surface]();
    } else if (['north', 'south', 'east', 'west'].includes(surface)) {
        strategies.walls(surface);
    }

    return positions;
}

/**
 * Helper to create a grid of sensor points on a specific surface using InstancedMesh.
 */
function createGridForSurface(surface, W, L, H, container, visualizationType, gridParams) {
    if (visualizationType === 'illuminance') {
        const positions = _generateGridPositions(surface, W, L, H);

        if (positions.length > 0) {
            const sensorColor = getComputedStyle(document.documentElement).getPropertyValue('--illuminance-grid-color').trim();
            const sensorMaterial = new THREE.MeshBasicMaterial({ color: sensorColor });
            const instanced = new THREE.InstancedMesh(shared.sensorGeom, sensorMaterial, positions.length);
            applyClippingToMaterial(instanced.material, renderer.clippingPlanes);
            const dummy = new THREE.Object3D();
            positions.forEach((pos, idx) => {
                dummy.position.copy(pos);
                dummy.updateMatrix();
                instanced.setMatrixAt(idx, dummy.matrix);
            });
            instanced.instanceMatrix.needsUpdate = true;
            container.add(instanced);
            sensorMeshes.push(instanced); // Store the reference
        }

    } else if (visualizationType === 'view' && surface === 'floor') {
        const { spacing, offset, numDirs, startVec } = gridParams.view;
        if (!spacing || !(spacing > 0) || !numDirs || !(numDirs > 0)) return;

        const pointsX = generateCenteredPoints(W, spacing);
        const pointsZ = generateCenteredPoints(L, spacing);

        const positions = [];
        for (const x of pointsX) {
            for (const z of pointsZ) {
                positions.push(new THREE.Vector3(x, offset, z));
            }
        }

        if (positions.length === 0) return;

        const startVector = new THREE.Vector3().fromArray(startVec).normalize();
        const upVector = new THREE.Vector3(0, 1, 0); // Y is up in local THREE.js space
        const arrowColor = getComputedStyle(document.documentElement).getPropertyValue('--view-grid-color').trim();
        const arrowLength = spacing * 0.25;
        const viewGridGroup = new THREE.Group();

        positions.forEach(origin => {
            for (let k = 0; k < numDirs; k++) {
                const angle = (k / numDirs) * 2 * Math.PI;
                const direction = startVector.clone().applyAxisAngle(upVector, angle);
                const arrowHelper = new THREE.ArrowHelper(direction, origin, arrowLength, arrowColor, arrowLength * 0.3, arrowLength * 0.2);
                viewGridGroup.add(arrowHelper);
            }
        });
        container.add(viewGridGroup);
    }
}

/**
 * Creates a 3D North arrow indicator.
 */
function createNorthArrow() {
    clearGroup(northArrowObject);
    const { W, L } = readParams();
    const origin = new THREE.Vector3((W / 2) + Math.max(W / 2, L / 2) + 1.5, 0, 0);
    const arrowColor = getComputedStyle(document.documentElement).getPropertyValue('--north-arrow-color').trim();
    const arrowHelper = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), origin, 1, arrowColor, 0.4, 0.2);
    northArrowObject.add(arrowHelper);

    const nDiv = document.createElement('div');
    nDiv.textContent = 'N';
    nDiv.style.color = arrowColor;
    nDiv.style.fontWeight = 'bold';
    const nLabel = new CSS2DObject(nDiv);
    nLabel.position.copy(origin).add(new THREE.Vector3(0, 0, -1.2));
    northArrowObject.add(nLabel);
}

/**
 * Returns the outward normal vector for a given wall orientation in ROOM-LOCAL coordinates
 * (before the global room rotation is applied).
 *
 * Conventions (room-local, origin at room center, Z forward):
 * - 'N' (north wall): outward = (0, 0, -1)
 * - 'S' (south wall): outward = (0, 0, 1)
 * - 'W' (west wall):  outward = (-1, 0, 0)
 * - 'E' (east wall):  outward = (1, 0, 0)
 */
function getWallOutwardNormal(orientation) {
    switch (orientation) {
        case 'N': return new THREE.Vector3(0, 0, -1);
        case 'S': return new THREE.Vector3(0, 0, 1);
        case 'W': return new THREE.Vector3(-1, 0, 0);
        case 'E': return new THREE.Vector3(1, 0, 0);
        default: return new THREE.Vector3(0, 0, 0);
    }
}

/**
 * Creates all shading devices based on UI settings.
 * Uses explicit outward normals for consistent external/internal placement across orientations.
 */
export function createShadingDevices() {
    clearGroup(shadingObject);
    const allWindows = getAllWindowParams();
    const allShading = getAllShadingParams();

    if (!allWindows || !allShading) return;

    const shadeColor = getComputedStyle(document.documentElement).getPropertyValue('--shading-color').trim();
    const { W, L } = readParams();

    const shadingContainer = new THREE.Group();
    // Room-local origin at (-W/2, 0, -L/2) to match wall/window construction
    shadingContainer.position.set(-W / 2, 0, -L / 2);

    for (const [orientation, winParams] of Object.entries(allWindows)) {
        const shadeParams = allShading[orientation];
        if (!winParams || !shadeParams) continue;

        const { ww, wh, sh, winCount, mode, wallWidth, winDepthPos } = winParams;
        if (!ww || !wh || !winCount) continue;

        const outward = getWallOutwardNormal(orientation);
        if (outward.lengthSq() === 0) continue;

        // Determine if East or West wall
        const isEW = (orientation === 'E' || orientation === 'W');
        // Apply same inversion logic as windows for consistent positioning
        const effectiveWinDepthPos = isEW ? -winDepthPos : winDepthPos;

        const spacing = mode === 'wwr' ? 0.1 : ww / 2;
        const groupWidth = winCount * ww + Math.max(0, winCount - 1) * spacing;
        const startOffset = (wallWidth - groupWidth) / 2;

        // Glass center lies at effectiveWinDepthPos along outward (positive: towards exterior)
        const glassOffset = outward.clone().multiplyScalar(effectiveWinDepthPos);

        for (let i = 0; i < winCount; i++) {
            const winStartPos = startOffset + i * (ww + spacing);
            const windowCenterLocal = (() => {
                switch (orientation) {
                    case 'N': return new THREE.Vector3(winStartPos + ww / 2, sh, 0);
                    case 'S': return new THREE.Vector3(winStartPos + ww / 2, sh, L);
                    case 'W': return new THREE.Vector3(0, sh, winStartPos + ww / 2);
                    case 'E': return new THREE.Vector3(W, sh, winStartPos + ww / 2);
                    default: return new THREE.Vector3(0, sh, 0);
                }
            })();

            let deviceGroup = null;

            if (shadeParams.type === 'overhang' && shadeParams.overhang) {
                deviceGroup = createOverhang(ww, wh, shadeParams.overhang, shadeColor, outward, orientation);
            } else if (shadeParams.type === 'lightshelf' && shadeParams.lightshelf) {
                deviceGroup = createLightShelf(ww, wh, sh, shadeParams.lightshelf, shadeColor, outward);
            } else if (shadeParams.type === 'louver' && shadeParams.louver) {
                deviceGroup = createLouvers(ww, wh, shadeParams.louver, shadeColor, outward);
            } else if (shadeParams.type === 'roller' && shadeParams.roller) {
                deviceGroup = createRoller(ww, wh, shadeParams.roller, shadeColor, outward);
            } else if (shadeParams.type === 'imported_obj' && shadeParams.imported_obj) {
                deviceGroup = createImportedShading(shadeParams.imported_obj, shadeColor, orientation, i);
            }

            if (!deviceGroup) continue;

            // Define wall rotations (must match _createWallSegment)
            const wallRotations = {
                N: [0, Math.PI, 0],
                S: [0, 0, 0],
                W: [0, -Math.PI / 2, 0],
                E: [0, Math.PI / 2, 0]
            };

            // Apply the correct wall rotation to the shading device
            const rotation = wallRotations[orientation];
            if (rotation) {
                deviceGroup.rotation.set(...rotation);
            }

            // Place deviceGroup origin at window center, then offset relative to glass position
            // Subtract glassOffset to invert positioning as requested
            const base = windowCenterLocal.clone().sub(glassOffset);
            deviceGroup.position.copy(base);

            shadingContainer.add(deviceGroup);

            // Dev-only sanity check (guarded to avoid errors in browser-only environments):
            const isDevEnv =
                typeof process !== 'undefined' &&
                process.env &&
                process.env.NODE_ENV === 'development';

            if (isDevEnv && shadeParams.type !== 'roller') {
                const sample = deviceGroup.position.clone();
                const rel = sample.clone().sub(windowCenterLocal);
                const dot = rel.dot(outward);

                if (dot < -1e-3) {
                    console.warn('[shading] Shading device appears on interior side of glazing.', {
                        orientation,
                        deviceIndex: i,
                        dotProduct: dot.toFixed(4)
                    });
                }
            }
        }
    }

    shadingObject.add(shadingContainer);
}

/**
 * Creates a single overhang device.
 */
function createOverhang(winWidth, winHeight, params, color, outward, orientation) {
    const { distAbove, tilt, depth, leftExtension, rightExtension, thick } = params; if (depth <= 0) return null;

    const assembly = new THREE.Group();
    const pivot = new THREE.Group();
    pivot.position.y = winHeight + distAbove;
    // Adjust rotation: 90° is flat (parallel to ground), 0° is vertical down.
    pivot.rotation.x = THREE.MathUtils.degToRad(tilt - 90);
    assembly.add(pivot);

    const overhangGeom = new THREE.BoxGeometry(winWidth + leftExtension + rightExtension, thick, depth);
    const material = shared.shadeMat.clone();
    material.color.set(color);
    const overhangMesh = new THREE.Mesh(overhangGeom, material);
    // Adjust horizontal position based on asymmetric extensions
    overhangMesh.position.x = (rightExtension - leftExtension) / 2;
    overhangMesh.userData.surfaceType = SURFACE_TYPES.SHADING_DEVICE;
    applyClippingToMaterial(overhangMesh.material, renderer.clippingPlanes);

    overhangMesh.position.y = thick / 2;

    // The parent group is rotated so its local Z-axis always points outward.
    // A positive Z translation in local space will always move the device outward.
    // The overhang's geometry is centered, so we shift it by half its depth.
    overhangMesh.position.z = depth / 2;

    pivot.add(overhangMesh);
    return assembly;
}

/**
 * Creates a light shelf assembly.
 */
function createLightShelf(winWidth, winHeight, sillHeight, params, color, outward) {
    const assembly = new THREE.Group();
    const { placeExt, placeInt, placeBoth, depthExt, depthInt, tiltExt, tiltInt, distBelowExt, distBelowInt, thickExt, thickInt } = params;
    const material = shared.shadeMat.clone();
    material.color.set(color);
    applyClippingToMaterial(material, renderer.clippingPlanes);

    if ((placeExt || placeBoth) && depthExt > 0) {
        const pivot = new THREE.Group();
        const shelfMesh = new THREE.Mesh(new THREE.BoxGeometry(winWidth, thickExt, depthExt), material);
        shelfMesh.userData.surfaceType = SURFACE_TYPES.SHADING_DEVICE;

        // External shelf: position it outward along the local +Z axis.
        shelfMesh.position.z = depthExt / 2;

        pivot.position.y = winHeight - distBelowExt;
        pivot.rotation.x = THREE.MathUtils.degToRad(tiltExt);
        pivot.add(shelfMesh);
        assembly.add(pivot);
    }
    if ((placeInt || placeBoth) && depthInt > 0) {
        const pivot = new THREE.Group();
        const shelfMesh = new THREE.Mesh(new THREE.BoxGeometry(winWidth, thickInt, depthInt), material);
        shelfMesh.userData.surfaceType = SURFACE_TYPES.SHADING_DEVICE;

        // Internal shelf: position it inward along the local -Z axis.
        shelfMesh.position.z = -depthInt / 2;

        pivot.position.y = winHeight - distBelowInt;
        pivot.rotation.x = THREE.MathUtils.degToRad(tiltInt);
        pivot.add(shelfMesh);
        assembly.add(pivot);
    }
    return assembly;
}

/**
 * Creates a louver assembly.
 */
function createLouvers(winWidth, winHeight, params, color, outward) {
    const { isExterior, isHorizontal, slatWidth, slatSep, slatThick, slatAngle, distToGlass } = params;
    if (slatWidth <= 0 || slatSep <= 0) return null;

    const assembly = new THREE.Group();
    const material = shared.shadeMat.clone();
    material.color.set(color);
    applyClippingToMaterial(material, renderer.clippingPlanes);

    // The parent group is rotated so its local Z-axis always points outward.
    // A positive Z is outward, a negative Z is inward.
    const zOffset = isExterior ? distToGlass : -distToGlass;
    const angleRad = THREE.MathUtils.degToRad(slatAngle);

    if (isHorizontal) {
        const slatGeom = new THREE.BoxGeometry(winWidth, slatThick, slatWidth);
        const numSlats = Math.floor(winHeight / slatSep);
        for (let i = 0; i < numSlats; i++) {
            const pivot = new THREE.Group();
            const slat = new THREE.Mesh(slatGeom, material);
            slat.userData.surfaceType = SURFACE_TYPES.SHADING_DEVICE;
            pivot.position.set(0, i * slatSep + slatSep / 2, zOffset);
            pivot.rotation.x = angleRad;
            pivot.add(slat);
            assembly.add(pivot);
        }
    } else { // Vertical
        const slatGeom = new THREE.BoxGeometry(slatThick, winHeight, slatWidth);
        const numSlats = Math.floor(winWidth / slatSep);
        for (let i = 0; i < numSlats; i++) {
            const pivot = new THREE.Group();
            const slat = new THREE.Mesh(slatGeom, material);
            slat.userData.surfaceType = SURFACE_TYPES.SHADING_DEVICE;
            pivot.position.set(i * slatSep + slatSep / 2 - winWidth / 2, winHeight / 2, zOffset);
            pivot.rotation.y = angleRad;
            pivot.add(slat);
            assembly.add(pivot);
        }
    }
    return assembly;
}

/**
 * Creates a single roller shade device.
 */
function createRoller(winWidth, winHeight, params, color) {
    const {
        topOpening, bottomOpening, leftOpening, rightOpening,
        distToGlass, thickness
    } = params;

    const rollerThickness = Math.max(0.001, thickness);
    const rollerWidth = winWidth - leftOpening - rightOpening;
    const rollerHeight = winHeight - topOpening - bottomOpening;

    if (rollerWidth <= 0 || rollerHeight <= 0) return null;

    const assembly = new THREE.Group();
    const rollerGeom = new THREE.BoxGeometry(rollerWidth, rollerHeight, rollerThickness);
    const material = shared.shadeMat.clone();
    material.color.set(color);
    material.transparent = true;
    material.opacity = 0.7; // Make it semi-transparent for visualization
    applyClippingToMaterial(material, renderer.clippingPlanes);

    const rollerMesh = new THREE.Mesh(rollerGeom, material);
    rollerMesh.userData.surfaceType = SURFACE_TYPES.SHADING_DEVICE;

    // The origin (0,0,0) of this assembly is the window's bottom-center.
    const posX = (leftOpening - rightOpening) / 2;
    const posY = bottomOpening + rollerHeight / 2;
    // Positioned inside the room (negative local Z is inward)
    const posZ = -distToGlass - (rollerThickness / 2);

    rollerMesh.position.set(posX, posY, posZ);

    assembly.add(rollerMesh);
    return assembly;
}

/**
 * Clears any imported model from the scene.
 */
export function clearImportedModel() {
    if (currentImportedModel) {
        clearGroup(importedModelObject);
        currentImportedModel = null;
    }
}

/**
 * Loads an OBJ model into the scene.
 * @param {string} objContent - The string content of the .obj file.
 * @param {string|null} mtlContent - The string content of the .mtl file.
 * @param {object} options - Import options like scale and center.
 * @returns {Promise<Array<object>>} A promise that resolves with an array of material info.
 */
export async function loadImportedModel(objContent, mtlContent, options) {
    clearImportedModel(); // Clear any previous model

    const objLoader = new OBJLoader();
    const mtlLoader = new MTLLoader();

    if (mtlContent) {
        const materials = mtlLoader.parse(mtlContent, '');
        materials.preload();
        objLoader.setMaterials(materials);
    }

    const object = objLoader.parse(objContent);
    currentImportedModel = object;

    // --- Scaling and Centering ---
    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());

    if (options.center) {
        object.position.sub(center);
    }

    if (options.scale && options.scale !== 1.0) {
        object.scale.setScalar(options.scale);
    }

    object.traverse(child => {
        if (child.isMesh) {
            // Ensure material properties are suitable for our scene
            if (child.material) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach(mat => {
                    mat.side = THREE.DoubleSide;
                    applyClippingToMaterial(mat, renderer.clippingPlanes);
                });
            }
        }
    });

    importedModelObject.add(object);
    scheduleUpdate();

    // Extract material info for the tagger UI
    const materialInfo = [];
    const seenMaterials = new Set();
    object.traverse(child => {
        if (child.isMesh && child.material) {
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach(mat => {
                if (mat.name && !seenMaterials.has(mat.name)) {
                    materialInfo.push({ name: mat.name, color: mat.color });
                    seenMaterials.add(mat.name);
                }
            });
        }
    });

    return materialInfo;
}

/**
 * Applies surface type tags to the materials of the imported model.
 * @param {Map<string, string>} tagMap - A map of material names to surface types.
 */
export function applySurfaceTags(tagMap) {
    if (!currentImportedModel) return;

    currentImportedModel.traverse(child => {
        if (child.isMesh && child.material) {
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach(mat => {
                const surfaceType = tagMap.get(mat.name);
                if (surfaceType && surfaceType !== 'IGNORE') {
                    mat.userData.surfaceType = surfaceType;
                    mat.visible = true;
                } else {
                    // If ignored or not in map, make it invisible
                    mat.visible = false;
                }
            });
        }
    });
}

/**
 * Creates a shading device from an imported OBJ file.
 */
async function createImportedShading(params, color, orientation, index) {
    const { project } = await import('./project.js');
    const fileKey = `shading-obj-file-${orientation.toLowerCase()}`;
    const objFile = project.simulationFiles[fileKey];

    if (!objFile || !objFile.content) return null;

    const loader = new OBJLoader();
    const objectGroup = loader.parse(objFile.content);

    const material = shared.shadeMat.clone();
    material.color.set(color);
    applyClippingToMaterial(material, renderer.clippingPlanes);

    objectGroup.traverse(child => {
        if (child.isMesh) {
            child.material = material;
            child.userData.surfaceType = SURFACE_TYPES.SHADING_DEVICE;
            child.userData.isSelectable = true; // For raycasting
            child.userData.parentWall = orientation;
            child.userData.parentIndex = index;
        }
    });

    // Apply transformations from UI
    objectGroup.position.set(params.position.x, params.position.y, params.position.z);
    objectGroup.rotation.set(
        THREE.MathUtils.degToRad(params.rotation.x),
        THREE.MathUtils.degToRad(params.rotation.y),
        THREE.MathUtils.degToRad(params.rotation.z)
    );
    objectGroup.scale.set(params.scale.x, params.scale.y, params.scale.z);

    // Add to our list for selection and gizmo control
    importedShadingObjects.push(objectGroup);

    return objectGroup;
}

/**
 * Updates the colors of the sensor grid points based on results data.
 * @param {number[]} resultsData - An array of numerical results.
 */
export function updateSensorGridColors(resultsData) {
    if (sensorMeshes.length === 0) {
        return;
    }

    const defaultColor = new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--illuminance-grid-color').trim());

    if (!resultsData || resultsData.length === 0) {
        // Clear colors if no data is provided
        sensorMeshes.forEach(mesh => {
            for (let i = 0; i < mesh.count; i++) {
                mesh.setColorAt(i, defaultColor);
            }
            if (mesh.instanceColor) {
                mesh.instanceColor.needsUpdate = true;
            }
        });
        return;
    }

    const tempColor = new THREE.Color();
    let dataIndex = 0;

    sensorMeshes.forEach(mesh => {
        if (dataIndex >= resultsData.length) return;

        for (let i = 0; i < mesh.count; i++) {
            if (dataIndex >= resultsData.length) break;

            const value = resultsData[dataIndex];
            const colorHex = resultsManager.getColorForValue(value);

            mesh.setColorAt(i, tempColor.set(colorHex));
            dataIndex++;
        }
        if (mesh.instanceColor) {
            mesh.instanceColor.needsUpdate = true;
        }
    });

    if (dataIndex < resultsData.length) {
        console.warn(`Mismatch in sensor points and results. ${dataIndex} points colored, ${resultsData.length} results provided.`);
    }
}

/**
 * Creates and updates the 3D visualization for the individual daylighting control sensors.
 */
export function updateDaylightingSensorVisuals() {
    const dom = getDom();
    if (!daylightingSensorsGroup) return;

    clearGroup(daylightingSensorsGroup);

    const isEnabled = dom['daylighting-enabled-toggle']?.checked;
    if (!isEnabled) {
        daylightingSensorsGroup.visible = false;
        sensorTransformControls.detach();
        return;
    }
    daylightingSensorsGroup.visible = true;

    const { W, L, H } = readParams();
    // This container is offset to match the room's corner-origin coordinate system.
    // The sensor positions, which are now centered, will be added relative to this container.
    const sensorContainer = new THREE.Group();
    sensorContainer.position.set(-W / 2, 0, -L / 2);
    daylightingSensorsGroup.add(sensorContainer);

    const sensorCount = parseInt(dom['daylight-sensor-count']?.value, 10) || 1;
    let sensorColor = getComputedStyle(document.documentElement).getPropertyValue('--daylighting-sensor-color').trim() || '#00ff00';

    const geometry = new THREE.BoxGeometry(0.12, 0.04, 0.12);
    const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(sensorColor),
        emissive: new THREE.Color(sensorColor),
        emissiveIntensity: 0.5,
    });

    for (let i = 1; i <= sensorCount; i++) {
        const sensorDef = {
            x: parseFloat(dom[`daylight-sensor${i}-x`]?.value),
            y: parseFloat(dom[`daylight-sensor${i}-y`]?.value),
            z: parseFloat(dom[`daylight-sensor${i}-z`]?.value)
        };
        if (isNaN(sensorDef.x) || isNaN(sensorDef.y) || isNaN(sensorDef.z)) continue;

        const sensorGroup = new THREE.Group();
        sensorGroup.name = `daylightingSensor${i}`;
        sensorGroup.add(new THREE.Mesh(geometry, material.clone()));

        const dir = {
            x: parseFloat(dom[`daylight-sensor${i}-dir-x`].value),
            y: parseFloat(dom[`daylight-sensor${i}-dir-y`].value),
            z: parseFloat(dom[`daylight-sensor${i}-dir-z`].value)
        };
        const directionVec = new THREE.Vector3(dir.x, dir.y, dir.z).normalize();
        sensorGroup.add(new THREE.ArrowHelper(directionVec, new THREE.Vector3(0, 0.02, 0), 0.4, 0xffff00));

        // The sensor's (x,z) position comes from a centered slider (-W/2 to W/2).
        // To place it correctly inside the offset container, we add W/2.
        sensorGroup.position.set(sensorDef.x + W / 2, sensorDef.y, sensorDef.z + L / 2);
        sensorContainer.add(sensorGroup);
        daylightingSensorMeshes.push(sensorGroup);
    }

    // Attach the gizmo to the appropriate sensor based on the current UI toggle state.
    attachGizmoToSelectedSensor();
}

/**
 * Clears any existing wall highlight by restoring its original material.
 */
export function clearWallHighlights() {
    if (highlightedWall.object) {
        highlightedWall.object.material = highlightedWall.originalMaterial;
        highlightedWall.object = null;
        highlightedWall.originalMaterial = null;
    }
}

/**
 * Highlights a selected wall by swapping its material.
 * @param {THREE.Mesh} wallObject - The wall mesh to highlight.
 */
export function highlightWall(wallObject) {
    clearWallHighlights(); // Ensure only one wall is highlighted at a time

    if (wallObject && wallObject.material) {
        highlightedWall.object = wallObject;
        highlightedWall.originalMaterial = wallObject.material;
        wallObject.material = highlightMaterial;
    }
}

/**
 * Creates visual helpers (semi-transparent planes and outlines) for the
 * EN 12464-1 task and surrounding areas on the floor grid.
 * @param {number} W - Room width.
 * @param {number} L - Room length.
 * @param {THREE.Group} container - The group to add the helpers to.
 * @param {object} gridParams - The parameters object from getSensorGridParams.
 * @private
 */
function _createTaskAreaVisuals(W, L, container, gridParams) {
    const dom = getDom();
    const floorParams = gridParams?.illuminance.floor;

    if (!dom['grid-floor-toggle']?.checked || !floorParams?.isTaskArea) {
        return; // Only draw if the floor grid and task area are enabled
    }

    const offset = parseFloat(dom['floor-grid-offset'].value);
    const vizHeight = offset + 0.005; // Position slightly above the grid offset to prevent z-fighting

    const createAreaPlane = (width, depth, material) => {
        const planeGeom = new THREE.PlaneGeometry(width, depth);
        const planeMesh = new THREE.Mesh(planeGeom, material);
        planeMesh.rotation.x = -Math.PI / 2; // Orient flat on the XY plane

        const outlineGeom = new THREE.EdgesGeometry(planeGeom);
        const outline = new THREE.LineSegments(outlineGeom, new THREE.LineBasicMaterial({ color: material.color, linewidth: 2 }));

        const group = new THREE.Group();
        group.add(planeMesh, outline);
        return group;
    };

    // 1. Create Task Area visual
    const task = floorParams.task;
    if (task.width > 0 && task.depth > 0) {
        const taskAreaVisual = createAreaPlane(task.width, task.depth, shared.taskAreaMat);
        taskAreaVisual.position.set(task.x + task.width / 2, vizHeight, task.z + task.depth / 2);
        container.add(taskAreaVisual);
    }

    // 2. Create Surrounding Area visual
    if (floorParams.hasSurrounding) {
        const band = floorParams.surroundingWidth;
        const surroundingWidth = Math.min(W, task.width + 2 * band);
        const surroundingDepth = Math.min(L, task.depth + 2 * band);
        const surroundingX = Math.max(0, task.x - band);
        const surroundingZ = Math.max(0, task.z - band);

        if (surroundingWidth > 0 && surroundingDepth > 0) {
            const surroundingAreaVisual = createAreaPlane(surroundingWidth, surroundingDepth, shared.surroundingAreaMat);
            surroundingAreaVisual.position.set(surroundingX + surroundingWidth / 2, vizHeight - 0.001, surroundingZ + surroundingDepth / 2);
            // Add to the main container, it will be rendered underneath the task area plane
            container.add(surroundingAreaVisual);
        }
    }
}

/**
 * Attaches the daylighting sensor gizmo to the sensor selected via the UI toggles.
 * This function assumes the sensor meshes already exist and are correctly positioned.
 */
export function attachGizmoToSelectedSensor() {
    // This function assumes the sensor meshes already exist and are correct.
    const dom = getDom(); // We need the DOM to see which toggle is checked.
    const gizmo1Checked = dom['daylight-sensor1-gizmo-toggle']?.checked;
    const gizmo2Checked = dom['daylight-sensor2-gizmo-toggle']?.checked;

    let objectToAttach = null;
    if (gizmo1Checked && daylightingSensorMeshes[0]) {
        objectToAttach = daylightingSensorMeshes[0];
    } else if (gizmo2Checked && daylightingSensorMeshes[1]) {
        objectToAttach = daylightingSensorMeshes[1];
    }

    if (objectToAttach && sensorTransformControls.object !== objectToAttach) {
        sensorTransformControls.attach(objectToAttach);
    } else if (!objectToAttach) {
        sensorTransformControls.detach();
    }
}

/**
 * Creates and adds a furniture asset to the scene.
 * @param {string} assetType - The type of asset to create (e.g., 'desk', 'chair').
 * @param {THREE.Vector3} position - The initial position for the asset.
 * @param {boolean} [isWorldPosition=true] - If true, the position is treated as world coordinates and converted. If false, it's used directly as local coordinates.
 * @returns {THREE.Mesh|null} The created mesh, or null if asset type is unknown.
 */
export function addFurniture(assetType, position, isWorldPosition = true) {
    const dom = getDom();
    const material = shared.furnitureMat;
    applyClippingToMaterial(material, renderer.clippingPlanes);
    let geometry;
    let mesh;

    switch (assetType) {
        case 'desk':
            geometry = new THREE.BoxGeometry(1.2, 0.05, 0.75); // W, H, D
            mesh = new THREE.Mesh(geometry, material);
            mesh.position.y = 0.725;
            const legGeom = new THREE.BoxGeometry(0.05, 0.7, 0.05);
            const leg1 = new THREE.Mesh(legGeom, material); leg1.position.set(-0.55, -0.375, -0.35);
            const leg2 = new THREE.Mesh(legGeom, material); leg2.position.set(0.55, -0.375, -0.35);
            const leg3 = new THREE.Mesh(legGeom, material); leg3.position.set(-0.55, -0.375, 0.35);
            const leg4 = new THREE.Mesh(legGeom, material); leg4.position.set(0.55, -0.375, 0.35);
            mesh.add(leg1, leg2, leg3, leg4);
            break;
        case 'chair':
            geometry = new THREE.BoxGeometry(0.4, 0.04, 0.4);
            mesh = new THREE.Mesh(geometry, material);
            mesh.position.y = 0.42;
            const backGeom = new THREE.BoxGeometry(0.4, 0.5, 0.04);
            const back = new THREE.Mesh(backGeom, material);
            back.position.set(0, 0.27, -0.18);
            back.rotation.x = 0.1;
            mesh.add(back);
            break;
        case 'partition':
            geometry = new THREE.BoxGeometry(1.2, 1.5, 0.05);
            mesh = new THREE.Mesh(geometry, material);
            mesh.position.y = 0.75;
            break;
        case 'shelf':
            geometry = new THREE.BoxGeometry(0.9, 1.8, 0.3);
            mesh = new THREE.Mesh(geometry, material);
            mesh.position.y = 0.9;
            break;
        default:
            return null;
    }

    mesh.userData = {
        isFurniture: true,
        assetType: assetType,
    };

    let localPosition;
    if (isWorldPosition) {
        // The drop position is in world coordinates. We need to convert it to the
        // local coordinate system of the parent `furnitureObject`.
        localPosition = furnitureObject.worldToLocal(position.clone());
    } else {
        // The position is already in local coordinates relative to the room center.
        localPosition = position;
    }
    mesh.position.add(localPosition);

    furnitureContainer.add(mesh);

    return mesh;
}

/**
 * Creates a massing block with customizable parameters and adds it to the scene's context group.
 * @param {object} params - Configuration parameters for the massing block.
 * @param {string} params.shape - Shape type: 'box', 'cylinder', 'pyramid', 'sphere'.
 * @param {number} params.width - Width/X dimension in meters.
 * @param {number} params.depth - Depth/Z dimension in meters.
 * @param {number} params.height - Height/Y dimension in meters.
 * @param {number} params.radius - Radius for cylinder/sphere shapes.
 * @param {number} params.positionX - X position in meters.
 * @param {number} params.positionY - Y position in meters.
 * @param {number} params.positionZ - Z position in meters.
 * @param {string} params.name - Optional name for the massing block.
 * @returns {THREE.Mesh|THREE.Group} The created mesh or group object for the massing block.
 */
export function addMassingBlock(params = {}) {
    const {
        shape = 'box',
        width = 10,
        depth = 10,
        height = 15,
        radius = 5,
        positionX = 20,
        positionY = height / 2,
        positionZ = 0,
        name = `Massing Block ${contextObject.children.length + 1}`
    } = params;

    let geometry, mesh;

    // Create geometry based on shape
    switch (shape) {
        case 'cylinder':
            geometry = new THREE.CylinderGeometry(radius, radius, height, 16);
            break;
        case 'pyramid':
            // Create pyramid using cone geometry
            geometry = new THREE.ConeGeometry(radius, height, 4);
            break;
        case 'sphere':
            geometry = new THREE.SphereGeometry(radius, 16, 12);
            break;
        case 'box':
        default:
            geometry = new THREE.BoxGeometry(width, height, depth);
            break;
    }

    // Use the same shared material as OSM context buildings
    const material = shared.contextMat.clone();
    applyClippingToMaterial(material, renderer.clippingPlanes);

    mesh = new THREE.Mesh(geometry, material);

    // Set userData for identification during raycasting and saving
    mesh.userData = {
        isContext: true,
        isMassingBlock: true,
        shape: shape,
        width: width,
        depth: depth,
        height: height,
        radius: radius,
        name: name,
        id: generateContextObjectId(),
        type: 'mass',
        createdAt: new Date().toISOString(),
        position: { x: positionX, y: positionY, z: positionZ }
    };

    // Position the mesh
    mesh.position.set(positionX, positionY, positionZ);

    // For pyramid (cone), adjust position to sit on ground
    if (shape === 'pyramid') {
        mesh.position.y = height / 2;
    }

    contextObject.add(mesh);

    // Register the object in our management system
    registerContextObject(mesh);

    return mesh;
}

/**
 * Generates a unique ID for a context object.
 * @returns {string} A unique identifier.
 */
function generateContextObjectId() {
    return `ctx_${nextContextObjectId++}_${Date.now()}`;
}

/**
 * Registers a context object in the management system.
 * @param {THREE.Object3D} object - The context object to register.
 */
export function registerContextObject(object) {
    if (!object.userData.id) {
        object.userData.id = generateContextObjectId();
    }
    contextObjects.set(object.userData.id, object);
    updateContextObjectUI();
}

/**
 * Unregisters a context object from the management system.
 * @param {string} id - The ID of the object to unregister.
 */
export function unregisterContextObject(id) {
    const object = contextObjects.get(id);
    if (object) {
        // Remove from scene
        if (object.parent) {
            object.parent.remove(object);
        }
        // Remove from our registry
        contextObjects.delete(id);
        updateContextObjectUI();
    }
}

/**
 * Gets all context objects.
 * @returns {Map} The context objects map.
 */
export function getContextObjects() {
    return contextObjects;
}

/**
 * Gets a context object by ID.
 * @param {string} id - The object ID.
 * @returns {THREE.Object3D|null} The context object or null if not found.
 */
export function getContextObjectById(id) {
    return contextObjects.get(id) || null;
}

/**
 * Deletes a context object by ID.
 * @param {string} id - The ID of the object to delete.
 * @returns {boolean} True if the object was deleted, false otherwise.
 */
export function deleteContextObject(id) {
    if (contextObjects.has(id)) {
        unregisterContextObject(id);
        return true;
    }
    return false;
}

/**
 * Copies a context object.
 * @param {string} id - The ID of the object to copy.
 * @param {object} offset - Optional position offset for the copy.
 * @returns {THREE.Object3D|null} The copied object or null if original not found.
 */
export function copyContextObject(id, offset = { x: 1, y: 0, z: 1 }) {
    const original = contextObjects.get(id);
    if (!original) return null;

    // Clone the geometry and create new object
    const clonedGeometry = original.geometry.clone();
    const material = original.material.clone();
    const copy = new THREE.Mesh(clonedGeometry, material);

    // Copy userData and update it
    copy.userData = { ...original.userData };
    copy.userData.id = generateContextObjectId();
    copy.userData.name = `${original.userData.name} Copy`;
    copy.userData.createdAt = new Date().toISOString();
    copy.userData.isCopy = true;

    // Apply offset to position
    copy.position.copy(original.position).add(new THREE.Vector3(offset.x, offset.y, offset.z));

    contextObject.add(copy);
    registerContextObject(copy);

    return copy;
}

/**
 * Gets properties of a context object.
 * @param {string} id - The object ID.
 * @returns {object|null} Object properties or null if not found.
 */
export function getContextObjectProperties(id) {
    const object = contextObjects.get(id);
    if (!object) return null;

    const bbox = new THREE.Box3().setFromObject(object);
    const dimensions = {
        width: bbox.max.x - bbox.min.x,
        height: bbox.max.y - bbox.min.y,
        depth: bbox.max.z - bbox.min.z
    };

    let volume = 0;
    switch (object.userData.shape) {
        case 'box':
            volume = object.userData.width * object.userData.height * object.userData.depth;
            break;
        case 'cylinder':
            volume = Math.PI * object.userData.radius * object.userData.radius * object.userData.height;
            break;
        case 'sphere':
            volume = (4 / 3) * Math.PI * object.userData.radius * object.userData.radius * object.userData.radius;
            break;
        case 'pyramid':
            volume = (1 / 3) * Math.PI * object.userData.radius * object.userData.radius * object.userData.height;
            break;
    }

    return {
        id: object.userData.id,
        name: object.userData.name,
        type: object.userData.type,
        shape: object.userData.shape,
        position: { ...object.position },
        dimensions: dimensions,
        volume: volume,
        createdAt: object.userData.createdAt,
        isCopy: object.userData.isCopy || false
    };
}

/**
 * Updates the material for all context objects of a specific type.
 * @param {string} type - The object type ('mass', 'building', etc.).
 * @param {THREE.Material} material - The new material to apply.
 */
export function updateContextObjectsMaterial(type, material) {
    contextObjects.forEach(object => {
        if (object.userData.type === type) {
            object.material = material;
        }
    });
}

/**
 * Gets all context objects of a specific type.
 * @param {string} type - The object type to filter by.
 * @returns {Array} Array of matching objects.
 */
export function getContextObjectsByType(type) {
    const objects = [];
    contextObjects.forEach(object => {
        if (object.userData.type === type) {
            objects.push(object);
        }
    });
    return objects;
}

/**
 * Performs bulk operations on selected context objects.
 * @param {string} operation - The operation type ('delete', 'copy', 'changeMaterial').
 * @param {Array} objectIds - Array of object IDs to operate on.
 * @param {object} params - Operation parameters.
 * @returns {object} Result of the operation.
 */
export function performBulkOperation(operation, objectIds, params = {}) {
    const results = {
        success: [],
        failed: [],
        count: objectIds.length
    };

    switch (operation) {
        case 'delete':
            objectIds.forEach(id => {
                if (deleteContextObject(id)) {
                    results.success.push(id);
                } else {
                    results.failed.push(id);
                }
            });
            break;

        case 'copy':
            const offset = params.offset || { x: 1, y: 0, z: 1 };
            objectIds.forEach(id => {
                const copy = copyContextObject(id, offset);
                if (copy) {
                    results.success.push(copy.userData.id);
                } else {
                    results.failed.push(id);
                }
            });
            break;

        case 'changeMaterial':
            const material = params.material;
            if (material) {
                objectIds.forEach(id => {
                    const object = contextObjects.get(id);
                    if (object) {
                        object.material = material;
                        results.success.push(id);
                    } else {
                        results.failed.push(id);
                    }
                });
            }
            break;
    }

    // Update UI after bulk operations
    updateContextObjectUI();

    return results;
}

/**
 * Updates the context object management UI.
 * This function should be called from ui.js to refresh the object list.
 */
export function updateContextObjectUI() {
    // This will be implemented in ui.js to update the DOM
    if (typeof window !== 'undefined' && window.updateContextObjectUI) {
        window.updateContextObjectUI();
    }
}

/**
 * Creates transparent planes on the exterior of the room to act as resize handles.
 */
export function createResizeHandles() {
    clearGroup(resizeHandlesObject);
    const dom = getDom();
    if (!dom['resize-mode-toggle'] || !dom['resize-mode-toggle'].checked) {
        return; // Don't create handles if mode is off
    }

    const { W, L, H } = readParams();

    const handleMaterial = new THREE.MeshBasicMaterial({
        color: 0x3b82f6,
        transparent: true,
        opacity: 0.2, // Slightly increased opacity
        side: THREE.DoubleSide,
        depthTest: false,
    });

    const { wallThickness } = readParams();
    const handles = [
        // Positions are now calculated to be outside the wall thickness
        { name: 'wall-handle-east', w: L, h: H, pos: [W / 2 + wallThickness + 0.01, H / 2, 0], axis: 'x', dir: 1 },
        { name: 'wall-handle-west', w: L, h: H, pos: [-W / 2 - wallThickness - 0.01, H / 2, 0], axis: 'x', dir: -1 },
        { name: 'wall-handle-south', w: W, h: H, pos: [0, H / 2, L / 2 + wallThickness + 0.01], axis: 'z', dir: 1 },
        { name: 'wall-handle-north', w: W, h: H, pos: [0, H / 2, -L / 2 - wallThickness - 0.01], axis: 'z', dir: -1 },
        { name: 'wall-handle-top', w: W, h: L, pos: [0, H + 0.01, 0], axis: 'y', dir: 1 },
    ];

    handles.forEach(h => {
        const geometry = new THREE.PlaneGeometry(h.w, h.h);
        const plane = new THREE.Mesh(geometry, handleMaterial.clone());
        plane.position.set(...h.pos);
        if (h.axis === 'x') plane.rotation.y = Math.PI / 2;
        if (h.axis === 'y') plane.rotation.x = -Math.PI / 2;

        plane.userData = {
            isResizeHandle: true,
            axis: h.axis, // 'x', 'y', or 'z'
            direction: h.dir // 1 or -1
        };
        resizeHandlesObject.add(plane);
    });
}

/**
 * Clears all context objects from the scene.
 */
export function clearContextObjects() {
    clearGroup(contextObject);
}

/**
 * Updates the material for all context buildings based on UI controls.
 */
export function updateContextMaterial() {
    const dom = getDom();
    const refl = parseFloat(dom['context-refl']?.value || 0.2);
    // We'll use a simple gray color based on reflectance for the 3D view
    shared.contextMat.color.setScalar(refl);
}

/**
 * Creates 3D building masses from parsed OpenStreetMaps data.
 * @param {object} osmData - The raw JSON data from the Overpass API.
 * @param {number} centerLat - The latitude of the project center.
 * @param {number} centerLon - The longitude of the project center.
 */
export function createContextFromOsm(osmData, centerLat, centerLon) {
    clearContextObjects();

    const nodes = new Map();
    osmData.elements.forEach(el => {
        if (el.type === 'node') {
            nodes.set(el.id, { lat: el.lat, lon: el.lon });
        }
    });

    osmData.elements.forEach(el => {
        if (el.type === 'way' && el.tags?.building && el.nodes) {
            const points = [];
            el.nodes.forEach(nodeId => {
                const node = nodes.get(nodeId);
                if (node) {
                    // Convert lat/lon to meters from the center point
                    const metersPerLat = 111132.954 - 559.822 * Math.cos(2 * centerLat) + 1.175 * Math.cos(4 * centerLat);
                    const metersPerLon = 111319.488 * Math.cos(centerLat * Math.PI / 180);
                    const x = (node.lon - centerLon) * metersPerLon;
                    const z = -(node.lat - centerLat) * metersPerLat; // Z is negative latitude
                    points.push(new THREE.Vector2(x, z));
                }
            });

            if (points.length > 2) {
                const shape = new THREE.Shape(points);
                const height = parseFloat(el.tags.height) || (parseFloat(el.tags['building:levels']) || 3) * 3.5;

                const extrudeSettings = { depth: height, bevelEnabled: false };
                const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
                geometry.translate(0, 0, -height); // Move extrusion origin to the top
                geometry.rotateX(Math.PI / 2); // Rotate to stand up (Y-up)

                const building = new THREE.Mesh(geometry, shared.contextMat);
                contextObject.add(building);
            }
        }
    });

    const buildingsCreated = contextObject.children.length > 0;
    if (!buildingsCreated && osmData.elements.length > 0) {
        import('./ui.js').then(({ showAlert }) => {
            showAlert('OSM data fetched successfully, but no building footprints were found in the specified area.', 'No Buildings Found');
        });
    }

    updateContextMaterial(); // Apply initial material color
}

/**
 * Creates and adds a vegetation asset to the scene.
 * @param {string} assetType - The type of asset to create (e.g., 'tree-deciduous').
 * @param {THREE.Vector3} position - The initial position for the asset.
 * @param {boolean} [isWorldPosition=true] - If true, the position is treated as world coordinates and converted. If false, it's used directly as local coordinates.
 * @returns {THREE.Group|null} The created group object, or null if asset type is unknown.
 */
export function addVegetation(assetType, position, isWorldPosition = true) {
    console.log(`[DEBUG] addVegetation function started. Type: "${assetType}", Position:`, position, `Is World: ${isWorldPosition}`);

    const treeGroup = new THREE.Group();
    let geometryCreated = false;

    switch (assetType) {
        case 'tree-deciduous': {
            const trunkGeom = new THREE.CylinderGeometry(0.15, 0.2, 2.5, 8);
            const trunkMesh = new THREE.Mesh(trunkGeom, shared.furnitureMat.clone()); // Use clone for safety
            trunkMesh.userData.surfaceType = 'VEGETATION_TRUNK';
            trunkMesh.position.y = 1.25;

            const canopyGeom = new THREE.SphereGeometry(1.5, 12, 8);
            const canopyMesh = new THREE.Mesh(canopyGeom, shared.vegetationCanopyMat.clone());
            canopyMesh.userData.surfaceType = 'VEGETATION_CANOPY';
            canopyMesh.position.y = 3.5;

            treeGroup.add(trunkMesh, canopyMesh);
            geometryCreated = true;
            break;
        }
        case 'tree-coniferous': {
            const conTrunkGeom = new THREE.CylinderGeometry(0.2, 0.25, 2.0, 8);
            const conTrunkMesh = new THREE.Mesh(conTrunkGeom, shared.furnitureMat.clone()); // Use clone for safety
            conTrunkMesh.userData.surfaceType = 'VEGETATION_TRUNK';
            conTrunkMesh.position.y = 1.0;

            const canopyGeomCone = new THREE.ConeGeometry(1.2, 4.0, 12);
            const canopyMeshCone = new THREE.Mesh(canopyGeomCone, shared.vegetationCanopyMat.clone());
            canopyMeshCone.userData.surfaceType = 'VEGETATION_CANOPY';
            canopyMeshCone.position.y = 2.0 + 4.0 / 2;

            treeGroup.add(conTrunkMesh, canopyMeshCone);
            geometryCreated = true;
            break;
        }
        case 'bush': {
            const bushGeom = new THREE.SphereGeometry(0.7, 10, 6);
            const bushMesh = new THREE.Mesh(bushGeom, shared.vegetationCanopyMat.clone());
            bushMesh.userData.surfaceType = 'VEGETATION_CANOPY';
            bushMesh.position.y = 0.7;
            treeGroup.add(bushMesh);
            geometryCreated = true;
            break;
        }
        default:
            console.error(`[DEBUG] Unknown vegetation asset type in switch: ${assetType}`);
            return null;
    }

    if (!geometryCreated) {
        console.error('[DEBUG] Geometry was not created for the asset type.');
        return null;
    }
    console.log('[DEBUG] Geometry created. Resulting treeGroup:', treeGroup);

    treeGroup.userData = {
        isVegetation: true,
        assetType: assetType,
    };

    let localPosition;
    if (isWorldPosition) {
        // The drop position is in world coordinates. Convert it to the local
        // coordinate system of the parent `vegetationObject`.
        localPosition = vegetationObject.worldToLocal(position.clone());
    } else {
        // The position is already in local coordinates relative to the room center.
        localPosition = position;
    }
    treeGroup.position.add(localPosition);

    vegetationContainer.add(treeGroup);

    // Force matrix update to get immediate world position
    treeGroup.updateMatrixWorld(true);
    const finalWorldPos = new THREE.Vector3();
    treeGroup.getWorldPosition(finalWorldPos);
    console.log('[DEBUG] Final calculated world position of new object:', finalWorldPos);

    return treeGroup;
}

/**
 * Creates and adds an imported asset (.obj) to the scene.
 * @param {string} objContent - The string content of the .obj file.
 * @param {string|null} mtlContent - The string content of the .mtl file.
 * @param {string} assetType - The type of asset ('custom-obj-furniture' or 'custom-obj-vegetation').
 * @returns {Promise<THREE.Group|null>} The created group, or null on failure.
 */
export async function addImportedAsset(objContent, mtlContent, assetType) {
    const objLoader = new OBJLoader();

    if (mtlContent) {
        const mtlLoader = new MTLLoader();
        const materials = mtlLoader.parse(mtlContent, '');
        materials.preload();
        objLoader.setMaterials(materials);
    }

    const objectGroup = objLoader.parse(objContent);

    // Center the geometry before adding to the scene
    const box = new THREE.Box3().setFromObject(objectGroup);
    const center = box.getCenter(new THREE.Vector3());
    objectGroup.position.sub(center);

    let isFurniture = assetType === 'custom-obj-furniture';
    let isVegetation = assetType === 'custom-obj-vegetation';

    // Apply a standard material for simulation consistency and assign user data
    objectGroup.traverse(child => {
        if (child.isMesh) {
            if (isFurniture) {
                child.material = shared.furnitureMat.clone();
                child.userData.surfaceType = 'FURNITURE';
            } else if (isVegetation) {
                child.material = shared.vegetationCanopyMat.clone();
                child.userData.surfaceType = 'VEGETATION_CANOPY';
            }
            applyClippingToMaterial(child.material, renderer.clippingPlanes);
        }
    });

    objectGroup.userData = {
        isFurniture: isFurniture,
        isVegetation: isVegetation,
        assetType: assetType,
    };

    // Add to the correct container
    if (isFurniture) {
        furnitureContainer.add(objectGroup);
    } else if (isVegetation) {
        vegetationContainer.add(objectGroup);
    }

    return objectGroup;
}

// --- START: Added getWallGroupById Function ---
/**
 * Finds and returns a wall group object based on its canonical ID.
 * @param {string} id - The canonical ID ('n', 's', 'e', 'w').
 * @returns {THREE.Group | null} The found wall group or null.
 */
export function getWallGroupById(id) {
    // wallSelectionGroup contains one child: wallContainer. We search within wallContainer.
    const wallContainer = wallSelectionGroup.children[0];
    if (!wallContainer) {
        console.warn("Wall container not found in wallSelectionGroup.");
        return null;
    }
    // Find the specific wall segment group within the container
    return wallContainer.children.find(group => group.userData.canonicalId === id) || null;
}
