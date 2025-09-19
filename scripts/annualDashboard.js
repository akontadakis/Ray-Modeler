// scripts/annualDashboard.js

import { resultsManager, palettes } from './resultsManager.js';
import { getNewZIndex, ensureWindowInView, initializePanelControls, showAlert } from './ui.js';

// Store chart instances to destroy/update them later
let sdaGauge = null;
let aseGauge = null;
let udiChart = null;
let savingsGauge = null;
let powerGauge = null;
let glareRoseChart = null;
let combinedAnalysisChart = null;
let csGauge = null;
let lpdGauge = null;
let energyGauge = null;
let energySavingsGauge = null;
let temporalMapPanel = null, temporalMapCanvas = null, temporalMapTooltip = null;

/**
 * Opens the glare rose panel and triggers chart generation.
 */
export async function openGlareRoseDiagram() {
    const panel = document.getElementById('glare-rose-panel');
    if (!panel) return;

    if (!resultsManager.hasAnnualGlareData('a')) {
        const { showAlert } = await import('./ui.js');
        showAlert('Please load an annual glare results file (.dgp) first.', 'No Data');
        return;
    }
    
    initializePanelControls(panel);
    panel.classList.remove('hidden');
    panel.style.zIndex = getNewZIndex();
    ensureWindowInView(panel);
    
    // Initial chart generation
    updateGlareRoseDiagram();
}

/**
* Calculates and renders the glare rose diagram based on the current threshold.
*/
export function updateGlareRoseDiagram() {
    const thresholdInput = document.getElementById('glare-rose-threshold');
    if (!thresholdInput) return;

    const threshold = parseFloat(thresholdInput.value);
    const chartData = resultsManager.getGlareRoseData('a', threshold);
    
    if (chartData) {
        createGlareRoseChart(chartData);
    }
}

/**
 * Creates and renders the glare rose polar area chart.
 * @param {object} chartData - An object with { labels, data }.
 */
function createGlareRoseChart(chartData) {
    const canvas = document.getElementById('glare-rose-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (glareRoseChart) {
        glareRoseChart.destroy();
    }

    // Get theme colors for the chart
    const style = getComputedStyle(document.documentElement);
    const textColor = style.getPropertyValue('--text-secondary').trim();
    const gridColor = style.getPropertyValue('--grid-color').trim();
    const accentColor = style.getPropertyValue('--accent-color').trim();
    const accentColorTranslucent = style.getPropertyValue('--accent-color-translucent').trim();

    glareRoseChart = new Chart(ctx, {
        type: 'polarArea',
        data: {
            labels: chartData.labels,
            datasets: [{
                label: 'Glare Hours',
                data: chartData.data,
                backgroundColor: accentColorTranslucent,
                borderColor: accentColor,
                borderWidth: 1.5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                r: {
                    pointLabels: {
                        display: true,
                        centerPointLabels: true,
                        font: {
                            size: 11
                        },
                        color: textColor
                    },
                    ticks: {
                        color: textColor,
                        backdropColor: 'transparent',
                        z: 1
                    },
                    grid: {
                        color: gridColor
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `${context.dataset.label}: ${context.raw} hours`;
                        }
                    }
                }
            },
            // Start the chart with North at the top
            startAngle: -90 - (360 / 16 / 2)
        }
    });
}

/**
 * Opens the combined daylight/glare analysis panel and triggers chart generation.
 */
export function openCombinedAnalysisPanel() {
    const panel = document.getElementById('combined-analysis-panel');
    if (!panel) return;

    const hasIll = resultsManager.hasAnnualData('a') || resultsManager.hasAnnualData('b');
    const hasDgp = resultsManager.hasAnnualGlareData('a') || resultsManager.hasAnnualGlareData('b');

    if (!hasIll || !hasDgp) {
        showAlert('Please load both an annual illuminance (.ill) file and an annual DGP (.dgp) file to use this feature.', 'Data Missing');
        return;
    }
    
    initializePanelControls(panel);
    panel.classList.remove('hidden');
    panel.style.zIndex = getNewZIndex();
    ensureWindowInView(panel);
    
    updateCombinedAnalysisChart();
}

/**
* Calculates and renders the combined analysis scatter plot based on the current threshold.
*/
export function updateCombinedAnalysisChart() {
    const thresholdInput = document.getElementById('combined-glare-threshold');
    if (!thresholdInput) return;

    const threshold = parseFloat(thresholdInput.value);
    const chartData = resultsManager.getCombinedDaylightGlareData(threshold);
    
    if (chartData) {
        createCombinedAnalysisChart(chartData);
    }
}

/**
 * Creates and renders the combined daylight vs. glare scatter plot.
 * @param {object[]} chartData - An array of {x, y, pointId} objects.
 */
function createCombinedAnalysisChart(chartData) {
    const canvas = document.getElementById('combined-analysis-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (combinedAnalysisChart) {
        combinedAnalysisChart.destroy();
    }

    const style = getComputedStyle(document.documentElement);
    const textColor = style.getPropertyValue('--text-secondary').trim();
    const gridColor = style.getPropertyValue('--grid-color').trim();
    const pointColor = style.getPropertyValue('--line-color').trim() + 'B3';

    const quadrantBgs = {
        tr: 'rgba(239, 68, 68, 0.1)',   // Problematic (High Daylight, High Glare)
        tl: 'rgba(139, 92, 246, 0.1)',  // Worst (Low Daylight, High Glare)
        br: 'rgba(34, 197, 94, 0.1)',   // Ideal (High Daylight, Low Glare)
        bl: 'rgba(59, 130, 246, 0.1)'   // Underlit (Low Daylight, Low Glare)
    };

    const quadrantBackgroundPlugin = {
        id: 'quadrantBackground',
        beforeDraw(chart, args, options) {
            const { ctx, chartArea: { left, top, right, bottom }, scales: { x, y } } = chart;
            const xThresholdPixel = x.getPixelForValue(options.xThreshold);
            const yThresholdPixel = y.getPixelForValue(options.yThreshold);
            ctx.save();
            ctx.fillStyle = options.colors.tr;
            ctx.fillRect(xThresholdPixel, top, right - xThresholdPixel, yThresholdPixel - top);
            ctx.fillStyle = options.colors.tl;
            ctx.fillRect(left, top, xThresholdPixel - left, yThresholdPixel - top);
            ctx.fillStyle = options.colors.br;
            ctx.fillRect(xThresholdPixel, yThresholdPixel, right - xThresholdPixel, bottom - yThresholdPixel);
            ctx.fillStyle = options.colors.bl;
            ctx.fillRect(left, yThresholdPixel, xThresholdPixel - left, bottom - yThresholdPixel);
            ctx.restore();
        }
    };

    combinedAnalysisChart = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [{
                label: 'Sensor Point',
                data: chartData,
                backgroundColor: pointColor,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    type: 'linear', position: 'bottom',
                    title: { display: true, text: '% Occupied Hours with Useful Daylight (UDI 500-2000lx)', color: textColor },
                    min: 0, max: 100, ticks: { color: textColor }, grid: { color: gridColor }
                },
                y: {
                    title: { display: true, text: '% Occupied Hours with Glare (DGP > Threshold)', color: textColor },
                    min: 0, max: 100, ticks: { color: textColor }, grid: { color: gridColor }
                }
            },
            plugins: {
                quadrantBackground: {
                    xThreshold: 50, yThreshold: 10, colors: quadrantBgs
                },
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const d = context.raw;
                            return `Point #${d.pointId}: (UDI: ${d.x.toFixed(1)}%, Glare: ${d.y.toFixed(1)}%)`;
                        }
                    }
                }
            }
        },
        plugins: [quadrantBackgroundPlugin]
    });
}

/**
 * Creates a semi-circle doughnut chart to act as a gauge.
 * @param {string} canvasId - The ID of the canvas element.
 * @param {number} value - The percentage value to display (0-100).
 * @param {string} color - The primary color for the gauge.
 * @returns {Chart} A new Chart.js instance.
 */
function createGauge(canvasId, value, color) {
    const ctx = document.getElementById(canvasId).getContext('2d');
    const data = {
        datasets: [{
            data: [value, 100 - value],
            backgroundColor: [color, 'var(--grid-color)'],
            borderWidth: 0,
            circumference: 270,
            rotation: 225,
        }]
    };

    return new Chart(ctx, {
        type: 'doughnut',
        data: data,
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { display: false },
                tooltip: { enabled: false }
            },
            cutout: '80%'
        }
    });
}

/**
 * Creates a horizontal stacked bar chart for UDI results.
 * @param {string} canvasId - The ID of the canvas element.
 * @param {object} udiData - An object with { insufficient, autonomous, exceeded }.
 * @returns {Chart} A new Chart.js instance.
 */
function createUdiChart(canvasId, udiData) {
    // Register the plugin for use
    Chart.register(ChartDataLabels);

    const ctx = document.getElementById(canvasId).getContext('2d');
    const data = {
        labels: [''], // Use an empty label for a cleaner look
        datasets: [
            {
                label: 'Insufficient (<100 lx)',
                data: [udiData.insufficient],
                backgroundColor: '#ef4444', // Red
            },
            {
                label: 'Autonomous (100-2000 lx)',
                data: [udiData.autonomous],
                backgroundColor: '#22c55e', // Green
            },
            {
                label: 'Exceeded (>2000 lx)',
                data: [udiData.exceeded],
                backgroundColor: '#f97316', // Orange
            }
        ]
    };

    return new Chart(ctx, {
        type: 'bar',
        data: data,
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    stacked: true,
                    max: 100,
                    ticks: {
                        callback: (value) => value + "%"
                    },
                    grid: { color: 'var(--grid-color-faint)' }
                },
                y: {
                    stacked: true,
                    grid: { display: false }
                }
            },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { boxWidth: 12, font: { size: 10 } }
                },
                tooltip: {
                    callbacks: {
                        label: (context) => `${context.dataset.label}: ${context.raw.toFixed(1)}%`
                    }
                },
                // Add datalabels configuration here
                datalabels: {
                    color: '#ffffff', // White text for good contrast
                    font: {
                        weight: 'bold'
                    },
                    // Display the value only if it's large enough to be readable
                    display: function(context) {
                        return context.dataset.data[context.dataIndex] > 5; // Hide labels for segments smaller than 5%
                    },
                    // Format the label as a percentage with one decimal place
                    formatter: (value) => {
                        return value.toFixed(1) + '%';
                    }
                }
            }
        }
    });
}

/**
 * Gets the base64 encoded image string for a given chart instance.
 * @param {Chart} chartInstance - The Chart.js instance.
 * @returns {string|null} The base64 data URL or null if the chart doesn't exist.
 */
function getChartAsBase64(chartInstance) {
    if (chartInstance && typeof chartInstance.toBase64Image === 'function') {
        return chartInstance.toBase64Image();
    }
    return null;
}

/**
 * Gathers all visible dashboard charts as base64 image strings.
 * @returns {object} An object containing the base64 strings for each chart.
 */
export function getDashboardChartsAsBase64() {
    return {
        udiChart: getChartAsBase64(udiChart),
        sdaGauge: getChartAsBase64(sdaGauge),
        aseGauge: getChartAsBase64(aseGauge),
        glareRoseChart: getChartAsBase64(glareRoseChart),
        combinedAnalysisChart: getChartAsBase64(combinedAnalysisChart),
        csGauge: getChartAsBase64(csGauge),
    };
}

/**
* Clears and hides the lighting energy dashboard.
*/
export function clearLightingEnergyDashboard() {
    document.getElementById('lighting-energy-dashboard')?.classList.add('hidden');
    if (lpdGauge) lpdGauge.destroy();
    if (energyGauge) energyGauge.destroy();
    if (energySavingsGauge) energySavingsGauge.destroy();

    lpdGauge = null;
    energyGauge = null;
    energySavingsGauge = null;

    const lpdVal = document.getElementById('lpd-val');
    const energyVal = document.getElementById('energy-val');
    const savingsVal = document.getElementById('energy-savings-val');

    if(lpdVal) lpdVal.textContent = '--';
    if(energyVal) energyVal.textContent = '--';
    if(savingsVal) savingsVal.textContent = '--';
}

/**
* Updates the UI with lighting energy metrics.
* @param {object | null} metrics - The calculated energy metrics from resultsManager.
*/
export function updateLightingEnergyDashboard(metrics) {
clearLightingEnergyDashboard();
    if (!metrics) return;

    const dashboard = document.getElementById('lighting-energy-dashboard');
    if(!dashboard) return;

    dashboard.classList.remove('hidden');

    const lpdEl = document.getElementById('lpd-val');
    const energyEl = document.getElementById('energy-val');
    const savingsEl = document.getElementById('energy-savings-val');

   if(lpdEl) lpdEl.textContent = metrics.lpd.toFixed(2);
    if(energyEl) energyEl.textContent = metrics.annualEnergy.toFixed(0);
    if(savingsEl) savingsEl.textContent = metrics.savings.toFixed(1);

    // Create gauges (assuming max values for visualization purposes)
    // LPD: Target might be ~10 W/m^2. Scale accordingly.
    lpdGauge = createGauge('lpd-gauge', (metrics.lpd / 10) * 100, '#f59e0b');
    // Energy Savings: value is already a percentage
    energySavingsGauge = createGauge('energy-savings-gauge', metrics.savings, '#4ade80');
    // Energy: We need a baseline/max to create a meaningful gauge.
    // For this example, let's assume a max of 50 kWh/m^2.
    energyGauge = createGauge('energy-gauge', (metrics.annualEnergy / 50) * 100, '#f87171');
}

/**
 * Clears and hides the annual metrics dashboard.
 */
export function clearAnnualDashboard() {
    document.getElementById('annual-metrics-dashboard').classList.add('hidden');

    if (sdaGauge) sdaGauge.destroy();
    if (aseGauge) aseGauge.destroy();
    if (udiChart) udiChart.destroy();
    if (savingsGauge) savingsGauge.destroy();
    if (powerGauge) powerGauge.destroy();
    sdaGauge = null;
    aseGauge = null;
    udiChart = null;
    savingsGauge = null;
    powerGauge = null;

    document.getElementById('sda-value').textContent = '--%';
    document.getElementById('ase-value').textContent = '--%';
    document.getElementById('savings-value').textContent = '--%';
    document.getElementById('power-value').textContent = '--';
}

/**
* Updates the UI with annual daylight metrics and renders the charts.
* @param {object | null} metrics - The calculated daylighting metrics object from resultsManager.
* @param {object | null} lightingMetrics - The calculated lighting metrics object.
*/
export function updateAnnualMetricsDashboard(metrics, lightingMetrics) {
    clearAnnualDashboard(); 
    
    if (!metrics) return;

    document.getElementById('annual-metrics-dashboard').classList.remove('hidden');
    document.getElementById('sda-value').textContent = `${metrics.sDA.toFixed(1)}%`;
    document.getElementById('ase-value').textContent = `${metrics.ASE.toFixed(1)}%`;

    sdaGauge = createGauge('sda-gauge', metrics.sDA, '#3b82f6'); 
    aseGauge = createGauge('ase-gauge', metrics.ASE, '#f59e0b');
    udiChart = createUdiChart('udi-chart', metrics.UDI);

    if (lightingMetrics) {
        document.getElementById('lighting-metrics-dashboard').classList.remove('hidden');
        document.getElementById('savings-value').textContent = `${lightingMetrics.savings.toFixed(1)}%`;
        document.getElementById('power-value').textContent = `${lightingMetrics.avgPower.toFixed(2)}`;

        // Green for savings
        savingsGauge = createGauge('savings-gauge', lightingMetrics.savings, '#4ade80');
        // Red for power used (the value is a fraction, so multiply by 100 for the gauge)
        powerGauge = createGauge('power-gauge', lightingMetrics.avgPower * 100, '#f87171');
    }
}

/**
* Opens and renders the temporal map for a specific sensor point.
* @param {number} pointIndex The global index of the sensor point.
*/
export function openTemporalMapForPoint(pointIndex) {
    const data = resultsManager.getAnnualDataForPoint('a', pointIndex);
    if (!data) {
        console.error(`No annual data found for point index ${pointIndex}`);
        return;
    }

    if (!temporalMapPanel) {
        temporalMapPanel = document.getElementById('temporal-map-panel');
        initializePanelControls(temporalMapPanel);
    }

    document.getElementById('temporal-map-point-id').textContent = pointIndex;
    temporalMapPanel.classList.remove('hidden');
    temporalMapPanel.style.zIndex = getNewZIndex();
    ensureWindowInView(temporalMapPanel);

    drawTemporalMap(data);
}

/**
* Draws the 24x365 temporal heatmap onto the canvas.
* @param {Float32Array} data - The 8760 hourly illuminance values for one point.
*/
function drawTemporalMap(data) {
    if (!temporalMapCanvas) {
        temporalMapCanvas = document.getElementById('temporal-map-canvas');
    }
    const canvas = temporalMapCanvas;
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = width;
    canvas.height = height;

    const margin = { top: 30, right: 60, bottom: 20, left: 40 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    const cellWidth = chartWidth / 365;
    const cellHeight = chartHeight / 24;

    // Draw heatmap cells
    for (let day = 0; day < 365; day++) {
        for (let hour = 0; hour < 24; hour++) {
            const index = day * 24 + hour;
            const value = data[index];
            ctx.fillStyle = resultsManager.getColorForValue(value);
            ctx.fillRect(margin.left + day * cellWidth, margin.top + hour * cellHeight, cellWidth + 0.5, cellHeight + 0.5); // Overlap slightly to avoid gaps
        }
    }

    // Draw labels and axes
    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim();
    ctx.fillStyle = textColor;
    ctx.font = '10px Inter, sans-serif';

    // Y-axis labels (Hours)
    for (let hour = 0; hour < 24; hour += 2) {
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${hour}:00`, margin.left - 5, margin.top + (hour + 0.5) * cellHeight);
    }

    // X-axis labels (Months)
    const monthStarts = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    ctx.strokeStyle = 'rgba(128, 128, 128, 0.2)';
    monthStarts.forEach((startDay, i) => {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const xPos = margin.left + (startDay + 15) * cellWidth; // Position label in middle of month
        ctx.fillText(monthNames[i], xPos, margin.top - 5);
        if (i > 0) {
            ctx.beginPath();
            ctx.moveTo(margin.left + startDay * cellWidth, margin.top);
            ctx.lineTo(margin.left + startDay * cellWidth, margin.top + chartHeight);
            ctx.stroke();
        }
    });

    // Color Scale Legend
    const legendWidth = 12;
    const legendX = width - margin.right + 15;
    const legendY = margin.top;
    const legendHeight = chartHeight;
    const gradient = ctx.createLinearGradient(0, legendY, 0, legendY + legendHeight);
    const palette = palettes[resultsManager.colorScale.palette] || palettes.viridis;
    palette.slice().reverse().forEach((color, i) => { // Reverse to have max at top
        gradient.addColorStop(i / (palette.length - 1), color);
    });
    ctx.fillStyle = gradient;
    ctx.fillRect(legendX, legendY, legendWidth, legendHeight);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(Math.round(resultsManager.colorScale.max), legendX + legendWidth + 5, legendY);
    ctx.textBaseline = 'bottom';
    ctx.fillText(Math.round(resultsManager.colorScale.min), legendX + legendWidth + 5, legendY + legendHeight);

    setupTemporalMapTooltip(canvas, data, margin, cellWidth, cellHeight);
}

/**
 * Sets up the mousemove/mouseleave events for the temporal map tooltip.
 */
function setupTemporalMapTooltip(canvas, data, margin, cellWidth, cellHeight) {
    if (!temporalMapTooltip) {
        temporalMapTooltip = document.createElement('div');
        temporalMapTooltip.id = 'temporal-map-tooltip';
        temporalMapTooltip.className = 'absolute hidden p-2 text-xs bg-[--tooltip-bg] text-[--tooltip-text] rounded shadow-lg pointer-events-none z-[999]';
        canvas.parentElement.appendChild(temporalMapTooltip);
    }

    canvas.onmousemove = (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (x > margin.left && x < rect.width - margin.right && y > margin.top && y < rect.height - margin.bottom) {
            const day = Math.floor((x - margin.left) / cellWidth);
            const hour = Math.floor((y - margin.top) / cellHeight);

            const index = day * 24 + hour;
            const value = data[index];
            const date = new Date(2023, 0, day + 1);

            temporalMapTooltip.style.left = `${x + 15}px`;
            temporalMapTooltip.style.top = `${y + 15}px`;
            temporalMapTooltip.innerHTML = `
                <strong>${date.toLocaleDateString('en-us', {month: 'short', day: 'numeric'})}, ${hour}:00&ndash;${hour+1}:00</strong><br>
                Value: ${value.toFixed(1)} lux
            `;
            temporalMapTooltip.classList.remove('hidden');
        } else {
            temporalMapTooltip.classList.add('hidden');
        }
    };

    canvas.onmouseleave = () => {
        temporalMapTooltip.classList.add('hidden');
    };
}

/**
* Clears and hides the circadian metrics dashboard.
*/
export function clearCircadianDashboard() {
    document.getElementById('circadian-metrics-dashboard')?.classList.add('hidden');
    if (csGauge) csGauge.destroy();
    csGauge = null;

    const csVal = document.getElementById('cs-value');
    const emlVal = document.getElementById('eml-value');
    const cctVal = document.getElementById('cct-value');
    const wellList = document.getElementById('well-compliance-checklist');

    if (csVal) csVal.textContent = '--';
    if (emlVal) emlVal.textContent = '--';
    if (cctVal) cctVal.textContent = '--';
    if (wellList) wellList.innerHTML = '';
}

/**
* Updates the UI with circadian lighting metrics.
* @param {object | null} metrics - The calculated circadian metrics from resultsManager.
*/
export function updateCircadianDashboard(metrics) {
    clearCircadianDashboard();
    if (!metrics) return;

    const dashboard = document.getElementById('circadian-metrics-dashboard');
    if (!dashboard) return;

    dashboard.classList.remove('hidden');
    
    const cs = metrics.avg_cs || 0;
    const eml = metrics.avg_eml || 0;
    const cct = metrics.avg_cct || 0;
    
    document.getElementById('cs-value').textContent = cs.toFixed(3);
    document.getElementById('eml-value').textContent = eml.toFixed(0);
    document.getElementById('cct-value').textContent = cct.toFixed(0);
    
    // Create CS Gauge (0 to 0.7 scale)
    const csPercentage = (cs / 0.7) * 100;
    csGauge = createGauge('cs-gauge', csPercentage, '#8b5cf6');

    // WELL v2 L03 Compliance Check
    const wellList = document.getElementById('well-compliance-checklist');
    const checkCompliance = (threshold, label) => {
        const pass = eml >= threshold;
        const li = document.createElement('li');
        li.className = `flex items-center ${pass ? 'text-green-500' : 'text-red-500'}`;
        li.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${pass ? 'M5 13l4 4L19 7' : 'M6 18L18 6M6 6l12 12'}" /></svg> ${label}`;
        wellList.appendChild(li);
    };

    wellList.innerHTML = '';
    checkCompliance(125, 'Min Threshold: 125 EML');
    checkCompliance(200, 'Enhanced Threshold: 200 EML');
}