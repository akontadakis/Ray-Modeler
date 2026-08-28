// scripts/scriptGenerator.js

import { _parseAndBinSpectralData, transmittanceToTransmissivity } from './radiance.js';

/**
 * Converts a "HH:MM" clock string to decimal hours (e.g. "12:30" -> 12.5),
 * which is the format gensky/gendaylit expect. A bare number is passed through.
 * @param {string} timeStr - The time as "HH:MM".
 * @param {string} fallback - Value to use when timeStr is empty.
 * @returns {number} Decimal hours.
 */
function _timeToDecimalHour(timeStr, fallback = '12:00') {
    const parts = String(timeStr || fallback).split(':');
    const h = parseFloat(parts[0]);
    const m = parts.length > 1 ? parseFloat(parts[1]) : 0;
    return (isNaN(h) ? 0 : h) + (isNaN(m) ? 0 : m) / 60;
}

/**
 * Number of Reinhart bins for a given subdivision factor, as reinhart.cal computes it
 * (`rcalc -n -e 'MF:N' -f reinhart.cal -e '$1=Nrbins'`). The count is one MORE than the
 * patch count usually quoted, because bin 0 is the ground. It must match `gendaymtx -m N`
 * on the other side of every matrix multiplication.
 * @param {number} mf - The Reinhart subdivision factor (1..4).
 * @returns {number} The value rcontrib must be given as -bn.
 */
function _reinhartNrbins(mf) {
    const table = { 1: 146, 2: 578, 3: 1298, 4: 2306 };
    return table[mf] || table[1];
}

/**
 * The Reinhart subdivision used by the annual daylight recipes. IES LM-83 asks for at
 * least MF:4 for sDA/ASE, and the 3-phase matrices feed those recipes, so the whole
 * annual-daylight family shares one factor. gendaymtx -m and rcontrib -e MF: must agree
 * or the matrices cannot be multiplied.
 */
const ANNUAL_SKY_MF = 4;

/**
 * gensky/gendaylit emit only the `skyfunc` brightfunc modifier; they never emit a
 * surface that actually radiates. Every scene therefore needs an explicit sky and
 * ground glow bound to a source, appended to the gensky output. `sky_glow` is also
 * the modifier name the daylight-matrix rcontrib runs bind with `-m sky_glow`.
 */
const SKY_GLOW_PRIMITIVES = [
    'skyfunc glow sky_glow',
    '0',
    '0',
    '4 1 1 1 0',
    '',
    'sky_glow source sky',
    '0',
    '0',
    '4 0 0 1 180',
    '',
    'skyfunc glow ground_glow',
    '0',
    '0',
    '4 1 1 1 0',
    '',
    'ground_glow source ground',
    '0',
    '0',
    '4 0 0 -1 180'
];

/**
 * Shell snippet that appends the sky/ground glow+source block to a sky file.
 * @param {string} shellVar - The shell expansion of the sky file, already escaped
 *                            for inclusion in a template literal (e.g. '\\${SKY_FILE}').
 * @returns {string} A bash heredoc that appends the block.
 */
function _appendSkyGlowSh(shellVar) {
    return `    # gensky only defines the "skyfunc" brightfunc pattern. Bind it to a sky and a
    # ground source, or nothing in the octree emits any light.
    cat >> "${shellVar}" << 'SKYGLOWEOF'

${SKY_GLOW_PRIMITIVES.join('\n')}
SKYGLOWEOF`;
}

/**
 * Batch-file equivalent of {@link _appendSkyGlowSh}.
 * @param {string} batVar - The batch expansion of the sky file (e.g. '%SKY_FILE%').
 * @returns {string} A series of echo redirections appending the block.
 */
function _appendSkyGlowBat(batVar) {
    const lines = SKY_GLOW_PRIMITIVES.map(l => (l === '' ? `    echo.>> "${batVar}"` : `    echo ${l}>> "${batVar}"`));
    return `    REM gensky only defines the "skyfunc" brightfunc pattern. Bind it to a sky and a\n    REM ground source, or nothing in the octree emits any light.\n    echo.>> "${batVar}"\n${lines.join('\n')}`;
}

/**
 * Maps a Three.js DIRECTION vector into Radiance's frame.
 *
 * A direction carries no origin, so this is the bare axis swap of the shared convention,
 * (x, y, z)_three -> (x, -z, y)_radiance, with NO room centring and no L/2 term. Using the
 * point form on a vector is what previously made aim vectors disagree with positions.
 * @param {number[]} v - [x, y, z] in the Three.js frame.
 * @returns {number[]} [x, y, z] in the Radiance frame.
 */
function _threeVectorToRadiance(v) {
    const [x, y, z] = (v || [0, 0, 0]).map(n => Number(n) || 0);
    return [x, -z, y];
}

/** Multiplies two row-major 3x3 matrices. */
function _mat3Mul(a, b) {
    const out = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            out[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
        }
    }
    return out;
}

/** Right-handed active rotation about X, in degrees. */
function _rotXMat(deg) {
    const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    return [[1, 0, 0], [0, c, -s], [0, s, c]];
}
/** Right-handed active rotation about Y, in degrees. */
function _rotYMat(deg) {
    const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
}
/** Right-handed active rotation about Z, in degrees. */
function _rotZMat(deg) {
    const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
}

/**
 * The luminaire orientation, in Radiance's frame, for a Three.js Euler rotation.
 *
 * The preview builds its orientation as Euler(rx, ry, rz, 'YXZ') = Ry(ry).Rx(rx).Rz(rz)
 * and aims the fixture along its local -Z. Conjugating that with the shared axis map
 * (x, y, z)_three -> (x, -z, y)_radiance gives
 *
 *     R_rad = Rz(ry) . Rx(rx) . Ry(-rz) . Rx(90)
 *
 * which is exactly the flag order emitted for xform below. With the panel's default
 * rotation of (-90, 0, 0) this composes to the identity, so an ies2rad prototype - which
 * is already aimed at nadir - is left pointing straight down.
 * @param {{x: number, y: number, z: number}} rot - Three.js Euler angles in degrees.
 * @returns {number[][]} A row-major 3x3 rotation matrix in the Radiance frame.
 */
function _luminaireRotationMatrix(rot) {
    const rx = Number(rot?.x) || 0, ry = Number(rot?.y) || 0, rz = Number(rot?.z) || 0;
    return _mat3Mul(_rotZMat(ry), _mat3Mul(_rotXMat(rx), _mat3Mul(_rotYMat(-rz), _rotXMat(90))));
}

/** Applies a 3x3 matrix to a 3-vector. */
function _applyMat3(m, v) {
    return [
        m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
        m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
        m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]
    ];
}

/** Trims float noise (and -0) out of a generated coordinate. */
function _num(n) {
    const v = Number(n.toFixed(6));
    return Object.is(v, -0) ? 0 : v;
}

/**
* Generates Radiance definitions for artificial light sources using xform for placement.
* @param {object|null} lightingData - The lighting state object from lightingManager.
* @param {object} roomData - The room geometry data { W, L, H, rotationY }.
* @param {object} simulationFiles - The project's collection of simulation file data.
* @returns {string} A string containing Radiance light source definitions. 
*/ 
    function generateLightSourceDefinitions(lightingData, roomData, simulationFiles) {
        // lightingData comes from lightingManager.getCurrentState() (see scripts/lighting.js)
        // roomData is expected to be { W, L, H, rotationY } from projectData.geometry.room
        if (!lightingData || !lightingData.type) {
            return '# No artificial lighting enabled in the scene.';
        }

    // Apply the Maintenance Factor (MF) to the luminaire output
    const mf = lightingData.maintenance_factor || 1.0;

    const { W, L, H, rotationY } = roomData;

    // Orientation, in Radiance's frame, for the whole luminaire family. The IES branch
    // emits the same composition as xform flags; the inline primitives below apply this
    // matrix directly, so a rotated ring or panel exports the way the preview shows it.
    const rotMatrix = _luminaireRotationMatrix(lightingData.rotation || { x: 0, y: 0, z: 0 });
    const rot = lightingData.rotation || { x: 0, y: 0, z: 0 };

    // POSITION MAP (shared convention): a room-local point [width, depth, height] becomes
    // Radiance (width - W/2, L/2 - depth, height). The depth term is L/2 MINUS the depth,
    // not depth minus L/2: the old form mirrored the room, so every luminaire landed in
    // the wrong half. `lightingData.position` is corner-origin (x in [0, W], z in [0, L]).
    const positions = [];
    if (lightingData.placement === 'grid' && lightingData.grid) {
        const { rows, cols, row_spacing, col_spacing } = lightingData.grid;
        const gridWidth = (cols - 1) * col_spacing;
        const gridDepth = (rows - 1) * row_spacing;
        // The light's position from the UI becomes the center of the grid
        const startX = lightingData.position.x - gridWidth / 2;
        const startY = lightingData.position.z - gridDepth / 2; // depth (Z in THREE)
        const height = lightingData.position.y; // Z in Radiance is height (Y in THREE)

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                positions.push({
                    x: _num(startX + c * col_spacing - W / 2),
                    y: _num(L / 2 - (startY + r * row_spacing)),
                    z: _num(height)
                });
            }
        }
    } else {
        positions.push({
            x: _num(lightingData.position.x - W / 2),
            y: _num(L / 2 - lightingData.position.z),
            z: _num(lightingData.position.y)
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
        case 'spotlight': {
            // The aim vector comes from the spot-dir-x/y/z controls, mapped into Radiance
            // with the DIRECTION form of the shared axis swap. It used to be hard-coded to
            // "0 0 -1", which silently discarded whatever the user aimed the spot at.
            // Radiance reads the vector's length as the focal distance, so the "Normalize
            // Vector" toggle scales it to unit length when set.
            let aim = _threeVectorToRadiance(lightingData.direction || [0, -1, 0]);
            const aimLen = Math.hypot(aim[0], aim[1], aim[2]);
            if (aimLen === 0) {
                aim = [0, 0, -1];
            } else if (lightingData.normalize) {
                aim = aim.map(c => c / aimLen);
            }
            matArgs = `7 ${scaledRgb(lightingData.rgb)} ${lightingData.cone_angle} ${aim.map(_num).join(' ')}`;
            break;
        }
        case 'glow': matArgs = `4 ${scaledRgb(lightingData.rgb)} ${lightingData.max_radius}`; break;
        case 'illum': matArgs = `2 ${lightingData.alternate_material || 'void'} ${scaledRgb(lightingData.rgb)}`; break;
        case 'ies':
            const totalMultiplier = (lightingData.ies_multiplier || 1.0) * mf;
            const iesFileInputId = 'ies-file-input'; // The static ID from the lighting panel
            const iesFileData = simulationFiles[iesFileInputId];

            if (iesFileData && iesFileData.name) {
                // The extension must be stripped with a single escaped dot: /\\.ies$/ inside a
                // JS regex literal matches a literal backslash followed by "ies", so the
                // basename kept the ".ies" suffix and the xform below pointed at
                // "<name>.ies.rad", a file ies2rad never writes.
                iesBasename = iesFileData.name.replace(/\.ies$/i, '');
                // ies2rad flags carried through from the lighting panel. -d takes its unit
                // letter with NO space ("-dm"); -c only takes effect when the lamp type is
                // unknown, so forcing a colour also forces the lamp type to "default".
                const iesFlags = [`-m ${totalMultiplier.toPrecision(4)}`];
                const iesUnits = lightingData.ies_units;
                if (iesUnits && /^[mfic](\/[0-9.]+)?$/.test(String(iesUnits))) iesFlags.push(`-d${iesUnits}`);
                if (lightingData.ies_force_color && Array.isArray(lightingData.ies_color)) {
                    iesFlags.push('-t default');
                    iesFlags.push(`-c ${lightingData.ies_color.map(c => Number(c) || 0).join(' ')}`);
                } else if (lightingData.ies_lamp_type) {
                    iesFlags.push(`-t ${lightingData.ies_lamp_type}`);
                }
                lightRad += `!ies2rad ${iesFlags.join(' ')} "../11_files/${iesFileData.name}"\n`;
            } else {
                return '# ERROR: IES file selected but file data not found in project. Please re-select the file.\n';
            }
            break;
        }

    if (lightingData.type !== 'ies') {
        if (lightingData.type === 'illum') {
            // illum needs: 1 string arg (alternate material), 0 integer args, 3 reals (R G B)
            lightRad += `void illum ${matIdentifier}\n1 ${lightingData.alternate_material || 'void'}\n0\n3 ${scaledRgb(lightingData.rgb)}\n\n`;
        } else {
            lightRad += `void ${lightingData.type} ${matIdentifier}\n0\n0\n${matArgs}\n\n`;
        }

        // 2. Define the light geometry inline at each position. Emitting the primitive
        //    directly at each luminaire location avoids needing an external prototype
        //    .rad file (xform requires a real filename, which was never written).
        // The luminaire's orientation applies to every geometry type, not just IES. The
        // emitting face points along the fixture's local -Z (nadir with the default
        // rotation), and the local frame is rotated by `rotMatrix` about the luminaire's
        // own position before being written out. Previously the ring's normal was pinned
        // to "0 0 1", so a ceiling downlight exported as an uplighter, and `rotation` was
        // ignored outright for every non-IES type.
        const emitAxis = _applyMat3(rotMatrix, [0, 0, -1]);
        const localToWorld = (pos, v) => {
            const r = _applyMat3(rotMatrix, v);
            return [_num(pos.x + r[0]), _num(pos.y + r[1]), _num(pos.z + r[2])];
        };
        positions.forEach((pos, i) => {
            const gid = `${geomIdentifier}_${i}`;
            switch (lightingData.geometry.type) {
                case 'sphere':
                    lightRad += `${matIdentifier} sphere ${gid}\n0\n0\n4 ${pos.x} ${pos.y} ${pos.z} ${lightingData.geometry.radius}\n\n`;
                    break;
                case 'cylinder': {
                    const halfLen = lightingData.geometry.length / 2;
                    const a = localToWorld(pos, [0, 0, -halfLen]);
                    const b = localToWorld(pos, [0, 0, halfLen]);
                    lightRad += `${matIdentifier} cylinder ${gid}\n0\n0\n7 ${a.join(' ')} ${b.join(' ')} ${lightingData.geometry.radius}\n\n`;
                    break;
                }
                case 'ring':
                    lightRad += `${matIdentifier} ring ${gid}\n0\n0\n8 ${pos.x} ${pos.y} ${pos.z}  ${emitAxis.map(_num).join(' ')}  ${lightingData.geometry.innerRadius} ${lightingData.geometry.outerRadius}\n\n`;
                    break;
                case 'polygon':
                default: {
                    const halfW = 0.125, halfH = 0.125;
                    const corners = [
                        localToWorld(pos, [-halfW, -halfH, 0]),
                        localToWorld(pos, [halfW, -halfH, 0]),
                        localToWorld(pos, [halfW, halfH, 0]),
                        localToWorld(pos, [-halfW, halfH, 0])
                    ];
                    lightRad += `${matIdentifier} polygon ${gid}\n0\n0\n12\n  ${corners.map(c => c.join(' ')).join('\n  ')}\n\n`;
                    break;
                }
            }
        });
    }

    // 3. For IES luminaires, instance the ies2rad-generated prototype file at each
    //    position with xform (rotations before translation so each unit is oriented
    //    about its own origin before being moved into place).
    //
    //    The ies2rad prototype is ALREADY aimed at nadir (its luminous-opening polygon
    //    winds to a -Z normal), so the flags below must compose to the identity for the
    //    panel's default rotation of (-90, 0, 0) - and they do: -rx 90 followed by
    //    -rx -90 cancels. xform applies flags in command order, so this order realises
    //    R = Rz(ry) . Rx(rx) . Ry(-rz) . Rx(90), the conjugate of the preview's
    //    Euler(rx, ry, rz, 'YXZ') under the shared (x, y, z) -> (x, -z, y) axis map.
    //    The old form used an inverted axis map (-ry from +rot.z, -rz from -rot.y).
    if (lightingData.type === 'ies') {
        positions.forEach((pos) => {
            lightRad += `!xform -rx 90 -ry ${_num(-rot.z)} -rx ${_num(rot.x)} -rz ${_num(rot.y)} -t ${pos.x} ${pos.y} ${pos.z} "${iesBasename}.rad"\n`;
        });
    }

    return lightRad;
}

/**
 * Main function to generate all relevant simulation scripts based on a selected recipe.
 * @param {object} projectData - The complete project data object, including merged parameters.
 * @param {string} recipeType - The template ID of the recipe being executed (e.g., 'template-recipe-illuminance').
 * @returns {Array<object>} An array of script file objects {fileName, content}.
 */
/**
 * Escapes a user-typed path for safe use inside a double-quoted bash string.
 * @param {string} p
 * @returns {string}
 */
function _shQuoteInner(p) {
    return String(p).replace(/[\\$"`]/g, m => '\\' + m).replace(/[\r\n]/g, '');
}

/**
 * Escapes a user-typed path for safe use inside a double-quoted `set` in a .bat file.
 * @param {string} p
 * @returns {string}
 */
function _batQuoteInner(p) {
    return String(p).replace(/["%\r\n]/g, '');
}

/**
 * Builds the bash preamble that puts the Radiance binaries on PATH.
 *
 * Scripts launched from the Electron app inherit the GUI's minimal PATH
 * (/usr/bin:/bin:/usr/sbin:/sbin), NOT the login shell's. Without this block
 * every Radiance command dies with "command not found" while the script keeps
 * running to its completion banner. The "Radiance Installation Path" field was
 * collected into the project file and then never used by any generated script.
 *
 * @param {object} projectData
 * @returns {string} Bash source, no trailing newline.
 */
function _radianceEnvSh(projectData) {
    const configured = _shQuoteInner(projectData?.projectInfo?.['radiance-path'] || '');
    return `
# --- Radiance environment (generated by Ray Modeler) ------------------------
# Set from the "Radiance Installation Path" field in the Project Setup panel.
RADIANCE_ROOT="${configured}"
# Accept either the install root or the bin directory itself.
case "\${RADIANCE_ROOT}" in
    */bin|*/bin/) RADIANCE_ROOT="\${RADIANCE_ROOT%/}"; RADIANCE_ROOT="\${RADIANCE_ROOT%/bin}" ;;
esac
if [ -z "\${RADIANCE_ROOT}" ] || [ ! -x "\${RADIANCE_ROOT}/bin/oconv" ]; then
    for _cand in /usr/local/radiance /opt/radiance /usr/local /opt/homebrew /Applications/Radiance; do
        if [ -x "\${_cand}/bin/oconv" ]; then RADIANCE_ROOT="\${_cand}"; break; fi
    done
fi
if [ -n "\${RADIANCE_ROOT}" ] && [ -d "\${RADIANCE_ROOT}/bin" ]; then
    export PATH="\${RADIANCE_ROOT}/bin:\${PATH}"
    if [ -d "\${RADIANCE_ROOT}/lib" ]; then
        export RAYPATH="\${RADIANCE_ROOT}/lib\${RAYPATH:+:\${RAYPATH}}"
    fi
fi
if ! command -v oconv >/dev/null 2>&1; then
    echo "ERROR: Radiance was not found." >&2
    echo "       Set the Radiance Installation Path in Ray Modeler's Project Setup panel," >&2
    echo "       or install Radiance from https://www.radiance-online.org/." >&2
    echo "       Looked in: '\${RADIANCE_ROOT}'." >&2
    exit 1
fi
# ---------------------------------------------------------------------------
`;
}

/**
 * Builds the batch-file equivalent of _radianceEnvSh().
 * @param {object} projectData
 * @returns {string}
 */
function _radianceEnvBat(projectData) {
    const configured = _batQuoteInner(projectData?.projectInfo?.['radiance-path'] || '');
    return `
REM --- Radiance environment (generated by Ray Modeler) -----------------------
set "RADIANCE_ROOT=${configured}"
if not exist "%RADIANCE_ROOT%\\bin\\oconv.exe" set "RADIANCE_ROOT=C:\\Radiance"
if not exist "%RADIANCE_ROOT%\\bin\\oconv.exe" set "RADIANCE_ROOT=C:\\Program Files\\Radiance"
if exist "%RADIANCE_ROOT%\\bin\\oconv.exe" set "PATH=%RADIANCE_ROOT%\\bin;%PATH%"
if exist "%RADIANCE_ROOT%\\lib" set "RAYPATH=%RADIANCE_ROOT%\\lib;%RAYPATH%"
where oconv >nul 2>&1
if errorlevel 1 (
    echo ERROR: Radiance was not found.
    echo        Set the Radiance Installation Path in Ray Modeler's Project Setup panel,
    echo        or install Radiance from https://www.radiance-online.org/.
    exit /b 1
)
REM ---------------------------------------------------------------------------
`;
}

/**
 * Inserts the Radiance environment preamble into one generated script file.
 * Python files and anything without a recognised header are returned untouched.
 * @param {{fileName: string, content: string}} file
 * @param {object} projectData
 * @returns {{fileName: string, content: string}}
 */
function _withRadianceEnv(file, projectData) {
    if (!file || typeof file.content !== 'string') return file;

    const name = String(file.fileName || '');
    if (name.endsWith('.sh')) {
        const idx = file.content.indexOf('\n');
        if (idx === -1 || !file.content.slice(0, idx).includes('#!')) return file;
        return {
            ...file,
            content: file.content.slice(0, idx + 1) + _radianceEnvSh(projectData) + file.content.slice(idx + 1)
        };
    }
    if (name.endsWith('.bat')) {
        const idx = file.content.indexOf('\n');
        if (idx === -1) return file;
        return {
            ...file,
            content: file.content.slice(0, idx + 1) + _radianceEnvBat(projectData) + file.content.slice(idx + 1)
        };
    }
    return file;
}

/**
 * Public entry point. Wraps the per-recipe builders so every shell script that
 * leaves this module carries the Radiance environment preamble.
 * @param {object} projectData
 * @param {string} recipeType
 * @returns {Array<{fileName: string, content: string}>}
 */
export function generateScripts(projectData, recipeType) {
    return _buildRecipeScripts(projectData, recipeType).map(f => _withRadianceEnv(f, projectData));
}

function _buildRecipeScripts(projectData, recipeType) {
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
            
            // Python scripts are cross-platform, handle them separately. Both matrix
            // scripts shell out to `python3 ./extract_aperture.py`, so the package has
            // to carry it or step 1 dies with "No such file or directory" and every
            // later step fails on the missing aperture files.
            scripts.push(createApertureExtractorScript());
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

            scripts.push(createApertureExtractorScript());
            const postProcessScript5ph = createPostProcessingScript();
            scripts.push(postProcessScript5ph);
            return scripts;

        case 'template-recipe-imageless-glare':
            scriptSet = createImagelessGlareScript(projectData);
            break;
        case 'template-recipe-spectral-9ch':
            scriptSet = createSpectral9ChScript(projectData);
        break;
        case 'template-recipe-lighting-energy':
            scriptSet = createLightingEnergyScript(projectData);
            if (Array.isArray(scriptSet)) { // It returns an array of files
                scripts.push(...scriptSet);
            }
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

        case 'template-recipe-en17037':
            scriptSet = createEn17037ComplianceScript(projectData);
            if (Array.isArray(scriptSet)) {
                scripts.push(...scriptSet);
            }
            return scripts;

        case 'template-recipe-facade-irradiation':
            scriptSet = createFacadeIrradiationScript(projectData);
            break;

        default:
            console.warn(`Unknown recipe type provided to generateScripts: ${recipeType}`);
            return scripts;
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

function createSpectral9ChScript(projectData) {
    const { projectInfo: pi, mergedSimParams: p, materials, simulationFiles } = projectData;
    const projectName = pi['project-name'].replace(/\s+/g, '_') || 'scene';

    // --- Common Parameters ---
    const month = p['spectral-month'], day = p['spectral-day'], hour = _timeToDecimalHour(p['spectral-time'], '12:00');
    const lat = pi.latitude || 0, lon = pi.longitude || 0, mer = (Math.round(lon / 15) * 15) * -1;
    const dni = p['spectral-dni'], dhi = p['spectral-dhi'];
    const sunSpdFile = p['spectral-sun-spd']?.name || 'sun.spd';
    const skySpdFile = p['spectral-sky-spd']?.name || 'sky.spd';
    const ab = p['ab'], ad = p['ad'], as = p['as'], ar = p['ar'], aa = p['aa'], lw = p['lw'];
    const run9ch = p['spectral-run-9ch-toggle'];

    /// --- Spectral Binning (in JavaScript) ---
    const wallSrdContent = simulationFiles['wall-srd-file']?.content;
    const floorSrdContent = simulationFiles['floor-srd-file']?.content;
    const ceilingSrdContent = simulationFiles['ceiling-srd-file']?.content;

    const binnedWallRefl9ch = _parseAndBinSpectralData(wallSrdContent, 'spectral-9') || Array(9).fill(p['wall-refl'] || 0.5);
    const binnedFloorRefl9ch = _parseAndBinSpectralData(floorSrdContent, 'spectral-9') || Array(9).fill(p['floor-refl'] || 0.2);
    const binnedCeilingRefl9ch = _parseAndBinSpectralData(ceilingSrdContent, 'spectral-9') || Array(9).fill(p['ceiling-refl'] || 0.8);

    // Every modifier the geometry writer can emit needs a definition in EVERY channel
    // group, or oconv aborts with `undefined modifier "glass_mat"` and the run produces
    // nothing. Only wall, floor and ceiling carry per-band reflectances; the rest are
    // broadband, so the same scalar is repeated across the group's three channels.
    const grey = (v) => { const s = Number(v).toFixed(4); return `${s} ${s} ${s}`; };
    const mat = projectData.materials || {};
    const frameRefl = mat.frame?.reflectance ?? p['frame-refl'] ?? 0.5;
    const shadingRefl = mat.shading?.reflectance ?? p['shading-refl'] ?? 0.35;
    const furnitureRefl = mat.furniture?.reflectance ?? p['furniture-refl'] ?? 0.5;
    const contextRefl = mat.context?.reflectance ?? p['context-refl'] ?? 0.2;
    const glazingTn = mat.glazing?.transmittance ?? p['glazing-trans'] ?? 0.65;
    const glazingTs = transmittanceToTransmissivity(parseFloat(glazingTn));

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

void glass glass_mat
0
0
3 ${grey(glazingTs)}

void plastic frame_mat
0
0
5 ${grey(frameRefl)} 0 0

void plastic shading_mat
0
0
5 ${grey(shadingRefl)} 0 0

void plastic furniture_mat
0
0
5 ${grey(furnitureRefl)} 0 0

void plastic context_mat
0
0
5 ${grey(contextRefl)} 0 0

void plastic ground_mat
0
0
5 0.1500 0.1500 0.1500 0 0

void trans vegetation_canopy_mat
0
0
7 0.1000 0.2000 0.1000 0 0.5 0.3 0
    `;
    
    const materialDefs9ch = {
        c1_3: generateMaterialSet('c1-3', binnedWallRefl9ch.slice(0, 3), binnedFloorRefl9ch.slice(0, 3), binnedCeilingRefl9ch.slice(0, 3)),
        c4_6: generateMaterialSet('c4-6', binnedWallRefl9ch.slice(3, 6), binnedFloorRefl9ch.slice(3, 6), binnedCeilingRefl9ch.slice(3, 6)),
        c7_9: generateMaterialSet('c7-9', binnedWallRefl9ch.slice(6, 9), binnedFloorRefl9ch.slice(6, 9), binnedCeilingRefl9ch.slice(6, 9)),
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

    # 9-channel bins and their representative bandwidths (nm)
    bins = [(380, 424), (425, 454), (455, 479), (480, 504), (505, 529), (530, 559), (560, 599), (600, 644), (645, 780)]
    bin_widths = np.array([b[1] - b[0] for b in bins])

    # Pre-averaged weighting functions for each of the 9 spectral bins
    # V(lambda) for Photopic Illuminance
    v_lambda_binned = np.array([0.0003, 0.0232, 0.1465, 0.3644, 0.7386, 0.9859, 0.8654, 0.3804, 0.0535])
    # Melanopic Action Spectrum m(lambda)
    m_lambda_binned = np.array([0.0335, 0.4021, 0.7932, 0.8876, 0.6548, 0.3923, 0.1256, 0.0177, 0.0010])
    # CIE 1931 2-deg Color Matching Functions
    x_bar_binned = np.array([0.0178, 0.0864, 0.2223, 0.1873, 0.0469, 0.3015, 0.7013, 0.9634, 0.2354])
    y_bar_binned = v_lambda_binned # y_bar is identical to V(lambda)
    z_bar_binned = np.array([0.0837, 0.4208, 1.0567, 0.8528, 0.2033, 0.0315, 0.0039, 0.0001, 0.0000])

    # --- Calculations ---
    # Each channel carries the BAND-AVERAGE spectral irradiance (W/m^2/nm) for its bin,
    # because the sky and the material reflectances were built from per-nm SPD values.
    # Every weighted integral therefore has to be multiplied by the bin width; the nine
    # bins are 44/29/24/24/24/29/39/44/135 nm wide, so nothing cancels.
    weighted = data * bin_widths

    # Luminous efficacy constants. 683 lm/W is the CIE maximum luminous efficacy Km,
    # which is what a true V(lambda) integral needs; Radiance's 179 lm/W applies only to
    # its own 0.265R + 0.670G + 0.065B broadband approximation and is 3.8x too small
    # here. 754.0 lux per W/m^2 is the CIE S 026 melanopic constant (1000 / 1.3262).
    K_PHOTOPIC = 683.0
    K_MELANOPIC = 754.0

    # Photopic Illuminance (lux)
    photopic_w_m2 = np.sum(weighted * v_lambda_binned, axis=1)
    photopic_lux = photopic_w_m2 * K_PHOTOPIC

    # Melanopic EDI (lux), CIE S 026
    melanopic_w_m2 = np.sum(weighted * m_lambda_binned, axis=1)
    melanopic_edi_lux = melanopic_w_m2 * K_MELANOPIC

    # Equivalent Melanopic Lux (EML). WELL's EML uses the 683 lm/W normalisation, and
    # melanopic EDI = EML x 1.104, so EML is the EDI divided by that factor.
    eml = melanopic_edi_lux / 1.104

    # Circadian Stimulus (CS) - using the 2018 model from LRC
    # This is a simplification; a full model would use pupil diameter.
    # Rod-corrected photopic lux
    S_cone = np.sum(weighted * np.array([0.0001,0.0051,0.0617,0.3202,0.7371,0.9708,0.8569,0.4042,0.0716]), axis=1) * K_PHOTOPIC
    Rod_w_m2 = np.sum(weighted * np.array([0.0013,0.0505,0.2987,0.7346,0.8930,0.4907,0.1478,0.0253,0.0028]), axis=1)
    V_prime_w_m2 = np.sum(weighted * np.array([0.0006,0.0210,0.1378,0.4430,0.8587,0.8252,0.4674,0.1555,0.0213]), axis=1)
    rod_sat = 35000 * (1 - np.exp(-S_cone/10000))
    effective_rods = np.where(S_cone < 0.1, V_prime_w_m2 * K_PHOTOPIC * 2.2, Rod_w_m2 * K_PHOTOPIC * (1 - np.exp(-S_cone/rod_sat)))
    CL_A = 1548 * melanopic_w_m2 + effective_rods
    CS = 0.7 * (1 - (1 / (1 + (CL_A / 355.7)**1.1026)))

    # CCT Calculation (from xy chromaticity)
    X = np.sum(weighted * x_bar_binned, axis=1)
    Y = np.sum(weighted * y_bar_binned, axis=1)
    Z = np.sum(weighted * z_bar_binned, axis=1)
    
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
    LATITUDE=${lat}; LONGITUDE=${-lon}; MERIDIAN=${mer};
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
    mkdir -p "$OUTPUT_DIR" "$MATERIALS_DIR"

    # --- 1. PRE-PROCESSING AND MATERIAL FILE GENERATION ---
    echo "Step 1: Generating spectrally binned material files..."
    cat > "\${MATERIALS_DIR}/materials_c1-3.rad" << EOF
    ${materialDefs9ch.c1_3}
EOF
        cat > "\${MATERIALS_DIR}/materials_c4-6.rad" << EOF
    ${materialDefs9ch.c4_6}
EOF
        cat > "\${MATERIALS_DIR}/materials_c7-9.rad" << EOF
    ${materialDefs9ch.c7_9}
EOF

    # --- 2. BIN SUN/SKY SPECTRA ---
    echo "Step 2: Binning sun and sky spectral data..."
    # (AWK commands are condensed for brevity, functionally identical)
    B1_SUN=$(awk '$1>=380 && $1<=424 {s+=$2; c++} END {print s/c}' "$SUN_SPD"); B2_SUN=$(awk '$1>=425 && $1<=454 {s+=$2; c++} END {print s/c}' "$SUN_SPD"); B3_SUN=$(awk '$1>=455 && $1<=479 {s+=$2; c++} END {print s/c}' "$SUN_SPD")
    B4_SUN=$(awk '$1>=480 && $1<=504 {s+=$2; c++} END {print s/c}' "$SUN_SPD"); B5_SUN=$(awk '$1>=505 && $1<=529 {s+=$2; c++} END {print s/c}' "$SUN_SPD"); B6_SUN=$(awk '$1>=530 && $1<=559 {s+=$2; c++} END {print s/c}' "$SUN_SPD")
    B7_SUN=$(awk '$1>=560 && $1<=599 {s+=$2; c++} END {print s/c}' "$SUN_SPD"); B8_SUN=$(awk '$1>=600 && $1<=644 {s+=$2; c++} END {print s/c}' "$SUN_SPD"); B9_SUN=$(awk '$1>=645 && $1<=780 {s+=$2; c++} END {print s/c}' "$SUN_SPD")
    B1_SKY=$(awk '$1>=380 && $1<=424 {s+=$2; c++} END {print s/c}' "$SKY_SPD"); B2_SKY=$(awk '$1>=425 && $1<=454 {s+=$2; c++} END {print s/c}' "$SKY_SPD"); B3_SKY=$(awk '$1>=455 && $1<=479 {s+=$2; c++} END {print s/c}' "$SKY_SPD")
    B4_SKY=$(awk '$1>=480 && $1<=504 {s+=$2; c++} END {print s/c}' "$SKY_SPD"); B5_SKY=$(awk '$1>=505 && $1<=529 {s+=$2; c++} END {print s/c}' "$SKY_SPD"); B6_SKY=$(awk '$1>=530 && $1<=559 {s+=$2; c++} END {print s/c}' "$SKY_SPD")
    B7_SKY=$(awk '$1>=560 && $1<=599 {s+=$2; c++} END {print s/c}' "$SKY_SPD"); B8_SKY=$(awk '$1>=600 && $1<=644 {s+=$2; c++} END {print s/c}' "$SKY_SPD"); B9_SKY=$(awk '$1>=645 && $1<=780 {s+=$2; c++} END {print s/c}' "$SKY_SPD")

    # --- 3. SPECTRAL SKY GENERATION (TWO-PASS METHOD) ---
    echo "Step 3: Generating spectral sky files..."

    # The per-band colorfunc modifiers below scale a pattern by three constants.
    # Radiance has no built-in red/green/blue functions, so they are defined here
    # and the file is written into the script's own directory. '.' is prepended to
    # RAYPATH only when RAYPATH is already set, so an install relying on Radiance's
    # compiled-in default path is left untouched.
    SPECTRAL_CAL_NAME="spectral_rgb.cal"
    cat > "\${SPECTRAL_CAL_NAME}" <<'CALEOF'
{ Per-band channel scaling for the 9-channel spectral method.
  A1, A2, A3 are the three band values carried by the colorfunc. }
red = A1;
green = A2;
blue = A3;
CALEOF
    if [ -n "\${RAYPATH}" ]; then export RAYPATH=".:\${RAYPATH}"; fi
    BASELINE_SKY="\${OUTPUT_DIR}/sky_baseline.rad"
    gendaylit $MONTH $DAY $HOUR -a $LATITUDE -o $LONGITUDE -m $MERIDIAN -W $DNI $DHI > $BASELINE_SKY
    # gendaylit emits the sun as "void light solar" followed by two count lines and
    # then "3 R G B"; the radiance values are fields 2-4 of that fourth line. The
    # separate "solar source sun" primitive carries the direction, not the colour.
    SUN_RAD_RGB=$(grep -A 3 "^void light solar" $BASELINE_SKY | tail -n 1)
    R_RAD=$(echo $SUN_RAD_RGB | awk '{print $2}'); G_RAD=$(echo $SUN_RAD_RGB | awk '{print $3}'); B_RAD=$(echo $SUN_RAD_RGB | awk '{print $4}')
    if [ -z "$R_RAD" ]; then echo "ERROR: could not read the sun radiance from $BASELINE_SKY; aborting." >&2; return 1; fi
    # awk, not bc: gendaylit writes the sun radiance in scientific notation
    # (e.g. 6.807e+06), which bc cannot parse. bc would fail silently here and
    # leave every scaled band empty, producing an unusable modifier file.
    L_BASE=$(awk -v r="$R_RAD" -v g="$G_RAD" -v b="$B_RAD" 'BEGIN{printf "%.10g", 179*(0.265*r + 0.670*g + 0.065*b)}')
    # The band multipliers must land in the SAME units the post-processor integrates in:
    # process_spectral.py computes 683 * sum(E_i * width_i * V_i), so E_i is a BAND-AVERAGE
    # spectral quantity per nm and the nine bin widths (44/29/24/24/24/29/39/44/135 nm) do
    # not cancel. Normalising with a width-less sum at 179 lm/W instead, as this line once
    # did, left every channel about 125x too large: 683/179 = 3.816 for the efficacy and
    # about 32.9 nm for the V(lambda)-weighted mean bin width.
    L_SPEC_UNSCALED=$(awk -v b1="$B1_SUN" -v b2="$B2_SUN" -v b3="$B3_SUN" -v b4="$B4_SUN" -v b5="$B5_SUN" -v b6="$B6_SUN" -v b7="$B7_SUN" -v b8="$B8_SUN" -v b9="$B9_SUN" \
        'BEGIN{printf "%.10g", 683*(b1*0.0003*44+b2*0.0232*29+b3*0.1465*24+b4*0.3644*24+b5*0.7386*24+b6*0.9859*29+b7*0.8654*39+b8*0.3804*44+b9*0.0535*135)}')
    C_SCALE=$(awk -v a="$L_BASE" -v b="$L_SPEC_UNSCALED" 'BEGIN{printf "%.10g", a/(b + 1e-9)}')
    scale_band() { awk -v v="$1" -v c="$C_SCALE" 'BEGIN{printf "%.10g", v*c}'; }
    S1_SCALED=$(scale_band "$B1_SUN"); S2_SCALED=$(scale_band "$B2_SUN"); S3_SCALED=$(scale_band "$B3_SUN")
    S4_SCALED=$(scale_band "$B4_SUN"); S5_SCALED=$(scale_band "$B5_SUN"); S6_SCALED=$(scale_band "$B6_SUN")
    S7_SCALED=$(scale_band "$B7_SUN"); S8_SCALED=$(scale_band "$B8_SUN"); S9_SCALED=$(scale_band "$B9_SUN")

    # The sky bands need the same treatment, but calibrated against unity instead of the
    # sun's absolute radiance: the "skyfunc" brightfunc already carries the absolute sky
    # brightness, and a Radiance pattern MULTIPLIES the value it modifies. Feeding the
    # raw SPD numbers in as the colorfunc arguments would therefore scale the sky by the
    # SPD magnitude on top of its own brightness. The target is that the post-processor's
    # own integral, 683 * sum(K_i * width_i * V_i), reproduces the luminance Radiance would
    # report for the same sky through its 179 lm/W broadband weighting. That fixes the
    # normalisation constant at 179/683, NOT at 1: a unity width-less sum, as this line
    # once used, left the sky about 125x too bright once the widths were applied downstream.
    K_SPEC_UNSCALED=$(awk -v b1="$B1_SKY" -v b2="$B2_SKY" -v b3="$B3_SKY" -v b4="$B4_SKY" -v b5="$B5_SKY" -v b6="$B6_SKY" -v b7="$B7_SKY" -v b8="$B8_SKY" -v b9="$B9_SKY" \\
        'BEGIN{printf "%.10g", 683*(b1*0.0003*44+b2*0.0232*29+b3*0.1465*24+b4*0.3644*24+b5*0.7386*24+b6*0.9859*29+b7*0.8654*39+b8*0.3804*44+b9*0.0535*135)}')
    C_SCALE_SKY=$(awk -v b="$K_SPEC_UNSCALED" 'BEGIN{printf "%.10g", 179/(b + 1e-9)}')
    scale_sky_band() { awk -v v="$1" -v c="$C_SCALE_SKY" 'BEGIN{printf "%.10g", v*c}'; }
    K1_SCALED=$(scale_sky_band "$B1_SKY"); K2_SCALED=$(scale_sky_band "$B2_SKY"); K3_SCALED=$(scale_sky_band "$B3_SKY")
    K4_SCALED=$(scale_sky_band "$B4_SKY"); K5_SCALED=$(scale_sky_band "$B5_SKY"); K6_SCALED=$(scale_sky_band "$B6_SKY")
    K7_SCALED=$(scale_sky_band "$B7_SKY"); K8_SCALED=$(scale_sky_band "$B8_SKY"); K9_SCALED=$(scale_sky_band "$B9_SKY")

    for i in {1..3}; do
        case $i in
            1) R_S=$S1_SCALED; G_S=$S2_SCALED; B_S=$S3_SCALED; R_K=$K1_SCALED; G_K=$K2_SCALED; B_K=$K3_SCALED; SUFFIX="c1-3";;
            2) R_S=$S4_SCALED; G_S=$S5_SCALED; B_S=$S6_SCALED; R_K=$K4_SCALED; G_K=$K5_SCALED; B_K=$K6_SCALED; SUFFIX="c4-6";;
            3) R_S=$S7_SCALED; G_S=$S8_SCALED; B_S=$S9_SCALED; R_K=$K7_SCALED; G_K=$K8_SCALED; B_K=$K9_SCALED; SUFFIX="c7-9";;
        esac
        MOD_FILE="\${OUTPUT_DIR}/mods_\${SUFFIX}.rad"; SKY_FILE="\${OUTPUT_DIR}/sky_\${SUFFIX}.rad"
        cat > $MOD_FILE <<EOF
void colorfunc sky_rgb_\${SUFFIX}
4 red green blue \${SPECTRAL_CAL_NAME}
0
3 $R_K $G_K $B_K

void colorfunc sun_rgb_\${SUFFIX}
4 red green blue \${SPECTRAL_CAL_NAME}
0
3 $R_S $G_S $B_S
EOF
        # A Radiance pattern multiplies the primitive it modifies, so leaving gendaylit's
        # own "3 R G B" on the solar light would square the sun: the colorfunc already
        # carries the absolute per-band radiance. Reset the light's own colour to 1 1 1
        # and let the pattern supply the value. gendaylit writes the sun as four lines
        # (modifier line, "0", "0", "3 R G B"), so the fourth line is the one to replace.
        gendaylit $MONTH $DAY $HOUR -a $LATITUDE -o $LONGITUDE -m $MERIDIAN -W $DNI $DHI \\
            | sed "s/^void brightfunc skyfunc/sky_rgb_\${SUFFIX} brightfunc skyfunc/" \\
            | sed "s/^void light solar/sun_rgb_\${SUFFIX} light solar/" \\
            | awk -v m="sun_rgb_\${SUFFIX}" '
                $1 == m && $2 == "light" && $3 == "solar" {
                    print
                    if ((getline line) > 0) print line
                    if ((getline line) > 0) print line
                    if ((getline line) > 0) print "3 1 1 1"
                    next
                }
                { print }' > $SKY_FILE
        cat $MOD_FILE $SKY_FILE > "\${OUTPUT_DIR}/sky_final_\${SUFFIX}.rad"
${_appendSkyGlowSh('${OUTPUT_DIR}/sky_final_${SUFFIX}.rad')}
    done

    # --- 4. SCENE COMPILATION & 5. SIMULATION ---
    echo "Steps 4 & 5: Compiling octrees and running simulations..."
    for SUFFIX in "c1-3" "c4-6" "c7-9"; do
        OCTREE="\${OUTPUT_DIR}/scene_\${SUFFIX}.oct"
        oconv -f "\${OUTPUT_DIR}/sky_final_\${SUFFIX}.rad" "\${MATERIALS_DIR}/materials_\${SUFFIX}.rad" "$GEOMETRY_FILE" > "$OCTREE"
        # We only need the sensor point results for the post-processing script
        rtrace -I -h $RAD_PARAMS "$OCTREE" < "$POINTS_FILE" > "\${OUTPUT_DIR}/results_\${SUFFIX}.res"
    done

    # --- 6. POST-PROCESSING ---
    echo "Step 6: Combining results and calculating final circadian metrics..."
    paste "\${OUTPUT_DIR}/results_c1-3.res" "\${OUTPUT_DIR}/results_c4-6.res" "\${OUTPUT_DIR}/results_c7-9.res" > "\${OUTPUT_DIR}/results_9channel.res"
    
    # Save the Python script to the results directory
    echo "Creating Python post-processor..."
    cat > "\${OUTPUT_DIR}/\${PYTHON_SCRIPT}" << EOF
    ${pythonScriptContent}
EOF

    # Execute the Python script
    echo "Executing Python post-processor..."
    python3 "\${OUTPUT_DIR}/\${PYTHON_SCRIPT}" "\${OUTPUT_DIR}/results_9channel.res" --points "\${NUM_POINTS}"

    echo "### 9-CHANNEL SIMULATION COMPLETE ###"
    echo "Circadian metrics saved in \${OUTPUT_DIR}/circadian_summary.json"
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
    const time = _timeToDecimalHour(p['pit-time'], '12:00');

    const ab = p['ab'] || 4;
    const ad = p['ad'] || 1024;
    const as = p['as'] || 512;
    const ar = p['ar'] || 512;
    const aa = p['aa'] || 0.2;
    const rtraceMode = p['rtrace-mode-I'] ? '-I' : '-i';
    // Radiance boolean switches must be emitted in their explicit +/- form. Omitting a
    // flag leaves the built-in default in force (-h+, -w+, -u+), so "off" states have to
    // be written out or the checkbox can only ever turn a setting on. The UI labels for
    // -h and -w read "Suppress ...", so a ticked box means the minus form.
    // -h is NOT user-controllable here. This rtrace output is piped straight into rcalc and
    // written to a results file that resultsManager parses as one number per line. Verified
    // against Radiance 6.1a: without -h-, rtrace emits an 8-line "#?RADIANCE ... FORMAT=ascii"
    // header plus a blank line, and rcalc turns those into 9 bogus leading data rows that
    // silently shift every sensor value onto the wrong grid point. The "Suppress Header"
    // checkbox shipped unchecked, so this corrupted every point-in-time result by default.
    const rtraceSwitches = `-h- ${p['rtrace-w'] ? '-w-' : '-w+'} ${p['rtrace-u'] ? '-u+' : '-u-'}`;
    const lightDefs = generateLightSourceDefinitions(projectData.lighting, projectData.geometry.room, projectData.simulationFiles);

    const shContent = `#!/bin/bash
    # RUN_Illuminance.sh
    # Script to run a point-in-time illuminance analysis.
    # Generated by Ray Modeler.

    # --- Simulation Configuration ---
    PROJECT_NAME="${projectName}"
    LATITUDE=${lat}
    LONGITUDE=${-lon}
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
${_appendSkyGlowSh("${SKY_FILE}")}

    # 2. Create Scene Octree using oconv
    echo "2. Creating octree..."
    OCTREE_FILE="\${OCT_DIR}/\${PROJECT_NAME}.oct"
    (
    cat "\${MAT_FILE}"
    cat "\${GEOM_FILE}"
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
    set "LONGITUDE=${-lon}"
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
    set "MAT_FILE=..\\02_materials\\%PROJECT_NAME%_materials.rad"
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
${_appendSkyGlowBat("%SKY_FILE%")}

    REM 2. Create Scene Octree using oconv
    echo 2. Creating octree...
    set "OCTREE_FILE=%OCT_DIR%\\%PROJECT_NAME%.oct"

    REM Combine geometry, sky, and lights into a temporary file for oconv
    (
    type "%MAT_FILE%"
    echo.
    type "%GEOM_FILE%"
    echo.
    type "%SKY_FILE%"
    echo.
    (
    ${lightDefs.split('\n').map(line => line.trim() === '' ? '        echo.' : `        echo ${line}`).join('\n')}
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
    const time = _timeToDecimalHour(p['pit-time'], '12:00');
    const ab = p['ab'] || 4;
    const ad = p['ad'] || 1024;
    const as = p['as'] || 512;
    const ar = p['ar'] || 512;
    const aa = p['aa'] || 0.2;
    const xRes = p['rpict-x'] || 1280;
    const yRes = p['rpict-y'] || 720;
    
    // Explicit +/- forms: the rpict defaults are -i-, -dv+, -bv+ and -w+, so a cleared
    // checkbox has to emit the minus form to actually turn the feature off.
    const rpictSwitches = `${p['rpict-i'] ? '-i+' : '-i-'} ${p['rpict-dv'] ? '-dv+' : '-dv-'} ${p['rpict-bv'] ? '-bv+' : '-bv-'} ${p['rpict-w'] ? '-w-' : '-w+'}`;
    
    const ps = p['rpict-ps'] || 8;
    const pt = p['rpict-pt'] || 0.05;
    const pj = p['rpict-pj'] || 0.9;
    const lightDefs = generateLightSourceDefinitions(projectData.lighting, projectData.geometry.room, projectData.simulationFiles);

    const shContent = `#!/bin/bash
    # RUN_Rendering.sh
    # Script to render a point-in-time image.
    # Generated by Ray Modeler.

    # --- Simulation Configuration ---
    PROJECT_NAME="${projectName}"
    LATITUDE=${lat}
    LONGITUDE=${-lon}
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
${_appendSkyGlowSh("${SKY_FILE}")}

    # 2. Create Scene Octree
    echo "2. Creating octree..."
    OCTREE_FILE="\${OCT_DIR}/\${PROJECT_NAME}.oct"
    (
    cat "\${MAT_FILE}"
    cat "\${GEOM_FILE}"
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
    set "LONGITUDE=${-lon}"
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
    set "MAT_FILE=..\\02_materials\\%PROJECT_NAME%_materials.rad"
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
${_appendSkyGlowBat("%SKY_FILE%")}

    REM 2. Create Scene Octree
    echo 2. Creating octree...
    set "OCTREE_FILE=%OCT_DIR%\\%PROJECT_NAME%.oct"

    (
        type "%MAT_FILE%"
        echo.
        type "%GEOM_FILE%"
        echo.
        type "%SKY_FILE%"
        echo.
        (
    ${lightDefs.split('\n').map(line => line.trim() === '' ? '        echo.' : `        echo ${line}`).join('\n')}
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
    const time = _timeToDecimalHour(p['pit-time'], '14:30');
    // High-quality parameters are essential for glare, so we use higher defaults.
    const ab = p['ab'] || 6;
    const ad = p['ad'] || 2048;
    const as = p['as'] || 1024;
    const ar = p['ar'] || 512;
    const aa = p['aa'] || 0.15;
    const xRes = p['dgp-x-res'] || 1500; // Use parameter, fallback to 1500
    const yRes = p['dgp-y-res'] || 1500; // Use parameter, fallback to 1500
    // evalglare's -t takes three mandatory arguments (x y angle). Emitting a bare "-t"
    // makes evalglare consume the image path as its first argument and produce nothing,
    // so the flag is only emitted once all three values are available.
    const taskX = p['evalglare-t-x'], taskY = p['evalglare-t-y'], taskAngle = p['evalglare-t-angle'];
    const hasTaskArea = p['evalglare-t'] && [taskX, taskY, taskAngle].every(v => v !== undefined && v !== null && v !== '' && !isNaN(Number(v)));
    const evalglareSwitches = [
        p['evalglare-c'] ? `-c ${projectName}_glare_check.hdr` : '',
        p['evalglare-d'] ? '-d' : '',
        hasTaskArea ? `-t ${Number(taskX)} ${Number(taskY)} ${Number(taskAngle)}` : ''
    ].filter(Boolean).join(' ');
    const lightDefs = generateLightSourceDefinitions(projectData.lighting, projectData.geometry.room, projectData.simulationFiles);

    const shContent = `#!/bin/bash
    # RUN_DGP_Analysis.sh
    # Script to run a Daylight Glare Probability (DGP) analysis.
    # Generated by Ray Modeler.

    # --- Simulation Configuration ---
    PROJECT_NAME="${projectName}"
    LATITUDE=${lat}
    LONGITUDE=${-lon}
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
${_appendSkyGlowSh("${SKY_FILE}")}

    echo "2. Creating octree..."
    OCTREE_FILE="\${OCT_DIR}/\${PROJECT_NAME}.oct"
    (
    cat "\${MAT_FILE}"
    cat "\${GEOM_FILE}"
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
    # Both paths are resolved to absolute form BEFORE the pushd below: they are written
    # relative to the script's directory, and inside "\${IMG_DIR}" a relative
    # "../08_results/..." would land two levels up from where it was meant to.
    GLARE_RESULTS="\$(cd "\${RESULTS_DIR}" && pwd)/\${PROJECT_NAME}_dgp.txt"
    GLARE_CHECK_IMG="\$(cd "\${IMG_DIR}" && pwd)/\${PROJECT_NAME}_glare_check.hdr"

    # evalglare outputs check file to the current directory, so we temporarily change to it
    pushd "\${IMG_DIR}" > /dev/null
    evalglare ${evalglareSwitches} "\${PROJECT_NAME}_glare.hdr" > "\${GLARE_RESULTS}"
    EVALGLARE_STATUS=\$?
    popd > /dev/null
    # \$? after popd is popd's own status, which is 0 whenever the directory stack is
    # valid; the evalglare exit code has to be captured before popd runs.
    if [ \${EVALGLARE_STATUS} -ne 0 ]; then echo "Error during evalglare."; exit 1; fi

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
    set "LONGITUDE=${-lon}"
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
    set "MAT_FILE=..\\02_materials\\%PROJECT_NAME%_materials.rad"
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
${_appendSkyGlowBat("%SKY_FILE%")}

    REM 2. Create Octree
    echo 2. Creating octree...
    set "OCTREE_FILE=%OCT_DIR%\\%PROJECT_NAME%.oct"
    (
        type "%MAT_FILE%"
        echo.
        type "%GEOM_FILE%"
        echo.
        type "%SKY_FILE%"
        echo.
        (
    ${lightDefs.split('\n').map(line => line.trim() === '' ? '        echo.' : `        echo ${line}`).join('\n')}
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
    REM Resolve both paths to absolute form BEFORE the pushd: inside "%IMG_DIR%" a
    REM relative "..\\08_results\\..." would land two levels up from where it was meant to.
    for %%I in ("%RESULTS_DIR%") do set "RESULTS_ABS=%%~fI"
    for %%I in ("%IMG_DIR%") do set "IMG_ABS=%%~fI"
    set "GLARE_RESULTS=%RESULTS_ABS%\\%PROJECT_NAME%_dgp.txt"
    set "GLARE_CHECK_IMG=%IMG_ABS%\\%PROJECT_NAME%_glare_check.hdr"

    REM evalglare outputs check file to the current directory, so we temporarily change to it
    pushd "%IMG_DIR%"
    evalglare ${evalglareSwitches} "%PROJECT_NAME%_glare.hdr" > "%GLARE_RESULTS%"
    set "EVALGLARE_STATUS=%errorlevel%"
    popd
    REM %errorlevel% read after popd reports popd's status, not evalglare's.
    if %EVALGLARE_STATUS% neq 0 ( echo "Error during evalglare." & exit /b 1 )

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
    
    // gensky -B takes horizontal diffuse irradiance in W/m^2; 55.866 W/m^2 gives the
    // conventional 10,000 lux exterior reference. The DF denominator is derived from
    // whatever irradiance is actually used rather than pinned to 10,000, because a
    // user-supplied value would otherwise leave the two inconsistent and scale every
    // reported DF by the ratio between them.
    const horizIrrad = p['df-irrad'] || 55.866;
    const extLux = (horizIrrad * 179).toFixed(1);
    // gensky always needs a positional month/day/hour, even for an overcast sky where
    // the sun position does not affect the result: without one it exits with
    // "Use error - bad month". The Daylight Factor recipe carries no date of its own,
    // so fall back to the equinox at noon (9 21 12).
    const dfMonth = p['df-month'] || p['pit-month'] || 9;
    const dfDay = p['df-day'] || p['pit-day'] || 21;
    const dfHour = p['df-time'] ? _timeToDecimalHour(p['df-time'], '12:00') : (p['pit-time'] ? _timeToDecimalHour(p['pit-time'], '12:00') : 12);
    const lightDefs = generateLightSourceDefinitions(projectData.lighting, projectData.geometry.room, projectData.simulationFiles);

    const shContent = `#!/bin/bash
    # RUN_Daylight_Factor.sh
    # Script to run a Daylight Factor (DF) analysis.
    # Generated by Ray Modeler.

    # --- Simulation Configuration ---
    PROJECT_NAME="${projectName}"
    AB=${ab}; AD=${ad}; AS=${as}; AR=${ar}; AA=${aa}
    EXT_LUX=${extLux} # Exterior horizontal illuminance implied by the sky above (179 lm/W x ${horizIrrad} W/m2)

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
    # The date only fixes the sun position; an overcast sky ignores it, but gensky
    # refuses to run without one. ${dfMonth}/${dfDay} at ${dfHour}h is the equinox-noon default.
    gensky ${dfMonth} ${dfDay} ${dfHour} ${skyType} -g ${groundRefl} -B ${horizIrrad} > "\${SKY_FILE}"
${_appendSkyGlowSh("${SKY_FILE}")}

    echo "2. Creating octree..."
    OCTREE_FILE="\${OCT_DIR}/\${PROJECT_NAME}.oct"
    (
    cat "\${MAT_FILE}"
    cat "\${GEOM_FILE}"
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
    cat "\${INTERIOR_IRRADIANCE}" | rcalc -e '$1=100 * (179*($1*0.265+$2*0.670+$3*0.065)) / '"\${EXT_LUX}" > "\${DF_RESULTS}"

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
    set "EXT_LUX=${extLux}"

    REM --- File & Directory Setup ---
    set "GEOM_FILE=..\\01_geometry\\%PROJECT_NAME%.rad"
    set "MAT_FILE=..\\02_materials\\%PROJECT_NAME%_materials.rad"
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
    REM The date only fixes the sun position; an overcast sky ignores it, but gensky
    REM refuses to run without one. ${dfMonth}/${dfDay} at ${dfHour}h is the equinox-noon default.
    gensky ${dfMonth} ${dfDay} ${dfHour} ${skyType} -g ${groundRefl} -B ${horizIrrad} > "%SKY_FILE%"
${_appendSkyGlowBat("%SKY_FILE%")}

    REM 2. Create Scene Octree
    echo 2. Creating octree...
    set "OCTREE_FILE=%OCT_DIR%\\%PROJECT_NAME%.oct"
    (
        type "%MAT_FILE%"
        echo.
        type "%GEOM_FILE%"
        echo.
        type "%SKY_FILE%"
        echo.
        (
    ${lightDefs.split('\n').map(line => line.trim() === '' ? '        echo.' : `        echo ${line}`).join('\n')}
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
    const mf = ANNUAL_SKY_MF;
    const nrbins = _reinhartNrbins(mf);
    const aperture = _primaryAperture(projectData);
    const lightDefs = generateLightSourceDefinitions(projectData.lighting, projectData.geometry.room, projectData.simulationFiles);

    const shContent = `#!/bin/bash
    # RUN_3ph_Matrix_Generation.sh
    # Generates the Daylight and View matrices for a 3-Phase simulation.
    # This is a computationally intensive step.
    # Generated by Ray Modeler.

    # --- Configuration ---
    PROJECT_NAME="${projectName}"
    # High-quality parameters are essential for matrix generation
    AB=${ab}; AD=${ad}; AS=${as}; AR=${ar}; AA=${aa}; LW=${lw}

    # Reinhart subdivision. gendaymtx -m and rcontrib's MF must be the same number or the
    # daylight matrix and the sky matrix cannot be multiplied. MF:${mf} gives ${nrbins} bins
    # (the sky patches plus the ground bin), which is what -bn takes.
    SKY_MF=${mf}
    SKY_NRBINS=${nrbins}
    # Klems: 145 incident directions on the aperture, and the binning function bound to the
    # wall this aperture sits in (${aperture.orientation}-facing).
    KLEMS_NBINS=145
    KLEMS_BIN=${aperture.kbin}
    # Outward normal of the aperture, for the genklemsamp sender.
    APERTURE_NORMAL="${aperture.outwardNormal}"
    # Rays sampled per Klems direction; rcontrib -c averages them back down to one row.
    KLEMS_SAMPLES=1000

    # --- File & Directory Setup ---
    GEOM_FILE="../01_geometry/\${PROJECT_NAME}.rad"
    MAT_FILE="../02_materials/\${PROJECT_NAME}_materials.rad"
    OCT_DIR="../06_octrees"
    RESULTS_DIR="../08_results"
    MATRIX_DIR="\${RESULTS_DIR}/matrices"
    POINTS_FILE="../08_results/grid.pts"
    DAYLIGHT_SENSORS="../08_results/daylighting_sensors.pts"

    mkdir -p \$OCT_DIR \$RESULTS_DIR \$MATRIX_DIR

    if [ ! -s "\${POINTS_FILE}" ]; then
        echo "ERROR: \${POINTS_FILE} is empty or missing. Enable a sensor grid and regenerate." >&2
        exit 1
    fi
    NUM_POINTS=\$(wc -l < "\${POINTS_FILE}" | tr -d ' ')

    # --- Main Script ---
    # 1. Derive the aperture files the two matrices need.
    #
    # The View matrix cannot be traced against "glass_mat": glass is not a light source, so
    # rcontrib would bin nothing. The window has to be redefined as an inward-facing glow in
    # a SEPARATE octree with the original glazing removed, or the glow and the glass would
    # be coincident surfaces. The Daylight matrix in turn needs the bare aperture polygons
    # as a genklemsamp sender, and a sky/ground dome named sky_glow to bin against - the
    # master octree contains no sky at all, so "-m sky_glow" previously named a modifier
    # that existed nowhere.
    echo "1. Deriving aperture, glow and sky files..."
    APERTURE_RAD="\${MATRIX_DIR}/aperture.rad"
    WINDOW_GLOW_RAD="\${MATRIX_DIR}/window_glow.rad"
    GEOM_NO_GLAZING="\${MATRIX_DIR}/geometry_no_glazing.rad"
    MATRIX_SKY_RAD="\${MATRIX_DIR}/matrix_sky.rad"
    python3 ./extract_aperture.py "\${GEOM_FILE}" \\
        --aperture "\${APERTURE_RAD}" \\
        --rest "\${GEOM_NO_GLAZING}" \\
        --glow "\${WINDOW_GLOW_RAD}" --glow-mod window_glow \\
        --sky "\${MATRIX_SKY_RAD}"
    if [ \$? -ne 0 ]; then echo "Error deriving aperture files."; exit 1; fi

    # 2. Create the two octrees.
    echo "2. Creating octrees..."
    OCTREE_DMX="\${OCT_DIR}/\${PROJECT_NAME}_dmx.oct"
    (
    cat "\${MAT_FILE}"
    cat "\${GEOM_FILE}"
    echo
    cat "\${MATRIX_SKY_RAD}"
    echo
    echo "${lightDefs}"
    ) | oconv - > "\${OCTREE_DMX}"
    if [ \$? -ne 0 ]; then echo "Error creating daylight-matrix octree."; exit 1; fi

    OCTREE_VMX="\${OCT_DIR}/\${PROJECT_NAME}_vmx.oct"
    (
    cat "\${MAT_FILE}"
    cat "\${GEOM_NO_GLAZING}"
    echo
    cat "\${WINDOW_GLOW_RAD}"
    echo
    echo "${lightDefs}"
    ) | oconv - > "\${OCTREE_VMX}"
    if [ \$? -ne 0 ]; then echo "Error creating view-matrix octree."; exit 1; fi

    # 3. Generate Daylight Matrix (D): aperture -> sky.
    # rcontrib reads rays from stdin; genklemsamp is the sender that produces them, one
    # bundle per Klems incident direction. -e MF: must come BEFORE -f reinhart.cal, which
    # references MF while it is being compiled. -y makes rcontrib write NROWS into the
    # header so rmtxop can read the matrix back.
    echo "3. Generating Daylight Matrix (D)..."
    DAYLIGHT_MTX="\${MATRIX_DIR}/daylight.mtx"
    genklemsamp -c \${KLEMS_SAMPLES} -vd \${APERTURE_NORMAL} "\${APERTURE_RAD}" \\
    | rcontrib -c \${KLEMS_SAMPLES} -w -ab \${AB} -ad \${AD} -as \${AS} -ar \${AR} -aa \${AA} -lw \${LW} \\
        -e MF:\${SKY_MF} -f reinhart.cal -b rbin -bn \${SKY_NRBINS} -m sky_glow \\
        -y \${KLEMS_NBINS} "\${OCTREE_DMX}" > "\${DAYLIGHT_MTX}"
    if [ \$? -ne 0 ]; then echo "Error generating Daylight Matrix."; exit 1; fi

    # 4. Generate View Matrix (V): sensor points -> aperture.
    # -b takes an orientation-bound binning function. Plain "kbin" is a six-argument
    # function (kbin(Nx,Ny,Nz,Ux,Uy,Uz)) and cannot be used as a bare bin expression.
    echo "4. Generating View Matrix (V)..."
    VIEW_MTX="\${MATRIX_DIR}/view.mtx"
    rcontrib -I+ -w -ab \${AB} -ad \${AD} -as \${AS} -ar \${AR} -aa \${AA} -lw \${LW} \\
        -f klems_full.cal -b \${KLEMS_BIN} -bn \${KLEMS_NBINS} -m window_glow \\
        -y \${NUM_POINTS} "\${OCTREE_VMX}" < "\${POINTS_FILE}" > "\${VIEW_MTX}"
    if [ \$? -ne 0 ]; then echo "Error generating View Matrix."; exit 1; fi

    # 5. Optional: a second View matrix for the daylighting photocells, so the lighting
    #    energy recipe can dim each control zone from its own sensor instead of from the
    #    room-average illuminance.
    if [ -s "\${DAYLIGHT_SENSORS}" ]; then
        echo "5. Generating View Matrix for the daylighting photocells..."
        NUM_SENSORS=\$(wc -l < "\${DAYLIGHT_SENSORS}" | tr -d ' ')
        rcontrib -I+ -w -ab \${AB} -ad \${AD} -as \${AS} -ar \${AR} -aa \${AA} -lw \${LW} \\
            -f klems_full.cal -b \${KLEMS_BIN} -bn \${KLEMS_NBINS} -m window_glow \\
            -y \${NUM_SENSORS} "\${OCTREE_VMX}" < "\${DAYLIGHT_SENSORS}" > "\${MATRIX_DIR}/view_daylighting.mtx"
        if [ \$? -ne 0 ]; then echo "Error generating photocell View Matrix."; exit 1; fi
    else
        echo "5. No daylighting_sensors.pts found; skipping the photocell View Matrix."
    fi

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

    REM Reinhart subdivision (must match gendaymtx -m) and Klems binning for a
    REM ${aperture.orientation}-facing aperture.
    set "SKY_MF=${mf}"
    set "SKY_NRBINS=${nrbins}"
    set "KLEMS_NBINS=145"
    set "KLEMS_BIN=${aperture.kbin}"
    set "APERTURE_NORMAL=${aperture.outwardNormal}"
    set "KLEMS_SAMPLES=1000"

    REM --- File & Directory Setup ---
    set "GEOM_FILE=..\\01_geometry\\%PROJECT_NAME%.rad"
    set "MAT_FILE=..\\02_materials\\%PROJECT_NAME%_materials.rad"
    set "OCT_DIR=..\\06_octrees"
    set "RESULTS_DIR=..\\08_results"
    set "MATRIX_DIR=%RESULTS_DIR%\\matrices"
    set "POINTS_FILE=%RESULTS_DIR%\\grid.pts"
    set "DAYLIGHT_SENSORS=%RESULTS_DIR%\\daylighting_sensors.pts"
    set "TEMP_RAD_FILE=..\\06_octrees\\temp_scene.rad"

    if not exist "%OCT_DIR%" mkdir "%OCT_DIR%"
    if not exist "%RESULTS_DIR%" mkdir "%RESULTS_DIR%"
    if not exist "%MATRIX_DIR%" mkdir "%MATRIX_DIR%"

    for /f %%C in ('find /c /v "" ^< "%POINTS_FILE%"') do set "NUM_POINTS=%%C"

    REM 1. Derive the aperture, glow and sky files (shared python helper).
    echo 1. Deriving aperture, glow and sky files...
    set "APERTURE_RAD=%MATRIX_DIR%\\aperture.rad"
    set "WINDOW_GLOW_RAD=%MATRIX_DIR%\\window_glow.rad"
    set "GEOM_NO_GLAZING=%MATRIX_DIR%\\geometry_no_glazing.rad"
    set "MATRIX_SKY_RAD=%MATRIX_DIR%\\matrix_sky.rad"
    python3 extract_aperture.py "%GEOM_FILE%" --aperture "%APERTURE_RAD%" --rest "%GEOM_NO_GLAZING%" --glow "%WINDOW_GLOW_RAD%" --glow-mod window_glow --sky "%MATRIX_SKY_RAD%"
    if %errorlevel% neq 0 ( echo "Error deriving aperture files." & exit /b 1 )

    REM 2. Create the two octrees.
    echo 2. Creating octrees...
    set "OCTREE_DMX=%OCT_DIR%\\%PROJECT_NAME%_dmx.oct"
    (
        type "%MAT_FILE%"
        echo.
        type "%GEOM_FILE%"
        echo.
        type "%MATRIX_SKY_RAD%"
        echo.
        (
    ${lightDefs.split('\n').map(line => line.trim() === '' ? '        echo.' : `        echo ${line}`).join('\n')}
        )
    ) > "%TEMP_RAD_FILE%"
    oconv "%TEMP_RAD_FILE%" > "%OCTREE_DMX%"
    if %errorlevel% neq 0 ( echo "Error creating daylight-matrix octree." & del "%TEMP_RAD_FILE%" & exit /b 1 )

    set "OCTREE_VMX=%OCT_DIR%\\%PROJECT_NAME%_vmx.oct"
    (
        type "%MAT_FILE%"
        echo.
        type "%GEOM_NO_GLAZING%"
        echo.
        type "%WINDOW_GLOW_RAD%"
        echo.
        (
    ${lightDefs.split('\n').map(line => line.trim() === '' ? '        echo.' : `        echo ${line}`).join('\n')}
        )
    ) > "%TEMP_RAD_FILE%"
    oconv "%TEMP_RAD_FILE%" > "%OCTREE_VMX%"
    if %errorlevel% neq 0 ( echo "Error creating view-matrix octree." & del "%TEMP_RAD_FILE%" & exit /b 1 )
    del "%TEMP_RAD_FILE%"

    REM 3. Generate Daylight Matrix (D)
    echo 3. Generating Daylight Matrix (D)...
    set "DAYLIGHT_MTX=%MATRIX_DIR%\\daylight.mtx"
    genklemsamp -c %KLEMS_SAMPLES% -vd %APERTURE_NORMAL% "%APERTURE_RAD%" | rcontrib -c %KLEMS_SAMPLES% -w -ab %AB% -ad %AD% -as %AS% -ar %AR% -aa %AA% -lw %LW% -e MF:%SKY_MF% -f reinhart.cal -b rbin -bn %SKY_NRBINS% -m sky_glow -y %KLEMS_NBINS% "%OCTREE_DMX%" > "%DAYLIGHT_MTX%"
    if %errorlevel% neq 0 ( echo "Error generating Daylight Matrix." & exit /b 1 )

    REM 4. Generate View Matrix (V)
    echo 4. Generating View Matrix (V)...
    set "VIEW_MTX=%MATRIX_DIR%\\view.mtx"
    rcontrib -I+ -w -ab %AB% -ad %AD% -as %AS% -ar %AR% -aa %AA% -lw %LW% -f klems_full.cal -b %KLEMS_BIN% -bn %KLEMS_NBINS% -m window_glow -y %NUM_POINTS% "%OCTREE_VMX%" < "%POINTS_FILE%" > "%VIEW_MTX%"
    if %errorlevel% neq 0 ( echo "Error generating View Matrix." & exit /b 1 )

    REM 5. Optional photocell View Matrix for the lighting-energy recipe.
    if exist "%DAYLIGHT_SENSORS%" (
        echo 5. Generating View Matrix for the daylighting photocells...
        for /f %%C in ('find /c /v "" ^< "%DAYLIGHT_SENSORS%"') do set "NUM_SENSORS=%%C"
        rcontrib -I+ -w -ab %AB% -ad %AD% -as %AS% -ar %AR% -aa %AA% -lw %LW% -f klems_full.cal -b %KLEMS_BIN% -bn %KLEMS_NBINS% -m window_glow -y %NUM_SENSORS% "%OCTREE_VMX%" < "%DAYLIGHT_SENSORS%" > "%MATRIX_DIR%\\view_daylighting.mtx"
    )

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
    # -m MUST match the MF the daylight matrix was binned with (see the matrix generation
    # script) or the two matrices cannot be multiplied. LM-83 asks for MF:${ANNUAL_SKY_MF}.
    epw2wea "\${WEATHER_FILE}" | gendaymtx -m ${ANNUAL_SKY_MF} > "\${SKY_MTX}"
    if [ \$? -ne 0 ]; then echo "Error generating Sky Matrix."; exit 1; fi

    # 2. Run dctimestep to get annual results
    # -of writes a binary float matrix. Without it the .ill is ASCII, which the Python
    # post-processor reads with np.fromfile as if it were float32 and gets garbage.
    # The result has one ROW per sensor point and one COLUMN per timestep.
    echo "2. Running dctimestep for annual simulation..."
    DAYLIGHT_MTX="\${MATRIX_DIR}/daylight.mtx"
    VIEW_MTX="\${MATRIX_DIR}/view.mtx"
    ANNUAL_RESULTS="\${RESULTS_DIR}/\${PROJECT_NAME}.ill"
    POINTS_FILE="../08_results/grid.pts"
    NUM_POINTS=$(wc -l < "\${POINTS_FILE}" | tr -d ' ')
    dctimestep -of "\${VIEW_MTX}" "\${BSDF_FILE}" "\${DAYLIGHT_MTX}" "\${SKY_MTX}" > "\${ANNUAL_RESULTS}"
    if [ \$? -ne 0 ]; then echo "Error during dctimestep."; exit 1; fi

    echo "---"
    echo "Annual simulation complete."
    echo "Annual illuminance results saved to: \${ANNUAL_RESULTS}"
    echo "Run: python3 post_process_annual.py \"\${ANNUAL_RESULTS}\" --points \${NUM_POINTS}"
    echo "Note: this 3-phase result carries no separate direct-sun component, so ASE is not reported."
    echo "      Use the 5-phase or the dedicated sDA/ASE recipe for an LM-83 ASE figure."
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
    (epw2wea "%WEATHER_FILE%") | gendaymtx -m ${ANNUAL_SKY_MF} > "%SKY_MTX%"
    if %errorlevel% neq 0 ( echo "Error generating Sky Matrix." & exit /b 1 )

    REM 2. Run dctimestep to get annual results
    echo 2. Running dctimestep for annual simulation...
    set "DAYLIGHT_MTX=%MATRIX_DIR%\\daylight.mtx"
    set "VIEW_MTX=%MATRIX_DIR%\\view.mtx"
    set "ANNUAL_RESULTS=%RESULTS_DIR%\\%PROJECT_NAME%.ill"
    dctimestep -of "%VIEW_MTX%" "%BSDF_FILE%" "%DAYLIGHT_MTX%" "%SKY_MTX%" > "%ANNUAL_RESULTS%"
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
    const mf = ANNUAL_SKY_MF;
    const nrbins = _reinhartNrbins(mf);
    const aperture = _primaryAperture(projectData);
    const lightDefs = generateLightSourceDefinitions(projectData.lighting, projectData.geometry.room, projectData.simulationFiles);

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

    # Reinhart subdivision shared by gendaymtx -m and rcontrib's MF, and the Klems binning
    # for this project's ${aperture.orientation}-facing aperture.
    SKY_MF=${mf}
    SKY_NRBINS=${nrbins}
    KLEMS_NBINS=145
    KLEMS_BIN=${aperture.kbin}
    APERTURE_NORMAL="${aperture.outwardNormal}"
    KLEMS_SAMPLES=1000

    # --- File & Directory Setup ---
    GEOM_FILE="../01_geometry/\${PROJECT_NAME}.rad"
    MAT_FILE="../02_materials/\${PROJECT_NAME}_materials.rad"
    OCT_DIR="../06_octrees"
    RESULTS_DIR="../08_results"
    MATRIX_DIR="\${RESULTS_DIR}/matrices"
    POINTS_FILE="../08_results/grid.pts"
    NUM_POINTS=$(wc -l < "\${POINTS_FILE}" | tr -d ' ')
    mkdir -p \$OCT_DIR \$RESULTS_DIR \$MATRIX_DIR

    echo "--- Starting 5-Phase Simulation Workflow ---"

    # 1. Derive the aperture / glow / sky files the matrices need. See the 3-phase script
    #    for why the View matrix needs its own octree with the glazing replaced by a glow.
    echo "1. Deriving aperture, glow and sky files..."
    APERTURE_RAD="\${MATRIX_DIR}/aperture.rad"
    WINDOW_GLOW_RAD="\${MATRIX_DIR}/window_glow.rad"
    GEOM_NO_GLAZING="\${MATRIX_DIR}/geometry_no_glazing.rad"
    MATRIX_SKY_RAD="\${MATRIX_DIR}/matrix_sky.rad"
    python3 ./extract_aperture.py "\${GEOM_FILE}" \\
        --aperture "\${APERTURE_RAD}" \\
        --rest "\${GEOM_NO_GLAZING}" \\
        --glow "\${WINDOW_GLOW_RAD}" --glow-mod window_glow \\
        --sky "\${MATRIX_SKY_RAD}"
    if [ \$? -ne 0 ]; then echo "Error deriving aperture files."; exit 1; fi

    # 2. Create the octrees.
    echo "2. Creating octrees..."
    OCTREE_DMX="\${OCT_DIR}/\${PROJECT_NAME}_dmx.oct"
    (
    cat "\${MAT_FILE}"
    cat "\${GEOM_FILE}"
    echo
    cat "\${MATRIX_SKY_RAD}"
    echo
    echo "${lightDefs}"
    ) | oconv - > "\${OCTREE_DMX}"
    if [ \$? -ne 0 ]; then echo "Error creating daylight-matrix octree."; exit 1; fi

    OCTREE_VMX="\${OCT_DIR}/\${PROJECT_NAME}_vmx.oct"
    (
    cat "\${MAT_FILE}"
    cat "\${GEOM_NO_GLAZING}"
    echo
    cat "\${WINDOW_GLOW_RAD}"
    echo
    echo "${lightDefs}"
    ) | oconv - > "\${OCTREE_VMX}"
    if [ \$? -ne 0 ]; then echo "Error creating view-matrix octree."; exit 1; fi

    # The direct-sun coefficient matrix is traced against the full scene, including the
    # glazing, because the suns are real sources outside the window.
    OCTREE_SCENE="\${OCT_DIR}/\${PROJECT_NAME}.oct"
    (
    cat "\${MAT_FILE}"
    cat "\${GEOM_FILE}"
    echo
    echo "${lightDefs}"
    ) | oconv - > "\${OCTREE_SCENE}"
    if [ \$? -ne 0 ]; then echo "Error during oconv."; exit 1; fi

    # 3. Generate Annual Sky Matrix (S)
    echo "3. Generating annual sky matrix from EPW..."
    SKY_MTX="\${MATRIX_DIR}/sky.mtx"
    epw2wea "\${WEATHER_FILE}" | gendaymtx -m \${SKY_MF} > "\${SKY_MTX}"
    if [ \$? -ne 0 ]; then echo "Error generating Sky Matrix."; exit 1; fi

    # 4. Generate Daylight Matrix (D): aperture -> sky, sampled with genklemsamp.
    echo "4. Generating Daylight Matrix (D)..."
    DAYLIGHT_MTX="\${MATRIX_DIR}/daylight.mtx"
    genklemsamp -c \${KLEMS_SAMPLES} -vd \${APERTURE_NORMAL} "\${APERTURE_RAD}" \\
    | rcontrib -c \${KLEMS_SAMPLES} -w -ab \$AB -ad \$AD -as \$AS -ar \$AR -aa \$AA -lw \$LW \\
        -e MF:\${SKY_MF} -f reinhart.cal -b rbin -bn \${SKY_NRBINS} -m sky_glow \\
        -y \${KLEMS_NBINS} "\${OCTREE_DMX}" > "\${DAYLIGHT_MTX}"
    if [ \$? -ne 0 ]; then echo "Error generating Daylight Matrix."; exit 1; fi

    # 5. Generate View Matrix (V): sensor points -> aperture glow.
    echo "5. Generating View Matrix (V)..."
    VIEW_MTX="\${MATRIX_DIR}/view.mtx"
    rcontrib -I+ -w -ab \$AB -ad \$AD -as \$AS -ar \$AR -aa \$AA -lw \$LW \\
        -f klems_full.cal -b \${KLEMS_BIN} -bn \${KLEMS_NBINS} -m window_glow \\
        -y \${NUM_POINTS} "\${OCTREE_VMX}" < "\${POINTS_FILE}" > "\${VIEW_MTX}"
    if [ \$? -ne 0 ]; then echo "Error generating View Matrix."; exit 1; fi

    # 6. Generate the discrete suns and the matching per-sun sky matrix.
    # -d and -s are mutually exclusive gendaymtx modes and cannot be combined. The correct
    # form is a two-step one: -D writes the sun PRIMITIVES to a .rad file and -M writes the
    # matching list of modifier NAMES, while the same run's stdout is the per-sun matrix
    # (one column per sun, NOT the 146-row sky matrix). rcontrib -M then takes the modifier
    # LIST file, which is what it has always expected.
    echo "6. Generating sun primitives and the per-sun sky matrix..."
    SUNS_RAD="\${MATRIX_DIR}/suns.rad"
    SUN_MODS="\${MATRIX_DIR}/sunmods.txt"
    SUN_MTX="\${MATRIX_DIR}/sun.mtx"
    epw2wea "\${WEATHER_FILE}" \\
    | gendaymtx -n -D "\${SUNS_RAD}" -M "\${SUN_MODS}" -m \${SKY_MF} > /dev/null
    if [ \$? -ne 0 ]; then echo "Error generating sun primitives."; exit 1; fi
    epw2wea "\${WEATHER_FILE}" | gendaymtx -5 0.533 -d -m \${SKY_MF} > "\${SUN_MTX}"
    if [ \$? -ne 0 ]; then echo "Error generating the direct sky matrix."; exit 1; fi

    # 7. Direct-only sky matrix for the 3-phase subtraction term.
    echo "7. Generating direct-only sky matrix..."
    SUN_SKY_MTX="\${MATRIX_DIR}/sun_sky.mtx"
    epw2wea "\${WEATHER_FILE}" | gendaymtx -m \${SKY_MF} -d > "\${SUN_SKY_MTX}"
    if [ \$? -ne 0 ]; then echo "Error generating Sun Sky Matrix."; exit 1; fi

    # 8. Generate the direct sun coefficient matrix (C_ds), one column per sun.
    echo "8. Generating direct daylight coefficient matrix (C_ds)..."
    CDS_MTX="\${MATRIX_DIR}/cds.mtx"
    OCTREE_SUNS="\${OCT_DIR}/\${PROJECT_NAME}_suns.oct"
    (
    cat "\${MAT_FILE}"
    cat "\${GEOM_FILE}"
    echo
    cat "\${SUNS_RAD}"
    ) | oconv - > "\${OCTREE_SUNS}"
    if [ \$? -ne 0 ]; then echo "Error creating the sun octree."; exit 1; fi
    rcontrib -I+ -w -ab 1 -ad 1024 -lw 1e-5 -dj 0 -dt 0 -dc 1 -dr 0 -st 0 \\
        -M "\${SUN_MODS}" -y \${NUM_POINTS} "\${OCTREE_SUNS}" < "\${POINTS_FILE}" > "\${CDS_MTX}"
    if [ \$? -ne 0 ]; then echo "Error generating CDS Matrix."; exit 1; fi

    # --- PART 9: Combine Matrices for Final Result ---
    # Every dctimestep here writes binary float (-of) so the results can be recombined by
    # rmtxop and read back by the Python post-processor without a format mismatch.
    echo "9. Running dctimestep to combine matrices for final annual result..."

    ILL_3PH_TOTAL="\${RESULTS_DIR}/total_3ph.ill"
    dctimestep -of "\${VIEW_MTX}" "\${BSDF_FILE}" "\${DAYLIGHT_MTX}" "\${SKY_MTX}" > "\${ILL_3PH_TOTAL}"
    if [ \$? -ne 0 ]; then echo "Error generating total 3-phase result."; exit 1; fi

    ILL_3PH_DIRECT="\${RESULTS_DIR}/direct_3ph.ill"
    dctimestep -of "\${VIEW_MTX}" "\${BSDF_FILE}" "\${DAYLIGHT_MTX}" "\${SUN_SKY_MTX}" > "\${ILL_3PH_DIRECT}"
    if [ \$? -ne 0 ]; then echo "Error generating direct 3-phase result."; exit 1; fi

    # Accurate direct component: C_ds multiplies the PER-SUN matrix, not the sky matrix.
    ILL_5PH_DIRECT="\${RESULTS_DIR}/direct_5ph.ill"
    dctimestep -of "\${CDS_MTX}" "\${SUN_MTX}" > "\${ILL_5PH_DIRECT}"
    if [ \$? -ne 0 ]; then echo "Error generating direct 5-phase result."; exit 1; fi

    # Final calculation: Total - Inaccurate_Direct + Accurate_Direct
    FINAL_RESULTS="\${RESULTS_DIR}/\${PROJECT_NAME}_5ph_final.ill"
    rmtxop "\${ILL_3PH_TOTAL}" + -s -1 "\${ILL_3PH_DIRECT}" + "\${ILL_5PH_DIRECT}" > "\${FINAL_RESULTS}"
    if [ \$? -ne 0 ]; then echo "Error during final rmtxop calculation."; exit 1; fi

    echo "---"
    echo "5-Phase simulation complete. Final results saved to: \${FINAL_RESULTS}"
    echo "---"

    # ASE is defined by LM-83 on direct sunlight alone, so the direct-only matrix
    # result is passed alongside the total. Without it the post-processor reports
    # sDA and UDI and explicitly declines to report ASE.
    if command -v python3 >/dev/null 2>&1 && [ -f post_process_annual.py ]; then
        echo "Post-processing annual metrics..."
        python3 post_process_annual.py "\${FINAL_RESULTS}" --points "\${NUM_POINTS}" --direct-ill "\${ILL_5PH_DIRECT}"
    else
        echo "Run: python3 post_process_annual.py \"\${FINAL_RESULTS}\" --points \${NUM_POINTS} --direct-ill \"\${ILL_5PH_DIRECT}\""
    fi
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

    set "SKY_MF=${mf}"
    set "SKY_NRBINS=${nrbins}"
    set "KLEMS_NBINS=145"
    set "KLEMS_BIN=${aperture.kbin}"
    set "APERTURE_NORMAL=${aperture.outwardNormal}"
    set "KLEMS_SAMPLES=1000"

    REM --- File & Directory Setup ---
    set "GEOM_FILE=..\\01_geometry\\%PROJECT_NAME%.rad"
    set "MAT_FILE=..\\02_materials\\%PROJECT_NAME%_materials.rad"
    set "OCT_DIR=..\\06_octrees"
    set "RESULTS_DIR=..\\08_results"
    set "MATRIX_DIR=%RESULTS_DIR%\\matrices"
    set "POINTS_FILE=%RESULTS_DIR%\\grid.pts"
    set "TEMP_RAD_FILE=..\\06_octrees\\temp_scene.rad"

    if not exist "%OCT_DIR%" mkdir "%OCT_DIR%"
    if not exist "%RESULTS_DIR%" mkdir "%RESULTS_DIR%"
    if not exist "%MATRIX_DIR%" mkdir "%MATRIX_DIR%"

    for /f %%C in ('find /c /v "" ^< "%POINTS_FILE%"') do set "NUM_POINTS=%%C"

    echo --- Starting 5-Phase Simulation Workflow ---

    REM 1. Derive the aperture / glow / sky files.
    echo 1. Deriving aperture, glow and sky files...
    set "APERTURE_RAD=%MATRIX_DIR%\\aperture.rad"
    set "WINDOW_GLOW_RAD=%MATRIX_DIR%\\window_glow.rad"
    set "GEOM_NO_GLAZING=%MATRIX_DIR%\\geometry_no_glazing.rad"
    set "MATRIX_SKY_RAD=%MATRIX_DIR%\\matrix_sky.rad"
    python3 extract_aperture.py "%GEOM_FILE%" --aperture "%APERTURE_RAD%" --rest "%GEOM_NO_GLAZING%" --glow "%WINDOW_GLOW_RAD%" --glow-mod window_glow --sky "%MATRIX_SKY_RAD%"
    if %errorlevel% neq 0 ( echo "Error deriving aperture files." & exit /b 1 )

    REM 2. Create the octrees.
    echo 2. Creating octrees...
    set "OCTREE_DMX=%OCT_DIR%\\%PROJECT_NAME%_dmx.oct"
    (
        type "%MAT_FILE%"
        echo.
        type "%GEOM_FILE%"
        echo.
        type "%MATRIX_SKY_RAD%"
        echo.
        (
    ${lightDefs.split('\n').map(line => line.trim() === '' ? '        echo.' : `        echo ${line}`).join('\n')}
        )
    ) > "%TEMP_RAD_FILE%"
    oconv "%TEMP_RAD_FILE%" > "%OCTREE_DMX%"
    if %errorlevel% neq 0 ( echo "Error creating daylight-matrix octree." & del "%TEMP_RAD_FILE%" & exit /b 1 )

    set "OCTREE_VMX=%OCT_DIR%\\%PROJECT_NAME%_vmx.oct"
    (
        type "%MAT_FILE%"
        echo.
        type "%GEOM_NO_GLAZING%"
        echo.
        type "%WINDOW_GLOW_RAD%"
        echo.
        (
    ${lightDefs.split('\n').map(line => line.trim() === '' ? '        echo.' : `        echo ${line}`).join('\n')}
        )
    ) > "%TEMP_RAD_FILE%"
    oconv "%TEMP_RAD_FILE%" > "%OCTREE_VMX%"
    if %errorlevel% neq 0 ( echo "Error creating view-matrix octree." & del "%TEMP_RAD_FILE%" & exit /b 1 )
    del "%TEMP_RAD_FILE%"

    REM 3. Generate Annual Sky Matrix (S)
    echo 3. Generating annual sky matrix from EPW...
    set "SKY_MTX=%MATRIX_DIR%\\sky.mtx"
    (epw2wea "%WEATHER_FILE%") | gendaymtx -m %SKY_MF% > "%SKY_MTX%"
    if %errorlevel% neq 0 ( echo "Error generating Sky Matrix." & exit /b 1 )

    REM 4. Generate Daylight Matrix (D)
    echo 4. Generating Daylight Matrix (D)...
    set "DAYLIGHT_MTX=%MATRIX_DIR%\\daylight.mtx"
    genklemsamp -c %KLEMS_SAMPLES% -vd %APERTURE_NORMAL% "%APERTURE_RAD%" | rcontrib -c %KLEMS_SAMPLES% -w -ab %AB% -ad %AD% -as %AS% -ar %AR% -aa %AA% -lw %LW% -e MF:%SKY_MF% -f reinhart.cal -b rbin -bn %SKY_NRBINS% -m sky_glow -y %KLEMS_NBINS% "%OCTREE_DMX%" > "%DAYLIGHT_MTX%"
    if %errorlevel% neq 0 ( echo "Error generating Daylight Matrix." & exit /b 1 )

    REM 5. Generate View Matrix (V)
    echo 5. Generating View Matrix (V)...
    set "VIEW_MTX=%MATRIX_DIR%\\view.mtx"
    rcontrib -I+ -w -ab %AB% -ad %AD% -as %AS% -ar %AR% -aa %AA% -lw %LW% -f klems_full.cal -b %KLEMS_BIN% -bn %KLEMS_NBINS% -m window_glow -y %NUM_POINTS% "%OCTREE_VMX%" < "%POINTS_FILE%" > "%VIEW_MTX%"
    if %errorlevel% neq 0 ( echo "Error generating View Matrix." & exit /b 1 )

    REM 6. Sun primitives, the modifier list and the per-sun matrix.
    echo 6. Generating sun primitives and the per-sun sky matrix...
    set "SUNS_RAD=%MATRIX_DIR%\\suns.rad"
    set "SUN_MODS=%MATRIX_DIR%\\sunmods.txt"
    set "SUN_MTX=%MATRIX_DIR%\\sun.mtx"
    (epw2wea "%WEATHER_FILE%") | gendaymtx -n -D "%SUNS_RAD%" -M "%SUN_MODS%" -m %SKY_MF% > nul
    if %errorlevel% neq 0 ( echo "Error generating sun primitives." & exit /b 1 )
    (epw2wea "%WEATHER_FILE%") | gendaymtx -5 0.533 -d -m %SKY_MF% > "%SUN_MTX%"
    if %errorlevel% neq 0 ( echo "Error generating the direct sky matrix." & exit /b 1 )

    REM 7. Direct-only sky matrix for the subtraction term.
    echo 7. Generating direct-only sky matrix...
    set "SUN_SKY_MTX=%MATRIX_DIR%\\sun_sky.mtx"
    (epw2wea "%WEATHER_FILE%") | gendaymtx -m %SKY_MF% -d > "%SUN_SKY_MTX%"
    if %errorlevel% neq 0 ( echo "Error generating Sun Sky Matrix." & exit /b 1 )

    REM 8. Direct sun coefficient matrix (C_ds)
    echo 8. Generating direct daylight coefficient matrix (C_ds)...
    set "CDS_MTX=%MATRIX_DIR%\\cds.mtx"
    set "OCTREE_SUNS=%OCT_DIR%\\%PROJECT_NAME%_suns.oct"
    (
        type "%MAT_FILE%"
        echo.
        type "%GEOM_FILE%"
        echo.
        type "%SUNS_RAD%"
    ) > "%TEMP_RAD_FILE%"
    oconv "%TEMP_RAD_FILE%" > "%OCTREE_SUNS%"
    if %errorlevel% neq 0 ( echo "Error creating the sun octree." & del "%TEMP_RAD_FILE%" & exit /b 1 )
    del "%TEMP_RAD_FILE%"
    rcontrib -I+ -w -ab 1 -ad 1024 -lw 1e-5 -dj 0 -dt 0 -dc 1 -dr 0 -st 0 -M "%SUN_MODS%" -y %NUM_POINTS% "%OCTREE_SUNS%" < "%POINTS_FILE%" > "%CDS_MTX%"
    if %errorlevel% neq 0 ( echo "Error generating CDS Matrix." & exit /b 1 )

    REM --- PART 9: Combine Matrices for Final Result ---
    echo 9. Running dctimestep to combine matrices for final annual result...
    set "ILL_3PH_TOTAL=%RESULTS_DIR%\\total_3ph.ill"
    dctimestep -of "%VIEW_MTX%" "%BSDF_FILE%" "%DAYLIGHT_MTX%" "%SKY_MTX%" > "%ILL_3PH_TOTAL%"
    if %errorlevel% neq 0 ( echo "Error generating total 3-phase result." & exit /b 1 )

    set "ILL_3PH_DIRECT=%RESULTS_DIR%\\direct_3ph.ill"
    dctimestep -of "%VIEW_MTX%" "%BSDF_FILE%" "%DAYLIGHT_MTX%" "%SUN_SKY_MTX%" > "%ILL_3PH_DIRECT%"
    if %errorlevel% neq 0 ( echo "Error generating direct 3-phase result." & exit /b 1 )

    set "ILL_5PH_DIRECT=%RESULTS_DIR%\\direct_5ph.ill"
    dctimestep -of "%CDS_MTX%" "%SUN_MTX%" > "%ILL_5PH_DIRECT%"
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

/**
 * Chooses the aperture the 3-/5-phase matrices are built around: the wall carrying the
 * largest total glazing area. The Klems binning function and the genklemsamp sampling
 * direction are both bound to that wall's orientation.
 * @param {object} projectData - The complete project data object.
 * @returns {{orientation: string, outwardNormal: string, kbin: string, hasAperture: boolean}}
 */
function _primaryAperture(projectData) {
    const apertures = projectData?.geometry?.apertures || {};
    // Outward normals in the Radiance frame (X east, Y north, Z up). The app's North is
    // -Z in Three.js, which the shared axis map sends to +Y, so a north-facing wall looks
    // outward along +Y. genklemsamp -vd wants this outward normal; klems_full.cal's
    // kbinN/E/S/W are already defined with the matching inward normal.
    const outward = { N: '0 1 0', S: '0 -1 0', E: '1 0 0', W: '-1 0 0' };
    let best = null;
    let bestArea = 0;
    for (const o of ['N', 'S', 'E', 'W']) {
        const w = apertures[o];
        if (!w) continue;
        const area = (Number(w.ww) || 0) * (Number(w.wh) || 0) * (Number(w.winCount) || 0);
        if (area > bestArea) { bestArea = area; best = o; }
    }
    const orientation = best || 'S';
    return {
        orientation,
        outwardNormal: outward[orientation],
        // klems_full.cal also defines kbinD for a horizontal aperture (skylight); the
        // parametric model only produces vertical walls, so only N/E/S/W are reachable.
        kbin: `kbin${orientation}`,
        hasAperture: bestArea > 0
    };
}

/**
 * Emits the Python helper that splits the geometry file into its aperture and
 * non-aperture parts. Python rather than awk so the .bat and .sh paths share one
 * implementation; python3 is already a declared dependency of every matrix recipe.
 * @returns {{fileName: string, content: string}}
 */
function createApertureExtractorScript() {
    const content = `"""Split a Radiance geometry file into its aperture and non-aperture parts.

The three-phase matrices each need a different view of the same room:

  * The DAYLIGHT matrix samples the window as a Klems sender, so it needs the glazing
    polygons on their own as a genklemsamp input.
  * The VIEW matrix needs the window redefined as an inward-facing "glow" - a glass
    material is not a light source, so rcontrib -m glass_mat would bin nothing at all -
    in an octree where the original glass polygons are absent, or the two would coincide.

The file is parsed as a stream of Radiance primitives (modifier / type / identifier, then
the string, integer and real argument counts) rather than by line matching, so comments
and arbitrary line wrapping cannot desynchronise the scan.
"""
import argparse
import sys

GLOW_BLOCK = """void glow sky_glow
0
0
4 1 1 1 0

sky_glow source sky
0
0
4 0 0 1 180

void glow ground_glow
0
0
4 1 1 1 0

ground_glow source ground
0
0
4 0 0 -1 180
"""


def _tokenize(text):
    """Strips comments and inline commands, then returns the whitespace-separated tokens."""
    kept = []
    for line in text.splitlines():
        stripped = line.lstrip()
        if stripped.startswith("!"):
            # An inline command (e.g. !xform) cannot be resolved here; skip the line.
            continue
        hash_at = line.find("#")
        if hash_at >= 0:
            line = line[:hash_at]
        kept.append(line)
    return " ".join(kept).split()


def parse_primitives(text):
    toks = _tokenize(text)
    prims = []
    i = 0
    n = len(toks)
    while i < n:
        if i + 2 >= n:
            raise ValueError("truncated primitive at token %d" % i)
        mod, typ, ident = toks[i], toks[i + 1], toks[i + 2]
        i += 3
        if typ == "alias":
            # "mod alias newid oldid" carries no argument counts.
            if i >= n:
                raise ValueError("truncated alias primitive '%s'" % ident)
            prims.append((mod, typ, ident, None, [toks[i]]))
            i += 1
            continue
        args = []
        for _ in range(3):
            if i >= n:
                raise ValueError("truncated argument list in primitive '%s'" % ident)
            count = int(float(toks[i]))
            i += 1
            if i + count > n:
                raise ValueError("primitive '%s' declares %d arguments but the file ends" % (ident, count))
            args.append(toks[i:i + count])
            i += count
        prims.append((mod, typ, ident, args, None))
    return prims


def format_primitive(mod, typ, ident, args, alias_target):
    if alias_target is not None:
        return "%s %s %s %s\\n\\n" % (mod, typ, ident, alias_target[0])
    out = ["%s %s %s" % (mod, typ, ident)]
    for group in args:
        out.append(" ".join([str(len(group))] + group))
    return "\\n".join(out) + "\\n\\n"


def is_aperture(mod, typ, ident, glass_mod):
    return mod == glass_mod and typ in ("polygon", "ring")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("geometry", help="the scene geometry .rad file")
    ap.add_argument("--glass-mod", default="glass_mat", help="modifier that identifies the glazing")
    ap.add_argument("--aperture", help="write the glazing primitives here (genklemsamp sender)")
    ap.add_argument("--rest", help="write everything except the glazing here")
    ap.add_argument("--glow", help="write a glow-modified copy of the glazing here")
    ap.add_argument("--glow-mod", default="window_glow", help="modifier name for the glow copy")
    ap.add_argument("--sky", help="write the sky/ground glow dome the daylight matrix bins")
    args = ap.parse_args()

    with open(args.geometry, "r") as fh:
        prims = parse_primitives(fh.read())

    aperture = [p for p in prims if is_aperture(p[0], p[1], p[2], args.glass_mod)]
    rest = [p for p in prims if not is_aperture(p[0], p[1], p[2], args.glass_mod)]

    if not aperture:
        sys.stderr.write(
            "ERROR: no '%s' polygons found in %s.\\n"
            "       The three-phase method needs an aperture to sample. Add a window and\\n"
            "       regenerate the geometry before running this script.\\n"
            % (args.glass_mod, args.geometry))
        return 1

    if args.aperture:
        with open(args.aperture, "w") as fh:
            for p in aperture:
                fh.write(format_primitive(*p))
    if args.rest:
        with open(args.rest, "w") as fh:
            for p in rest:
                fh.write(format_primitive(*p))
    if args.glow:
        with open(args.glow, "w") as fh:
            fh.write("void glow %s\\n0\\n0\\n4 1 1 1 0\\n\\n" % args.glow_mod)
            for mod, typ, ident, a, alias_target in aperture:
                fh.write(format_primitive(args.glow_mod, typ, ident, a, alias_target))
    if args.sky:
        with open(args.sky, "w") as fh:
            fh.write(GLOW_BLOCK)

    sys.stderr.write("extract_aperture: %d aperture primitive(s), %d other primitive(s).\\n"
                     % (len(aperture), len(rest)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
`;
    return { fileName: 'extract_aperture.py', content };
}

function createPostProcessingScript() {
    // This script is a direct copy from the source document.
    const content = `import numpy as np
import pandas as pd
import argparse
import os
from typing import Optional

def _load_radiance_matrix(path, num_points):
    """Reads a matrix written by dctimestep or rmtxop into (hours, points, comp).

    Two things make a plain np.fromfile wrong here. The file carries an ASCII
    header before the payload, so reading the whole file as float32 turns the
    header bytes into bogus samples and shifts every later index. And the header
    says NROWS is the SENSOR count while NCOLS is the number of timesteps, so the
    payload is point-major; reshaping it as (8760, num_points, 3) transposes the
    result and silently scrambles every annual metric computed from it.
    """
    rows = cols = 0
    ncomp = 3
    # A file with no Radiance header is one this script wrote itself, and those are
    # raw float32. Defaulting to 'ascii' here made the recombined .ill unreadable.
    fmt = 'float'
    with open(path, 'rb') as f:
        if f.read(10) == b'#?RADIANCE':
            fmt = 'ascii'
            f.seek(0)
            while True:
                line = f.readline()
                if not line or not line.strip():
                    break
                text = line.decode('ascii', 'replace').strip()
                if text.startswith('NROWS='):
                    rows = int(text.split('=', 1)[1])
                elif text.startswith('NCOLS='):
                    cols = int(text.split('=', 1)[1])
                elif text.startswith('NCOMP='):
                    ncomp = int(text.split('=', 1)[1])
                elif text.startswith('FORMAT='):
                    fmt = text.split('=', 1)[1].strip()
        else:
            f.seek(0)
        payload = f.read()
    if 'double' in fmt:
        data = np.frombuffer(payload, dtype=np.float64)
    elif 'float' in fmt:
        data = np.frombuffer(payload, dtype=np.float32)
    else:
        data = np.array(payload.split(), dtype=np.float64)
    if not rows:
        # A headerless file: the recombination step writes raw point-major floats.
        rows, ncomp = num_points, 3
        cols = data.size // max(rows * ncomp, 1)
    data = data[:rows * cols * ncomp].reshape(rows, cols, ncomp)
    return np.swapaxes(data, 0, 1)


def _read_ill(path: str, num_points: int):
    """Read a Radiance annual .ill file and reduce RGB to photopic illuminance."""
    rgb = _load_radiance_matrix(path, num_points)
    return 179 * (rgb[:, :, 0] * 0.265 + rgb[:, :, 1] * 0.670 + rgb[:, :, 2] * 0.065)


def calculate_metrics(illuminance_file: str, output_dir: str, num_points: int, schedule_file: Optional[str] = None, direct_file: Optional[str] = None):
    """
    Calculates sDA and UDI from a Radiance annual illuminance file, and ASE from a
    direct-only file when one is supplied.
    Args:
        illuminance_file (str): Path to the total .ill file from dctimestep.
        output_dir (str): Directory to save the results CSV.
        num_points (int): The number of sensor points in the simulation grid.
        schedule_file (str): Optional 8760-row occupancy schedule.
        direct_file (str): Optional direct-only .ill, required for LM-83 ASE.
    """
    print(f"Reading annual illuminance data from: {illuminance_file}")
    direct_illuminance = None
    try:
        # Radiance .ill files are typically 3-channel (RGB) float32
        rgb_illuminance = _load_radiance_matrix(illuminance_file, num_points)
        annual_illuminance = 179 * (rgb_illuminance[:,:,0]*0.265 + rgb_illuminance[:,:,1]*0.670 + rgb_illuminance[:,:,2]*0.065)
    except Exception as e:
        print(f"Error reading or reshaping file: {e}")
        print("Please ensure the --points argument matches your simulation grid.")
        return
    
    if num_points <= 0:
        print("Error: --points must be a positive integer.")
        return
    print(f"Data loaded successfully. Shape: {annual_illuminance.shape}")

    if direct_file:
        if os.path.exists(direct_file):
            try:
                direct_illuminance = _read_ill(direct_file, num_points)
                print(f"Direct-only illuminance loaded for ASE from: {direct_file}")
            except Exception as e:
                print(f"Warning: could not read direct-only file ({e}). ASE will not be reported.")
        else:
            print(f"Warning: direct-only file not found: {direct_file}. ASE will not be reported.")
    
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
    occupied_hours_count = occupied_illuminance.shape[0]
    if occupied_hours_count == 0:
        print("Error: the occupancy schedule contains no occupied hours; metrics cannot be computed.")
        return
    fraction_of_time_above_threshold = hours_above_threshold / occupied_hours_count
    points_meeting_da_criteria = fraction_of_time_above_threshold >= percent_time_threshold_da
    sDA = np.sum(points_meeting_da_criteria) / num_points * 100

    # 2. Useful Daylight Illuminance (UDI)
    udi_f = np.mean(occupied_illuminance < 100, axis=0) * 100
    udi_s = np.mean((occupied_illuminance >= 100) & (occupied_illuminance < 500), axis=0) * 100
    udi_a = np.mean((occupied_illuminance >= 500) & (occupied_illuminance < 2000), axis=0) * 100
    udi_e = np.mean(occupied_illuminance >= 2000, axis=0) * 100

    # 3. Annual Sunlight Exposure (ASE 1000,250)
    # LM-83 defines ASE on DIRECT SUNLIGHT ONLY, with shading retracted. Computing
    # it from the total illuminance used for sDA counts interreflected light too,
    # which can only raise the hour count, so ASE comes out biased high. ASE is
    # therefore reported only when a direct-only .ill is supplied.
    lux_threshold_ase = 1000
    hours_threshold_ase = 250
    ASE = None
    if direct_illuminance is not None:
        occupied_direct = direct_illuminance[occupied_mask, :]
        hours_above_threshold_ase = np.sum(occupied_direct >= lux_threshold_ase, axis=0)
        points_meeting_ase_criteria = hours_above_threshold_ase >= hours_threshold_ase
        ASE = np.sum(points_meeting_ase_criteria) / num_points * 100
    else:
        print("ASE not reported: no direct-only illuminance file was supplied "
              "(--direct-ill). LM-83 requires direct sunlight only; deriving it "
              "from the total illuminance would overestimate ASE.")
    
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
        'ASE_1000_250h': [f"{ASE:.2f}%" if ASE is not None else "not reported (no direct-only input)"],
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
    parser.add_argument("--direct-ill", type=str, default=None, dest="direct_ill",
                        help="Direct-only .ill file. Required to report ASE: LM-83 defines it on direct sunlight alone.")
    args = parser.parse_args()

    if not os.path.exists(args.illuminance_file):
        print(f"Error: Input file not found at {args.illuminance_file}")
    else:
        calculate_metrics(args.illuminance_file, args.outdir, args.points, args.schedule, args.direct_ill)
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
    const lightDefs = generateLightSourceDefinitions(projectData.lighting, projectData.geometry.room, projectData.simulationFiles);

    const scheduleFlag = scheduleFile ? `-sf ../10_schedules/${scheduleFile}` : '';

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
    cat "\${MAT_FILE}"
    cat "\${GEOM_FILE}"
    echo
    echo "${lightDefs}"
    ) | oconv - > "\${OCTREE}"
    if [ \$? -ne 0 ]; then echo "Error during oconv."; exit 1; fi

    # 2. Generate Annual Sky Matrix (S)
    echo "2. Generating annual sky matrix from EPW..."
    SKY_MTX="\${MATRIX_DIR}/\${PROJECT_NAME}_sky.mtx"
    epw2wea "\${WEATHER_FILE}" | gendaymtx -m 1 > "\${SKY_MTX}"
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
    dcglare ${scheduleFlag} "\${DC_DIRECT_MTX}" "\${DC_TOTAL_MTX}" "\${SKY_MTX}" > "\${DGP_RESULTS}"
    if [ \$? -ne 0 ]; then echo "Error during dcglare for DGP."; exit 1; fi

    # 6. Calculate Glare Autonomy (GA)
    echo "6. Calculating Glare Autonomy (GA) for a threshold of \${DGP_THRESHOLD}..."
    GA_RESULTS="\${RESULTS_DIR}/\${PROJECT_NAME}.ga"
    dcglare -l \${DGP_THRESHOLD} ${scheduleFlag} "\${DC_DIRECT_MTX}" "\${DC_TOTAL_MTX}" "\${SKY_MTX}" > "\${GA_RESULTS}"
    if [ \$? -ne 0 ]; then echo "Error during dcglare for GA."; exit 1; fi

    # 7. Calculate Spatial Glare Autonomy (sGA)
    echo "7. Calculating spatial Glare Autonomy (sGA) for a target of \${SGA_TARGET}..."
    SGA_RESULTS="\${RESULTS_DIR}/\${PROJECT_NAME}_sGA.txt"
    awk -v t=\${SGA_TARGET} 'BEGIN{n=0;c=0} {n++; if ($1+0 >= t) c++} END{ if (n>0) printf "%.2f\\n", 100*c/n; else print "0" }' "\${GA_RESULTS}" > "\${SGA_RESULTS}"

    SGA_VALUE=\$(cat "\${SGA_RESULTS}")
    echo "---"
    echo "Analysis Complete."
    echo "Annual DGP time-series saved to: \${DGP_RESULTS}"
    echo "Glare Autonomy per view saved to: \${GA_RESULTS}"
    echo "---"
    echo "Final Spatial Glare Autonomy (sGA): \${SGA_VALUE}%"
    echo "---"
`;

    const batScheduleFlag = scheduleFile ? `-sf ..\\10_schedules\\${scheduleFile}` : '';
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
    set "MAT_FILE=..\\02_materials\\%PROJECT_NAME%_materials.rad"
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
        type "%MAT_FILE%"
        echo.
        type "%GEOM_FILE%"
        echo.
        (
    ${lightDefs.split('\n').map(line => line.trim() === '' ? '        echo.' : `        echo ${line}`).join('\n')}
        )
    ) > "%TEMP_RAD_FILE%"

    oconv "%TEMP_RAD_FILE%" > "%OCTREE%"
    if %errorlevel% neq 0 ( echo "Error during oconv." & del "%TEMP_RAD_FILE%" & exit /b 1 )
    del "%TEMP_RAD_FILE%"

    REM 2. Generate Annual Sky Matrix (S)
    echo 2. Generating annual sky matrix from EPW...
    set "SKY_MTX=%MATRIX_DIR%\\%PROJECT_NAME%_sky.mtx"
    (epw2wea "%WEATHER_FILE%") | gendaymtx -m 1 > "%SKY_MTX%"
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
    dcglare ${batScheduleFlag} "%DC_DIRECT_MTX%" "%DC_TOTAL_MTX%" "%SKY_MTX%" > "%DGP_RESULTS%"
    if %errorlevel% neq 0 ( echo "Error during dcglare for DGP." & exit /b 1 )

    REM 6. Calculate Glare Autonomy (GA)
    echo 6. Calculating Glare Autonomy (GA) for a threshold of %DGP_THRESHOLD%...
    set "GA_RESULTS=%RESULTS_DIR%\\%PROJECT_NAME%.ga"
    dcglare -l %DGP_THRESHOLD% ${batScheduleFlag} "%DC_DIRECT_MTX%" "%DC_TOTAL_MTX%" "%SKY_MTX%" > "%GA_RESULTS%"
    if %errorlevel% neq 0 ( echo "Error during dcglare for GA." & exit /b 1 )

    REM 7. Calculate Spatial Glare Autonomy (sGA)
    echo 7. Calculating spatial Glare Autonomy (sGA) for a target of %SGA_TARGET%...
    set "SGA_RESULTS=%RESULTS_DIR%\\%PROJECT_NAME%_sGA.txt"
    REM Two-step spatial aggregation: count passing points, count total points, then take the ratio.
    REM Radiance's if(a,b,c) picks b only when a is strictly greater than zero, so
    REM if($1-target,1,0) would be a ">" test while the .sh awk uses ">=". Inverting the
    REM operands - if(target-$1, 0, 1) - makes the batch test ">=" as well, so both
    REM scripts count a view that exactly meets the target as passing.
    (rcalc -e "$1=if(%SGA_TARGET%-$1,0,1)" "%GA_RESULTS%") | total > "%RESULTS_DIR%\\_sga_pass.txt"
    set /p SGA_PASS=<"%RESULTS_DIR%\\_sga_pass.txt"
    (rcalc -e "$1=1" "%GA_RESULTS%") | total > "%RESULTS_DIR%\\_sga_count.txt"
    set /p SGA_NPTS=<"%RESULTS_DIR%\\_sga_count.txt"
    rcalc -n -e "$1=100*%SGA_PASS%/%SGA_NPTS%" > "%SGA_RESULTS%"

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
    const blindsTrigger = (p['blinds-trigger-percent'] != null ? p['blinds-trigger-percent'] / 100 : 0.02);

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

def _load_radiance_matrix(path, num_points):
    """Reads a matrix written by dctimestep or rmtxop into (hours, points, comp).

    Two things make a plain np.fromfile wrong here. The file carries an ASCII
    header before the payload, so reading the whole file as float32 turns the
    header bytes into bogus samples and shifts every later index. And the header
    says NROWS is the SENSOR count while NCOLS is the number of timesteps, so the
    payload is point-major; reshaping it as (8760, num_points, 3) transposes the
    result and silently scrambles every annual metric computed from it.
    """
    rows = cols = 0
    ncomp = 3
    # A file with no Radiance header is one this script wrote itself, and those are
    # raw float32. Defaulting to 'ascii' here made the recombined .ill unreadable.
    fmt = 'float'
    with open(path, 'rb') as f:
        if f.read(10) == b'#?RADIANCE':
            fmt = 'ascii'
            f.seek(0)
            while True:
                line = f.readline()
                if not line or not line.strip():
                    break
                text = line.decode('ascii', 'replace').strip()
                if text.startswith('NROWS='):
                    rows = int(text.split('=', 1)[1])
                elif text.startswith('NCOLS='):
                    cols = int(text.split('=', 1)[1])
                elif text.startswith('NCOMP='):
                    ncomp = int(text.split('=', 1)[1])
                elif text.startswith('FORMAT='):
                    fmt = text.split('=', 1)[1].strip()
        else:
            f.seek(0)
        payload = f.read()
    if 'double' in fmt:
        data = np.frombuffer(payload, dtype=np.float64)
    elif 'float' in fmt:
        data = np.frombuffer(payload, dtype=np.float32)
    else:
        data = np.array(payload.split(), dtype=np.float64)
    if not rows:
        # A headerless file: the recombination step writes raw point-major floats.
        rows, ncomp = num_points, 3
        cols = data.size // max(rows * ncomp, 1)
    data = data[:rows * cols * ncomp].reshape(rows, cols, ncomp)
    return np.swapaxes(data, 0, 1)


def read_ill_file(file_path, num_points):
    """Reads a binary .ill file and converts to photopic illuminance."""
    try:
        rgb_illuminance = _load_radiance_matrix(file_path, num_points)
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

    # Seeking by byte offset assumed a headerless, hour-major file. dctimestep writes
    # neither: it puts an ASCII header first, and its payload is point-major
    # (NROWS = sensors, NCOLS = timesteps). Load both matrices through the shared
    # reader, pick per hour with the schedule, and write the result back headerless
    # and point-major so _load_radiance_matrix reads it correctly.
    ill_open = _load_radiance_matrix(open_ill_file, num_points)      # (hours, points, 3)
    ill_closed = _load_radiance_matrix(closed_ill_file, num_points)

    hours = min(len(schedule), ill_open.shape[0], ill_closed.shape[0])
    closed = np.asarray(schedule[:hours], dtype=bool)[:, None, None]
    combined = np.where(closed, ill_closed[:hours], ill_open[:hours])

    # (hours, points, 3) -> (points, hours, 3), the order dctimestep would have written.
    np.swapaxes(combined, 0, 1).astype(np.float32).tofile(output_file)

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
    PROJECT_NAME="${projectName}"
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
    # The Reinhart subdivision MUST match the one the view and daylight matrices were
    # built with (ANNUAL_SKY_MF in the 3-phase recipe), or dctimestep is asked to
    # multiply a 146-bin sky against a 2306-bin daylight matrix.
    epw2wea "\${WEATHER_FILE}" | gendaymtx -m ${ANNUAL_SKY_MF} > "\${SKY_MTX}"
    epw2wea "\${WEATHER_FILE}" | gendaymtx -m ${ANNUAL_SKY_MF} -d > "\${SKY_DIRECT_MTX}"

    # 2. Run dctimestep for ASE (Direct Sun Only)
    echo "2. Calculating direct-only illuminance for ASE and blind schedule..."
    ILL_DIRECT_ONLY="\${RESULTS_DIR}/\${PROJECT_NAME}_ASE_direct_only.ill"
    dctimestep -of "\${MATRIX_DIR}/view.mtx" "\${BSDF_OPEN}" "\${MATRIX_DIR}/daylight.mtx" "\${SKY_DIRECT_MTX}" > "\${ILL_DIRECT_ONLY}"
    echo "-> ASE results file created: \${ILL_DIRECT_ONLY}"

    # 3. Generate Blind Schedule with Python script
    echo "3. Generating hourly blind operation schedule..."
    python3 "\${PYTHON_SCRIPT}" --generate-schedule --direct-ill "\${ILL_DIRECT_ONLY}" --num-points "\${NUM_POINTS}" --threshold "\${BLINDS_THRESHOLD}" --trigger "\${BLINDS_TRIGGER}"

    # 4. Run dctimestep for Blinds OPEN state (Full Sky)
    echo "4. Calculating annual illuminance with blinds OPEN..."
    ILL_OPEN="\${RESULTS_DIR}/results_open.ill"
    dctimestep -of "\${MATRIX_DIR}/view.mtx" "\${BSDF_OPEN}" "\${MATRIX_DIR}/daylight.mtx" "\${SKY_MTX}" > "\${ILL_OPEN}"

    # 5. Run dctimestep for Blinds CLOSED state (Full Sky)
    echo "5. Calculating annual illuminance with blinds CLOSED..."
    ILL_CLOSED="\${RESULTS_DIR}/results_closed.ill"
    dctimestep -of "\${MATRIX_DIR}/view.mtx" "\${BSDF_CLOSED}" "\${MATRIX_DIR}/daylight.mtx" "\${SKY_MTX}" > "\${ILL_CLOSED}"

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
    // Standard meridian (west-positive) for gendaylit, matching the other generators.
    const lat = pi.latitude || 0;
    const lon = pi.longitude || 0;
    const mer = Math.round(lon / 15) * 15 * -1;

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
        # EPW column 13 (0-based) is Global Horizontal Radiation, not the diffuse component.
        global_horizontal_irradiance = epw_data[13]
        daylight_hours_indices = global_horizontal_irradiance.nlargest(4380).index

        # Read Radiance .ill file
        rgb_illuminance = _load_radiance_matrix(illuminance_file, num_points)
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
        # delim_whitespace was removed in pandas 3.0; sep='\\s+' is the supported spelling.
        dgp_data = pd.read_csv(dgp_file, header=None, sep=r'\\s+')
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
        if total_occupied_hours == 0:
            print("Error: no occupied hours in the schedule; glare percentages cannot be computed.")
            return

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

    # This script invokes the other generated RUN_*.sh scripts directly. They are written
    # without the executable bit (make_executable.sh normally sets it, and it may not have
    # been run), so make sure they can be executed before calling them.
    for helper in ./RUN_*.sh; do
        [ -f "\$helper" ] && [ ! -x "\$helper" ] && chmod +x "\$helper"
    done

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
            sun_info=$(gendaylit ${monthStr} ${dayStr} \${hour} -a ${lat} -o ${-lon} -m ${mer} -O 1)
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
        # -vf replaces every view setting parsed before it, so the projection and the
        # 180x180 field of view must be restated after the view file, not before.
        rpict -vf ../03_views/viewpoint.vf -vta -vh 180 -vv 180 -x 1024 -y 1024 \\
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

        # Redefine the scene's own material NAMES rather than rewriting the geometry.
        # Radiance resolves a surface's modifier by name from whatever is in the octree, so
        # feeding oconv this file INSTEAD of the real materials makes the glazing emit and
        # every other surface absorb, with the geometry untouched.
        #
        # (The previous version called "replmarks -m old=new". replmarks is a marker-
        # replacement tool for inserting objects at marker positions -- it has no such
        # syntax and no material-substitution mode, so this step always failed.)
        cat > "\${MODIFIED_MATS_VF}" << EOF
    void light glass_mat
    0
    0
    3 1 1 1

    void plastic wall_mat
    0
    0
    5 0 0 0 0 0

    void alias floor_mat wall_mat
    void alias ceiling_mat wall_mat
    void alias frame_mat wall_mat
    void alias shading_mat wall_mat
    void alias furniture_mat wall_mat
    void alias context_mat wall_mat
    void alias ground_mat wall_mat
    void alias vegetation_mat wall_mat
EOF

        # 2. Create the octree for the modified scene
        echo "2. Creating analysis octree..."
        OCTREE_VF="\${OCT_DIR}/${projectName}_vf.oct"
        oconv "\${MODIFIED_MATS_VF}" "../01_geometry/${projectName}.rad" > "\${OCTREE_VF}"

        # 3. Calculate the View Factor using rtrace
        echo "3. Calculating numerical view factor..."
        VIEW_FACTOR_FILE="\${RESULTS_DIR}/${projectName}_view_factor.txt"
        
        # Generate rays from the viewpoint, trace them, and average the results.
        # The average is the view factor because window hits = 1 and other hits = 0.
        #
        # vwrays is the tool that turns a view file into rays. The previous version used
        # "cnt 5000 | rcalc ... | xform -vf ...", which emitted three
        # numbers per line where rtrace needs six (origin + direction), and passed -vf to
        # xform, which has no such option. Both failed, leaving the file empty.
        #
        # The angular fisheye view (-vta) is used so each pixel subtends an equal solid
        # angle, which is what makes a plain average a solid-angle fraction. Note this is
        # an unweighted hemisphere fraction, not a cosine-weighted radiative view factor.
        # Rays are classified by the MODIFIER they hit (-om) rather than by radiance (-ov).
        # A directly-hit "light" surface returns 0 through -ov under -ab 0, so the radiance
        # form silently reported a 0% view factor for every scene. Counting modifier hits
        # is also exactly the definition of the metric.
        vwrays -fa -vf ../03_views/viewpoint_fisheye.vf -x 200 -y 200 \\
        | rtrace -h -w -om -ab 0 "\${OCTREE_VF}" \\
        | awk '{ n++; if ($1 == "glass_mat") hits++ } END { printf "%.3f\\n", (n ? 100*hits/n : 0) }' \\
        > "\${VIEW_FACTOR_FILE}"

        VIEW_FACTOR_PERCENTAGE=$(cat "\${VIEW_FACTOR_FILE}")
        
        # 4. Generate a visualization image
        echo "4. Generating fisheye visualization..."
        VIZ_IMAGE="\${IMG_DIR}/${projectName}_view_factor_viz.hdr"
        # -vf first, then the projection and field of view it would otherwise overwrite.
        rpict -vf ../03_views/viewpoint_fisheye.vf -vta -vh 180 -vv 180 -ab 0 "\${OCTREE_VF}" > "\${VIZ_IMAGE}"
        
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

    const lightDefs = generateLightSourceDefinitions(projectData.lighting, projectData.geometry.room, projectData.simulationFiles);

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
        cat "\${MAT_FILE}"
        cat "\${GEOM_FILE}"
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
        E_avg=$(total -m < "\${RESULTS_DIR}/task_results_lux.txt")
        E_min=$(total -l < "\${RESULTS_DIR}/task_results_lux.txt")
        U0=$(awk -v a="\$E_avg" -v m="\$E_min" 'BEGIN{ if (a+0 > 0) printf "%.4f", m/a; else print "0" }')
        echo "Average Illuminance (Em): \${E_avg} lux"
        echo "Minimum Illuminance (Emin): \${E_min} lux"
        echo "Uniformity (U0 = Emin/Em): \${U0}"
        echo ""
        echo "--- SURROUNDING AREA RESULTS ---"
        E_avg=$(total -m < "\${RESULTS_DIR}/surround_results_lux.txt")
        E_min=$(total -l < "\${RESULTS_DIR}/surround_results_lux.txt")
        U0=$(awk -v a="\$E_avg" -v m="\$E_min" 'BEGIN{ if (a+0 > 0) printf "%.4f", m/a; else print "0" }')
        echo "Average Illuminance (Em): \${E_avg} lux"
        echo "Minimum Illuminance (Emin): \${E_min} lux"
        echo "Uniformity (U0 = Emin/Em): \${U0}"
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

    const lightDefs = generateLightSourceDefinitions(projectData.lighting, projectData.geometry.room, projectData.simulationFiles);

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
        cat "\${MAT_FILE}"
        cat "\${GEOM_FILE}"
        echo
        echo "${lightDefs}"
        # Note: Include a sky file here if daylight is part of the scenario
        # cat "\${SKY_FILE}"
    ) | oconv - > "\${OCTREE}"

    # 2. Render 180-degree fisheye HDR image
    echo "2. Rendering fisheye image for observer..."
    HDR_IMAGE="\${IMG_DIR}/\${PROJECT_NAME}_ugr_view.hdr"
    # -vf must come FIRST: a view file replaces every view setting parsed before it, so
    # the projection and 180x180 field of view have to be restated after it or they are
    # silently discarded. viewpoint_fisheye.vf is written as -vth, so -vth is what the
    # image is rendered with and what evalglare later reads out of the image header.
    rpict -vf "\${VIEW_FILE}" -vth -vh 180 -vv 180 -x 2048 -y 2048 \\
        -ab \${AB} -ad \${AD} -as \${AS} -ar \${AR} -aa \${AA} -lw \${LW} \\
        "\${OCTREE}" > "\${HDR_IMAGE}"

    # 3. Calculate UGR with evalglare
    echo "3. Calculating UGR with evalglare..."
    GLARE_REPORT="\${RESULTS_DIR}/EN12464_UGR_Report.txt"
    # No -vt* override here: evalglare rejects a partial view ("a view must at least
    # contain -vt -vv and -vh") and takes the complete view from the image header anyway.
    # -d is required for the detailed report appended below.
    evalglare -d "\${HDR_IMAGE}" > "\${GLARE_REPORT}"

    # 4. Generate Summary Report
    echo "4. Generating summary report..."
    SUMMARY_FILE="\${RESULTS_DIR}/EN12464_UGR_Summary.txt"
    # evalglare never prints "UGR =". It prints one comma-separated list of metric names,
    # a colon, then the values on the same line. Locate "ugr" by name so the column index
    # does not have to be hard-coded (it differs between the plain and -d output).
    UGR_VALUE=$(awk -F: '/^dgp,/ { n = split($1, names, ","); split($2, vals, " "); for (i = 1; i <= n; i++) if (names[i] == "ugr") { print vals[i]; exit } }' "\${GLARE_REPORT}")
    if [ -z "\${UGR_VALUE}" ]; then
        echo "ERROR: could not read a UGR value out of \${GLARE_REPORT}." >&2
        exit 1
    fi

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
    const blindsTrigger = (p['blinds-trigger-percent'] != null ? p['blinds-trigger-percent'] / 100 : 0.02);

    // Get lighting control and power info. `projectData.lighting` is null whenever no
    // artificial lighting is enabled, which is a supported project state, so every read
    // below has to tolerate a missing object rather than throwing during generation.
    const lightingData = lighting || {};
    const dc = lightingData.daylighting || {};
    const luminaire_wattage = lightingData.luminaire_wattage || 0;
    let numLuminaires = 1;
    if (lightingData.placement === 'grid' && lightingData.grid) {
        numLuminaires = (lightingData.grid.rows || 1) * (lightingData.grid.cols || 1);
    }
    const totalInstalledPower = luminaire_wattage * numLuminaires;
    const controlType = dc.controlType || 'Continuous';
    const setpoint = dc.setpoint != null ? dc.setpoint : 500;
    const minPowerFraction = dc.minPowerFraction != null ? dc.minPowerFraction : 0.1;
    const minLightFraction = dc.minLightFraction != null ? dc.minLightFraction : 0.1;
    const nSteps = dc.nSteps != null ? dc.nSteps : 3;
    const roomArea = geometry.room.W * geometry.room.L;


    const pythonScriptContent = `import numpy as np
import argparse
import os
import pandas as pd

def _load_radiance_matrix(path, num_points):
    """Reads a matrix written by dctimestep or rmtxop into (hours, points, comp).

    Two things make a plain np.fromfile wrong here. The file carries an ASCII
    header before the payload, so reading the whole file as float32 turns the
    header bytes into bogus samples and shifts every later index. And the header
    says NROWS is the SENSOR count while NCOLS is the number of timesteps, so the
    payload is point-major; reshaping it as (8760, num_points, 3) transposes the
    result and silently scrambles every annual metric computed from it.
    """
    rows = cols = 0
    ncomp = 3
    # A file with no Radiance header is one this script wrote itself, and those are
    # raw float32. Defaulting to 'ascii' here made the recombined .ill unreadable.
    fmt = 'float'
    with open(path, 'rb') as f:
        if f.read(10) == b'#?RADIANCE':
            fmt = 'ascii'
            f.seek(0)
            while True:
                line = f.readline()
                if not line or not line.strip():
                    break
                text = line.decode('ascii', 'replace').strip()
                if text.startswith('NROWS='):
                    rows = int(text.split('=', 1)[1])
                elif text.startswith('NCOLS='):
                    cols = int(text.split('=', 1)[1])
                elif text.startswith('NCOMP='):
                    ncomp = int(text.split('=', 1)[1])
                elif text.startswith('FORMAT='):
                    fmt = text.split('=', 1)[1].strip()
        else:
            f.seek(0)
        payload = f.read()
    if 'double' in fmt:
        data = np.frombuffer(payload, dtype=np.float64)
    elif 'float' in fmt:
        data = np.frombuffer(payload, dtype=np.float32)
    else:
        data = np.array(payload.split(), dtype=np.float64)
    if not rows:
        # A headerless file: the recombination step writes raw point-major floats.
        rows, ncomp = num_points, 3
        cols = data.size // max(rows * ncomp, 1)
    data = data[:rows * cols * ncomp].reshape(rows, cols, ncomp)
    return np.swapaxes(data, 0, 1)


def read_ill_file(file_path, num_points):
    """Reads a binary .ill file and converts to photopic illuminance."""
    try:
        rgb = _load_radiance_matrix(file_path, num_points)
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

    # Seeking by byte offset assumed a headerless, hour-major file. dctimestep writes
    # an ASCII header first, and its payload is point-major (NROWS = sensors,
    # NCOLS = timesteps), so the old offsets read the wrong record every time.
    ill_open = _load_radiance_matrix(open_ill_file, num_points)      # (hours, points, 3)
    ill_closed = _load_radiance_matrix(closed_ill_file, num_points)

    hours = min(len(schedule), ill_open.shape[0], ill_closed.shape[0])
    closed = np.asarray(schedule[:hours], dtype=bool)[:, None, None]
    combined = np.where(closed, ill_closed[:hours], ill_open[:hours])

    # (hours, points, 3) -> (points, hours, 3), the order dctimestep would have written.
    np.swapaxes(combined, 0, 1).astype(np.float32).tofile(output_file)
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
    CONTROL_TYPE=${controlType}
    SETPOINT=${setpoint}
    MIN_POWER_FRAC=${minPowerFraction}
    MIN_LIGHT_FRAC=${minLightFraction}
    N_STEPS=${nSteps}

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
    # The Reinhart subdivision MUST match the one the view and daylight matrices were
    # built with (ANNUAL_SKY_MF in the 3-phase recipe), or dctimestep is asked to
    # multiply a 146-bin sky against a 2306-bin daylight matrix.
    epw2wea "\${WEATHER_FILE}" | gendaymtx -m ${ANNUAL_SKY_MF} > "\${SKY_MTX}"
    epw2wea "\${WEATHER_FILE}" | gendaymtx -m ${ANNUAL_SKY_MF} -d > "\${SKY_DIRECT_MTX}"

    # 2. Calculate direct illuminance for blind schedule
    echo "2. Calculating direct-only illuminance for blind schedule..."
    ILL_DIRECT="\${RESULTS_DIR}/results_direct.ill"
    dctimestep -of "\${MATRIX_DIR}/view.mtx" "\${BSDF_OPEN}" "\${MATRIX_DIR}/daylight.mtx" "\${SKY_DIRECT_MTX}" > "\${ILL_DIRECT}"

    # 3. Generate Blind Schedule
    echo "3. Generating hourly blind operation schedule..."
    python3 "\${PYTHON_SCRIPT}" generate_schedule --direct-ill "\${ILL_DIRECT}" --num-points "\${NUM_POINTS}" --threshold "\${BLINDS_THRESHOLD}" --trigger "\${BLINDS_TRIGGER}" --outdir "\${RESULTS_DIR}"

    # 4. Calculate annual illuminance for blinds OPEN and CLOSED
    echo "4. Calculating annual illuminance for both blind states..."
    ILL_OPEN="\${RESULTS_DIR}/results_open.ill"
    ILL_CLOSED="\${RESULTS_DIR}/results_closed.ill"
    dctimestep -of "\${MATRIX_DIR}/view.mtx" "\${BSDF_OPEN}" "\${MATRIX_DIR}/daylight.mtx" "\${SKY_MTX}" > "\${ILL_OPEN}"
    dctimestep -of "\${MATRIX_DIR}/view.mtx" "\${BSDF_CLOSED}" "\${MATRIX_DIR}/daylight.mtx" "\${SKY_MTX}" > "\${ILL_CLOSED}"

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
    const { projectInfo: pi, mergedSimParams: p } = projectData;
    const projectName = pi['project-name'].replace(/\s+/g, '_') || 'scene';
    const epwFileName = p['weather-file']?.name || 'weather.epw';

    const ab = p['ab'] || 5;
    const ad = p['ad'] || 2048;
    const as = p['as'] || 1024;
    const ar = p['ar'] || 512;
    const aa = p['aa'] || 0.15;
    const lw = p['lw'] || 0.005;
    // Irradiation totals are not sensitive to sky resolution the way a direct-sun metric
    // is, so this path stays on MF:1. What matters is that gendaymtx -m and the rcontrib
    // Reinhart binning agree.
    const SKY_MF = 1;
    const SKY_NRBINS = _reinhartNrbins(SKY_MF);

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
    # -O1 makes gendaymtx report TOTAL SOLAR radiance instead of the visible band, which
    # is what an irradiation study needs. MF stays at 1 (146 Reinhart bins): the sky
    # subdivision only has to match the rcontrib binning below, and a facade irradiation
    # total is not sensitive to a finer sky the way a direct-sun metric is.
    echo "1. Generating annual sky matrix..."
    SKY_MTX="\${MATRIX_DIR}/sky.smx"
    epw2wea "\${WEATHER_FILE}" | gendaymtx -m ${SKY_MF} -O1 > "\${SKY_MTX}"

    # 2. Create Scene Octree (includes room, shading, context)
    echo "2. Creating scene octree..."
    OCTREE="\${OCT_DIR}/\${PROJECT_NAME}.oct"
    oconv "\${MAT_FILE}" "\${GEOM_FILE}" > "\${OCTREE}"

    # 3. Calculate Daylight Coefficients for the facade grid
    # reinhart.cal needs MF defined before it is loaded, and Nrbins for MF:1 is 146
    # (145 sky patches plus the ground bin 0), not 145.
    echo "3. Calculating daylight coefficients (rcontrib)..."
    FACADE_DCMTX="\${MATRIX_DIR}/facade_dc.mtx"
    rcontrib -I+ -w -ab \${AB} -ad \${AD} -as \${AS} -ar \${AR} -aa \${AA} -lw \${LW} \\
        -e MF:${SKY_MF} -f reinhart.cal -b rbin -bn ${SKY_NRBINS} -m sky_glow \\
        "\${OCTREE}" < "\${POINTS_FILE}" > "\${FACADE_DCMTX}"

    # 4. Calculate hourly irradiance for the year
    # -of writes a binary float matrix; without it dctimestep emits ASCII that the
    # downstream reduction cannot read as floats. The result is one ROW per sensor point
    # and one COLUMN per hour. The three channels are AVERAGED, not summed: with -O1 each
    # channel already carries the full broadband value, so R+G+B triples the irradiance.
    echo "4. Calculating hourly irradiance (dctimestep)..."
    HOURLY_IRRAD="\${RESULTS_DIR}/facade_hourly_W.ill"
    dctimestep -of "\${FACADE_DCMTX}" "\${SKY_MTX}" \\
        | rmtxop -fa -c 0.333333 0.333333 0.333333 - > "\${HOURLY_IRRAD}"

    # 5. Sum hourly results to get annual total in kWh/m^2
    # Transpose so each column is a sensor point, sum the 8760 hourly W/m^2 values down
    # each column (1 h per step, so the sum is Wh/m^2), then divide by 1000 for kWh/m^2.
    echo "5. Summing annual results..."
    ANNUAL_IRRAD="\${RESULTS_DIR}/facade_annual_kWh.txt"
    rcollate -ho -t "\${HOURLY_IRRAD}" | total \\
        | awk '{ for (i = 1; i <= NF; i++) printf "%.4f\\n", $i / 1000 }' > "\${ANNUAL_IRRAD}"

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
}

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
        // Irradiation totals are insensitive to sky resolution, so this path stays on
        // MF:1. gendaymtx -m and the rcontrib Reinhart binning must agree.
        const SKY_MF = 1;
        const SKY_NRBINS = _reinhartNrbins(SKY_MF);
        const lightDefs = generateLightSourceDefinitions(projectData.lighting, projectData.geometry.room, projectData.simulationFiles);

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
    cat "\${MAT_FILE}"
    cat "\${GEOM_FILE}"
    echo
    echo "${lightDefs}"
    ) | oconv - > "\${OCTREE}"
    if [ \$? -ne 0 ]; then echo "Error creating master octree."; exit 1; fi

    # 2. Generate Annual Sky Matrix (S)
    # -O1 asks gendaymtx for TOTAL SOLAR radiance rather than the visible band; without it
    # a "solar radiation" result is really a photopic one. MF stays at 1 here (an annual
    # irradiation total is insensitive to sky resolution), but it must match the rcontrib
    # Reinhart binning in step 3.
    echo "2. Generating annual sky matrix from EPW..."
    SKY_MTX="\${MATRIX_DIR}/sky.smx"
    epw2wea "\${WEATHER_FILE}" | gendaymtx -m ${SKY_MF} -O1 > "\${SKY_MTX}"
    if [ \$? -ne 0 ]; then echo "Error generating Sky Matrix."; exit 1; fi

    # 3. Generate Daylight Coefficients for Irradiance (DC)
    # reinhart.cal needs MF defined before it is loaded, and Nrbins for MF:1 is 146
    # (145 sky patches plus the ground bin 0), not 145.
    echo "3. Generating Daylight Coefficients (-I+)..."
    DC_MTX="\${MATRIX_DIR}/dc_irradiance.mtx"
    rcontrib -I+ -w -ab \${AB} -ad \${AD} -as \${AS} -ar \${AR} -aa \${AA} -lw \${LW} \\
        -e MF:${SKY_MF} -f reinhart.cal -b rbin -bn ${SKY_NRBINS} -m sky_glow \\
        "\${OCTREE}" < "\${POINTS_FILE}" > "\${DC_MTX}"
    if [ \$? -ne 0 ]; then echo "Error generating Daylight Coefficient Matrix."; exit 1; fi

    # 4. Calculate hourly solar irradiance for the year
    # -of writes a binary float matrix (one ROW per sensor point, one COLUMN per hour);
    # the ASCII default cannot be read by the reduction below.
    echo "4. Calculating hourly solar irradiance (dctimestep)..."
    HOURLY_IRRAD_RGB="\${RESULTS_DIR}/hourly_solar_rgb.ill"
    dctimestep -of "\${DC_MTX}" "\${SKY_MTX}" > "\${HOURLY_IRRAD_RGB}"
    if [ \$? -ne 0 ]; then echo "Error during dctimestep."; exit 1; fi

    # 5. Reduce RGB to a single total-solar value per point-hour
    # The channels are AVERAGED, not summed: with gendaymtx -O1 every channel already
    # carries the full broadband value, so -c 1 1 1 reported three times the irradiance.
    echo "5. Averaging RGB channels to get total hourly irradiance..."
    HOURLY_IRRAD_TOTAL="\${RESULTS_DIR}/hourly_solar_total.txt"
    rmtxop -fa -c 0.333333 0.333333 0.333333 "\${HOURLY_IRRAD_RGB}" > "\${HOURLY_IRRAD_TOTAL}"
    if [ \$? -ne 0 ]; then echo "Error averaging RGB channels with rmtxop."; exit 1; fi

    # 6. Sum hourly results to get annual total in kWh/m^2
    # Transpose so each column is a sensor point, sum the 8760 hourly W/m^2 values down
    # each column (1 h per step, so the sum is Wh/m^2), then divide by 1000 for kWh/m^2.
    echo "6. Summing annual results and converting to kWh/m^2..."
    ANNUAL_KWH="\${RESULTS_DIR}/\${PROJECT_NAME}_annual_radiation.txt"
    rcollate -ho -t "\${HOURLY_IRRAD_TOTAL}" | total \\
        | awk '{ for (i = 1; i <= NF; i++) printf "%.4f\\n", $i / 1000 }' > "\${ANNUAL_KWH}"
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
