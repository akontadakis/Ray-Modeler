
// scripts/sunTracer.js

import * as THREE from 'three';
import { scene } from './scene.js';
import { roomObject, shadingObject, wallSelectionGroup } from './geometry.js';
import { project } from './project.js';
import { getDom } from './ui.js';

const rayGroup = new THREE.Group();
rayGroup.name = 'SunRayTraces';

// Color palette for the initial ray and up to 10 bounces.
const RAY_COLORS = [
    new THREE.Color(0xffff00), // Initial Ray (Yellow)
    new THREE.Color(0xffd700), // Bounce 1
    new THREE.Color(0xffa500), // Bounce 2 (Orange)
    new THREE.Color(0xff7f50), // Bounce 3
    new THREE.Color(0xff4500), // Bounce 4 (OrangeRed)
    new THREE.Color(0xff0000), // Bounce 5 (Red)
    new THREE.Color(0xdc143c), // Bounce 6
    new THREE.Color(0xc71585), // Bounce 7 (MediumVioletRed)
    new THREE.Color(0x8a2be2), // Bounce 8 (BlueViolet)
    new THREE.Color(0x4b0082), // Bounce 9 (Indigo)
    new THREE.Color(0x200040)  // Bounce 10 (Dark Purple)
];

/**
 * Creates or updates a simple sphere mesh to visualize the sun's position.
 * @private
 * @param {THREE.Vector3} sunVector - The vector pointing from the origin TOWARDS the sun.
 */
function _createSunPositionHelper(sunVector) {
    const existingHelper = scene.getObjectByName('SunPositionHelper');
    if (existingHelper) {
        scene.remove(existingHelper);
        if (existingHelper.geometry) existingHelper.geometry.dispose();
        if (existingHelper.material) existingHelper.material.dispose();
    }
    if (!sunVector) return;

    const sunMaterial = new THREE.MeshBasicMaterial({ color: 0xFFFF00 });
    const sunGeometry = new THREE.SphereGeometry(0.5, 32, 32);
    const sunHelper = new THREE.Mesh(sunGeometry, sunMaterial);
    sunHelper.name = 'SunPositionHelper';
    sunHelper.position.copy(sunVector).multiplyScalar(20);
    scene.add(sunHelper);
}

// scripts/sunTracer.js

/**
 * The main function to orchestrate the ray tracing visualization.
 * @param {object} params - User-defined parameters from the UI.
 */
export function traceSunRays(params) {
    // Clear any previous lines
    rayGroup.clear();
    if (!scene.getObjectByName(rayGroup.name)) {
        scene.add(rayGroup);
    }

    const dom = getDom();
    const sunParams = {
        date: params.date,
        time: params.time,
        latitude: parseFloat(dom.latitude.value),
        longitude: parseFloat(dom.longitude.value)
    };

    // 1. Calculate Sun Position and create the visual helper
    const { sunVector } = _calculateSunVector(sunParams);
    _createSunPositionHelper(sunVector);

    // Find all glazing surfaces and calculate total area
    const glazingPanels = [];
    let totalGlazingArea = 1e-6; // Avoid division by zero

    wallSelectionGroup.traverse((object) => {
        if (object.isMesh && object.userData.surfaceType === 'GLAZING') {
            if (object.geometry.parameters && object.geometry.parameters.width && object.geometry.parameters.height) {
                const worldScale = new THREE.Vector3();
                object.getWorldScale(worldScale);
                const area = object.geometry.parameters.width * object.geometry.parameters.height * worldScale.x * worldScale.y;
                if (area > 0) {
                    glazingPanels.push({ object, area });
                    totalGlazingArea += area;
                }
            }
        }
    });

    if (glazingPanels.length === 0) {
        console.warn("Could not find any glazing surfaces to trace rays through.");
        return;
    }

    const sunDirection = sunVector.clone().negate();
    const raycaster = new THREE.Raycaster();
    const allObjects = [roomObject, wallSelectionGroup, shadingObject];

    // Iterate through each glazing panel and cast a grid of rays
    glazingPanels.forEach(panel => {
        const { object, area } = panel;
        const numRaysForPanel = Math.max(1, Math.round(params.rayCount * (area / totalGlazingArea)));
        const gridDim = Math.max(1, Math.floor(Math.sqrt(numRaysForPanel)));

        const geometry = object.geometry;
        const matrix = object.matrixWorld;
        const width = geometry.parameters.width;
        const height = geometry.parameters.height;

        for (let i = 0; i <= gridDim; i++) {
            for (let j = 0; j <= gridDim; j++) {
                const u = (i / gridDim) - 0.5;
                const v = (j / gridDim) - 0.5;
                const localPoint = new THREE.Vector3(u * width, v * height, 0);
                const targetPoint = localPoint.clone().applyMatrix4(matrix);

                // --- Unified Ray Tracing and Bouncing Simulation ---
                const originPoint = targetPoint.clone().addScaledVector(sunDirection, -50);
                let currentPosition = originPoint.clone();
                let currentDirection = sunDirection.clone();
                let isInside = false;
                let interiorBounces = 0;

                // Allow for a few external reflections before giving up on a ray
                const maxSegments = params.maxBounces + 5;

                for (let segment = 0; segment < maxSegments; segment++) {
                    if (interiorBounces >= params.maxBounces) break;

                    raycaster.set(currentPosition.clone().addScaledVector(currentDirection, 0.001), currentDirection);
                    const intersects = raycaster.intersectObjects(allObjects, true);
                    const hit = intersects.find(h => h.object.isMesh && h.distance > 0.001);

                    if (!hit) break; // Ray escaped to infinity

                    const nextPosition = hit.point;
                    const hitObject = hit.object;

                    // Draw the current ray segment
                    const colorIndex = isInside ? interiorBounces + 1 : 0;
                    const material = new THREE.LineBasicMaterial({
                        color: RAY_COLORS[Math.min(colorIndex, RAY_COLORS.length - 1)],
                        linewidth: 2
                    });
                    const geometry = new THREE.BufferGeometry().setFromPoints([currentPosition, nextPosition]);
                    rayGroup.add(new THREE.Line(geometry, material));

                    // Update state for the NEXT segment
                    currentPosition = nextPosition.clone();

                    if (hitObject.userData.surfaceType === 'GLAZING') {
                        isInside = !isInside; // Toggle state: ray passes through
                        // By continuing, we skip the reflection logic below for this segment.
                        // The next raycast will start from the glazing surface with an unchanged direction.
                        continue;
                    }

                    // --- This block now only executes for OPAQUE surfaces ---

                    // If a ray hits the window frame from outside, terminate it to reduce visual clutter.
                    // This prevents the visualization of direct reflections from the frame itself.
                    if (hitObject.userData.surfaceType === 'FRAME' && !isInside) {
                        break; // Stop tracing this ray's path completely.
                    }

                    if (isInside) {
                        interiorBounces++;
                    }
                    // Reflect the ray off any other opaque surface (wall, ceiling, shading device)
                    const normal = hit.face.normal.clone();
                    normal.transformDirection(hitObject.matrixWorld);
                    currentDirection.reflect(normal);
                }
            }
        }
    });
}

// --- UNCHANGED HELPER FUNCTIONS ---

function _getSolarDataFromEpw(epwContent, date, time) {
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    const hour = parseInt(time.split(':')[0], 10);
    const epwHour = hour + 1;
    const lines = epwContent.split('\n');
    const dataLines = lines.slice(8);
    for (const line of dataLines) {
        const parts = line.split(',');
        if (parts.length < 16) continue;
        if (parseInt(parts[1], 10) === month && parseInt(parts[2], 10) === day && parseInt(parts[3], 10) === epwHour) {
            return { dni: parseFloat(parts[14]), dhi: parseFloat(parts[15]) };
        }
    }
    return null;
}

function _calculateSunVector(params) {
    const { date, time, latitude, longitude } = params;
    const dayOfYear = (Date.UTC(date.getFullYear(), date.getUTCMonth(), date.getUTCDate()) - Date.UTC(date.getFullYear(), 0, 0)) / (24 * 60 * 60 * 1000);
    const [hour, minute] = time.split(':').map(Number);
    const fractionalHour = hour + minute / 60;
    const lstm = 15 * Math.round(longitude / 15);
    const b = (360 / 365) * (dayOfYear - 81) * (Math.PI / 180);
    const eot = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
    const tc = 4 * (longitude - lstm) + eot;
    const lst = fractionalHour + tc / 60;
    const h_rad = (15 * (lst - 12)) * (Math.PI / 180);
    const lat_rad = latitude * (Math.PI / 180);
    const decl_rad = -23.45 * Math.cos((360 / 365) * (dayOfYear + 10) * (Math.PI / 180)) * (Math.PI / 180);
    const altitude_rad = Math.asin(Math.sin(decl_rad) * Math.sin(lat_rad) + Math.cos(decl_rad) * Math.cos(lat_rad) * Math.cos(h_rad));
    let azimuth_rad = Math.acos((Math.sin(decl_rad) * Math.cos(lat_rad) - Math.cos(decl_rad) * Math.sin(lat_rad) * Math.cos(h_rad)) / Math.cos(altitude_rad));
    if (h_rad > 0) {
        azimuth_rad = 2 * Math.PI - azimuth_rad;
    }
    const sunVector = new THREE.Vector3();
    sunVector.setFromSphericalCoords(1, Math.PI / 2 - altitude_rad, azimuth_rad + Math.PI);
    return {
        sunVector,
        altitude: THREE.MathUtils.radToDeg(altitude_rad),
        azimuth: THREE.MathUtils.radToDeg(azimuth_rad)
    };
}

export function toggleSunRaysVisibility(visible) {
    rayGroup.visible = visible;
}
