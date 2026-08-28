// scripts/parsingWorker.js


/**
 * Main entry point for the worker. Listens for messages from the main thread.
 */
self.onmessage = function(event) {
    const { content, fileName } = event.data;
    try {
        const isIllFile = fileName.toLowerCase().endsWith('.ill');
        let result;
        if (isIllFile) {
            result = _parseIllFileContent(content);
        } else {
            result = _parseFileContent(content, fileName);
        }
        // Send the successful result back to the main thread
        self.postMessage({ result: result });
    } catch (error) {
        // If an error occurs, send the error message back
        self.postMessage({ error: error.message });
    }
};

/**
* Parses the raw text content of a results file.
*/
function _parseFileContent(content, fileName = '') {
    const extension = fileName.split('.').pop().toLowerCase();
    // NOTE: `annualGlareResults` is deliberately NOT initialised here. An always-present
    // (but empty) object is truthy, which made the point-in-time evalglare descriptor in
    // ResultsRegistry never match. The key is only added when annual glare data exists.
    let results = { data: [], glareResult: null };

    if (extension === 'dgp' || extension === 'ga') {
    const parsedGlare = _parseAnnualGlareFile(content, extension);
    results.data = parsedGlare.data;
    results.annualGlareResults = parsedGlare.annualGlareResults;
    } else if (fileName.toLowerCase().endsWith('circadian_summary.json')) {
        results.circadianMetrics = JSON.parse(content);
        results.data = []; // No grid data from summary file
    } else if (fileName.toLowerCase().endsWith('circadian_per_point.csv')) {
        results.perPointCircadianData = _parseCircadianCsv(content);
        // Default the main "data" view to the photopic lux column
        if (results.perPointCircadianData.Photopic_lux) {
            results.data = results.perPointCircadianData.Photopic_lux;
        }
    } else {
        const glareResult = _parseEvalglareContent(content);
        if (glareResult) {
            results.glareResult = glareResult;
            results.data = []; // No grid data for point-in-time glare
        } else {
            results.data = _parseNumericGrid(content);

            if (results.data.length === 0) {
                throw new Error("No valid numerical data found. File is not a recognized glare report or illuminance file.");
            }
        }
    }
    return results;
}

/**
 * Parses a whitespace-delimited numeric results grid (rtrace / rcalc output).
 *
 * Accepts either one value per line (already-reduced illuminance) or three values
 * per line (raw RGB radiance), which are converted to photopic illuminance. A raw
 * three-column file used to be silently truncated to its red channel by
 * `parseFloat("12.5 30.2 40.1")` and reported as lux.
 *
 * Unparseable rows are a hard error rather than being dropped: silently removing a
 * row shifts every subsequent sensor-grid index, so the grid would no longer line up
 * with the geometry.
 * @param {string} content Raw file text.
 * @returns {number[]} One scalar per sensor point.
 */
function _parseNumericGrid(content) {
    const lines = content.split(/\r?\n/);
    const values = [];
    let columns = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line === '' || line.startsWith('#')) continue; // Blank lines and Radiance comments

        const parts = line.split(/\s+/);
        if (columns === 0) {
            columns = parts.length;
            if (columns !== 1 && columns !== 3) {
                throw new Error(`Unsupported results file: line ${i + 1} has ${columns} columns. Expected 1 (illuminance) or 3 (RGB radiance).`);
            }
        } else if (parts.length !== columns) {
            throw new Error(`Inconsistent column count at line ${i + 1}: expected ${columns}, found ${parts.length}.`);
        }

        const nums = parts.map(Number);
        if (nums.some(v => !Number.isFinite(v))) {
            throw new Error(`Non-numeric data at line ${i + 1}: "${line}".`);
        }

        values.push(columns === 3
            ? 179 * (0.265 * nums[0] + 0.670 * nums[1] + 0.065 * nums[2])
            : nums[0]);
    }

    return values;
}

/**
 * Parses single-column annual glare files (.dgp, .ga).
 */
function _parseAnnualGlareFile(content, type) {
    const HOURS_IN_YEAR = 8760;
    const lines = content.split(/\r?\n/);
    const dataMatrix = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line === '' || line.startsWith('#')) continue; // Blank lines and Radiance comments
        const row = line.split(/\s+/).map(Number);
        if (row.some(v => !Number.isFinite(v))) {
            throw new Error(`File contains non-numeric data at line ${i + 1}.`);
        }
        dataMatrix.push(row);
    }

    if (dataMatrix.length === 0) {
        throw new Error('Annual glare file contains no data rows.');
    }

    const numPoints = dataMatrix[0].length;
    if (dataMatrix.some(row => row.length !== numPoints)) {
        throw new Error('Annual glare file rows do not all contain the same number of sensor points.');
    }

    // Consumers index this matrix over a full 8760-hour year. A short file must be
    // padded explicitly (0 = no glare) rather than left to read `undefined`, which
    // fails every threshold test and silently counts missing hours as "no glare".
    if (dataMatrix.length !== HOURS_IN_YEAR) {
        console.warn(`Annual glare file has ${dataMatrix.length} rows, not ${HOURS_IN_YEAR}. Missing hours are padded with 0; surplus hours are ignored.`);
    }

    const usableHours = Math.min(dataMatrix.length, HOURS_IN_YEAR);
    const transposedData = Array.from({ length: numPoints }, () => new Float32Array(HOURS_IN_YEAR));

    for (let h = 0; h < usableHours; h++) {
        for (let p = 0; p < numPoints; p++) {
            transposedData[p][h] = dataMatrix[h][p];
        }
    }

    // Average only over the hours actually present so the padding does not dilute it.
    const averageData = transposedData.map(pointData => {
        if (usableHours === 0) return 0;
        let sum = 0;
        for (let h = 0; h < usableHours; h++) sum += pointData[h];
        return sum / usableHours;
    });

    return { data: averageData, annualGlareResults: { [type]: transposedData } };
}

/**
 * Parses the text output from the 'evalglare' tool, extracting UGR or DGP values
 * and a list of individual glare sources.
 * @param {string} content The raw text content from an evalglare report.
 * @returns {object|boolean} A structured object with glare data, or false if not a recognized report.
 */
function _parseEvalglareContent(content) {
    const ugrLine = content.match(/^UGR\s*=\s*([0-9.]+)/im);
    const dgpLine = content.match(/Daylight Glare Probability\s*:\s*([0-9.]+)/im);
    // evalglare 5.x/6.x prints its summary as a single comma-separated key list
    // followed by whitespace-separated values, e.g.
    //   "dgp,dgi,ugr,vcp,cgi,Lveil: 0.175569 0.000000 ..."
    // (verified against Radiance 6.1a). Neither regex above matches that form, so a
    // real report yielded no glare result at all.
    const summary = _parseEvalglareSummaryLine(content);

    // Preferred source of the image size: the Radiance HDR resolution line
    // ("-Y <height> +X <width>"), which states the ACTUAL pixel dimensions.
    // `rpict -x N -y N` is only a fallback: those switches are maximum resolutions
    // in rpict, not the dimensions of the picture it actually wrote.
    const hdrResolutionLine = content.match(/^\s*([-+])Y\s+(\d+)\s+([-+])X\s+(\d+)\s*$/m);
    const rpictResolutionLine = content.match(/rpict.*-x\s+(\d+)\s+-y\s+(\d+)/);

    // If neither UGR nor DGP is found, it's not a report we can parse.
    if (!ugrLine && !dgpLine && !summary) {
        return false;
    }

    let imageWidth = null;
    let imageHeight = null;
    if (hdrResolutionLine) {
        imageHeight = parseInt(hdrResolutionLine[2], 10);
        imageWidth = parseInt(hdrResolutionLine[4], 10);
    } else if (rpictResolutionLine) {
        imageWidth = parseInt(rpictResolutionLine[1], 10);
        imageHeight = parseInt(rpictResolutionLine[2], 10);
    }

    const pick = (key) => (summary && Number.isFinite(summary[key]) ? summary[key] : null);

    const glareResult = {
        dgp: dgpLine ? parseFloat(dgpLine[1]) : pick('dgp'),
        ugr: ugrLine ? parseFloat(ugrLine[1]) : pick('ugr'),
        imageWidth,
        imageHeight,
        // True when the size above came from rpict's -x/-y maxima rather than the
        // HDR header, so consumers can prefer the loaded texture's real dimensions.
        imageSizeIsApproximate: !hdrResolutionLine && !!rpictResolutionLine,
        sources: []
    };

    // Find the start of the source list (this format is common to modern evalglare output for both metrics)
    const lines = content.split('\n');
    // Detailed evalglare prints the vertical-illuminance column as "E_vert"
    // (older/summary output uses "Ev"); accept either.
    const headerLineIndex = lines.findIndex(line =>
        line.trim().startsWith("Nr") && (line.includes("E_vert") || line.includes("Ev")));

    if (headerLineIndex === -1) {
        // Modern evalglare detailed output has no "Nr" header and no separator rule:
        //   "2 No pixels x-pos y-pos L_s Omega_s Posindx L_b L_t E_v Edir ..."
        //   "1 5419.000000 199.509703 199.934511 4370.679926 ..."
        // The header's first token is the SOURCE COUNT (which stands in for the Nr
        // column) and "No pixels" is one column spelled as two tokens, so a column's
        // data index is its header token index minus one.
        const modernIndex = lines.findIndex(line =>
            /^\s*\d+\s+No\s+pixels\s+x-pos\s+y-pos\s+L_s\b/.test(line));

        if (modernIndex !== -1) {
            const cols = lines[modernIndex].trim().split(/\s+/);
            const idxOf = (name) => cols.indexOf(name) - 1;
            const idxX = idxOf('x-pos');
            const idxY = idxOf('y-pos');
            const idxL = idxOf('L_s');
            const idxOmega = idxOf('Omega_s');
            const idxP = idxOf('Posindx');
            const idxLb = idxOf('L_b');
            const idxEv = idxOf('E_v');
            const minCols = Math.max(idxX, idxY, idxL, idxOmega, idxP, idxLb, idxEv);

            for (let i = modernIndex + 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (line === '') break;
                const parts = line.split(/\s+/);
                // The summary line follows the table; it is not a source row.
                if (parts.length <= minCols || !/^\d+$/.test(parts[0])) break;

                glareResult.sources.push({
                    nr: parseInt(parts[0], 10),
                    pos: { x: parseFloat(parts[idxX]), y: parseFloat(parts[idxY]) },
                    L: parseFloat(parts[idxL]),
                    omega: parseFloat(parts[idxOmega]),
                    p: parseFloat(parts[idxP]),
                    Ev: parseFloat(parts[idxEv]),
                    L_B: parseFloat(parts[idxLb]),
                });
            }
        }
    }

    if (headerLineIndex !== -1) {
        // Locate columns by name for robustness across evalglare versions.
        // Standard detailed order: Nr x y L_s Omega_s Posindx L_b L_t E_vert
        const headerCols = lines[headerLineIndex].trim().split(/\s+/);
        const colIndex = (names, fallback) => {
            for (const n of names) {
                const idx = headerCols.indexOf(n);
                if (idx !== -1) return idx;
            }
            return fallback;
        };
        const idxNr = colIndex(['Nr', 'Nr.', 'No', 'No.'], 0);
        const idxX = colIndex(['x', 'x-pos'], 1);
        const idxY = colIndex(['y', 'y-pos'], 2);
        const idxL = colIndex(['L_s'], 3);
        const idxOmega = colIndex(['Omega_s', 'Omega'], 4);
        const idxP = colIndex(['Posindx', 'Posidx', 'Pos_idx'], 5);
        const idxLb = colIndex(['L_b'], 6);
        const idxEv = colIndex(['E_vert', 'Ev'], 8);
        const minCols = Math.max(idxNr, idxX, idxY, idxL, idxOmega, idxP, idxLb, idxEv);

        const dataStartIndex = headerLineIndex + 2; // Skip the header and separator line '---...'

        for (let i = dataStartIndex; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line === '') break; // Stop at the end of the list

            const parts = line.split(/\s+/);
            if (parts.length <= minCols) continue;

            glareResult.sources.push({
                nr: parseInt(parts[idxNr]),
                pos: { x: parseFloat(parts[idxX]), y: parseFloat(parts[idxY]) },
                L: parseFloat(parts[idxL]),       // Source Luminance (L_s)
                omega: parseFloat(parts[idxOmega]),// Solid Angle (Omega_s)
                p: parseFloat(parts[idxP]),        // Guth Position Index
                Ev: parseFloat(parts[idxEv]),      // Vertical Illuminance (E_vert)
                L_B: parseFloat(parts[idxLb]),     // Background Luminance (L_b)
            });
        }
    }

    return glareResult;
}

/**
 * Parses evalglare's comma-separated summary line into a key -> number map.
 * The line has the shape "<k1>,<k2>,...,<kn>: <v1> <v2> ... <vn>".
 * @param {string} content
 * @returns {Object<string, number>|null}
 */
function _parseEvalglareSummaryLine(content) {
    const lines = content.split(/\r?\n/);
    for (const raw of lines) {
        const line = raw.trim();
        const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*(?:,[A-Za-z_][A-Za-z0-9_]*)+)\s*:\s*(.+)$/);
        if (!m) continue;

        const keys = m[1].split(',');
        if (!keys.includes('dgp')) continue;

        const values = m[2].trim().split(/\s+/).map(Number);
        if (values.length < keys.length || values.some(v => !Number.isFinite(v))) continue;

        const out = {};
        keys.forEach((k, i) => { out[k] = values[i]; });
        return out;
    }
    return null;
}

/**
 * Parses the raw binary content of an annual .ill results file.
 */
function _parseIllFileContent(arrayBuffer) {
    const HOURS_IN_YEAR = 8760;

    const { payload, format, nrows, ncols, ncomp } = _splitIllHeader(arrayBuffer);

    // NCOMP: 3 = RGB radiance (converted to photopic lux below), 1 = an already
    // reduced scalar per sensor point. Anything else we cannot interpret.
    const comps = (ncomp === null) ? 3 : ncomp;
    if (comps !== 1 && comps !== 3) {
        throw new Error(`Unsupported .ill file: NCOMP=${comps}. Only 1- and 3-component matrices can be read.`);
    }

    const values = _decodeIllPayload(payload, format);
    const total = values.length;
    if (total === 0) {
        throw new Error("No data could be parsed from the .ill file.");
    }

    // Matrix layout.
    //
    // dctimestep and rmtxop write ONE ROW PER SENSOR POINT and one column per
    // timestep: NROWS = sensor count, NCOLS = timestep count, and the payload is
    // point-major. This parser used to assume the opposite (NROWS = timesteps),
    // which is why a perfectly good 30-point annual matrix was rejected as
    // "30 timesteps". The generated Python post-processors read the Radiance
    // orientation; this now matches them.
    //
    // Files the app wrote under the old assumption are still readable: whichever
    // of the two dimensions produces a valid hour mapping decides the orientation.
    let numTimesteps;
    let numPoints;
    let pointMajor;

    if (nrows === null || ncols === null) {
        // Headerless file: fall back to the app's own convention of 8760 hourly rows.
        if (total % (HOURS_IN_YEAR * comps) !== 0) {
            throw new Error(`Invalid .ill file format. The file has no NROWS/NCOLS header and its ${total} values are not a whole number of 8760-hour ${comps}-component records.`);
        }
        numTimesteps = HOURS_IN_YEAR;
        numPoints = total / (HOURS_IN_YEAR * comps);
        pointMajor = false;
    } else {
        if (nrows * ncols * comps !== total) {
            throw new Error(`Invalid .ill file. The header declares NROWS=${nrows} NCOLS=${ncols} NCOMP=${comps} (${nrows * ncols * comps} values) but the payload contains ${total}.`);
        }
        if (nrows <= 0 || ncols <= 0) {
            throw new Error(`Invalid .ill file dimensions: NROWS=${nrows} NCOLS=${ncols}.`);
        }
        if (_buildIllHourMapping(ncols)) {
            numTimesteps = ncols;
            numPoints = nrows;
            pointMajor = true;
        } else if (_buildIllHourMapping(nrows)) {
            // A matrix written the other way round (older Ray Modeler output).
            numTimesteps = nrows;
            numPoints = ncols;
            pointMajor = false;
        } else {
            throw new Error(`Unsupported .ill file: NROWS=${nrows} NCOLS=${ncols}, and neither is a usable timestep count. The annual dashboards are indexed on a 8760-hour year, so the timestep dimension must be 8760, 8784 (leap year) or a whole multiple of 8760 (sub-hourly).`);
        }
    }

    const mapping = _buildIllHourMapping(numTimesteps);
    // One of the two branches above already proved this mapping exists.
    const indexFor = pointMajor
        ? (p, step) => (p * numTimesteps + step) * comps
        : (p, step) => (step * numPoints + p) * comps;

    const annualData = Array.from({ length: numPoints }, () => new Float32Array(HOURS_IN_YEAR));
    const averageData = [];

    for (let p = 0; p < numPoints; p++) {
        let totalIlluminanceForPoint = 0;
        for (let h = 0; h < HOURS_IN_YEAR; h++) {
            let accumulated = 0;
            for (let s = 0; s < mapping.steps; s++) {
                const index = indexFor(p, mapping.rowFor(h, s));
                accumulated += (comps === 3)
                    ? 179 * (0.265 * values[index] + 0.670 * values[index + 1] + 0.065 * values[index + 2])
                    : values[index];
            }
            const illuminance = accumulated / mapping.steps;
            annualData[p][h] = illuminance;
            totalIlluminanceForPoint += illuminance;
        }
        averageData.push(totalIlluminanceForPoint / HOURS_IN_YEAR);
    }

    return { data: averageData, annualData };
}

/**
 * Splits a Radiance matrix file into its ASCII header fields and binary payload.
 * Radiance binary matrices (dctimestep/rmtxop) prepend a header such as
 * "#?RADIANCE\nNROWS=8760\nNCOLS=200\nNCOMP=3\nFORMAT=float\n\n". Headerless files
 * are reported with all fields null and the whole buffer as the payload.
 * @param {ArrayBuffer} arrayBuffer
 * @returns {{payload: ArrayBuffer, format: string|null, nrows: number|null, ncols: number|null, ncomp: number|null}}
 */
function _splitIllHeader(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const sniffLen = Math.min(bytes.length, 10000);
    let headerText = '';
    for (let i = 0; i < sniffLen; i++) {
        headerText += String.fromCharCode(bytes[i]);
    }

    const looksLikeHeader = headerText.startsWith('#?RADIANCE')
        || /^(NROWS|NCOLS|NCOMP|FORMAT)=/m.test(headerText);
    if (!looksLikeHeader) {
        return { payload: arrayBuffer, format: null, nrows: null, ncols: null, ncomp: null };
    }

    // The header terminates at the first blank line.
    let sep = headerText.indexOf('\n\n');
    let sepLen = 2;
    const crlfSep = headerText.indexOf('\r\n\r\n');
    if (crlfSep !== -1 && (sep === -1 || crlfSep < sep)) {
        sep = crlfSep;
        sepLen = 4;
    }
    if (sep === -1) {
        return { payload: arrayBuffer, format: null, nrows: null, ncols: null, ncomp: null };
    }

    const rawHeader = headerText.slice(0, sep);
    const readInt = (name) => {
        const m = rawHeader.match(new RegExp(`^${name}\\s*=\\s*(\\d+)`, 'm'));
        return m ? parseInt(m[1], 10) : null;
    };
    const formatMatch = rawHeader.match(/^FORMAT\s*=\s*(\S+)/m);

    return {
        // slice() yields a new, 8-byte-aligned ArrayBuffer, required by the typed views.
        payload: arrayBuffer.slice(sep + sepLen),
        format: formatMatch ? formatMatch[1].toLowerCase() : null,
        nrows: readInt('NROWS'),
        ncols: readInt('NCOLS'),
        ncomp: readInt('NCOMP')
    };
}

/**
 * Decodes a Radiance matrix payload according to the FORMAT the header declared.
 * A missing FORMAT is treated as 32-bit float, which is what this app writes.
 * @param {ArrayBuffer} payload
 * @param {string|null} format
 * @returns {Float32Array|Float64Array|number[]}
 */
function _decodeIllPayload(payload, format) {
    const fmt = format || 'float';

    if (fmt === 'ascii') {
        let text = '';
        const bytes = new Uint8Array(payload);
        for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
        const tokens = text.trim().split(/\s+/).filter(t => t !== '');
        const values = new Float64Array(tokens.length);
        for (let i = 0; i < tokens.length; i++) {
            const v = Number(tokens[i]);
            if (!Number.isFinite(v)) {
                throw new Error(`Invalid .ill file: non-numeric value "${tokens[i]}" in an ascii-format matrix.`);
            }
            values[i] = v;
        }
        return values;
    }

    if (fmt === 'float' || fmt === '32-bit_float') {
        if (payload.byteLength % 4 !== 0) {
            throw new Error(`Invalid .ill file: FORMAT=${fmt} but the payload is ${payload.byteLength} bytes, not a multiple of 4.`);
        }
        return new Float32Array(payload);
    }

    if (fmt === 'double' || fmt === '64-bit_double') {
        if (payload.byteLength % 8 !== 0) {
            throw new Error(`Invalid .ill file: FORMAT=${fmt} but the payload is ${payload.byteLength} bytes, not a multiple of 8.`);
        }
        return new Float64Array(payload);
    }

    throw new Error(`Unsupported .ill file: FORMAT=${format}. Only ascii, float and double matrices can be read (a picture-format matrix such as 32-bit_rle_rgbe is not an illuminance matrix).`);
}

/**
 * Maps the timestep rows of a matrix onto the 8760-hour analysis year the rest of
 * the app is indexed on. Returns null when no honest mapping exists.
 * @param {number} numRows
 * @returns {{steps: number, rowFor: (hour: number, step: number) => number}|null}
 */
function _buildIllHourMapping(numRows) {
    const HOURS_IN_YEAR = 8760;

    if (numRows === HOURS_IN_YEAR) {
        return { steps: 1, rowFor: (h) => h };
    }

    if (numRows === 8784) {
        // Leap-year matrix: drop the 24 rows of Feb 29 (day index 59) so the rest
        // line up with the 8760-hour year the dashboards assume.
        console.warn('.ill matrix has 8784 rows (leap year). The 24 hours of Feb 29 are dropped to align with the 8760-hour analysis year.');
        return { steps: 1, rowFor: (h) => (h < 1416 ? h : h + 24) };
    }

    if (numRows > HOURS_IN_YEAR && numRows % HOURS_IN_YEAR === 0) {
        const steps = numRows / HOURS_IN_YEAR;
        console.warn(`.ill matrix has ${numRows} rows (${steps} sub-hourly timesteps per hour). Sub-steps are averaged into hourly values.`);
        return { steps, rowFor: (h, s) => h * steps + s };
    }

    return null;
}

/**
* Parses the CSV file containing per-point circadian data.
* @param {string} content The raw CSV text.
* @returns {object} An object where keys are column headers and values are arrays of numbers.
*/
function _parseCircadianCsv(content) {
    const lines = content.trim().split(/\r?\n/);
    if (lines.length < 2) return {}; // Need at least a header and one data row

        const headers = lines[0].split(',').map(h => h.trim());
        const data = {};
        headers.forEach(h => data[h] = []);

    for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
        if (values.length !== headers.length) {
            continue; // Skip malformed rows
        }
        headers.forEach((header, j) => {
            data[header].push(parseFloat(values[j]));
        });
    }
    
    return data;
}