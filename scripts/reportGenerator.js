// scripts/reportGenerator.js

import { project } from './project.js';
import { resultsManager } from './resultsManager.js';
import { captureSceneSnapshot } from './scene.js';
import { getDashboardChartsAsBase64 } from './annualDashboard.js';
import { showAlert } from './ui.js';
import { getDom } from './dom.js';

/**
 * Handles the collection of data and generation of a self-contained HTML report.
 */
class ReportGenerator {
    constructor() {
        this.data = {};
    }

    /**
     * Gathers all necessary data, generates an HTML report, and opens it in a new tab.
     */
    async generate() {
        showAlert('Generating report, please wait...', 'In Progress');

        try {
            // Use a brief timeout to allow the "In Progress" alert to render
            await new Promise(resolve => setTimeout(resolve, 50));

            await this._gatherData();
            const htmlContent = this._buildHtml();
            const outcome = await this._displayReport(htmlContent);

            this._showSuccessMessage(outcome);

        } catch (error) {
            console.error("Failed to generate report:", error);
            showAlert(`Failed to generate report: ${error.message}`, 'Error');
        }
    }

    /**
     * Collects all data required for the report from various managers.
     * @private
     */
    async _gatherData() {
        const projectData = await project.gatherAllProjectData();

        // Select the dataset key for the report:
        // 1) Prefer activeView when not 'diff' and has stats.
        // 2) Else prefer 'a' if it has stats, else 'b'.
        let reportDataKey = resultsManager.activeView;
        if (
            reportDataKey === 'diff' ||
            !resultsManager.datasets[reportDataKey] ||
            !resultsManager.datasets[reportDataKey].stats
        ) {
            if (resultsManager.datasets.a?.stats) {
                reportDataKey = 'a';
            } else if (resultsManager.datasets.b?.stats) {
                reportDataKey = 'b';
            } else {
                reportDataKey = 'a'; // fallback, will error below if truly empty
            }
        }

        const activeDataset = resultsManager.datasets[reportDataKey];
        if (!activeDataset) {
            throw new Error("No active dataset found to generate a report from.");
        }

        // Annual metrics (only if annual-illuminance present)
        const hasAnnual = resultsManager.hasResult(reportDataKey, 'annual-illuminance');
        const annualMetrics = hasAnnual
            ? resultsManager.calculateAnnualMetrics(reportDataKey, {})
            : null;

        // Circadian summary (if present)
        const circadianMetrics = resultsManager.hasResult(reportDataKey, 'circadian-summary')
            ? resultsManager.getResult(reportDataKey, 'circadian-summary')
            : activeDataset.circadianMetrics || null;

        // Glare PIT (evalglare) from chosen dataset
        const glareResult = resultsManager.hasResult(reportDataKey, 'evalglare-pit')
            ? resultsManager.getResult(reportDataKey, 'evalglare-pit')
            : activeDataset.glareResult || null;



        // Climate summaries (if EPW loaded)
        const climate = resultsManager.hasResult(null, 'epw-climate')
            ? {
                monthlySolar: resultsManager.getMonthlySolarData(),
                monthlyTemp: resultsManager.getMonthlyTemperatureData(),
                windRose: resultsManager.getWindRoseData()
            }
            : null;

        // Lighting metrics (if computed for the chosen dataset)
        const lightingMetrics = activeDataset.lightingMetrics || null;

        // The unit depends on what was actually loaded: a daylight-factor grid is a
        // percentage and an irradiance grid is W/m2, not lux.
        const quantity = typeof resultsManager.getQuantityForDataset === 'function'
            ? resultsManager.getQuantityForDataset(reportDataKey)
            : { label: 'Illuminance', unit: 'lux' };

        this.data = {
            projectData,
            quantity,
            stats: activeDataset.stats || null,
            annualMetrics,
            glareResult,
            circadianMetrics,

            climate,
            lightingMetrics,
            charts: getDashboardChartsAsBase64(),
            sceneImage: captureSceneSnapshot(),
            generationDate: new Date().toLocaleString(),
        };
    }

    /**
     * Opens the generated HTML content for the user.
     *
     * Inside Electron a plain window.open() on a blob: URL is dropped:
     * setWindowOpenHandler denies every renderer-requested window and blob: is
     * not an allowed external URL, so the report never appeared while the UI
     * still announced a new tab. There, the main process writes the report to a
     * file and hands it to the OS instead. In a browser the popup can still be
     * blocked, so a failed window.open falls back to a download.
     *
     * @private
     * @param {string} htmlContent - The complete HTML string of the report.
     * @returns {Promise<{mode: 'app'|'tab'|'download', path?: string, fileName?: string}>}
     */
    async _displayReport(htmlContent) {
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        const projectName = this.data?.projectData?.projectInfo?.['project-name'] || 'report';
        const fileName = `${projectName}_report_${stamp}.html`;

        if (window.electronAPI?.openReport) {
            const result = await window.electronAPI.openReport({ html: htmlContent, fileName });
            if (result?.success) {
                return { mode: 'app', path: result.path };
            }
            console.error('openReport failed:', result?.error);
        }

        const blob = new Blob([htmlContent], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const tab = window.open(url, '_blank');
        if (tab) {
            return { mode: 'tab', fileName };
        }

        // Popup blocked, or the host denied the window: save the file instead.
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        return { mode: 'download', fileName };
    }

    /**
     * Updates the UI alert to inform the user of successful report generation.
     * @private
     */
    _showSuccessMessage(outcome) {
        const dom = getDom();
        if (!dom['custom-alert-message'] || !dom['custom-alert-title']) return;

        let text;
        if (outcome?.mode === 'app') {
            text = `The report opened in your default browser. Print it or save it as a PDF from there. The file is at: ${outcome.path}`;
        } else if (outcome?.mode === 'download') {
            text = `The report was saved as ${outcome.fileName}. Open it in your browser to print it or save it as a PDF.`;
        } else {
            text = 'Your report has been opened in a new tab. You can now print or save it as a PDF from your browser.';
        }

        // Plain text: the path and the file name come from user-supplied values.
        dom['custom-alert-message'].textContent = text;
        dom['custom-alert-title'].textContent = 'Report Generated';
    }

    /**
     * Constructs the full HTML string for the report by assembling its components.
     * @private
     * @returns {string} A self-contained HTML document string.
     */
    _buildHtml() {
        const { projectData } = this.data;
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Analysis Report: ${projectData.projectInfo['project-name']}</title>
                ${this._buildStyles()}
            </head>
            <body>
                <div class="container">
                    ${this._buildHeader()}
                    <main>
                        ${this._buildProjectInfoSection()}
                        ${this._buildSceneSnapshotSection()}
                        ${this._buildKeyMetricsSection()}

                        ${this._buildClimateSection()}
                        ${this._buildLightingSection()}
                        ${this._buildChartsSection()}
                    </main>
                    ${this._buildFooter()}
                </div>
            </body>
            </html>
        `;
    }

    // --- HTML Component Builders ---

    /** @private */
    _buildStyles() {
        return `
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
            body { font-family: 'Inter', sans-serif; line-height: 1.6; color: #333; background-color: #f8f9fa; margin: 0; padding: 0; }
            .container { max-width: 800px; margin: 20px auto; padding: 20px; background-color: #fff; box-shadow: 0 0 10px rgba(0,0,0,0.1); border-radius: 8px; }
            header, footer { text-align: center; padding-bottom: 20px; border-bottom: 1px solid #eee; margin-bottom: 20px; }
            footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; border-bottom: none; font-size: 0.8em; color: #777; }
            h1 { color: #222; }
            h2 { color: #444; border-bottom: 2px solid #5c9ce5; padding-bottom: 5px; margin-top: 30px; }
            .section { margin-bottom: 30px; }
            .metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin-top: 20px; }
            .metric-card { background-color: #f1f3f5; border-radius: 6px; padding: 15px; text-align: center; border: 1px solid #dee2e6; }
            .metric-label { font-size: 0.9em; color: #555; margin-bottom: 8px; }
            .metric-value { font-size: 1.5em; font-weight: 600; color: #000; }
            ul { list-style-type: none; padding: 0; }
            li { background: #f8f9fa; margin-bottom: 5px; padding: 8px 12px; border-radius: 4px; }
            .chart-container img, .snapshot-container img { max-width: 100%; height: auto; margin-top: 15px; border: 1px solid #ddd; border-radius: 4px; }
            @media print {
                body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                .container { box-shadow: none; border: 1px solid #ddd; margin: 0; max-width: 100%;}
            }
        </style>`;
    }

    /** @private */
    _buildHeader() {
        const { projectData, generationDate } = this.data;
        return `
            <header>
                <h1>Analysis Report</h1>
                <p><strong>Project:</strong> ${projectData.projectInfo['project-name'] || 'N/A'}</p>
                <p><strong>Generated on:</strong> ${generationDate}</p>
            </header>`;
    }

    /** @private */
    _buildProjectInfoSection() {
        const { projectInfo } = this.data.projectData;
        const { room } = this.data.projectData.geometry;
        return `
            <div class="section">
                <h2>Project Information</h2>
                <ul>
                    <li><strong>Building Type:</strong> ${projectInfo['building-type'] || 'N/A'}</li>
                    <li><strong>Location:</strong> Lat: ${projectInfo.latitude}, Lon: ${projectInfo.longitude}</li>
                    <li><strong>Room Dimensions:</strong> ${room.width}m (W) &times; ${room.length}m (L) &times; ${room.height}m (H)</li>
                </ul>
            </div>`;
    }

    /** @private */
    _buildSceneSnapshotSection() {
        return `
            <div class="section">
                <h2>3D Scene Snapshot</h2>
                <div class="snapshot-container">
                    <img src="${this.data.sceneImage}" alt="3D Scene Snapshot" />
                </div>
            </div>`;
    }

    /** @private */
    _buildKeyMetricsSection() {
        const { stats, annualMetrics, glareResult, circadianMetrics, quantity } = this.data;
        const hasMetrics = stats || annualMetrics || glareResult || circadianMetrics;

        if (!hasMetrics) return '';

        // Every one of these can be missing or null in a legitimate run: DGP is null on
        // a UGR-only report, and the circadian fields come from an unvalidated user JSON.
        // An unguarded .toFixed() on any of them aborted the entire report.
        const q = quantity || { label: 'Illuminance', unit: 'lux' };

        return `
            <div class="section">
                <h2>Key Metrics Summary</h2>
                <div class="metric-grid">
                    ${this._buildMetricCard(`Average ${q.label}`, this._fmt(stats?.avg, 1), q.unit)}
                    ${stats ? this._buildMetricCard('Uniformity (Uo)', this._fmt(Number.isFinite(stats.uniformity) ? stats.uniformity : (stats.avg > 0 ? stats.min / stats.avg : 0), 2)) : ''}
                    ${this._buildMetricCard('sDA <sub>300/50%</sub>', this._fmt(annualMetrics?.sDA, 1), '%')}
                    ${annualMetrics ? this._buildMetricCard('ASE <sub>1000,250h</sub>', Number.isFinite(annualMetrics.ASE) ? annualMetrics.ASE.toFixed(1) : 'n/a', Number.isFinite(annualMetrics.ASE) ? '%' : '') : ''}
                    ${this._buildMetricCard('DGP', this._fmt(glareResult?.dgp, 3))}
                    ${this._buildMetricCard('UGR', this._fmt(glareResult?.ugr, 1))}
                    ${this._buildMetricCard('Avg. Circadian Stimulus', this._fmt(circadianMetrics?.avg_cs, 3))}
                    ${this._buildMetricCard('Avg. EML', this._fmt(circadianMetrics?.avg_eml, 0), 'lux')}
                    ${this._buildMetricCard('Avg. CCT', this._fmt(circadianMetrics?.avg_cct, 0), 'K')}
                </div>
            </div>`;
    }

    /**
     * Formats a value that may be absent, null or non-numeric (circadian fields come
     * from a user-supplied JSON summary, and `dgp` is explicitly null on a UGR-only
     * evalglare report). Returns null so _buildMetricCard omits the card entirely.
     * @private
     * @param {*} value
     * @param {number} digits
     * @returns {string|null}
     */
    _fmt(value, digits) {
        const n = Number(value);
        return Number.isFinite(n) ? n.toFixed(digits) : null;
    }

    /** @private */


    /** @private */
    _buildClimateSection() {
        const { climate } = this.data;
        if (!climate) return '';

        const { monthlySolar, monthlyTemp, windRose } = climate;
        if (!monthlySolar && !monthlyTemp && !windRose) return '';

        const monthLabels = monthlySolar?.labels || monthlyTemp?.labels || [];

        const solarRows = monthlySolar
            ? monthLabels.map((m, i) => `
            <tr >
                    <td>${m}</td>
                    <td class="text-right">${(monthlySolar.dni[i] || 0).toFixed(2)}</td>
                    <td class="text-right">${(monthlySolar.dhi[i] || 0).toFixed(2)}</td>
                </tr> `).join('')
            : '';

        const tempRows = monthlyTemp
            ? monthLabels.map((m, i) => `
            <tr >
                    <td>${m}</td>
                    <td class="text-right">${(monthlyTemp.min[i] || 0).toFixed(1)}</td>
                    <td class="text-right">${(monthlyTemp.avg[i] || 0).toFixed(1)}</td>
                    <td class="text-right">${(monthlyTemp.max[i] || 0).toFixed(1)}</td>
                </tr> `).join('')
            : '';

        const hasSolar = !!monthlySolar;
        const hasTemp = !!monthlyTemp;
        const hasWind = !!windRose;

        return `
            <div class="section">
                <h2>Climate Summary (from EPW)</h2>
                ${hasSolar ? `
                    <h3 style="margin:10px 0 4px 0;font-size:1em;">Monthly Average Daily Solar Radiation</h3>
                    <table style="width:100%;border-collapse:collapse;font-size:0.8em;margin-bottom:10px;">
                        <thead>
                            <tr>
                                <th style="text-align:left;padding:4px 6px;border-bottom:1px solid #ddd;">Month</th>
                                <th style="text-align:right;padding:4px 6px;border-bottom:1px solid #ddd;">Direct DNI (kWh/m²·day)</th>
                                <th style="text-align:right;padding:4px 6px;border-bottom:1px solid #ddd;">Diffuse DHI (kWh/m²·day)</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${solarRows}
                        </tbody>
                    </table>
                ` : ''
            }

                ${hasTemp ? `
                    <h3 style="margin:10px 0 4px 0;font-size:1em;">Monthly Temperature Statistics</h3>
                    <table style="width:100%;border-collapse:collapse;font-size:0.8em;margin-bottom:10px;">
                        <thead>
                            <tr>
                                <th style="text-align:left;padding:4px 6px;border-bottom:1px solid #ddd;">Month</th>
                                <th style="text-align:right;padding:4px 6px;border-bottom:1px solid #ddd;">Min (°C)</th>
                                <th style="text-align:right;padding:4px 6px;border-bottom:1px solid #ddd;">Avg (°C)</th>
                                <th style="text-align:right;padding:4px 6px;border-bottom:1px solid #ddd;">Max (°C)</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tempRows}
                        </tbody>
                    </table>
                ` : ''
            }

                ${hasWind ? `
                    <p style="font-size:0.8em;color:#555;margin-top:8px;">
                        Wind rose statistics are available in the interactive dashboard and can be referenced
                        alongside this summary for prevailing wind directions and speeds.
                    </p>
                ` : ''
            }
            </div> `;
    }

    /** @private */
    _buildLightingSection() {
        const { lightingMetrics } = this.data;
        if (!lightingMetrics) return '';

        const { avgPower, savings, lpd, annualEnergy } = lightingMetrics;

        return `
            <div class="section">
                <h2>Lighting Performance Summary</h2>
                <div class="metric-grid">
                    ${this._buildMetricCard('Average Lighting Power Fraction', this._fmt(Number(avgPower) * 100, 1), '%')}
                    ${this._buildMetricCard('Estimated Lighting Energy Savings', this._fmt(savings, 1), '%')}
                    ${this._buildMetricCard('Installed LPD', this._fmt(lpd, 2), ' W/m²')}
                    ${this._buildMetricCard('Estimated Annual Lighting Energy', this._fmt(annualEnergy, 0), ' kWh/m²')}
                </div>
                <p style="font-size:0.8em;color:#555;margin-top:6px;">
                    Lighting control performance is estimated from the daylight autonomy-based control model
                    configured in the project, over the same occupied hours as the sDA calculation
                    (the loaded occupancy schedule, or Mon&ndash;Fri 08:00&ndash;18:00 if none is loaded).
                    ASE is reported over the LM-83 analysis period (all days, 08:00&ndash;18:00) instead.
                </p>
            </div> `;
    }

    /** @private */
    _buildMetricCard(label, value, unit = '') {
        if (value === null || value === undefined || value === 'NaN') return '';
        return `
            <div class="metric-card">
                <div class="metric-label">${label}</div>
                <div class="metric-value">${value} ${unit}</div>
            </div> `;
    }

    /** @private */
    _buildChartsSection() {
        const { charts } = this.data;
        return `
            ${this._buildImageSection('Useful Daylight Illuminance (UDI)', charts.udiChart)}
            ${this._buildImageSection('Glare Rose Diagram', charts.glareRoseChart)}
            ${this._buildImageSection('Combined Daylight vs. Glare', charts.combinedAnalysisChart)}
        `;
    }

    /** @private */
    _buildImageSection(title, imgSrc) {
        if (!imgSrc) return '';
        return `
            <div class="section">
                <h2>${title}</h2>
                <div class="chart-container">
                    <img src="${imgSrc}" alt="${title}" />
                </div>
            </div> `;
    }

    /** @private */
    _buildFooter() {
        return `
            <footer>
            <p>Report generated by Ray Modeler</p>
            </footer> `;
    }
}

// Export a single instance of the generator
export const reportGenerator = new ReportGenerator();
