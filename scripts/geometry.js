// scripts/geometry.js

import * as THREE from 'three';
import { renderer, horizontalClipPlane, verticalClipPlane, sensorTransformControls, daylightingSensorsGroup } from './scene.js';
import { getDom, getAllWindowParams, getAllShadingParams, validateInputs, getWindowParamsForWall, getSensorGridParams } from './ui.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { resultsManager } from './resultsManager.js';
import { SURFACE_TYPES } from './sunTracer.js';

// --- GEOMETRY GROUPS ---
export const roomObject = new THREE.Group();
export const shadingObject = new THREE.Group();
export const sensorGridObject = new THREE.Group();
export const wallSelectionGroup = new THREE.Group(); // Group for selectable walls
export const axesObject = new THREE.Group();
export const groundObject = new THREE.Group();
export const northArrowObject = new THREE.Group();
const taskAreaHelpersGroup = new THREE.Group();

// --- MODULE STATE & SHARED RESOURCES ---
export let sensorMeshes = []; // Store references to instanced meshes for results
export let daylightingSensorMeshes = []; // Store references to individual sensor meshes for gizmo control

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
    shadeMat: new THREE.MeshBasicMaterial({ color: '#1a1a1a', side: THREE.DoubleSide }), // Fallback color
    taskAreaMat: new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.2, side: THREE.DoubleSide }),
    surroundingAreaMat: new THREE.MeshBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.2, side: THREE.DoubleSide }),
};

// --- HELPER FUNCTIONS ---

/**
 * Updates the color of the selection highlight material based on the current theme.
 */
export function updateHighlightColor() {
    if (highlightMaterial) {
        const newColor = getComputedStyle(document.documentElement).getPropertyValue('--highlight-color').trim();
        highlightMaterial.color.set(newColor);
    }
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
    if (group === wallSelectionGroup) {
        highlightedWall = { object: null, originalMaterial: null };
    }
    if (group === daylightingSensorsGroup) {
        daylightingSensorMeshes.length = 0;
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
    const rotationY = THREE.MathUtils.degToRad(parseFloat(dom['room-orientation'].value));
    const surfaceThickness = parseFloat(dom['surface-thickness'].value);
    return { W, L, H, rotationY, wallThickness: surfaceThickness, floorThickness: surfaceThickness, ceilingThickness: surfaceThickness };
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
    const { W, L, H, rotationY } = readParams();

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

    // Apply room rotation to all relevant geometry groups
    roomObject.rotation.y = rotationY;
    shadingObject.rotation.y = rotationY;
    sensorGridObject.rotation.y = rotationY;
    wallSelectionGroup.rotation.y = rotationY;
    daylightingSensorsGroup.rotation.y = rotationY;

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
 * Creates the ground plane and grid.
 */
function createGroundPlane() {
    clearGroup(groundObject);
    const { W, L } = readParams();
    const size = Math.max(W, L) * 6;

    const gridHelper = new THREE.GridHelper(size, 60, shared.lineColor, shared.gridMinorColor);
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

    groundObject.add(gridHelper, plane);
}

/**
 * Creates the entire room geometry, including walls, floor, ceiling, windows, and frames.
 * Walls are now individual, selectable meshes.
 */
function createRoomGeometry() {
    const dom = getDom();
    clearGroup(roomObject);
    clearGroup(wallSelectionGroup);

    const { W, L, H, wallThickness, floorThickness, ceilingThickness } = readParams();
    const glazingTrans = parseFloat(dom['glazing-trans'].value);
    const isTransparent = dom['transparent-toggle'].checked;
    const surfaceOpacity = isTransparent ? parseFloat(dom['surface-opacity'].value) : 1.0;

    const materialProperties = {
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
        side: THREE.DoubleSide,
        clippingPlanes: renderer.clippingPlanes,
        clipIntersection: true,
        transparent: isTransparent,
        opacity: surfaceOpacity,
    };

    // Create materials using theme colors
    const wallMaterial = new THREE.MeshBasicMaterial({ ...materialProperties, color: new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--wall-color').trim()) });
    const floorMaterial = new THREE.MeshBasicMaterial({ ...materialProperties, color: new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--floor-color').trim()) });
    const ceilingMaterial = new THREE.MeshBasicMaterial({ ...materialProperties, color: new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--ceiling-color').trim()) });
    const windowMaterial = new THREE.MeshBasicMaterial({ color: 0xb3ecff, side: THREE.DoubleSide, transparent: true, opacity: glazingTrans, clippingPlanes: renderer.clippingPlanes, clipIntersection: true, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 1 });
    const frameMaterial = new THREE.MeshBasicMaterial({ ...materialProperties, color: new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--frame-color').trim()) });

    const allWindows = getAllWindowParams();
    const roomContainer = new THREE.Group();
    roomContainer.position.set(-W / 2, 0, -L / 2);

    // Floor and Ceiling (added to roomObject, not selectable)
    const floorGeom = new THREE.BoxGeometry(W + 2 * wallThickness, L + 2 * wallThickness, floorThickness);
    const floorGroup = new THREE.Group();
    floorGroup.rotation.x = -Math.PI / 2;
    floorGroup.position.set(W / 2, -floorThickness / 2 - 0.001, L / 2); // Lower slightly to avoid Z-fighting
    createSchematicObject(floorGeom, floorGroup, floorMaterial, SURFACE_TYPES.INTERIOR_FLOOR);
    roomContainer.add(floorGroup);

    const ceilingGeom = new THREE.BoxGeometry(W + 2 * wallThickness, L + 2 * wallThickness, ceilingThickness);
    const ceilingGroup = new THREE.Group();
    ceilingGroup.rotation.x = -Math.PI / 2;
    ceilingGroup.position.set(W / 2, H + ceilingThickness / 2 + 0.001, L / 2); // Raise slightly to avoid Z-fighting
    createSchematicObject(ceilingGeom, ceilingGroup, ceilingMaterial, SURFACE_TYPES.INTERIOR_CEILING);
    roomContainer.add(ceilingGroup);

    roomObject.add(roomContainer);

    // Walls (added to wallSelectionGroup to be selectable)
    const wallContainer = new THREE.Group();
    wallContainer.position.set(-W / 2, 0, -L / 2);

    const walls = {
        n: { s: [W, H], p: [W / 2, H / 2, 0], r: [0, Math.PI, 0] },
        s: { s: [W, H], p: [W / 2, H / 2, L], r: [0, 0, 0] },
        w: { s: [L, H], p: [0, H / 2, L / 2], r: [0, Math.PI / 2, 0] },
        e: { s: [L, H], p: [W, H / 2, L / 2], r: [0, -Math.PI / 2, 0] },
    };

    for (const [key, props] of Object.entries(walls)) {
        const wallMeshGroup = new THREE.Group();
        wallMeshGroup.position.set(...props.p);
        wallMeshGroup.rotation.set(...props.r);
        wallMeshGroup.userData = { canonicalId: key }; // Assign the canonical ID

        const winParams = allWindows[key.toUpperCase()];

        const isEW = key === 'e' || key === 'w';
        let wallW = props.s[0];
        const wallH = props.s[1];

        // Extend the East/West walls by the thickness to ensure the corners are perfectly closed.
        // The North/South walls will then fit snugly between them.
        if (isEW) {
            wallW += (2 * wallThickness);
        }

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
            const addFrame = dom['frame-toggle'].checked;
            const ft = addFrame ? parseFloat(dom['frame-thick'].value) : 0;
            const frameDepth = addFrame ? parseFloat(dom['frame-depth'].value) : 0;

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

                // Invert depth position for East/West walls for intuitive slider control
                const effectiveWinDepthPos = (key === 'e' || key === 'w') ? -winDepthPos : winDepthPos;

                const glassWidth = Math.max(0, ww - 2 * ft);
                const glassHeight = Math.max(0, wh - 2 * ft);
                if (glassWidth > 0 && glassHeight > 0) {
                    const glass = new THREE.Mesh(new THREE.PlaneGeometry(glassWidth, glassHeight), windowMaterial);
                    glass.userData.surfaceType = SURFACE_TYPES.GLAZING; // Tag for ray tracer
                    applyClippingToMaterial(glass.material, renderer.clippingPlanes);
                    glass.position.set(winCenterX, winCenterY, effectiveWinDepthPos); // Position in the middle of the frame depth
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
                    // Center the frame geometry around the window's depth position
                    frameGeometry.translate(0, 0, effectiveWinDepthPos - (frameDepth / 2));

                    const frameMesh = new THREE.Mesh(frameGeometry, frameMaterial);
                    frameMesh.userData.surfaceType = SURFACE_TYPES.FRAME;
                    applyClippingToMaterial(frameMesh.material, renderer.clippingPlanes);

                    wallMeshGroup.add(frameMesh);
                }
            }

            const extrudeSettings = {
                steps: 1,
                depth: wallThickness,
                bevelEnabled: false
            };

            const wallGeometry = new THREE.ExtrudeGeometry(wallShape, extrudeSettings);
            // For E/W walls, we pre-translate the geometry backwards. The group rotation
            // will then correctly position the wall with its thickness pointing outwards.
            if (isEW) {
                wallGeometry.translate(0, 0, -wallThickness);
            }
            // ExtrudeGeometry extrudes from Z=0 to Z=depth, so its inner face is already at Z=0.
            const wallMeshWithHoles = createSchematicObject(wallGeometry, wallMeshGroup, wallMaterial, SURFACE_TYPES.INTERIOR_WALL);
            wallMeshWithHoles.userData.isSelectableWall = true;
        } else {
            // Create a solid wall using BoxGeometry
            const wallGeometry = new THREE.BoxGeometry(wallW, wallH, wallThickness);
            // BoxGeometry is centered. We translate it to align its inner face at z=0.
            // For E/W walls, rotation makes local Z point along world X. To push outwards,
            // the local translation needs to be negative.
            const z_translation = isEW ? -wallThickness / 2 : wallThickness / 2;
            wallGeometry.translate(0, 0, z_translation);
            const wallMesh = createSchematicObject(wallGeometry, wallMeshGroup, wallMaterial, SURFACE_TYPES.INTERIOR_WALL);
            wallMesh.userData.isSelectableWall = true;
        }
        wallContainer.add(wallMeshGroup);
    }
    wallSelectionGroup.add(wallContainer);
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
 * Creates all shading devices based on UI settings.
 */
export function createShadingDevices() {
    clearGroup(shadingObject);
    const allWindows = getAllWindowParams();
    const allShading = getAllShadingParams();

    if (Object.keys(allWindows).length === 0 || Object.keys(allShading).length === 0) return;

    const shadeColor = getComputedStyle(document.documentElement).getPropertyValue('--shading-color').trim();
    const { W, L } = readParams();
    const shadingContainer = new THREE.Group();
    shadingContainer.position.set(-W / 2, 0, -L / 2);

    for (const [orientation, winParams] of Object.entries(allWindows)) {
        const { ww, wh, sh, winCount, mode, wallWidth, winDepthPos } = winParams;
        const shadeParams = allShading[orientation];

        // Invert depth for E/W walls to match the glazing position
        // Place shading externally by always using a negative depth offset
        const effectiveWinDepthPos = -winDepthPos;

        if (!shadeParams || winCount === 0 || ww === 0 || wh === 0) continue;

        const spacing = mode === 'wwr' ? 0.1 : ww / 2;
        const groupWidth = winCount * ww + Math.max(0, winCount - 1) * spacing;
        const startOffset = (wallWidth - groupWidth) / 2;

        for (let i = 0; i < winCount; i++) {
            const winStartPos = startOffset + i * (ww + spacing);
            let deviceGroup;

            if (shadeParams.type === 'overhang' && shadeParams.overhang) {
                deviceGroup = createOverhang(ww, wh, shadeParams.overhang, shadeColor);
            } else if (shadeParams.type === 'lightshelf' && shadeParams.lightshelf) {
                deviceGroup = createLightShelf(ww, wh, sh, shadeParams.lightshelf, shadeColor);
            } else if (shadeParams.type === 'louver' && shadeParams.louver) {
                deviceGroup = createLouvers(ww, wh, shadeParams.louver, shadeColor);
            } else if (shadeParams.type === 'roller' && shadeParams.roller) {
                deviceGroup = createRoller(ww, wh, shadeParams.roller, shadeColor);
        }

        if (deviceGroup) {
            // The original creation logic is correct for E/W walls but inverted for N/S.
            // This block corrects the N/S placement by flipping the device's local z-axis.
            if (orientation === 'N' || orientation === 'S') {
                deviceGroup.children.forEach(child => {
                    child.position.z *= 1;
                });
            }

            // Position and rotate the device to match its parent wall, then translate to the glazing depth.
            if (orientation === 'N') {
                deviceGroup.position.set(winStartPos + ww / 2, sh, 0);
                deviceGroup.rotation.y = Math.PI; // Match North wall's rotation
                deviceGroup.translateZ(effectiveWinDepthPos);
            } else if (orientation === 'S') {
                deviceGroup.position.set(winStartPos + ww / 2, sh, L);
                deviceGroup.rotation.y = Math.PI; // Match South wall's rotation
                deviceGroup.translateZ(effectiveWinDepthPos);
                } else if (orientation === 'W') {
                    deviceGroup.position.set(0, sh, winStartPos + ww / 2);
                    deviceGroup.rotation.y = Math.PI / 2; // Match West wall's rotation
                    deviceGroup.translateZ(effectiveWinDepthPos);
                } else if (orientation === 'E') {
                    deviceGroup.position.set(W, sh, winStartPos + ww / 2);
                    deviceGroup.rotation.y = -Math.PI / 2; // Match East wall's rotation
                    deviceGroup.translateZ(effectiveWinDepthPos);
                }
                shadingContainer.add(deviceGroup);
            }
        }
    }
    shadingObject.add(shadingContainer);
}

/**
 * Creates a single overhang device.
 */
function createOverhang(winWidth, winHeight, params, color) {
    const { distAbove, tilt, depth, extension, thick } = params;
    if (depth <= 0) return null;

    const assembly = new THREE.Group();
    const pivot = new THREE.Group();
    pivot.position.y = winHeight + distAbove;
    pivot.rotation.x = THREE.MathUtils.degToRad(tilt);
    assembly.add(pivot);

    const overhangGeom = new THREE.BoxGeometry(winWidth + 2 * extension, thick, depth);
    const material = shared.shadeMat.clone();
    material.color.set(color);
    const overhangMesh = new THREE.Mesh(overhangGeom, material);
    overhangMesh.userData.surfaceType = SURFACE_TYPES.SHADING_DEVICE;
    applyClippingToMaterial(overhangMesh.material, renderer.clippingPlanes);

    overhangMesh.position.y = thick / 2;
    overhangMesh.position.z = -depth / 2;
    pivot.add(overhangMesh);
    return assembly;
}

/**
 * Creates a light shelf assembly.
 */
function createLightShelf(winWidth, winHeight, sillHeight, params, color) {
    const assembly = new THREE.Group();
    const { placeExt, placeInt, placeBoth, depthExt, depthInt, tiltExt, tiltInt, distBelowExt, distBelowInt, thickExt, thickInt } = params;
    const material = shared.shadeMat.clone();
    material.color.set(color);
    applyClippingToMaterial(material, renderer.clippingPlanes);

 if ((placeExt || placeBoth) && depthExt > 0) {
        const pivot = new THREE.Group();
        const shelfMesh = new THREE.Mesh(new THREE.BoxGeometry(winWidth, thickExt, depthExt), material);
        shelfMesh.userData.surfaceType = SURFACE_TYPES.SHADING_DEVICE;
        shelfMesh.position.z = -depthExt / 2;
        pivot.position.y = winHeight - distBelowExt;
        pivot.rotation.x = THREE.MathUtils.degToRad(tiltExt);
        pivot.add(shelfMesh);
        assembly.add(pivot);
    }
 if ((placeInt || placeBoth) && depthInt > 0) {
        const pivot = new THREE.Group();
        const shelfMesh = new THREE.Mesh(new THREE.BoxGeometry(winWidth, thickInt, depthInt), material);
        shelfMesh.userData.surfaceType = SURFACE_TYPES.SHADING_DEVICE;
        shelfMesh.position.z = depthInt / 2;
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
function createLouvers(winWidth, winHeight, params, color) {
    const { isExterior, isHorizontal, slatWidth, slatSep, slatThick, slatAngle, distToGlass } = params;
    if (slatWidth <= 0 || slatSep <= 0) return null;

    const assembly = new THREE.Group();
    const material = shared.shadeMat.clone();
   material.color.set(color);
    applyClippingToMaterial(material, renderer.clippingPlanes);
    const zOffset = isExterior ? -distToGlass : distToGlass;
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
    const posZ = distToGlass + rollerThickness / 2; // Positioned inside the room

    rollerMesh.position.set(posX, posY, posZ);

    assembly.add(rollerMesh);
    return assembly;
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