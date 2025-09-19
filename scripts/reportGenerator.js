// scripts/reportGenerator.js

import { project } from './project.js';
import { resultsManager } from './resultsManager.js';
import { captureSceneSnapshot } from './scene.js';
import { getDashboardChartsAsBase64 } from './annualDashboard.js';
import { showAlert, getDom } from './ui.js';

/**
 * Gathers all necessary data and generates an HTML report in a new tab.
 */
export async function generateReport() {
    const dom = getDom();
    showAlert('Generating report, please wait...', 'In Progress');

    try {
        // Use a brief timeout to allow the "In Progress" alert to render before heavy processing
        await new Promise(resolve => setTimeout(resolve, 50));

        const projectData = await project.gatherAllProjectData();
        const activeDataKey = resultsManager.activeView === 'diff' ? 'a' : resultsManager.activeView;
        const activeDataset = resultsManager.datasets[activeDataKey];

        if (!activeDataset) {
            throw new Error("No active dataset found to generate a report from.");
        }

        const stats = resultsManager.getActiveStats();
        const annualMetrics = resultsManager.hasAnnualData(activeDataKey) ? resultsManager.calculateAnnualMetrics(activeDataKey, {}) : null;
        const glareResult = resultsManager.getActiveGlareResult();
        const circadianMetrics = activeDataset.circadianMetrics;
        const charts = getDashboardChartsAsBase64();
        const sceneImage = captureSceneSnapshot();

        const htmlContent = createReportHtml({
            projectData,
            stats,
            annualMetrics,
            glareResult,
            circadianMetrics,
            sceneImage,
            charts
        });

        const blob = new Blob([htmlContent], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');

        // Update the alert to notify the user
        if (dom['custom-alert-message'] && dom['custom-alert-title']) {
            dom['custom-alert-message'].innerHTML = 'Your report has been opened in a new tab. You can now print or save it as a PDF from your browser.';
            dom['custom-alert-title'].textContent = 'Report Generated';
        }

    } catch (error) {
        console.error("Failed to generate report:", error);
        showAlert(`Failed to generate report: ${error.message}`, 'Error');
    }
}

/**
 * Constructs the full HTML string for the report.
 * @param {object} data - The collected data for the report.
 * @returns {string} A self-contained HTML document string.
 */
function createReportHtml(data) {
    const { projectData, stats, annualMetrics, glareResult, circadianMetrics, sceneImage, charts } = data;
    const date = new Date().toLocaleString();

    const metricCard = (label, value, unit = '') => {
        if (value === null || value === undefined || value === 'NaN') return '';
        return `
            <div class="metric-card">
                <div class="metric-label">${label}</div>
                <div class="metric-value">${value} ${unit}</div>
            </div>
        `;
    };

    const imageSection = (title, imgSrc) => {
        if (!imgSrc) return '';
        return `
            <div class="section">
                <h2>${title}</h2>
                <div class="chart-container">
                    <img src="${imgSrc}" alt="${title}" />
                </div>
            </div>
        `;
    };

    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Analysis Report: ${projectData.projectInfo['project-name']}</title>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
            body {
                font-family: 'Inter', sans-serif;
                line-height: 1.6;
                color: #333;
                background-color: #f8f9fa;
                margin: 0;
                padding: 0;
            }
            .container {
                max-width: 800px;
                margin: 20px auto;
                padding: 20px;
                background-color: #fff;
                box-shadow: 0 0 10px rgba(0,0,0,0.1);
                border-radius: 8px;
            }
            header, footer {
                text-align: center;
                padding-bottom: 20px;
                border-bottom: 1px solid #eee;
                margin-bottom: 20px;
            }
            footer {
                margin-top: 40px;
                padding-top: 20px;
                border-top: 1px solid #eee;
                border-bottom: none;
                font-size: 0.8em;
                color: #777;
            }
            h1 { color: #222; }
            h2 {
                color: #444;
                border-bottom: 2px solid #5c9ce5;
                padding-bottom: 5px;
                margin-top: 30px;
            }
            .section { margin-bottom: 30px; }
            .metric-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
                gap: 15px;
                margin-top: 20px;
            }
            .metric-card {
                background-color: #f1f3f5;
                border-radius: 6px;
                padding: 15px;
                text-align: center;
                border: 1px solid #dee2e6;
            }
            .metric-label {
                font-size: 0.9em;
                color: #555;
                margin-bottom: 8px;
            }
            .metric-value {
                font-size: 1.5em;
                font-weight: 600;
                color: #000;
            }
            ul {
                list-style-type: none;
                padding: 0;
            }
            li {
                background: #f8f9fa;
                margin-bottom: 5px;
                padding: 8px 12px;
                border-radius: 4px;
            }
            .chart-container img {
                max-width: 100%;
                height: auto;
                margin-top: 15px;
                border: 1px solid #ddd;
                border-radius: 4px;
            }
            @media print {
                body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                .container { box-shadow: none; border: 1px solid #ddd; margin: 0; max-width: 100%;}
            }
        </style>
    </head>
    <body>
        <div class="container">
            <header>
                <h1>Analysis Report</h1>
                <p><strong>Project:</strong> ${projectData.projectInfo['project-name'] || 'N/A'}</p>
                <p><strong>Generated on:</strong> ${date}</p>
            </header>

            <main>
                <div class="section">
                    <h2>Project Information</h2>
                    <ul>
                        <li><strong>Building Type:</strong> ${projectData.projectInfo['building-type'] || 'N/A'}</li>
                        <li><strong>Location:</strong> Lat: ${projectData.projectInfo.latitude}, Lon: ${projectData.projectInfo.longitude}</li>
                        <li><strong>Room Dimensions:</strong> ${projectData.geometry.room.width}m (W) &times; ${projectData.geometry.room.length}m (L) &times; ${projectData.geometry.room.height}m (H)</li>
                    </ul>
                </div>

                <div class="section">
                    <h2>3D Scene Snapshot</h2>
                    <img src="${sceneImage}" alt="3D Scene Snapshot" style="width: 100%; border: 1px solid #ccc; border-radius: 4px;" />
                </div>

                ${stats || annualMetrics || glareResult ? `
                <div class="section">
                    <h2>Key Metrics Summary</h2>
                    <div class="metric-grid">
                        ${stats ? metricCard('Average Illuminance', stats.avg.toFixed(1), 'lux') : ''}
                        ${stats ? metricCard('Uniformity (Uo)', (stats.min / stats.avg).toFixed(2)) : ''}
                        ${annualMetrics ? metricCard('sDA <sub>300/50%</sub>', annualMetrics.sDA.toFixed(1), '%') : ''}
                        ${annualMetrics ? metricCard('ASE <sub>1000,250h</sub>', annualMetrics.ASE.toFixed(1), '%') : ''}
                        ${glareResult ? metricCard('DGP', glareResult.dgp.toFixed(3)) : ''}
                        ${circadianMetrics ? metricCard('Avg. Circadian Stimulus', circadianMetrics.avg_cs.toFixed(3)) : ''}
                        ${circadianMetrics ? metricCard('Avg. EML', circadianMetrics.avg_eml.toFixed(0), 'lux') : ''}
                    </div>
                </div>` : ''}

                ${imageSection('Useful Daylight Illuminance (UDI)', charts.udiChart)}
                ${imageSection('Glare Rose Diagram', charts.glareRoseChart)}
                ${imageSection('Combined Daylight vs. Glare', charts.combinedAnalysisChart)}

            </main>
            <footer>
                <p>Report generated by Ray Modeler</p>
            </footer>
        </div>
    </body>
    </html>
    `;
}