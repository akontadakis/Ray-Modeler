
// scripts/sunTracer.js

import * as THREE from 'three';
import { scene } from './scene.js';
import { roomObject, shadingObject, wallSelectionGroup, furnitureObject, vegetationObject } from './geometry.js';
import { project } from './project.js';
import { getDom } from './dom.js';

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
        existingHelper.removeFromParent();
        if (existingHelper.geometry) existingHelper.geometry.dispose();
        if (existingHelper.material) existingHelper.material.dispose();
    }
    if (!sunVector) return null; // Return null if no vector

    const sunMaterial = new THREE.MeshBasicMaterial({ color: 0xFFFF00 });
    const sunGeometry = new THREE.SphereGeometry(0.5, 32, 32);
    const sunHelper = new THREE.Mesh(sunGeometry, sunMaterial);
    sunHelper.name = 'SunPositionHelper';
    sunHelper.position.copy(sunVector).multiplyScalar(20);
    return sunHelper; // Return the helper
}

/**
 * Finds all glazing panels, calculates their area, and the total area.
 * @returns {{panels: Array<{object: THREE.Mesh, area: number}>, totalArea: number}}
 * @private
 */
function _findGlazingPanels() {
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
    return { panels: glazingPanels, totalArea: totalGlazingArea };
}

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
    const latitude = parseFloat(dom.latitude.value);
    const longitude = parseFloat(dom.longitude.value);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        console.warn('[sunTracer] Invalid latitude/longitude. Skipping sun ray tracing.');
        return;
    }

    // 1. Calculate Sun Position and create the visual helper
    const solarPosition = computeSolarPosition({
        date: params.date,
        time: params.time,
        latitude,
        longitude
    });

    if (!solarPosition) {
        console.warn('[sunTracer] Failed to compute solar position. Skipping sun ray tracing.');
        return;
    }

    const { direction: sunToSunVector, altitudeDeg } = solarPosition;

    // Skip visualization when sun is below horizon
    if (altitudeDeg <= 0) {
        console.warn('[sunTracer] Sun below horizon for given time/location. Skipping sun ray tracing.');
        return;
    }

    const sunHelper = _createSunPositionHelper(sunToSunVector);
    if (sunHelper) {
        scene.add(sunHelper);
    }

    // Find all glazing surfaces and calculate total area
    const { panels: glazingPanels, totalArea: totalGlazingArea } = _findGlazingPanels();

if (glazingPanels.length === 0) {
        console.warn('[sunTracer] Could not find any glazing surfaces to trace rays through.');
        return;
    }

    // Ray direction from sun towards the scene (opposite of vector from origin to sun)
    const sunDirection = sunToSunVector.clone().negate();
    const raycaster = new THREE.Raycaster();
    const allObjects = [roomObject, wallSelectionGroup, shadingObject, furnitureObject, vegetationObject];

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
                // Start the ray from 50 units "behind" the glazing, pointing along the sun direction
            const originPoint = targetPoint.clone().addScaledVector(sunDirection, -50);

            const raySegments = _traceAndBounceRay(
                originPoint,
                sunDirection.clone(),
                raycaster,
                allObjects,
                params.maxBounces
            );

                // Add the resulting line segments to the main group
                raySegments.forEach(line => rayGroup.add(line));
            }
        }
    });
}

/**
* Traces a single ray and its bounces, returning the line segments.
* @param {THREE.Vector3} startPosition - The starting point of the ray.
* @param {THREE.Vector3} startDirection - The initial direction of the ray.
* @param {THREE.Raycaster} raycaster - The raycaster instance to use.
* @param {Array<THREE.Object3D>} allObjects - Objects to test for intersection.
* @param {number} maxBounces - Maximum number of interior bounces.
* @returns {Array<THREE.Line>} An array of line segments representing the ray path.
* @private 
*/ 
function _traceAndBounceRay(startPosition, startDirection, raycaster, allObjects, maxBounces) { 
    let currentPosition = startPosition.clone(); 
    let currentDirection = startDirection.clone(); 
    let isInside = false; 
    let interiorBounces = 0; const segments = [];

    // Allow for a few external reflections before giving up on a ray
    const maxSegments = maxBounces + 5;

    for (let segment = 0; segment < maxSegments; segment++) { if (interiorBounces >= maxBounces) break;

    // Start raycast slightly offset to avoid self-intersection
    raycaster.set(currentPosition.clone().addScaledVector(currentDirection, 0.001), currentDirection);
    const intersects = raycaster.intersectObjects(allObjects, true);
    
    // Find the first valid mesh hit
    const hit = intersects.find(h => h.object.isMesh && h.distance > 0.001);

    if (!hit) break; // Ray escaped to infinity

    const nextPosition = hit.point;
    const hitObject = hit.object;

    // Create the visual line segment
    const colorIndex = isInside ? interiorBounces + 1 : 0;
    const material = new THREE.LineBasicMaterial({
        color: RAY_COLORS[Math.min(colorIndex, RAY_COLORS.length - 1)],
        linewidth: 2 // Note: linewidth > 1 has no effect in WebGL.
    });

    const geometry = new THREE.BufferGeometry().setFromPoints([currentPosition, nextPosition]);
    segments.push(new THREE.Line(geometry, material));

    // Update state for the NEXT segment
    currentPosition = nextPosition.clone();

    if (hitObject.userData.surfaceType === 'GLAZING') {
        isInside = !isInside; // Toggle state: ray passes through
        // Continue with the same direction from the new position
        continue;
    }

    // --- This block now only executes for OPAQUE surfaces ---

    // If a ray hits the window frame from outside, terminate it.
    if (hitObject.userData.surfaceType === 'FRAME' && !isInside) {
        break; // Stop tracing this ray's path completely.
    }

    if (isInside) {
        interiorBounces++;
    }

    // Reflect the ray off any other opaque surface
    const normal = hit.face.normal.clone();
    normal.transformDirection(hitObject.matrixWorld);
    currentDirection.reflect(normal);
    } 
    
    return segments;
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

/**
 * Compute solar position for visualization.
 *
 * Conventions:
 * - Input time is interpreted as local civil time.
 * - Time zone is approximated from longitude using LSTM (visualization only).
 * - Azimuth:
 *   - 0° = North, 90° = East, clockwise.
 * - Returned direction is a unit vector from the origin TOWARDS the sun.
 *
 * This is intentionally local to the visualization and does not override the
 * EPW/time handling used by Simulation Recipes.
 *
 * @param {Object} params
 * @param {Date} params.date - JS Date instance (local or UTC; day/month/year are used via UTC).
 * @param {string} params.time - "HH:MM" local civil time string.
 * @param {number} params.latitude
 * @param {number} params.longitude
 * @returns {{ altitudeDeg: number, azimuthDeg: number, direction: THREE.Vector3 }|null}
 */
export function computeSolarPosition(params) {
    const { date, time, latitude, longitude } = params;

    if (!(date instanceof Date) || typeof time !== 'string') {
        console.warn('[sunTracer] Invalid date/time supplied to computeSolarPosition.');
        return null;
    }

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        console.warn('[sunTracer] Invalid latitude/longitude supplied to computeSolarPosition.');
        return null;
    }

    const [hour, minute] = time.split(':').map(Number);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
        console.warn('[sunTracer] Invalid time format supplied to computeSolarPosition.');
        return null;
    }

    // Day of year using UTC date to avoid local DST shifts
    const dayOfYear =
        (Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) -
            Date.UTC(date.getUTCFullYear(), 0, 0)) /
        (24 * 60 * 60 * 1000);

    // Latitude/longitude in radians
    const latRad = THREE.MathUtils.degToRad(latitude);

    // Approximate time zone from longitude (LSTM).
    // NOTE: This is for visualization only and may not match EPW timezone.
    const lstm = 15 * Math.round(longitude / 15);

    // Equation of Time (in minutes)
    const b = THREE.MathUtils.degToRad((360 / 365) * (dayOfYear - 81));
    const eot =
        9.87 * Math.sin(2 * b) -
        7.53 * Math.cos(b) -
        1.5 * Math.sin(b);

    // Time correction in minutes
    const tc = 4 * (longitude - lstm) + eot;

    // Local solar time (hours)
    const fractionalHour = hour + minute / 60;
    const lst = fractionalHour + tc / 60;

    // Hour angle (radians)
    const hRad = THREE.MathUtils.degToRad(15 * (lst - 12));

    // Solar declination (degrees -> radians), using common approximation
    const declDeg = -23.45 * Math.cos(THREE.MathUtils.degToRad((360 / 365) * (dayOfYear + 10)));
    const declRad = THREE.MathUtils.degToRad(declDeg);

    // Solar altitude (elevation) angle
    const altitudeRad = Math.asin(
        Math.sin(declRad) * Math.sin(latRad) +
        Math.cos(declRad) * Math.cos(latRad) * Math.cos(hRad)
    );

    // Guard against numerical issues (e.g. cos(alt) ~ 0)
    const cosAlt = Math.cos(altitudeRad);
    if (cosAlt <= 0) {
        // At or below horizon; caller is expected to handle as "no sun".
        return {
            altitudeDeg: THREE.MathUtils.radToDeg(altitudeRad),
            azimuthDeg: 0,
            direction: new THREE.Vector3(0, 0, 0)
        };
    }

    // Solar azimuth (0° = North, 90° = East, clockwise)
    let azimuthRad = Math.acos(
        (Math.sin(declRad) * Math.cos(latRad) -
            Math.cos(declRad) * Math.sin(latRad) * Math.cos(hRad)) /
        cosAlt
    );

    if (hRad > 0) {
        azimuthRad = 2 * Math.PI - azimuthRad;
    }

    const altitudeDeg = THREE.MathUtils.radToDeg(altitudeRad);
    const azimuthDeg = THREE.MathUtils.radToDeg(azimuthRad);

    // Build direction vector from origin TOWARDS the sun
    const direction = new THREE.Vector3().setFromSphericalCoords(
        1,
        Math.PI / 2 - altitudeRad,
        azimuthRad
    );

    return { altitudeDeg, azimuthDeg, direction };
}

export function toggleSunRaysVisibility(visible) {
    rayGroup.visible = visible;
}
