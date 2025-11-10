// scripts/energyplusHelp.js
//
// Centralized contextual help integration for EnergyPlus tools.
//
// Responsibilities:
// - Define HELP_MAP: logical keys -> OpenStudio help HTML sources.
// - Load local help HTML via fetch().
// - Extract relevant sections using anchors/headings, strip chrome.
// - Sanitize and embed into a reusable floating "EnergyPlus Help" panel.
// - Rewrite internal links to either:
//     - Call openHelpPanel for known targets, or
//     - Open original help HTML (in Electron or browser).
//
// This is written to work in both:
// - Electron (files loaded from packaged app)
// - Browser/static (files served relatively next to index.html)

const HELP_MAP = {
    // Simulation recipes and run dialog
    'simulations/run': {
        title: 'Running EnergyPlus Simulations',
        sources: [
            {
                file: 'energyplus-docs/io-ref/simulations-run.html',
                label: 'I/O Ref: Simulation Control and Reporting'
            },
            {
                file: 'openstudio/help/ref_simulations.html',
                anchor: 'run',
                label: 'Legacy: Run EnergyPlus Simulation'
            }
        ],
        summary: 'How to configure and run EnergyPlus simulations: run control options, weather files, reporting, and post-run outputs.'
    },

    // High-level overview for configuration panels
    'config/overview': {
        title: 'EnergyPlus Configuration Overview',
        sources: [
            {
                file: 'openstudio/help/ref_modeling_tools.html',
                label: 'Modeling Tools Reference'
            },
            {
                file: 'openstudio/help/tut_best_practices.html',
                label: 'Best Practices Tutorial'
            }
        ],
        summary: 'Overview of configuring materials, constructions, schedules, loads, and outputs for EnergyPlus in an OpenStudio-style workflow.'
    },

    // Materials
    'config/materials': {
        title: 'EnergyPlus Materials',
        sources: [
            {
                file: 'energyplus-docs/io-ref/materials-constructions.html',
                label: 'I/O Ref: Materials & Constructions'
            },
            {
                file: 'openstudio/help/ref_modeling_tools.html',
                anchor: 'materials',
                label: 'Legacy: Materials Reference'
            },
            {
                file: 'openstudio/help/tut_default_const_prefs.html',
                label: 'Legacy: Default Constructions & Materials Tutorial'
            }
        ],
        summary: 'How material definitions in Ray-Modeler map to EnergyPlus Material, Material:NoMass, Material:AirGap, WindowMaterial:* and related construction inputs.'
    },

    // Constructions
    'config/constructions': {
        title: 'EnergyPlus Constructions',
        sources: [
            {
                file: 'energyplus-docs/io-ref/materials-constructions.html',
                label: 'I/O Ref: Constructions'
            },
            {
                file: 'openstudio/help/ref_modeling_tools.html',
                anchor: 'constructions',
                label: 'Legacy: Constructions Reference'
            },
            {
                file: 'openstudio/help/tut_best_practices.html',
                label: 'Legacy: Construction Best Practices'
            }
        ],
        summary: 'How to assemble materials into constructions and how Ray-Modeler constructions map to EnergyPlus Construction and Construction:InternalSource objects.'
    },

    // Schedules
    'config/schedules': {
        title: 'Schedules and Time-of-Use',
        sources: [
            {
                file: 'energyplus-docs/io-ref/schedules.html',
                label: 'I/O Ref: Schedules'
            },
            {
                file: 'openstudio/help/ref_modeling_tools.html',
                anchor: 'schedules',
                label: 'Legacy: Schedules Reference'
            }
        ],
        summary: 'Overview of schedule objects and how Ray-Modeler schedules map to ScheduleTypeLimits, Schedule:Compact, and related schedule objects in EnergyPlus.'
    },

    // Zone Loads / Thermostats / IdealLoads
    'config/loads': {
        title: 'Zone Loads, Thermostats, and Ideal Loads',
        sources: [
            {
                file: 'energyplus-docs/io-ref/loads-thermostats-idealloads.html',
                label: 'I/O Ref: Loads, Thermostats & Ideal Loads'
            },
            {
                file: 'openstudio/help/tut_loads.html',
                label: 'Legacy: Loads Tutorial'
            },
            {
                file: 'openstudio/help/ref_modeling_tools.html',
                anchor: 'loads',
                label: 'Legacy: Loads Reference'
            },
            {
                file: 'openstudio/help/tut_best_practices.html',
                label: 'Legacy: Best Practices'
            }
        ],
        summary: 'Guidance on how Ray-Modeler zone loads, infiltration, outdoor air, thermostats and IdealLoads settings map to People, Lights, ElectricEquipment, ZoneInfiltration:*, DesignSpecification:OutdoorAir, ZoneControl:Thermostat, and ZoneHVAC:IdealLoadsAirSystem.'
    },

    // Daylighting & Outputs
    'config/daylighting': {
        title: 'Daylighting and Output Reporting',
        sources: [
            {
                file: 'energyplus-docs/io-ref/daylighting-outputs.html',
                label: 'I/O Ref: Daylighting & Outputs'
            },
            {
                file: 'openstudio/help/tut_daylighting_controls.html',
                label: 'Legacy: Daylighting Controls Tutorial'
            },
            {
                file: 'openstudio/help/tut_illuminance_map.html',
                label: 'Legacy: Illuminance Maps Tutorial'
            },
            {
                file: 'openstudio/help/tut_results_viewer.html',
                label: 'Legacy: Results Viewer Tutorial'
            }
        ],
        summary: 'How Ray-Modeler daylighting and reporting options map to Daylighting:Controls, Output:IlluminanceMap, Output:Variable, and other reporting objects.'
    }
};

// Simple in-memory cache so we do not re-fetch and re-parse every time.
const helpCache = new Map();

/**
 * Public API: open a contextual help panel for a given key.
 * @param {string} key - Logical help key from HELP_MAP.
 * @param {Object} [options]
 * @param {string} [options.sourceLabel] - Preferred source label to pre-select.
 */
/**
 * Public API stub: EnergyPlus contextual help has been disabled.
 * Keeping this exported as a no-op so any legacy calls do not break.
 */
export async function openHelpPanel(key, options = {}) {
    console.debug('[EnergyPlusHelp] openHelpPanel noop; contextual help disabled for key =', key);
    return;
}

/**
 * Ensure the global help panel exists; create if needed.
 * Disabled: always returns null.
 */
function ensureHelpPanel() {
    return null;
}

/**
 * Normalize help panel structure.
 * Disabled: no-op.
 */
function normalizeHelpPanelStructure(panel) {
    return;
}

/**
 * Bring the help panel to the front.
 */
/**
 * Bring help panel to front.
 * Disabled: no-op.
 */
function bringHelpPanelToFront(panel) {
    return;
}

/**
 * Load and render a given help source into the content element.
 */
/**
 * Load and render a help source.
 * Disabled: no-op.
 */
async function loadAndRenderSource(source, contentEl) {
    return;
}

/**
 * Extract a relevant fragment from the full HTML using an anchor (name or id).
 * For legacy OpenStudio docs, anchors are typically <a name="...">.
 */
function extractRelevantFragment(html, anchor) {
    if (!anchor) return null;

    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Find the anchor
        let anchorEl =
            doc.querySelector(`a[name="${anchor}"]`) ||
            doc.getElementById(anchor);
        if (!anchorEl) {
            // Fallback: try matching href fragments that point to this anchor
            anchorEl = doc.querySelector(`a[href*="#${anchor}"]`);
        }
        if (!anchorEl) return null;

        // For ref_simulations.html etc, the anchor is followed by an <h3> and section.
        // Strategy:
        // - Find the nearest heading (h2/h3) at or following the anchor.
        // - Collect until the next heading of the same level or end.
        let start = anchorEl;
        // If next sibling is a heading, prefer that as start.
        if (anchorEl.nextElementSibling && /^H[2-4]$/i.test(anchorEl.nextElementSibling.tagName)) {
            start = anchorEl.nextElementSibling;
        } else {
            // Or if anchor itself wraps a heading, use ancestor.
            const headingAncestor = anchorEl.closest('h2,h3,h4');
            if (headingAncestor) start = headingAncestor;
        }

        const container = doc.createElement('div');
        let node = start;
        const startLevel = /^H[2-4]$/i.test(start.tagName)
            ? parseInt(start.tagName.substring(1), 10)
            : null;

        while (node) {
            if (
                node !== start &&
                startLevel &&
                /^H[2-4]$/i.test(node.tagName) &&
                parseInt(node.tagName.substring(1), 10) <= startLevel
            ) {
                break; // Stop at next same/higher-level section
            }

            container.appendChild(node.cloneNode(true));
            node = node.nextElementSibling;
        }

        return container.innerHTML;
    } catch (e) {
        console.warn('EnergyPlusHelp: failed to parse HTML fragment', e);
        return null;
    }
}

/**
 * Basic sanitization / normalization:
 * - Drop script tags and external CSS links.
 * - Strip inline event handlers.
 * - Normalize typography a bit.
 * - Keep basic markup (p, ul, li, img, h3, etc.).
 */
function sanitizeHelpHtml(fragmentHtml, basePath) {
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(fragmentHtml, 'text/html');

        // Remove scripts
        doc.querySelectorAll('script').forEach((el) => el.remove());

        // Remove external stylesheets (prevents ep.css MIME warnings)
        doc.querySelectorAll('link[rel="stylesheet"]').forEach((el) => el.remove());

        // Strip on* attributes
        doc.querySelectorAll('*').forEach((el) => {
            Array.from(el.attributes).forEach((attr) => {
                if (/^on/i.test(attr.name)) {
                    el.removeAttribute(attr.name);
                }
            });
        });

        // Fix relative image paths so they still work and avoid 404 spam for legacy icons
        doc.querySelectorAll('img').forEach((img) => {
            const src = img.getAttribute('src');
            if (!src) return;

            // External images untouched
            if (/^https?:\/\//i.test(src)) return;

            // Drop references to legacy icon paths that are not bundled in Ray-Modeler
            if (src.includes('/lib/resources/icons/')) {
                img.remove();
                return;
            }

            // For our packaged structure, keep images relative under openstudio/help/...
            if (basePath && !src.startsWith('openstudio/help/')) {
                const baseDir = basePath.replace(/[^/]+$/, '');
                img.setAttribute('src', baseDir + src.replace(/^(\.\/)+/, ''));
            }

            img.classList.add('max-w-full');
        });

        // Return inner HTML
        const body = doc.body;
        return body.innerHTML || fragmentHtml;
    } catch (e) {
        console.warn('EnergyPlusHelp: sanitize failed', e);
        return fragmentHtml;
    }
}

/**
 * Wire links inside the help content:
 * - Internal OpenStudio help links are opened in new tab or mapped to another help key.
 * - External links go via electronAPI.openExternal when available.
 */
/**
 * Wire links inside help content.
 * Disabled: no-op.
 */
function wireHelpLinks(contentEl) {
    return;
}

/**
 * Attempt to map a raw href to one of our HELP_MAP keys.
 */
function mapHrefToHelpKey(href) {
    const clean = href.split('#')[0].toLowerCase();

    if (clean.endsWith('ref_simulations.html')) {
        return 'simulations/run';
    }
    if (clean.endsWith('tut_loads.html')) {
        return 'config/loads';
    }
    if (clean.endsWith('tut_daylighting_controls.html') || clean.endsWith('tut_illuminance_map.html')) {
        return 'config/daylighting';
    }
    if (clean.endsWith('ref_modeling_tools.html')) {
        return 'config/overview';
    }

    // No direct mapping known
    return null;
}

/**
 * Fallback content when we cannot load a specific source.
 */
/**
 * Render fallback links.
 * Disabled: no-op.
 */
async function renderHelpFallbackLinks(contentEl) {
    return;
}
