// scripts/radiance.js

import { getDom, getAllWindowParams, getAllShadingParams, getSensorGridParams } from './ui.js';
import { project } from './project.js';
import * as THREE from 'three';

// Klems Full Basis outgoing angles (center points) for plotting
const KLEMS_ANGLES = [
    { theta: 5, phi: 0, patch: 1 }, { theta: 15, phi: 0, patch: 8 }, { theta: 15, phi: 45, patch: 8 },
    { theta: 15, phi: 90, patch: 8 }, { theta: 15, phi: 135, patch: 8 }, { theta: 15, phi: 180, patch: 8 },
    { theta: 15, phi: 225, patch: 8 }, { theta: 15, phi: 270, patch: 8 }, { theta: 15, phi: 315, patch: 8 },
    { theta: 25, phi: 0, patch: 16 }, { theta: 25, phi: 22.5, patch: 16 }, { theta: 25, phi: 45, patch: 16 },
    { theta: 25, phi: 67.5, patch: 16 }, { theta: 25, phi: 90, patch: 16 }, { theta: 25, phi: 112.5, patch: 16 },
    { theta: 25, phi: 135, patch: 16 }, { theta: 25, phi: 157.5, patch: 16 }, { theta: 25, phi: 180, patch: 16 },
    { theta: 25, phi: 202.5, patch: 16 }, { theta: 25, phi: 225, patch: 16 }, { theta: 25, phi: 247.5, patch: 16 },
    { theta: 25, phi: 270, patch: 16 }, { theta: 25, phi: 292.5, patch: 16 }, { theta: 25, phi: 315, patch: 16 },
    { theta: 25, phi: 337.5, patch: 16 }, { theta: 35, phi: 0, patch: 24 }, { theta: 35, phi: 15, patch: 24 },
    { theta: 35, phi: 30, patch: 24 }, { theta: 35, phi: 45, patch: 24 }, { theta: 35, phi: 60, patch: 24 },
    { theta: 35, phi: 75, patch: 24 }, { theta: 35, phi: 90, patch: 24 }, { theta: 35, phi: 105, patch: 24 },
    { theta: 35, phi: 120, patch: 24 }, { theta: 35, phi: 135, patch: 24 }, { theta: 35, phi: 150, patch: 24 },
    { theta: 35, phi: 165, patch: 24 }, { theta: 35, phi: 180, patch: 24 }, { theta: 35, phi: 195, patch: 24 },
    { theta: 35, phi: 210, patch: 24 }, { theta: 35, phi: 225, patch: 24 }, { theta: 35, phi: 240, patch: 24 },
    { theta: 35, phi: 255, patch: 24 }, { theta: 35, phi: 270, patch: 24 }, { theta: 35, phi: 285, patch: 24 },
    { theta: 35, phi: 300, patch: 24 }, { theta: 35, phi: 315, patch: 24 }, { theta: 35, phi: 330, patch: 24 },
    { theta: 35, phi: 345, patch: 24 }, { theta: 45, phi: 0, patch: 24 }, { theta: 45, phi: 15, patch: 24 },
    { theta: 45, phi: 30, patch: 24 }, { theta: 45, phi: 45, patch: 24 }, { theta: 45, phi: 60, patch: 24 },
    { theta: 45, phi: 75, patch: 24 }, { theta: 45, phi: 90, patch: 24 }, { theta: 45, phi: 105, patch: 24 },
    { theta: 45, phi: 120, patch: 24 }, { theta: 45, phi: 135, patch: 24 }, { theta: 45, phi: 150, patch: 24 },
    { theta: 45, phi: 165, patch: 24 }, { theta: 45, phi: 180, patch: 24 }, { theta: 45, phi: 195, patch: 24 },
    { theta: 45, phi: 210, patch: 24 }, { theta: 45, phi: 225, patch: 24 }, { theta: 45, phi: 240, patch: 24 },
    { theta: 45, phi: 255, patch: 24 }, { theta: 45, phi: 270, patch: 24 }, { theta: 45, phi: 285, patch: 24 },
    { theta: 45, phi: 300, patch: 24 }, { theta: 45, phi: 315, patch: 24 }, { theta: 45, phi: 330, patch: 24 },
    { theta: 45, phi: 345, patch: 24 }, { theta: 55, phi: 0, patch: 24 }, { theta: 55, phi: 15, patch: 24 },
    { theta: 55, phi: 30, patch: 24 }, { theta: 55, phi: 45, patch: 24 }, { theta: 55, phi: 60, patch: 24 },
    { theta: 55, phi: 75, patch: 24 }, { theta: 55, phi: 90, patch: 24 }, { theta: 55, phi: 105, patch: 24 },
    { theta: 55, phi: 120, patch: 24 }, { theta: 55, phi: 135, patch: 24 }, { theta: 55, phi: 150, patch: 24 },
    { theta: 55, phi: 165, patch: 24 }, { theta: 55, phi: 180, patch: 24 }, { theta: 55, phi: 195, patch: 24 },
    { theta: 55, phi: 210, patch: 24 }, { theta: 55, phi: 225, patch: 24 }, { theta: 55, phi: 240, patch: 24 },
    { theta: 55, phi: 255, patch: 24 }, { theta: 55, phi: 270, patch: 24 }, { theta: 55, phi: 285, patch: 24 },
    { theta: 55, phi: 300, patch: 24 }, { theta: 55, phi: 315, patch: 24 }, { theta: 55, phi: 330, patch: 24 },
    { theta: 55, phi: 345, patch: 24 }, { theta: 65, phi: 0, patch: 20 }, { theta: 65, phi: 18, patch: 20 },
    { theta: 65, phi: 36, patch: 20 }, { theta: 65, phi: 54, patch: 20 }, { theta: 65, phi: 72, patch: 20 },
    { theta: 65, phi: 90, patch: 20 }, { theta: 65, phi: 108, patch: 20 }, { theta: 65, phi: 126, patch: 20 },
    { theta: 65, phi: 144, patch: 20 }, { theta: 65, phi: 162, patch: 20 }, { theta: 65, phi: 180, patch: 20 },
    { theta: 65, phi: 198, patch: 20 }, { theta: 65, phi: 216, patch: 20 }, { theta: 65, phi: 234, patch: 20 },
    { theta: 65, phi: 252, patch: 20 }, { theta: 65, phi: 270, patch: 20 }, { theta: 65, phi: 288, patch: 20 },
    { theta: 65, phi: 306, patch: 20 }, { theta: 65, phi: 324, patch: 20 }, { theta: 65, phi: 342, patch: 20 },
    { theta: 75, phi: 0, patch: 12 }, { theta: 75, phi: 30, patch: 12 }, { theta: 75, phi: 60, patch: 12 },
    { theta: 75, phi: 90, patch: 12 }, { theta: 75, phi: 120, patch: 12 }, { theta: 75, phi: 150, patch: 12 },
    { theta: 75, phi: 180, patch: 12 }, { theta: 75, phi: 210, patch: 12 }, { theta: 75, phi: 240, patch: 12 },
    { theta: 75, phi: 270, patch: 12 }, { theta: 75, phi: 300, patch: 12 }, { theta: 75, phi: 330, patch: 12 },
    { theta: 85, phi: 0, patch: 6 }, { theta: 85, phi: 60, patch: 6 }, { theta: 85, phi: 120, patch: 6 },
    { theta: 85, phi: 180, patch: 6 }, { theta: 85, phi: 240, patch: 6 }, { theta: 85, phi: 300, patch: 6 },
    { theta: 90, phi: 0, patch: 1 }
];

const SPECTRAL_BINS = {
    'lark-9': [
        { start: 380, end: 424 }, { start: 425, end: 454 }, { start: 455, end: 479 },
        { start: 480, end: 504 }, { start: 505, end: 529 }, { start: 530, end: 559 },
        { start: 560, end: 599 }, { start: 600, end: 644 }, { start: 645, end: 780 }
    ],
    'lark-3': [
        // B, G, R order
        { start: 380, end: 498 }, { start: 498, end: 586 }, { start: 586, end: 780 }
    ]
};

/**
* Parses a two-column spectral data file and averages the values into discrete bins.
* @param {string} fileContent - The raw text content of the spectral data file.
* @param {string} [binConfigKey='lark-9'] - The key for the binning configuration ('lark-9' or 'lark-3').
* @returns {number[]|null} An array of binned values, or null if parsing fails.
*/
export function _parseAndBinSpectralData(fileContent, binConfigKey = 'lark-9') {
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

        const theta = parseFloat(angleNode.querySelector("Theta")?.textContent);
        const phi = parseFloat(angleNode.querySelector("Phi")?.textContent);

        const dataNode = node.querySelector('WavelengthData[Wavelength="Visible"] WavelengthDataBlock[WavelengthDataIdentifier="Transmission Front"]');
        if (!dataNode) return;

        const dataString = dataNode.textContent;
        const values = dataString.trim().split(/\s+/).map(parseFloat);

        if (values.length >= KLEMS_ANGLES.length) {
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
    // Correct implementation based on Stokes' equations for a single pane of glass (n=1.52)
    // This formula is a simplified approximation and assumes Rn (reflectance) is ~0.08
    if (Tn <= 0) return 0;
    const Rn = 0.08; 
    const term1 = Math.sqrt((1 - Rn)**4 + 4 * (Rn**2) * (Tn**2));
    const term2 = (1 - Rn)**2;
    const tn = (term1 - term2) / (2 * Rn * Tn);
    // Clamp the result to a physically plausible range [0, 1]
    return Math.max(0, Math.min(1, tn));
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
radString += `${material} polygon ${name}_top\n0\n0\n12\n`   + f([v1t, v2t, v3t, v4t]) + `\n\n`;
radString += `${material} polygon ${name}_bottom\n0\n0\n12\n`+ f([v1b, v4b, v3b, v2b]) + `\n\n`;
radString += `${material} polygon ${name}_front\n0\n0\n12\n` + f([v4t, v3t, v3b, v4b]) + `\n\n`;
radString += `${material} polygon ${name}_back\n0\n0\n12\n`  + f([v2t, v1t, v1b, v2b]) + `\n\n`;
radString += `${material} polygon ${name}_left\n0\n0\n12\n`  + f([v1t, v4t, v4b, v1b]) + `\n\n`;
radString += `${material} polygon ${name}_right\n0\n0\n12\n` + f([v2t, v2b, v3b, v3t]) + `\n\n`;
  return radString;
}

/**
 * Transforms a point from local room coordinates to Radiance world coordinates.
 * This includes centering the room at the origin and rotating it.
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
  const centered_y = p.y - L / 2; // Y is depth
  const rx = centered_x * cosA - centered_y * sinA;
  const ry = centered_x * sinA + centered_y * cosA;
  return `${rx.toFixed(4)} ${ry.toFixed(4)} ${p.z.toFixed(4)}`; // Z is height
}

/**
 * Transforms a point from Three.js scene coordinates (Y-up) to a Radiance world coordinate array (Z-up).
 * @param {Array<number>} threePoint - An array representing the point in Three.js coordinates [X_width, Y_height, Z_depth].
 * @param {number} W - Room width.
 * @param {number} L - Room length.
 * @param {number} cosA - Cosine of the room orientation angle.
 * @param {number} sinA - Sine of the room orientation angle.
 * @returns {Array<number>} A Radiance coordinate array [rotated_x, rotated_y, height_z].
 */
export function transformThreePointToRadianceArray(threePoint, W, L, cosA, sinA) {
    const [threeX_width, threeY_height, threeZ_depth] = threePoint;

    // Center the point on Radiance's XY (ground) plane for rotation
    const centered_x = threeX_width - W / 2;
    const centered_y = threeZ_depth - L / 2; // Use Three.js Z (depth) for Radiance Y

    // Rotate around the Z-axis (up axis in Radiance)
    const rx = centered_x * cosA - centered_y * sinA;
    const ry = centered_x * sinA + centered_y * cosA;

    // Return the final Radiance coordinate array
    return [rx, ry, threeY_height];
}

/**
 * Transforms a vector from Three.js scene coordinates (Y-up) to a Radiance world vector array (Z-up).
 * @param {Array<number>} threeVector - An array representing the vector in Three.js coordinates [x, y, z].
 * @param {number} cosA - Cosine of the room orientation angle.
 * @param {number} sinA - Sine of the room orientation angle.
 * @returns {Array<number>} A Radiance vector array [rotated_x, rotated_y, z].
 */
export function transformThreeVectorToRadianceArray(threeVector, cosA, sinA) {
    const [threeX, threeY, threeZ] = threeVector;

    // Map Three.js vector components [x, y_height, z_depth] to Radiance's [x, y_depth, z_height]
    const rad_x = threeX;
    const rad_y_depth = threeZ;
    const rad_z_height = threeY;

    // Rotate the vector components on the XY (ground) plane
    const rotatedX = rad_x * cosA - rad_y_depth * sinA;
    const rotatedY = rad_x * sinA + rad_y_depth * cosA;

    return [rotatedX, rotatedY, rad_z_height];
}

/**
 * Generates the content for a Radiance .vf (view file).
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
    const hfov = vfov;

    return `${radViewType} -vp ${rad_vp} -vd ${rad_vd} -vu 0 0 1 -vh ${hfov} -vv ${vfov}`;
}

export async function generateRadFileContent(options = {}) {
  const { channelSet, clippingPlanes } = options; // e.g., 'c1-3', 'c4-6', 'c7-9' for spectral runs
  const dom = getDom();

  // --- Headers and Setup ---
  let geoHeader = `# Radiance scene geometry generated on ${new Date().toISOString()}\n`;
  geoHeader += `# Room Orientation: ${dom['room-orientation'].value} degrees from North (Radiance -Y)\n`;
  geoHeader += `# Coordinate System: Right-Handed, Z-up\n`;

  let matHeader = `# Radiance material definitions generated on ${new Date().toISOString()}\n\n`;

  let radMaterials = `# --- BASE MATERIAL DEFINITIONS ---\n`;
  let radGeometry = `\n# --- GEOMETRY ---\n`;
  let shadingGeometry = '\n# --- SHADING DEVICES ---\n';
  let dynamicMaterialDefs = '\n# --- DYNAMIC MATERIAL DEFINITIONS (e.g., roller shades) ---\n';

  // --- Material Generation ---
 function getMaterialDef(type) {
    const matType = dom[`${type}-mat-type`].value.toLowerCase();
    const spec = parseFloat(dom[`${type}-spec`].value);
    const rough = parseFloat(dom[`${type}-rough`].value);
    const matName = `${type}_mat`;

    // Dynamically check for spectral mode for the given material type
    const mode = dom[`${type}-mode-srd`]?.classList.contains('active') ? 'srd' : 'refl';
    const spectralFileKey = `${type}-srd-file`;
    const spectralFile = project.simulationFiles[spectralFileKey];

    if ((type === 'wall' || type === 'floor' || type === 'ceiling') && mode === 'srd' && channelSet && spectralFile?.content) {
        const binnedValues = _parseAndBinSpectralData(spectralFile.content, 'lark-9');

        if (binnedValues && binnedValues.length === 9) {
            let values;
            if (channelSet === 'c1-3')      values = binnedValues.slice(0, 3);
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

    // Fallback to original simple reflectance behavior
    const refl = parseFloat(dom[`${type}-refl`].value);
    switch (matType) {
      case 'plastic': return `void plastic ${matName}\n0\n0\n5 ${refl} ${refl} ${refl} ${spec} ${rough}\n`;
      case 'glass':   return `void glass ${matName}\n0\n0\n3 ${refl} ${refl} ${refl}\n`;
      case 'metal':   return `void metal ${matName}\n0\n0\n5 ${refl} ${refl} ${refl} ${spec} ${rough}\n`;
      default:        return `void plastic ${matName}\n0\n0\n5 ${refl} ${refl} ${refl} ${spec} ${rough}\n`;
    }
  }

  radMaterials += getMaterialDef('wall');
  radMaterials += getMaterialDef('floor');
  radMaterials += getMaterialDef('ceiling');
  radMaterials += getMaterialDef('frame');
  radMaterials += getMaterialDef('shading');
  radMaterials += getMaterialDef('furniture');

  const Tn = parseFloat(dom['glazing-trans'].value);
  const tn = transmittanceToTransmissivity(Tn);
  radMaterials += `void glass glass_mat\n0\n0\n3 ${tn} ${tn} ${tn}\n\n`;

  // --- Geometry Generation ---
  const W = parseFloat(dom.width.value), L = parseFloat(dom.length.value), H = parseFloat(dom.height.value);
  const allWindows = getAllWindowParams();
  const allShading = getAllShadingParams();

  const alphaRad = THREE.MathUtils.degToRad(parseFloat(dom['room-orientation'].value));
  const cosA = Math.cos(alphaRad);
  const sinA = Math.sin(alphaRad);
  const transformAndFormat = (p) => transformAndFormatPoint(p, W, L, cosA, sinA);
  const { 'surface-thickness': surfaceThickness } = getDom();

  // --- Floor ---
  const floorTopVerts = [[0, 0, 0], [W, 0, 0], [W, L, 0], [0, L, 0]];
  radGeometry += generateRadBox(floorTopVerts, surfaceThickness, 'floor_mat', 'floor', transformAndFormat);

  // --- Ceiling ---
  const ceilTopVerts = [[0, 0, H], [W, 0, H], [W, L, H], [0, L, H]];
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

const walls = {'N': { width: W },'S': { width: W },'W': { width: L },'E': { width: L }};
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
const { importedShadingObjects, furnitureObject } = await import('./geometry.js');
importedShadingObjects.forEach((objGroup, index) => {
    // Traverse the group to find the actual mesh
    objGroup.traverse(child => {
        if (child.isMesh) {
            shadingGeometry += _generateRadFromMesh(child, 'shading_mat', `imported_obj_${index}`, transformAndFormat);
        }
    });
});

// --- Generate Furniture Geometry ---
let furnitureGeometry = '\n# --- FURNITURE & PARTITIONS ---\n';
if (furnitureObject.children.length > 0) {
    const furnitureContainer = furnitureObject.children[0];
    furnitureContainer.children.forEach((mesh, index) => {
        furnitureGeometry += _generateRadFromMesh(mesh, 'furniture_mat', `${mesh.userData.assetType}_${index}`, transformAndFormat);
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
              if (orientation === 'N')      { p3_outer = [p2_hinge[0], p2_hinge[1], p2_hinge[2] + dv]; p4_outer = [p1_hinge[0], p1_hinge[1], p1_hinge[2] + dv]; p2_hinge[1] -= dh; p1_hinge[1] -= dh;}
              else if (orientation === 'S') { p3_outer = [p2_hinge[0], p2_hinge[1], p2_hinge[2] + dv]; p4_outer = [p1_hinge[0], p1_hinge[1], p1_hinge[2] + dv]; p2_hinge[1] += dh; p1_hinge[1] += dh;}
              else if (orientation === 'W') { p3_outer = [p2_hinge[0], p2_hinge[1], p2_hinge[2] + dv]; p4_outer = [p1_hinge[0], p1_hinge[1], p1_hinge[2] + dv]; p2_hinge[0] -= dh; p1_hinge[0] -= dh;}
              else                          { p3_outer = [p2_hinge[0], p2_hinge[1], p2_hinge[2] + dv]; p4_outer = [p1_hinge[0], p1_hinge[1], p1_hinge[2] + dv]; p2_hinge[0] += dh; p1_hinge[0] += dh;}
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
              if (orientation === 'N')      { p3_outer = [p2_hinge[0], p2_hinge[1] + dh, p2_hinge[2] + dv]; p4_outer = [p1_hinge[0], p1_hinge[1] + dh, p1_hinge[2] + dv]; }
              else if (orientation === 'S') { p3_outer = [p2_hinge[0], p2_hinge[1] - dh, p2_hinge[2] + dv]; p4_outer = [p1_hinge[0], p1_hinge[1] - dh, p1_hinge[2] + dv]; }
              else if (orientation === 'W') { p3_outer = [p2_hinge[0] + dh, p2_hinge[1], p2_hinge[2] + dv]; p4_outer = [p1_hinge[0] + dh, p1_hinge[1], p1_hinge[2] + dv]; }
              else                          { p3_outer = [p2_hinge[0] - dh, p2_hinge[1], p2_hinge[2] + dv]; p4_outer = [p1_hinge[0] - dh, p1_hinge[1], p1_hinge[2] + dv]; }
              const topVerts = [p1_hinge, p2_hinge, p3_outer, p4_outer];
              shadingGeometry += generateRadBox(topVerts, thick, 'shading_mat', `lightshelf_${isExt ? 'e' : 'i'}_${winId}`, transformAndFormat);
        };
          if (placeExt || placeBoth) createShelf(true);
          if (placeInt || placeBoth) createShelf(false);
      } else if (shadeParams.type === 'louver' && shadeParams.louver) {
          const { isExterior, isHorizontal, slatWidth, slatSep, slatThick, slatAngle, distToGlass } = shadeParams.louver;
          if (slatWidth <= 0 || slatSep <= 0 || slatThick <= 0) continue;
          const inwardNormal = {'N': [0, 1, 0], 'S': [0, -1, 0], 'W': [1, 0, 0], 'E': [-1, 0, 0]}[orientation];
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
      }
    }
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
          const pts = [ [-S, S, zCut], [S, S, zCut], [S, -S, zCut], [-S, -S, zCut] ];
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
           const pts = [ [xCut, S, -S], [xCut, -S, -S], [xCut, -S, S], [xCut, S, S] ];
           clippingGeometry += `clip_mat polygon v_clip_plane\n0\n0\n12\n${pts.map(p => p.join(' ')).join('\n')}\n\n`;
      }
  }

  return {
      materials: matHeader + radMaterials + dynamicMaterialDefs,
      geometry: geoHeader + radGeometry + shadingGeometry + furnitureGeometry + clippingGeometry
  };
}

export async function generateRayFileContent() {
    const { getDom, getSensorGridParams } = await import('./ui.js');
    const dom = getDom();
    const gridParams = getSensorGridParams();
    if (!gridParams?.view?.enabled) {
        return "# View grid is not enabled. No rays generated.";
    }

    const W = parseFloat(dom.width.value);
    const L = parseFloat(dom.length.value);
    const alphaRad = THREE.MathUtils.degToRad(parseFloat(dom['room-orientation'].value));
    const cosA = Math.cos(alphaRad);
    const sinA = Math.sin(alphaRad);

    const { spacing, offset, numDirs, startVec } = gridParams.view;
    
    const generateCenteredPoints = (totalLength, spacing) => {
        if (spacing <= 0 || totalLength <= 0) return [];
        const numPoints = Math.floor(totalLength / spacing);
        if (numPoints === 0) return [totalLength / 2];
        const totalGridLength = (numPoints - 1) * spacing;
        const start = (totalLength - totalGridLength) / 2;
        return Array.from({ length: numPoints }, (_, i) => start + i * spacing);
    };

    const pointsX = generateCenteredPoints(W, spacing);
    const pointsZ = generateCenteredPoints(L, spacing);
    const rays = [];

    const startVector = new THREE.Vector3().fromArray(startVec).normalize();
    const upVector = new THREE.Vector3(0, 1, 0);

    for (const x of pointsX) {
        for (const z of pointsZ) {
            const localOrigin = new THREE.Vector3(x, offset, z);

            const p = { x: localOrigin.x - W / 2, y: localOrigin.z - L / 2, z: localOrigin.y };
            const originRx = p.x * cosA - p.y * sinA;
            const originRy = p.x * sinA + p.y * cosA;
            const originString = `${originRx.toFixed(4)} ${originRy.toFixed(4)} ${p.z.toFixed(4)}`;

            for (let k = 0; k < numDirs; k++) {
                const angle = (k / numDirs) * 2 * Math.PI;
                const localDir = startVector.clone().applyAxisAngle(upVector, angle);

                const v = { x: localDir.x, y: localDir.z, z: localDir.y };
                const dirRx = v.x * cosA - v.y * sinA;
                const dirRy = v.x * sinA + v.y * cosA;
                const dirString = `${dirRx.toFixed(4)} ${dirRy.toFixed(4)} ${v.z.toFixed(4)}`;
                
                rays.push(`${originString} ${dirString}`);
            }
        }
    }

    if (rays.length === 0) {
        return "# No view grid points generated.";
    }
    
    return "# Radiance Rays (X Y Z Vx Vy Vz)\n" + rays.join('\n');
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
    const viewTypeMap = { 'v': '-vtv', 'h': '-vth', 'c': '-vtc', 'l': '-vtl', 'a': '-vta' };
    const radViewType = viewTypeMap[viewType] || '-vtv';

    // Camera state is already in world coordinates. Convert from Y-up to Z-up for Radiance.
    const pos = position;
    const rad_vp = `${pos.x.toFixed(4)} ${pos.z.toFixed(4)} ${pos.y.toFixed(4)}`;

    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);
    const rad_vd = `${dir.x.toFixed(4)} ${dir.z.toFixed(4)} ${dir.y.toFixed(4)}`;

    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion);
    const rad_vu = `${up.x.toFixed(4)} ${up.z.toFixed(4)} ${up.y.toFixed(4)}`;

    return `${radViewType} -vp ${rad_vp} -vd ${rad_vd} -vu ${rad_vu} -vh ${vfov} -vv ${vfov}`;
}

/**
 * Converts a Three.js mesh into a string of Radiance polygons.
 * @param {THREE.Mesh} mesh - The mesh to convert.
 * @param {string} material - The name of the Radiance material.
 * @param {string} name - The base name for the polygons.
 * @param {function} transformFunc - The function to transform vertices to the final Radiance coordinate system.
 * @returns {string} A string containing Radiance polygon definitions.
 * @private
 */
function _generateRadFromMesh(mesh, material, name, transformFunc) {
    let radString = `\n# Imported Mesh: ${name}\n`;
    const position = mesh.geometry.attributes.position;
    const index = mesh.geometry.index;

    // Ensure the mesh's world matrix is up-to-date
    mesh.updateWorldMatrix(true, false);
    const matrix = mesh.matrixWorld;

    const vertices = [];
    for (let i = 0; i < position.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(position, i);
        v.applyMatrix4(matrix); // Apply object's world transform
        vertices.push([v.x, v.y, v.z]); // Store as array [x, y, z]
    }

    if (index) { // Indexed geometry
        for (let i = 0; i < index.count; i += 3) {
            const vA = vertices[index.getX(i)];
            const vB = vertices[index.getX(i + 1)];
            const vC = vertices[index.getX(i + 2)];

            radString += `${material} polygon ${name}_face_${i / 3}\n0\n0\n9\n`;
            radString += transformFunc(vA) + '\n';
            radString += transformFunc(vB) + '\n';
            radString += transformFunc(vC) + '\n\n';
        }
    } else { // Non-indexed geometry (triangles)
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