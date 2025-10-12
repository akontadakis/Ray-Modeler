// scripts/scriptGenerator.js

import { _parseAndBinSpectralData } from './radiance.js';

/**
 * Generates Radiance definitions for artificial light sources using xform for placement.
 * @param {object|null} lightingData - The lighting state object from lightingManager.
 * @param {object} roomData - The room geometry data { W, L, H, rotationY }.
 * @returns {string} A string containing Radiance light source definitions.
 */
function generateLightSourceDefinitions(lightingData, roomData) {
    if (!lightingData || !lightingData.type) {
        return '# No artificial lighting enabled in the scene.';
    }

    // Apply the Maintenance Factor (MF) to the luminaire output
    const mf = lightingData.maintenance_factor || 1.0;

    const { W, L, H, rotationY } = roomData;
    const radToThreeRot = 180 / Math.PI;

    // Remap Three.js Y-up rotation (X, Y, Z) to Radiance Z-up rotation (rx, rz, -ry)
    // for compatibility with the xform command.
    const rotX = lightingData.rotation.x;
    const rotY = lightingData.rotation.z;
    const rotZ = -lightingData.rotation.y;

    const positions = [];
    if (lightingData.placement === 'grid' && lightingData.grid) {
        const { rows, cols, row_spacing, col_spacing } = lightingData.grid;
        const gridWidth = (cols - 1) * col_spacing;
        const gridDepth = (rows - 1) * row_spacing;
        // The light's position from the UI becomes the center of the grid
        const startX = lightingData.position.x - gridWidth / 2;
        const startY = lightingData.position.z - gridDepth / 2; // Y in Radiance is depth (Z in THREE)
        const height = lightingData.position.y; // Z in Radiance is height (Y in THREE)

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                positions.push({
                    x: startX + c * col_spacing - W / 2, // Center relative to room
                    y: startY + r * row_spacing - L / 2,
                    z: height
                });
            }
        }
    } else {
        positions.push({
            x: lightingData.position.x - W / 2,
            y: lightingData.position.z - L / 2,
            z: lightingData.position.y
        });
    }

    let lightRad = '# Artificial Light Source Definitions\n';
    const matIdentifier = `${lightingData.type}_mat`;
    const geomIdentifier = `${lightingData.type}_geom`;
    let iesBasename = '';

    // 1. Define the light material ONCE at the origin.
    let matArgs = '';
    // Apply the Maintenance Factor (MF) by scaling the light output
    const scaledRgb = (rgb) => rgb.map(c => (c * mf).toPrecision(4)).join(' ');

    switch (lightingData.type) {
        case 'light': matArgs = `3 ${scaledRgb(lightingData.rgb)}`; break;
        case 'spotlight': matArgs = `7 ${scaledRgb(lightingData.rgb)} 0 0 -1 ${lightingData.cone_angle} 0`; break;
        case 'glow': matArgs = `4 ${scaledRgb(lightingData.rgb)} ${lightingData.max_radius}`; break;
        case 'illum': matArgs = `2 ${lightingData.alternate_material || 'void'} ${scaledRgb(lightingData.rgb)}`; break;
        case 'ies':
                const totalMultiplier = (lightingData.ies_multiplier || 1.0) * mf;
                // Get the basename of the file (e.g., "my_light" from "my_light.ies")
                iesBasename = lightingData.ies_file.replace(/\\.ies$/i, '');
                // Corrected path to point to the general files directory instead of bsdf
                lightRad += `!ies2rad -m ${totalMultiplier.toPrecision(4)} ../11_files/${lightingData.ies_file_data.name}\n`;
                break;
        }

    if (lightingData.type !== 'ies') {
        lightRad += `void ${lightingData.type} ${matIdentifier}\n0\n0\n${matArgs}\n\n`;

        // 2. Define the light geometry ONCE at the origin.
        switch (lightingData.geometry.type) {
            case 'sphere':
                lightRad += `${matIdentifier} sphere ${geomIdentifier}\n0\n0\n4 0 0 0 ${lightingData.geometry.radius}\n\n`;
                break;
            case 'cylinder':
                const cylP1 = `0 0 ${-lightingData.geometry.length / 2}`;
                const cylP2 = `0 0 ${lightingData.geometry.length / 2}`;
                lightRad += `${matIdentifier} cylinder ${geomIdentifier}\n0\n0\n7 ${cylP1} ${cylP2} ${lightingData.geometry.radius}\n\n`;
                break;
            case 'ring':
                 lightRad += `${matIdentifier} ring ${geomIdentifier}\n0\n0\n8 0 0 0  0 0 1  ${lightingData.geometry.innerRadius} ${lightingData.geometry.outerRadius}\n\n`;
                 break;
            case 'polygon':
            default:
                const halfW = 0.125, halfH = 0.125;
                lightRad += `${matIdentifier} polygon ${geomIdentifier}\n0\n0\n12\n  ${-halfW} ${-halfH} 0\n  ${halfW} ${-halfH} 0\n  ${halfW} ${halfH} 0\n  ${-halfW} ${halfH} 0\n\n`;
                break;
        }
    }

    // 3. Use xform to instance, place, and rotate the geometry for each light in the grid/array.
    positions.forEach((pos, i) => {
        const instanceIdentifier = lightingData.type === 'ies' ? iesBasename : geomIdentifier;
        // The room's rotation (-rz) is removed. It's handled by the viewpoint vectors.
        // The IES identifier is now the corrected basename.
        lightRad += `!xform -t ${pos.x} ${pos.y} ${pos.z} -rx ${rotX} -ry ${rotY} -rz ${rotZ} ${instanceIdentifier}\n`;
    });

    return lightRad;
}

/**
 * Main function to generate all relevant simulation scripts based on a selected recipe.
 * @param {object} projectData - The complete project data object, including merged parameters.
 * @param {string} recipeType - The template ID of the recipe being executed (e.g., 'template-recipe-illuminance').
 * @returns {Array<object>} An array of script file objects {fileName, content}.
 */
export function generateScripts(projectData, recipeType) {
    const scripts = [];
    let scriptSet;

    switch (recipeType) {
        case 'template-recipe-illuminance':
            scriptSet = createPointIlluminanceScript(projectData);
            break;
        case 'template-recipe-rendering':
            scriptSet = createRenderImageScript(projectData);
            break;
        case 'template-recipe-dgp':
            scriptSet = createDgpAnalysisScript(projectData);
            break;
        case 'template-recipe-df':
            scriptSet = createDaylightFactorScript(projectData);
            break;
        case 'template-recipe-annual-3ph':
            scriptSet = create3phMatrixGenerationScript(projectData);
            if (scriptSet.sh) scripts.push(scriptSet.sh);
            if (scriptSet.bat) scripts.push(scriptSet.bat);

            scriptSet = create3phAnnualSimScript(projectData);
            if (scriptSet.sh) scripts.push(scriptSet.sh);
            if (scriptSet.bat) scripts.push(scriptSet.bat);
            
            // Python script is cross-platform, handle it separately.
            const postProcessScript = createPostProcessingScript();
            scripts.push(postProcessScript);
            return scripts; // Return early as this case is special

        case 'template-recipe-sda-ase':
            scriptSet = createSdaAseScript(projectData);
            // This recipe generates multiple files, so it returns an array
            if (Array.isArray(scriptSet)) {
                scripts.push(...scriptSet);
            }
            return scripts;

        case 'template-recipe-annual-5ph':
            scriptSet = create5phMatrixGenerationScript(projectData);
            if (scriptSet.sh) scripts.push(scriptSet.sh);
            if (scriptSet.bat) scripts.push(scriptSet.bat);

            const postProcessScript5ph = createPostProcessingScript();
            scripts.push(postProcessScript5ph);
            return scripts;

        case 'template-recipe-imageless-glare':
            scriptSet = createImagelessGlareScript(projectData);
            break;
        case 'template-recipe-spectral-lark':
            scriptSet = createLarkSpectralScript(projectData);
        break;
        case 'template-recipe-lighting-energy':
            scriptSet = createLightingEnergyScript(projectData);
            if (Array.isArray(scriptSet)) { // It returns an array of files
                scripts.push(...scriptSet);
            }
            return scripts;
        default:
            console.warn(`Unknown recipe type provided to generateScripts: ${recipeType}`);
            return scripts;
        case 'template-recipe-en-illuminance':
            scriptSet = createEnIlluminanceScript(projectData);
            break;
        case 'template-recipe-en-ugr':
            scriptSet = createEnUgrScript(projectData);
            break;
        case 'template-recipe-annual-radiation':
            scriptSet = createAnnualRadiationScript(projectData);
            break;
    }

    if (scriptSet) {
        if (scriptSet.sh) scripts.push(scriptSet.sh);
        if (scriptSet.bat) scripts.push(scriptSet.bat);
    }

    return scripts;
}


// --- ============================================= ---
// --- POINT-IN-TIME SCRIPT GENERATORS               ---
// --- ============================================= ---

/**
 * Bins continuous spectral data into discrete channels by averaging.
 * @param {string} spdContent The raw string content of the two-column spectral data file.
 * @param {Array<Array<number>>} bins An array of [start, end] wavelength bins.
 * @returns {number[]} An array of binned values, one for each bin.
 */
function _binSpectralData(spdContent, bins) {
    if (!spdContent) return bins.map(() => 0);

    const lines = spdContent.trim().split(/\r?\n/);
    const spectralData = lines.map(line => {
        const parts = line.trim().split(/\s+/);
        return {
            wavelength: parseFloat(parts[0]),
            value: parseFloat(parts[1])
        };
    }).filter(d => !isNaN(d.wavelength) && !isNaN(d.value));

    return bins.map(bin => {
        const [start, end] = bin;
        const valuesInBin = spectralData
            .filter(d => d.wavelength >= start && d.wavelength <= end)
            .map(d => d.value);

        if (valuesInBin.length === 0) return 0;
        const sum = valuesInBin.reduce((a, b) => a + b, 0);
        return sum / valuesInBin.length;
    });
}

function createLarkSpectralScript(projectData) {
    const { projectInfo: pi, mergedSimParams: p, materials, simulationFiles } = projectData;
    const projectName = pi['project-name'].replace(/\s+/g, '_') || 'scene';

    // --- Common Parameters ---
    const month = p['lark-month'], day = p['lark-day'], hour = (p['lark-time'] || '12:00').replace(':', '.');
    const lat = pi.latitude, lon = pi.longitude, mer = (Math.round(lon / 15) * 15) * -1;
    const dni = p['lark-dni'], dhi = p['lark-dhi'];
    const sunSpdFile = p['lark-sun-spd']?.name || 'sun.spd';
    const skySpdFile = p['lark-sky-spd']?.name || 'sky.spd';
    const ab = p['ab'], ad = p['ad'], as = p['as'], ar = p['ar'], aa = p['aa'], lw = p['lw'];
    const run9ch = p['lark-run-9ch-toggle'];

    /// --- Spectral Binning (in JavaScript) ---
    const wallSrdContent = simulationFiles['wall-srd-file']?.content;
    const floorSrdContent = simulationFiles['floor-srd-file']?.content;
    const ceilingSrdContent = simulationFiles['ceiling-srd-file']?.content;

    const binnedWallRefl9ch = _parseAndBinSpectralData(wallSrdContent, 'lark-9') || Array(9).fill(p['wall-refl'] || 0.5);
    const binnedFloorRefl9ch = _parseAndBinSpectralData(floorSrdContent, 'lark-9') || Array(9).fill(p['floor-refl'] || 0.2);
    const binnedCeilingRefl9ch = _parseAndBinSpectralData(ceilingSrdContent, 'lark-9') || Array(9).fill(p['ceiling-refl'] || 0.8);

    const generateMaterialSet = (suffix, wallBins, floorBins, ceilingBins) => `
void plastic wall_mat
0
0
5 ${wallBins.map(v => v.toFixed(4)).join(' ')} 0 0

void plastic floor_mat
0
0
5 ${floorBins.map(v => v.toFixed(4)).join(' ')} 0 0

void plastic ceiling_mat
0
0
5 ${ceilingBins.map(v => v.toFixed(4)).join(' ')} 0 0
    `;
    
    const materialDefs9ch = {
        'c1-3': generateMaterialSet('c1-3', binnedWallRefl9ch.slice(0, 3), binnedFloorRefl9ch.slice(0, 3), binnedCeilingRefl9ch.slice(0, 3)),
        'c4-6': generateMaterialSet('c4-6', binnedWallRefl9ch.slice(3, 6), binnedFloorRefl9ch.slice(3, 6), binnedCeilingRefl9ch.slice(3, 6)),
        'c7-9': generateMaterialSet('c7-9', binnedWallRefl9ch.slice(6, 9), binnedFloorRefl9ch.slice(6, 9), binnedCeilingRefl9ch.slice(6, 9)),
    };

    const pythonScriptContent = `
import numpy as np
import pandas as pd
import json
import argparse
import os

def calculate_metrics(res_file, num_points):
    """
    Calculates circadian metrics from a 9-channel Radiance result file.
    """
    print(f"Reading 9-channel irradiance data from: {res_file}")
    try:
        # Each row has 9 values (R1 G1 B1 R2 G2 B2 R3 G3 B3)
        data = np.loadtxt(res_file)
        if data.ndim == 1: # Handle case with only one sensor point
            data = data.reshape(1, -1)
        
        num_rows = data.shape[0]
        if num_rows != num_points:
            print(f"Warning: Number of points in result file ({num_rows}) does not match expected ({num_points}).")

    except Exception as e:
        print(f"Error reading or reshaping file: {e}")
        return

    # Lark-9 Bins and their representative bandwidths (nm)
    bins = [(380, 424), (425, 454), (455, 479), (480, 504), (505, 529), (530, 559), (560, 599), (600, 644), (645, 780)]
    bin_widths = np.array([b[1] - b[0] for b in bins])

    # Pre-averaged weighting functions for each of the 9 Lark bins
    # V(lambda) for Photopic Illuminance
    v_lambda_binned = np.array([0.0003, 0.0232, 0.1465, 0.3644, 0.7386, 0.9859, 0.8654, 0.3804, 0.0535])
    # Melanopic Action Spectrum m(lambda)
    m_lambda_binned = np.array([0.0335, 0.4021, 0.7932, 0.8876, 0.6548, 0.3923, 0.1256, 0.0177, 0.0010])
    # CIE 1931 2-deg Color Matching Functions
    x_bar_binned = np.array([0.0178, 0.0864, 0.2223, 0.1873, 0.0469, 0.3015, 0.7013, 0.9634, 0.2354])
    y_bar_binned = v_lambda_binned # y_bar is identical to V(lambda)
    z_bar_binned = np.array([0.0837, 0.4208, 1.0567, 0.8528, 0.2033, 0.0315, 0.0039, 0.0001, 0.0000])

    # --- Calculations ---
    # Note: Radiance .res output is spectral irradiance in W/m^2 per bin.
    # To get W/m^2/nm, we would divide by bin_width, but for weighted sums,
    # we multiply by bin_width later, so it cancels out.
    
    # Photopic Illuminance (lux)
    photopic_w_m2 = np.sum(data * v_lambda_binned, axis=1)
    photopic_lux = photopic_w_m2 * 179.0

    # Melanopic EDI (lux)
    melanopic_w_m2 = np.sum(data * m_lambda_binned, axis=1)
    melanopic_edi_lux = melanopic_w_m2 * 179.0

    # Equivalent Melanopic Lux (EML)
    eml = melanopic_edi_lux * (1 / 1.104)

    # Circadian Stimulus (CS) - using the 2018 model from LRC
    # This is a simplification; a full model would use pupil diameter.
    # Rod-corrected photopic lux
    S_cone = np.sum(data * np.array([0.0001,0.0051,0.0617,0.3202,0.7371,0.9708,0.8569,0.4042,0.0716]), axis=1) * 179
    Rod_w_m2 = np.sum(data * np.array([0.0013,0.0505,0.2987,0.7346,0.8930,0.4907,0.1478,0.0253,0.0028]), axis=1)
    V_prime_w_m2 = np.sum(data * np.array([0.0006,0.0210,0.1378,0.4430,0.8587,0.8252,0.4674,0.1555,0.0213]), axis=1)
    rod_sat = 35000 * (1 - np.exp(-S_cone/10000))
    effective_rods = np.where(S_cone < 0.1, V_prime_w_m2 * 179 * 2.2, Rod_w_m2 * 179 * (1 - np.exp(-S_cone/rod_sat)))
    CL_A = 1548 * melanopic_w_m2 + effective_rods
    CS = 0.7 * (1 - (1 / (1 + (CL_A / 355.7)**1.1026)))

    # CCT Calculation (from xy chromaticity)
    X = np.sum(data * x_bar_binned, axis=1)
    Y = np.sum(data * y_bar_binned, axis=1)
    Z = np.sum(data * z_bar_binned, axis=1)
    
    # Avoid division by zero for black points
    XYZ_sum = X + Y + Z
    x = np.divide(X, XYZ_sum, out=np.zeros_like(X), where=XYZ_sum!=0)
    y = np.divide(Y, XYZ_sum, out=np.zeros_like(Y), where=XYZ_sum!=0)
    
    # McCamy's formula for CCT approximation
    n = (x - 0.3320) / (0.1858 - y)
    cct = 449 * n**3 + 3525 * n**2 + 6823.3 * n + 5520.33
    
    # --- Create Output DataFrames ---
    per_point_df = pd.DataFrame({
        'PointID': range(num_points),
        'Photopic_lux': photopic_lux,
        'Melanopic_EDI_lux': melanopic_edi_lux,
        'EML': eml,
        'CS': CS,
        'CCT': cct,
        'CIEx': x,
        'CIEy': y
    })

    summary_data = {
        'avg_photopic_lux': per_point_df['Photopic_lux'].mean(),
        'avg_melanopic_edi_lux': per_point_df['Melanopic_EDI_lux'].mean(),
        'avg_eml': per_point_df['EML'].mean(),
        'avg_cs': per_point_df['CS'].mean(),
        'avg_cct': per_point_df['CCT'].mean()
    }

    # --- Save Files ---
    output_dir = os.path.dirname(res_file)
    per_point_df.to_csv(os.path.join(output_dir, "circadian_per_point.csv"), index=False, float_format='%.2f')
    with open(os.path.join(output_dir, "circadian_summary.json"), 'w') as f:
        json.dump(summary_data, f, indent=4)
        
    print("Circadian analysis complete. Summary and per-point files saved.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Post-process Radiance 9-channel spectral results.")
    parser.add_argument("res_file", type=str, help="Path to the 9-channel .res file.")
    parser.add_argument("--points", type=int, required=True, help="Number of sensor points in the grid.")
    args = parser.parse_args()

    if not os.path.exists(args.res_file):
        print(f"Error: Input file not found at {args.res_file}")
    else:
        calculate_metrics(args.res_file, args.points)
`;

    const shContent = `#!/bin/bash
# MASTER SCRIPT FOR SPECTRAL RADIANCE SIMULATION
# Generated by Ray Modeler for project: ${projectName}

# --- JOB CONTROL ---
RUN_9_CHANNEL=${run9ch}
# 3-Channel is deprecated in favor of this more advanced workflow
# RUN_3_CHANNEL=false 

# --- COMMON PARAMETERS ---
MONTH=${month}; DAY=${day}; HOUR=${hour};
LATITUDE=${lat}; LONGITUDE=${lon}; MERIDIAN=${mer};
DNI=${dni}; DHI=${dhi};
GEOMETRY_FILE="../01_geometry/${projectName}.rad"
MATERIALS_DIR="../02_materials"
POINTS_FILE="../08_results/grid.pts"
VIEW_FILE="../03_views/viewpoint.vf"
SUN_SPD="../11_files/${sunSpdFile}"
SKY_SPD="../11_files/${skySpdFile}"
RAD_PARAMS="-ab ${ab} -ad ${ad} -as ${as} -ar ${ar} -aa ${aa} -lw ${lw}"
PYTHON_SCRIPT="process_spectral.py"
NUM_POINTS=$(wc -l < "\${POINTS_FILE}")

# ==============================================================================
# --- 9-CHANNEL SIMULATION FUNCTION
# ==============================================================================
run_9_channel_simulation() {
    echo ""
    echo "##############################################"
    echo "### STARTING 9-CHANNEL SPECTRAL SIMULATION ###"
    echo "##############################################"

    local OUTPUT_DIR="../08_results/spectral_9ch"
    mkdir -p $OUTPUT_DIR $MATERIALS_DIR

    # --- 1. PRE-PROCESSING AND MATERIAL FILE GENERATION ---
    echo "Step 1: Generating spectrally binned material files..."
    cat > "${MATERIALS_DIR}/materials_c1-3.rad" << EOF
${materialDefs9ch.c1_3}
EOF
    cat > "${MATERIALS_DIR}/materials_c4-6.rad" << EOF
${materialDefs9ch.c4_6}
EOF
    cat > "${MATERIALS_DIR}/materials_c7-9.rad" << EOF
${materialDefs9ch.c7_9}
EOF

    # --- 2. BIN SUN/SKY SPECTRA ---
    echo "Step 2: Binning sun and sky spectral data..."
    # (AWK commands are condensed for brevity, functionally identical)
    B1_SUN=$(awk '$1>=380 && $1<=424 {s+=$2; c++} END {print s/c}' $SUN_SPD); B2_SUN=$(awk '$1>=425 && $1<=454 {s+=$2; c++} END {print s/c}' $SUN_SPD); B3_SUN=$(awk '$1>=455 && $1<=479 {s+=$2; c++} END {print s/c}' $SUN_SPD)
    B4_SUN=$(awk '$1>=480 && $1<=504 {s+=$2; c++} END {print s/c}' $SUN_SPD); B5_SUN=$(awk '$1>=505 && $1<=529 {s+=$2; c++} END {print s/c}' $SUN_SPD); B6_SUN=$(awk '$1>=530 && $1<=559 {s+=$2; c++} END {print s/c}' $SUN_SPD)
    B7_SUN=$(awk '$1>=560 && $1<=599 {s+=$2; c++} END {print s/c}' $SUN_SPD); B8_SUN=$(awk '$1>=600 && $1<=644 {s+=$2; c++} END {print s/c}' $SUN_SPD); B9_SUN=$(awk '$1>=645 && $1<=780 {s+=$2; c++} END {print s/c}' $SUN_SPD)
    B1_SKY=$(awk '$1>=380 && $1<=424 {s+=$2; c++} END {print s/c}' $SKY_SPD); B2_SKY=$(awk '$1>=425 && $1<=454 {s+=$2; c++} END {print s/c}' $SKY_SPD); B3_SKY=$(awk '$1>=455 && $1<=479 {s+=$2; c++} END {print s/c}' $SKY_SPD)
    B4_SKY=$(awk '$1>=480 && $1<=504 {s+=$2; c++} END {print s/c}' $SKY_SPD); B5_SKY=$(awk '$1>=505 && $1<=529 {s+=$2; c++} END {print s/c}' $SKY_SPD); B6_SKY=$(awk '$1>=530 && $1<=559 {s+=$2; c++} END {print s/c}' $SKY_SPD)
    B7_SKY=$(awk '$1>=560 && $1<=599 {s+=$2; c++} END {print s/c}' $SKY_SPD); B8_SKY=$(awk '$1>=600 && $1<=644 {s+=$2; c++} END {print s/c}' $SKY_SPD); B9_SKY=$(awk '$1>=645 && $1<=780 {s+=$2; c++} END {print s/c}' $SKY_SPD)

    # --- 3. SPECTRAL SKY GENERATION (TWO-PASS METHOD) ---
    echo "Step 3: Generating spectral sky files..."
    BASELINE_SKY="${OUTPUT_DIR}/sky_baseline.rad"
    gendaylit $MONTH $DAY $HOUR -a $LATITUDE -o $LONGITUDE -m $MERIDIAN -W $DNI $DHI > $BASELINE_SKY
    SUN_RAD_RGB=$(grep "sun source" -A 3 $BASELINE_SKY | tail -n 1)
    R_RAD=$(echo $SUN_RAD_RGB | awk '{print $1}'); G_RAD=$(echo $SUN_RAD_RGB | awk '{print $2}'); B_RAD=$(echo $SUN_RAD_RGB | awk '{print $3}')
    L_BASE=$(echo "179 * (0.2651*$R_RAD + 0.670*$G_RAD + 0.065*$B_RAD)" | bc -l)
    L_SPEC_UNSCALED=$(echo "179*($B1_SUN*0.0003+$B2_SUN*0.0232+$B3_SUN*0.1465+$B4_SUN*0.3644+$B5_SUN*0.7386+$B6_SUN*0.9859+$B7_SUN*0.8654+$B8_SUN*0.3804+$B9_SUN*0.0535)" | bc -l)
    C_SCALE=$(echo "scale=10; $L_BASE / ($L_SPEC_UNSCALED + 1e-9)" | bc -l)
    S1_SCALED=$(echo "$B1_SUN * $C_SCALE" | bc -l); S2_SCALED=$(echo "$B2_SUN * $C_SCALE" | bc -l); S3_SCALED=$(echo "$B3_SUN * $C_SCALE" | bc -l)
    S4_SCALED=$(echo "$B4_SUN * $C_SCALE" | bc -l); S5_SCALED=$(echo "$B5_SUN * $C_SCALE" | bc -l); S6_SCALED=$(echo "$B6_SUN * $C_SCALE" | bc -l)
    S7_SCALED=$(echo "$B7_SUN * $C_SCALE" | bc -l); S8_SCALED=$(echo "$B8_SUN * $C_SCALE" | bc -l); S9_SCALED=$(echo "$B9_SUN * $C_SCALE" | bc -l)

    for i in {1..3}; do
        case $i in
            1) R_S=$S1_SCALED; G_S=$S2_SCALED; B_S=$S3_SCALED; R_K=$B1_SKY; G_K=$B2_SKY; B_K=$B3_SKY; SUFFIX="c1-3";;
            2) R_S=$S4_SCALED; G_S=$S5_SCALED; B_S=$S6_SCALED; R_K=$B4_SKY; G_K=$B5_SKY; B_K=$B6_SKY; SUFFIX="c4-6";;
            3) R_S=$S7_SCALED; G_S=$S8_SCALED; B_S=$S9_SCALED; R_K=$B7_SKY; G_K=$B8_SKY; B_K=$B9_SKY; SUFFIX="c7-9";;
        esac
        MOD_FILE="${OUTPUT_DIR}/mods_${SUFFIX}.rad"; SKY_FILE="${OUTPUT_DIR}/sky_${SUFFIX}.rad"
        cat > $MOD_FILE <<EOF
void colorfunc sky_rgb_${SUFFIX}\\n4 red green blue skybright.cal\\n0\\n3 $R_K $G_K $B_K
void colorfunc sun_rgb_${SUFFIX}\\n4 red green blue source.cal\\n0\\n3 $R_S $G_S $B_S
EOF
        gendaylit $MONTH $DAY $HOUR -a $LATITUDE -o $LONGITUDE -m $MERIDIAN -W $DNI $DHI \\
            | sed "s/^void brightfunc skyfunc/sky_rgb_${SUFFIX} brightfunc skyfunc/" \\
            | sed "s/^void light solar/sun_rgb_${SUFFIX} light solar/" > $SKY_FILE
        cat $MOD_FILE $SKY_FILE > "${OUTPUT_DIR}/sky_final_${SUFFIX}.rad"
    done

    # --- 4. SCENE COMPILATION & 5. SIMULATION ---
    echo "Steps 4 & 5: Compiling octrees and running simulations..."
    for SUFFIX in "c1-3" "c4-6" "c7-9"; do
        OCTREE="${OUTPUT_DIR}/scene_${SUFFIX}.oct"
        oconv -f "${OUTPUT_DIR}/sky_final_${SUFFIX}.rad" "${MATERIALS_DIR}/materials_${SUFFIX}.rad" $GEOMETRY_FILE > $OCTREE
        # We only need the sensor point results for the post-processing script
        rtrace -I -h $RAD_PARAMS $OCTREE < $POINTS_FILE > "${OUTPUT_DIR}/results_${SUFFIX}.res"
    done

    # --- 6. POST-PROCESSING ---
    echo "Step 6: Combining results and calculating final circadian metrics..."
    paste "${OUTPUT_DIR}/results_c1-3.res" "${OUTPUT_DIR}/results_c4-6.res" "${OUTPUT_DIR}/results_c7-9.res" > "${OUTPUT_DIR}/results_9channel.res"
    
    # Save the Python script to the results directory
    echo "Creating Python post-processor..."
    cat > "${OUTPUT_DIR}/${PYTHON_SCRIPT}" << EOF
${pythonScriptContent}
EOF

    # Execute the Python script
    echo "Executing Python post-processor..."
    python3 "${OUTPUT_DIR}/${PYTHON_SCRIPT}" "${OUTPUT_DIR}/results_9channel.res" --points "\${NUM_POINTS}"

    echo "### 9-CHANNEL SIMULATION COMPLETE ###"
    echo "Circadian metrics saved in ${OUTPUT_DIR}/circadian_summary.json"
}

# ==============================================================================
# --- SCRIPT EXECUTION LOGIC ---
# ==============================================================================
if [ "$RUN_9_CHANNEL" = true ]; then
    run_9_channel_simulation
fi

echo ""
echo "All selected spectral simulations are complete."
`;

    return {
        sh: { fileName: `RUN_${projectName}_Spectral.sh`, content: shContent },
        bat: { fileName: `RUN_${projectName}_Spectral.bat`, content: `# BAT file generation for this workflow is complex. The generated shell script should be run using a bash interpreter on Windows (e.g., Git Bash, WSL).` }
    };
}

function createPointIlluminanceScript(projectData) {
    const { projectInfo: pi, mergedSimParams: p } = projectData;
    
    const projectName = pi['project-name'].replace(/\s+/g, '_') || 'scene';
    const lat = pi.latitude || 0;
    const lon = pi.longitude || 0;
    const mer = (Math.round(lon / 15) * 15) * -1;
    
    const month = p['pit-month'] || 6;
    const day = p['pit-day'] || 21;
    const time = (p['pit-time'] || '12:00').replace(':', '.');

    const ab = p['ab'] || 4;
    const ad = p['ad'] || 1024;
    const as = p['as'] || 512;
    const ar = p['ar'] || 512;
    const aa = p['aa'] || 0.2;
    const rtraceMode = p['rtrace-mode-I'] ? '-I' : '-i';
    const rtraceSwitches = `${p['rtrace-h'] ? '-h' : ''} ${p['rtrace-w'] ? '-w' : ''} ${p['rtrace-u'] ? '-u' : ''}`.trim();
    const lightDefs = generateLightSourceDefinitions(projectData.lighting, projectData.geometry.room);

    const shContent = `#!/bin/bash
# RUN_Illuminance.sh
# Script to run a point-in-time illuminance analysis.
# Generated by Ray Modeler.

# --- Simulation Configuration ---
PROJECT_NAME="${projectName}"
LATITUDE=${lat}
LONGITUDE=${lon}
MERIDIAN=${mer}

# Date and Time for Analysis
MONTH=${month}
DAY=${day}
TIME=${time}

# Ambient Parameters
AB=${ab}; AD=${ad}; AS=${as}; AR=${ar}; AA=${aa}

# --- File & Directory Setup ---
GEOM_FILE="../01_geometry/\${PROJECT_NAME}.rad"
MAT_FILE="../02_materials/\${PROJECT_NAME}_materials.rad"
SKY_DIR="../04_skies"
OCT_DIR="../06_octrees"
RESULTS_DIR="../08_results"
POINTS_FILE="../08_results/grid.pts"

mkdir -p \$SKY_DIR \$OCT_DIR \$RESULTS_DIR

# 1. Generate Sky Description using gensky
echo "1. Generating sky..."
SKY_FILE="\${SKY_DIR}/\${PROJECT_NAME}_\${MONTH}_\${DAY}_\${TIME}.rad"
gensky \${MONTH} \${DAY} \${TIME} -a \${LATITUDE} -o \${LONGITUDE} -m \${MERIDIAN} > "\${SKY_FILE}"

# 2. Create Scene Octree using oconv
echo "2. Creating octree..."
OCTREE_FILE="\${OCT_DIR}/\${PROJECT_NAME}.oct"
(
cat "\${GEOM_FILE}"
cat "\${MAT_FILE}"
echo
cat "\${SKY_FILE}"
echo
echo "${lightDefs}"
) | oconv - > "\${OCTREE_FILE}"
if [ \$? -ne 0 ]; then echo "Error during oconv."; exit 1; fi

# 3. Run Illuminance Calculation with rtrace
echo "3. Calculating illuminance values..."
RESULTS_FILE="\${RESULTS_DIR}/\${PROJECT_NAME}_illuminance.txt"

rtrace ${rtraceMode} ${rtraceSwitches} -ab \${AB} -ad \${AD} -as \${AS} -ar \${AR} -aa \${AA} "\${OCTREE_FILE}" < "\${POINTS_FILE}" | \\
rcalc -e '$1=179*(0.265*$1 + 0.670*$2 + 0.065*$3)' > "\${RESULTS_FILE}"
if [ \$? -ne 0 ]; then echo "Error during rtrace."; exit 1; fi

echo "---"
echo "Simulation complete. Results saved to: \${RESULTS_FILE}"
echo "---"
`;

    const batContent = `@echo off
REM RUN_Illuminance.bat
REM Script to run a point-in-time illuminance analysis.
REM Generated by Ray Modeler.

REM --- Simulation Configuration ---
set "PROJECT_NAME=${projectName}"
set "LATITUDE=${lat}"
set "LONGITUDE=${lon}"
set "MERIDIAN=${mer}"

REM Date and Time for Analysis
set "MONTH=${month}"
set "DAY=${day}"
set "TIME=${time}"

REM Ambient Parameters
set "AB=${ab}"
set "AD=${ad}"
set "AS=${as}"
set "AR=${ar}"
set "AA=${aa}"

REM --- File & Directory Setup ---
set "GEOM_FILE=..\\01_geometry\\%PROJECT_NAME%.rad"
set "SKY_DIR=..\\04_skies"
set "OCT_DIR=..\\06_octrees"
set "RESULTS_DIR=..\\08_results"
set "POINTS_FILE=..\\08_results\\grid.pts"
set "TEMP_RAD_FILE=..\\06_octrees\\temp_scene.rad"

if not exist "%SKY_DIR%" mkdir "%SKY_DIR%"
if not exist "%OCT_DIR%" mkdir "%OCT_DIR%"
if not exist "%RESULTS_DIR%" mkdir "%RESULTS_DIR%"

REM 1. Generate Sky Description using gensky
echo 1. Generating sky...
set "SKY_FILE=%SKY_DIR%\\%PROJECT_NAME%_%MONTH%_%DAY%_%TIME%.rad"
gensky %MONTH% %DAY% %TIME% -a %LATITUDE% -o %LONGITUDE% -m %MERIDIAN% > "%SKY_FILE%"

REM 2. Create Scene Octree using oconv
echo 2. Creating octree...
set "OCTREE_FILE=%OCT_DIR%\\%PROJECT_NAME%.oct"

REM Combine geometry, sky, and lights into a temporary file for oconv
(
    type "%GEOM_FILE%"
    echo.
    type "%MAT_FILE%"
    echo.
    type "%SKY_FILE%"
    echo.
    (
${lightDefs.split('\n').map(line => `        echo ${line}`).join('\n')}
    )
) > "%TEMP_RAD_FILE%"

oconv "%TEMP_RAD_FILE%" > "%OCTREE_FILE%"
if %errorlevel% neq 0 (
    echo "Error during oconv."
    del "%TEMP_RAD_FILE%"
    exit /b 1
)
del "%TEMP_RAD_FILE%"

REM 3. Run Illuminance Calculation with rtrace
echo 3. Calculating illuminance values...
set "RESULTS_FILE=%RESULTS_DIR%\\%PROJECT_NAME%_illuminance.txt"

(rtrace ${rtraceMode} ${rtraceSwitches} -ab %AB% -ad %AD% -as %AS% -ar %AR% -aa %AA% "%OCTREE_FILE%" < "%POINTS_FILE%") | rcalc -e "$1=179*(0.265*$1 + 0.670*$2 + 0.065*$3)" > "%RESULTS_FILE%"
if %errorlevel% neq 0 ( echo "Error during rtrace." & exit /b 1 )

echo ---
echo Simulation complete. Results saved to: "%RESULTS_FILE%"
echo ---
`;

    return {
        sh: { fileName: `RUN_${projectName}_Illuminance.sh`, content: shContent },
        bat: { fileName: `RUN_${projectName}_Illuminance.bat`, content: batContent }
    };
}

function createRenderImageScript(projectData) {
    const { projectInfo: pi, mergedSimParams: p } = projectData;
    
    const projectName = pi['project-name'].replace(/\s+/g, '_') || 'scene';
    
    const lat = pi.latitude || 0;
    const lon = pi.longitude || 0;
    const mer = (Math.round(lon / 15) * 15) * -1;
    const month = p['pit-month'] || 6;
    const day = p['pit-day'] || 21;
    const time = (p['pit-time'] || '12:00').replace(':', '.');
    const ab = p['ab'] || 4;
    const ad = p['ad'] || 1024;
    const as = p['as'] || 512;
    const ar = p['ar'] || 512;
    const aa = p['aa'] || 0.2;
    const xRes = p['rpict-x'] || 1280;
    const yRes = p['rpict-y'] || 720;
    
    const rpictSwitches = `${p['rpict-i'] ? '-i' : ''} ${p['rpict-dv'] ? '-dv' : ''} ${p['rpict-bv'] ? '-bv' : ''} ${p['rpict-w'] ? '-w' : ''}`.trim();
    
    const ps = p['rpict-ps'] || 8;
    const pt = p['rpict-pt'] || 0.05;
    const pj = p['rpict-pj'] || 0.9;
    const lightDefs = generateLightSourceDefinitions(projectData.lighting, projectData.geometry.room);

    const shContent = `#!/bin/bash
# RUN_Rendering.sh
# Script to render a point-in-time image.
# Generated by Ray Modeler.

# --- Simulation Configuration ---
PROJECT_NAME="${projectName}"
LATITUDE=${lat}
LONGITUDE=${lon}
MERIDIAN=${mer}
MONTH=${month}
DAY=${day}
TIME=${time}

# --- Ambient & Rendering Parameters ---
AB=${ab}; AD=${ad}; AS=${as}; AR=${ar}; AA=${aa}
X_RES=${xRes}; Y_RES=${yRes}
PS=${ps}; PT=${pt}; PJ=${pj}

# --- File & Directory Setup ---
GEOM_FILE="../01_geometry/\${PROJECT_NAME}.rad"
MAT_FILE="../02_materials/\${PROJECT_NAME}_materials.rad"
VIEW_FILE="../03_views/viewpoint.vf"
SKY_DIR="../04_skies"
OCT_DIR="../06_octrees"
IMG_DIR="../09_images/hdr"

mkdir -p \$SKY_DIR \$OCT_DIR \$IMG_DIR

# 1. Generate Sky Description
echo "1. Generating sky..."
SKY_FILE="\${SKY_DIR}/\${PROJECT_NAME}_sky.rad"
gensky \${MONTH} \${DAY} \${TIME} -a \${LATITUDE} -o \${LONGITUDE} -m \${MERIDIAN} > "\${SKY_FILE}"

# 2. Create Scene Octree
echo "2. Creating octree..."
OCTREE_FILE="\${OCT_DIR}/\${PROJECT_NAME}.oct"
(
cat "\${GEOM_FILE}"
cat "\${MAT_FILE}"
echo
cat "\${SKY_FILE}"
echo
echo "${lightDefs}"
) | oconv - > "\${OCTREE_FILE}"
if [ \$? -ne 0 ]; then echo "Error during oconv."; exit 1; fi

# 3. Render the Image with rpict
echo "3. Rendering HDR image..."
HDR_IMAGE="\${IMG_DIR}/\${PROJECT_NAME}.hdr"
rpict -vf "\${VIEW_FILE}" -x \${X_RES} -y \${Y_RES} \\
    -ab \${AB} -ad \${AD} -as \${AS} -ar \${AR} -aa \${AA} \\
    -ps \${PS} -pt \${PT} -pj \${PJ} \\
    ${rpictSwitches} \\
    "\${OCTREE_FILE}" > "\${HDR_IMAGE}"
if [ \$? -ne 0 ]; then echo "Error during rpict."; exit 1; fi

echo "---"
echo "Rendering complete. HDR image saved to: \${HDR_IMAGE}"
echo "---"
`;

    const batContent = `@echo off
REM RUN_Rendering.bat
REM Script to render a point-in-time image.
REM Generated by Ray Modeler.

REM --- Simulation Configuration ---
set "PROJECT_NAME=${projectName}"
set "LATITUDE=${lat}"
set "LONGITUDE=${lon}"
set "MERIDIAN=${mer}"
set "MONTH=${month}"
set "DAY=${day}"
set "TIME=${time}"

REM --- Ambient & Rendering Parameters ---
set "AB=${ab}"
set "AD=${ad}"
set "AS=${as}"
set "AR=${ar}"
set "AA=${aa}"
set "X_RES=${xRes}"
set "Y_RES=${yRes}"
set "PS=${ps}"
set "PT=${pt}"
set "PJ=${pj}"

REM --- File & Directory Setup ---
set "GEOM_FILE=..\\01_geometry\\%PROJECT_NAME%.rad"
set "VIEW_FILE=..\\03_views\\viewpoint.vf"
set "SKY_DIR=..\\04_skies"
set "OCT_DIR=..\\06_octrees"
set "IMG_DIR=..\\09_images\\hdr"
set "TEMP_RAD_FILE=..\\06_octrees\\temp_scene.rad"

if not exist "%SKY_DIR%" mkdir "%SKY_DIR%"
if not exist "%OCT_DIR%" mkdir "%OCT_DIR%"
if not exist "%IMG_DIR%" mkdir "%IMG_DIR%"

REM 1. Generate Sky Description
echo 1. Generating sky...
set "SKY_FILE=%SKY_DIR%\\%PROJECT_NAME%_sky.rad"
gensky %MONTH% %DAY% %TIME% -a %LATITUDE% -o %LONGITUDE% -m %MERIDIAN% > "%SKY_FILE%"

REM 2. Create Scene Octree
echo 2. Creating octree...
set "OCTREE_FILE=%OCT_DIR%\\%PROJECT_NAME%.oct"

(
    type "%GEOM_FILE%"
    echo.
    type "%MAT_FILE%"
    echo.
    type "%SKY_FILE%"
    echo.
    (
${lightDefs.split('\n').map(line => `        echo ${line}`).join('\n')}
    )
) > "%TEMP_RAD_FILE%"

oconv "%TEMP_RAD_FILE%" > "%OCTREE_FILE%"
if %errorlevel% neq 0 (
    echo "Error during oconv."
    del "%TEMP_RAD_FILE%"
    exit /b 1
)
del "%TEMP_RAD_FILE%"

REM 3. Render the Image with rpict
echo 3. Rendering HDR image...
set "HDR_IMAGE=%IMG_DIR%\\%PROJECT_NAME%.hdr"
rpict -vf "%VIEW_FILE%" -x %X_RES% -y %Y_RES% -ab %AB% -ad %AD% -as %AS% -ar %AR% -aa %AA% -ps %PS% -pt %PT% -pj %PJ% ${rpictSwitches} "%OCTREE_FILE%" > "%HDR_IMAGE%"
if %errorlevel% neq 0 ( echo "Error during rpict." & exit /b 1 )

echo ---
echo Rendering complete. HDR image saved to: "%HDR_IMAGE%"
echo ---
`;

    return {
        sh: { fileName: `RUN_${projectName}_Rendering.sh`, content: shContent },
        bat: { fileName: `RUN_${projectName}_Rendering.bat`, content: batContent }
    };
}

function createDgpAnalysisScript(projectData) {
    const { projectInfo: pi, mergedSimParams: p } = projectData;
    const projectName = pi['project-name'].replace(/\s+/g, '_') || 'scene';
    const lat = pi.latitude || 0;
    const lon = pi.longitude || 0;
    const mer = (Math.round(lon / 15) * 15) * -1;
    const month = p['pit-month'] || 6;
    const day = p['pit-day'] || 21;
    const time = (p['pit-time'] || '14:30').replace(':', '.');
    // High-quality parameters are essential for glare, so we use higher defaults.
    const ab = p['ab'] || 6;
    const ad = p['ad'] || 2048;
    const as = p['as'] || 1024;
    const ar = p['ar'] || 512;
    const aa = p['aa'] || 0.15;
    const xRes = p['dgp-x-res'] || 1500; // Use parameter, fallback to 1500
    const yRes = p['dgp-y-res'] || 1500; // Use parameter, fallback to 1500
    const evalglareSwitches = `${p['evalglare-c'] ? `-c ${projectName}_glare_check.hdr` : ''} ${p['evalglare-d'] ? '-d' : ''} ${p['evalglare-t'] ? '-t' : ''}`.trim();
    const lightDefs = generateLightSourceDefinitions(projectData.lighting, projectData.geometry.room);

    const shContent = `#!/bin/bash
# RUN_DGP_Analysis.sh
# Script to run a Daylight Glare Probability (DGP) analysis.
# Generated by Ray Modeler.

# --- Simulation Configuration ---
PROJECT_NAME="${projectName}"
LATITUDE=${lat}
LONGITUDE=${lon}
MERIDIAN=${mer}
MONTH=${month}
DAY=${day}
TIME=${time}

# Ambient Parameters (High Quality is ESSENTIAL for glare)
AB=${ab}; AD=${ad}; AS=${as}; AR=${ar}; AA=${aa}

# --- File & Directory Setup ---
GEOM_FILE="../01_geometry/\${PROJECT_NAME}.rad"
MAT_FILE="../02_materials/\${PROJECT_NAME}_materials.rad"
VIEW_FILE="../03_views/viewpoint_fisheye.vf"
SKY_DIR="../04_skies"
OCT_DIR="../06_octrees"
RESULTS_DIR="../08_results"
IMG_DIR="../09_images/hdr"
mkdir -p \$SKY_DIR \$OCT_DIR \$RESULTS_DIR \$IMG_DIR

# 1. Generate Sky
echo "1. Generating sky..."
SKY_FILE="\${SKY_DIR}/\${PROJECT_NAME}_sky.rad"
gensky \${MONTH} \${DAY} \${TIME} -a \${LATITUDE} -o \${LONGITUDE} -m \${MERIDIAN} > "\${SKY_FILE}"

echo "2. Creating octree..."
OCTREE_FILE="\${OCT_DIR}/\${PROJECT_NAME}.oct"
(
cat "\${GEOM_FILE}"
cat "\${MAT_FILE}"
echo
cat "\${SKY_FILE}"
echo
echo "${lightDefs}"
) | oconv - > "\${OCTREE_FILE}"
if [ \$? -ne 0 ]; then echo "Error during oconv."; exit 1; fi

# 3. Render 180-degree Fisheye Image
echo "3. Rendering fisheye HDR..."
HDR_IMAGE="\${IMG_DIR}/\${PROJECT_NAME}_glare.hdr"
rpict -vf "\${VIEW_FILE}" -x ${xRes} -y ${yRes} \\
    -ab \${AB} -ad \${AD} -as \${AS} -ar \${AR} -aa \${AA} \\
    "\${OCTREE_FILE}" > "\${HDR_IMAGE}"
if [ \$? -ne 0 ]; then echo "Error during rpict."; exit 1; fi

# 4. Run evalglare to Calculate DGP
echo "4. Calculating DGP..."
GLARE_RESULTS="\${RESULTS_DIR}/\${PROJECT_NAME}_dgp.txt"
GLARE_CHECK_IMG="../09_images/hdr/\${PROJECT_NAME}_glare_check.hdr"

# evalglare outputs check file to the current directory, so we temporarily change to it
pushd "\${IMG_DIR}" > /dev/null
evalglare ${evalglareSwitches} "\${PROJECT_NAME}_glare.hdr" > "\${GLARE_RESULTS}"
popd > /dev/null
if [ \$? -ne 0 ]; then echo "Error during evalglare."; exit 1; fi

echo "---"
echo "Glare analysis complete."
echo "DGP results saved to: \${GLARE_RESULTS}"
if [ -f "\${GLARE_CHECK_IMG}" ]; then
    echo "Verification image saved to: \${GLARE_CHECK_IMG}"
fi
echo "---"
`;

    const batContent = `@echo off
REM RUN_DGP_Analysis.bat
REM Script to run a Daylight Glare Probability (DGP) analysis.
REM Generated by Ray Modeler.

REM --- Simulation Configuration ---
set "PROJECT_NAME=${projectName}"
set "LATITUDE=${lat}"
set "LONGITUDE=${lon}"
set "MERIDIAN=${mer}"
set "MONTH=${month}"
set "DAY=${day}"
set "TIME=${time}"

REM Ambient Parameters (High Quality is ESSENTIAL for glare)
set "AB=${ab}"
set "AD=${ad}"
set "AS=${as}"
set "AR=${ar}"
set "AA=${aa}"

REM --- File & Directory Setup ---
set "GEOM_FILE=..\\01_geometry\\%PROJECT_NAME%.rad"
set "VIEW_FILE=..\\03_views\\viewpoint_fisheye.vf"
set "SKY_DIR=..\\04_skies"
set "OCT_DIR=..\\06_octrees"
set "RESULTS_DIR=..\\08_results"
set "IMG_DIR=..\\09_images\\hdr"
set "TEMP_RAD_FILE=..\\06_octrees\\temp_scene.rad"

if not exist "%SKY_DIR%" mkdir "%SKY_DIR%"
if not exist "%OCT_DIR%" mkdir "%OCT_DIR%"
if not exist "%RESULTS_DIR%" mkdir "%RESULTS_DIR%"
if not exist "%IMG_DIR%" mkdir "%IMG_DIR%"

REM 1. Generate Sky
echo 1. Generating sky...
set "SKY_FILE=%SKY_DIR%\\%PROJECT_NAME%_sky.rad"
gensky %MONTH% %DAY% %TIME% -a %LATITUDE% -o %LONGITUDE% -m %MERIDIAN% > "%SKY_FILE%"

REM 2. Create Octree
echo 2. Creating octree...
set "OCTREE_FILE=%OCT_DIR%\\%PROJECT_NAME%.oct"
(
    type "%GEOM_FILE%"
    echo.
    type "%MAT_FILE%"
    echo.
    type "%SKY_FILE%"
    echo.
    (
${lightDefs.split('\n').map(line => `        echo ${line}`).join('\n')}
    )
) > "%TEMP_RAD_FILE%"

oconv "%TEMP_RAD_FILE%" > "%OCTREE_FILE%"
if %errorlevel% neq 0 (
    echo "Error during oconv."
    del "%TEMP_RAD_FILE%"
    exit /b 1
)
del "%TEMP_RAD_FILE%"

REM 3. Render 180-degree Fisheye Image
echo 3. Rendering fisheye HDR...
set "HDR_IMAGE=%IMG_DIR%\\%PROJECT_NAME%_glare.hdr"
rpict -vf "%VIEW_FILE%" -x ${xRes} -y ${yRes} -ab %AB% -ad %AD% -as %AS% -ar %AR% -aa %AA% "%OCTREE_FILE%" > "%HDR_IMAGE%"
if %errorlevel% neq 0 ( echo "Error during rpict." & exit /b 1 )

REM 4. Run evalglare to Calculate DGP
echo 4. Calculating DGP...
set "GLARE_RESULTS=%RESULTS_DIR%\\%PROJECT_NAME%_dgp.txt"
set "GLARE_CHECK_IMG=..\\09_images\\hdr\\%PROJECT_NAME%_glare_check.hdr"

REM evalglare outputs check file to the current directory, so we temporarily change to it
pushd "%IMG_DIR%"
evalglare ${evalglareSwitches} "%PROJECT_NAME%_glare.hdr" > "%GLARE_RESULTS%"
popd
if %errorlevel% neq 0 ( echo "Error during evalglare." & exit /b 1 )

echo ---
echo Glare analysis complete.
echo DGP results saved to: "%GLARE_RESULTS%"
if exist "%GLARE_CHECK_IMG%" (
    echo Verification image saved to: "%GLARE_CHECK_IMG%"
)
echo ---
`;

    return {
        sh: { fileName: `RUN_${projectName}_DGP_Analysis.sh`, content: shContent },
        bat: { fileName: `RUN_${projectName}_DGP_Analysis.bat`, content: batContent }
    };
}

function createDaylightFactorScript(projectData) {
    const { projectInfo: pi, mergedSimParams: p } = projectData;
    const projectName = pi['project-name'].replace(/\s+/g, '_') || 'scene';
    const ab = p['ab'] || 4;
    const ad = p['ad'] || 1024;
    const as = p['as'] || 512;
    const ar = p['ar'] || 512;
    const aa = p['aa'] || 0.2;
    const skyType = p['df-sky-type'] || '-c';
    const groundRefl = p['df-ground-refl'] || 0.2;
    // For a standard 10,000 lux exterior illuminance, B should be 55.866 W/m^2 for a CIE overcast sky
    const horizIrrad = p['df-irrad'] || 55.866;
    const lightDefs = generateLightSourceDefinitions(projectData.lighting, projectData.geometry.room);

    const shContent = `#!/bin/bash
# RUN_Daylight_Factor.sh
# Script to run a Daylight Factor (DF) analysis.
# Generated by Ray Modeler.

# --- Simulation Configuration ---
PROJECT_NAME="${projectName}"
AB=${ab}; AD=${ad}; AS=${as}; AR=${ar}; AA=${aa}
EXT_LUX=10000 # Reference exterior horizontal illuminance for DF calculation

# --- File & Directory Setup ---
GEOM_FILE="../01_geometry/\${PROJECT_NAME}.rad"
MAT_FILE="../02_materials/\${PROJECT_NAME}_materials.rad"
SKY_DIR="../04_skies"
OCT_DIR="../06_octrees"
RESULTS_DIR="../08_results"
POINTS_FILE="../08_results/grid.pts"
mkdir -p \$SKY_DIR \$OCT_DIR \$RESULTS_DIR

# 1. Generate Sky with a known exterior illuminance
echo "1. Generating sky for DF calculation..."
SKY_FILE="\${SKY_DIR}/\${PROJECT_NAME}_df_sky.rad"
gensky ${skyType} -g ${groundRefl} -B ${horizIrrad} > "\${SKY_FILE}"

echo "2. Creating octree..."
OCTREE_FILE="\${OCT_DIR}/\${PROJECT_NAME}.oct"
(
cat "\${GEOM_FILE}"
cat "\${MAT_FILE}"
echo
cat "\${SKY_FILE}"
echo
echo "${lightDefs}"
) | oconv - > "\${OCTREE_FILE}"
if [ \$? -ne 0 ]; then echo "Error during oconv."; exit 1; fi

# 3. Calculate Interior Illuminance
echo "3. Calculating interior illuminance..."
INTERIOR_IRRADIANCE="\${RESULTS_DIR}/interior_irradiance.dat"
rtrace -I -h -w -ab \${AB} -ad \${AD} -as \${AS} -ar \${AR} -aa \${AA} "\${OCTREE_FILE}" < "\${POINTS_FILE}" > "\${INTERIOR_IRRADIANCE}" 
if [ \$? -ne 0 ]; then echo "Error during rtrace."; exit 1; fi

# 4. Calculate Daylight Factor
# This converts the interior irradiance to illuminance and divides by the exterior reference.
echo "4. Calculating DF..."
DF_RESULTS="\${RESULTS_DIR}/\${PROJECT_NAME}_df_results.txt"
cat "\${INTERIOR_IRRADIANCE}" | rcalc -e "$1=100 * (179*($1*0.265+$2*0.670+$3*0.065)) / \${EXT_LUX}" > "\${DF_RESULTS}"

echo "---"
echo "DF analysis complete. Results saved to: \${DF_RESULTS}"
echo "---"
`;

    const batContent = `@echo off
REM RUN_Daylight_Factor.bat
REM Script to run a Daylight Factor (DF) analysis.
REM Generated by Ray Modeler.

REM --- Simulation Configuration ---
set "PROJECT_NAME=${projectName}"
set "AB=${ab}"
set "AD=${ad}"
set "AS=${as}"
set "AR=${ar}"
set "AA=${aa}"
set "EXT_LUX=10000"

REM --- File & Directory Setup ---
set "GEOM_FILE=..\\01_geometry\\%PROJECT_NAME%.rad"
set "SKY_DIR=..\\04_skies"
set "OCT_DIR=..\\06_octrees"
set "RESULTS_DIR=..\\08_results"
set "POINTS_FILE=..\\08_results\\grid.pts"
set "TEMP_RAD_FILE=..\\06_octrees\\temp_scene.rad"

if not exist "%SKY_DIR%" mkdir "%SKY_DIR%"
if not exist "%OCT_DIR%" mkdir "%OCT_DIR%"
if not exist "%RESULTS_DIR%" mkdir "%RESULTS_DIR%"

REM 1. Generate Sky with a known exterior illuminance
echo 1. Generating sky for DF calculation...
set "SKY_FILE=%SKY_DIR%\\%PROJECT_NAME%_df_sky.rad"
gensky ${skyType} -g ${groundRefl} -B ${horizIrrad} > "%SKY_FILE%"

REM 2. Create Scene Octree
echo 2. Creating octree...
set "OCTREE_FILE=%OCT_DIR%\\%PROJECT_NAME%.oct"
(
    type "%GEOM_FILE%"
    echo.
    type "%MAT_FILE%"
    echo.
    type "%SKY_FILE%"
    echo.
    (
${lightDefs.split('\n').map(line => `        echo ${line}`).join('\n')}
    )
) > "%TEMP_RAD_FILE%"

oconv "%TEMP_RAD_FILE%" > "%OCTREE_FILE%"
if %errorlevel% neq 0 (
    echo "Error during oconv."
    del "%TEMP_RAD_FILE%"
    exit /b 1
)
del "%TEMP_RAD_FILE%"

REM 3. Calculate Interior Illuminance
echo 3. Calculating interior illuminance...
set "INTERIOR_IRRADIANCE=%RESULTS_DIR%\\interior_irradiance.dat"
rtrace -I -h -w -ab %AB% -ad %AD% -as %AS% -ar %AR% -aa %AA% "%OCTREE_FILE%" < "%POINTS_FILE%" > "%INTERIOR_IRRADIANCE%"
if %errorlevel% neq 0 ( echo "Error during rtrace." & exit /b 1 )

REM 4. Calculate Daylight Factor
echo 4. Calculating DF...
set "DF_RESULTS=%RESULTS_DIR%\\%PROJECT_NAME%_df_results.txt"
(type "%INTERIOR_IRRADIANCE%") | rcalc -e "$1=100 * (179*($1*0.265+$2*0.670+$3*0.065)) / %EXT_LUX%" > "%DF_RESULTS%"

echo ---
echo DF analysis complete. Results saved to: "%DF_RESULTS%"
echo ---
`;

    return {
        sh: { fileName: `RUN_${projectName}_Daylight_Factor.sh`, content: shContent },
        bat: { fileName: `RUN_${projectName}_Daylight_Factor.bat`, content: batContent }
    };
}


// --- ============================================= ---
// --- ANNUAL SIMULATION SCRIPT GENERATORS           ---
// --- ============================================= ---

function create3phMatrixGenerationScript(projectData) {
    const { projectInfo: pi, mergedSimParams: p } = projectData;
    const projectName = pi['project-name'].replace(/\s+/g, '_') || 'scene';
    
    // Use high-quality parameters from merged params, with strong defaults for matrix generation
    const ab = p['ab'] || 7;
    const ad = p['ad'] || 4096;
    const as = p['as'] || 2048;
    const ar = p['ar'] || 1024;
    const aa = p['aa'] || 0.1;
    const lw = p['lw'] || 1e-4;
    const lightDefs = generateLightSourceDefinitions(projectData.lighting, projectData.geometry.room);

    const shContent = `#!/bin/bash
# RUN_3ph_Matrix_Generation.sh
# Generates the Daylight and View matrices for a 3-Phase simulation.
# This is a computationally intensive step.
# Generated by Ray Modeler.

# --- Configuration ---
PROJECT_NAME="${projectName}"
# High-quality parameters are essential for matrix generation
AB=${ab}; AD=${ad}; AS=${as}; AR=${ar}; AA=${aa}; LW=${lw}

# --- File & Directory Setup ---
GEOM_FILE="../01_geometry/\${PROJECT_NAME}.rad"
MAT_FILE="../02_materials/\${PROJECT_NAME}_materials.rad"
OCT_DIR="../06_octrees"
RESULTS_DIR="../08_results"
MATRIX_DIR="\${RESULTS_DIR}/matrices"
POINTS_FILE="../08_results/grid.pts"

mkdir -p \$OCT_DIR \$RESULTS_DIR \$MATRIX_DIR

# --- Main Script ---
# 1. Create Master Octree
echo "1. Creating master octree..."
OCTREE="\${OCT_DIR}/\${PROJECT_NAME}.oct"
(
cat "\${GEOM_FILE}"
cat "\${MAT_FILE}"
echo
echo "${lightDefs}"
) | oconv - > "\${OCTREE}"
if [ \$? -ne 0 ]; then echo "Error creating master octree."; exit 1; fi

# 2. Generate Daylight Matrix (D)
# The sender is the glazing, the receiver is the sky.
echo "2. Generating Daylight Matrix (D)..."
DAYLIGHT_MTX="\${MATRIX_DIR}/daylight.mtx"
rcontrib -I+ -w -ab \${AB} -ad \${AD} -as \${AS} -ar \${AR} -aa \${AA} -lw \${LW} \\
    -f reinhart.cal -b tbin -bn 145 -m sky_glow \\
    -e 'REPLY=material("glass_mat")' \\
    -V- -i "\${OCTREE}" > "\${DAYLIGHT_MTX}"
if [ \$? -ne 0 ]; then echo "Error generating Daylight Matrix."; exit 1; fi


# 3. Generate View Matrix (V)
# The sender is the glazing, the receiver is the sensor points.
echo "3. Generating View Matrix (V)..."
VIEW_MTX="\${MATRIX_DIR}/view.mtx"
rcontrib -I+ -w -ab \${AB} -ad \${AD} -as \${AS} -ar \${AR} -aa \${AA} -lw \${LW} \\
    -f klems_full.cal -b tbin -bn 145 -m glass_mat \\
    "\${OCTREE}" < "\${POINTS_FILE}" > "\${VIEW_MTX}"
if [ \$? -ne 0 ]; then echo "Error generating View Matrix."; exit 1; fi

echo "---"
echo "Matrix generation complete."
echo "Daylight Matrix: \${DAYLIGHT_MTX}"
echo "View Matrix: \${VIEW_MTX}"
echo "---"
`;

    const batContent = `@echo off
REM RUN_3ph_Matrix_Generation.bat
REM Generates the Daylight and View matrices for a 3-Phase simulation.
REM This is a computationally intensive step.
REM Generated by Ray Modeler.

REM --- Configuration ---
set "PROJECT_NAME=${projectName}"
REM High-quality parameters are essential for matrix generation
set "AB=${ab}"
set "AD=${ad}"
set "AS=${as}"
set "AR=${ar}"
set "AA=${aa}"
set "LW=${lw}"

REM --- File & Directory Setup ---
set "GEOM_FILE=..\\01_geometry\\%PROJECT_NAME%.rad"
set "OCT_DIR=..\\06_octrees"
set "RESULTS_DIR=..\\08_results"
set "MATRIX_DIR=%RESULTS_DIR%\\matrices"
set "POINTS_FILE=%RESULTS_DIR%\\grid.pts"
set "TEMP_RAD_FILE=..\\06_octrees\\temp_scene.rad"

if not exist "%OCT_DIR%" mkdir "%OCT_DIR%"
if not exist "%RESULTS_DIR%" mkdir "%RESULTS_DIR%"
if not exist "%MATRIX_DIR%" mkdir "%MATRIX_DIR%"

REM --- Main Script ---
REM 1. Create Master Octree
echo 1. Creating master octree...
set "OCTREE=%OCT_DIR%\\%PROJECT_NAME%.oct"
(
    type "%GEOM_FILE%"
    echo.
    type "%MAT_FILE%"
    echo.
    (
${lightDefs.split('\n').map(line => `        echo ${line}`).join('\n')}
    )
) > "%TEMP_RAD_FILE%"

oconv "%TEMP_RAD_FILE%" > "%OCTREE%"
if %errorlevel% neq 0 (
    echo "Error creating master octree."
    del "%TEMP_RAD_FILE%"
    exit /b 1
)
del "%TEMP_RAD_FILE%"


REM 2. Generate Daylight Matrix (D)
echo 2. Generating Daylight Matrix (D)...
set "DAYLIGHT_MTX=%MATRIX_DIR%\\daylight.mtx"
rcontrib -I+ -w -ab %AB% -ad %AD% -as %AS% -ar %AR% -aa %AA% -lw %LW% -f reinhart.cal -b tbin -bn 145 -m sky_glow -e "REPLY=material('glass_mat')" -V- -i "%OCTREE%" > "%DAYLIGHT_MTX%"
if %errorlevel% neq 0 ( echo "Error generating Daylight Matrix." & exit /b 1 )


REM 3. Generate View Matrix (V)
echo 3. Generating View Matrix (V)...
set "VIEW_MTX=%MATRIX_DIR%\\view.mtx"
rcontrib -I+ -w -ab %AB% -ad %AD% -as %AS% -ar %AR% -aa %AA% -lw %LW% -f klems_full.cal -b tbin -bn 145 -m glass_mat "%OCTREE%" < "%POINTS_FILE%" > "%VIEW_MTX%"
if %errorlevel% neq 0 ( echo "Error generating View Matrix." & exit /b 1 )

echo ---
echo Matrix generation complete.
echo Daylight Matrix: %DAYLIGHT_MTX%
echo View Matrix: %VIEW_MTX%
echo ---
`;

    return {
        sh: { fileName: `RUN_${projectName}_3ph_Matrix_Generation.sh`, content: shContent },
        bat: { fileName: `RUN_${projectName}_3ph_Matrix_Generation.bat`, content: batContent }
    };
}

function create3phAnnualSimScript(projectData) {
    const { projectInfo: pi, mergedSimParams: p } = projectData;
    const projectName = pi['project-name'].replace(/\s+/g, '_') || 'scene';
    const epwFileName = p['weather-file'] ? p['weather-file'].name : 'weather.epw';
    const bsdfFileName = p['bsdf-file'] ? p['bsdf-file'].name : 'window.xml';

    const shContent = `#!/bin/bash
# RUN_3ph_Annual_Simulation.sh
# Runs the final annual calculation using pre-computed matrices for the 3-Phase Method.
# Generated by Ray Modeler.

# --- Configuration ---
PROJECT_NAME="${projectName}"
WEATHER_FILE="../04_skies/${epwFileName}"
BSDF_FILE="../05_bsdf/${bsdfFileName}"

# --- File & Directory Setup ---
RESULTS_DIR="../08_results"
MATRIX_DIR="\${RESULTS_DIR}/matrices"
SKY_DIR="../04_skies" # gendaymtx might output files here

# --- Main Script ---
# 1. Generate Sky Matrix from Weather File
echo "1. Generating sky matrix from EPW file..."
SKY_MTX="\${MATRIX_DIR}/sky.smx"
epw2wea "\${WEATHER_FILE}" | gendaymtx -m 1 - > "\${SKY_MTX}"
if [ \$? -ne 0 ]; then echo "Error generating Sky Matrix."; exit 1; fi

# 2. Run dctimestep to get annual results
echo "2. Running dctimestep for annual simulation..."
DAYLIGHT_MTX="\${MATRIX_DIR}/daylight.mtx"
VIEW_MTX="\${MATRIX_DIR}/view.mtx"
ANNUAL_RESULTS="\${RESULTS_DIR}/\${PROJECT_NAME}.ill"
dctimestep "\${VIEW_MTX}" "\${BSDF_FILE}" "\${DAYLIGHT_MTX}" "\${SKY_MTX}" > "\${ANNUAL_RESULTS}"
if [ \$? -ne 0 ]; then echo "Error during dctimestep."; exit 1; fi

echo "---"
echo "Annual simulation complete."
echo "Annual illuminance results saved to: \${ANNUAL_RESULTS}"
echo "Run post_process_annual.py on this file to get sDA/UDI metrics."
echo "---"
`;

    const batContent = `@echo off
REM RUN_3ph_Annual_Simulation.bat
REM Runs the final annual calculation using pre-computed matrices for the 3-Phase Method.
REM Generated by Ray Modeler.

REM --- Configuration ---
set "PROJECT_NAME=${projectName}"
set "WEATHER_FILE=..\\04_skies\\${epwFileName}"
set "BSDF_FILE=..\\05_bsdf\\${bsdfFileName}"

REM --- File & Directory Setup ---
set "RESULTS_DIR=..\\08_results"
set "MATRIX_DIR=%RESULTS_DIR%\\matrices"
set "SKY_DIR=..\\04_skies"

REM --- Main Script ---
REM 1. Generate Sky Matrix from Weather File
echo 1. Generating sky matrix from EPW file...
set "SKY_MTX=%MATRIX_DIR%\\sky.smx"
(epw2wea "%WEATHER_FILE%") | gendaymtx -m 1 - > "%SKY_MTX%"
if %errorlevel% neq 0 ( echo "Error generating Sky Matrix." & exit /b 1 )

REM 2. Run dctimestep to get annual results
echo 2. Running dctimestep for annual simulation...
set "DAYLIGHT_MTX=%MATRIX_DIR%\\daylight.mtx"
set "VIEW_MTX=%MATRIX_DIR%\\view.mtx"
set "ANNUAL_RESULTS=%RESULTS_DIR%\\%PROJECT_NAME%.ill"
dctimestep "%VIEW_MTX%" "%BSDF_FILE%" "%DAYLIGHT_MTX%" "%SKY_MTX%" > "%ANNUAL_RESULTS%"
if %errorlevel% neq 0 ( echo "Error during dctimestep." & exit /b 1 )

echo ---
echo Annual simulation complete.
echo Annual illuminance results saved to: "%ANNUAL_RESULTS%"
echo Run post_process_annual.py on this file to get sDA/UDI metrics.
echo ---
`;

    return {
        sh: { fileName: `RUN_${projectName}_3ph_Annual_Simulation.sh`, content: shContent },
        bat: { fileName: `RUN_${projectName}_3ph_Annual_Simulation.bat`, content: batContent }
    };
}

function create5phMatrixGenerationScript(projectData) {
    const { projectInfo: pi, mergedSimParams: p } = projectData;
    const projectName = pi['project-name'].replace(/\s+/g, '_') || 'scene';
    const epwFile = p['weather-file']?.name || 'weather.epw';
    const klemsFile = p['bsdf-klems']?.name || 'klems.xml';

    // Use high-quality settings from merged params for matrix generation
    const ab = p['ab'] || 7;
    const ad = p['ad'] || 4096;
    const as = p['as'] || 2048;
    const ar = p['ar'] || 1024;
    const aa = p['aa'] || 0.1;
    const lw = p['lw'] || 1e-4;
    const lightDefs = generateLightSourceDefinitions(projectData.lighting, projectData.geometry.room);

    const shContent = `#!/bin/bash
# RUN_5ph_Matrix_Generation.sh 
# A script to run a full 5-Phase Method annual simulation.
# This script generates all required matrices and then performs the final calculation.
# Generated by Ray Modeler.

# --- Configuration ---
PROJECT_NAME="${projectName}"
WEATHER_FILE="../04_skies/${epwFile}"
BSDF_FILE="../05_bsdf/${klemsFile}"

# High-quality parameters for matrix generation
AB=${ab}; AD=${ad}; AS=${as}; AR=${ar}; AA=${aa}; LW=${lw}

# --- File & Directory Setup ---
GEOM_FILE="../01_geometry/\${PROJECT_NAME}.rad"
MAT_FILE="../02_materials/\${PROJECT_NAME}_materials.rad"
OCT_DIR="../06_octrees"
RESULTS_DIR="../08_results"
MATRIX_DIR="\${RESULTS_DIR}/matrices"
POINTS_FILE="../08_results/grid.pts"
mkdir -p \$OCT_DIR \$RESULTS_DIR \$MATRIX_DIR

echo "--- Starting 5-Phase Simulation Workflow ---"

# 1. Create Master Octree (contains all geometry and materials)
echo "1. Creating master octree..."
OCTREE="\${OCT_DIR}/\${PROJECT_NAME}.oct"
(
cat "\${GEOM_FILE}"
cat "\${MAT_FILE}"
echo
echo "${lightDefs}"
) | oconv - > "\${OCTREE}"
if [ \$? -ne 0 ]; then echo "Error during oconv."; exit 1; fi

# 2. Generate Annual Sky Matrix (S)
echo "2. Generating annual sky matrix from EPW..."
SKY_MTX="\${MATRIX_DIR}/sky.mtx"
gendaymtx -m 1 "\${WEATHER_FILE}" > "\${SKY_MTX}"
if [ \$? -ne 0 ]; then echo "Error generating Sky Matrix."; exit 1; fi

# 3. Generate Daylight Matrix (D)
echo "3. Generating Daylight Matrix (D)..."
DAYLIGHT_MTX="\${MATRIX_DIR}/daylight.mtx"
rcontrib -I+ -w -ab \$AB -ad \$AD -as \$AS -ar \$AR -aa \$AA -lw \$LW \\
    -f reinhart.cal -b tbin -bn 145 -m sky_glow \\
    -e 'REPLY=material("glass_mat")' \\
    -V- -i "\${OCTREE}" > "\${DAYLIGHT_MTX}"
if [ \$? -ne 0 ]; then echo "Error generating Daylight Matrix."; exit 1; fi

# 4. Generate View Matrix (V)
echo "4. Generating View Matrix (V)..."
VIEW_MTX="\${MATRIX_DIR}/view.mtx"
rcontrib -I+ -w -ab \$AB -ad \$AD -as \$AS -ar \$AR -aa \$AA -lw \$LW \\
    -f klems_full.cal -b tbin -bn 145 -m glass_mat \\
    "\${OCTREE}" < "\${POINTS_FILE}" > "\${VIEW_MTX}"
if [ \$? -ne 0 ]; then echo "Error generating View Matrix."; exit 1; fi

# 5. Generate Direct Sun-Only Sky Matrix (S_direct)
echo "5. Generating direct-only sun matrix..."
SUN_SKY_MTX="\${MATRIX_DIR}/sun_sky.mtx"
gendaymtx -m 1 -d "\${WEATHER_FILE}" > "\${SUN_SKY_MTX}"
if [ \$? -ne 0 ]; then echo "Error generating Sun Sky Matrix."; exit 1; fi

# 6. Generate Daylight Coefficient Matrix for direct sun (C_ds)
echo "6. Generating direct daylight coefficient matrix (C_ds)..."
CDS_MTX="\${MATRIX_DIR}/cds.mtx"
gendaymtx -d -s "\${WEATHER_FILE}" | rcontrib -I+ -w -ab 1 -ad 1024 -lw 1e-5 \\
    -V- -i "\${OCTREE}" < "\${POINTS_FILE}" > "\${CDS_MTX}"
if [ \$? -ne 0 ]; then echo "Error generating CDS Matrix."; exit 1; fi

# --- PART 7: Combine Matrices for Final Result ---
echo "7. Running dctimestep to combine matrices for final annual result..."

ILL_3PH_TOTAL="\${RESULTS_DIR}/total_3ph.ill"
dctimestep "\${VIEW_MTX}" "\${BSDF_FILE}" "\${DAYLIGHT_MTX}" "\${SKY_MTX}" > "\${ILL_3PH_TOTAL}"
if [ \$? -ne 0 ]; then echo "Error generating total 3-phase result."; exit 1; fi

ILL_3PH_DIRECT="\${RESULTS_DIR}/direct_3ph.ill"
dctimestep "\${VIEW_MTX}" "\${BSDF_FILE}" "\${DAYLIGHT_MTX}" "\${SUN_SKY_MTX}" > "\${ILL_3PH_DIRECT}"
if [ \$? -ne 0 ]; then echo "Error generating direct 3-phase result."; exit 1; fi

# Use the Tensor Tree BSDF for the accurate direct calculation (Phase 5)
TENSOR_BSDF_FILE="../05_bsdf/${p['bsdf-tensor']?.name || 'tensor.xml'}"
ILL_5PH_DIRECT="\${RESULTS_DIR}/direct_5ph.ill"
dctimestep "\${VIEW_MTX}" "\${TENSOR_BSDF_FILE}" "\${DAYLIGHT_MTX}" "\${SUN_SKY_MTX}" > "\${ILL_5PH_DIRECT}"
if [ \$? -ne 0 ]; then echo "Error generating direct 5-phase result."; exit 1; fi

# Final calculation: Total - Inaccurate_Direct + Accurate_Direct
FINAL_RESULTS="\${RESULTS_DIR}/\${PROJECT_NAME}_5ph_final.ill"
rmtxop "\${ILL_3PH_TOTAL}" + -s -1 "\${ILL_3PH_DIRECT}" + "\${ILL_5PH_DIRECT}" > "\${FINAL_RESULTS}"
if [ \$? -ne 0 ]; then echo "Error during final rmtxop calculation."; exit 1; fi

echo "---"
echo "5-Phase simulation complete. Final results saved to: \${FINAL_RESULTS}" 
echo "---"
`;

    const batContent = `@echo off
REM RUN_5ph_Matrix_Generation.bat
REM A script to run a full 5-Phase Method annual simulation.
REM This script generates all required matrices and then performs the final calculation.
REM Generated by Ray Modeler.

REM --- Configuration ---
set "PROJECT_NAME=${projectName}"
set "WEATHER_FILE=..\\04_skies\\${epwFile}"
set "BSDF_FILE=..\\05_bsdf\\${klemsFile}"

REM High-quality parameters for matrix generation
set "AB=${ab}"
set "AD=${ad}"
set "AS=${as}"
set "AR=${ar}"
set "AA=${aa}"
set "LW=${lw}"

REM --- File & Directory Setup ---
set "GEOM_FILE=..\\01_geometry\\%PROJECT_NAME%.rad"
set "OCT_DIR=..\\06_octrees"
set "RESULTS_DIR=..\\08_results"
set "MATRIX_DIR=%RESULTS_DIR%\\matrices"
set "POINTS_FILE=%RESULTS_DIR%\\grid.pts"
set "TEMP_RAD_FILE=..\\06_octrees\\temp_scene.rad"

if not exist "%OCT_DIR%" mkdir "%OCT_DIR%"
if not exist "%RESULTS_DIR%" mkdir "%RESULTS_DIR%"
if not exist "%MATRIX_DIR%" mkdir "%MATRIX_DIR%"

echo --- Starting 5-Phase Simulation Workflow ---

REM 1. Create Master Octree
echo 1. Creating master octree...
set "OCTREE=%OCT_DIR%\\%PROJECT_NAME%.oct"
(
    type "%GEOM_FILE%"
    echo.
    type "%MAT_FILE%"
    echo.
    (
${lightDefs.split('\n').map(line => `        echo ${line}`).join('\n')}
    )
) > "%TEMP_RAD_FILE%"

oconv "%TEMP_RAD_FILE%" > "%OCTREE%"
if %errorlevel% neq 0 ( echo "Error during oconv." & del "%TEMP_RAD_FILE%" & exit /b 1 )
del "%TEMP_RAD_FILE%"

REM 2. Generate Annual Sky Matrix (S)
echo 2. Generating annual sky matrix from EPW...
set "SKY_MTX=%MATRIX_DIR%\\sky.mtx"
(gendaymtx -m 1 "%WEATHER_FILE%") > "%SKY_MTX%"
if %errorlevel% neq 0 ( echo "Error generating Sky Matrix." & exit /b 1 )

REM 3. Generate Daylight Matrix (D)
echo 3. Generating Daylight Matrix (D)...
set "DAYLIGHT_MTX=%MATRIX_DIR%\\daylight.mtx"
rcontrib -I+ -w -ab %AB% -ad %AD% -as %AS% -ar %AR% -aa %AA% -lw %LW% -f reinhart.cal -b tbin -bn 145 -m sky_glow -e "REPLY=material('glass_mat')" -V- -i "%OCTREE%" > "%DAYLIGHT_MTX%"
if %errorlevel% neq 0 ( echo "Error generating Daylight Matrix." & exit /b 1 )

REM 4. Generate View Matrix (V)
echo 4. Generating View Matrix (V)...
set "VIEW_MTX=%MATRIX_DIR%\\view.mtx"
rcontrib -I+ -w -ab %AB% -ad %AD% -as %AS% -ar %AR% -aa %AA% -lw %LW% -f klems_full.cal -b tbin -bn 145 -m glass_mat "%OCTREE%" < "%POINTS_FILE%" > "%VIEW_MTX%"
if %errorlevel% neq 0 ( echo "Error generating View Matrix." & exit /b 1 )

REM 5. Generate Direct Sun-Only Sky Matrix (S_direct)
echo 5. Generating direct-only sun matrix...
set "SUN_SKY_MTX=%MATRIX_DIR%\\sun_sky.mtx"
(gendaymtx -m 1 -d "%WEATHER_FILE%") > "%SUN_SKY_MTX%"
if %errorlevel% neq 0 ( echo "Error generating Sun Sky Matrix." & exit /b 1 )

REM 6. Generate Daylight Coefficient Matrix for direct sun (C_ds)
echo 6. Generating direct daylight coefficient matrix (C_ds)...
set "CDS_MTX=%MATRIX_DIR%\\cds.mtx"
(gendaymtx -d -s "%WEATHER_FILE%") | rcontrib -I+ -w -ab 1 -ad 1024 -lw 1e-5 -V- -i "%OCTREE%" < "%POINTS_FILE%" > "%CDS_MTX%"
if %errorlevel% neq 0 ( echo "Error generating CDS Matrix." & exit /b 1 )

REM --- PART 7: Combine Matrices for Final Result ---
echo 7. Running dctimestep to combine matrices for final annual result...
set "ILL_3PH_TOTAL=%RESULTS_DIR%\\total_3ph.ill"
dctimestep "%VIEW_MTX%" "%BSDF_FILE%" "%DAYLIGHT_MTX%" "%SKY_MTX%" > "%ILL_3PH_TOTAL%"
if %errorlevel% neq 0 ( echo "Error generating total 3-phase result." & exit /b 1 )

set "ILL_3PH_DIRECT=%RESULTS_DIR%\\direct_3ph.ill"
dctimestep "%VIEW_MTX%" "%BSDF_FILE%" "%DAYLIGHT_MTX%" "%SUN_SKY_MTX%" > "%ILL_3PH_DIRECT%"
if %errorlevel% neq 0 ( echo "Error generating direct 3-phase result." & exit /b 1 )

set "ILL_5PH_DIRECT=%RESULTS_DIR%\\direct_5ph.ill"
dctimestep "%CDS_MTX%" "%SUN_SKY_MTX%" > "%ILL_5PH_DIRECT%"
if %errorlevel% neq 0 ( echo "Error generating direct 5-phase result." & exit /b 1 )

REM Final calculation: Total - Inaccurate_Direct + Accurate_Direct
set "FINAL_RESULTS=%RESULTS_DIR%\\%PROJECT_NAME%_5ph_final.ill"
rmtxop "%ILL_3PH_TOTAL%" + -s -1 "%ILL_3PH_DIRECT%" + "%ILL_5PH_DIRECT%" > "%FINAL_RESULTS%"
if %errorlevel% neq 0 ( echo "Error during final rmtxop calculation." & exit /b 1 )

echo ---
echo 5-Phase simulation complete. Final results saved to: "%FINAL_RESULTS%"
echo ---
`;

    return {
        sh: { fileName: `RUN_${projectName}_5ph_Matrix_Generation.sh`, content: shContent },
        bat: { fileName: `RUN_${projectName}_5ph_Matrix_Generation.bat`, content: batContent }
    };
}

function createPostProcessingScript() {
    // This script is a direct copy from the source document.
    const content = `import numpy as np
    import pandas as pd
    import argparse
    import os

    def calculate_metrics(illuminance_file: str, output_dir: str, num_points: int, schedule_file: str | None = None):
        """
        Calculates sDA, UDI, and ASE from a Radiance annual illuminance file.
        Args:
            illuminance_file (str): Path to the .ill file from dctimestep.
            output_dir (str): Directory to save the results CSV.
            num_points (int): The number of sensor points in the simulation grid.
        """
        print(f"Reading annual illuminance data from: {illuminance_file}")
        try:
            # Radiance .ill files are typically 3-channel (RGB) float32
            data = np.fromfile(illuminance_file, dtype=np.float32)
            # Convert RGB to single illuminance value
            rgb_illuminance = data.reshape(8760, num_points, 3)
            annual_illuminance = 179 * (rgb_illuminance[:,:,0]*0.265 + rgb_illuminance[:,:,1]*0.670 + rgb_illuminance[:,:,2]*0.065)
        except Exception as e:
            print(f"Error reading or reshaping file: {e}")
            print("Please ensure the --points argument matches your simulation grid.")
            return
        
        print(f"Data loaded successfully. Shape: {annual_illuminance.shape}")
        
        # Define occupancy schedule
        time_index = pd.to_datetime(pd.date_range(start='2023-01-01', end='2024-01-01', freq='h', inclusive='left'))

        # Default to weekdays, 8 AM to 5 PM if no schedule is provided
        occupied_mask = (time_index.hour >= 8) & (time_index.hour <= 17) & (time_index.dayofweek < 5)

        if schedule_file and os.path.exists(schedule_file):
            print(f"Using occupancy schedule from: {schedule_file}")
            schedule = pd.read_csv(schedule_file, header=None).squeeze("columns")
            if len(schedule) == 8760:
                occupied_mask = schedule.to_numpy(dtype=bool)
            else:
                print(f"Warning: Schedule file does not contain 8760 entries. Using default schedule.")
        else:
            print("No schedule file provided or found. Using default schedule (Mon-Fri, 8am-5pm).")

        occupied_illuminance = annual_illuminance[occupied_mask, :]

        print(f"Processing {occupied_illuminance.shape[0]} occupied hours...")
        
        # --- Metric Calculations ---
        # 1. Spatial Daylight Autonomy (sDA 300/50%)
        lux_threshold_da = 300
        percent_time_threshold_da = 0.5
        hours_above_threshold = np.sum(occupied_illuminance >= lux_threshold_da, axis=0)
        fraction_of_time_above_threshold = hours_above_threshold / occupied_illuminance.shape[0]
        points_meeting_da_criteria = fraction_of_time_above_threshold >= percent_time_threshold_da
        sDA = np.sum(points_meeting_da_criteria) / num_points * 100

        # 2. Useful Daylight Illuminance (UDI)
        udi_f = np.mean(occupied_illuminance < 100, axis=0) * 100
        udi_s = np.mean((occupied_illuminance >= 100) & (occupied_illuminance < 500), axis=0) * 100
        udi_a = np.mean((occupied_illuminance >= 500) & (occupied_illuminance < 2000), axis=0) * 100
        udi_e = np.mean(occupied_illuminance >= 2000, axis=0) * 100

        # 3. Annual Sunlight Exposure (ASE 1000,250)
        # NOTE: Requires input .ill file from a 5-Phase Method simulation.
        lux_threshold_ase = 1000
        hours_threshold_ase = 250
        hours_above_threshold_ase = np.sum(occupied_illuminance >= lux_threshold_ase, axis=0)
        points_meeting_ase_criteria = hours_above_threshold_ase >= hours_threshold_ase
        ASE = np.sum(points_meeting_ase_criteria) / num_points * 100
        
        # --- Save Results ---
        results_df = pd.DataFrame({
            'PointID': range(num_points),
            'UDI_Fell_Short_Percent (<100lx)': udi_f,
            'UDI_Supplementary_Percent (100-500lx)': udi_s,
            'UDI_Autonomous_Percent (500-2000lx)': udi_a,
            'UDI_Exceeded_Percent (>2000lx)': udi_e,
        })
        
        summary = {
            'sDA_300_50%': [f"{sDA:.2f}%"],
            'ASE_1000_250h': [f"{ASE:.2f}%"],
        }
        summary_df = pd.DataFrame(summary)
        
        output_path = os.path.join(output_dir, "annual_metrics_per_point.csv")
        summary_path = os.path.join(output_dir, "annual_metrics_summary.csv")
        
        results_df.to_csv(output_path, index=False)
        summary_df.to_csv(summary_path, index=False)
        
        print("\\n--- Annual Metrics Summary ---")
        print(summary_df.to_string(index=False))
        print("------------------------------")
        print(f"Detailed per-point results saved to: {output_path}")

        if __name__ == "__main__":
            parser = argparse.ArgumentParser(description="Post-process Radiance annual results.")
            parser.add_argument("illuminance_file", type=str, help="Path to the .ill file.")
            parser.add_argument("--points", type=int, required=True, help="Number of sensor points in the grid.")
            parser.add_argument("--outdir", type=str, default="../08_results", help="Output directory for CSV results.")
            parser.add_argument("--schedule", type=str, default=None, help="Optional path to an 8760-hour occupancy schedule CSV file.")
            args = parser.parse_args()

            if not os.path.exists(args.illuminance_file):
                print(f"Error: Input file not found at {args.illuminance_file}")
            else:
                calculate_metrics(args.illuminance_file, args.outdir, args.points, args.schedule)
    `;
    return { fileName: 'post_process_annual.py', content };
}

function createImagelessGlareScript(projectData) {
    const { projectInfo: pi, mergedSimParams: sp } = projectData;
    const projectName = pi['project-name'].replace(/\s+/g, '_') || 'scene';

    const epwFile = sp['weather-file']?.name || 'weather.epw';
    const scheduleFile = sp['occupancy-schedule']?.name;
    const dgpThreshold = sp['glare-threshold'] || 0.4;
    const gaTarget = (sp['glare-autonomy-target'] || 95) / 100.0;

    // Use high-quality settings from merged params for matrix generation
    const ab = sp['ab'] || 8;
    const ad = sp['ad'] || 4096;
    const as = sp['as'] || 1024;
    const ar = sp['ar'] || 512;
    const aa = sp['aa'] || 0.1;
    const lw = sp['lw'] || 0.001;
    const lightDefs = generateLightSourceDefinitions(projectData.lighting, projectData.geometry.room);

    const scheduleFlag = scheduleFile ? `-sff ../10_schedules/${scheduleFile}` : '';

    const shContent = `#!/bin/bash
# RUN_Imageless_Glare.sh
# Script for imageless annual glare analysis using the Accelerad method.
# Generated by Ray Modeler.

# --- Configuration ---
PROJECT_NAME="${projectName}"
WEATHER_FILE="../04_skies/${epwFile}"
VIEW_RAYS_FILE="../08_results/view_grid.ray"
DGP_THRESHOLD=${dgpThreshold}
SGA_TARGET=${gaTarget}

# Radiance Parameters (High quality is crucial)
AB_TOTAL=${ab} # Ambient bounces for total illuminance
AB_DIRECT=1   # Ambient bounces for direct-only calculation
AD=${ad}; AS=${as}; AR=${ar}; AA=${aa}; LW=${lw}

# --- File & Directory Setup ---
GEOM_FILE="../01_geometry/\${PROJECT_NAME}.rad"
MAT_FILE="../02_materials/\${PROJECT_NAME}_materials.rad"
OCT_DIR="../06_octrees"
RESULTS_DIR="../08_results"
MATRIX_DIR="\${RESULTS_DIR}/matrices"
mkdir -p \$OCT_DIR \$RESULTS_DIR \$MATRIX_DIR

echo "--- Starting Imageless Annual Glare Analysis ---"

# 1. Create Octree
echo "1. Creating scene octree..."
OCTREE="\${OCT_DIR}/\${PROJECT_NAME}.oct"
(
cat "\${GEOM_FILE}"
cat "\${MAT_FILE}"
echo
echo "${lightDefs}"
) | oconv - > "\${OCTREE}"
if [ \$? -ne 0 ]; then echo "Error during oconv."; exit 1; fi

# 2. Generate Annual Sky Matrix (S)
echo "2. Generating annual sky matrix from EPW..."
SKY_MTX="\${MATRIX_DIR}/\${PROJECT_NAME}_sky.mtx"
epw2wea "\${WEATHER_FILE}" | gendaymtx -m 1 - > "\${SKY_MTX}"
if [ \$? -ne 0 ]; then echo "Error generating sky matrix."; exit 1; fi

# 3. Generate Direct Daylight Coefficients (D_direct)
echo "3. Generating Direct Daylight Coefficients (-ab \${AB_DIRECT})..."
DC_DIRECT_MTX="\${MATRIX_DIR}/\${PROJECT_NAME}_dc_direct.mtx"
rcontrib -I+ -w -ab \${AB_DIRECT} -ad \${AD} -as \${AS} -ar \${AR} -aa \${AA} -lw \${LW} "\${OCTREE}" < "\${VIEW_RAYS_FILE}" > "\${DC_DIRECT_MTX}"
if [ \$? -ne 0 ]; then echo "Error generating direct DC matrix."; exit 1; fi

# 4. Generate Total Daylight Coefficients (D_total)
echo "4. Generating Total Daylight Coefficients (-ab \${AB_TOTAL})..."
DC_TOTAL_MTX="\${MATRIX_DIR}/\${PROJECT_NAME}_dc_total.mtx"
rcontrib -I+ -w -ab \${AB_TOTAL} -ad \${AD} -as \${AS} -ar \${AR} -aa \${AA} -lw \${LW} "\${OCTREE}" < "\${VIEW_RAYS_FILE}" > "\${DC_TOTAL_MTX}"
if [ \$? -ne 0 ]; then echo "Error generating total DC matrix."; exit 1; fi

# 5. Calculate Annual DGP time-series
echo "5. Calculating annual DGP values..."
DGP_RESULTS="\${RESULTS_DIR}/\${PROJECT_NAME}.dgp"
dcglare -V "\${DC_TOTAL_MTX}" -C "\${DC_DIRECT_MTX}" "\${SKY_MTX}" ${scheduleFlag} > "\${DGP_RESULTS}"
if [ \$? -ne 0 ]; then echo "Error during dcglare for DGP."; exit 1; fi

# 6. Calculate Glare Autonomy (GA)
echo "6. Calculating Glare Autonomy (GA) for a threshold of \${DGP_THRESHOLD}..."
GA_RESULTS="\${RESULTS_DIR}/\${PROJECT_NAME}.ga"
dcglare -V "\${DC_TOTAL_MTX}" -C "\${DC_DIRECT_MTX}" -l \${DGP_THRESHOLD} "\${SKY_MTX}" ${scheduleFlag} > "\${GA_RESULTS}"
if [ \$? -ne 0 ]; then echo "Error during dcglare for GA."; exit 1; fi

# 7. Calculate Spatial Glare Autonomy (sGA)
echo "7. Calculating spatial Glare Autonomy (sGA) for a target of \${SGA_TARGET}..."
SGA_RESULTS="\${RESULTS_DIR}/\${PROJECT_NAME}_sGA.txt"
rcalc -e 'sGA = 100 * total(if(\$1-\${SGA_TARGET},1,0)) / (total(1)+1e-9)' "\${GA_RESULTS}" > "\${SGA_RESULTS}"

SGA_VALUE=\$(cat "\${SGA_RESULTS}")
echo "---"
echo "Analysis Complete."
echo "Annual DGP time-series saved to: \${DGP_RESULTS}"
echo "Glare Autonomy per view saved to: \${GA_RESULTS}"
echo "---"
echo "Final Spatial Glare Autonomy (sGA): \${SGA_VALUE}%"
echo "---"
`;

    const batScheduleFlag = scheduleFile ? `-sff ..\\10_schedules\\${scheduleFile}` : '';
    const batContent = `@echo off
REM RUN_Imageless_Glare.bat
REM Script for imageless annual glare analysis using the Accelerad method.
REM Generated by Ray Modeler.

REM --- Configuration ---
set "PROJECT_NAME=${projectName}"
set "WEATHER_FILE=..\\04_skies\\${epwFile}"
set "VIEW_RAYS_FILE=..\\08_results\\view_grid.ray"
set "DGP_THRESHOLD=${dgpThreshold}"
set "SGA_TARGET=${gaTarget}"

REM Radiance Parameters (High quality is crucial)
set "AB_TOTAL=${ab}"
set "AB_DIRECT=1"
set "AD=${ad}"
set "AS=${as}"
set "AR=${ar}"
set "AA=${aa}"
set "LW=${lw}"

REM --- File & Directory Setup ---
set "GEOM_FILE=..\\01_geometry\\%PROJECT_NAME%.rad"
set "OCT_DIR=..\\06_octrees"
set "RESULTS_DIR=..\\08_results"
set "MATRIX_DIR=%RESULTS_DIR%\\matrices"
set "TEMP_RAD_FILE=..\\06_octrees\\temp_scene.rad"

if not exist "%OCT_DIR%" mkdir "%OCT_DIR%"
if not exist "%RESULTS_DIR%" mkdir "%RESULTS_DIR%"
if not exist "%MATRIX_DIR%" mkdir "%MATRIX_DIR%"

echo --- Starting Imageless Annual Glare Analysis ---

REM 1. Create Octree
echo 1. Creating scene octree...
set "OCTREE=%OCT_DIR%\\%PROJECT_NAME%.oct"
(
    type "%GEOM_FILE%"
    echo.
    type "%MAT_FILE%"
    echo.
    (
${lightDefs.split('\n').map(line => `        echo ${line}`).join('\n')}
    )
) > "%TEMP_RAD_FILE%"

oconv "%TEMP_RAD_FILE%" > "%OCTREE%"
if %errorlevel% neq 0 ( echo "Error during oconv." & del "%TEMP_RAD_FILE%" & exit /b 1 )
del "%TEMP_RAD_FILE%"

REM 2. Generate Annual Sky Matrix (S)
echo 2. Generating annual sky matrix from EPW...
set "SKY_MTX=%MATRIX_DIR%\\%PROJECT_NAME%_sky.mtx"
(epw2wea "%WEATHER_FILE%") | gendaymtx -m 1 - > "%SKY_MTX%"
if %errorlevel% neq 0 ( echo "Error generating sky matrix." & exit /b 1 )

REM 3. Generate Direct Daylight Coefficients (D_direct)
echo 3. Generating Direct Daylight Coefficients (-ab %AB_DIRECT%)...
set "DC_DIRECT_MTX=%MATRIX_DIR%\\%PROJECT_NAME%_dc_direct.mtx"
rcontrib -I+ -w -ab %AB_DIRECT% -ad %AD% -as %AS% -ar %AR% -aa %AA% -lw %LW% "%OCTREE%" < "%VIEW_RAYS_FILE%" > "%DC_DIRECT_MTX%"
if %errorlevel% neq 0 ( echo "Error generating direct DC matrix." & exit /b 1 )

REM 4. Generate Total Daylight Coefficients (D_total)
echo 4. Generating Total Daylight Coefficients (-ab %AB_TOTAL%)...
set "DC_TOTAL_MTX=%MATRIX_DIR%\\%PROJECT_NAME%_dc_total.mtx"
rcontrib -I+ -w -ab %AB_TOTAL% -ad %AD% -as %AS% -ar %AR% -aa %AA% -lw %LW% "%OCTREE%" < "%VIEW_RAYS_FILE%" > "%DC_TOTAL_MTX%"
if %errorlevel% neq 0 ( echo "Error generating total DC matrix." & exit /b 1 )

REM 5. Calculate Annual DGP time-series
echo 5. Calculating annual DGP values...
set "DGP_RESULTS=%RESULTS_DIR%\\%PROJECT_NAME%.dgp"
dcglare -V "%DC_TOTAL_MTX%" -C "%DC_DIRECT_MTX%" "%SKY_MTX%" ${batScheduleFlag} > "%DGP_RESULTS%"
if %errorlevel% neq 0 ( echo "Error during dcglare for DGP." & exit /b 1 )

REM 6. Calculate Glare Autonomy (GA)
echo 6. Calculating Glare Autonomy (GA) for a threshold of %DGP_THRESHOLD%...
set "GA_RESULTS=%RESULTS_DIR%\\%PROJECT_NAME%.ga"
dcglare -V "%DC_TOTAL_MTX%" -C "%DC_DIRECT_MTX%" -l %DGP_THRESHOLD% "%SKY_MTX%" ${batScheduleFlag} > "%GA_RESULTS%"
if %errorlevel% neq 0 ( echo "Error during dcglare for GA." & exit /b 1 )

REM 7. Calculate Spatial Glare Autonomy (sGA)
echo 7. Calculating spatial Glare Autonomy (sGA) for a target of %SGA_TARGET%...
set "SGA_RESULTS=%RESULTS_DIR%\\%PROJECT_NAME%_sGA.txt"
(type "%GA_RESULTS%") | rcalc -e "$1 = 100 * total(if($1-%SGA_TARGET%,1,0)) / (total(1)+1e-9)" > "%SGA_RESULTS%"

for /f "delims=" %%a in ('type "%SGA_RESULTS%"') do @set "SGA_VALUE=%%a"

echo ---
echo Analysis Complete.
echo Annual DGP time-series saved to: "%DGP_RESULTS%"
echo Glare Autonomy per view saved to: "%GA_RESULTS%"
echo ---
echo Final Spatial Glare Autonomy (sGA): %SGA_VALUE%%%
echo ---
`;

    return {
        sh: { fileName: `RUN_${projectName}_Imageless_Glare.sh`, content: shContent },
        bat: { fileName: `RUN_${projectName}_Imageless_Glare.bat`, content: batContent }
    };

}

function createSdaAseScript(projectData) {
    const { projectInfo: pi, mergedSimParams: p } = projectData;
    const projectName = pi['project-name'].replace(/\s+/g, '_') || 'scene';
    const epwFileName = p['weather-file']?.name || 'weather.epw';
    const bsdfOpenFile = p['bsdf-open-file']?.name || 'bsdf_open.xml';
    const bsdfClosedFile = p['bsdf-closed-file']?.name || 'bsdf_closed.xml';

    const blindsThreshold = p['blinds-threshold-lux'] || 1000;
    const blindsTrigger = p['blinds-trigger-percent'] / 100.0 || 0.02;

    // LM-83-23 recommendations for sDA
    const ab = p['ab'] || 6;
    const ad = p['ad'] || 1000;
    const as = p['as'] || 512;
    const ar = p['ar'] || 512;
const aa = p['aa'] || 0.15;
    const lw = p['lw'] || 0.005;

    const pythonScriptContent = `import numpy as np
import argparse
import os
import struct

def read_ill_file(file_path, num_points):
    """Reads a binary .ill file and converts to photopic illuminance."""
    try:
        data = np.fromfile(file_path, dtype=np.float32)
        if data.size == 0:
            print(f"Warning: Ill file is empty: {file_path}")
            return np.zeros((8760, num_points))

        rgb_illuminance = data.reshape(8760, num_points, 3)
        # Standard photopic conversion from radiance (W/m^2/sr) to illuminance (lux)
        illuminance = 179 * (rgb_illuminance[:,:,0]*0.265 + rgb_illuminance[:,:,1]*0.670 + rgb_illuminance[:,:,2]*0.065)
        return illuminance
    except Exception as e:
        print(f"Error reading or reshaping file '{file_path}': {e}")
        return None

def generate_schedule(direct_ill_file, num_points, threshold, trigger_percent):
    """Generates a blind schedule based on direct illuminance."""
    print(f"Generating blind schedule from {direct_ill_file}...")
    direct_ill = read_ill_file(direct_ill_file, num_points)
    if direct_ill is None: return

    schedule = []
    points_threshold = num_points * trigger_percent
    for hour in range(8760):
        points_over_threshold = np.sum(direct_ill[hour, :] > threshold)
        if points_over_threshold > points_threshold:
            schedule.append(1)  # Blinds closed
        else:
            schedule.append(0)  # Blinds open

    with open("blinds.schedule", "w") as f:
        f.write("\\n".join(map(str, schedule)))
    print("Generated blinds.schedule")

def combine_results(schedule_file, open_ill_file, closed_ill_file, num_points, output_file):
    """Combines two .ill files based on a schedule."""
    print("Combining results for final sDA calculation...")
    with open(schedule_file, "r") as f:
        schedule = [int(line.strip()) for line in f]

    # Open files in binary read mode
    with open(open_ill_file, "rb") as f_open, open(closed_ill_file, "rb") as f_closed, open(output_file, "wb") as f_out:
        # Each point-hour is 3 floats * 4 bytes/float = 12 bytes
        record_size = 12 
        
        for hour in range(8760):
            for point in range(num_points):
                # Calculate the byte offset for the current record
                offset = (hour * num_points + point) * record_size
                
                if schedule[hour] == 1: # Blinds closed
                    f_closed.seek(offset)
                    record = f_closed.read(record_size)
                else: # Blinds open
                    f_open.seek(offset)
                    record = f_open.read(record_size)
                
                f_out.write(record)

    print(f"Final combined results saved to {output_file}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Post-process sDA/ASE simulation results.")
    parser.add_argument("--generate-schedule", action="store_true", help="Generate blind schedule.")
    parser.add_argument("--combine-results", action="store_true", help="Combine open/closed results.")
    parser.add_argument("--direct-ill", help="Path to direct-only illuminance file.")
    parser.add_argument("--open-ill", help="Path to blinds-open illuminance file.")
    parser.add_argument("--closed-ill", help="Path to blinds-closed illuminance file.")
    parser.add_argument("--output-file", help="Path for the final combined .ill file.")
    parser.add_argument("--num-points", type=int, required=True, help="Number of sensor points.")
    parser.add_argument("--threshold", type=float, default=1000.0, help="Lux threshold for blind trigger.")
    parser.add_argument("--trigger", type=float, default=0.02, help="Area percentage for blind trigger.")

    args = parser.parse_args()

    if args.generate_schedule:
        if not args.direct_ill:
            print("Error: --direct-ill is required for generating schedule.")
        else:
            generate_schedule(args.direct_ill, args.num_points, args.threshold, args.trigger)
    elif args.combine_results:
        if not args.open_ill or not args.closed_ill or not args.output_file:
            print("Error: --open-ill, --closed-ill, and --output-file are required for combining results.")
        else:
            combine_results("blinds.schedule", args.open_ill, args.closed_ill, args.num_points, args.output_file)
    else:
        print("No action specified. Use --generate-schedule or --combine-results.")
`;

    const shContent = `#!/bin/bash
# RUN_sDA_ASE_Analysis.sh
# Full IES LM-83 sDA/ASE workflow with dynamic shading.
# Generated by Ray Modeler.

# IMPORTANT WORKFLOW NOTE:
# This script REQUIRES matrix files (view.mtx, daylight.mtx) that must be
# generated beforehand by running the 'RUN_..._3ph_Matrix_Generation.sh' script
# from the "Annual Daylight (3-Phase)" recipe.

# --- Configuration ---
PROJECT_NAME="\${projectName}"
WEATHER_FILE="../04_skies/${epwFileName}"
BSDF_OPEN="../05_bsdf/${bsdfOpenFile}"
BSDF_CLOSED="../05_bsdf/${bsdfClosedFile}"
POINTS_FILE="../08_results/grid.pts"

# Radiance parameters based on IES LM-83-23
AB=${ab}; AD=${ad}
AS=${as}; AR=${ar}
AA=${aa}; LW=${lw}

# Blind operation parameters
BLINDS_THRESHOLD=${blindsThreshold}
BLINDS_TRIGGER=${blindsTrigger}

# --- File & Directory Setup ---
RESULTS_DIR="../08_results"
MATRIX_DIR="\${RESULTS_DIR}/matrices"
SKY_DIR="../04_skies"
PYTHON_SCRIPT="process_sDA.py"
NUM_POINTS=\$(wc -l < "\${POINTS_FILE}")

echo "--- Starting sDA/ASE Simulation Workflow ---"
echo "Found \${NUM_POINTS} sensor points."

# 1. Generate Sky Matrices
echo "1. Generating full and direct-only sky matrices..."
SKY_MTX="\${MATRIX_DIR}/sky.smx"
SKY_DIRECT_MTX="\${MATRIX_DIR}/sky_direct.smx"
epw2wea "\${WEATHER_FILE}" | gendaymtx -m 1 - > "\${SKY_MTX}"
epw2wea "\${WEATHER_FILE}" | gendaymtx -m 1 -d - > "\${SKY_DIRECT_MTX}"

# 2. Run dctimestep for ASE (Direct Sun Only)
echo "2. Calculating direct-only illuminance for ASE and blind schedule..."
ILL_DIRECT_ONLY="\${RESULTS_DIR}/\${PROJECT_NAME}_ASE_direct_only.ill"
dctimestep "\${MATRIX_DIR}/view.mtx" "\${BSDF_OPEN}" "\${MATRIX_DIR}/daylight.mtx" "\${SKY_DIRECT_MTX}" > "\${ILL_DIRECT_ONLY}"
echo "-> ASE results file created: \${ILL_DIRECT_ONLY}"

# 3. Generate Blind Schedule with Python script
echo "3. Generating hourly blind operation schedule..."
python3 "\${PYTHON_SCRIPT}" --generate-schedule --direct-ill "\${ILL_DIRECT_ONLY}" --num-points "\${NUM_POINTS}" --threshold "\${BLINDS_THRESHOLD}" --trigger "\${BLINDS_TRIGGER}"

# 4. Run dctimestep for Blinds OPEN state (Full Sky)
echo "4. Calculating annual illuminance with blinds OPEN..."
ILL_OPEN="\${RESULTS_DIR}/results_open.ill"
dctimestep "\${MATRIX_DIR}/view.mtx" "\${BSDF_OPEN}" "\${MATRIX_DIR}/daylight.mtx" "\${SKY_MTX}" > "\${ILL_OPEN}"

# 5. Run dctimestep for Blinds CLOSED state (Full Sky)
echo "5. Calculating annual illuminance with blinds CLOSED..."
ILL_CLOSED="\${RESULTS_DIR}/results_closed.ill"
dctimestep "\${MATRIX_DIR}/view.mtx" "\${BSDF_CLOSED}" "\${MATRIX_DIR}/daylight.mtx" "\${SKY_MTX}" > "\${ILL_CLOSED}"

# 6. Combine Results for sDA based on schedule
echo "6. Combining results based on blind schedule..."
ILL_SDA_FINAL="\${RESULTS_DIR}/\${PROJECT_NAME}_sDA_final.ill"
python3 "\${PYTHON_SCRIPT}" --combine-results --open-ill "\${ILL_OPEN}" --closed-ill "\${ILL_CLOSED}" --num-points "\${NUM_POINTS}" --output-file "\${ILL_SDA_FINAL}"

echo ""
echo "--- sDA/ASE Workflow Complete ---"
echo "Load this file for ASE analysis: \${ILL_DIRECT_ONLY}"
echo "Load this file for sDA analysis: \${ILL_SDA_FINAL}"
echo "---"
`;

  // BAT file generation is omitted for this complex workflow, as a Bash-like environment (WSL, Git Bash) is strongly recommended.
  const batContent = `# BAT file for this complex workflow is not provided.
# Please use a bash interpreter (like Git Bash or WSL on Windows) to run the generated .sh script.`;
  return [
      { fileName: `RUN_${projectName}_sDA_ASE.sh`, content: shContent },
      { fileName: `RUN_${projectName}_sDA_ASE.bat`, content: batContent },
      { fileName: 'process_sDA.py', content: pythonScriptContent }
  ];
}

function createEn17037ComplianceScript(projectData) {
    const { projectInfo: pi, mergedSimParams: p, geometry } = projectData;
    const projectName = pi['project-name'].replace(/\s+/g, '_') || 'scene';
    const epwFileName = projectData.simulationFiles['weather-file']?.name || 'weather.epw';
    const scheduleFileName = projectData.simulationFiles['occupancy-schedule']?.name || 'occupancy.csv';

    // --- Get UI Settings ---
    const checkProvision = p['en17037-provision-toggle'];
    const provisionLevel = p['en17037-provision-level'];
    const checkSunlight = p['en17037-sunlight-toggle'];
    const sunlightDate = p['en17037-sunlight-date'] || 'Mar 21';
    const sunlightLevel = p['en17037-sunlight-level'];
    const checkView = p['en17037-view-toggle'];
    const viewLevel = p['en17037-view-level'];
    const checkViewFactor = p['en17037-view-factor-toggle']; // New line
    const checkGlare = p['en17037-glare-toggle'];
    const glareLevel = p['en17037-glare-level'];

    // --- Define Standard Thresholds ---
    const provisionTargets = {
        minimum: { ET: 300, F_plane_ET: 50, ETM: 100, F_plane_ETM: 95 },
        medium:  { ET: 500, F_plane_ET: 50, ETM: 300, F_plane_ETM: 95 },
        high:    { ET: 750, F_plane_ET: 50, ETM: 500, F_plane_ETM: 95 }
    };
    const sunlightTargets = { minimum: 1.5, medium: 3.0, high: 4.0 };
    const glareTargets = { minimum: 0.45, medium: 0.40, high: 0.35 };

    const provisionT = provisionTargets[provisionLevel] || provisionTargets.minimum;
    const sunlightT = sunlightTargets[sunlightLevel] || sunlightTargets.minimum;
    const glareT = glareTargets[glareLevel] || glareTargets.minimum;

    const monthStr = new Date(Date.parse(sunlightDate +" 2023")).getMonth() + 1;
    const dayStr = new Date(Date.parse(sunlightDate +" 2023")).getDate();

    // --- High-Quality Radiance Parameters ---
    const ab = p['ab'] || 7;
    const ad = p['ad'] || 4096;
    const as = p['as'] || 2048;
    const ar = p['ar'] || 1024;
    const aa = p['aa'] || 0.1;
    const lw = p['lw'] || 1e-5;

    // --- Python Helper Script for Daylight Provision ---
    const pythonDaylightScript = `
import numpy as np
import pandas as pd
import argparse
import os

def check_daylight_provision(illuminance_file, epw_file, num_points, ET, F_plane_ET, ETM, F_plane_ETM):
    print("\\n--- Checking EN 17037 Daylight Provision ---")
    print(f"Targets: >{ET}lx on >{F_plane_ET}% of area AND >{ETM}lx on >{F_plane_ETM}% of area, for >50% of daylight hours.")

    try:
        # Read EPW to find daylight hours
        epw_data = pd.read_csv(epw_file, header=None, skiprows=8)
        diffuse_horizontal_irradiance = epw_data[13]
        daylight_hours_indices = diffuse_horizontal_irradiance.nlargest(4380).index

        # Read Radiance .ill file
        data = np.fromfile(illuminance_file, dtype=np.float32)
        rgb_illuminance = data.reshape(8760, num_points, 3)
        annual_illuminance = 179 * (rgb_illuminance[:,:,0]*0.265 + rgb_illuminance[:,:,1]*0.670 + rgb_illuminance[:,:,2]*0.065)

        # Filter for daylight hours
        daylight_illuminance = annual_illuminance[daylight_hours_indices, :]

        # Check criteria for each daylight hour
        passing_hours_ET = 0
        passing_hours_ETM = 0

        for hour_idx in range(4380):
            hour_data = daylight_illuminance[hour_idx, :]

            percent_area_ET = (np.sum(hour_data >= ET) / num_points) * 100
            percent_area_ETM = (np.sum(hour_data >= ETM) / num_points) * 100

            if percent_area_ET >= F_plane_ET:
                passing_hours_ET += 1
            if percent_area_ETM >= F_plane_ETM:
                passing_hours_ETM += 1

        # Final compliance check
        percent_time_ET = (passing_hours_ET / 4380) * 100
        percent_time_ETM = (passing_hours_ETM / 4380) * 100

        compliant_ET = percent_time_ET >= 50.0
        compliant_ETM = percent_time_ETM >= 50.0

        print(f"Result (ET): {percent_time_ET:.1f}% of daylight hours met the {ET}lx target. (Pass: {compliant_ET})")
        print(f"Result (ETM): {percent_time_ETM:.1f}% of daylight hours met the {ETM}lx target. (Pass: {compliant_ETM})")

        if compliant_ET and compliant_ETM:
            print(">>> STATUS: PASS")
        else:
            print(">>> STATUS: FAIL")

    except Exception as e:
        print(f"An error occurred during daylight provision analysis: {e}")
        print(">>> STATUS: ERROR")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("illuminance_file")
    parser.add_argument("epw_file")
    parser.add_argument("--points", type=int, required=True)
    parser.add_argument("--ET", type=float, required=True)
    parser.add_argument("--F_plane_ET", type=float, required=True)
    parser.add_argument("--ETM", type=float, required=True)
    parser.add_argument("--F_plane_ETM", type=float, required=True)
    args = parser.parse_args()
    check_daylight_provision(args.illuminance_file, args.epw_file, args.points, args.ET, args.F_plane_ET, args.ETM, args.F_plane_ETM)
`;

    // --- Python Helper Script for Glare ---
    const pythonGlareScript = `
import numpy as np
import pandas as pd
import argparse
import os

def check_glare_protection(dgp_file, schedule_file, dgp_threshold):
    print("\\n--- Checking EN 17037 Glare Protection ---")
    print(f"Target: DGP <= {dgp_threshold} for at least 95% of occupied hours.")

    try:
        dgp_data = pd.read_csv(dgp_file, header=None, delim_whitespace=True)
        num_points = dgp_data.shape[1]

        # Default to weekdays, 8 AM to 6 PM if no schedule is provided
        time_index = pd.to_datetime(pd.date_range(start='2023-01-01', end='2024-01-01', freq='h', inclusive='left'))
        occupied_mask = (time_index.hour >= 8) & (time_index.hour < 18) & (time_index.dayofweek < 5)

        if schedule_file and os.path.exists(schedule_file):
            print(f"Using occupancy schedule from: {schedule_file}")
            schedule = pd.read_csv(schedule_file, header=None).squeeze("columns")
            if len(schedule) == 8760:
                occupied_mask = schedule.to_numpy(dtype=bool)
            else:
                print(f"Warning: Schedule file does not contain 8760 entries. Using default schedule.")

        occupied_dgp = dgp_data[occupied_mask]
        total_occupied_hours = occupied_dgp.shape[0]

        # Check for each point
        hours_with_glare = (occupied_dgp > dgp_threshold).sum(axis=0)
        percent_hours_with_glare = (hours_with_glare / total_occupied_hours) * 100

        # The standard implies checking each point. We report the worst-case.
        max_glare_percent = percent_hours_with_glare.max()

        print(f"Worst-case sensor experienced glare for {max_glare_percent:.1f}% of occupied hours.")

        if max_glare_percent <= 5.0:
            print(">>> STATUS: PASS")
        else:
            print(">>> STATUS: FAIL")

    except Exception as e:
        print(f"An error occurred during glare analysis: {e}")
        print(">>> STATUS: ERROR")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("dgp_file")
    parser.add_argument("--schedule", type=str, default=None)
    parser.add_argument("--threshold", type=float, required=True)
    args = parser.parse_args()
    check_glare_protection(args.dgp_file, args.schedule, args.threshold)
`;

    // --- Master Shell Script ---
    const shContent = `#!/bin/bash
# RUN_EN17037_Compliance.sh
# Generated by Ray Modeler for project: ${projectName}

# --- CONFIGURATION ---
PROJECT_NAME="${projectName}"
WEATHER_FILE="../04_skies/${epwFileName}"
SCHEDULE_FILE="../10_schedules/${scheduleFileName}"
POINTS_FILE="../08_results/grid.pts"
VIEW_RAYS_FILE="../08_results/view_grid.ray"

# High-quality Radiance parameters
RAD_PARAMS="-ab ${ab} -ad ${ad} -as ${as} -ar ${ar} -aa ${aa} -lw ${lw}"

# --- FILE & DIRECTORY SETUP ---
RESULTS_DIR="../08_results"
MATRIX_DIR="\${RESULTS_DIR}/matrices"
OCT_DIR="../06_octrees"
IMG_DIR="../09_images"
mkdir -p \$RESULTS_DIR \$MATRIX_DIR \$OCT_DIR \$IMG_DIR

# Check for required files
if [ ! -f "\${POINTS_FILE}" ] && [ "${checkProvision}" = true ]; then echo "ERROR: grid.pts not found, required for Daylight Provision."; exit 1; fi
if [ ! -f "\${VIEW_RAYS_FILE}" ] && [ "${checkGlare}" = true ]; then echo "ERROR: view_grid.ray not found, required for Glare Protection."; exit 1; fi

NUM_POINTS=\$(wc -l < "\${POINTS_FILE}")

# ==============================================================================
# --- 1. DAYLIGHT PROVISION ---
# ==============================================================================
if [ "${checkProvision}" = true ]; then
    echo ""
    echo "### RUNNING CHECK 1: DAYLIGHT PROVISION ###"
    # This reuses the 3-Phase annual simulation workflow
    ./RUN_${projectName}_3ph_Matrix_Generation.sh
    if [ \$? -ne 0 ]; then echo "Matrix generation failed."; exit 1; fi
    ./RUN_${projectName}_3ph_Annual_Simulation.sh
    if [ \$? -ne 0 ]; then echo "Annual simulation failed."; exit 1; fi

    python3 ./process_en17037_daylight.py "\${RESULTS_DIR}/${projectName}.ill" "\${WEATHER_FILE}" --points \${NUM_POINTS} --ET ${provisionT.ET} --F_plane_ET ${provisionT.F_plane_ET} --ETM ${provisionT.ETM} --F_plane_ETM ${provisionT.F_plane_ETM}
fi

# ==============================================================================
# --- 2. SUNLIGHT EXPOSURE ---
# ==============================================================================
if [ "${checkSunlight}" = true ]; then
    echo ""
    echo "### RUNNING CHECK 2: SUNLIGHT EXPOSURE ###"

    # --- Define Reference Point P and Minimum Solar Altitude ---
    # Note: This is a simplified approach assuming the largest south-facing window is primary.
    # A more advanced implementation would allow user selection.
    REF_POINT_P="0.0 0.0 1.2" # Default to room center at 1.2m if no suitable window is found
    MIN_SOLAR_ALT=20 # Default for Athens, Greece
    echo "Using Reference Point P: \${REF_POINT_P} and Minimum Solar Altitude: \${MIN_SOLAR_ALT} degrees"

    # --- Create a temporary octree with just the geometry for speed ---
    GEOM_OCTREE="\${OCT_DIR}/${projectName}_geom_only.oct"
    oconv -f ../01_geometry/*.rad > "\${GEOM_OCTREE}"

    total_minutes_with_sun=0

    # --- Loop through the day in 15-minute intervals ---
    for minute_of_day in $(seq 0 15 1439); do
        hour=\$(echo "scale=2; \${minute_of_day} / 60" | bc)

        # Get sun position for this time step
        sun_info=$(gendaylit ${monthStr} ${dayStr} \${hour} -a ${pi.latitude} -o ${pi.longitude} -m ${mer} -O 1)
        sun_altitude=$(echo "\$sun_info" | awk '{print $3}')
        sun_altitude_deg=$(echo "scale=2; \$sun_altitude * 180 / 3.14159" | bc)

        # Check if sun is above the minimum altitude
        is_above_horizon=$(echo "\${sun_altitude_deg} > \${MIN_SOLAR_ALT}" | bc)

        if [ "\${is_above_horizon}" -eq 1 ]; then
            sun_direction=$(echo "\$sun_info" | awk '{print $1, $2, $3}')

            # Trace a ray from P towards the sun. If it hits nothing, the sun is visible.
            # rtrace -o prints the unmodified ray if it travels to infinity.
            trace_result=$(echo "\${REF_POINT_P} \${sun_direction}" | rtrace -o -ab 0 -h "\${GEOM_OCTREE}")

            if [ -n "\${trace_result}" ]; then
                total_minutes_with_sun=\$((total_minutes_with_sun + 15))
            fi
        fi
    done

    total_hours_with_sun=$(echo "scale=2; \${total_minutes_with_sun} / 60" | bc)
    target_hours=${sunlightT}

    echo "Total duration of sunlight exposure: \${total_hours_with_sun} hours."
    echo "Target duration for '${sunlightLevel}' level: \${target_hours} hours."

    is_compliant=$(echo "\${total_hours_with_sun} >= \${target_hours}" | bc)
    if [ "\${is_compliant}" -eq 1 ]; then
        echo ">>> STATUS: PASS"
    else
        echo ">>> STATUS: FAIL"
    fi
fi

# ==============================================================================
# --- 3. VIEW OUT ---
# ==============================================================================
if [ "${checkView}" = true ]; then
    echo ""
    echo "### RUNNING CHECK 3: VIEW OUT ###"
    rpict -vta -vh 180 -vv 180 -vf ../03_views/viewpoint.vf -x 1024 -y 1024 \\
        \${RAD_PARAMS} "\${OCT_DIR}/${projectName}.oct" > "\${IMG_DIR}/${projectName}_view_out.hdr"
    echo "Fisheye image for View Out analysis generated: \${IMG_DIR}/${projectName}_view_out.hdr"
   echo "Please manually verify Horizontal Sight Angle, Outside Distance, and Layers."
    echo ">>> STATUS: MANUAL CHECK REQUIRED"
fi

# ==============================================================================
# --- 3b. VIEW FACTOR (QUANTITATIVE) ---
# ==============================================================================
if [ "${checkViewFactor}" = true ]; then
    echo ""
    echo "### RUNNING CHECK 3b: VIEW FACTOR CALCULATION ###"

    # 1. Create a modified scene file for view factor analysis
    echo "1. Creating modified scene for analysis..."
    MODIFIED_GEOM_VF="\${RESULTS_DIR}/${projectName}_vf.rad"
    MODIFIED_MATS_VF="\${RESULTS_DIR}/materials_vf.rad"

    # Define special materials: 'window_light' emits white light, 'black' absorbs everything.
    cat > "\${MODIFIED_MATS_VF}" << EOF
void light window_light
0
0
3 1 1 1

void plastic black
0
0
5 0 0 0 0 0
EOF

    # Use replmarks to swap all materials except glazing to 'black'.
    replmarks -m glass_mat=window_light \\
              -m wall_mat=black -m floor_mat=black -m ceiling_mat=black \\
              -m frame_mat=black -m shading_mat=black -m furniture_mat=black \\
              -m context_mat=black -m ground_mat=black \\
              "../01_geometry/${projectName}.rad" > "\${MODIFIED_GEOM_VF}"

    # 2. Create the octree for the modified scene
    echo "2. Creating analysis octree..."
    OCTREE_VF="\${OCT_DIR}/${projectName}_vf.oct"
    oconv "\${MODIFIED_MATS_VF}" "\${MODIFIED_GEOM_VF}" > "\${OCTREE_VF}"

    # 3. Calculate the View Factor using rtrace
    echo "3. Calculating numerical view factor..."
    VIEW_FACTOR_FILE="\${RESULTS_DIR}/${projectName}_view_factor.txt"
    
    # Generate rays from the viewpoint, trace them, and average the results.
    # The average is the view factor because window hits = 1 and other hits = 0.
    (cnt 5000 | rcalc -e '$1=0;$2=0;$3=0' | xform -vf ../03_views/viewpoint.vf) \\
    | rtrace -h -w -ov -ab 0 "\${OCTREE_VF}" \\
    | total -m \\
    | rcalc -e '$1=$1*100' > "\${VIEW_FACTOR_FILE}"

    VIEW_FACTOR_PERCENTAGE=$(cat "\${VIEW_FACTOR_FILE}")
    
    # 4. Generate a visualization image
    echo "4. Generating fisheye visualization..."
    VIZ_IMAGE="\${IMG_DIR}/${projectName}_view_factor_viz.hdr"
    rpict -vth -vh 180 -vv 180 -ab 0 -vf ../03_views/viewpoint_fisheye.vf "\${OCTREE_VF}" > "\${VIZ_IMAGE}"
    
    echo ">>> STATUS: COMPLETE. View Factor is \${VIEW_FACTOR_PERCENTAGE}%. Visualization saved to \${VIZ_IMAGE}"
fi

# ==============================================================================

# ==============================================================================
# --- 4. GLARE PROTECTION ---
# ==============================================================================
if [ "${checkGlare}" = true ]; then
    echo ""
    echo "### RUNNING CHECK 4: GLARE PROTECTION ###"
    # This reuses the imageless glare workflow
    ./RUN_${projectName}_Imageless_Glare.sh
    if [ \$? -ne 0 ]; then echo "Imageless glare simulation failed."; exit 1; fi

    python3 ./process_en17037_glare.py "\${RESULTS_DIR}/${projectName}.dgp" --schedule "\${SCHEDULE_FILE}" --threshold ${glareT}
fi

echo ""
echo "--- EN 17037 Compliance Check Complete ---"
`;

    // Return all generated files
    return [
        // The two python scripts
        { fileName: 'process_en17037_daylight.py', content: pythonDaylightScript },
        { fileName: 'process_en17037_glare.py', content: pythonGlareScript },
        // The main orchestration script
        { fileName: `RUN_${projectName}_EN17037_Compliance.sh`, content: shContent },
        // Include dependencies: The compliance script calls other scripts, so they must also be generated.
        ...generateScripts(projectData, 'template-recipe-annual-3ph'),
        ...generateScripts(projectData, 'template-recipe-imageless-glare')
    ];
}

/**
 * Creates scripts for an EN 12464-1 illuminance and uniformity check.
 * @param {object} projectData - The complete project data object.
 * @returns {object} An object containing the shell and bat script files.
 */
function createEnIlluminanceScript(projectData) {
    const { projectInfo: pi, mergedSimParams: p } = projectData;
    const projectName = pi['project-name'].replace(/\s+/g, '_') || 'scene';
    
    // Use high-quality "compliance" parameters from the document
    const ab = p['ab'] || 7;
    const ad = p['ad'] || 2048;
    const as = p['as'] || 512;
    const ar = p['ar'] || 256;
    const aa = p['aa'] || 0.1;
    const lw = p['lw'] || 0.001;

    const lightDefs = generateLightSourceDefinitions(projectData.lighting, projectData.geometry.room);
    
    const shContent = `#!/bin/bash
# RUN_EN12464_Illuminance.sh
# Verifies maintained illuminance (Em) and uniformity (U0) as per EN 12464-1.

# --- Configuration ---
PROJECT_NAME="${projectName}"
# High-quality parameters for compliance verification
AB=${ab}; AD=${ad}; AS=${as}; AR=${ar}; AA=${aa}; LW=${lw}

# --- File & Directory Setup ---
GEOM_FILE="../01_geometry/\${PROJECT_NAME}.rad"
MAT_FILE="../02_materials/\${PROJECT_NAME}_materials.rad"
SKY_FILE="../04_skies/\${PROJECT_NAME}_sky.rad" # Assumes a sky is pre-generated
OCT_DIR="../06_octrees"
RESULTS_DIR="../08_results"
TASK_GRID="../08_results/task_grid.pts"
SURROUND_GRID="../08_results/surrounding_grid.pts"

# 1. Create Scene Octree
echo "1. Creating octree for illuminance check..."
OCTREE="\${OCT_DIR}/\${PROJECT_NAME}_scene.oct"
(
    cat "\${GEOM_FILE}"
    cat "\${MAT_FILE}"
    echo
    echo "${lightDefs}"
    # Note: Include a sky file here if daylight is part of the scenario
    # cat "\${SKY_FILE}" 
) | oconv - > "\${OCTREE}"

# 2. Run RTRACE for Task Area
echo "2. Calculating illuminance on Task Area grid..."
rtrace -I -h -w -ab \${AB} -ad \${AD} -as \${AS} -ar \${AR} -aa \${AA} -lw \${LW} "\${OCTREE}" < "\${TASK_GRID}" \\
| rcalc -e '$1=179*(0.265*$1 + 0.670*$2 + 0.065*$3)' > "\${RESULTS_DIR}/task_results_lux.txt"

# 3. Run RTRACE for Surrounding Area
echo "3. Calculating illuminance on Surrounding Area grid..."
rtrace -I -h -w -ab \${AB} -ad \${AD} -as \${AS} -ar \${AR} -aa \${AA} -lw \${LW} "\${OCTREE}" < "\${SURROUND_GRID}" \\
| rcalc -e '$1=179*(0.265*$1 + 0.670*$2 + 0.065*$3)' > "\${RESULTS_DIR}/surround_results_lux.txt"

# 4. Post-Process and Generate Summary Report
echo "4. Generating summary report..."
SUMMARY_FILE="\${RESULTS_DIR}/EN12464_Illuminance_Summary.txt"
{
    echo "--- EN 12464-1 Illuminance & Uniformity Report ---"
    echo ""
    echo "--- TASK AREA RESULTS ---"
    total -m < "\${RESULTS_DIR}/task_results_lux.txt" | {
        read E_avg
        E_min=$(datamax -l "\${RESULTS_DIR}/task_results_lux.txt")
        U0=$(echo "scale=4; if(\$E_avg > 0) \$E_min / \$E_avg else 0" | bc)
        echo "Average Illuminance (Em): \${E_avg} lux"
        echo "Minimum Illuminance (Emin): \${E_min} lux"
        echo "Uniformity (U0 = Emin/Em): \${U0}"
    }
    echo ""
    echo "--- SURROUNDING AREA RESULTS ---"
    total -m < "\${RESULTS_DIR}/surround_results_lux.txt" | {
        read E_avg
        E_min=$(datamax -l "\${RESULTS_DIR}/surround_results_lux.txt")
        U0=$(echo "scale=4; if(\$E_avg > 0) \$E_min / \$E_avg else 0" | bc)
        echo "Average Illuminance (Em): \${E_avg} lux"
        echo "Minimum Illuminance (Emin): \${E_min} lux"
        echo "Uniformity (U0 = Emin/Em): \${U0}"
    }
    echo "----------------------------------------------------"
} > "\${SUMMARY_FILE}"

echo "---"
echo "Analysis complete. Summary report:"
cat "\${SUMMARY_FILE}"
echo "---"
`;

    // BAT file generation is complex and omitted for brevity, recommending bash.
    const batContent = `REM This workflow uses advanced shell features. Please run the .sh script using a bash interpreter (e.g., Git Bash, WSL).`;
    
    return {
        sh: { fileName: `RUN_${projectName}_EN12464_Illuminance.sh`, content: shContent },
        bat: { fileName: `RUN_${projectName}_EN12464_Illuminance.bat`, content: batContent }
    };
}

/**
 * Creates scripts for an EN 12464-1 UGR check.
 * @param {object} projectData - The complete project data object.
 * @returns {object} An object containing the shell and bat script files.
 */
function createEnUgrScript(projectData) {
    const { projectInfo: pi, mergedSimParams: p } = projectData;
    const projectName = pi['project-name'].replace(/\s+/g, '_') || 'scene';

    const ab = p['ab'] || 7;
    const ad = p['ad'] || 2048;
    const as = p['as'] || 1024;
    const ar = p['ar'] || 512;
    const aa = p['aa'] || 0.1;
    const lw = p['lw'] || 0.001;
    const ugrLimit = p['ugr-limit'] || 19;
    
    const lightDefs = generateLightSourceDefinitions(projectData.lighting, projectData.geometry.room);

    const shContent = `#!/bin/bash
# RUN_EN12464_UGR.sh
# Verifies Unified Glare Rating (UGR) as per EN 12464-1.

# --- Configuration ---
PROJECT_NAME="${projectName}"
UGR_LIMIT=${ugrLimit}
# High-quality parameters for glare analysis
AB=${ab}; AD=${ad}; AS=${as}; AR=${ar}; AA=${aa}; LW=${lw}

# --- File & Directory Setup ---
GEOM_FILE="../01_geometry/\${PROJECT_NAME}.rad"
MAT_FILE="../02_materials/\${PROJECT_NAME}_materials.rad"
SKY_FILE="../04_skies/\${PROJECT_NAME}_sky.rad"
OCT_DIR="../06_octrees"
RESULTS_DIR="../08_results"
IMG_DIR="../09_images/hdr"
VIEW_FILE="../03_views/viewpoint_fisheye.vf" # Special view file for glare
mkdir -p \$OCT_DIR \$RESULTS_DIR \$IMG_DIR

# 1. Create Scene Octree
echo "1. Creating octree for UGR check..."
OCTREE="\${OCT_DIR}/\${PROJECT_NAME}_scene.oct"
(
    cat "\${GEOM_FILE}"
    cat "\${MAT_FILE}"
    echo
    echo "${lightDefs}"
    # Note: Include a sky file here if daylight is part of the scenario
    # cat "\${SKY_FILE}"
) | oconv - > "\${OCTREE}"

# 2. Render 180-degree fisheye HDR image
echo "2. Rendering fisheye image for observer..."
HDR_IMAGE="\${IMG_DIR}/\${PROJECT_NAME}_ugr_view.hdr"
rpict -vth -vh 180 -vv 180 -vf "\${VIEW_FILE}" -x 2048 -y 2048 \\
    -ab \${AB} -ad \${AD} -as \${AS} -ar \${AR} -aa \${AA} -lw \${LW} \\
    "\${OCTREE}" > "\${HDR_IMAGE}"

# 3. Calculate UGR with evalglare
echo "3. Calculating UGR with evalglare..."
GLARE_REPORT="\${RESULTS_DIR}/EN12464_UGR_Report.txt"
evalglare -vth "\${HDR_IMAGE}" > "\${GLARE_REPORT}"

# 4. Generate Summary Report
echo "4. Generating summary report..."
SUMMARY_FILE="\${RESULTS_DIR}/EN12464_UGR_Summary.txt"
UGR_VALUE=$(grep "UGR =" "\${GLARE_REPORT}" | awk '{print $3}')

{
    echo "--- EN 12464-1 UGR Report ---"
    echo "Observer position defined in \${VIEW_FILE}"
    echo ""
    echo "UGR Limit (UGRL) for this task: \${UGR_LIMIT}"
    echo "Calculated UGR Value: \${UGR_VALUE}"
    echo ""
    if (( $(echo "\${UGR_VALUE} <= \${UGR_LIMIT}" | bc -l) )); then
        echo "STATUS: PASS"
    else
        echo "STATUS: FAIL"
    fi
    echo "---------------------------------"
    echo "Full evalglare output below:"
    cat "\${GLARE_REPORT}"
} > "\${SUMMARY_FILE}"

echo "---"
echo "Analysis complete. Summary report:"
cat "\${SUMMARY_FILE}"
echo "---"
`;

    const batContent = `REM This workflow uses advanced shell features. Please run the .sh script using a bash interpreter (e.g., Git Bash, WSL).`;

    return {
         sh: { fileName: `RUN_${projectName}_EN12464_UGR.sh`, content: shContent },
    bat: { fileName: `RUN_${projectName}_EN12464_UGR.bat`, content: batContent }
};
}

function createLightingEnergyScript(projectData) {
    const { projectInfo: pi, mergedSimParams: p, lighting, geometry } = projectData;
    const projectName = pi['project-name'].replace(/\s+/g, '_') || 'scene';
    const epwFileName = p['weather-file']?.name || 'weather.epw';
    const bsdfOpenFile = p['bsdf-open-file']?.name || 'bsdf_open.xml';
    const bsdfClosedFile = p['bsdf-closed-file']?.name || 'bsdf_closed.xml';

    const blindsThreshold = p['blinds-threshold-lux'] || 1000;
    const blindsTrigger = p['blinds-trigger-percent'] / 100.0 || 0.02;

    // Get lighting control and power info
    const { daylighting: dc, luminaire_wattage } = lighting;
    let numLuminaires = 1;
    if (lighting.placement === 'grid' && lighting.grid) {
        numLuminaires = (lighting.grid.rows || 1) * (lighting.grid.cols || 1);
    }
    const totalInstalledPower = luminaire_wattage * numLuminaires;
    const roomArea = geometry.room.W * geometry.room.L;


    const pythonScriptContent = `import numpy as np
import argparse
import os
import pandas as pd

def read_ill_file(file_path, num_points):
    """Reads a binary .ill file and converts to photopic illuminance."""
    try:
        data = np.fromfile(file_path, dtype=np.float32)
        if data.size == 0:
            print(f"Warning: Ill file is empty: {file_path}")
            return np.zeros((8760, num_points))
        rgb = data.reshape(8760, num_points, 3)
        return 179 * (rgb[:,:,0]*0.265 + rgb[:,:,1]*0.670 + rgb[:,:,2]*0.065)
    except Exception as e:
        print(f"Error reading or reshaping file '{file_path}': {e}")
        return None

def generate_schedule(direct_ill_file, num_points, threshold, trigger_percent):
    """Generates a blind schedule based on direct illuminance."""
    print(f"Generating blind schedule from {direct_ill_file}...")
    direct_ill = read_ill_file(direct_ill_file, num_points)
    if direct_ill is None: return

    schedule = []
    points_threshold = int(num_points * trigger_percent)
    for hour in range(8760):
        points_over_threshold = np.sum(direct_ill[hour, :] > threshold)
        schedule.append(1 if points_over_threshold > points_threshold else 0)

    with open("blinds.schedule", "w") as f:
        f.write("\\n".join(map(str, schedule)))
    print("Generated blinds.schedule")

def combine_results(schedule_file, open_ill_file, closed_ill_file, num_points, output_file):
    """Combines two .ill files based on a schedule."""
    print("Combining results for final illuminance calculation...")
    with open(schedule_file, "r") as f:
        schedule = [int(line.strip()) for line in f]

    with open(open_ill_file, "rb") as f_open, open(closed_ill_file, "rb") as f_closed, open(output_file, "wb") as f_out:
        record_size = 12 
        for hour in range(8760):
            for point in range(num_points):
                offset = (hour * num_points + point) * record_size
                f_source = f_closed if schedule[hour] == 1 else f_open
                f_source.seek(offset)
                record = f_source.read(record_size)
                f_out.write(record)
    print(f"Final combined results saved to {output_file}")

def calculate_energy(final_ill_file, num_points, args):
    """Calculates lighting energy based on illuminance and control settings."""
    print("\\nCalculating lighting energy consumption...")
    final_ill = read_ill_file(final_ill_file, num_points)
    if final_ill is None: return

    hourly_avg_ill = np.mean(final_ill, axis=1)
    total_power_fraction_sum = 0
    occupied_hour_count = 0

    time_index = pd.to_datetime(pd.date_range(start='2023-01-01', end='2024-01-01', freq='h', inclusive='left'))
    occupied_mask = (time_index.hour >= 8) & (time_index.hour < 18) & (time_index.dayofweek < 5)

    for h in range(8760):
        if occupied_mask[h]:
            occupied_hour_count += 1
            daylight = hourly_avg_ill[h]
            
            fL = max(0, (args.setpoint - daylight) / args.setpoint)
            fP = 0
            if args.control_type == 'Continuous':
                if fL < args.min_light_frac:
                    fP = args.min_power_frac
                else:
                    fP = args.min_power_frac + (fL - args.min_light_frac) * (1 - args.min_power_frac) / (1 - args.min_light_frac)
            elif args.control_type == 'ContinuousOff':
                if fL < args.min_light_frac:
                    fP = 0
                else:
                    fP = args.min_power_frac + (fL - args.min_light_frac) * (1 - args.min_power_frac) / (1 - args.min_light_frac)
            elif args.control_type == 'Stepped':
                if fL <= 0: fP = 0
                elif fL >= 1: fP = 1
                else: fP = np.ceil(args.n_steps * fL) / args.n_steps
            
            total_power_fraction_sum += fP

    avg_power_fraction = total_power_fraction_sum / occupied_hour_count if occupied_hour_count > 0 else 0
    total_installed_power_kw = args.total_power / 1000.0
    annual_energy_kwh = avg_power_fraction * total_installed_power_kw * occupied_hour_count
    savings = (1 - avg_power_fraction) * 100
    lpd = args.total_power / args.room_area

    summary_df = pd.DataFrame({
        'Lighting Power Density (W/m^2)': [f"{lpd:.2f}"],
        'Annual Lighting Energy (kWh/yr)': [f"{annual_energy_kwh:.0f}"],
        'Daylighting Savings (%)': [f"{savings:.1f}"]
    })
    summary_path = os.path.join(args.outdir, "energy_summary.csv")
    summary_df.to_csv(summary_path, index=False)

    print("\\n--- Lighting Energy Summary ---")
    print(f"  Lighting Power Density (LPD): {lpd:.2f} W/m²")
    print(f"  Annual Energy Consumption:    {annual_energy_kwh:.0f} kWh")
    print(f"  Energy Savings vs. No DL-Ctrl:  {savings:.1f}%")
    print(f"\\nSummary saved to: {summary_path}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=['generate_schedule', 'combine_results', 'calculate_energy'])
    parser.add_argument("--num-points", type=int, required=True)
    parser.add_argument("--outdir", type=str, default="../08_results")

    parser.add_argument("--direct-ill", help="Path to direct-only illuminance file.")
    parser.add_argument("--open-ill", help="Path to blinds-open illuminance file.")
    parser.add_argument("--closed-ill", help="Path to blinds-closed illuminance file.")
    parser.add_argument("--final-ill", help="Path to final combined illuminance file.")
    parser.add_argument("--threshold", type=float, default=1000.0)
    parser.add_argument("--trigger", type=float, default=0.02)

    parser.add_argument("--total-power", type=float, help="Total installed lighting power (Watts)")
    parser.add_argument("--room-area", type=float, help="Room floor area (m^2)")
    parser.add_argument("--control-type", choices=['Continuous', 'ContinuousOff', 'Stepped'])
    parser.add_argument("--setpoint", type=float, default=500.0)
    parser.add_argument("--min-power-frac", type=float, default=0.1)
    parser.add_argument("--min-light-frac", type=float, default=0.1)
    parser.add_argument("--n-steps", type=int, default=3)
    args = parser.parse_args()

    if args.action == 'generate_schedule':
        generate_schedule(args.direct_ill, args.num_points, args.threshold, args.trigger)
    elif args.action == 'combine_results':
        combine_results("blinds.schedule", args.open_ill, args.closed_ill, args.num_points, args.final_ill)
    elif args.action == 'calculate_energy':
        calculate_energy(args.final_ill, args.num_points, args)
`;

    const shContent = `#!/bin/bash
# RUN_Lighting_Energy_Analysis.sh
# Full workflow for annual lighting energy estimation with dynamic shading.
# IMPORTANT: This script requires matrix files (view.mtx, daylight.mtx) generated
# by the "Annual Daylight (3-Phase)" recipe. Run that recipe first.

# --- Configuration ---
PROJECT_NAME="${projectName}"
WEATHER_FILE="../04_skies/${epwFileName}"
BSDF_OPEN="../05_bsdf/${bsdfOpenFile}"
BSDF_CLOSED="../05_bsdf/${bsdfClosedFile}"
POINTS_FILE="../08_results/grid.pts"
PYTHON_SCRIPT="process_energy.py"
NUM_POINTS=$(wc -l < "\${POINTS_FILE}")

# Blind operation parameters
BLINDS_THRESHOLD=${blindsThreshold}
BLINDS_TRIGGER=${blindsTrigger}

# Energy parameters
TOTAL_POWER=${totalInstalledPower}
ROOM_AREA=${roomArea}
CONTROL_TYPE=${dc.controlType}
SETPOINT=${dc.setpoint}
MIN_POWER_FRAC=${dc.minPowerFraction}
MIN_LIGHT_FRAC=${dc.minLightFraction}
N_STEPS=${dc.nSteps}

# --- File & Directory Setup ---
RESULTS_DIR="../08_results"
MATRIX_DIR="\${RESULTS_DIR}/matrices"
SKY_DIR="../04_skies"

echo "--- Starting Lighting Energy Simulation Workflow ---"
echo "Found \${NUM_POINTS} sensor points."

# 1. Generate Sky Matrices
echo "1. Generating full and direct-only sky matrices..."
SKY_MTX="\${MATRIX_DIR}/sky.smx"
SKY_DIRECT_MTX="\${MATRIX_DIR}/sky_direct.smx"
epw2wea "\${WEATHER_FILE}" | gendaymtx -m 1 - > "\${SKY_MTX}"
epw2wea "\${WEATHER_FILE}" | gendaymtx -m 1 -d - > "\${SKY_DIRECT_MTX}"

# 2. Calculate direct illuminance for blind schedule
echo "2. Calculating direct-only illuminance for blind schedule..."
ILL_DIRECT="\${RESULTS_DIR}/results_direct.ill"
dctimestep "\${MATRIX_DIR}/view.mtx" "\${BSDF_OPEN}" "\${MATRIX_DIR}/daylight.mtx" "\${SKY_DIRECT_MTX}" > "\${ILL_DIRECT}"

# 3. Generate Blind Schedule
echo "3. Generating hourly blind operation schedule..."
python3 "\${PYTHON_SCRIPT}" generate_schedule --direct-ill "\${ILL_DIRECT}" --num-points "\${NUM_POINTS}" --threshold "\${BLINDS_THRESHOLD}" --trigger "\${BLINDS_TRIGGER}" --outdir "\${RESULTS_DIR}"

# 4. Calculate annual illuminance for blinds OPEN and CLOSED
echo "4. Calculating annual illuminance for both blind states..."
ILL_OPEN="\${RESULTS_DIR}/results_open.ill"
ILL_CLOSED="\${RESULTS_DIR}/results_closed.ill"
dctimestep "\${MATRIX_DIR}/view.mtx" "\${BSDF_OPEN}" "\${MATRIX_DIR}/daylight.mtx" "\${SKY_MTX}" > "\${ILL_OPEN}"
dctimestep "\${MATRIX_DIR}/view.mtx" "\${BSDF_CLOSED}" "\${MATRIX_DIR}/daylight.mtx" "\${SKY_MTX}" > "\${ILL_CLOSED}"

# 5. Combine results based on schedule
echo "5. Combining results based on blind schedule..."
ILL_FINAL="\${RESULTS_DIR}/\${PROJECT_NAME}_energy_final.ill"
python3 "\${PYTHON_SCRIPT}" combine_results --open-ill "\${ILL_OPEN}" --closed-ill "\${ILL_CLOSED}" --final-ill "\${ILL_FINAL}" --num-points "\${NUM_POINTS}" --outdir "\${RESULTS_DIR}"

# 6. Run final energy calculation
echo "6. Calculating final energy metrics..."
python3 "\${PYTHON_SCRIPT}" calculate_energy \\
    --final-ill "\${ILL_FINAL}" \\
    --num-points "\${NUM_POINTS}" \\
    --outdir "\${RESULTS_DIR}" \\
    --total-power "\${TOTAL_POWER}" \\
    --room-area "\${ROOM_AREA}" \\
    --control-type "\${CONTROL_TYPE}" \\
    --setpoint "\${SETPOINT}" \\
    --min-power-frac "\${MIN_POWER_FRAC}" \\
    --min-light-frac "\${MIN_LIGHT_FRAC}" \\
    --n-steps "\${N_STEPS}"

echo ""
echo "--- Energy Analysis Workflow Complete ---"
`;

    const batContent = `# BAT file for this complex workflow is not provided. Please use a bash interpreter.`;

        return [
        { fileName: `RUN_${projectName}_Energy_Analysis.sh`, content: shContent },
        { fileName: `RUN_${projectName}_Energy_Analysis.bat`, content: batContent },
        { fileName: 'process_energy.py', content: pythonScriptContent }
    ];
}

/**
 * Creates scripts for an annual façade irradiation analysis.
 * @param {object} projectData - The complete project data object.
 * @returns {object} An object containing the shell and bat script files.
 */
function createFacadeIrradiationScript(projectData) {
    const { projectInfo: pi, mergedSimParams: p, geometry } = projectData;
    const projectName = pi['project-name'].replace(/\s+/g, '_') || 'scene';
    const epwFileName = p['weather-file']?.name || 'weather.epw';
    
    const ab = p['ab'] || 5;
    const ad = p['ad'] || 2048;
    const as = p['as'] || 1024;
    const ar = p['ar'] || 512;
    const aa = p['aa'] || 0.15;
    const lw = p['lw'] || 0.005;

    // --- Generate Façade Points File ---
    const { W, L, H, rotationY } = geometry.room;
    const { 'facade-selection': facade, 'facade-offset': offset, 'facade-grid-spacing': spacing } = p;

    const points = [];
    let start, vecU, vecV, normal, numU, numV;

    // Define plane based on facade, accounting for room rotation
    const rotRad = (rotationY * Math.PI) / 180;
    const cosR = Math.cos(rotRad);
    const sinR = Math.sin(rotRad);

    const rotate = (v) => ({ x: v.x * cosR - v.y * sinR, y: v.x * sinR + v.y * cosR });

    switch (facade) {
        case 'S':
            start = rotate({ x: -W / 2, y: L / 2 + offset });
            vecU = rotate({ x: 1, y: 0 }); // Along width
            vecV = { x: 0, y: 0, z: 1 }; // Vertical
            normal = rotate({ x: 0, y: -1 }); // Pointing towards building
            numU = Math.floor(W / spacing);
            numV = Math.floor(H / spacing);
            break;
        case 'N':
            start = rotate({ x: W/2, y: -L/2 - offset });
            vecU = rotate({ x: -1, y: 0 });
            vecV = { x: 0, y: 0, z: 1 };
            normal = rotate({ x: 0, y: 1 });
            numU = Math.floor(W / spacing);
            numV = Math.floor(H / spacing);
            break;
        case 'E':
            start = rotate({ x: W / 2 + offset, y: L / 2 });
            vecU = rotate({ x: 0, y: -1 });
            vecV = { x: 0, y: 0, z: 1 };
            normal = rotate({ x: -1, y: 0 });
            numU = Math.floor(L / spacing);
            numV = Math.floor(H / spacing);
            break;
        case 'W':
            start = rotate({ x: -W / 2 - offset, y: -L/2 });
            vecU = rotate({ x: 0, y: 1 });
            vecV = { x: 0, y: 0, z: 1 };
            normal = rotate({ x: 1, y: 0 });
            numU = Math.floor(L / spacing);
            numV = Math.floor(H / spacing);
            break;
    }

    for (let i = 0; i <= numU; i++) {
        for (let j = 0; j <= numV; j++) {
            const px = start.x + i * spacing * vecU.x;
            const py = start.y + i * spacing * vecU.y;
            const pz = j * spacing * vecV.z;
            points.push(`${px.toFixed(4)} ${py.toFixed(4)} ${pz.toFixed(4)} ${normal.x.toFixed(4)} ${normal.y.toFixed(4)} 0.0`);
        }
    }
    const facadePtsContent = points.join('\n');
    project.addSimulationFile('facade-grid-file', 'facade_grid.pts', facadePtsContent);
    // --- End of Points File Generation ---
    
    const shContent = `#!/bin/bash
    # RUN_Facade_Irradiation.sh
    # Calculates annual solar irradiation on a facade, including shading effects.

    # --- Configuration ---
    PROJECT_NAME="${projectName}"
    WEATHER_FILE="../04_skies/${epwFileName}"
    GEOM_FILE="../01_geometry/\${PROJECT_NAME}.rad"
    MAT_FILE="../02_materials/\${PROJECT_NAME}_materials.rad"
    POINTS_FILE="../08_results/facade_grid.pts"

    # Radiance Parameters
    AB=${ab}; AD=${ad}; AS=${as}; AR=${ar}; AA=${aa}; LW=${lw}

    # --- Directory Setup ---
    OCT_DIR="../06_octrees"
    RESULTS_DIR="../08_results"
    MATRIX_DIR="\${RESULTS_DIR}/matrices"
    mkdir -p \$OCT_DIR \$RESULTS_DIR \$MATRIX_DIR

    echo "--- Starting Annual Façade Irradiation Analysis ---"

    # 1. Generate Sky Matrix from EPW
    echo "1. Generating annual sky matrix..."
    SKY_MTX="\${MATRIX_DIR}/sky.smx"
    gendaymtx -m 1 "\${WEATHER_FILE}" > "\${SKY_MTX}"

    # 2. Create Scene Octree (includes room, shading, context)
    echo "2. Creating scene octree..."
    OCTREE="\${OCT_DIR}/\${PROJECT_NAME}.oct"
    oconv "\${GEOM_FILE}" "\${MAT_FILE}" > "\${OCTREE}"

    # 3. Calculate Daylight Coefficients for the facade grid
    echo "3. Calculating daylight coefficients (rcontrib)..."
    FACADE_DCMTX="\${MATRIX_DIR}/facade_dc.mtx"
    rcontrib -I+ -w -ab \${AB} -ad \${AD} -as \${AS} -ar \${AR} -aa \${AA} -lw \${LW} \\
        -f reinhart.cal -b tbin -bn 145 -m sky_glow \\
        "\${OCTREE}" < "\${POINTS_FILE}" > "\${FACADE_DCMTX}"

    # 4. Calculate hourly irradiance for the year
    echo "4. Calculating hourly irradiance (dctimestep)..."
    HOURLY_IRRAD="\${RESULTS_DIR}/facade_hourly_W.ill"
    dctimestep "\${FACADE_DCMTX}" "\${SKY_MTX}" > "\${HOURLY_IRRAD}"

    # 5. Sum hourly results to get annual total in kWh/m^2
    echo "5. Summing annual results..."
    ANNUAL_IRRAD="\${RESULTS_DIR}/facade_annual_kWh.txt"
    total -if3 "\${HOURLY_IRRAD}" | rcalc -e 'total_solar=$1+$2+$3; $1=total_solar * 8760 / 1000' > "\${ANNUAL_IRRAD}"

    echo "---"
    echo "Analysis Complete."
    echo "Annual irradiation results (kWh/m²/year) saved to: \${ANNUAL_IRRAD}"
    echo "---"
    `;

    const batContent = `REM This workflow uses advanced shell features. Please run the .sh script using a bash interpreter (e.g., Git Bash, WSL).`;
    
    return {
        sh: { fileName: `RUN_${projectName}_Facade_Irradiation.sh`, content: shContent },
        bat: { fileName: `RUN_${projectName}_Facade_Irradiation.bat`, content: batContent }
    };

    /**
     * Creates scripts for an annual solar radiation analysis on interior surfaces.
     * @param {object} projectData - The complete project data object.
     * @returns {object} An object containing the shell and bat script files.
     */
    function createAnnualRadiationScript(projectData) {
        const { projectInfo: pi, mergedSimParams: p } = projectData;
        const projectName = pi['project-name'].replace(/\s+/g, '_') || 'scene';
        const epwFileName = p['weather-file']?.name || 'weather.epw';

        // Use high-quality parameters from merged params, with strong defaults for matrix generation
        const ab = p['ab'] || 6;
        const ad = p['ad'] || 2048;
        const as = p['as'] || 1024;
        const ar = p['ar'] || 512;
        const aa = p['aa'] || 0.15;
        const lw = p['lw'] || 0.005;
        const lightDefs = generateLightSourceDefinitions(projectData.lighting, projectData.geometry.room);

        const shContent = `#!/bin/bash
    # RUN_Annual_Radiation.sh
    # Calculates the total annual solar radiation (kWh/m²/year) on interior surfaces.
    # Generated by Ray Modeler.

    # --- Configuration ---
    PROJECT_NAME="${projectName}"
    WEATHER_FILE="../04_skies/${epwFileName}"

    # High-quality parameters for matrix generation
    AB=${ab}; AD=${ad}; AS=${as}; AR=${ar}; AA=${aa}; LW=${lw}

    # --- File & Directory Setup ---
    GEOM_FILE="../01_geometry/\${PROJECT_NAME}.rad"
    MAT_FILE="../02_materials/\${PROJECT_NAME}_materials.rad"
    OCT_DIR="../06_octrees"
    RESULTS_DIR="../08_results"
    MATRIX_DIR="\${RESULTS_DIR}/matrices"
    POINTS_FILE="../08_results/grid.pts"

    mkdir -p \$OCT_DIR \$RESULTS_DIR \$MATRIX_DIR

    # Check for points file
    if [ ! -s "\${POINTS_FILE}" ]; then
        echo "ERROR: Sensor points file (grid.pts) is empty or not found."
        echo "Please enable sensor grids on interior surfaces in the 'Sensor Grid' panel."
        exit 1
    fi
    NUM_POINTS=\$(wc -l < "\${POINTS_FILE}")

    echo "--- Starting Annual Solar Radiation Analysis for \${NUM_POINTS} points ---"

    # 1. Create Master Octree
    echo "1. Creating master octree (including shading devices)..."
    OCTREE="\${OCT_DIR}/\${PROJECT_NAME}.oct"
    (
    cat "\${GEOM_FILE}"
    cat "\${MAT_FILE}"
    echo
    echo "${lightDefs}"
    ) | oconv - > "\${OCTREE}"
    if [ \$? -ne 0 ]; then echo "Error creating master octree."; exit 1; fi

    # 2. Generate Annual Sky Matrix (S)
    echo "2. Generating annual sky matrix from EPW..."
    SKY_MTX="\${MATRIX_DIR}/sky.smx"
    gendaymtx -m 1 "\${WEATHER_FILE}" > "\${SKY_MTX}"
    if [ \$? -ne 0 ]; then echo "Error generating Sky Matrix."; exit 1; fi

    # 3. Generate Daylight Coefficients for Irradiance (DC)
    echo "3. Generating Daylight Coefficients (-I+)..."
    DC_MTX="\${MATRIX_DIR}/dc_irradiance.mtx"
    rcontrib -I+ -w -ab \${AB} -ad \${AD} -as \${AS} -ar \${AR} -aa \${AA} -lw \${LW} \\
        -f reinhart.cal -b tbin -bn 145 -m sky_glow \\
        "\${OCTREE}" < "\${POINTS_FILE}" > "\${DC_MTX}"
    if [ \$? -ne 0 ]; then echo "Error generating Daylight Coefficient Matrix."; exit 1; fi

    # 4. Calculate hourly solar irradiance for the year
    echo "4. Calculating hourly solar irradiance (dctimestep)..."
    HOURLY_IRRAD_RGB="\${RESULTS_DIR}/hourly_solar_rgb.ill"
    dctimestep "\${DC_MTX}" "\${SKY_MTX}" > "\${HOURLY_IRRAD_RGB}"
    if [ \$? -ne 0 ]; then echo "Error during dctimestep."; exit 1; fi

    # 5. Sum RGB channels to get total hourly solar irradiance
    echo "5. Summing RGB channels to get total hourly irradiance..."
    HOURLY_IRRAD_TOTAL="\${RESULTS_DIR}/hourly_solar_total.txt"
    rmtxop -fa -c 1 1 1 "\${HOURLY_IRRAD_RGB}" > "\${HOURLY_IRRAD_TOTAL}"
    if [ \$? -ne 0 ]; then echo "Error summing RGB channels with rmtxop."; exit 1; fi

    # 6. Sum hourly results to get annual total in kWh/m^2
    echo "6. Summing annual results and converting to kWh/m^2..."
    ANNUAL_KWH="\${RESULTS_DIR}/\${PROJECT_NAME}_annual_radiation.txt"
    total "\${HOURLY_IRRAD_TOTAL}" | rmtxop -s 0.001 -fa -c 1 \${NUM_POINTS} - > "\${ANNUAL_KWH}"
    if [ \$? -ne 0 ]; then echo "Error summing annual results."; exit 1; fi

    echo "---"
    echo "Annual Solar Radiation analysis complete."
    echo "Final results (kWh/m²/year) saved to: \${ANNUAL_KWH}"
    echo "You can load this file in the Analysis sidebar to visualize the results."
    echo "---"
    `;

        const batContent = `@echo off
    REM RUN_Annual_Radiation.bat
    REM This workflow uses advanced shell features.
    REM Please run the .sh script using a bash interpreter (e.g., Git Bash, WSL on Windows).
    echo This recipe requires a bash environment to run correctly.
    echo Please execute the RUN_Annual_Radiation.sh script.
    `;

        return {
            sh: { fileName: `RUN_${projectName}_Annual_Radiation.sh`, content: shContent },
            bat: { fileName: `RUN_${projectName}_Annual_Radiation.bat`, content: batContent }
        };
    }
}