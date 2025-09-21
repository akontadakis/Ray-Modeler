// scripts/sunTracer.js

import * as THREE from 'three';
import { roomObject, shadingObject } from './geometry.js';

// --- SURFACE CLASSIFICATION CONSTANTS ---

/**
 * Surface type classification system for ray interaction behavior
 */
export const SURFACE_TYPES = {
    // Exterior surfaces - rays should not pass through
    EXTERIOR_WALL: 'EXTERIOR_WALL',
    EXTERIOR_CEILING: 'EXTERIOR_CEILING',
    EXTERIOR_FLOOR: 'EXTERIOR_FLOOR',

    // Interior surfaces - rays can reflect off
    INTERIOR_WALL: 'INTERIOR_WALL',
    INTERIOR_CEILING: 'INTERIOR_CEILING',
    INTERIOR_FLOOR: 'INTERIOR_FLOOR',

    // Transparent surfaces - rays can pass through
    GLAZING: 'GLAZING',
    FRAME: 'FRAME',

    // Shading devices - block rays
    SHADING_DEVICE: 'SHADING_DEVICE'
};

/**
 * Ray behavior constants
 */
export const RAY_BEHAVIOR = {
    // Ray interaction types
    REFLECT: 'REFLECT',
    TRANSMIT: 'TRANSMIT',
    ABSORB: 'ABSORB',
    BLOCK: 'BLOCK',

    // Ray visualization modes
    VISUALIZATION: {
        EXTERIOR: 'EXTERIOR',
        INTERIOR: 'INTERIOR',
        SHADED: 'SHADED'
    }
};

/**
 * Surface Classification System
 * Determines surface type and ray interaction behavior
 */
export class SurfaceClassifier {
    /**
     * Classify a surface based on its properties and position
     * @param {THREE.Object3D} object - The 3D object to classify
     * @param {THREE.Vector3} point - The point of intersection
     * @param {boolean} isInterior - Whether this is an interior surface
     * @returns {string} Surface type constant
     */
    static classifySurface(object, point, isInterior = false) {
        // Check if object has explicit surface type in userData
        if (object.userData.surfaceType) {
            return object.userData.surfaceType;
        }

        // Check material properties for surface classification
        const material = object.material;
        if (material) {
            // Transparent materials are typically glazing
            if (material.transparent || material.opacity < 1.0) {
                return SURFACE_TYPES.GLAZING;
            }

            // Check material name for clues
            const materialName = material.name || material.type || '';
            if (materialName.toLowerCase().includes('glass') ||
                materialName.toLowerCase().includes('glazing')) {
                return SURFACE_TYPES.GLAZING;
            }
        }

        // Check object name for classification clues
        const objectName = object.name || '';
        if (objectName.toLowerCase().includes('shading') ||
            objectName.toLowerCase().includes('shade')) {
            return SURFACE_TYPES.SHADING_DEVICE;
        }

        if (objectName.toLowerCase().includes('frame')) {
            return SURFACE_TYPES.FRAME;
        }

        // Check userData for additional classification
        if (object.userData.isGlazing) {
            return SURFACE_TYPES.GLAZING;
        }

        if (object.userData.isShadingDevice) {
            return SURFACE_TYPES.SHADING_DEVICE;
        }

        // Default classification based on interior/exterior and geometry type
        if (isInterior) {
            return SURFACE_TYPES.INTERIOR_WALL;
        } else {
            return SURFACE_TYPES.EXTERIOR_WALL;
        }
    }

    /**
     * Get ray interaction behavior for a surface type
     * @param {string} surfaceType - Surface type constant
     * @returns {string} Ray behavior constant
     */
    static getRayBehavior(surfaceType) {
        switch (surfaceType) {
            case SURFACE_TYPES.GLAZING:
                return RAY_BEHAVIOR.TRANSMIT;
            case SURFACE_TYPES.SHADING_DEVICE:
                return RAY_BEHAVIOR.BLOCK;
            case SURFACE_TYPES.FRAME:
                return RAY_BEHAVIOR.BLOCK;
            case SURFACE_TYPES.EXTERIOR_WALL:
            case SURFACE_TYPES.EXTERIOR_CEILING:
            case SURFACE_TYPES.EXTERIOR_FLOOR:
                return RAY_BEHAVIOR.BLOCK;
            case SURFACE_TYPES.INTERIOR_WALL:
            case SURFACE_TYPES.INTERIOR_CEILING:
            case SURFACE_TYPES.INTERIOR_FLOOR:
            default:
                return RAY_BEHAVIOR.REFLECT;
        }
    }

    /**
     * Determine if a surface should be included in ray collision detection
     * @param {string} surfaceType - Surface type constant
     * @returns {boolean} Whether surface should block rays
     */
    static shouldCollide(surfaceType) {
        return [
            SURFACE_TYPES.EXTERIOR_WALL,
            SURFACE_TYPES.EXTERIOR_CEILING,
            SURFACE_TYPES.EXTERIOR_FLOOR,
            SURFACE_TYPES.INTERIOR_WALL,
            SURFACE_TYPES.INTERIOR_CEILING,
            SURFACE_TYPES.INTERIOR_FLOOR,
            SURFACE_TYPES.SHADING_DEVICE,
            SURFACE_TYPES.FRAME
        ].includes(surfaceType);
    }

    /**
     * Get reflection properties for different surface types
     * @param {string} surfaceType - Surface type constant
     * @returns {Object} Reflection properties
     */
    static getReflectionProperties(surfaceType) {
        switch (surfaceType) {
            case SURFACE_TYPES.INTERIOR_WALL:
            case SURFACE_TYPES.INTERIOR_CEILING:
            case SURFACE_TYPES.INTERIOR_FLOOR:
                return {
                    reflectivity: 0.8, // High reflectivity for interior surfaces
                    roughness: 0.2,    // Slightly rough surface
                    energyLoss: 0.2    // 20% energy loss per bounce
                };
            case SURFACE_TYPES.GLAZING:
                return {
                    reflectivity: 0.1, // Low reflectivity for glass
                    roughness: 0.05,   // Smooth surface
                    energyLoss: 0.9    // 90% energy loss (most light transmits)
                };
            case SURFACE_TYPES.FRAME:
                return {
                    reflectivity: 0.3, // Medium reflectivity for frames
                    roughness: 0.8,    // Rough surface
                    energyLoss: 0.7    // 70% energy loss
                };
            default:
                return {
                    reflectivity: 0.9, // High reflectivity
                    roughness: 0.1,    // Smooth surface
                    energyLoss: 0.1    // 10% energy loss
                };
        }
    }
}
import { sunRayObject } from './scene.js';

/**
 * Enhanced sun ray casting function with surface-aware physics
 * @param {THREE.Vector3} startPoint - Starting point of the ray
 * @param {THREE.Vector3} direction - Direction vector of the sun rays
 * @param {Array} sceneObjects - Array of objects to test collisions against
 * @param {number} maxBounces - Maximum number of interior bounces
 * @returns {Object|null} Ray path data or null if ray is blocked
 */
export function castSunRay(startPoint, direction, sceneObjects, maxBounces) {
    const raycaster = new THREE.Raycaster();
    const path = [startPoint];
    let bouncesLeft = maxBounces;
    let isInside = false;
    let lastHitObject = null;
    let entryPointIndex = -1;

   // Set initial ray
    raycaster.set(startPoint, direction);
    let currentRay = raycaster.ray.clone(); // MOVED: Initialize AFTER setting the raycaster

    // Main ray casting loop
    for (let j = 0; j < maxBounces + 10; j++) {
    const intersects = raycaster.intersectObjects(sceneObjects, true);

    // Find the first valid, non-self intersection on a mesh with a face
    const firstHit = intersects.find(hit =>
        hit.object !== lastHitObject &&
        hit.object.type === 'Mesh' && 
        hit.face
    );

    if (!firstHit) {
        // Ray exits the scene - if inside, add final segment
        if (isInside) {
                path.push(currentRay.origin.clone().add(currentRay.direction.clone().multiplyScalar(10)));
            }
            break;
        }

       path.push(firstHit.point);
    const hitObject = firstHit.object;
    lastHitObject = hitObject;

    // --- FIX: Ensure the intersection has a valid face before proceeding ---
    // If the hit is on a wireframe or other non-faced geometry, terminate the ray here.
    if (!firstHit.face) {
        break; 
    }

    // Classify the surface to determine ray behavior
    const surfaceType = SurfaceClassifier.classifySurface(hitObject, firstHit.point, isInside);
        const rayBehavior = SurfaceClassifier.getRayBehavior(surfaceType);

        switch (rayBehavior) {
            case RAY_BEHAVIOR.TRANSMIT:
                // Ray passes through (glazing)
                if (!isInside) {
                    // Entering interior space
                    isInside = true;
                    entryPointIndex = path.length - 1;
                    const exitPoint = firstHit.point.clone().add(currentRay.direction.clone().multiplyScalar(0.001));
                    raycaster.set(exitPoint, currentRay.direction);
                    currentRay = raycaster.ray.clone();
                } else {
                    // Already inside, continue through
                    const continuePoint = firstHit.point.clone().add(currentRay.direction.clone().multiplyScalar(0.001));
                    raycaster.set(continuePoint, currentRay.direction);
                    currentRay = raycaster.ray.clone();
                }
                break;

            case RAY_BEHAVIOR.REFLECT:
                // Ray reflects off interior surface
                if (isInside) {
                    if (bouncesLeft <= 0) {
                        // No more bounces allowed
                        return {
                            path: path,
                            entryPointIndex: entryPointIndex,
                            terminated: true
                        };
                    }
                    bouncesLeft--;

                    // Get reflection properties for this surface type
                    const reflectionProps = SurfaceClassifier.getReflectionProperties(surfaceType);

                    // Calculate reflection with surface roughness
                    const normal = firstHit.face.normal.clone().transformDirection(hitObject.matrixWorld);
                    const incidentDir = currentRay.direction.clone().normalize();
                    const perfectReflection = incidentDir.clone().reflect(normal);
                    let reflectedDir = perfectReflection.clone(); // Start with a perfect reflection

                    // Add surface roughness effect by perturbing the reflection vector
                    const roughnessFactor = reflectionProps.roughness;
                    if (roughnessFactor > 0) {
                        const randomPerturbation = new THREE.Vector3(
                            (Math.random() - 0.5),
                            (Math.random() - 0.5),
                            (Math.random() - 0.5)
                        ).normalize().multiplyScalar(roughnessFactor);

                        reflectedDir.add(randomPerturbation).normalize();

                        // Ensure the perturbed vector still points away from the surface
                        if (reflectedDir.dot(normal) < 0) {
                            reflectedDir.reflect(normal); // Re-reflect if it ends up pointing inwards
                        }
                    }

                    // Energy loss is a photometric property, not geometric. For visualization,
                    // we just need the new direction.
                    const newOrigin = firstHit.point.clone().add(reflectedDir.clone().multiplyScalar(0.001));
                    raycaster.set(newOrigin, reflectedDir);
                    currentRay = raycaster.ray.clone();
                } else {
                    // Exterior surface - ray should not reach here if properly blocked
                    return null;
                }
                break;

            case RAY_BEHAVIOR.BLOCK:
                // Ray is blocked (shading devices, frames, exterior surfaces)
                // For visualization, we want to show the ray up to the blocking point.
                j = maxBounces + 10; // Force loop exit to return the current path
                break;

            default:
                // Unknown behavior - block by default
                return null;
        }
    }

    // Return ray path data
    return {
        path: path,
        entryPointIndex: entryPointIndex,
        terminated: bouncesLeft < maxBounces
    };
}

/**
 * Calculates sun position from EPW location data and time.
 * @param {number} latitude Degrees.
 * @param {number} longitude Degrees.
 * @param {number} timeZone Offset from UTC.
 * @param {Date} date Full date object.
 * @param {number} hour Hour of the day (0-23).
 * @param {number} minute Minute of the hour (0-59).
 * @returns {{azimuth: number, altitude: number}} Angles in degrees.
 */
function calculateSunPosition(latitude, longitude, timeZone, date, hour, minute) {
    const dayOfYear = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / (1000 * 60 * 60 * 24));
    const latRad = THREE.MathUtils.degToRad(latitude);

    const B = THREE.MathUtils.degToRad((360 / 365) * (dayOfYear - 81));
    const equationOfTime = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
    const localStandardTimeMeridian = 15 * timeZone;
    const timeCorrection = 4 * (longitude - localStandardTimeMeridian) + equationOfTime;
    const localSolarTime = hour + minute / 60 + timeCorrection / 60;
    const hourAngle = 15 * (localSolarTime - 12);
    const hourAngleRad = THREE.MathUtils.degToRad(hourAngle);
    const declinationRad = THREE.MathUtils.degToRad(23.45 * Math.sin(B));

    const altitudeRad = Math.asin(Math.sin(declinationRad) * Math.sin(latRad) + Math.cos(declinationRad) * Math.cos(latRad) * Math.cos(hourAngleRad));
    const cosAzimuth = (Math.sin(declinationRad) * Math.cos(latRad) - Math.cos(declinationRad) * Math.sin(latRad) * Math.cos(hourAngleRad)) / Math.cos(altitudeRad);
    const azimuthRad = Math.acos(Math.max(-1, Math.min(1, cosAzimuth)));

    let azimuthDeg = THREE.MathUtils.radToDeg(azimuthRad);
    if (hourAngle > 0) {
        azimuthDeg = 360 - azimuthDeg;
    }

    return {
        altitude: THREE.MathUtils.radToDeg(altitudeRad),
        azimuth: azimuthDeg,
    };
}

/**
 * Parses EPW file content to find sun position for a given date and time.
 * @param {string} epwContent The full string content of the .epw file.
 * @param {Date} date The requested date.
 * @param {string} time The requested time in HH:MM format.
 * @returns {{azimuth: number, altitude: number}|null} Sun position or null if not found.
 */
function getSunPositionFromEpw(epwContent, date, time) {
    if (!epwContent) return null;

    const [hourStr, minuteStr] = time.split(':');
    const hour = parseInt(hourStr, 10);
    const minute = parseInt(minuteStr, 10);

    const lines = epwContent.split('\n');
    const locationLine = lines.find(l => l.startsWith('LOCATION'));
    if (locationLine) {
        const locParts = locationLine.split(',');
        const lat = parseFloat(locParts[6]);
        const lon = parseFloat(locParts[7]);
        const tz = parseFloat(locParts[8]);
        return calculateSunPosition(lat, lon, tz, date, hour, minute);
    }
    return null;
}

/**
 * Converts solar angles (altitude, azimuth) to a Three.js direction vector.
 * @param {number} altitude Angle in degrees from the horizon.
 * @param {number} azimuth Angle in degrees clockwise from North.
 * @returns {THREE.Vector3} The direction vector FROM which the sun is shining.
 */
function getSunDirection(altitude, azimuth) {
    const altRad = THREE.MathUtils.degToRad(altitude);
    const aziRad = THREE.MathUtils.degToRad(azimuth);
    const sunDir = new THREE.Vector3(
        -Math.cos(altRad) * Math.sin(aziRad),
        Math.sin(altRad),
        -Math.cos(altRad) * Math.cos(aziRad)
    );
    return sunDir.normalize();
}

/**
 * Clears previously traced rays from the scene.
 */
function clearRays() {
    while (sunRayObject.children.length > 0) {
        const child = sunRayObject.children[0];
        sunRayObject.remove(child);
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
    }
}

/**
 * Main function to orchestrate the sun ray tracing.
* @param {object} params - The parameters for the tracing operation.
*/
export function traceSunRays(params) {
clearRays();

const { epwContent, date, time, rayCount, maxBounces, W, L, H, rotationY } = params;

const sunPos = getSunPositionFromEpw(epwContent, date, time);
if (!sunPos || sunPos.altitude <= 0) {
// Not showing an alert here as it can be disruptive.
// The calling function in ui.js can handle user notification if desired.
console.warn("Sun is below the horizon at the specified time.");
        return;
    }

    const sunDirection = getSunDirection(sunPos.altitude, sunPos.azimuth);

    // --- CORRECTED METHOD: Define emission plane based on core room dimensions ---
    const center = new THREE.Vector3(0, H / 2, 0);
    const rotationRadians = THREE.MathUtils.degToRad(rotationY);
    center.applyAxisAngle(new THREE.Vector3(0, 1, 0), rotationRadians); // Apply room rotation

    const radius = Math.sqrt(W*W + L*L + H*H) / 2;

    const planeOrigin = center.clone().add(sunDirection.clone().multiplyScalar(-radius * 1.5));
    const planeMesh = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2.5, radius * 2.5));
    planeMesh.lookAt(sunDirection.clone().add(planeOrigin));
    planeMesh.position.copy(planeOrigin);
    planeMesh.updateMatrixWorld();

    const exteriorRayMat = new THREE.LineBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.7 });
    const interiorRayMat = new THREE.LineBasicMaterial({ color: 0xffa500, transparent: true, opacity: 0.9, depthTest: false });
    const raycaster = new THREE.Raycaster();
    const sceneObjects = [roomObject, shadingObject];

    for (let i = 0; i < rayCount; i++) {
        const startPoint = new THREE.Vector3(
            (Math.random() - 0.5) * radius * 2.5,
            (Math.random() - 0.5) * radius * 2.5,
            0
        ).applyMatrix4(planeMesh.matrixWorld);

// Cast sun ray with enhanced surface-aware logic
const rayResult = castSunRay(startPoint, sunDirection, sceneObjects, maxBounces);

// Process and visualize rays based on their path and interaction
if (rayResult && rayResult.path.length > 1) {
    const { path, entryPointIndex } = rayResult;

    if (entryPointIndex !== -1) {
        // Ray entered interior - visualize both exterior and interior segments
        const exteriorPoints = path.slice(0, entryPointIndex + 1); // Include entry point in both segments
        const interiorPoints = path.slice(entryPointIndex);
        
        // Add exterior ray segment if it has length
        if (exteriorPoints.length > 1) {
            sunRayObject.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(exteriorPoints), exteriorRayMat));
        }
        
        // Add interior ray segment if it has length
        if (interiorPoints.length > 1) {
            sunRayObject.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(interiorPoints), interiorRayMat));
        }
    } else {
        // Ray was blocked before entering interior - visualize exterior segment only
        if (path.length > 1) {
            sunRayObject.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(path), exteriorRayMat));
        }
    }
}
}
}
