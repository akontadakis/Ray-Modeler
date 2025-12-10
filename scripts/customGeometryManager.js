import * as THREE from 'three';
import { roomObject, wallSelectionGroup, updateScene, setIsCustomGeometry } from './geometry.js';
import { getDom } from './dom.js';
import { registerCustomWall, clearCustomWalls, getCustomWallData } from './customApertureManager.js';

import { renderer } from './scene.js';

let currentRoomHeight = 2.8;

// Surface Types (matching geometry.js)
const SURFACE_TYPES = {
    INTERIOR_WALL: 'INTERIOR_WALL',
    INTERIOR_CEILING: 'INTERIOR_CEILING',
    INTERIOR_FLOOR: 'INTERIOR_FLOOR',
    GLAZING: 'GLAZING',
    FRAME: 'FRAME'
};

/**
 * Helper to get material properties matching parametric mode.
 * @returns {object} Material properties object.
 */
function getMaterialProperties() {
    const dom = getDom();
    const isTransparent = dom['transparent-toggle']?.checked || false;
    const surfaceOpacity = isTransparent ? parseFloat(dom['surface-opacity']?.value) || 0.5 : 1.0;
    const finalOpacity = Math.max(0.1, surfaceOpacity);

    return {
        side: THREE.DoubleSide,
        clippingPlanes: renderer?.clippingPlanes || [],
        clipIntersection: true,
        transparent: isTransparent,
        opacity: finalOpacity
    };
}

/**
 * Helper to get a color from CSS variables with a fallback.
 */
function getThemeColor(varName, fallback) {
    try {
        const color = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
        return color || fallback;
    } catch (e) {
        return fallback;
    }
}

export function getCustomRoomHeight() {
    return currentRoomHeight;
}

export function createCustomRoom(points2D, height, thickness = 0.2) {
    console.log('[CustomGeometry] createCustomRoom called');
    console.log('[CustomGeometry] points2D:', points2D);
    console.log('[CustomGeometry] height:', height, 'thickness:', thickness);

    // Validate inputs
    if (!points2D || points2D.length < 3) {
        console.error('[CustomGeometry] Invalid points2D: need at least 3 points');
        return;
    }

    if (isNaN(height) || height <= 0) {
        console.error('[CustomGeometry] Invalid height:', height);
        return;
        return;
    }

    currentRoomHeight = height;

    // 1. Set Custom Mode and Clear existing parametric room
    setIsCustomGeometry(true);
    while (roomObject.children.length > 0) roomObject.remove(roomObject.children[0]);
    while (wallSelectionGroup.children.length > 0) wallSelectionGroup.remove(wallSelectionGroup.children[0]);
    clearCustomWalls();

    const dom = getDom();
    const wallThickness = thickness;
    const matProps = getMaterialProperties();

    console.log('[CustomGeometry] Creating floor shape from points');

    // 2. Create Floor Shape
    const shape = new THREE.Shape();
    shape.moveTo(points2D[0].x, points2D[0].z);
    for (let i = 1; i < points2D.length; i++) {
        shape.lineTo(points2D[i].x, points2D[i].z);
    }
    shape.closePath();

    // 3. Create Floor & Ceiling with proper materials
    const floorGeom = new THREE.ShapeGeometry(shape);
    floorGeom.rotateX(Math.PI / 2);
    const floorMat = new THREE.MeshBasicMaterial({ ...matProps, color: new THREE.Color(getThemeColor('--floor-color', '#8D6E63')) });
    const floorMesh = new THREE.Mesh(floorGeom, floorMat);
    floorMesh.userData.surfaceType = SURFACE_TYPES.INTERIOR_FLOOR;
    roomObject.add(floorMesh);

    const ceilGeom = floorGeom.clone();
    ceilGeom.translate(0, height, 0);
    const ceilMat = new THREE.MeshBasicMaterial({ ...matProps, color: new THREE.Color(getThemeColor('--ceiling-color', '#FFFFFF')) });
    const ceilMesh = new THREE.Mesh(ceilGeom, ceilMat);
    ceilMesh.userData.surfaceType = SURFACE_TYPES.INTERIOR_CEILING;
    roomObject.add(ceilMesh);

    // 4. Create Walls
    const wallContainer = new THREE.Group();
    wallSelectionGroup.add(wallContainer);

    // Calculate Polygon Area to determine winding order (Shoelace formula)
    let area = 0;
    for (let i = 0; i < points2D.length; i++) {
        const j = (i + 1) % points2D.length;
        area += points2D[i].x * points2D[j].z;
        area -= points2D[j].x * points2D[i].z;
    }
    area /= 2;
    const isCCW = area > 0;

    // First, detect exterior corners
    const cornerTypes = []; // true = exterior corner, false = interior corner
    for (let i = 0; i < points2D.length; i++) {
        const p0 = points2D[(i - 1 + points2D.length) % points2D.length];
        const p1 = points2D[i];
        const p2 = points2D[(i + 1) % points2D.length];

        // Calculate edge vectors
        const v1 = { x: p1.x - p0.x, z: p1.z - p0.z };
        const v2 = { x: p2.x - p1.x, z: p2.z - p1.z };

        // Cross product to determine turn direction
        const cross = v1.x * v2.z - v1.z * v2.x;

        // INVERTED: For CCW polygon: positive cross = left turn = exterior corner (convex)
        // For CW polygon: negative cross = right turn = exterior corner
        const isExteriorCorner = isCCW ? (cross > 0.01) : (cross < -0.01);
        cornerTypes.push(isExteriorCorner);
    }

    // Create walls with extensions at exterior corners
    for (let i = 0; i < points2D.length; i++) {
        const p1 = points2D[i];
        const p2 = points2D[(i + 1) % points2D.length];

        const dx = p2.x - p1.x;
        const dz = p2.z - p1.z;
        const len = Math.sqrt(dx * dx + dz * dz);
        const angle = Math.atan2(dz, dx);

        // Check if this wall needs extensions at its endpoints
        const startIsExterior = cornerTypes[i];
        const endIsExterior = cornerTypes[(i + 1) % points2D.length];

        // Extend wall at exterior corners by FULL thickness to close exterior gaps
        let startExtension = 0;
        let endExtension = 0;

        if (startIsExterior) {
            startExtension = wallThickness;
        }
        if (endIsExterior) {
            endExtension = wallThickness;
        }

        const extendedLen = len + startExtension + endExtension;

        // Calculate offset due to asymmetric extension
        const extensionOffset = (endExtension - startExtension) / 2;

        const wallId = `wall_${i}`;
        registerCustomWall(wallId, { length: len, height: height });

        const wallGroup = createCustomWallGeometry(wallId, p1, p2, height, wallThickness, angle, isCCW, extendedLen, extensionOffset);
        wallContainer.add(wallGroup);
    }

    updateScene();
    // Ensure geometry is visible
    roomObject.visible = true;
    wallSelectionGroup.visible = true;

    console.log('[CustomGeometry] Geometry created successfully');
    console.log('[CustomGeometry] roomObject children:', roomObject.children.length);
    console.log('[CustomGeometry] wallSelectionGroup children:', wallSelectionGroup.children.length);

    import('./ui.js').then(({ setCameraView }) => {
        setCameraView('persp');
    });
}

export function updateCustomWall(wallId) {
    const wallContainer = wallSelectionGroup.children[0];
    if (!wallContainer) return;

    const wallGroup = wallContainer.children.find(c => c.userData.canonicalId === wallId);
    if (!wallGroup) return;

    const wallData = getCustomWallData(wallId);
    if (!wallData) return;

    const height = wallData.dimensions.height;
    const isCCW = wallGroup.userData.isCCW;
    const wallThickness = wallGroup.userData.thickness || 0.2;
    const extendedLen = wallGroup.userData.extendedLen || wallData.dimensions.length;

    // Remove old mesh
    while (wallGroup.children.length > 0) {
        const child = wallGroup.children[0];
        if (child.geometry) child.geometry.dispose();
        wallGroup.remove(child);
    }

    _buildWallContent(wallGroup, wallData, extendedLen, height, wallThickness, isCCW);

    // FIX: If it's a partition, re-center the content
    if (wallGroup.userData.isPartition) {
        wallGroup.children.forEach(c => c.position.z += wallThickness / 2);
    }
}

/**
 * Finds a wall that contains the given point on its edge (within tolerance).
 * @param {THREE.Vector3} point - The point to check (in local coordinates).
 * @param {number} tolerance - Distance tolerance for "on-line" detection.
 * @returns {object|null} { wallGroup, t } where t is the position along the wall (0-1), or null.
 */
function findWallAtPoint(point, tolerance = 0.3) {
    if (wallSelectionGroup.children.length === 0) return null;
    const container = wallSelectionGroup.children[0];

    for (const wallGroup of container.children) {
        // Skip partitions - only consider exterior walls
        if (wallGroup.userData.isPartition) continue;

        const p1 = wallGroup.userData.p1;
        const p2 = wallGroup.userData.p2;
        if (!p1 || !p2) continue;

        // Calculate distance from point to line segment p1-p2
        const lineVec = new THREE.Vector3().subVectors(p2, p1);
        const lineLen = lineVec.length();
        if (lineLen < 0.01) continue;

        const lineDir = lineVec.clone().normalize();
        const pointVec = new THREE.Vector3().subVectors(point, p1);

        // Project point onto line
        const t = pointVec.dot(lineDir) / lineLen;

        // Check if projection is within the segment (with small margin)
        if (t < 0.05 || t > 0.95) continue; // Don't split at corners

        // Calculate closest point on line
        const closestPoint = p1.clone().add(lineDir.multiplyScalar(t * lineLen));
        const distance = point.distanceTo(closestPoint);

        if (distance < tolerance) {
            return { wallGroup, t, splitPoint: closestPoint };
        }
    }
    return null;
}

/**
 * Splits a wall at the specified position, creating two new wall segments.
 * @param {THREE.Group} wallGroup - The wall group to split.
 * @param {number} t - Position along the wall (0-1) where to split.
 * @param {THREE.Vector3} splitPoint - The exact split point.
 */
function splitWallAtPoint(wallGroup, t, splitPoint) {
    const container = wallSelectionGroup.children[0];
    if (!container) return;

    const { p1, p2, isCCW, thickness, canonicalId } = wallGroup.userData;
    const height = currentRoomHeight;

    // Calculate the original wall's properties
    const originalAngle = Math.atan2(p2.z - p1.z, p2.x - p1.x);

    // Create two new wall segments
    // Segment 1: from p1 to splitPoint
    const len1 = p1.distanceTo(splitPoint);
    const wallId1 = `${canonicalId}_a`;
    registerCustomWall(wallId1, { length: len1, height: height });
    const wall1 = createCustomWallGeometry(wallId1, p1, splitPoint, height, thickness, originalAngle, isCCW, len1, 0);

    // Segment 2: from splitPoint to p2
    const len2 = splitPoint.distanceTo(p2);
    const wallId2 = `${canonicalId}_b`;
    registerCustomWall(wallId2, { length: len2, height: height });
    const wall2 = createCustomWallGeometry(wallId2, splitPoint, p2, height, thickness, originalAngle, isCCW, len2, 0);

    // Remove original wall
    container.remove(wallGroup);
    // Dispose geometry
    wallGroup.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
            if (Array.isArray(child.material)) {
                child.material.forEach(m => m.dispose());
            } else {
                child.material.dispose();
            }
        }
    });

    // Add new walls
    container.add(wall1);
    container.add(wall2);

    console.log(`[CustomGeometry] Split wall ${canonicalId} into ${wallId1} and ${wallId2}`);
}

export function addCustomPartition(p1, p2, height = currentRoomHeight, thickness = 0.1) {
    const wallId = `partition_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    // Ensure we have a container to add to
    if (wallSelectionGroup.children.length === 0) {
        const newContainer = new THREE.Group();
        wallSelectionGroup.add(newContainer);
    }
    const container = wallSelectionGroup.children[0];

    // Coordinate Transformation: World -> Local
    // This ensures that partitions are placed correctly relative to the room,
    // even if the room is rotated or elevated.
    wallSelectionGroup.updateMatrixWorld(true); // Ensure transforms are up to date

    const p1Local = p1.clone();
    const p2Local = p2.clone();

    container.worldToLocal(p1Local);
    container.worldToLocal(p2Local);

    // --- Wall Splitting Logic ---
    // Check if either endpoint touches an exterior wall and split it
    const wall1Hit = findWallAtPoint(p1Local);
    if (wall1Hit) {
        splitWallAtPoint(wall1Hit.wallGroup, wall1Hit.t, wall1Hit.splitPoint);
    }

    const wall2Hit = findWallAtPoint(p2Local);
    if (wall2Hit) {
        splitWallAtPoint(wall2Hit.wallGroup, wall2Hit.t, wall2Hit.splitPoint);
    }
    // --- End Wall Splitting Logic ---

    const len = p1Local.distanceTo(p2Local);
    registerCustomWall(wallId, { length: len, height: height });

    const angle = Math.atan2(p2Local.z - p1Local.z, p2Local.x - p1Local.x);

    // Create Partition Geometry
    const wallGroup = new THREE.Group();
    const midX = (p1Local.x + p2Local.x) / 2;
    const midZ = (p1Local.z + p2Local.z) / 2;

    wallGroup.position.set(midX, height / 2, midZ);
    wallGroup.rotation.y = -angle;

    wallGroup.userData.canonicalId = wallId;
    wallGroup.userData.p1 = p1Local; // Store local points for consistency
    wallGroup.userData.p2 = p2Local;
    wallGroup.userData.angle = angle;
    wallGroup.userData.isCCW = true; // Default for _buildWallContent
    wallGroup.userData.thickness = thickness;
    wallGroup.userData.extendedLen = len; // No extension
    wallGroup.userData.extensionOffset = 0;
    wallGroup.userData.isPartition = true;

    const wallData = getCustomWallData(wallId);

    // Build content (this will place it at [-thickness, 0])
    _buildWallContent(wallGroup, wallData, len, height, thickness, true);

    // Center it -> [-thickness/2, thickness/2]
    wallGroup.children.forEach(c => c.position.z += thickness / 2);

    // Add to existing container
    container.add(wallGroup);

    updateScene();
    return wallId;
}

function createCustomWallGeometry(wallId, p1, p2, height, wallThickness, angle, isCCW, extendedLen, extensionOffset = 0) {
    const wallGroup = new THREE.Group();

    // Midpoint for position
    const midX = (p1.x + p2.x) / 2;
    const midZ = (p1.z + p2.z) / 2;

    // Apply extension offset along the wall direction
    // The offset shifts the wall to account for asymmetric extensions
    const offsetX = extensionOffset * Math.cos(angle);
    const offsetZ = extensionOffset * Math.sin(angle);

    wallGroup.position.set(midX + offsetX, height / 2, midZ + offsetZ);
    wallGroup.rotation.y = -angle; // Counter-clockwise rotation

    // Store metadata for updates
    wallGroup.userData.canonicalId = wallId;
    wallGroup.userData.p1 = p1;
    wallGroup.userData.p2 = p2;
    wallGroup.userData.angle = angle;
    wallGroup.userData.isCCW = isCCW;
    wallGroup.userData.thickness = wallThickness;
    wallGroup.userData.extendedLen = extendedLen;
    wallGroup.userData.extensionOffset = extensionOffset;


    const wallData = getCustomWallData(wallId);
    _buildWallContent(wallGroup, wallData, extendedLen, height, wallThickness, isCCW);

    return wallGroup;
}

function _buildWallContent(wallGroup, wallData, len, height, wallThickness, isCCW) {
    const dom = getDom();
    const isTransparent = dom['transparent-toggle']?.checked || false;
    const surfaceOpacity = isTransparent ? parseFloat(dom['surface-opacity']?.value) || 0.5 : 1.0;
    const finalOpacity = Math.max(0.1, surfaceOpacity);

    const matProps = {
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
        side: THREE.DoubleSide,
        clippingPlanes: renderer?.clippingPlanes,
        clipIntersection: true,
        transparent: isTransparent,
        opacity: finalOpacity
    };

    // Helper to safety get computed styles
    const getThemeColor = (varName, fallback) => {
        try {
            const val = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
            return (val && val !== '') ? val : fallback;
        } catch (e) {
            return fallback;
        }
    };

    const wallColor = getThemeColor('--wall-color', '#F5F5F5');
    const frameColor = getThemeColor('--frame-color', '#8B4513');

    const wallMaterial = new THREE.MeshBasicMaterial({ ...matProps, color: new THREE.Color(wallColor) });
    const frameMaterial = new THREE.MeshBasicMaterial({ ...matProps, color: new THREE.Color(frameColor) });
    const windowMaterial = new THREE.MeshBasicMaterial({
        color: 0xb3ecff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: parseFloat(dom['glazing-trans']?.value) || 0.7,
        clippingPlanes: renderer?.clippingPlanes,
        clipIntersection: true,
        polygonOffset: true,
        polygonOffsetFactor: 2,
        polygonOffsetUnits: 1
    });

    // Create Shape
    const wallShape = new THREE.Shape();
    wallShape.moveTo(-len / 2, -height / 2);
    wallShape.lineTo(len / 2, -height / 2);
    wallShape.lineTo(len / 2, height / 2);
    wallShape.lineTo(-len / 2, height / 2);
    wallShape.closePath();

    // Add Holes (Windows)
    const apertures = wallData.apertures;
    if (apertures && apertures.count > 0) {
        const ww = apertures.width;
        const wh = apertures.height;
        const sh = apertures.sillHeight;
        const spacing = apertures.mode === 'wwr' ? 0.1 : ww / 2; // Simple spacing logic

        // Calculate group width to center windows
        const groupWidth = apertures.count * ww + Math.max(0, apertures.count - 1) * spacing;
        const startX = -groupWidth / 2;

        for (let i = 0; i < apertures.count; i++) {
            // Calculate Center X and Y
            const winCenterX = startX + ww / 2 + i * (ww + spacing);
            const winCenterY = sh + wh / 2 - height / 2;

            const holePath = new THREE.Path();
            holePath.moveTo(winCenterX - ww / 2, winCenterY - wh / 2);
            holePath.lineTo(winCenterX + ww / 2, winCenterY - wh / 2);
            holePath.lineTo(winCenterX + ww / 2, winCenterY + wh / 2);
            holePath.lineTo(winCenterX - ww / 2, winCenterY + wh / 2);
            holePath.closePath();
            wallShape.holes.push(holePath);

            // Frame Parameters
            const addFrame = wallData.frame?.enabled || false;
            const ft = addFrame ? (wallData.frame.thick || 0.05) : 0;
            const frameDepth = addFrame ? (wallData.frame.depth || 0.15) : 0;

            const glassWidth = Math.max(0, ww - 2 * ft);
            const glassHeight = Math.max(0, wh - 2 * ft);

            // Create Glass (only for windows, not doors)
            const isDoor = apertures.type === 'door';
            if (!isDoor && glassWidth > 0 && glassHeight > 0) {
                const glass = new THREE.Mesh(new THREE.PlaneGeometry(glassWidth, glassHeight), windowMaterial);
                glass.userData.surfaceType = SURFACE_TYPES.GLAZING;
                // Correctly position the glass in 2D space (X, Y)
                glass.position.set(winCenterX, winCenterY, 0); // Z will be set later
                wallGroup.add(glass);
            }

            // Create Frame
            if (addFrame && ft > 0) {
                const frameShape = new THREE.Shape();
                // Outer Rectangle (Hole Size)
                frameShape.moveTo(winCenterX - ww / 2, winCenterY - wh / 2);
                frameShape.lineTo(winCenterX + ww / 2, winCenterY - wh / 2);
                frameShape.lineTo(winCenterX + ww / 2, winCenterY + wh / 2);
                frameShape.lineTo(winCenterX - ww / 2, winCenterY + wh / 2);
                frameShape.closePath();

                // Inner Rectangle (Glass Size)
                const frameHole = new THREE.Path();
                frameHole.moveTo(winCenterX - glassWidth / 2, winCenterY - glassHeight / 2);
                frameHole.lineTo(winCenterX + glassWidth / 2, winCenterY - glassHeight / 2);
                frameHole.lineTo(winCenterX + glassWidth / 2, winCenterY + glassHeight / 2);
                frameHole.lineTo(winCenterX - glassWidth / 2, winCenterY + glassHeight / 2);
                frameHole.closePath();
                frameShape.holes.push(frameHole);

                const frameExtrudeSettings = { steps: 1, depth: frameDepth, bevelEnabled: false };
                const frameGeometry = new THREE.ExtrudeGeometry(frameShape, frameExtrudeSettings);

                // Store frame for Z-adjustment later
                // We assume frame is centered on glass Z usually, or flush? 
                // We'll set generic Z here and adjust in the final pass.
                const frameMesh = new THREE.Mesh(frameGeometry, frameMaterial);
                frameMesh.userData.surfaceType = SURFACE_TYPES.FRAME;
                frameMesh.userData.frameDepth = frameDepth; // Store for offset calculation
                // By default Extrude goes 0 to +depth. Center is +depth/2.
                // We temporarily center it at Z=0 for easier adjustment later
                frameGeometry.translate(0, 0, -frameDepth / 2);

                wallGroup.add(frameMesh);
            }
        }
    }

    // Add Holes for Doors
    if (apertures && apertures.type === 'door' && apertures.doorCount > 0) {
        const dw = apertures.doorWidth || 0.9;
        const dh = apertures.doorHeight || 2.1;
        const doorSpacing = apertures.doorSpacing || 0.5;
        const doorDepthPos = apertures.doorDepthPos || 0.1;

        // Calculate group width to center doors
        const doorGroupWidth = apertures.doorCount * dw + Math.max(0, apertures.doorCount - 1) * doorSpacing;
        const startX = -doorGroupWidth / 2;

        for (let i = 0; i < apertures.doorCount; i++) {
            // Calculate center X - doors start from bottom (floor)
            const doorCenterX = startX + dw / 2 + i * (dw + doorSpacing);
            const doorCenterY = dh / 2 - height / 2; // Door starts at floor level

            const doorHolePath = new THREE.Path();
            doorHolePath.moveTo(doorCenterX - dw / 2, doorCenterY - dh / 2);
            doorHolePath.lineTo(doorCenterX + dw / 2, doorCenterY - dh / 2);
            doorHolePath.lineTo(doorCenterX + dw / 2, doorCenterY + dh / 2);
            doorHolePath.lineTo(doorCenterX - dw / 2, doorCenterY + dh / 2);
            doorHolePath.closePath();
            wallShape.holes.push(doorHolePath);
        }
    }

    // Extrude
    const extrudeSettings = { steps: 1, depth: wallThickness, bevelEnabled: false };
    const wallGeometry = new THREE.ExtrudeGeometry(wallShape, extrudeSettings);

    // Determine Offset for Outward Extrusion
    // Local coords: X is along the wall (P1->P2). Y is Up. Z is Normal.
    // If CCW, "Outward" is -Z (Right Hand Rule: X=Right, Y=Up, Z=Towards Viewer. P1->P2 is Right. So Z is "Inward" relative to the loop? No.)
    // Let's stick to:
    // CCW Polygon: Normal points "Up" (Y). But here we are in XZ plane.
    // P1=(0,0), P2=(1,0). Vector=(1,0).
    // Normal (-y, x) = (0, 1) -> +Z. This is "Left" of the line.
    // So for CCW, +Z local is Inside.
    // So to extrude Outward, we want -Z direction or shift to -Z.

    // If we extrude by +depth, the block is from Z=0 to Z=depth (Inside).
    // So we want to move it to Z = -depth to 0? No, that would be Outside?
    // If +Z is Inside, then 0 to +depth is an Inward Thick Wall.
    // This is what we want for "Outward Extrusion" of the *room* volume? 
    // No, "Extrude Outwards" usually means the drawn line is the *Inner* face.
    // So the wall thickness grows away from the room center.
    // If +Z is Inside, then we want the wall to be from Z=0 to Z=-thickness (Outside).

    // Let's assume isCCW = true.
    // Local Z+ is Inside.
    // We want wall from Z=0 to Z=-thickness.
    // ExtrudeGeometry creates from 0 to +depth.
    // So we translate by -thickness?

    // If isCCW = false (CW).
    // Local Z+ is Outside.
    // We want wall from Z=0 to Z=+thickness.
    // ExtrudeGeometry creates from 0 to +depth.
    // No translation needed?

    let zOffset = 0;
    if (isCCW) {
        // Z+ is Inside. We want Z- (Outside).
        // Geometry is 0 to +Thickness.
        // Translate to -Thickness to 0.
        zOffset = -wallThickness;
    } else {
        // Z+ is Outside. We want Z+ (Outside).
        // Geometry is 0 to +Thickness.
        // No translation.
        zOffset = 0;
    }

    wallGeometry.translate(0, 0, zOffset);

    // Update Component Z-Positions
    // Calculate effective depth position relative to the wall extrusion
    // If Z+ is Inside (CCW) -> Wall is [-Thick, 0]. Outside is -Thick.
    // If Z+ is Outside (CW) -> Wall is [0, +Thick]. Outside is +Thick.

    // We want to verify `depthPos` (from params, e.g. 0.1) is used correctly. 
    // Let's assume depthPos is "Distance from Exterior Face".
    const depthPos = wallData.apertures.depthPos || 0.1;
    let baseGlassZ = 0;

    if (isCCW) {
        // Outside Face is at zOffset (-wallThickness).
        // Moving "Inward" (towards Z=0) means adding depthPos?
        // -wallThickness + depthPos
        baseGlassZ = zOffset + depthPos;
    } else {
        // Outside Face is at zOffset + wallThickness (since zOffset=0, it's +Thickness).
        // Moving "Inward" (towards Z=0, wait, Inside is -Z relative to norm? No.)
        // If CW, Z+ is Outside. Inside is Z-.
        // So Wall is [0, Thick]. 0 is Inside? No, earlier logic said:
        // "If isCCW=false (CW). Local Z+ is Outside."
        // So 0 is Inside? Thick is Outside?
        // Then Inward direction is -Z.
        // baseGlassZ = OutsideZ - depthPos = (zOffset + wallThickness) - depthPos.
        baseGlassZ = (zOffset + wallThickness) - depthPos;
    }

    // Determine Frame Z
    // Frame is generated centered at 0 (from -d/2 to +d/2).
    // It should be centered on the glass? Or usually Frame is thicker and centered.

    wallGroup.children.forEach(c => {
        if (c.userData.surfaceType === SURFACE_TYPES.GLAZING) {
            c.position.z = baseGlassZ;
        }
        if (c.userData.surfaceType === SURFACE_TYPES.FRAME) {
            c.position.z = baseGlassZ;
        }
    });

    // Create Mesh
    const wallMesh = new THREE.Mesh(wallGeometry, wallMaterial);
    wallMesh.userData.isSelectableWall = true;
    wallMesh.userData.surfaceType = SURFACE_TYPES.INTERIOR_WALL;

    // Add wireframe
    const edges = new THREE.EdgesGeometry(wallGeometry);
    const wireframe = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x333333 }));
    // Wireframe needs same translation? EdgesGeometry is based on the geometry which is already translated.
    // But we added it to a new mesh.
    // Wait, EdgesGeometry uses the geometry. If we translated the geometry, edges are correct.
    // But we need to add wireframe to group, not mesh.

    wallGroup.add(wallMesh);
    wallGroup.add(wireframe);
}
