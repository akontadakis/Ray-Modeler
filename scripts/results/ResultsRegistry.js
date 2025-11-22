// ResultsRegistry.js
// Central registry for typed analysis results.
// Goal: provide a single source of truth for:
// - Result type IDs
// - File pattern / shape-based matching
// - Storage behavior in resultsManager
// - Visualization hints
//
// This initial version is intentionally thin and non-breaking.
// It is wired for incremental adoption by resultsManager, dashboards, and reportGenerator.

export const ResultsRegistry = (() => {
  /**
   * @typedef {Object} ResultDescriptor
   * @property {string} id - Stable identifier e.g. 'annual-illuminance'
   * @property {string} label - Human readable name
   * @property {RegExp[]} [filePatterns] - Filename patterns for quick matching
   * @property {(fileName: string, workerResult: any) => boolean} match - Returns true if this descriptor applies
   * @property {{
   *   fields?: Record<string, string>,
   *   dependsOn?: string[]
   * }} [schema] - Documentation; not enforced yet
   * @property {{
   *   target: 'dataset' | 'global' | 'epRun' | 'none',
   *   apply: (resultsManager: any, datasetKey: string | null, workerResult: any, context: { fileName: string }) => void
   * }} storage - How to integrate into resultsManager
   * @property {string[]} [visualizations] - IDs of visualizations that can consume this result
   */

  /** @type {ResultDescriptor[]} */
  const descriptors = [];

  function register(descriptor) {
    descriptors.push(descriptor);
  }

  function findDescriptor(fileName, workerResult) {
    // 1) Prefer explicit match handlers
    for (const d of descriptors) {
      try {
        if (d.match && d.match(fileName, workerResult)) {
          return d;
        }
      } catch (e) {
        console.warn("ResultsRegistry: error in match for", d.id, fileName, e);
      }
    }

    // 2) Fallback to generic scalar grid
    return descriptors.find((d) => d.id === "generic-scalar-grid") || null;
  }

  // Helper: safe dataset accessor; resultsManager is expected to provide this,
  // but we defensively implement an inline fallback for early integration.
  function ensureDataset(resultsManager, key) {
    if (!key) return null;
    if (!resultsManager.datasets) resultsManager.datasets = {};
    if (!resultsManager.datasets[key]) {
      resultsManager.datasets[key] = {
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
        stats: null,
      };
    }
    return resultsManager.datasets[key];
  }

  // Core descriptors
  // ----------------

  // Annual Illuminance (base .ill)
  register({
    id: "annual-illuminance",
    label: "Annual Illuminance",
    filePatterns: [/\.ill$/i],
    match: (fileName, result) => {
      if (!/\.ill$/i.test(fileName)) return false;
      if (/_direct\.ill$/i.test(fileName)) return false;
      return !!result.annualData;
    },
    schema: {
      fields: {
        annualData: "matrix[point][8760]",
        data: "array[point]",
        units: "lux",
      },
      dependsOn: [],
    },
    storage: {
      target: "dataset",
      apply: (rm, key, result, { fileName }) => {
        const ds = ensureDataset(rm, key);
        if (!ds) return;
        ds.fileName = ds.fileName || fileName;
        ds.annualData = result.annualData;
        ds.data = Array.isArray(result.data)
          ? result.data
          : (result.annualData || []).map((row) => {
            if (!row || !row.length) return 0;
            let sum = 0;
            for (let i = 0; i < row.length; i++) sum += row[i];
            return sum / row.length;
          });
        ds.units = "lux";
        if (typeof rm._updateStatsForDataset === "function") {
          rm._updateStatsForDataset(key);
        }
      },
    },
    visualizations: [
      "annual-false-color",
      "temporal-map",
      "sda-ase-udi-dashboard",
      "combined-daylight-glare",
    ],
  });

  // Annual Direct Illuminance (_direct.ill)
  register({
    id: "annual-direct-illuminance",
    label: "Annual Direct Illuminance",
    filePatterns: [/_direct\.ill$/i],
    match: (fileName, result) => /_direct\.ill$/i.test(fileName) && !!result.annualData,
    schema: {
      fields: {
        annualData: "matrix[point][8760]",
        units: "lux",
      },
      dependsOn: ["annual-illuminance"],
    },
    storage: {
      target: "dataset",
      apply: (rm, key, result) => {
        const ds = ensureDataset(rm, key);
        if (!ds) return;
        ds.annualDirectData = result.annualData;
        if (typeof rm._updateAnnualMetricsIfComplete === "function") {
          rm._updateAnnualMetricsIfComplete(key);
        }
      },
    },
    visualizations: ["sda-ase-udi-dashboard"],
  });

  // Annual Glare - DGP
  register({
    id: "annual-glare-dgp",
    label: "Annual Glare (DGP)",
    filePatterns: [/\.dgp$/i],
    match: (fileName, result) =>
      /\.dgp$/i.test(fileName) &&
      !!result.annualGlareResults &&
      !!result.annualGlareResults.dgp,
    schema: {
      fields: {
        annualGlareResults: "matrix[point][8760] under key 'dgp'",
      },
      dependsOn: [],
    },
    storage: {
      target: "dataset",
      apply: (rm, key, result) => {
        const ds = ensureDataset(rm, key);
        if (!ds) return;
        ds.annualGlareResults = ds.annualGlareResults || {};
        if (result.annualGlareResults.dgp) {
          ds.annualGlareResults.dgp = result.annualGlareResults.dgp;
        }
        ds.glareMetric = ds.glareMetric || "dgp";
      },
    },
    visualizations: ["glare-rose", "combined-daylight-glare"],
  });

  // Annual Glare - GA
  register({
    id: "annual-glare-ga",
    label: "Annual Glare (GA)",
    filePatterns: [/\.ga$/i],
    match: (fileName, result) =>
      /\.ga$/i.test(fileName) &&
      !!result.annualGlareResults &&
      !!result.annualGlareResults.ga,
    schema: {
      fields: {
        annualGlareResults: "matrix[point][8760] under key 'ga'",
      },
      dependsOn: [],
    },
    storage: {
      target: "dataset",
      apply: (rm, key, result) => {
        const ds = ensureDataset(rm, key);
        if (!ds) return;
        ds.annualGlareResults = ds.annualGlareResults || {};
        if (result.annualGlareResults.ga) {
          ds.annualGlareResults.ga = result.annualGlareResults.ga;
        }
        if (!ds.glareMetric) ds.glareMetric = "ga";
      },
    },
    visualizations: ["glare-rose", "combined-daylight-glare"],
  });

  // Evalglare PIT (single image glare analysis)
  register({
    id: "evalglare-pit",
    label: "Evalglare Point-in-time",
    match: (_fileName, result) =>
      !!result.glareResult && !result.annualGlareResults,
    storage: {
      target: "dataset",
      apply: (rm, key, result) => {
        const ds = ensureDataset(rm, key);
        if (!ds) return;
        ds.glareResult = result.glareResult;
      },
    },
    visualizations: ["hdr-viewer"],
  });

  // Circadian Summary (JSON)
  register({
    id: "circadian-summary",
    label: "Circadian Summary",
    match: (_fileName, result) => !!result.circadianMetrics,
    schema: {
      fields: {
        circadianMetrics: "summary metrics (CS, EML, CCT, etc.)",
      },
      dependsOn: [],
    },
    storage: {
      target: "dataset",
      apply: (rm, key, result) => {
        const ds = ensureDataset(rm, key);
        if (!ds) return;
        ds.circadianMetrics = result.circadianMetrics;
      },
    },
    visualizations: ["circadian-dashboard", "report-circadian"],
  });

  // Circadian / Spectral per-point
  register({
    id: "circadian-per-point",
    label: "Circadian Per-Point",
    match: (_fileName, result) => !!result.perPointCircadianData,
    schema: {
      fields: {
        spectralResults: "perPointCircadianData keyed by metric",
      },
      dependsOn: [],
    },
    storage: {
      target: "dataset",
      apply: (rm, key, result) => {
        const ds = ensureDataset(rm, key);
        if (!ds) return;
        ds.spectralResults = result.perPointCircadianData;
        // Optional: set primary data if Photopic_lux is available.
        if (result.perPointCircadianData.Photopic_lux && !ds.data?.length) {
          ds.data = result.perPointCircadianData.Photopic_lux;
        }
      },
    },
    visualizations: ["circadian-dashboard"],
  });

  // Lighting Energy Metrics
  register({
    id: "lighting-energy",
    label: "Lighting Energy Metrics",
    match: (_fileName, result) => !!result.lightingEnergyMetrics,
    schema: {
      fields: {
        lightingEnergyMetrics:
          "aggregated lighting energy performance (savings, EUI, etc.)",
      },
      dependsOn: ["annual-illuminance"],
    },
    storage: {
      target: "dataset",
      apply: (rm, key, result) => {
        const ds = ensureDataset(rm, key);
        if (!ds) return;
        ds.lightingEnergyMetrics = result.lightingEnergyMetrics;
      },
    },
    visualizations: ["lighting-energy-dashboard", "report-lighting"],
  });


  // ----------------------------------------------
  //
  // These descriptors document canonical type IDs for non-worker-based flows.
  // Storage is managed directly by resultsManager; match() always returns false
  // here so they are not selected for file-based imports, but tools and UIs can
  // rely on ResultsRegistry.descriptors as the central catalog of known types.

  // EPW Climate (handled directly in resultsManager._parseEpwContent)
  register({
    id: "epw-climate",
    label: "EPW Climate Data",
    match: () => false, // Loaded directly by resultsManager, never via worker
    storage: {
      target: "global",
      apply: () => {
        // No-op: EPW parsing and climateData assignment are handled
        // by ResultsManager.loadAndProcessFile and _parseEpwContent.
      },
    },
    visualizations: ["climate-dashboard"],
  });

  // Generic scalar grid (fallback)
  register({
    id: "generic-scalar-grid",
    label: "Generic Scalar Grid",
    match: (_fileName, result) =>
      Array.isArray(result?.data) || Array.isArray(result),
    schema: {
      fields: {
        data: "array[point] or similar",
      },
      dependsOn: [],
    },
    storage: {
      target: "dataset",
      apply: (rm, key, result, { fileName }) => {
        const ds = ensureDataset(rm, key);
        if (!ds) return;
        ds.fileName = ds.fileName || fileName;
        ds.data = Array.isArray(result.data) ? result.data : result;
        if (typeof rm._updateStatsForDataset === "function") {
          rm._updateStatsForDataset(key);
        }
      },
    },
    visualizations: ["annual-false-color"],
  });

  return {
    register,
    findDescriptor,
    descriptors,
  };
})();
