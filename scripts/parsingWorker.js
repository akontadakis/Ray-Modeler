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
    let results = { data: [], glareResult: null, annualGlareResults: {} };

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
            results.data = content
                .trim()
                .split(/\r?\n/)
                .map(line => parseFloat(line))
                .filter(val => !isNaN(val));

            if (results.data.length === 0) {
                throw new Error("No valid numerical data found. File is not a recognized glare report or illuminance file.");
            }
        }
    }
    return results;
}

/**
 * Parses single-column annual glare files (.dgp, .ga).
 */
function _parseAnnualGlareFile(content, type) {
    const lines = content.trim().split(/\r?\n/);
    const dataMatrix = lines.map(line =>
        line.trim().split(/\s+/).map(val => parseFloat(val))
    );

    if (dataMatrix.length > 0 && dataMatrix.length !== 8760) {
         console.warn(`Annual glare file has ${dataMatrix.length} rows, not 8760. Metrics may be inaccurate.`);
    }
    if (dataMatrix.some(row => row.some(isNaN))) {
         throw new Error(`File contains non-numeric data.`);
    }

    const numPoints = dataMatrix[0]?.length || 0;
    const numHours = dataMatrix.length;
    const transposedData = Array.from({ length: numPoints }, () => new Float32Array(numHours));

    for (let h = 0; h < numHours; h++) {
        for (let p = 0; p < numPoints; p++) {
            transposedData[p][h] = dataMatrix[h][p];
        }
    }

    const averageData = transposedData.map(pointData => {
        if (pointData.length === 0) return 0;
        const sum = pointData.reduce((a, b) => a + b, 0);
        return sum / pointData.length;
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
    const resolutionLine = content.match(/rpict.*-x\s+(\d+)\s+-y\s+(\d+)/);

    // If neither UGR nor DGP is found, it's not a report we can parse.
    if (!ugrLine && !dgpLine) {
        return false;
    }

    const glareResult = {
        dgp: dgpLine ? parseFloat(dgpLine[1]) : null,
        ugr: ugrLine ? parseFloat(ugrLine[1]) : null,
        imageWidth: resolutionLine ? parseInt(resolutionLine[1], 10) : null,
        imageHeight: resolutionLine ? parseInt(resolutionLine[2], 10) : null,
        sources: []
    };

    // Find the start of the source list (this format is common to modern evalglare output for both metrics)
    const lines = content.split('\n');
    // Detailed evalglare prints the vertical-illuminance column as "E_vert"
    // (older/summary output uses "Ev"); accept either.
    const headerLineIndex = lines.findIndex(line =>
        line.trim().startsWith("Nr") && (line.includes("E_vert") || line.includes("Ev")));

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
 * Parses the raw binary content of an annual .ill results file.
 */
function _parseIllFileContent(arrayBuffer) {
    const HOURS_IN_YEAR = 8760;
    const CHANNELS = 3; // R, G, B

    // Radiance binary matrices (dctimestep/rmtxop) prepend an ASCII header,
    // e.g. "#?RADIANCE ... FORMAT=float\n\n", before the raw float payload.
    // Detect it, skip past the terminating blank line, and read floats from
    // there. Already-headerless files are read from offset 0 as before.
    let payloadBuffer = arrayBuffer;
    const bytes = new Uint8Array(arrayBuffer);
    const sniffLen = Math.min(bytes.length, 10000);
    let headerText = '';
    for (let i = 0; i < sniffLen; i++) {
        headerText += String.fromCharCode(bytes[i]);
    }
    if (headerText.startsWith('#?RADIANCE') || headerText.includes('FORMAT=')) {
        // The header terminates at the first blank line.
        let sep = headerText.indexOf('\n\n');
        let sepLen = 2;
        const crlfSep = headerText.indexOf('\r\n\r\n');
        if (crlfSep !== -1 && (sep === -1 || crlfSep < sep)) {
            sep = crlfSep;
            sepLen = 4;
        }
        if (sep !== -1) {
            const offset = sep + sepLen;
            // slice() yields a new, 4-byte-aligned ArrayBuffer, required by Float32Array.
            payloadBuffer = arrayBuffer.slice(offset);
        }
    }

    const floatData = new Float32Array(payloadBuffer);
    const totalFloats = floatData.length;

    if (totalFloats === 0 || totalFloats % (HOURS_IN_YEAR * CHANNELS) !== 0) {
        throw new Error(`Invalid .ill file format. File size is not compatible with 8760 hourly RGB values.`);
    }

    const numPoints = totalFloats / (HOURS_IN_YEAR * CHANNELS);
    const annualData = Array.from({ length: numPoints }, () => new Float32Array(HOURS_IN_YEAR));
    const averageData = [];

    for (let p = 0; p < numPoints; p++) {
        let totalIlluminanceForPoint = 0;
        for (let h = 0; h < HOURS_IN_YEAR; h++) {
            const index = (h * numPoints + p) * CHANNELS;
            const r = floatData[index];
            const g = floatData[index + 1];
            const b = floatData[index + 2];
            const illuminance = 179 * (0.265 * r + 0.670 * g + 0.065 * b);
            annualData[p][h] = illuminance;
            totalIlluminanceForPoint += illuminance;
        }
        averageData.push(totalIlluminanceForPoint / HOURS_IN_YEAR);
    }

    if (averageData.length === 0) {
    throw new Error("No data could be parsed from the .ill file.");
    }

    return { data: averageData, annualData };
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