// scripts/radiance.js

import { getAllWindowParams, getAllShadingParams, getSensorGridParams } from './ui.js';
import { getDom } from './dom.js';
import { project } from './project.js';
import * as THREE from 'three';
import { shadingObject } from './geometry.js';

// Klems Full Basis outgoing angles (patch centres), 145 bins.
// Polar bands and azimuth counts taken from Radiance's klems_full.cal:
//   kpola = 5 15 25 35 45 55 65 75 90, knaz = 1 8 16 20 24 24 24 16 12 (Nkbins = 145).
// theta is the band centre, phi the bin centre (bin j is centred on j * 360 / knaz).
const KLEMS_ANGLES = [
    { theta: 0, phi: 0, patch: 1 }, { theta: 10, phi: 0, patch: 8 }, { theta: 10, phi: 45, patch: 8 },
    { theta: 10, phi: 90, patch: 8 }, { theta: 10, phi: 135, patch: 8 }, { theta: 10, phi: 180, patch: 8 },
    { theta: 10, phi: 225, patch: 8 }, { theta: 10, phi: 270, patch: 8 }, { theta: 10, phi: 315, patch: 8 },
    { theta: 20, phi: 0, patch: 16 }, { theta: 20, phi: 22.5, patch: 16 }, { theta: 20, phi: 45, patch: 16 },
    { theta: 20, phi: 67.5, patch: 16 }, { theta: 20, phi: 90, patch: 16 }, { theta: 20, phi: 112.5, patch: 16 },
    { theta: 20, phi: 135, patch: 16 }, { theta: 20, phi: 157.5, patch: 16 }, { theta: 20, phi: 180, patch: 16 },
    { theta: 20, phi: 202.5, patch: 16 }, { theta: 20, phi: 225, patch: 16 }, { theta: 20, phi: 247.5, patch: 16 },
    { theta: 20, phi: 270, patch: 16 }, { theta: 20, phi: 292.5, patch: 16 }, { theta: 20, phi: 315, patch: 16 },
    { theta: 20, phi: 337.5, patch: 16 }, { theta: 30, phi: 0, patch: 20 }, { theta: 30, phi: 18, patch: 20 },
    { theta: 30, phi: 36, patch: 20 }, { theta: 30, phi: 54, patch: 20 }, { theta: 30, phi: 72, patch: 20 },
    { theta: 30, phi: 90, patch: 20 }, { theta: 30, phi: 108, patch: 20 }, { theta: 30, phi: 126, patch: 20 },
    { theta: 30, phi: 144, patch: 20 }, { theta: 30, phi: 162, patch: 20 }, { theta: 30, phi: 180, patch: 20 },
    { theta: 30, phi: 198, patch: 20 }, { theta: 30, phi: 216, patch: 20 }, { theta: 30, phi: 234, patch: 20 },
    { theta: 30, phi: 252, patch: 20 }, { theta: 30, phi: 270, patch: 20 }, { theta: 30, phi: 288, patch: 20 },
    { theta: 30, phi: 306, patch: 20 }, { theta: 30, phi: 324, patch: 20 }, { theta: 30, phi: 342, patch: 20 },
    { theta: 40, phi: 0, patch: 24 }, { theta: 40, phi: 15, patch: 24 }, { theta: 40, phi: 30, patch: 24 },
    { theta: 40, phi: 45, patch: 24 }, { theta: 40, phi: 60, patch: 24 }, { theta: 40, phi: 75, patch: 24 },
    { theta: 40, phi: 90, patch: 24 }, { theta: 40, phi: 105, patch: 24 }, { theta: 40, phi: 120, patch: 24 },
    { theta: 40, phi: 135, patch: 24 }, { theta: 40, phi: 150, patch: 24 }, { theta: 40, phi: 165, patch: 24 },
    { theta: 40, phi: 180, patch: 24 }, { theta: 40, phi: 195, patch: 24 }, { theta: 40, phi: 210, patch: 24 },
    { theta: 40, phi: 225, patch: 24 }, { theta: 40, phi: 240, patch: 24 }, { theta: 40, phi: 255, patch: 24 },
    { theta: 40, phi: 270, patch: 24 }, { theta: 40, phi: 285, patch: 24 }, { theta: 40, phi: 300, patch: 24 },
    { theta: 40, phi: 315, patch: 24 }, { theta: 40, phi: 330, patch: 24 }, { theta: 40, phi: 345, patch: 24 },
    { theta: 50, phi: 0, patch: 24 }, { theta: 50, phi: 15, patch: 24 }, { theta: 50, phi: 30, patch: 24 },
    { theta: 50, phi: 45, patch: 24 }, { theta: 50, phi: 60, patch: 24 }, { theta: 50, phi: 75, patch: 24 },
    { theta: 50, phi: 90, patch: 24 }, { theta: 50, phi: 105, patch: 24 }, { theta: 50, phi: 120, patch: 24 },
    { theta: 50, phi: 135, patch: 24 }, { theta: 50, phi: 150, patch: 24 }, { theta: 50, phi: 165, patch: 24 },
    { theta: 50, phi: 180, patch: 24 }, { theta: 50, phi: 195, patch: 24 }, { theta: 50, phi: 210, patch: 24 },
    { theta: 50, phi: 225, patch: 24 }, { theta: 50, phi: 240, patch: 24 }, { theta: 50, phi: 255, patch: 24 },
    { theta: 50, phi: 270, patch: 24 }, { theta: 50, phi: 285, patch: 24 }, { theta: 50, phi: 300, patch: 24 },
    { theta: 50, phi: 315, patch: 24 }, { theta: 50, phi: 330, patch: 24 }, { theta: 50, phi: 345, patch: 24 },
    { theta: 60, phi: 0, patch: 24 }, { theta: 60, phi: 15, patch: 24 }, { theta: 60, phi: 30, patch: 24 },
    { theta: 60, phi: 45, patch: 24 }, { theta: 60, phi: 60, patch: 24 }, { theta: 60, phi: 75, patch: 24 },
    { theta: 60, phi: 90, patch: 24 }, { theta: 60, phi: 105, patch: 24 }, { theta: 60, phi: 120, patch: 24 },
    { theta: 60, phi: 135, patch: 24 }, { theta: 60, phi: 150, patch: 24 }, { theta: 60, phi: 165, patch: 24 },
    { theta: 60, phi: 180, patch: 24 }, { theta: 60, phi: 195, patch: 24 }, { theta: 60, phi: 210, patch: 24 },
    { theta: 60, phi: 225, patch: 24 }, { theta: 60, phi: 240, patch: 24 }, { theta: 60, phi: 255, patch: 24 },
    { theta: 60, phi: 270, patch: 24 }, { theta: 60, phi: 285, patch: 24 }, { theta: 60, phi: 300, patch: 24 },
    { theta: 60, phi: 315, patch: 24 }, { theta: 60, phi: 330, patch: 24 }, { theta: 60, phi: 345, patch: 24 },
    { theta: 70, phi: 0, patch: 16 }, { theta: 70, phi: 22.5, patch: 16 }, { theta: 70, phi: 45, patch: 16 },
    { theta: 70, phi: 67.5, patch: 16 }, { theta: 70, phi: 90, patch: 16 }, { theta: 70, phi: 112.5, patch: 16 },
    { theta: 70, phi: 135, patch: 16 }, { theta: 70, phi: 157.5, patch: 16 }, { theta: 70, phi: 180, patch: 16 },
    { theta: 70, phi: 202.5, patch: 16 }, { theta: 70, phi: 225, patch: 16 }, { theta: 70, phi: 247.5, patch: 16 },
    { theta: 70, phi: 270, patch: 16 }, { theta: 70, phi: 292.5, patch: 16 }, { theta: 70, phi: 315, patch: 16 },
    { theta: 70, phi: 337.5, patch: 16 }, { theta: 82.5, phi: 0, patch: 12 }, { theta: 82.5, phi: 30, patch: 12 },
    { theta: 82.5, phi: 60, patch: 12 }, { theta: 82.5, phi: 90, patch: 12 }, { theta: 82.5, phi: 120, patch: 12 },
    { theta: 82.5, phi: 150, patch: 12 }, { theta: 82.5, phi: 180, patch: 12 }, { theta: 82.5, phi: 210, patch: 12 },
    { theta: 82.5, phi: 240, patch: 12 }, { theta: 82.5, phi: 270, patch: 12 }, { theta: 82.5, phi: 300, patch: 12 },
    { theta: 82.5, phi: 330, patch: 12 }
];

const SPECTRAL_BINS = {
    'spectral-9': [
        { start: 380, end: 424 }, { start: 425, end: 454 }, { start: 455, end: 479 },
        { start: 480, end: 504 }, { start: 505, end: 529 }, { start: 530, end: 559 },
        { start: 560, end: 599 }, { start: 600, end: 644 }, { start: 645, end: 780 }
    ],
    'spectral-3': [
        // B, G, R order
        { start: 380, end: 498 }, { start: 498, end: 586 }, { start: 586, end: 780 }
    ]
};

/**
* Parses a two-column spectral data file and averages the values into discrete bins.
* @param {string} fileContent - The raw text content of the spectral data file.
* @param {string} [binConfigKey='spectral-9'] - The key for the binning configuration ('spectral-9' or 'spectral-3').
* @returns {number[]|null} An array of binned values, or null if parsing fails.
*/
export function _parseAndBinSpectralData(fileContent, binConfigKey = 'spectral-9') {
    if (!fileContent) return null;
    const bins = SPECTRAL_BINS[binConfigKey];
    if (!bins) return null;

    const lines = fileContent.split('\n').filter(line => line.trim() !== '' && !line.startsWith('#'));
    const dataPoints = lines.map(line => {
        const parts = line.trim().split(/\s+/);
        return {
            wavelength: parseFloat(parts[0]),
            value: parseFloat(parts[1])
        };
    }).filter(p => !isNaN(p.wavelength) && !isNaN(p.value));

    if (dataPoints.length === 0) return null;

    const binnedValues = bins.map(bin => {
        const valuesInBin = dataPoints.filter(p => p.wavelength >= bin.start && p.wavelength <= bin.end);
        if (valuesInBin.length === 0) {
            return 0; // Default to 0 if no data points fall within a bin.
        }
        const sum = valuesInBin.reduce((acc, p) => acc + p.value, 0);
        return sum / valuesInBin.length;
    });

    return binnedValues;
}


/**
 * Parses a BSDF XML file to extract Klems basis transmission data.
 * @param {string} xmlContent - The raw text content of the BSDF XML file.
 * @returns {object} A structured object with parsed BSDF data.
 */
export function _parseBsdfXml(xmlContent) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlContent, "text/xml");

    if (xmlDoc.getElementsByTagName("parsererror").length > 0) {
        throw new Error("Invalid XML format.");
    }

    const dataDefinition = xmlDoc.querySelector("DataDefinition");
    if (!dataDefinition) throw new Error("Could not find <DataDefinition> element.");

    const basisText = dataDefinition.querySelector("AngleBasis")?.textContent;
    if (!basisText || !basisText.includes("LBNL/Klems Full")) {
        throw new Error("Only 'LBNL/Klems Full' angle basis is currently supported.");
    }

    const incidentDataNodes = xmlDoc.querySelectorAll("IncidentData");
    const parsedData = {
        basis: basisText,
        data: []
    };

    incidentDataNodes.forEach(node => {
        const angleNode = node.querySelector("Angle");
        if (!angleNode) return;

        const thetaText = angleNode.querySelector("Theta")?.textContent;
        const phiText = angleNode.querySelector("Phi")?.textContent;
        const theta = thetaText != null ? parseFloat(thetaText) : NaN;
        const phi = phiText != null ? parseFloat(phiText) : NaN;
        if (isNaN(theta) || isNaN(phi)) return; // Skip entries with invalid angles

        const dataNode = node.querySelector('WavelengthData[Wavelength="Visible"] WavelengthDataBlock[WavelengthDataIdentifier="Transmission Front"]');
        if (!dataNode) return;

        const dataString = dataNode.textContent;
        const values = dataString.trim().split(/\s+/).map(parseFloat);

        if (values.length !== KLEMS_ANGLES.length) {
            console.warn(`[Radiance] Klems block has ${values.length} values, expected ${KLEMS_ANGLES.length} (full Klems basis). Skipping this incident angle.`);
        } else {
            const transmittanceData = values.map((value, i) => ({
                ...KLEMS_ANGLES[i],
                value
            }));

            parsedData.data.push({
                incoming: { theta, phi },
                transmittance: transmittanceData
            });
        }
    });

    // Sort incident angles for a clean UI dropdown
    parsedData.data.sort((a, b) => a.incoming.theta - b.incoming.theta || a.incoming.phi - b.incoming.phi);

    return parsedData;
}


/**
 * Generates a 6-sided box as a series of Radiance polygons.
 * @param {Array<Array<number>>} topVerts - An array of 4 vertices [x,y,z] for the top face.
 * @param {number} thickness - The thickness of the box.
 * @param {string} material - The name of the Radiance material to use.
 * @param {string} name - The base name for the polygon surfaces.
 * @param {function} transformFunc - The function to transform vertices to the final Radiance coordinate system.
 * @returns {string} A string containing the Radiance definitions for the 6 box faces.
 */

function transmittanceToTransmissivity(Tn) {
    // Radiance's `glass` primitive takes TRANSMISSIVITY, not transmittance. This is the
    // standard conversion from the Radiance reference manual for n = 1.52.
    //
    // The previous implementation used a hand-derived "Stokes" expression that was wrong by
    // roughly 11x: Tn 0.7 came out as 0.0659 instead of 0.7628, so every window was modelled
    // as nearly opaque and daylight factors came back around 0.03% instead of a few percent.
    // Reference check: clear single glazing Tn 0.88 must give tn ~ 0.96; this gives 0.958,
    // the old one gave 0.083.
    if (Tn <= 0) return 0;
    const tn = (Math.sqrt(0.8402528435 + 0.0072522239 * Tn * Tn) - 0.9166530661)
             / (0.0036261119 * Tn);
    // Transmissivity legitimately exceeds transmittance and can pass 1.0 for very clear
    // glazing, so only guard against negatives here.
    return Math.max(0, tn);
}

function generateRadBox(topVerts, thickness, material, name, transformFunc) {
    if (topVerts.length !== 4) return '';

    const v1t_vec = new THREE.Vector3().fromArray(topVerts[0]);
    const v2t_vec = new THREE.Vector3().fromArray(topVerts[1]);
    const v3t_vec = new THREE.Vector3().fromArray(topVerts[2]);
    const v4t_vec = new THREE.Vector3().fromArray(topVerts[3]);

    const H = new THREE.Vector3().subVectors(v2t_vec, v1t_vec);
    const D = new THREE.Vector3().subVectors(v4t_vec, v1t_vec);
    const normal = new THREE.Vector3().crossVectors(H, D).normalize();
    const thicknessVector = normal.clone().multiplyScalar(thickness);

    const v1b_vec = new THREE.Vector3().subVectors(v1t_vec, thicknessVector);
    const v2b_vec = new THREE.Vector3().subVectors(v2t_vec, thicknessVector);
    const v3b_vec = new THREE.Vector3().subVectors(v3t_vec, thicknessVector);
    const v4b_vec = new THREE.Vector3().subVectors(v4t_vec, thicknessVector);

    const v1t = v1t_vec.toArray(), v2t = v2t_vec.toArray(), v3t = v3t_vec.toArray(), v4t = v4t_vec.toArray();
    const v1b = v1b_vec.toArray(), v2b = v2b_vec.toArray(), v3b = v3b_vec.toArray(), v4b = v4b_vec.toArray();

    const f = (verts) => verts.map(v => transformFunc(v)).join('\n');
    let radString = `\n# Box: ${name}\n`;
    radString += `${material} polygon ${name}_top\n0\n0\n12\n` + f([v1t, v2t, v3t, v4t]) + `\n\n`;
    radString += `${material} polygon ${name}_bottom\n0\n0\n12\n` + f([v1b, v4b, v3b, v2b]) + `\n\n`;
    radString += `${material} polygon ${name}_front\n0\n0\n12\n` + f([v4t, v3t, v3b, v4b]) + `\n\n`;
    radString += `${material} polygon ${name}_back\n0\n0\n12\n` + f([v2t, v1t, v1b, v2b]) + `\n\n`;
    radString += `${material} polygon ${name}_left\n0\n0\n12\n` + f([v1t, v4t, v4b, v1b]) + `\n\n`;
    radString += `${material} polygon ${name}_right\n0\n0\n12\n` + f([v2t, v2b, v3b, v3t]) + `\n\n`;
    return radString;
}

/**
 * Generates an array of centered point coordinates along a single axis.
 * This is the single canonical implementation; the viewer (geometry.js) imports it so the
 * preview grid and the exported grid can never diverge.
 * @param {number} totalLength The total length of the surface.
 * @param {number} spacing The distance between points.
 * @returns {number[]} An array of coordinate values (empty when no point fits).
 */
export function generateCenteredPoints(totalLength, spacing) {
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
 * Transforms a point from local room coordinates to Radiance world coordinates.
 * This includes centering the room at the origin and rotating it.
 * The room's depth axis is negated so that the app's North (depth = 0) maps to
 * Radiance +Y (North). Composed with the local [width, depth, height] relabelling of the
 * Three.js frame, this is the shared map (x, y, z)_three -> (x, -z, y)_radiance, whose
 * determinant is +1, so handedness is preserved (no mirrored scene).
 * @param {Array<number>} localPoint - [x, y, z] in local room coords (width, depth, height).
 * @param {number} W - Room width.
 * @param {number} L - Room length.
 * @param {number} cosA - Cosine of the room orientation angle.
 * @param {number} sinA - Sine of the room orientation angle.
 * @returns {string} A formatted string "x y z" for Radiance.
 */
function transformAndFormatPoint(localPoint, W, L, cosA, sinA) {
    const p = { x: localPoint[0], y: localPoint[1], z: localPoint[2] };
    const centered_x = p.x - W / 2;
    const centered_y = L / 2 - p.y; // Depth -> Radiance +Y is North (depth 0 = North wall)
    const rx = centered_x * cosA - centered_y * sinA;
    const ry = centered_x * sinA + centered_y * cosA;
    return `${rx.toFixed(4)} ${ry.toFixed(4)} ${p.z.toFixed(4)}`; // Z is height
}

/**
 * Transforms a point from Three.js scene coordinates (Y-up) to a Radiance world coordinate array (Z-up).
 * Map: (x, y, z)_three -> (x, -z, y)_radiance. Determinant +1, so handedness and polygon
 * winding are preserved. The app's North is Three.js -Z (depth = 0), which lands on Radiance +Y.
 * @param {Array<number>} threePoint - An array representing the point in Three.js coordinates [X_width, Y_height, Z_depth].
 * @param {number} W - Room width.
 * @param {number} L - Room length.
 * @param {number} cosA - Cosine of the room orientation angle.
 * @param {number} sinA - Sine of the room orientation angle.
 * @returns {Array<number>} A Radiance coordinate array [rotated_x, rotated_y, height_z].
 */
export function transformThreePointToRadianceArray(threePoint, W, L, cosA, sinA) {
    const [threeX_width, threeY_height, threeZ_depth] = threePoint;

    // Center the point on Radiance's XY (ground) plane for rotation.
    // Depth is negated: Three.js -Z (North) -> Radiance +Y (North).
    const centered_x = threeX_width - W / 2;
    const centered_y = L / 2 - threeZ_depth; // Use negated Three.js Z (depth) for Radiance Y

    // Rotate around the Z-axis (up axis in Radiance)
    const rx = centered_x * cosA - centered_y * sinA;
    const ry = centered_x * sinA + centered_y * cosA;

    // Return the final Radiance coordinate array
    return [rx, ry, threeY_height];
}

/**
 * Transforms a vector from Three.js scene coordinates (Y-up) to a Radiance world vector array (Z-up).
 * Uses the same map as transformThreePointToRadianceArray: (x, y, z)_three -> (x, -z, y)_radiance,
 * so vectors and points stay consistent (determinant +1).
 * @param {Array<number>} threeVector - An array representing the vector in Three.js coordinates [x, y, z].
 * @param {number} cosA - Cosine of the room orientation angle.
 * @param {number} sinA - Sine of the room orientation angle.
 * @returns {Array<number>} A Radiance vector array [rotated_x, rotated_y, z].
 */
export function transformThreeVectorToRadianceArray(threeVector, cosA, sinA) {
    const [threeX, threeY, threeZ] = threeVector;

    // Map Three.js vector components [x, y_height, z_depth] to Radiance's [x, -z_depth, y_height]
    const rad_x = threeX;
    const rad_y_depth = -threeZ;
    const rad_z_height = threeY;

    // Rotate the vector components on the XY (ground) plane
    const rotatedX = rad_x * cosA - rad_y_depth * sinA;
    const rotatedY = rad_x * sinA + rad_y_depth * cosA;

    return [rotatedX, rotatedY, rad_z_height];
}

/**
 * Builds a formatter for points that are ALREADY in Three.js WORLD coordinates, i.e. the
 * viewer has already applied the room centering and the orientation rotation. Only the axis
 * map (x, y, z)_three -> (x, -z, y)_radiance is applied here (determinant +1), never a second
 * centering or rotation.
 * @param {number} [elevationOffset=0] - Room elevation to remove. The Radiance model always
 *   places the room floor at z = 0, while the viewer raises the elevated groups (room, shading,
 *   furniture, vegetation) by this amount.
 * @returns {function(Array<number>): string} A formatter returning "x y z" for Radiance.
 */
function makeWorldPointFormatter(elevationOffset = 0) {
    return (p) => `${p[0].toFixed(4)} ${(-p[2]).toFixed(4)} ${(p[1] - elevationOffset).toFixed(4)}`;
}

/**
 * Generates the content for a Radiance .vf (view file).
/**
 * Computes the horizontal field of view from a vertical FOV and image aspect ratio.
 * @param {number} vfov - Vertical field of view in degrees.
 * @param {number} aspect - Image aspect ratio (width / height).
 * @returns {number} Horizontal field of view in degrees.
 */
function computeHfovFromAspect(vfov, aspect) {
    if (!Number.isFinite(aspect) || aspect <= 0) return vfov;
    return 2 * Math.atan(Math.tan(vfov * Math.PI / 360) * aspect) * 180 / Math.PI;
}

/**
 * Reads the configured render aspect ratio (X resolution / Y resolution) from the UI.
 * Falls back to 1 (square) when the resolution inputs are unavailable.
 * @returns {number} The render aspect ratio (width / height).
 */
function getRenderAspect() {
    const dom = getDom();
    const x = parseFloat(dom['rpict-x']?.value);
    const y = parseFloat(dom['rpict-y']?.value);
    if (Number.isFinite(x) && Number.isFinite(y) && y > 0) return x / y;
    return 1;
}

/**
 * Determines the horizontal FOV for a given Radiance view type.
 * Perspective ('v') and cylindrical ('c') views derive their horizontal FOV from
 * the render aspect ratio; all other view types (including the fixed 180° fisheye
 * types) keep the horizontal FOV equal to the vertical FOV.
 * @param {string} viewType - The single-letter view type.
 * @param {number} vfov - The vertical field of view in degrees.
 * @returns {number} The horizontal field of view in degrees.
 */
function resolveHfov(viewType, vfov) {
    if (viewType === 'v' || viewType === 'c') {
        return computeHfovFromAspect(vfov, getRenderAspect());
    }
    return vfov;
}

/**
 * Picks a Radiance up-vector for a view direction. Radiance rejects a view whose up vector
 * is parallel to its view direction, which is exactly what the usual (0 0 1) is for a
 * straight-down or straight-up view; those fall back to +Y (north).
 * @param {Array<number>} radDir - The view direction in Radiance coordinates.
 * @returns {Array<number>} The up vector in Radiance coordinates.
 */
function resolveRadianceUpVector(radDir) {
    const [dx, dy, dz] = radDir;
    const len = Math.hypot(dx, dy, dz);
    if (len > 0 && Math.abs(dz / len) > 0.999) return [0, 1, 0];
    return [0, 0, 1];
}

/**
 * @param {object} viewpointData - The viewpoint data object from the project.
 * @param {object} roomData - The room geometry data object.
 * @returns {string} The content for the .vf file.
 */
export function generateViewpointFileContent(viewpointData, roomData) {
    const { 'view-type': viewType, 'view-pos-x': vpx, 'view-pos-y': vpy, 'view-pos-z': vpz, 'view-dir-x': vdx, 'view-dir-y': vdy, 'view-dir-z': vdz, 'view-fov': fov } = viewpointData;
    const { width: W, length: L, 'room-orientation': roomOrientation } = roomData;

    const alphaRad = THREE.MathUtils.degToRad(roomOrientation);
    const cosA = Math.cos(alphaRad);
    const sinA = Math.sin(alphaRad);

    const pos_Three = [vpx, vpy, vpz];
    const dir_Three = [vdx, vdy, vdz];

    const rad_vp_array = transformThreePointToRadianceArray(pos_Three, W, L, cosA, sinA);
    const rad_vd_array = transformThreeVectorToRadianceArray(dir_Three, cosA, sinA);

    const rad_vp = rad_vp_array.map(c => c.toFixed(4)).join(' ');
    const rad_vd = rad_vd_array.map(c => c.toFixed(4)).join(' ');

    const viewTypeMap = { 'v': '-vtv', 'h': '-vth', 'c': '-vtc', 'l': '-vtl', 'a': '-vta' };
    const radViewType = viewTypeMap[viewType] || '-vtv';

    const vfov = (viewType === 'h' || viewType === 'a') ? 180 : fov;
    const hfov = resolveHfov(viewType, vfov);

    const rad_vu = resolveRadianceUpVector(rad_vd_array).join(' ');

    return `${radViewType} -vp ${rad_vp} -vd ${rad_vd} -vu ${rad_vu} -vh ${hfov} -vv ${vfov}`;
}

/**
 * Finds a generative shading device group in the scene by its name.
 * @param {string} orientation - The wall orientation ('N', 'S', 'E', 'W').
 * @param {number} windowIndex - The index of the window on that wall.
 * @returns {THREE.Group|null} The found group or null.
 */
function getGenerativeDeviceFromScene(orientation, windowIndex) {
    const expectedName = `generative_${orientation}_${windowIndex}`;
    return shadingObject.getObjectByName(expectedName) || null;
}

/**
 * Generates Radiance primitives for simple generative patterns.
 * @param {string} patternType - The type of pattern ('vertical_fins', 'horizontal_fins', 'grid').
 * @param {object} parameters - The pattern's parameters.
 * @param {object} winParams - The window's parameters.
 * @param {string} orientation - The wall orientation.
 * @param {number} windowIndex - The index of the window.
 * @param {function} transformFunc - The function to transform vertices.
 * @returns {string} The Radiance geometry string.
 */
function generateSimpleGenerativePattern(patternType, parameters, winParams, orientation, windowIndex, transformFunc) {
    let radString = '';
    const { depth, spacingX, spacingY, elementWidth } = parameters;
    const { ww, wh, sh } = winParams;
    const winId = `${orientation}_${windowIndex + 1}`;

    const inwardNormal = { 'N': [0, 1, 0], 'S': [0, -1, 0], 'W': [1, 0, 0], 'E': [-1, 0, 0] }[orientation];

    // This is a simplified positioning logic. It assumes the generative pattern is centered on the window.
    // A more robust implementation would get the exact window position from the `allWindows` loop.
    const createFin = (u0, u1, v0, v1, finIndex, finType) => {
        const baseVerts = quadVerts(orientation, u0, u1, v0, v1);
        const depthVec = inwardNormal.map(n => n * -depth);
        const p1_hinge = [baseVerts[0][0], baseVerts[0][1], baseVerts[0][2]];
        const p2_hinge = [baseVerts[1][0], baseVerts[1][1], baseVerts[1][2]];
        const p3_outer = [p2_hinge[0] + depthVec[0], p2_hinge[1] + depthVec[1], p2_hinge[2] + depthVec[2]];
        const p4_outer = [p1_hinge[0] + depthVec[0], p1_hinge[1] + depthVec[1], p1_hinge[2] + depthVec[2]];
        const topVerts = [p1_hinge, p2_hinge, p3_outer, p4_outer];
        radString += generateRadBox(topVerts, elementWidth, 'shading_mat', `gen_${finType}_${winId}_${finIndex}`, transformFunc);
    };

    if (patternType === 'vertical_fins' || patternType === 'grid') {
        const numFins = Math.floor(ww / spacingX);
        for (let i = 0; i <= numFins; i++) {
            const u0 = i * spacingX - (elementWidth / 2);
            createFin(u0, u0 + elementWidth, sh, sh + wh, i, 'vfin');
        }
    }

    if (patternType === 'horizontal_fins' || patternType === 'grid') {
        const numFins = Math.floor(wh / spacingY);
        for (let i = 0; i <= numFins; i++) {
            const v0 = sh + i * spacingY - (elementWidth / 2);
            createFin(0, ww, v0, v0 + elementWidth, i, 'hfin');
        }
    }

    return radString;
}


export async function generateRadFileContent(options = {}) {
    const { channelSet, clippingPlanes } = options; // e.g., 'c1-3', 'c4-6', 'c7-9' for spectral runs
    const dom = getDom();
    const { currentImportedModel } = await import('./geometry.js');


    // --- Headers and Setup ---
    let geoHeader = `# Radiance scene geometry generated on ${new Date().toISOString()}\n`;
    geoHeader += `# Room Orientation: ${dom['room-orientation'].value} degrees from North (Radiance +Y)\n`;
    geoHeader += `# Coordinate System: Right-Handed, Z-up\n`;

    let matHeader = `# Radiance material definitions generated on ${new Date().toISOString()}\n\n`;

    let radMaterials = `# --- BASE MATERIAL DEFINITIONS ---\n`;
    let radGeometry = `\n# --- GEOMETRY ---\n`;
    let shadingGeometry = '\n# --- SHADING DEVICES ---\n';
    let dynamicMaterialDefs = '\n# --- DYNAMIC MATERIAL DEFINITIONS (e.g., roller shades) ---\n';

    // --- Material Generation ---
    function getMaterialDef(type) {
        const matName = `${type}_mat`;

        // Check if the main material type selector exists, use default if not
        const matTypeElement = dom[`${type}-mat-type`];
        const matType = matTypeElement ? matTypeElement.value.toLowerCase() : 'plastic';

        // Safely get spec and rough values with defaults
        const specElement = dom[`${type}-spec`];
        const roughElement = dom[`${type}-rough`];
        const spec = specElement ? parseFloat(specElement.value) : 0;
        const rough = roughElement ? parseFloat(roughElement.value) : 0;

        // Dynamically check for spectral mode for the given material type
        const modeElement = dom[`${type}-mode-srd`];
        const mode = modeElement?.classList.contains('active') ? 'srd' : 'refl';
        const spectralFileKey = `${type}-srd-file`;
        const spectralFile = project.simulationFiles[spectralFileKey];

        if ((type === 'wall' || type === 'floor' || type === 'ceiling') && mode === 'srd' && channelSet && spectralFile?.content) {
            const binnedValues = _parseAndBinSpectralData(spectralFile.content, 'spectral-9');

            if (binnedValues && binnedValues.length === 9) {
                let values;
                if (channelSet === 'c1-3') values = binnedValues.slice(0, 3);
                else if (channelSet === 'c4-6') values = binnedValues.slice(3, 6);
                else if (channelSet === 'c7-9') values = binnedValues.slice(6, 9);

                if (values) {
                    const [v1, v2, v3] = values.map(v => v.toFixed(4));
                    // Note: Uses the material type from the UI. Assumes plastic/metal are appropriate.
                    if (matType === 'plastic' || matType === 'metal') {
                        return `void ${matType} ${matName}\n0\n0\n5 ${v1} ${v2} ${v3} ${spec} ${rough}\n`;
                    }
                }
            }
        }

        // Fallback to original simple reflectance behavior with null check
        const reflElement = dom[`${type}-refl`];
        const refl = reflElement ? parseFloat(reflElement.value) : 0.5;

        switch (matType) {
            case 'plastic': return `void plastic ${matName}\n0\n0\n5 ${refl} ${refl} ${refl} ${spec} ${rough}\n`;
            case 'glass': return `void glass ${matName}\n0\n0\n3 ${refl} ${refl} ${refl}\n`;
            case 'metal': return `void metal ${matName}\n0\n0\n5 ${refl} ${refl} ${refl} ${spec} ${rough}\n`;
            default: return `void plastic ${matName}\n0\n0\n5 ${refl} ${refl} ${refl} ${spec} ${rough}\n`;
        }
    }

    radMaterials += getMaterialDef('wall');
    radMaterials += getMaterialDef('floor');
    radMaterials += getMaterialDef('ceiling');
    radMaterials += getMaterialDef('frame');
    radMaterials += getMaterialDef('shading');
    radMaterials += getMaterialDef('furniture');
    radMaterials += getMaterialDef('context');
    radMaterials += `void plastic ground_mat\n0\n0\n5 0.15 0.15 0.15 0 0\n\n`; // A dark, diffuse ground material
    radMaterials += `void trans vegetation_canopy_mat\n0\n0\n7 0.1 0.2 0.1 0 0.5 0.3 0\n\n`; // Green, diffuse, 30% transparent material for canopy

    const Tn = parseFloat(dom['glazing-trans'].value);
    const tn = transmittanceToTransmissivity(Tn);
    radMaterials += `void glass glass_mat\n0\n0\n3 ${tn} ${tn} ${tn}\n\n`;

    // --- Geometry Generation ---
    // Check if we have optimized geometry (Precedence 1)
    if (options.geometry && options.geometry.optimizedGeometry) {
        radGeometry += `\n# --- OPTIMIZED GEOMETRY ---\n`;
        const surfaceTypeToMaterialName = {
            'INTERIOR_WALL': 'wall_mat',
            'INTERIOR_FLOOR': 'floor_mat',
            'INTERIOR_CEILING': 'ceiling_mat',
            'GLAZING': 'glass_mat',
            'FRAME': 'frame_mat',
            'SHADING_DEVICE': 'shading_mat',
            'VEGETATION_CANOPY': 'vegetation_canopy_mat',
            'VEGETATION_TRUNK': 'furniture_mat',
            'EXTERIOR_WALL': 'wall_mat', // Fallback
            'EXTERIOR_FLOOR': 'floor_mat',
            'EXTERIOR_CEILING': 'ceiling_mat',
            'generic_wall': 'wall_mat', // Fallback for unmatched
            'context': 'context_mat',
            'furniture': 'furniture_mat'
        };

        // Transform from Three.js Y-up to Radiance Z-up
        const threeToRadTransform = makeWorldPointFormatter();

        options.geometry.optimizedGeometry.traverse(child => {
            if (child.isMesh) {
                // Fallback for material name if surfaceType is missing or custom
                let radMaterialName = 'wall_mat';
                const surfaceType = child.userData.surfaceType;

                if (surfaceType && surfaceTypeToMaterialName[surfaceType]) {
                    radMaterialName = surfaceTypeToMaterialName[surfaceType];
                } else if (child.userData.isFurniture) {
                    radMaterialName = 'furniture_mat';
                } else if (child.userData.isContext || child.userData.isMassingBlock) {
                    radMaterialName = 'context_mat';
                }

                // If specialized material/userData handling is needed, add here.

                radGeometry += _generateRadFromMesh(
                    child,
                    radMaterialName,
                    `${child.name || 'opt'}_${child.uuid.substring(0, 6)}`,
                    threeToRadTransform,
                    child.name // Use name as group hint if available
                );
            }
        });

        return {
            materials: matHeader + radMaterials + dynamicMaterialDefs,
            geometry: geoHeader + radGeometry
        };
    }

    // Check if we are in imported geometry mode (Precedence 2)
    if (currentImportedModel) {
        radGeometry += `\n# --- IMPORTED GEOMETRY ---\n`;

        const surfaceTypeToMaterialName = {
            'INTERIOR_WALL': 'wall_mat',
            'INTERIOR_FLOOR': 'floor_mat',
            'INTERIOR_CEILING': 'ceiling_mat',
            'GLAZING': 'glass_mat',
            'FRAME': 'frame_mat',
            'SHADING_DEVICE': 'shading_mat',
            'VEGETATION_CANOPY': 'vegetation_canopy_mat',
            'VEGETATION_TRUNK': 'furniture_mat',
        };
        // Transform from Three.js Y-up to Radiance Z-up
        const threeToRadTransform = makeWorldPointFormatter();

        currentImportedModel.traverse(child => {
            if (child.isMesh) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach(mat => {
                    const surfaceType = mat.userData.surfaceType;
                    const radMaterialName = surfaceTypeToMaterialName[surfaceType];

                    if (radMaterialName) {
                        radGeometry += _generateRadFromMesh(
                            child,
                            radMaterialName,
                            `${child.name || 'imported'}_${mat.name.replace(/\s/g, '_')}`,
                            threeToRadTransform,
                            mat.name
                        );
                    }
                });
            }
        });

        // Return early after processing the imported model
        return {
            materials: matHeader + radMaterials + dynamicMaterialDefs,
            geometry: geoHeader + radGeometry
        };
    }

    const W = parseFloat(dom.width.value), L = parseFloat(dom.length.value), H = parseFloat(dom.height.value);
    const allWindows = getAllWindowParams();
    const allShading = getAllShadingParams();

    const alphaRad = THREE.MathUtils.degToRad(parseFloat(dom['room-orientation'].value));
    const cosA = Math.cos(alphaRad);
    const sinA = Math.sin(alphaRad);
    const transformAndFormat = (p) => transformAndFormatPoint(p, W, L, cosA, sinA);
    // Objects taken straight out of the scene are already in Three.js world coordinates
    // (centered and rotated by the viewer), so they must NOT go through transformAndFormat,
    // which expects LOCAL [width, depth, height] coordinates. The viewer also raises those
    // groups by the room elevation, which the Radiance model does not use.
    const elevation = parseFloat(dom.elevation?.value) || 0;
    const worldTransform = makeWorldPointFormatter(elevation);
    const surfaceThickness = parseFloat(dom['surface-thickness']?.value) || 0.2;

    // --- Floor ---
    const floorTopVerts = [[0, 0, 0], [W, 0, 0], [W, L, 0], [0, L, 0]];
    radGeometry += generateRadBox(floorTopVerts, surfaceThickness, 'floor_mat', 'floor', transformAndFormat);

    // --- Ceiling ---
    // generateRadBox extrudes DOWNWARDS from the given face, so the top face is placed at
    // H + thickness to make the slab occupy [H, H + thickness]. This keeps the interior
    // ceiling plane exactly at H (matching the walls and the viewer, which also puts the
    // ceiling slab above H) and leaves the ceiling sensors at H + offset clear of the slab.
    const ceilTopVerts = [[0, 0, H + surfaceThickness], [W, 0, H + surfaceThickness], [W, L, H + surfaceThickness], [0, L, H + surfaceThickness]];
    radGeometry += generateRadBox(ceilTopVerts, surfaceThickness, 'ceiling_mat', 'ceiling', transformAndFormat);

    function quadVerts(orientation, u0, u1, v0, v1) {
        switch (orientation) {
            case 'N': return [[u0, 0, v0], [u1, 0, v0], [u1, 0, v1], [u0, 0, v1]];
            case 'S': return [[u1, L, v0], [u0, L, v0], [u0, L, v1], [u1, L, v1]];
            case 'W': return [[0, u1, v0], [0, u0, v0], [0, u0, v1], [0, u1, v1]];
            case 'E': return [[W, u0, v0], [W, u1, v0], [W, u1, v1], [W, u0, v1]];
        }
        return [];
    }

    function generateThickWall(orientation, wallWidth, windows) {
        let rad = '';
        const thickness = surfaceThickness;
        const normal = { 'N': [0, -1, 0], 'S': [0, 1, 0], 'W': [-1, 0, 0], 'E': [1, 0, 0] }[orientation];

        // Sort windows by horizontal position
        windows.sort((a, b) => a.u0 - b.u0);

        let last_u = 0;
        windows.forEach((win, i) => {
            // Wall segment before this window
            if (win.u0 > last_u) {
                const verts = quadVerts(orientation, last_u, win.u0, 0, H);
                rad += generateRadBox(verts, thickness, 'wall_mat', `wall_${orientation}_pier_${i}`, transformAndFormat);
            }
            // Wall segment below this window (sill)
            if (win.v0 > 0) {
                const verts = quadVerts(orientation, win.u0, win.u1, 0, win.v0);
                rad += generateRadBox(verts, thickness, 'wall_mat', `wall_${orientation}_sill_${i}`, transformAndFormat);
            }
            // Wall segment above this window (header)
            if (win.v1 < H) {
                const verts = quadVerts(orientation, win.u0, win.u1, win.v1, H);
                rad += generateRadBox(verts, thickness, 'wall_mat', `wall_${orientation}_header_${i}`, transformAndFormat);
            }
            last_u = win.u1;
        });

        // Final wall segment after all windows
        if (last_u < wallWidth) {
            const verts = quadVerts(orientation, last_u, wallWidth, 0, H);
            rad += generateRadBox(verts, thickness, 'wall_mat', `wall_${orientation}_pier_end`, transformAndFormat);
        }

        // If there are no windows, create a single solid wall
        if (windows.length === 0) {
            const verts = quadVerts(orientation, 0, wallWidth, 0, H);
            rad += generateRadBox(verts, thickness, 'wall_mat', `wall_${orientation}_solid`, transformAndFormat);
        }

        return rad;
    }

    const walls = { 'N': { width: W }, 'S': { width: W }, 'W': { width: L }, 'E': { width: L } };
    for (const orientation of Object.keys(walls)) {
        const winParams = allWindows[orientation];
        const { ww, wh, sh, wallWidth, winCount, mode } = winParams || {};

        let windowsU = [];
        if (ww > 0 && wh > 0 && winCount > 0) {
            const spacing = (mode === 'wwr') ? 0.1 : ww / 2;
            const groupWidth = (winCount * ww) + (Math.max(0, winCount - 1) * spacing);
            const startOffset = (wallWidth - groupWidth) / 2;
            for (let i = 0; i < winCount; i++) {
                const u0 = startOffset + i * (ww + spacing);
                const u1 = u0 + ww;
                windowsU.push({ u0, u1, v0: sh, v1: sh + wh });
            }
        }
        radGeometry += generateThickWall(orientation, wallWidth, windowsU);
    }

    // --- Generate Glazing and Frames ---
    const addFrame = dom['frame-toggle'].checked;
    const ft = addFrame ? parseFloat(dom['frame-thick'].value) : 0;
    const fd = addFrame ? parseFloat(dom['frame-depth'].value) : 0;

    for (const [orientation, winParams] of Object.entries(allWindows)) {
        const { ww, wh, sh, wallWidth, winCount, mode, winDepthPos } = winParams || {};
        if (!(ww > 0 && wh > 0 && winCount > 0)) continue;

        const spacing = (mode === 'wwr') ? 0.1 : ww / 2;
        const groupWidth = (winCount * ww) + (Math.max(0, winCount - 1) * spacing);
        const startOffset = (wallWidth - groupWidth) / 2;

        for (let i = 0; i < winCount; i++) {
            const winId = `${orientation}_${i + 1}`;
            const offset = startOffset + i * (ww + spacing);

            // 1. Glazing
            const glassWidth = Math.max(0, ww - 2 * ft);
            const glassHeight = Math.max(0, wh - 2 * ft);
            const glass_sh = sh + ft;
            const glass_offset = offset + ft;

            if (glassWidth > 0 && glassHeight > 0) {
                const p_gl_base = quadVerts(orientation, glass_offset, glass_offset + glassWidth, glass_sh, glass_sh + glassHeight);
                const inwardNormal = { 'N': [0, 1, 0], 'S': [0, -1, 0], 'W': [1, 0, 0], 'E': [-1, 0, 0] }[orientation];
                const depthVec = inwardNormal.map(n => n * (winDepthPos - (surfaceThickness / 2)));
                const p_gl = p_gl_base.map(v => [v[0] + depthVec[0], v[1] + depthVec[1], v[2] + depthVec[2]]);

                radGeometry += `\n# Glazing Pane ${winId}\n` +
                    `glass_mat polygon glazing_${winId}\n0\n0\n12\n` +
                    p_gl.map(v => transformAndFormat(v)).join('\n') + '\n';
            }

            // 2. Frame
            if (addFrame && ft > 0 && fd > 0) {
                const frame_u0 = offset;
                const frame_u1 = offset + ww;
                const frame_v0 = sh;
                const frame_v1 = sh + wh;
                const inwardNormal = { 'N': [0, 1, 0], 'S': [0, -1, 0], 'W': [1, 0, 0], 'E': [-1, 0, 0] }[orientation];
                const depthVec = inwardNormal.map(n => n * (winDepthPos - (surfaceThickness / 2) - fd / 2));


                // Frame Bottom
                const botVerts = quadVerts(orientation, frame_u0, frame_u1, frame_v0, frame_v0 + ft);
                const p_botVerts = botVerts.map(v => [v[0] + depthVec[0], v[1] + depthVec[1], v[2] + depthVec[2]]);
                shadingGeometry += generateRadBox(p_botVerts, fd, 'frame_mat', `frame_${winId}_bot`, transformAndFormat);
                // Frame Top
                const topVerts = quadVerts(orientation, frame_u0, frame_u1, frame_v1 - ft, frame_v1);
                const p_topVerts = topVerts.map(v => [v[0] + depthVec[0], v[1] + depthVec[1], v[2] + depthVec[2]]);
                shadingGeometry += generateRadBox(p_topVerts, fd, 'frame_mat', `frame_${winId}_top`, transformAndFormat);
                // Frame Left
                const leftVerts = quadVerts(orientation, frame_u0, frame_u0 + ft, frame_v0 + ft, frame_v1 - ft);
                const p_leftVerts = leftVerts.map(v => [v[0] + depthVec[0], v[1] + depthVec[1], v[2] + depthVec[2]]);
                shadingGeometry += generateRadBox(p_leftVerts, fd, 'frame_mat', `frame_${winId}_left`, transformAndFormat);
                // Frame Right
                const rightVerts = quadVerts(orientation, frame_u1 - ft, frame_u1, frame_v0 + ft, frame_v1 - ft);
                const p_rightVerts = rightVerts.map(v => [v[0] + depthVec[0], v[1] + depthVec[1], v[2] + depthVec[2]]);
                shadingGeometry += generateRadBox(p_rightVerts, fd, 'frame_mat', `frame_${winId}_right`, transformAndFormat);
            }
        }
    }

    // --- Generate Imported OBJ Shading ---
    // Find the Three.js objects for imported shading from the scene
    const { importedShadingObjects, furnitureObject, contextObject, vegetationObject } = await import('./geometry.js');
    importedShadingObjects.forEach((objGroup, index) => {
        // Traverse the group to find the actual mesh
        objGroup.traverse(child => {
            if (child.isMesh) {
                shadingGeometry += _generateRadFromMesh(child, 'shading_mat', `imported_obj_${index}`, worldTransform);
            }
        });
    });

    // --- Generate Furniture Geometry ---
    let furnitureGeometry = '\n# --- FURNITURE & PARTITIONS ---\n';
    if (furnitureObject.children.length > 0) {
        const furnitureContainer = furnitureObject.children[0];
        furnitureContainer.children.forEach((item, index) => {
            // Each child is either a single mesh or a group of meshes (imported assets)
            item.traverse(mesh => {
                if (!mesh.isMesh) return;
                furnitureGeometry += _generateRadFromMesh(mesh, 'furniture_mat', `${item.userData.assetType}_${index}`, worldTransform);
            });
        });
    }

    // --- Generate Vegetation Geometry ---
    let vegetationGeometry = '\n# --- VEGETATION & TREES ---\n';
    if (vegetationObject.children.length > 0) {
        const vegetationContainer = vegetationObject.children[0];
        vegetationContainer.children.forEach((treeGroup, index) => {
            // Each child is a group containing trunk and canopy meshes
            treeGroup.traverse(mesh => {
                if (!mesh.isMesh) return;
                const surfaceType = mesh.userData.surfaceType;
                const radMaterialName = surfaceType === 'VEGETATION_CANOPY' ? 'vegetation_canopy_mat' : 'furniture_mat';
                vegetationGeometry += _generateRadFromMesh(mesh, radMaterialName, `${treeGroup.userData.assetType}_${index}`, worldTransform);
            });
        });
    }


    for (const [orientation, winParams] of Object.entries(allWindows)) {
        const { ww, wh, sh, wallWidth, winCount, mode } = winParams || {};
        if (!(ww > 0 && wh > 0 && winCount > 0)) continue;
        const spacing = (mode === 'wwr') ? 0.1 : ww / 2;
        const groupWidth = (winCount * ww) + (Math.max(0, winCount - 1) * spacing);
        const startOffset = (wallWidth - groupWidth) / 2;
        const shadeParams = allShading[orientation];
        if (!shadeParams) continue;

        for (let i = 0; i < winCount; i++) {
            const offset = startOffset + i * (ww + spacing);
            const winId = `${orientation}_${i + 1}`;

            if (shadeParams.type === 'overhang' && shadeParams.overhang) {
                const { depth, tilt, distAbove, extension, thick } = shadeParams.overhang;
                if (thick > 0 && depth > 0) {
                    const hingeY = sh + wh + distAbove;
                    const hingeVerts = quadVerts(orientation, offset - extension, offset + ww + extension, hingeY, hingeY);
                    const p1_hinge = [hingeVerts[0][0], hingeVerts[0][1], hingeVerts[0][2]];
                    const p2_hinge = [hingeVerts[1][0], hingeVerts[1][1], hingeVerts[1][2]];
                    const tiltRad = THREE.MathUtils.degToRad(-tilt);
                    const dv = depth * Math.sin(tiltRad);
                    const dh = depth * Math.cos(tiltRad);
                    let p3_outer, p4_outer;
                    if (orientation === 'N') { p3_outer = [p2_hinge[0], p2_hinge[1] - dh, p2_hinge[2] + dv]; p4_outer = [p1_hinge[0], p1_hinge[1] - dh, p1_hinge[2] + dv]; }
                    else if (orientation === 'S') { p3_outer = [p2_hinge[0], p2_hinge[1] + dh, p2_hinge[2] + dv]; p4_outer = [p1_hinge[0], p1_hinge[1] + dh, p1_hinge[2] + dv]; }
                    else if (orientation === 'W') { p3_outer = [p2_hinge[0] - dh, p2_hinge[1], p2_hinge[2] + dv]; p4_outer = [p1_hinge[0] - dh, p1_hinge[1], p1_hinge[2] + dv]; }
                    else { p3_outer = [p2_hinge[0] + dh, p2_hinge[1], p2_hinge[2] + dv]; p4_outer = [p1_hinge[0] + dh, p1_hinge[1], p1_hinge[2] + dv]; }
                    const topVerts = [p1_hinge, p2_hinge, p3_outer, p4_outer];
                    shadingGeometry += generateRadBox(topVerts, thick, 'shading_mat', `overhang_${winId}`, transformAndFormat);
                }
            } else if (shadeParams.type === 'lightshelf' && shadeParams.lightshelf) {
                const { placeExt, placeInt, placeBoth, depthExt, depthInt, tiltExt, tiltInt, distBelowExt, distBelowInt, thickExt, thickInt } = shadeParams.lightshelf;
                const createShelf = (isExt) => {
                    const depth = isExt ? depthExt : depthInt, thick = isExt ? thickExt : thickInt, tilt = isExt ? tiltExt : tiltInt, distBelow = isExt ? distBelowExt : distBelowInt;
                    if (depth <= 0 || thick <= 0) return;
                    const hingeY = sh + wh - distBelow;
                    const hingeVerts = quadVerts(orientation, offset, offset + ww, hingeY, hingeY);
                    const p1_hinge = [hingeVerts[0][0], hingeVerts[0][1], hingeVerts[0][2]];
                    const p2_hinge = [hingeVerts[1][0], hingeVerts[1][1], hingeVerts[1][2]];
                    const z_dir = isExt ? -1 : 1;
                    const tiltRad = THREE.MathUtils.degToRad(-tilt);
                    const dv = depth * Math.sin(tiltRad), dh = depth * Math.cos(tiltRad) * z_dir;
                    let p3_outer, p4_outer;
                    if (orientation === 'N') { p3_outer = [p2_hinge[0], p2_hinge[1] + dh, p2_hinge[2] + dv]; p4_outer = [p1_hinge[0], p1_hinge[1] + dh, p1_hinge[2] + dv]; }
                    else if (orientation === 'S') { p3_outer = [p2_hinge[0], p2_hinge[1] - dh, p2_hinge[2] + dv]; p4_outer = [p1_hinge[0], p1_hinge[1] - dh, p1_hinge[2] + dv]; }
                    else if (orientation === 'W') { p3_outer = [p2_hinge[0] + dh, p2_hinge[1], p2_hinge[2] + dv]; p4_outer = [p1_hinge[0] + dh, p1_hinge[1], p1_hinge[2] + dv]; }
                    else { p3_outer = [p2_hinge[0] - dh, p2_hinge[1], p2_hinge[2] + dv]; p4_outer = [p1_hinge[0] - dh, p1_hinge[1], p1_hinge[2] + dv]; }
                    const topVerts = [p1_hinge, p2_hinge, p3_outer, p4_outer];
                    shadingGeometry += generateRadBox(topVerts, thick, 'shading_mat', `lightshelf_${isExt ? 'e' : 'i'}_${winId}`, transformAndFormat);
                };
                if (placeExt || placeBoth) createShelf(true);
                if (placeInt || placeBoth) createShelf(false);
            } else if (shadeParams.type === 'louver' && shadeParams.louver) {
                const { isExterior, isHorizontal, slatWidth, slatSep, slatThick, slatAngle, distToGlass } = shadeParams.louver;
                if (slatWidth <= 0 || slatSep <= 0 || slatThick <= 0) continue;
                const inwardNormal = { 'N': [0, 1, 0], 'S': [0, -1, 0], 'W': [1, 0, 0], 'E': [-1, 0, 0] }[orientation];
                const zOffsetVec = inwardNormal.map(n => n * (isExterior ? -distToGlass : distToGlass));
                if (isHorizontal) {
                    const numSlats = Math.floor(wh / slatSep);
                    for (let j = 0; j < numSlats; j++) {
                        const slatY = sh + j * slatSep + slatSep / 2;
                        const hingeVerts = quadVerts(orientation, offset, offset + ww, slatY, slatY);
                        const p1_hinge = [hingeVerts[0][0], hingeVerts[0][1], hingeVerts[0][2]];
                        const p2_hinge = [hingeVerts[1][0], hingeVerts[1][1], hingeVerts[1][2]];
                        const center = p1_hinge.map((c, i) => (c + p2_hinge[i]) / 2 + zOffsetVec[i]);
                        const angleRad = THREE.MathUtils.degToRad(-slatAngle);
                        const dv = slatWidth / 2 * Math.sin(angleRad), dh = slatWidth / 2 * Math.cos(angleRad);
                        let p_front1, p_front2, p_back1, p_back2;
                        if (orientation === 'N' || orientation === 'S') {
                            p_front1 = [center[0] - ww / 2, center[1] - dh, center[2] + dv];
                            p_front2 = [center[0] + ww / 2, center[1] - dh, center[2] + dv];
                            p_back1 = [center[0] - ww / 2, center[1] + dh, center[2] - dv];
                            p_back2 = [center[0] + ww / 2, center[1] + dh, center[2] - dv];
                        } else { // E or W
                            p_front1 = [center[0] - dh, center[1] - ww / 2, center[2] + dv];
                            p_front2 = [center[0] - dh, center[1] + ww / 2, center[2] + dv];
                            p_back1 = [center[0] + dh, center[1] - ww / 2, center[2] - dv];
                            p_back2 = [center[0] + dh, center[1] + ww / 2, center[2] - dv];
                        }
                        shadingGeometry += generateRadBox([p_back1, p_back2, p_front2, p_front1], slatThick, 'shading_mat', `louver_${winId}_${j}`, transformAndFormat);
                    }
                } else { // Vertical
                    const numSlats = Math.floor(ww / slatSep);
                    for (let j = 0; j < numSlats; j++) {
                        const slatU = offset + j * slatSep + slatSep / 2;
                        const hingeVerts = quadVerts(orientation, slatU, slatU, sh, sh + wh);
                        const p1_hinge = [hingeVerts[0][0], hingeVerts[0][1], hingeVerts[0][2]];
                        const p2_hinge = [hingeVerts[3][0], hingeVerts[3][1], hingeVerts[3][2]];
                        const center = p1_hinge.map((c, i) => (c + p2_hinge[i]) / 2 + zOffsetVec[i]);
                        const angleRad = THREE.MathUtils.degToRad(slatAngle);
                        const p_front = new THREE.Vector3(), p_back = new THREE.Vector3();
                        const dx = slatWidth / 2 * Math.cos(angleRad);
                        const dy = slatWidth / 2 * Math.sin(angleRad);

                        if (orientation === 'N' || orientation === 'S') {
                            p_front.set(center[0] - dx, center[1] - dy, center[2]);
                            p_back.set(center[0] + dx, center[1] + dy, center[2]);
                        } else { // E or W
                            p_front.set(center[0] - dy, center[1] + dx, center[2]);
                            p_back.set(center[0] + dy, center[1] - dx, center[2]);
                        }
                        const topVerts = [
                            [p_back.x, p_back.y, center[2] - wh / 2],
                            [p_back.x, p_back.y, center[2] + wh / 2],
                            [p_front.x, p_front.y, center[2] + wh / 2],
                            [p_front.x, p_front.y, center[2] - wh / 2]
                        ];
                        shadingGeometry += generateRadBox(topVerts, slatThick, 'shading_mat', `louver_${winId}_${j}`, transformAndFormat);
                    }
                }
            } else if (shadeParams.type === 'roller' && shadeParams.roller) {
                const { visRefl, visTrans, solarRefl, solarTrans, topOpening, bottomOpening, leftOpening, rightOpening, distToGlass, thickness } = shadeParams.roller;
                if (thickness <= 0) continue;
                const matName = `roller_mat_${winId}`;
                // A physically-based BRTDfunc is more accurate for diffuse shades than 'trans'.
                // This assumes 0 specular reflection/transmission and uses the visible diffuse
                // components for both reflection (Rdiff) and transmission (Tdiff).
                dynamicMaterialDefs += `void BRTDfunc ${matName}\n0\n0\n12 0 0 0 0 0 0 ${visRefl} ${visRefl} ${visRefl} ${visTrans} ${visTrans} ${visTrans}\n\n`;
                const rollerWidth = ww - leftOpening - rightOpening;
                const rollerHeight = wh - topOpening - bottomOpening;
                if (rollerWidth <= 0 || rollerHeight <= 0) continue;
                const u0 = offset + leftOpening, u1 = u0 + rollerWidth, v0 = sh + bottomOpening, v1 = v0 + rollerHeight;
                const innerVerts = quadVerts(orientation, u0, u1, v0, v1);
                const inwardNormal = { 'N': [0, 1, 0], 'S': [0, -1, 0], 'W': [1, 0, 0], 'E': [-1, 0, 0] }[orientation];
                const distVec = inwardNormal.map(n => n * distToGlass);
                const p = innerVerts.map(v => [v[0] + distVec[0], v[1] + distVec[1], v[2] + distVec[2]]);
                const thickVec = inwardNormal.map(n => n * thickness);
                const q = p.map(v => [v[0] + thickVec[0], v[1] + thickVec[1], v[2] + thickVec[2]]);
                shadingGeometry += `\n# Roller Shade: ${winId}\n`;
                shadingGeometry += `${matName} polygon roller_${winId}_front\n0\n0\n12\n${[q[0], q[3], q[2], q[1]].map(v => transformAndFormat(v)).join('\n')}\n\n`;
                shadingGeometry += `${matName} polygon roller_${winId}_back\n0\n0\n12\n${[p[0], p[1], p[2], p[3]].map(v => transformAndFormat(v)).join('\n')}\n\n`;
                shadingGeometry += `${matName} polygon roller_${winId}_bottom\n0\n0\n12\n${[p[0], q[0], q[1], p[1]].map(v => transformAndFormat(v)).join('\n')}\n\n`;
                shadingGeometry += `${matName} polygon roller_${winId}_right\n0\n0\n12\n${[p[1], q[1], q[2], p[2]].map(v => transformAndFormat(v)).join('\n')}\n\n`;
                shadingGeometry += `${matName} polygon roller_${winId}_top\n0\n0\n12\n${[p[2], q[2], q[3], p[3]].map(v => transformAndFormat(v)).join('\n')}\n\n`;
                shadingGeometry += `${matName} polygon roller_${winId}_left\n0\n0\n12\n${[p[3], q[3], q[0], p[0]].map(v => transformAndFormat(v)).join('\n')}\n\n`;
            } else if (shadeParams.type === 'generative' && shadeParams.parameters) {
                const patternType = shadeParams.patternType;

                // Strategy 1: Simple patterns - generate Radiance primitives directly for efficiency
                if (['vertical_fins', 'horizontal_fins', 'grid'].includes(patternType)) {
                    shadingGeometry += generateSimpleGenerativePattern(
                        patternType,
                        shadeParams.parameters,
                        winParams,
                        orientation,
                        i, // window index
                        transformAndFormat
                    );
                }
                // Strategy 2: Complex patterns - convert the THREE.js mesh to Radiance polygons
                else {
                    const deviceGroup = getGenerativeDeviceFromScene(orientation, i);
                    if (deviceGroup) {
                        deviceGroup.traverse(mesh => {
                            if (mesh.isMesh) {
                                shadingGeometry += _generateRadFromMesh(
                                    mesh,
                                    'shading_mat', // Use the standard shading material
                                    `generative_${patternType}_${winId}`,
                                    worldTransform
                                );
                            }
                        });
                    }
                }
            }
        }
    }

    let contextGeometry = '\n# --- CONTEXT & SITE ---\n';
    if (contextObject.visible && contextObject.children.length > 0) {
        contextObject.children.forEach((mesh, index) => {
            // Context geometry is already in world coordinates, so we use a direct transform
            const directTransform = makeWorldPointFormatter();
            contextGeometry += _generateRadFromMesh(mesh, 'context_mat', `context_building_${index}`, directTransform);
        });
    }

    // Add ground plane geometry (flat or topographic)
    const { groundObject } = await import('./geometry.js');
    if (groundObject.visible && groundObject.children.length > 0) {
        groundObject.children.forEach((mesh) => {
            if (mesh.isMesh && mesh.userData.isGround) { // Check for a flag to only export the ground mesh
                const directTransform = makeWorldPointFormatter();
                contextGeometry += _generateRadFromMesh(mesh, 'ground_mat', `ground_plane`, directTransform);
            }
        });
    }

    let clippingGeometry = '';
    if (clippingPlanes) {
        clippingGeometry = "\n# --- CLIPPING PLANES ---\n";
        const S = 1000; // A very large number for the plane size
        let clipMatDefined = false;

        // Radiance is Z-up. Our scene is Y-up.
        // A horizontal cut in our scene at a Y value is a cut at a Z value in Radiance.
        if (clippingPlanes.horizontal !== null) {
            clippingGeometry += `void glow clip_mat 0 0 4 0 0 0 0\n\n`;
            clipMatDefined = true;
            const zCut = clippingPlanes.horizontal;
            // A large plane cutting everything above it. Normal points down.
            const pts = [[-S, S, zCut], [S, S, zCut], [S, -S, zCut], [-S, -S, zCut]];
            clippingGeometry += `clip_mat polygon h_clip_plane\n0\n0\n12\n${pts.map(p => p.join(' ')).join('\n')}\n\n`;
        }

        // A vertical cut in our scene at an X value (from corner) is a cut at an X value in Radiance (from center).
        if (clippingPlanes.vertical !== null) {
            if (!clipMatDefined) {
                clippingGeometry += `void glow clip_mat 0 0 4 0 0 0 0\n\n`;
            }
            // Convert UI's corner-relative distance to Radiance's center-relative coordinate
            const xCut = clippingPlanes.vertical - (W / 2);
            // A large plane cutting everything to one side. Normal points towards origin.
            const pts = [[xCut, S, -S], [xCut, -S, -S], [xCut, -S, S], [xCut, S, S]];
            clippingGeometry += `clip_mat polygon v_clip_plane\n0\n0\n12\n${pts.map(p => p.join(' ')).join('\n')}\n\n`;
        }
    }

    return {
        materials: matHeader + radMaterials + dynamicMaterialDefs,
        geometry: geoHeader + radGeometry + shadingGeometry + furnitureGeometry + vegetationGeometry + contextGeometry + clippingGeometry
    };
}

/**
 * Generates grid points within a polygon at a specific height.
 * @param {Array<{x: number, z: number}>} polygonPoints - Array of 2D points defining the polygon (x, z).
 * @param {number} spacing - Grid spacing.
 * @param {number} yLevel - The Y height for the points.
 * @param {number} offset - Offset from the polygon edge (negative for inward offset).
 * @returns {Array<{x: number, y: number, z: number}>} Array of valid 3D points.
 */
export function generatePolygonGridPoints(polygonPoints, spacing, yLevel, offset = 0) {
    if (!polygonPoints || polygonPoints.length < 3) return [];

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    polygonPoints.forEach(p => {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z);
        maxZ = Math.max(maxZ, p.z);
    });

    // Apply offset to bounding box optimization
    const startX = minX + offset;
    const endX = maxX - offset;
    const startZ = minZ + offset;
    const endZ = maxZ - offset;

    if (startX >= endX || startZ >= endZ) return [];

    const points = [];

    // Helper for Point-in-Polygon (Ray Casting)
    const isPointInPolygon = (x, z) => {
        let inside = false;
        for (let i = 0, j = polygonPoints.length - 1; i < polygonPoints.length; j = i++) {
            const xi = polygonPoints[i].x, zi = polygonPoints[i].z;
            const xj = polygonPoints[j].x, zj = polygonPoints[j].z;

            const intersect = ((zi > z) !== (zj > z)) &&
                (x < (xj - xi) * (z - zi) / (zj - zi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    };

    // Helper for Distance to Polygon Edge (for accurate offsetting)
    const distToPolygonEdge = (x, z) => {
        let minDist = Infinity;
        for (let i = 0, j = polygonPoints.length - 1; i < polygonPoints.length; j = i++) {
            const p1 = polygonPoints[i];
            const p2 = polygonPoints[j];

            let l2 = (p1.x - p2.x) ** 2 + (p1.z - p2.z) ** 2;
            if (l2 === 0) {
                minDist = Math.min(minDist, Math.sqrt((x - p1.x) ** 2 + (z - p1.z) ** 2));
                continue;
            }

            let t = ((x - p1.x) * (p2.x - p1.x) + (z - p1.z) * (p2.z - p1.z)) / l2;
            t = Math.max(0, Math.min(1, t));

            const px = p1.x + t * (p2.x - p1.x);
            const pz = p1.z + t * (p2.z - p1.z);

            const dist = Math.sqrt((x - px) ** 2 + (z - pz) ** 2);
            minDist = Math.min(minDist, dist);
        }
        return minDist;
    };

    const numX = Math.floor((endX - startX) / spacing);
    const numZ = Math.floor((endZ - startZ) / spacing);

    // Center the grid within the valid bounding box
    const totalLenX = numX * spacing;
    const totalLenZ = numZ * spacing;
    const x0 = startX + (endX - startX - totalLenX) / 2;
    const z0 = startZ + (endZ - startZ - totalLenZ) / 2;

    for (let i = 0; i <= numX; i++) {
        for (let j = 0; j <= numZ; j++) {
            const px = x0 + i * spacing;
            const pz = z0 + j * spacing;

            if (isPointInPolygon(px, pz)) {
                // If we have a significant offset, strictly check distance to edge
                // Simple Point-in-Polygon is strictly "inside/outside".
                // Bounding box offset handles coarse offset.
                // For precise buffering, we check distance.
                if (offset > 0) {
                    if (distToPolygonEdge(px, pz) >= offset) {
                        points.push({ x: px, y: yLevel, z: pz });
                    }
                } else {
                    points.push({ x: px, y: yLevel, z: pz });
                }
            }
        }
    }
    return points;
}

export async function generateRayFileContent() {
    const { getDom, getSensorGridParams } = await import('./ui.js');
    const { project } = await import('./project.js'); // Access project data
    const dom = getDom();
    const gridParams = getSensorGridParams();
    if (!gridParams?.view?.enabled) {
        // Empty, not a comment: rtrace discards a whole file whose first line is '#'.
        return "";
    }

    const { spacing, offset, numDirs, startVec } = gridParams.view;
    const startVector = new THREE.Vector3().fromArray(startVec).normalize();
    const upVector = new THREE.Vector3(0, 1, 0);
    const rays = [];

    // Check for Custom Geometry
    const projectData = await project.gatherAllProjectData(); // This might be heavy, but needed for points
    const customGeom = projectData.geometry.customGeometry;
    const isCustom = projectData.geometry.mode === 'custom' || (customGeom && customGeom.points && customGeom.points.length > 2);

    if (isCustom) {
        // Custom Geometry Mode: Use polygon points
        const polygonPoints = customGeom.points; // Array of {x, z} (or x, y from 2D context)
        // Note: customGeom.points usually comes from drawing tool which is 2D {x, z} (or x, y -> mapped to x,z in 3D). 
        // Let's verify structure. customGeometryManager uses {x, z}.

        // Generate points at height = offset
        const validPoints = generatePolygonGridPoints(polygonPoints, spacing, offset, 0); // View grid usually offset from floor

        const alphaRad = THREE.MathUtils.degToRad(parseFloat(dom['room-orientation'].value));

        // Custom room geometry is built from the raw drawn polygon coordinates and placed
        // inside roomObject, which updateScene() rotates by the room orientation. The custom
        // geometry export writes the baked WORLD coordinates of that group, so the ray origins
        // and directions must be rotated the same way before being mapped into Radiance.
        const toRadiance = makeWorldPointFormatter();

        for (const pt of validPoints) {
            // pt is {x, y, z} in Three.js room-local coords (y = view height above the floor).
            const worldPt = new THREE.Vector3(pt.x, pt.y, pt.z).applyAxisAngle(upVector, alphaRad);
            const originString = toRadiance(worldPt.toArray());

            for (let k = 0; k < numDirs; k++) {
                const angle = (k / numDirs) * 2 * Math.PI;
                // Direction in Three.js (Y-up), rotated with the room
                const localDir = startVector.clone()
                    .applyAxisAngle(upVector, angle)
                    .applyAxisAngle(upVector, alphaRad);

                const dirString = toRadiance(localDir.toArray());

                rays.push(`${originString} ${dirString}`);
            }
        }

    } else {
        // Parametric Mode (Original Logic)
        const W = parseFloat(dom.width.value);
        const L = parseFloat(dom.length.value);
        const alphaRad = THREE.MathUtils.degToRad(parseFloat(dom['room-orientation'].value));
        const cosA = Math.cos(alphaRad);
        const sinA = Math.sin(alphaRad);

        const pointsX = generateCenteredPoints(W, spacing);
        const pointsZ = generateCenteredPoints(L, spacing);

        for (const x of pointsX) {
            for (const z of pointsZ) {
                const localOrigin = new THREE.Vector3(x, offset, z);

                // Use the shared transforms so rays follow the same convention as the geometry
                const originArr = transformThreePointToRadianceArray(localOrigin.toArray(), W, L, cosA, sinA);
                const originString = originArr.map(c => c.toFixed(4)).join(' ');

                for (let k = 0; k < numDirs; k++) {
                    const angle = (k / numDirs) * 2 * Math.PI;
                    const localDir = startVector.clone().applyAxisAngle(upVector, angle);

                    const dirArr = transformThreeVectorToRadianceArray(localDir.toArray(), cosA, sinA);
                    const dirString = dirArr.map(c => c.toFixed(4)).join(' ');

                    rays.push(`${originString} ${dirString}`);
                }
            }
        }
    }

    if (rays.length === 0) {
        // Empty, not a comment: rtrace discards a whole file whose first line is '#'.
        return "";
    }

    // NO header comment -- see the note in project.js's sensor-point writer. A leading '#'
    // makes rtrace/rcontrib read zero rays and exit 0, which silently produced empty
    // results for every recipe that consumes this file.
    // Column order is X Y Z Vx Vy Vz.
    return rays.join('\n') + '\n';
}

/**
 * Gathers the current viewpoint parameters and formats them into a Radiance .vf file content string from a state object.
 * This is used for generating .vf files from saved camera views.
 * @param {object} cameraState - A saved camera state object with position, quaternion, viewType, fov.
 * @returns {string|null} The content for the .vf file or null if data is invalid.
 */
export function generateViewpointFileContentFromState(cameraState) {
    if (!cameraState) return null;

    const { viewType, fov, position, quaternion } = cameraState;
    const vfov = (viewType === 'h' || viewType === 'a') ? 180 : fov;
    const hfov = resolveHfov(viewType, vfov);
    const viewTypeMap = { 'v': '-vtv', 'h': '-vth', 'c': '-vtc', 'l': '-vtl', 'a': '-vta' };
    const radViewType = viewTypeMap[viewType] || '-vtv';

    // The camera state is already in Three.js WORLD coordinates: the viewer centres the room
    // on the origin and rotates the room groups, not the camera. So no extra centering or
    // rotation may be applied here - only the shared axis map (x, y, z) -> (x, -z, y), plus
    // removal of the room elevation, which the Radiance model does not use (floor at z = 0).
    const dom = getDom();
    const elevation = parseFloat(dom.elevation?.value) || 0;
    const toRadiancePoint = makeWorldPointFormatter(elevation);
    const toRadianceVector = makeWorldPointFormatter();

    const rad_vp = toRadiancePoint([position.x, position.y, position.z]);

    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);
    const rad_vd = toRadianceVector(dir.toArray());

    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion);
    const rad_vu = toRadianceVector(up.toArray());

    return `${radViewType} -vp ${rad_vp} -vd ${rad_vd} -vu ${rad_vu} -vh ${hfov} -vv ${vfov}`;
}

/**
 * Converts a Three.js mesh into a string of Radiance polygons.
 * @param {THREE.Mesh} mesh - The mesh to convert.
 * @param {string} material - The name of the Radiance material.
 * @param {string} name - The base name for the polygons.
 * @param {function} transformFunc - The function to transform vertices to the final Radiance coordinate system.
 * @param {string|null} targetMaterialName - If the mesh is multi-material, only process faces with this material name.
 * @returns {string} A string containing Radiance polygon definitions.
 * @private
 */
function _generateRadFromMesh(mesh, material, name, transformFunc, targetMaterialName = null) {
    let radString = `\n# Mesh: ${name}\n`;
    const position = mesh.geometry.attributes.position;
    const index = mesh.geometry.index;
    const groups = mesh.geometry.groups;

    mesh.updateWorldMatrix(true, false);
    const matrix = mesh.matrixWorld;

    const vertices = [];
    for (let i = 0; i < position.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(position, i);
        v.applyMatrix4(matrix);
        vertices.push([v.x, v.y, v.z]);
    }

    const allMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

    if (groups && groups.length > 0 && allMaterials.length > 1) { // Handle multi-material objects
        groups.forEach((group, groupIndex) => {
            const mat = allMaterials[group.materialIndex];
            if (!targetMaterialName || mat.name === targetMaterialName) {
                const radMaterialName = material;
                for (let i = group.start; i < group.start + group.count; i += 3) {
                    const vA = vertices[index.getX(i)];
                    const vB = vertices[index.getX(i + 1)];
                    const vC = vertices[index.getX(i + 2)];

                    radString += `${radMaterialName} polygon ${name}_g${groupIndex}_f${i / 3}\n0\n0\n9\n`;
                    radString += transformFunc(vA) + '\n';
                    radString += transformFunc(vB) + '\n';
                    radString += transformFunc(vC) + '\n\n';
                }
            }
        });
    } else if (index) { // Single material, indexed
        for (let i = 0; i < index.count; i += 3) {
            const vA = vertices[index.getX(i)];
            const vB = vertices[index.getX(i + 1)];
            const vC = vertices[index.getX(i + 2)];
            radString += `${material} polygon ${name}_face_${i / 3}\n0\n0\n9\n`;
            radString += transformFunc(vA) + '\n';
            radString += transformFunc(vB) + '\n';
            radString += transformFunc(vC) + '\n\n';
        }
    } else { // Single material, non-indexed
        for (let i = 0; i < vertices.length; i += 3) {
            const vA = vertices[i];
            const vB = vertices[i + 1];
            const vC = vertices[i + 2];
            radString += `${material} polygon ${name}_face_${i / 3}\n0\n0\n9\n`;
            radString += transformFunc(vA) + '\n';
            radString += transformFunc(vB) + '\n';
            radString += transformFunc(vC) + '\n\n';
        }
    }
    return radString;
}
