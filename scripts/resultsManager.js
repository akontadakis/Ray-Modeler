// scripts/resultsManager.js

import { showAlert } from './ui.js';
import { project } from './project.js';
import { ResultsRegistry } from './results/ResultsRegistry.js';

export const palettes = {
    // Viridis - from https://waldyrious.net/viridis-palette-generator/
    viridis: ['#440154', '#482878', '#3e4989', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6dcd59', '#b4de2c', '#fde725'],
    diverging: ['#2166ac', '#67a9cf', '#d1e5f0', '#f7f7f7', '#fddbc7', '#ef8a62', '#b2182b'],
    // Plasma
    plasma: ['#0d0887', '#46039f', '#7201a8', '#9c179e', '#bd3786', '#d8576b', '#ed7953', '#fb9f3a', '#fdca26', '#f0f921'],
    // Inferno
    inferno: ['#000004', '#1b0c41', '#4a0c63', '#781c6d', '#a52c60', '#cf4446', '#ed6925', '#fb9a06', '#f7d03c', '#fcffa4'],
    magma: ['#000004', '#180f3d', '#440f76', '#721f81', '#9e2f7f', '#cd4071', '#f1605d', '#fd9567', '#fecf92', '#fcfdbf'],
    // Cividis
    cividis: ['#00224e', '#123570', '#354a8c', '#565fa2', '#7876b4', '#9990c1', '#b9adca', '#d9cad3', '#fafade'],
};

class ResultsManager {
    constructor() {
        this.differenceData = { data: null, stats: null };
        this.hdrResult = null; // Stays global for now

        // Annual / spectral datasets for A and B views
        this.datasets = {
            a: {
                fileName: null,
                data: [],
                annualData: [],
                annualDirectData: [],
                glareResult: null,
                annualGlareResults: {},
                spectralResults: {},
                circadianMetrics: null,
                lightingEnergyMetrics: null,
                lightingMetrics: null,
                stats: null
            },
            b: {
                fileName: null,
                data: [],
                annualData: [],
                annualDirectData: [],
                glareResult: null,
                annualGlareResults: {},
                spectralResults: {},
                circadianMetrics: null,
                lightingEnergyMetrics: null,
                lightingMetrics: null,
                stats: null
            }
        };

        this.activeView = 'a'; // 'a', 'b', or 'diff'
        this.activeMetricType = 'photopic'; // Default metric to display

        // Climate data (from EPW)
        this.climateData = null;

        // Color scale for 3D/heatmaps
        this.colorScale = {
            min: 0,
            max: 1000,
            palette: 'viridis'
        };

        this.histogramChart = null;


    }















    /**
     * Clears all data associated with a specific dataset key.
     * @param {'a' | 'b'} key - The dataset to clear.
     */
    clearDataset(key) {
        if (key in this.datasets) {
            this.datasets[key] = {
                fileName: null,
                data: [],
                annualData: [],
                annualDirectData: [],
                glareResult: null,
                annualGlareResults: {},
                spectralResults: {},
                circadianMetrics: null,
                lightingEnergyMetrics: null,
                lightingMetrics: null,
                stats: null
            };
        }
        // If we clear B, the difference map is no longer valid.
        if (key === 'b') {
            this.differenceData = { data: null, stats: null };
        }
    }

    /**
     * Processes the parsed data from the web worker using ResultsRegistry descriptors.
     * This is the new, typed entrypoint. It is designed to be non-breaking:
     * - If no descriptor matches, a generic handler is used.
     * - Legacy field expectations (datasets.a/b.*) are preserved.
     * @param {object} result - The parsed data from the worker.
     * @param {string} fileName - The name of the original file.
     * @param {'a' | 'b'} key - The dataset key.
     * @private
     */
    _processWorkerResult(result, fileName, key) {
        if (!(key in this.datasets)) {
            console.warn(`ResultsManager: invalid dataset key '${key}' in _processWorkerResult.`);
            return;
        }
        if (!this.datasets[key]) {
            this.clearDataset(key);
        }

        const descriptor = ResultsRegistry.findDescriptor(fileName, result);

        if (!descriptor) {
            console.warn('ResultsManager: No matching descriptor; using legacy generic handler.', fileName);
            this._processGenericResult(result, fileName, key);
            return;
        }

        try {
            if (descriptor.storage && typeof descriptor.storage.apply === 'function') {
                descriptor.storage.apply(this, key, result, { fileName });
            } else {
                console.warn('ResultsManager: Descriptor has no storage.apply; falling back to generic.', descriptor.id);
                this._processGenericResult(result, fileName, key);
            }
        } catch (err) {
            console.error('ResultsManager: Error applying descriptor', descriptor.id, 'for', fileName, err);
            this._processGenericResult(result, fileName, key);
        }
    }

    /**
     * Legacy-style generic processor kept as a safe fallback for unknown shapes.
     * This mirrors the previous behavior for simple scalar/annual results.
     * @param {object} result
     * @param {string} fileName
     * @param {'a'|'b'} key
     * @private
     */
    _processGenericResult(result, fileName, key) {
        if (!this.datasets[key]) {
            this.clearDataset(key);
        }
        const dataset = this.datasets[key];
        dataset.fileName = dataset.fileName || fileName;

        // Prefer explicit arrays; fall back cautiously.
        if (result.annualData && Array.isArray(result.annualData)) {
            dataset.annualData = result.annualData;
        }
        if (Array.isArray(result.data)) {
            dataset.data = result.data;
        } else if (!dataset.data || dataset.data.length === 0) {
            // If worker returned a flat array, treat it as data.
            if (Array.isArray(result)) {
                dataset.data = result;
            }
        }

        // Preserve any existing specialized fields if not explicitly overwritten.
        if (result.glareResult && !dataset.glareResult) {
            dataset.glareResult = result.glareResult;
        }
        if (result.annualGlareResults && !dataset.annualGlareResults) {
            dataset.annualGlareResults = result.annualGlareResults;
        }
        if (result.circadianMetrics && !dataset.circadianMetrics) {
            dataset.circadianMetrics = result.circadianMetrics;
        }
        if (result.perPointCircadianData && !dataset.spectralResults) {
            dataset.spectralResults = result.perPointCircadianData;
        }
        if (result.lightingEnergyMetrics && !dataset.lightingEnergyMetrics) {
            dataset.lightingEnergyMetrics = result.lightingEnergyMetrics;
        }

        return dataset;
    }

    /**
     * Loads a file, sends it to a Web Worker for parsing, and processes the returned data.
     * @param {File} file - The file to process.
     * @param {'a' | 'b'} key - The dataset key to associate the results with.
     * @returns {Promise<object>} A promise that resolves with the key and stats of the loaded dataset.
     */
    async loadAndProcessFile(file, key) {
        return new Promise((resolve, reject) => {
            if (!file) return reject(new Error("No file provided."));
            if (!(key in this.datasets)) return reject(new Error(`Invalid dataset key: ${key}`));

            const reader = new FileReader();
            const lowerFileName = file.name.toLowerCase();
            const isIllFile = lowerFileName.endsWith('.ill');
            const isEpwFile = lowerFileName.endsWith('.epw');

            reader.onload = (e) => {
                const content = e.target.result;

                if (isEpwFile) {
                    try {
                        this.climateData = this._parseEpwContent(content);
                        showAlert(`Climate file "${file.name}" parsed successfully.`, 'Climate Data Loaded');
                        resolve({ key: key, type: 'climate' });
                    } catch (error) {
                        showAlert(`Error parsing EPW file: ${error.message}`, 'EPW Error');
                        reject(error);
                    }
                    return;
                }

                const worker = new Worker('./scripts/parsingWorker.js');

                worker.onmessage = (event) => {
                    worker.terminate();
                    if (event.data.error) {
                        const error = new Error(event.data.error);
                        showAlert(`Error processing results file: ${error.message}`, 'File Error');
                        reject(error);
                        return;
                    }

                    this._processWorkerResult(event.data.result, file.name, key);

                    // Common finalization steps
                    this.datasets[key].stats = this._calculateStats(this.datasets[key].data);
                    if (this.datasets.a && this.datasets.b) {
                        this.calculateDifference();
                    }
                    const activeStats = this.getActiveStats();
                    if (activeStats) {
                        this.updateColorScale(activeStats.min, activeStats.max, this.colorScale.palette);
                    }

                    resolve({ key: key, stats: this.datasets[key].stats });
                };

                worker.onerror = (error) => {
                    worker.terminate();
                    const errorMessage = `Worker error while parsing ${file.name}: ${error.message}`;
                    showAlert(errorMessage, 'Processing Error');
                    reject(new Error(errorMessage));
                };

                const transferList = (content instanceof ArrayBuffer) ? [content] : [];
                worker.postMessage({ content: content, fileName: file.name }, transferList);
            };

            reader.onerror = () => {
                const error = new Error(`Failed to read file: ${file.name}`);
                showAlert(error.message, 'File Read Error');
                reject(error);
            };

            if (isIllFile) {
                reader.readAsArrayBuffer(file);
            } else {
                reader.readAsText(file);
            }
        });
    }

    /**
     * Calculates statistics (min, max, average, count) for the loaded data.
     * @private
     */
    _calculateStats(data) {
        if (!data || data.length === 0) {
            return { min: 0, max: 0, avg: 0, count: 0, uniformity: 0 };
        }
        const sum = data.reduce((a, b) => a + b, 0);
        const min = Math.min(...data);
        const avg = sum / data.length;
        return {
            min: min,
            max: Math.max(...data),
            avg: avg,
            uniformity: avg > 0 ? min / avg : 0,
            count: data.length,
        };
    }

    /**
     * Parses the string content of an EPW file to extract hourly climate data.
     * @param {string} epwContent - The full string content of the EPW file.
     * @returns {object} An object containing arrays of hourly data.
     * @private
     */
    _parseEpwContent(epwContent) {
        const lines = epwContent.split(/\r?\n/);
        const dataLines = lines.slice(8); // Data starts from the 9th line

        const hourlyData = {
            temp: [],    // Dry Bulb Temperature (°C) - Column 6
            rh: [],      // Relative Humidity (%) - Column 8
            dni: [],     // Direct Normal Radiation (Wh/m^2) - Column 14
            dhi: [],     // Diffuse Horizontal Radiation (Wh/m^2) - Column 15
            windDir: [], // Wind Direction (°) - Column 20
            windSpd: []  // Wind Speed (m/s) - Column 21
        };

        for (const line of dataLines) {
            const values = line.split(',');
            if (values.length < 22) continue; // Skip incomplete lines

            hourlyData.temp.push(parseFloat(values[6]));
            hourlyData.rh.push(parseFloat(values[8]));
            hourlyData.dni.push(parseFloat(values[14]));
            hourlyData.dhi.push(parseFloat(values[15]));
            hourlyData.windDir.push(parseFloat(values[20]));
            hourlyData.windSpd.push(parseFloat(values[21]));
        }

        if (hourlyData.temp.length !== 8760) {
            console.warn(`EPW file parsing resulted in ${hourlyData.temp.length} data points instead of 8760.`);
        }

        return hourlyData;
    }

    /**
     * Processes raw climate data to generate binned data for a wind rose chart.
     * @returns {object|null} Data formatted for Chart.js or null if no data.
     */
    getWindRoseData() {
        if (!this.climateData) return null;

        const directions = 16;
        const speedBins = [1, 3, 6, 9, 12]; // Wind speed categories in m/s
        const labels = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

        // Initialize a 2D array for bins [direction][speed]
        const bins = Array(directions).fill(0).map(() => Array(speedBins.length + 1).fill(0));

        for (let i = 0; i < this.climateData.windDir.length; i++) {
            const dir = this.climateData.windDir[i];
            const spd = this.climateData.windSpd[i];

            if (spd <= 0.5) continue; // Ignore calm winds

            const dirIndex = Math.floor(((dir + 11.25) % 360) / 22.5);

            let spdIndex = speedBins.findIndex(s => spd < s);
            if (spdIndex === -1) spdIndex = speedBins.length; // Faster than the fastest bin

            bins[dirIndex][spdIndex]++;
        }

        return { labels, bins, speedBins };
    }

    /**
     * Processes raw climate data to get monthly average solar radiation.
     * @returns {object|null} Data formatted for Chart.js or null if no data.
     */
    getMonthlySolarData() {
        if (!this.climateData) return null;

        const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        const monthlyTotals = { dni: Array(12).fill(0), dhi: Array(12).fill(0) };
        let hourIndex = 0;

        for (let m = 0; m < 12; m++) {
            for (let d = 0; d < daysInMonth[m] * 24; d++) {
                monthlyTotals.dni[m] += this.climateData.dni[hourIndex];
                monthlyTotals.dhi[m] += this.climateData.dhi[hourIndex];
                hourIndex++;
            }
        }

        const avgDailyDni = monthlyTotals.dni.map((total, i) => (total / daysInMonth[i]) / 1000); // kWh/m²/day
        const avgDailyDhi = monthlyTotals.dhi.map((total, i) => (total / daysInMonth[i]) / 1000);

        return {
            labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
            dni: avgDailyDni,
            dhi: avgDailyDhi
        };
    }

    /**
     * Processes raw climate data to get monthly temperature ranges.
     * @returns {object|null} Data formatted for Chart.js or null if no data.
     */
    getMonthlyTemperatureData() {
        if (!this.climateData) return null;

        const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        const monthly = Array(12).fill(0).map(() => ({ min: Infinity, max: -Infinity, sum: 0, count: 0 }));
        let hourIndex = 0;

        for (let m = 0; m < 12; m++) {
            for (let d = 0; d < daysInMonth[m] * 24; d++) {
                const temp = this.climateData.temp[hourIndex];
                if (temp > -99) { // EPW uses -99 for missing data
                    monthly[m].min = Math.min(monthly[m].min, temp);
                    monthly[m].max = Math.max(monthly[m].max, temp);
                    monthly[m].sum += temp;
                    monthly[m].count++;
                }
                hourIndex++;
            }
        }

        return {
            labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
            min: monthly.map(m => m.min),
            max: monthly.map(m => m.max),
            avg: monthly.map(m => m.sum / m.count)
        };
    }

    /**
     * Calculates the sun path for key days of the year for a sun path diagram.
     *
     * Returned structure:
     * {
     *   summerSolstice: [{ r, t }, ...],
     *   equinox:        [{ r, t }, ...],
     *   winterSolstice: [{ r, t }, ...]
     * }
     *
     * Conventions (for use with polar charts):
     * - t (theta): azimuth in degrees,
     *      0° at North, increasing clockwise (N=0, E=90, S=180, W=270).
     * - r (radius): zenith angle in degrees,
     *      r = 90 - altitude,
     *      so points near the center are high-altitude sun positions.
     *
     * Consumers (e.g. annualDashboard sun-path chart) should:
     * - Treat t as the polar angle (deg).
     * - Treat r as the radial coordinate (deg from zenith).
     * - Prefer a polar scatter/line implementation over polarArea,
     *   using these explicit r/t mappings.
     *
     * @returns {object|null} Data for polar plotting or null if no project data.
     */
    getSunPathData() {
        if (!project || !project.projectData) return null;

        const keyDays = {
            summerSolstice: 172, // June 21
            equinox: 80,         // March 21
            winterSolstice: 355  // Dec 21
        };

        const datasets = {};

        for (const [name, dayOfYear] of Object.entries(keyDays)) {
            datasets[name] = [];
            for (let hour = 0; hour < 24; hour += 0.5) {
                const { altitude, azimuth } = this._calculateSunPosition(dayOfYear, hour);
                const altDegrees = altitude * (180 / Math.PI);

                if (altDegrees > 0) {
                    let azimuthDeg = azimuth * (180 / Math.PI);
                    // Convert math azimuth (0=E) to compass azimuth (0=N)
                    azimuthDeg = (450 - azimuthDeg) % 360;

                    datasets[name].push({
                        r: 90 - altDegrees, // Radial axis is zenith angle (90 - altitude)
                        t: azimuthDeg       // Angular axis is azimuth
                    });
                }
            }
        }
        return datasets;
    }


    /**
     * Calculates the difference between dataset A and B and stores the result.
     */
    calculateDifference() {
        const dsA = this.datasets.a;
        const dsB = this.datasets.b;

        if (!dsA || !dsB || !dsA.data || !dsB.data) {
            this.differenceData = { data: null, stats: null };
            return;
        }

        if (dsA.data.length !== dsB.data.length) {
            showAlert('Cannot compare datasets. The number of sensor points differs.', 'Comparison Error');
            this.differenceData = { data: null, stats: null };
            return;
        }

        const diff = dsA.data.map((val, i) => val - dsB.data[i]);
        this.differenceData.data = diff;
        this.differenceData.stats = this._calculateStats(diff);
    }

    /**
     * Builds an occupied-hours mask of length 8760 based on an optional schedule file and default hours.
     * If a valid 8760-line occupancy schedule is found in project.simulationFiles['occupancy-schedule'], it is used.
     * Otherwise, a default 8-18 Monday-Friday schedule is applied.
     * @param {{ start:number, end:number }} [defaultHours={start:8,end:18}]
     * @returns {{ mask:boolean[], total:number }}
     * @private
     */
    _buildOccupiedMask(defaultHours = { start: 8, end: 18 }) {
        const scheduleFile = project.simulationFiles?.['occupancy-schedule'];
        const mask = new Array(8760).fill(false);

        if (scheduleFile?.content) {
            const scheduleValues = scheduleFile.content
                .trim()
                .split(/\r?\n/)
                .map(v => parseInt(v, 10));
            if (scheduleValues.length === 8760 && scheduleValues.every(v => v === 0 || v === 1)) {
                for (let h = 0; h < 8760; h++) {
                    mask[h] = scheduleValues[h] === 1;
                }
                return { mask, total: mask.reduce((a, v) => a + (v ? 1 : 0), 0) };
            }
            console.warn('Occupancy schedule file does not have 8760 valid entries. Using default schedule.');
        }

        // Default: 8-18, Monday-Friday, typical year starting Jan 1st.
        for (let h = 0; h < 8760; h++) {
            const dayIndex = Math.floor(h / 24);
            const date = new Date(2023, 0, 1 + dayIndex);
            const dayOfWeek = date.getDay(); // 0=Sun, 6=Sat
            const hourOfDay = h % 24;
            const isWeekday = dayOfWeek > 0 && dayOfWeek < 6;
            const isWorkHour = hourOfDay >= defaultHours.start && hourOfDay < defaultHours.end;
            if (isWeekday && isWorkHour) {
                mask[h] = true;
            }
        }

        const total = mask.reduce((a, v) => a + (v ? 1 : 0), 0);
        return { mask, total };
    }

    /**
     * Calculates annual daylight metrics (sDA, ASE, UDI) from loaded .ill data.
     * @param {object} options - Thresholds for the calculations.
     * @returns {object|null} An object with sDA, ASE, and UDI results, or null if no data.
     */
    calculateAnnualMetrics(key, {
        sDA_illuminance = 300,
        sDA_time = 0.50,
        ASE_illuminance = 1000,
        ASE_hours = 250,
        UDI_min = 100,
        UDI_max = 2000,
        occupiedHours = { start: 8, end: 18 } // Default: 8 AM to 6 PM (exclusive of 18:00)
    }) {
        const dataset = this.datasets[key];
        if (!dataset || !dataset.annualData || dataset.annualData.length === 0) {
            console.warn(`Annual metrics calculation skipped for dataset '${key}': No annual data available.`);
            return null;
        }

        // Safeguard: Warn if the user might be calculating sDA on a direct-only file
        if (dataset.annualDirectData === dataset.annualData && dataset.annualData.length > 0) {
            showAlert("Warning: You are calculating sDA on a direct-only illuminance file. This will produce incorrect results. Please load the final 'operated' or 'total' illuminance file for sDA.", "Incorrect Data For sDA");
        }

        const annualData = dataset.annualData;
        const numPoints = annualData.length;
        let sdaPoints = 0;
        let asePoints = 0;
        const allUdiPercentages = [];

        const { mask: occupiedMask, total: totalOccupiedHoursInYear } =
            this._buildOccupiedMask(occupiedHours);

        for (let p = 0; p < numPoints; p++) {
            let hoursMeetingSda = 0;
            let hoursMeetingAse = 0;
            let udiAutonomousHours = 0;
            let udiExceededHours = 0;
            let udiInsufficientHours = 0;
            const hasDirectData = dataset.annualDirectData && dataset.annualDirectData.length > 0;

            for (let h = 0; h < 8760; h++) {
                if (occupiedMask[h]) {
                    const totalIlluminance = annualData[p][h];

                    if (totalIlluminance >= sDA_illuminance) hoursMeetingSda++;

                    // ASE requires direct-only illuminance. Do not fall back to total illuminance.
                    if (hasDirectData) {
                        const directIlluminance = dataset.annualDirectData[p][h];
                        if (directIlluminance >= ASE_illuminance) hoursMeetingAse++;
                    }

                    if (totalIlluminance < UDI_min) {
                        udiInsufficientHours++;
                    } else if (totalIlluminance <= UDI_max) {
                        udiAutonomousHours++;
                    } else {
                        udiExceededHours++;
                    }
                }
            }

            if ((hoursMeetingSda / totalOccupiedHoursInYear) >= sDA_time) {
                sdaPoints++;
            }
            if (hoursMeetingAse > ASE_hours) {
                asePoints++;
            }

            allUdiPercentages.push({
                insufficient: (udiInsufficientHours / totalOccupiedHoursInYear) * 100,
                autonomous: (udiAutonomousHours / totalOccupiedHoursInYear) * 100,
                exceeded: (udiExceededHours / totalOccupiedHoursInYear) * 100,
            });
        }

        const sDA = (sdaPoints / numPoints) * 100;
        const ASE = (asePoints / numPoints) * 100;

        const avgUdi = allUdiPercentages.reduce((acc, curr) => {
            acc.insufficient += curr.insufficient;
            acc.autonomous += curr.autonomous;
            acc.exceeded += curr.exceeded;
            return acc;
        }, { insufficient: 0, autonomous: 0, exceeded: 0 });

        avgUdi.insufficient /= numPoints;
        avgUdi.autonomous /= numPoints;
        avgUdi.exceeded /= numPoints;

        return { sDA, ASE, UDI: avgUdi };
    }

    /**
     * Calculates the space-averaged illuminance for each hour of the year.
     * @returns {Float32Array|null} An array of 8760 average illuminance values.
     */
    getHourlyAverageIlluminance(key = 'a') {
        const dataset = this.datasets[key];
        if (!dataset || !dataset.annualData || dataset.annualData.length === 0) return null;

        const annualData = dataset.annualData;
        const numPoints = annualData.length;
        const numHours = 8760;
        const hourlyAverages = new Float32Array(numHours).fill(0);

        for (let h = 0; h < numHours; h++) {
            let sumForHour = 0;
            for (let p = 0; p < numPoints; p++) {
                sumForHour += annualData[p][h];
            }
            hourlyAverages[h] = sumForHour / numPoints;
        }
        return hourlyAverages;
    }

    /**
     * Retrieves the illuminance values for all sensor points at a specific hour.
     * @param {number} hour - The hour of the year (0-8759).
     * @returns {Float32Array|null} An array of illuminance values for that hour.
     */
    getIlluminanceForHour(hour, key = 'a') {
        const dataset = this.datasets[key];
        if (!dataset || !dataset.annualData || dataset.annualData.length === 0) return null;

        const annualData = dataset.annualData;
        const numPoints = annualData.length;
        const hourlyData = new Float32Array(numPoints);

        for (let p = 0; p < numPoints; p++) {
            hourlyData[p] = annualData[p][hour];
        }
        return hourlyData;
    }

    /**
     * Retrieves the full 8760-hour annual data for a single sensor point.
     * @param {string} key - The dataset key ('a' or 'b').
     * @param {number} pointIndex - The global index of the sensor point.
     * @returns {Float32Array|null} The annual data for the point, or null if not available.
     */
    getAnnualDataForPoint(key, pointIndex) {
        const dataset = this.datasets[key];
        if (!dataset || !dataset.annualData || dataset.annualData.length === 0) {
            return null;
        }
        if (pointIndex < 0 || pointIndex >= dataset.annualData.length) {
            console.error(`Point index ${pointIndex} is out of bounds.`);
            return null;
        }
        return dataset.annualData[pointIndex];
    }

    /**
     * Calculates lighting energy metrics based on annual daylight illuminance.
     * @param {string} key - The dataset key ('a' or 'b').
     */
    async calculateLightingMetrics(key) {
        const dataset = this.datasets[key];
        const lightingControls = (await project.gatherAllProjectData()).lighting?.daylighting;

        if (!this.hasAnnualData(key) || !lightingControls || !lightingControls.enabled) {
            if (dataset) dataset.lightingMetrics = null;
            return;
        }

        const hourlyAverages = this.getHourlyAverageIlluminance(key);
        if (!hourlyAverages) {
            if (dataset) dataset.lightingMetrics = null;
            return;
        }

        const {
            controlType,
            setpoint,
            minPowerFraction,
            minLightFraction,
            nSteps,
        } = lightingControls;

        const occupiedHours = { start: 8, end: 18 };
        let totalPowerFraction = 0;
        let occupiedHourCount = 0;

        for (let h = 0; h < 8760; h++) {
            const date = new Date(2023, 0, 1 + Math.floor(h / 24));
            const dayOfWeek = date.getDay(); // 0=Sun, 6=Sat
            const hourOfDay = h % 24;

            if (hourOfDay >= occupiedHours.start && hourOfDay < occupiedHours.end && dayOfWeek > 0 && dayOfWeek < 6) {
                occupiedHourCount++;
                const daylightIlluminance = hourlyAverages[h];
                const fL = Math.max(0, (setpoint - daylightIlluminance) / setpoint);
                let fP = 0;

                if (controlType === 'Continuous') {
                    if (fL < minLightFraction) {
                        fP = minPowerFraction;
                    } else {
                        fP = minPowerFraction + (fL - minLightFraction) * (1 - minPowerFraction) / (1 - minLightFraction);
                    }
                } else if (controlType === 'ContinuousOff') {
                    if (fL < minLightFraction) {
                        fP = 0;
                    } else {
                        fP = minPowerFraction + (fL - minLightFraction) * (1 - minPowerFraction) / (1 - minLightFraction);
                    }
                } else if (controlType === 'Stepped') {
                    if (fL <= 0) {
                        fP = 0;
                    } else if (fL >= 1) {
                        fP = 1;
                    } else {
                        fP = Math.ceil(nSteps * fL) / nSteps;
                    }
                }
                totalPowerFraction += fP;
            }
        }

        const avgPower = occupiedHourCount > 0 ? totalPowerFraction / occupiedHourCount : 0;
        const savings = (1 - avgPower) * 100;

        dataset.lightingMetrics = { avgPower, savings };
    }

    /**
     * Calculates the sun's position for a given time and location.
     * @param {number} dayOfYear - The day of the year (1-365).
     * @param {number} solarTime - The local solar time in hours (e.g., 14.5 for 2:30 PM).
     * @returns {{altitude: number, azimuth: number}} Sun position in radians.
     * @private
     */
    _calculateSunPosition(dayOfYear, solarTime) {
        // This is a simplified implementation of a solar position algorithm.
        // It assumes latitude is available, falling back to 0 if not.
        const lat = (project && project.projectData) ? project.projectData.projectInfo.latitude : 40;
        const latitudeRad = lat * (Math.PI / 180);

        const B = (360 / 365) * (dayOfYear - 81) * (Math.PI / 180);
        const equationOfTime = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
        const hourAngle = (solarTime - 12) * 15 * (Math.PI / 180);
        const declination = 23.45 * Math.sin(B) * (Math.PI / 180);

        const altitude = Math.asin(Math.sin(declination) * Math.sin(latitudeRad) + Math.cos(declination) * Math.cos(latitudeRad) * Math.cos(hourAngle));

        let azimuth = Math.acos((Math.sin(declination) * Math.cos(latitudeRad) - Math.cos(declination) * Math.sin(latitudeRad) * Math.cos(hourAngle)) / Math.cos(altitude));
        if (hourAngle > 0) {
            azimuth = 2 * Math.PI - azimuth;
        }
        return { altitude, azimuth };
    }

    /**
     * Typed result presence check using ResultsRegistry semantics.
     * @param {'a'|'b'|null} key - Dataset key, or null for global/epRun where applicable.
     * @param {string} typeId - ResultsRegistry descriptor id.
     * @returns {boolean}
     */
    hasResult(key, typeId) {
        switch (typeId) {
            case 'annual-illuminance': {
                const ds = this.datasets[key];
                return !!(ds && Array.isArray(ds.annualData) && ds.annualData.length > 0);
            }
            case 'annual-direct-illuminance': {
                const ds = this.datasets[key];
                return !!(ds && Array.isArray(ds.annualDirectData) && ds.annualDirectData.length > 0);
            }
            case 'annual-glare-dgp': {
                const ds = this.datasets[key];
                return !!(ds && ds.annualGlareResults && Array.isArray(ds.annualGlareResults?.dgp) && ds.annualGlareResults.dgp.length > 0);
            }
            case 'annual-glare-ga': {
                const ds = this.datasets[key];
                return !!(ds && ds.annualGlareResults && Array.isArray(ds.annualGlareResults?.ga) && ds.annualGlareResults.ga.length > 0);
            }
            case 'evalglare-pit': {
                const ds = this.datasets[key];
                return !!(ds && ds.glareResult);
            }
            case 'circadian-summary': {
                const ds = this.datasets[key];
                return !!(ds && ds.circadianMetrics);
            }
            case 'circadian-per-point': {
                const ds = this.datasets[key];
                return !!(ds && ds.spectralResults && Object.keys(ds.spectralResults).length > 0);
            }
            case 'lighting-energy': {
                const ds = this.datasets[key];
                return !!(ds && ds.lightingEnergyMetrics);
            }
            case 'epw-climate': {
                return !!this.climateData;
            }

            default:
                return false;
        }
    }

    /**
     * Typed result accessor using stable typeIds.
     * Returns a thin, read-only view of the underlying data shape.
     * @param {'a'|'b'|null} key
     * @param {string} typeId
     * @returns {any|null}
     */
    getResult(key, typeId) {
        switch (typeId) {
            case 'annual-illuminance': {
                const ds = this.datasets[key];
                if (!ds || !ds.annualData) return null;
                return {
                    annualData: ds.annualData,
                    data: ds.data,
                    units: ds.units || 'lux'
                };
            }
            case 'annual-direct-illuminance': {
                const ds = this.datasets[key];
                if (!ds || !ds.annualDirectData) return null;
                return { annualDirectData: ds.annualDirectData, units: 'lux' };
            }
            case 'annual-glare-dgp': {
                const ds = this.datasets[key];
                if (!ds?.annualGlareResults?.dgp) return null;
                return { annualGlareResults: { dgp: ds.annualGlareResults.dgp } };
            }
            case 'annual-glare-ga': {
                const ds = this.datasets[key];
                if (!ds?.annualGlareResults?.ga) return null;
                return { annualGlareResults: { ga: ds.annualGlareResults.ga } };
            }
            case 'evalglare-pit': {
                const ds = this.datasets[key];
                return ds?.glareResult || null;
            }
            case 'circadian-summary': {
                const ds = this.datasets[key];
                return ds?.circadianMetrics || null;
            }
            case 'circadian-per-point': {
                const ds = this.datasets[key];
                return ds?.spectralResults || null;
            }
            case 'lighting-energy': {
                const ds = this.datasets[key];
                return ds?.lightingEnergyMetrics || null;
            }
            case 'epw-climate': {
                return this.climateData || null;
            }

            default:
                return null;
        }
    }

    /**
     * Checks if a given dataset has parsed annual (.ill) data.
     * Backwards-compatible wrapper over hasResult('annual-illuminance').
     * @param {string} [key='a'] - The dataset key to check.
     * @returns {boolean} True if annual data exists.
     */
    hasAnnualData(key = 'a') {
        return this.hasResult(key, 'annual-illuminance');
    }

    /**
     * Checks if a given dataset has parsed annual glare (.dgp or .ga) data.
     * Backwards-compatible convenience.
     * @param {string} [key='a'] - The dataset key to check.
     * @returns {boolean} True if annual glare data exists.
     */
    hasAnnualGlareData(key = 'a') {
        const ds = this.datasets[key];
        return !!(ds && ds.annualGlareResults && Object.keys(ds.annualGlareResults).length > 0);
    }

    /**
     * Correlates annual glare data with sun positions to generate data for a rose diagram.
     * @param {string} key - The dataset key ('a' or 'b').
     * @param {number} dgpThreshold - The DGP value above which an hour is considered to have glare.
     * @returns {object|null} An object with { labels, data } for the chart, or null.
     */
    getGlareRoseData(key, dgpThreshold) {
        if (!this.hasAnnualGlareData(key)) {
            console.warn(`Annual glare data not available for dataset '${key}'.`);
            return null;
        }

        const agr = this.datasets[key].annualGlareResults || {};
        const glareKey = agr.dgp ? 'dgp' : (agr.ga ? 'ga' : null);
        if (!glareKey) {
            console.warn(`Annual glare data found for dataset '${key}' but no supported metric key (dgp/ga).`);
            return null;
        }

        const dgpPointData = agr[glareKey]; // [point][hour]
        const numPoints = dgpPointData.length;
        if (numPoints === 0) return null;

        const bins = new Array(16).fill(0);
        const labels = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

        for (let h = 0; h < 8760; h++) {
            // Check if ANY point has glare at this hour
            let hasGlareThisHour = false;
            for (let p = 0; p < numPoints; p++) {
                if (dgpPointData[p][h] > dgpThreshold) {
                    hasGlareThisHour = true;
                    break;
                }
            }

            if (hasGlareThisHour) {
                const dayOfYear = Math.floor(h / 24) + 1;
                const solarTime = h % 24 + 0.5; // Use mid-hour for better accuracy
                const { altitude, azimuth } = this._calculateSunPosition(dayOfYear, solarTime);

                if (altitude > 0) {
                    // Radiance azimuth is 0=North, 90=East, so we adjust from math azimuth (0=East)
                    let azimuthDeg = azimuth * (180 / Math.PI);
                    azimuthDeg = (450 - azimuthDeg) % 360;

                    const sectorIndex = Math.floor((azimuthDeg + 11.25) / 22.5) % 16;
                    bins[sectorIndex]++;
                }
            }
        }
        return { labels, data: bins };
    }

    /**
     * Correlates annual daylight and glare data to produce a dataset for a scatter plot.
     * @param {number} dgpThreshold - The DGP value to count as a "glare hour".
     * @returns {object[]|null} An array of {x, y, pointId} objects for Chart.js.
     */
    getCombinedDaylightGlareData(dgpThreshold) {
        let illDataset = null;
        let glareDataset = null;
        let glareKey = null;

        // Find matching datasets:
        ['a', 'b'].forEach(key => {
            const ds = this.datasets[key];
            if (ds?.annualData?.length > 0) {
                illDataset = illDataset || ds;
            }
            if (ds?.annualGlareResults && !glareDataset) {
                if (ds.annualGlareResults.dgp?.length > 0) {
                    glareDataset = ds;
                    glareKey = 'dgp';
                } else if (ds.annualGlareResults.ga?.length > 0) {
                    glareDataset = ds;
                    glareKey = 'ga';
                }
            }
        });

        if (!illDataset || !glareDataset || !glareKey) {
            console.warn("Both annual illuminance (.ill) and annual glare (.dgp or .ga) files must be loaded.");
            return null;
        }

        const illData = illDataset.annualData; // [point][hour]
        const glareData = glareDataset.annualGlareResults[glareKey]; // [point][hour]
        const numPoints = illData.length;

        if (glareData.length !== numPoints) {
            console.error(`Mismatch between number of points in .ill (${numPoints}) and glare file (${glareData.length}) files.`);
            showAlert("The number of sensor points in the loaded .ill and glare files do not match.", "Data Mismatch");
            return null;
        }

        // Pre-calculate occupancy mask
        const occupiedHours = { start: 8, end: 18 };
        let totalOccupiedHoursInYear = 0;
        const occupiedMask = new Array(8760).fill(false);
        for (let h = 0; h < 8760; h++) {
            const date = new Date(2023, 0, 1 + Math.floor(h / 24));
            const dayOfWeek = date.getDay(); // 0=Sun, 6=Sat
            const hourOfDay = h % 24;
            if (hourOfDay >= occupiedHours.start && hourOfDay < occupiedHours.end && dayOfWeek > 0 && dayOfWeek < 6) {
                occupiedMask[h] = true;
                totalOccupiedHoursInYear++;
            }
        }

        if (totalOccupiedHoursInYear === 0) return [];

        const combinedData = [];

        for (let p = 0; p < numPoints; p++) {
            let glareHours = 0;
            let udiAutonomousHours = 0;

            for (let h = 0; h < 8760; h++) {
                if (occupiedMask[h]) {
                    if (glareData[p][h] > dgpThreshold) glareHours++;

                    const illuminance = illData[p][h];
                    if (illuminance >= 500 && illuminance < 2000) udiAutonomousHours++;
                }
            }

            combinedData.push({
                x: (udiAutonomousHours / totalOccupiedHoursInYear) * 100,
                y: (glareHours / totalOccupiedHoursInYear) * 100,
                pointId: p
            });
        }
        return combinedData;
    }

    /**
    * Calculates Daylight Autonomy (DA) for each sensor point.
    * DA is the percentage of occupied hours that a point is above a given illuminance threshold.
    * @param {number} thresholdLux - The illuminance threshold in lux.
    * @param {string} [key=null] - The dataset key to use. If null, uses the active view.
    * @returns {Promise<number[]|null>} A promise that resolves to an array of DA percentages, or null.
    */
    async calculateDaylightAutonomy(thresholdLux, key = null) {
        const activeKey = key || this.activeView;
        const dataset = this.datasets[activeKey];

        if (!this.hasAnnualData(activeKey)) {
            console.warn(`Daylight Autonomy calculation skipped for dataset '${activeKey}': No annual data.`);
            return null;
        }

        const annualData = dataset.annualData;
        const numPoints = annualData.length;
        const daPercentages = new Array(numPoints).fill(0);

        // Get occupancy mask (shared logic; DA uses the same default hours as annual metrics)
        const { mask: occupiedMask, total: totalOccupiedHours } = this._buildOccupiedMask({ start: 8, end: 18 });
        if (totalOccupiedHours === 0) {
            console.warn("No occupied hours found in schedule; cannot calculate DA.");
            return daPercentages; // Return array of zeros
        }

        for (let p = 0; p < numPoints; p++) {
            let hoursAboveThreshold = 0;
            for (let h = 0; h < 8760; h++) {
                if (occupiedMask[h] && annualData[p][h] >= thresholdLux) {
                    hoursAboveThreshold++;
                }
            }
            daPercentages[p] = (hoursAboveThreshold / totalOccupiedHours) * 100;
        }

        return daPercentages;
    }

    /**
     * Sets the active metric for 3D visualization and recalculates stats.
     * @param {'illuminance' | 'Photopic_lux' | 'EML' | 'CS' | 'CCT'} metricType - The metric to display.
     */
    setActiveMetricType(metricType) {
        this.activeMetricType = metricType;

        for (const key of ['a', 'b']) {
            const dataset = this.datasets[key];
            if (dataset && dataset.spectralResults && dataset.spectralResults[metricType]) {
                dataset.data = dataset.spectralResults[metricType];
                dataset.stats = this._calculateStats(dataset.data);
            }
        }

        this.calculateDifference();

        const activeStats = this.getActiveStats();
        if (activeStats) {
            this.updateColorScale(activeStats.min, activeStats.max, this.colorScale.palette);
        }
    }

    updateColorScale(min, max, palette) {
        this.colorScale.min = min;
        this.colorScale.max = max;
        this.colorScale.palette = palette;
    }

    /**
     * Gets an interpolated color for a value based on the current scale.
     * @param {number} value - The numerical value (e.g., illuminance).
     * @param {number|null} [minOverride=null] - Optional minimum for the color scale.
     * @param {number|null} [maxOverride=null] - Optional maximum for the color scale.
     * @returns {string} A hex color string (e.g., '#RRGGBB').
     */
    getColorForValue(value, minOverride = null, maxOverride = null) {
        if (this.activeView === 'diff' && minOverride === null && maxOverride === null) {
            const stats = this.differenceData.stats;
            if (!stats) return '#808080'; // Return grey if no diff data

            const maxAbs = Math.max(Math.abs(stats.min), Math.abs(stats.max));
            const min = -maxAbs;
            const max = maxAbs;

            const currentPalette = palettes.diverging;
            const normalized = (max - min > 0) ? (value - min) / (max - min) : 0.5;
            const colorIndex = normalized * (currentPalette.length - 1);

            const index1 = Math.floor(colorIndex);
            const index2 = Math.min(index1 + 1, currentPalette.length - 1);
            const fraction = colorIndex - index1;
            const hexToRgb = (hex) => {
                const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
                return result ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)] : [0, 0, 0];
            };
            const c1 = hexToRgb(currentPalette[index1]);
            const c2 = hexToRgb(currentPalette[index2]);
            const r = Math.round(c1[0] + (c2[0] - c1[0]) * fraction);
            const g = Math.round(c1[1] + (c2[1] - c1[1]) * fraction);
            const b = Math.round(c1[2] + (c2[2] - c1[2]) * fraction);
            const toHex = (c) => ('0' + c.toString(16)).slice(-2);
            return `#${toHex(r)}${toHex(g)}${toHex(b)}`;

        } else {
            const min = minOverride ?? this.colorScale.min;
            const max = maxOverride ?? this.colorScale.max;
            const { palette } = this.colorScale;
            const currentPalette = palettes[palette] || palettes.viridis;
            const clampedValue = Math.max(min, Math.min(value, max));
            const normalized = (max - min > 0) ? (clampedValue - min) / (max - min) : 0;
            const colorIndex = normalized * (currentPalette.length - 1);
            const index1 = Math.floor(colorIndex);
            const index2 = Math.min(index1 + 1, currentPalette.length - 1);
            const fraction = colorIndex - index1;
            const hexToRgb = (hex) => {
                const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
                return result ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)] : [0, 0, 0];
            };
            const c1 = hexToRgb(currentPalette[index1]);
            const c2 = hexToRgb(currentPalette[index2]);
            const r = Math.round(c1[0] + (c2[0] - c1[0]) * fraction);
            const g = Math.round(c1[1] + (c2[1] - c1[1]) * fraction);
            const b = Math.round(c1[2] + (c2[2] - c1[2]) * fraction);
            const toHex = (c) => ('0' + c.toString(16)).slice(-2);
            return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
        }
    }

    /**
     * Stores the result of an HDR file parse.
     * @param {THREE.DataTexture} texture - The texture object from RGBELoader.
     * @param {string} fileName - The name of the original file.
     */
    setHdrResult(texture, fileName) {
        this.hdrResult = {
            texture: texture,
            fileName: fileName
        };
    }

    /**
     * Generates binned data for a histogram chart.
     * @param {number} [numBins=20] - The number of bins for the histogram.
     * @returns {object} Data formatted for Chart.js.
     */
    getHistogramData(numBins = 20) {
        const data = this.getActiveData();
        const stats = this.getActiveStats();

        if (!data || data.length === 0 || !stats) return { labels: [], datasets: [] };

        const { min, max } = stats;
        const binWidth = (max - min) / numBins;
        const bins = new Array(numBins).fill(0);
        const labels = [];

        for (let i = 0; i < numBins; i++) {
            const binStart = min + i * binWidth;
            const binEnd = binStart + binWidth;
            labels.push(`${Math.round(binStart)} - ${Math.round(binEnd)}`);
        }

        data.forEach(value => {
            let binIndex = Math.floor((value - min) / binWidth);
            if (binIndex === numBins) binIndex--;
            if (binIndex >= 0 && binIndex < numBins) {
                bins[binIndex]++;
            }
        });

        return {
            labels: labels,
            datasets: [{
                label: 'Illuminance (lux)',
                data: bins,
                backgroundColor: 'rgba(54, 162, 235, 0.6)',
                borderColor: 'rgba(54, 162, 235, 1)',
                borderWidth: 1
            }]
        };
    }

    /**
     * Helper to get the data array for the currently active view.
     * @returns {number[] | null}
     */
    getActiveData() {
        if (this.activeView === 'diff') {
            return this.differenceData.data;
        }
        const activeDataset = this.datasets[this.activeView];
        return activeDataset ? activeDataset.data : null;
    }

    /**
     * Helper to get the stats object for the currently active view.
     * @returns {object | null}
     */
    getActiveStats() {
        if (this.activeView === 'diff') {
            return this.differenceData.stats;
        }
        const activeDataset = this.datasets[this.activeView];
        return activeDataset ? activeDataset.stats : null;
    }

    /**
     * Helper to get the glareResult object for the currently active view.
     * @returns {object | null}
     */
    getActiveGlareResult() {
        // For now, only dataset A can have a glare result that isn't grid-based
        const activeDataset = this.datasets[this.activeView];
        return activeDataset ? activeDataset.glareResult : null;
    }

    /**
     * Returns normalized KPIs for UI for a given run or the latest successful run.
     * @param {string|null} runId
     * @returns {object|null}
     */


    /**
     * Returns categorized errors for a given run or the latest run.
     * @param {string|null} runId
     * @returns {{fatal:string[], severe:string[], warning:string[]}|null}
     */


    /**
     * Checks if a given dataset has parsed lighting metrics.
     * @param {string} [key='a'] - The dataset key to check.
     * @returns {boolean} True if lighting metrics exist.
     */
    hasLightingMetrics(key = 'a') {
        const dataset = this.datasets[key];
        return !!(dataset && dataset.lightingMetrics);
    }

    /**
     * Gets the indices of all sensor points in a dataset that meet a specific condition.
     * @param {'a' | 'b'} key - The dataset to query.
     * @param {'<' | '>' | '<=' | '>='} condition - The comparison operator.
     * @param {number} value - The value to compare against.
     * @returns {number[]} An array of indices that meet the condition.
     */
    getPointIndicesByCondition(key, condition, value) {
        const dataset = this.datasets[key];
        if (!dataset || !dataset.data || dataset.data.length === 0) {
            return [];
        }

        const indices = [];
        const data = dataset.data;

        for (let i = 0; i < data.length; i++) {
            const pointValue = data[i];
            let conditionMet = false;
            switch (condition) {
                case '<': conditionMet = pointValue < value; break;
                case '>': conditionMet = pointValue > value; break;
                case '<=': conditionMet = pointValue <= value; break;
                case '>=': conditionMet = pointValue >= value; break;
            }
            if (conditionMet) {
                indices.push(i);
            }
        }
        return indices;
    }
}

export const resultsManager = new ResultsManager();
