// scripts/reportGenerator.js

import { project } from './project.js';
import { resultsManager } from './resultsManager.js';
import { captureSceneSnapshot } from './scene.js';
import { getDashboardChartsAsBase64 } from './annualDashboard.js';
import { showAlert, getDom } from './ui.js';

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
            this._displayReport(htmlContent);

            this._showSuccessMessage();

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

        // Determine the most relevant dataset for the report.
        // Prioritize the active view, but fall back gracefully if it's 'diff' or empty.
        let reportDataKey = resultsManager.activeView;
        if (reportDataKey === 'diff' || !resultsManager.datasets[reportDataKey]?.stats) {
            reportDataKey = resultsManager.datasets.a?.stats ? 'a' : 'b';
        }

        const activeDataset = resultsManager.datasets[reportDataKey];

        if (!activeDataset) {
            throw new Error("No active dataset found to generate a report from.");
        }

        this.data = {
            projectData,
            stats: activeDataset.stats,
            annualMetrics: resultsManager.hasAnnualData(reportDataKey) ? resultsManager.calculateAnnualMetrics(reportDataKey, {}) : null,
            glareResult: activeDataset.glareResult,
            circadianMetrics: activeDataset.circadianMetrics,
            charts: getDashboardChartsAsBase64(),
            sceneImage: captureSceneSnapshot(),
            generationDate: new Date().toLocaleString(),
        };
    }

    /**
     * Opens the generated HTML content in a new browser tab.
     * @private
     * @param {string} htmlContent - The complete HTML string of the report.
     */
    _displayReport(htmlContent) {
        const blob = new Blob([htmlContent], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
    }

    /**
     * Updates the UI alert to inform the user of successful report generation.
     * @private
     */
    _showSuccessMessage() {
        const dom = getDom();
        if (dom['custom-alert-message'] && dom['custom-alert-title']) {
            dom['custom-alert-message'].innerHTML = 'Your report has been opened in a new tab. You can now print or save it as a PDF from your browser.';
            dom['custom-alert-title'].textContent = 'Report Generated';
        }
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
        const { stats, annualMetrics, glareResult, circadianMetrics } = this.data;
        const hasMetrics = stats || annualMetrics || glareResult || circadianMetrics;

        if (!hasMetrics) return '';

        return `
            <div class="section">
                <h2>Key Metrics Summary</h2>
                <div class="metric-grid">
                    ${stats ? this._buildMetricCard('Average Illuminance', stats.avg.toFixed(1), 'lux') : ''}
                    ${stats ? this._buildMetricCard('Uniformity (Uo)', (stats.min / stats.avg).toFixed(2)) : ''}
                    ${annualMetrics ? this._buildMetricCard('sDA <sub>300/50%</sub>', annualMetrics.sDA.toFixed(1), '%') : ''}
                    ${annualMetrics ? this._buildMetricCard('ASE <sub>1000,250h</sub>', annualMetrics.ASE.toFixed(1), '%') : ''}
                    ${glareResult ? this._buildMetricCard('DGP', glareResult.dgp.toFixed(3)) : ''}
                    ${circadianMetrics ? this._buildMetricCard('Avg. Circadian Stimulus', circadianMetrics.avg_cs.toFixed(3)) : ''}
                    ${circadianMetrics ? this._buildMetricCard('Avg. EML', circadianMetrics.avg_eml.toFixed(0), 'lux') : ''}
                </div>
            </div>`;
    }

    /** @private */
    _buildMetricCard(label, value, unit = '') {
        if (value === null || value === undefined || value === 'NaN') return '';
        return `
            <div class="metric-card">
                <div class="metric-label">${label}</div>
                <div class="metric-value">${value} ${unit}</div>
            </div>`;
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
            </div>`;
    }

    /** @private */
    _buildFooter() {
        return `
            <footer>
                <p>Report generated by Ray Modeler</p>
            </footer>`;
    }
}

// Export a single instance of the generator
export const reportGenerator = new ReportGenerator();