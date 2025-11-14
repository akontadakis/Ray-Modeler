// EnergyPlus Optimization Orchestrator
// -----------------------------------
// Cohesive with optimizationOrchestrator.js but wired to EnergyPlus:
// - Uses energyplusConfigService + generateAndStoreIdf + runEnergyPlusSimulation
// - Uses resultsManager EnergyPlus KPI helpers
// - Single-objective SSGA for now (MOGA-ready structure)
// - Max 3 parameters, caching, UI log + summary, apply-best

import { getDom } from './dom.js';
import { showAlert, getNewZIndex } from './ui.js';
import { project } from './project.js';
import { resultsManager } from './resultsManager.js';
import { GeneticOptimizer } from './optimizationEngine.js';
import * as energyplusConfigService from './energyplusConfigService.js';
import { generateAndStoreIdf } from './energyplus.js';

// ============ STATE ============

let epOptimizer = null;                 // GeneticOptimizer instance
let epIsOptimizing = false;
let epOptimizationPanel = null;         // Panel root for EP Opt UI
let epFitnessCache = new Map();         // designKey -> { rawMetrics, ssgaResult }
let epSelectedDesignParams = null;      // For "Apply Best"
let epLastSettings = null;              // Keep last used settings (for applyBest, etc.)

// ============ PARAMETER CONFIG ============
// This table is intentionally compact and EnergyPlus-specific.
// Each param:
// - id: unique key
// - name: UI label
// - domain: category
// - type: 'continuous' | 'discrete'
// - default: { min, max, step } OR { options: [...] }
// - apply: (config, value, context) => void   (mutates EnergyPlus config object)

const MASTER_EP_PARAMETER_CONFIG = {
  // HVAC Setpoints (global/simple)
  'tset_cool': {
    id: 'tset_cool',
    name: 'Cooling Setpoint (°C)',
    domain: 'HVAC',
    type: 'continuous',
    default: { min: 22, max: 28, step: 0.5 },
    apply: (config, value) => {
      if (!config.thermostats) config.thermostats = {};
      config.thermostats.coolingSetpoint = value;
    }
  },
  'tset_heat': {
    id: 'tset_heat',
    name: 'Heating Setpoint (°C)',
    domain: 'HVAC',
    type: 'continuous',
    default: { min: 18, max: 23, step: 0.5 },
    apply: (config, value) => {
      if (!config.thermostats) config.thermostats = {};
      config.thermostats.heatingSetpoint = value;
    }
  },

  // Internal Loads (simple multipliers)
  'lpd_multiplier': {
    id: 'lpd_multiplier',
    name: 'Lighting Power Multiplier',
    domain: 'Loads',
    type: 'continuous',
    default: { min: 0.5, max: 1.2, step: 0.05 },
    apply: (config, value) => {
      if (!config.internalLoads) config.internalLoads = {};
      config.internalLoads.lightingMultiplier = value;
    }
  },
  'epd_multiplier': {
    id: 'epd_multiplier',
    name: 'Equipment Power Multiplier',
    domain: 'Loads',
    type: 'continuous',
    default: { min: 0.5, max: 1.2, step: 0.05 },
    apply: (config, value) => {
      if (!config.internalLoads) config.internalLoads = {};
      config.internalLoads.equipmentMultiplier = value;
    }
  },
  'occupancy_multiplier': {
    id: 'occupancy_multiplier',
    name: 'Occupancy Density Multiplier',
    domain: 'Loads',
    type: 'continuous',
    default: { min: 0.5, max: 1.2, step: 0.05 },
    apply: (config, value) => {
      if (!config.internalLoads) config.internalLoads = {};
      config.internalLoads.occupancyMultiplier = value;
    }
  },

  // Ventilation / OA
  'oa_per_person': {
    id: 'oa_per_person',
    name: 'Outdoor Air per Person (m³/s-person)',
    domain: 'Ventilation',
    type: 'continuous',
    default: { min: 0.0025, max: 0.01, step: 0.0005 },
    apply: (config, value) => {
      if (!config.ventilation) config.ventilation = {};
      config.ventilation.oaPerPerson = value;
    }
  },

  // Schedules (discrete profiles assumed known in config service)
  'occ_schedule_profile': {
    id: 'occ_schedule_profile',
    name: 'Occupancy Schedule Profile',
    domain: 'Schedules',
    type: 'discrete',
    default: { options: ['standard', 'extended', 'compressed'] },
    apply: (config, value) => {
      if (!config.schedules) config.schedules = {};
      config.schedules.occupancyProfile = value;
    }
  },
  'lighting_schedule_profile': {
    id: 'lighting_schedule_profile',
    name: 'Lighting Schedule Profile',
    domain: 'Schedules',
    type: 'discrete',
    default: { options: ['auto', 'conservative', 'aggressive'] },
    apply: (config, value) => {
      if (!config.schedules) config.schedules = {};
      schedules.lightingProfile = value;
    }
  },

  // --- New Envelope & Infiltration Parameters ---
  'window_u_value': {
    id: 'window_u_value',
    name: 'Window U-Value (W/m²K)',
    domain: 'Envelope',
    type: 'continuous',
    default: { min: 1.0, max: 3.5, step: 0.1 },
    apply: (config, value) => {
      if (!config.envelope) config.envelope = {};
      // This assumes the config service/builder knows how to find
      // and update the U-value of the default window construction.
      config.envelope.windowUValue = value;
    }
  },
  'window_shgc': {
    id: 'window_shgc',
    name: 'Window SHGC',
    domain: 'Envelope',
    type: 'continuous',
    default: { min: 0.2, max: 0.8, step: 0.05 },
    apply: (config, value) => {
      if (!config.envelope) config.envelope = {};
      // This assumes the config service/builder knows how to find
      // and update the SHGC of the default window construction.
      config.envelope.windowShgc = value;
    }
  },
  'infiltration_ach': {
    id: 'infiltration_ach',
    name: 'Infiltration (ACH)',
    domain: 'Ventilation',
    type: 'continuous',
    default: { min: 0.2, max: 1.5, step: 0.05 },
    apply: (config, value) => {
      if (!config.ventilation) config.ventilation = {};
      // This assumes the config service/builder will apply this
      // as a global infiltration load (ZoneInfiltration:DesignFlowRate).
      config.ventilation.infiltrationAch = value;
    }
  }
};

// ============ METRICS CONFIG ============
// Map optimization goals to how we read KPIs from resultsManager for a runId.

const EP_METRICS = {
  minimize_total_site_energy: {
    id: 'minimize_total_site_energy',
    label: 'Minimize Site EUI (kWh/m²)',
    unit: 'kWh/m²',
    direction: 'minimize',
    extract: (runId) => {
      const k = resultsManager.getEnergyPlusKpisForUi?.(runId) || null;
      // EUI is already per-area, so just return it.
      return k?.siteEui ?? null;
    }
  },
  minimize_heating_eui: {
    id: 'minimize_heating_eui',
    label: 'Minimize Heating EUI (kWh/m²)',
    unit: 'kWh/m²',
    direction: 'minimize',
    extract: (runId) => {
      const k = resultsManager.getEnergyPlusKpisForUi?.(runId) || null;
      // Check for valid numbers and non-zero area
      if (k?.heating === null || k?.heating === undefined || k?.totalArea === null || k?.totalArea === undefined || k.totalArea === 0) {
        return null;
      }
      return k.heating / k.totalArea;
    }
  },
  minimize_cooling_eui: {
    id: 'minimize_cooling_eui',
    label: 'Minimize Cooling EUI (kWh/m²)',
    unit: 'kWh/m²',
    direction: 'minimize',
    extract: (runId) => {
      const k = resultsManager.getEnergyPlusKpisForUi?.(runId) || null;
      // Check for valid numbers and non-zero area
      if (k?.cooling === null || k?.cooling === undefined || k?.totalArea === null || k?.totalArea === undefined || k.totalArea === 0) {
        return null;
      }
      return k.cooling / k.totalArea;
    }
  },
  minimize_lighting_eui: {
    id: 'minimize_lighting_eui',
    label: 'Minimize Lighting EUI (kWh/m²)',
    unit: 'kWh/m²',
    direction: 'minimize',
    extract: (runId) => {
      const k = resultsManager.getEnergyPlusKpisForUi?.(runId) || null;
      // Check for valid numbers and non-zero area
      if (k?.lighting === null || k?.lighting === undefined || k?.totalArea === null || k?.totalArea === undefined || k.totalArea === 0) {
        return null;
      }
      return k.lighting / k.totalArea;
    }
  },

  // --- New Comfort Metrics (Good for Constraints) ---
  'unmet_heating_hours': {
    id: 'unmet_heating_hours',
    label: 'Unmet Heating Hours',
    unit: 'hrs',
    direction: 'minimize',
    extract: (runId) => {
      const k = resultsManager.getEnergyPlusKpisForUi?.(runId) || null;
      // Assumes resultsManager provides unmetHeating
      return k?.unmetHeating ?? null;
    }
  },
  'unmet_cooling_hours': {
    id: 'unmet_cooling_hours',
    label: 'Unmet Cooling Hours',
    unit: 'hrs',
    direction: 'minimize',
    extract: (runId) => {
      const k = resultsManager.getEnergyPlusKpisForUi?.(runId) || null;
      // Assumes resultsManager provides unmetCooling
      return k?.unmetCooling ?? null;
    }
  }
  // Extend with additional KPIs (CO2, discomfort hours, etc.) as needed.
};

// ============ PUBLIC API ============

/**
 * Initialize EnergyPlus Optimization UI for the given panel.
 * Called once when the template is instantiated.
 */
export function initEpOptimizationUI(panel) {
  epOptimizationPanel = panel;

  const dom = getDom();
  const goalMetricSelect = panel.querySelector('#ep-opt-goal-metric');
  const goalTypeSelect = panel.querySelector('#ep-opt-goal-type');
  const goalTargetContainer = panel.querySelector('#ep-opt-goal-target-container') || panel.querySelector('#ep-opt-target-value-container');
  const startBtn = panel.querySelector('#ep-start-optimization-btn');
  const quickBtn = panel.querySelector('#ep-quick-optimize-btn');
  const resumeBtn = panel.querySelector('#ep-resume-optimization-btn');
  const cancelBtn = panel.querySelector('#ep-cancel-optimization-btn');
  const applyBestBtn = panel.querySelector('#ep-apply-best-design-btn');
  const infoBtn = panel.querySelector('#ep-opt-info-btn');
  const paramsDropdownList = panel.querySelector('#ep-opt-param-dropdown-list');
  const paramsDropdownBtn = panel.querySelector('#ep-opt-param-dropdown-btn');
  const activeParamsContainer = panel.querySelector('#ep-opt-active-params-container');
  const warningRuntime = panel.querySelector('#ep-opt-warning-runtime');

  // Populate goal metric dropdown
  if (goalMetricSelect) {
    goalMetricSelect.innerHTML = '';
    Object.values(EP_METRICS).forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.label;
      goalMetricSelect.appendChild(opt);
    });
  }

  // Toggle target-value input visibility for "set-target"
  if (goalTypeSelect && goalTargetContainer) {
    goalTypeSelect.addEventListener('change', () => {
      const isTarget = goalTypeSelect.value === 'set-target';
      goalTargetContainer.classList.toggle('hidden', !isTarget);
    });
  }

  // === 1. Parameters Dropdown Logic ===
  if (paramsDropdownList && activeParamsContainer && paramsDropdownBtn) {
    // Toggle dropdown visibility
    paramsDropdownBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        paramsDropdownList.classList.toggle('hidden');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!paramsDropdownList.contains(e.target) && !paramsDropdownBtn.contains(e.target)) {
            paramsDropdownList.classList.add('hidden');
        }
    });

    // Render Dropdown Options
    paramsDropdownList.innerHTML = '';
    Object.values(MASTER_EP_PARAMETER_CONFIG).forEach(p => {
        const row = document.createElement('label');
        row.className = 'flex items-center gap-2 text-xs p-2 hover:bg-[--grid-color] cursor-pointer border-b border-[--grid-color] last:border-0';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = p.id;
        checkbox.className = 'ep-opt-param-select-checkbox';

        const text = document.createElement('span');
        text.textContent = p.name;

        row.appendChild(checkbox);
        row.appendChild(text);
        paramsDropdownList.appendChild(row);

        // Handle Selection
        checkbox.addEventListener('change', () => {
            const allChecked = paramsDropdownList.querySelectorAll('.ep-opt-param-select-checkbox:checked');
            
            if (checkbox.checked) {
                if (allChecked.length > 3) {
                    checkbox.checked = false;
                    showAlert('Maximum 3 parameters allowed.', 'Limit Reached');
                    return;
                }
                // Add configuration card
                _addEpParamCard(p, activeParamsContainer);
            } else {
                // Remove configuration card
                _removeEpParamCard(p.id, activeParamsContainer);
            }
            
            _updateEpParamCount();
        });
    });
  }

    function _addEpParamCard(config, container, values = {}) {
      if (container.querySelector(`[data-param-id="${config.id}"]`)) return;

      const card = document.createElement('div');
      card.className = 'ep-opt-param-card p-3 bg-[--grid-color] border border-[--grid-color] rounded';
      card.dataset.paramId = config.id;

      // Header
      const header = document.createElement('div');
      header.className = 'flex justify-between items-center mb-2';
      header.innerHTML = `<span class="font-semibold truncate" title="${config.name}">${config.name}</span>`;
      
      const removeBtn = document.createElement('button');
      removeBtn.className = 'text-[--text-secondary] hover:text-[--danger-color] font-bold px-1';
      removeBtn.innerHTML = '&times;';
      removeBtn.onclick = () => {
          // Uncheck in dropdown
          const cb = paramsDropdownList.querySelector(`input[value="${config.id}"]`);
          if (cb) {
              cb.checked = false;
              cb.dispatchEvent(new Event('change'));
          }
      };
      header.appendChild(removeBtn);
      card.appendChild(header);

      // Inputs
      const controls = document.createElement('div');
      controls.className = 'grid grid-cols-3 gap-2 ep-opt-param-controls';

      if (config.type === 'continuous') {
        const createInput = (label, cls, def, val) => {
            const wrap = document.createElement('div');
            wrap.innerHTML = `<label class="label text-xs mb-0.5">${label}</label>`;
            const inp = document.createElement('input');
            inp.type = 'number';
            inp.className = `${cls} w-full text-xs p-1 rounded border border-[--grid-color] bg-[--bg-main]`;
            inp.value = val !== undefined ? val : def;
            inp.step = (label === 'Step') ? (def/10 || 0.0001) : config.default.step;
              wrap.appendChild(inp);
              return wrap;
          };

          controls.appendChild(createInput('Min', 'ep-opt-param-min', config.default.min, values.min));
          controls.appendChild(createInput('Max', 'ep-opt-param-max', config.default.max, values.max));
          controls.appendChild(createInput('Step', 'ep-opt-param-step', config.default.step, values.step));
      } else if (config.type === 'discrete') {
          const wrap = document.createElement('div');
          wrap.className = 'col-span-3';
        wrap.innerHTML = `<label class="label text-xs mb-0.5">Options</label>`;
        const select = document.createElement('select');
        select.className = 'ep-opt-param-options w-full text-xs p-1 rounded border border-[--grid-color] bg-[--bg-main]';
        select.disabled = true; // Fixed options for now
        (config.default.options || []).forEach(o => {
              const opt = document.createElement('option');
              opt.value = o;
              opt.textContent = o;
              select.appendChild(opt);
          });
          wrap.appendChild(select);
          controls.appendChild(wrap);
      }

      card.appendChild(controls);
      container.appendChild(card);
  }

  function _removeEpParamCard(id, container) {
      const card = container.querySelector(`[data-param-id="${id}"]`);
      if (card) card.remove();
  }

  // Wire buttons
  startBtn?.addEventListener('click', () => startEpOptimization('full'));
  quickBtn?.addEventListener('click', () => startEpOptimization('quick'));
  resumeBtn?.addEventListener('click', () => startEpOptimization('resume'));
  cancelBtn?.addEventListener('click', cancelEpOptimization);
  applyBestBtn?.addEventListener('click', () => {
    if (epSelectedDesignParams && epLastSettings) {
      _logEp('Applying best EnergyPlus design to configuration...');
      _applyEpDesign(epSelectedDesignParams, epLastSettings);
      showAlert('Best EnergyPlus design applied to configuration.', 'Success');
    } else {
      showAlert('No EnergyPlus design selected.', 'Error');
    }
  });

  // Info: brief explanation modal (reuse global modal infra if present)
  infoBtn?.addEventListener('click', () => {
    const modal = document.getElementById('ep-optimization-info-modal');
    if (modal) {
      modal.classList.replace('hidden', 'flex');
      modal.style.zIndex = getNewZIndex();
    } else {
      showAlert(
        'EnergyPlus Optimization runs a genetic search over key EnergyPlus configuration parameters using site energy KPIs.',
        'Info'
      );
    }
  });

  if (warningRuntime) {
    warningRuntime.classList.remove('hidden');
  }

  panel.dataset.initialized = 'true';
  _logEp('[EP-Opt] UI initialized.');
}

/**
 * Expose EP fitness cache to AI tools.
 */
export function getEpFitnessCache() {
  return epFitnessCache;
}

/**
 * Summarize optimization results for AI tool consumption.
 */
export function getEpOptimizationSummaryForTools() {
  if (!epFitnessCache || epFitnessCache.size === 0) return null;

  const evaluations = [];
  let best = null;

  for (const [key, val] of epFitnessCache.entries()) {
    const params = JSON.parse(key);
    const ssga = val.ssgaResult || {};
    evaluations.push({
      params,
      fitness: ssga.fitness,
      metricValue: ssga.metricValue,
      unit: ssga.unit,
      rawMetrics: val.rawMetrics || null
    });

    if (!best || (typeof ssga.fitness === 'number' && ssga.fitness > best.fitness)) {
      best = {
        params,
        fitness: ssga.fitness,
        metricValue: ssga.metricValue,
        unit: ssga.unit,
        rawMetrics: val.rawMetrics || null
      };
    }
  }

  return {
    best,
    evaluationsCount: evaluations.length,
    evaluations
  };
}

/**
 * Apply parameter selections coming from AI tool calls into the EP Opt UI.
 * This keeps DOM wiring encapsulated here.
 * @param {HTMLElement} panel
 * @param {Array<{id:string,min?:number,max?:number,step?:number}>} parameters
 */
export async function applyEpParameterConfigFromTool(panel, parameters) {
  if (!panel || !Array.isArray(parameters)) return;

  const dropdownList = panel.querySelector('#ep-opt-param-dropdown-list');
  const activeParamsContainer = panel.querySelector('#ep-opt-active-params-container');
  if (!dropdownList || !activeParamsContainer) throw new Error('EP optimization UI components not found.');

  // Clear existing selections
  dropdownList.querySelectorAll('.ep-opt-param-select-checkbox').forEach(cb => {
      if (cb.checked) {
          cb.checked = false;
          // Manually trigger removal logic via event dispatch or helper if exposed, 
          // but simpler to just clear container and checkboxes here since we control it.
      }
  });
  activeParamsContainer.innerHTML = '';

  let selectedCount = 0;

  for (const p of parameters) {
    if (!p || !p.id) continue;
    const cfg = MASTER_EP_PARAMETER_CONFIG[p.id];
    if (!cfg) {
      _logEp(`(Tool) Unknown EP optimization parameter id: ${p.id}`);
      continue;
    }

    const checkbox = dropdownList.querySelector(`input[value="${p.id}"]`);
    if (!checkbox) {
      _logEp(`(Tool) No dropdown item found for EP parameter: ${p.id}`);
      continue;
    }

    if (selectedCount >= 3) {
      _logEp('(Tool) Skipping extra parameter; max 3 allowed.');
      break;
    }

    // Activate checkbox
    checkbox.checked = true;
    
    // Programmatically trigger change event to render the card? 
    // Or just manually render card with custom values to be safe/clean.
    // We'll manually render to inject the specific values directly.
    
    // Re-use internal helper if we can, or replicate logic. 
    // Since _addEpParamCard is internal scope in init, we replicate the DOM creation 
    // or dispatch event and THEN update values. 
    // Dispatching event is safer to reuse logic.
    checkbox.dispatchEvent(new Event('change'));

    // Now find the created card and update values if continuous
    const card = activeParamsContainer.querySelector(`[data-param-id="${p.id}"]`);
    if (card && cfg.type === 'continuous') {
        const minInput = card.querySelector('.ep-opt-param-min');
        const maxInput = card.querySelector('.ep-opt-param-max');
        const stepInput = card.querySelector('.ep-opt-param-step');
        if (minInput && typeof p.min === 'number') minInput.value = p.min;
        if (maxInput && typeof p.max === 'number') maxInput.value = p.max;
        if (stepInput && typeof p.step === 'number') stepInput.value = p.step;
    }

    selectedCount++;
  }

  _updateEpParamCount();
}

// ============ CORE CONTROL ============

export async function startEpOptimization(mode = 'full') {
  if (!epOptimizationPanel) {
    showAlert('EnergyPlus Optimization panel not initialized.', 'Error');
    return;
  }

  if (epIsOptimizing) {
    showAlert('EnergyPlus optimization already running.', 'Error');
    return;
  }

  const resume = mode === 'resume';
  if (resume && !epOptimizer) {
    showAlert('No previous EnergyPlus optimization run to resume.', 'Error');
    return;
  }

  const summaryList = epOptimizationPanel.querySelector('#ep-optimization-summary-list');
  const placeholder = epOptimizationPanel.querySelector('#ep-opt-summary-placeholder');
  if (!resume) {
    if (summaryList) summaryList.innerHTML = '';
    if (placeholder) placeholder.style.display = 'block';
    epFitnessCache.clear();
    epSelectedDesignParams = null;
    epLastSettings = null;
    _clearEpLog();
  }

  try {
    _setEpControlsLocked(true);
    const settings = _gatherEpSettings(mode);
    epLastSettings = settings;

    // Preconditions
    _ensureEpPreconditions(settings);

    // Only SSGA (single-objective) for now.
    _logEp(`Starting EnergyPlus optimization (${mode}) with goal: ${settings.goalId}`);
    _logEp(`  Population: ${settings.populationSize}, Max Evals: ${settings.maxEvaluations}`);
    _logEp(
      `  Params: ${settings.parameters.map(p => p.id || p.name).join(', ') || 'None'}`
    );

    epOptimizer = new GeneticOptimizer({
      populationSize: settings.populationSize,
      maxEvaluations: settings.maxEvaluations,
      mutationRate: 0.1,
      parameterConstraints: settings.parameters.map(p => ({
        name: p.id,
        type: p.type,
        min: p.min,
        max: p.max,
        step: p.step,
        options: p.options
      }))
    });

    if (resume) {
      // MVP: no checkpointing; could be added analogous to optimizationOrchestrator
      _logEp('Resume requested, but checkpoint restore not implemented for EP optimizer.');
    }

    epIsOptimizing = true;

    const fitnessFunction = async (designParams) => {
      if (epOptimizer.shouldStop) {
        throw new Error('Optimization cancelled');
      }

      const key = JSON.stringify(designParams);
      if (epFitnessCache.has(key)) {
        _logEp(`  → (Cache HIT) ${key}`);
        return epFitnessCache.get(key).ssgaResult;
      }

      _logEp(`  Evaluating design ${key}`);
      const metrics = await _evaluateEpDesignHeadless(designParams, settings);
      const fit = _calculateSingleEpFitness(metrics, settings);

      const result = {
        params: designParams,
        fitness: fit.score,
        metricValue: fit.value,
        unit: fit.unit
      };

      epFitnessCache.set(key, { rawMetrics: metrics, ssgaResult: result });
      _logEp(`    → Fitness: ${fit.score.toFixed(3)} (${fit.value?.toFixed?.(3) ?? fit.value}${fit.unit})`);
      return result;
    };

    const progressCallback = async (evalsCompleted, bestDesign) => {
      _populateEpResults([bestDesign]);
      if (bestDesign && typeof bestDesign.metricValue === 'number') {
        _logEp(
          `✓ Evals ${evalsCompleted}/${settings.maxEvaluations}. Best: ${bestDesign.metricValue.toFixed(
            3
          )}${bestDesign.unit}`
        );
      } else {
        _logEp(`✓ Evals ${evalsCompleted}/${settings.maxEvaluations}.`);
      }
    };

    const best = await epOptimizer.run(fitnessFunction, progressCallback);

    if (epIsOptimizing && best) {
      _logEp('🎉 EnergyPlus optimization complete.');
      _logEp('Best design parameters:');
      Object.entries(best.params).forEach(([k, v]) => _logEp(`  ${k}: ${v}`));
      _logEp(`Objective: ${best.metricValue.toFixed(3)}${best.unit}`);
      // Do not auto-apply; leave to user via "Apply Best Design"
      showAlert('EnergyPlus optimization complete. Select and apply the best design from the list.', 'Success');
    }
  } catch (err) {
    _logEp(`❌ Error: ${err.message}`);
    if (err.message === 'EP optimization cancelled') {
      showAlert('EnergyPlus optimization cancelled.', 'Info');
    } else if (!/cancel/i.test(err.message)) {
      showAlert(`EnergyPlus optimization failed: ${err.message}`, 'Error');
    } else {
      showAlert('EnergyPlus optimization cancelled.', 'Info');
    }
  } finally {
    epIsOptimizing = false;
    _setEpControlsLocked(false);
    const cancelBtn = epOptimizationPanel.querySelector('#ep-cancel-optimization-btn');
    if (cancelBtn) {
      cancelBtn.disabled = false;
      cancelBtn.textContent = 'Cancel';
    }
  }
}

export function cancelEpOptimization() {
  if (epOptimizer) {
    epOptimizer.stop();
    _logEp('❌ Cancellation requested - EP optimization will stop after current evaluation.');
    const cancelBtn = epOptimizationPanel?.querySelector('#ep-cancel-optimization-btn');
    if (cancelBtn) {
      cancelBtn.disabled = true;
      cancelBtn.textContent = 'Cancelling...';
    }
  }
}

// ============ INTERNAL: SETTINGS GATHERING ============

function _gatherEpSettings(mode = 'full') {
  if (!epOptimizationPanel) {
    throw new Error('EnergyPlus Optimization panel not initialized.');
  }

  const goalMetricSelect = epOptimizationPanel.querySelector('#ep-opt-goal-metric');
  const goalTypeSelect = epOptimizationPanel.querySelector('#ep-opt-goal-type');
  const targetValueInput = epOptimizationPanel.querySelector('#ep-opt-goal-target-value');
  const constraintInput = epOptimizationPanel.querySelector('#ep-opt-constraint');
  const populationInput = epOptimizationPanel.querySelector('#ep-opt-population-size');
  const maxEvalsInput = epOptimizationPanel.querySelector('#ep-opt-max-evals');
  const paramsContainer =
    epOptimizationPanel.querySelector('#ep-opt-params-container') ||
    epOptimizationPanel.querySelector('#ep-dynamic-opt-params-list');
  const activeParamsContainer = epOptimizationPanel.querySelector('#ep-opt-active-params-container');
  const goalId = goalMetricSelect?.value || 'minimize_total_site_energy';
  const goalType = goalTypeSelect?.value || 'minimize';
  const targetValue = parseFloat(targetValueInput?.value || '0');
  const constraint = (constraintInput?.value || '').trim();

  let populationSize = parseInt(populationInput?.value || '8', 10);
  let maxEvaluations = parseInt(maxEvalsInput?.value || '20', 10);

  // Defensive defaults if user input is invalid
  if (!Number.isFinite(populationSize) || populationSize <= 0) populationSize = 8;
  if (!Number.isFinite(maxEvaluations) || maxEvaluations <= 0) maxEvaluations = 20;

  if (mode === 'quick') {
    // Quick mode: keep very conservative limits
    populationSize = Math.max(4, Math.min(populationSize, 6));
    maxEvaluations = Math.max(4, Math.min(maxEvaluations, 10));
  }

  // Global safety caps to avoid abusive runtimes
  populationSize = Math.min(Math.max(populationSize, 2), 50);
  maxEvaluations = Math.min(Math.max(maxEvaluations, populationSize), 200);

  const selectedParams = [];

  if (activeParamsContainer) {
    // Iterate over the configuration cards, not the checkboxes
    activeParamsContainer.querySelectorAll('.ep-opt-param-card').forEach(card => {
      const id = card.dataset.paramId;
      const cfg = MASTER_EP_PARAMETER_CONFIG[id];
      if (!cfg) return;

      if (cfg.type === 'continuous') {
        let min = parseFloat(card.querySelector('.ep-opt-param-min')?.value ?? cfg.default.min);
        let max = parseFloat(card.querySelector('.ep-opt-param-max')?.value ?? cfg.default.max);
        let step = parseFloat(card.querySelector('.ep-opt-param-step')?.value ?? cfg.default.step);

        if (!Number.isFinite(min)) min = cfg.default.min;
        if (!Number.isFinite(max)) max = cfg.default.max;
        if (!Number.isFinite(step) || step <= 0) step = cfg.default.step;

        if (min >= max) {
          throw new Error(`Invalid range for ${cfg.name}: min must be less than max.`);
        }

        selectedParams.push({ id, type: 'continuous', min, max, step });
      } else if (cfg.type === 'discrete') {
        const options = cfg.default.options || [];
        if (!options.length) return;
        selectedParams.push({ id, type: 'discrete', options });
      }
    });
  }

  if (selectedParams.length === 0) {
    throw new Error('No EnergyPlus parameters selected. Please select at least one.');
  }
  if (selectedParams.length > 3) {
    throw new Error('Maximum 3 parameters allowed for EnergyPlus optimization.');
  }

  return {
    type: 'ssga', // MVP: single-objective GA
    goalId,
    goalType,
    targetValue,
    constraint,
    populationSize,
    maxEvaluations,
    parameters: selectedParams
  };
}

function _ensureEpPreconditions(settings) {
  if (!window.electronAPI) {
    throw new Error('EnergyPlus optimization requires Electron environment.');
  }
  if (!project.dirPath) {
    throw new Error('Save the project before running EnergyPlus optimization.');
  }

  const epConfig = energyplusConfigService.getConfig?.(project) || project.energyPlusConfig || {};
  const epwPath =
    epConfig.weather?.epwPath || project.energyPlusWeatherPath || project.epwPath || null;
  const epExecutable =
    epConfig.energyPlusExecutable ||
    project.energyPlusExecutable ||
    project.energyplusPath ||
    null;

  if (!epwPath) {
    throw new Error('EnergyPlus weather file (EPW) is not configured.');
  }
  if (!epExecutable) {
    throw new Error('EnergyPlus executable path is not configured.');
  }

  if (!window.electronAPI.runEnergyPlus) {
    throw new Error('runEnergyPlus API not available in Electron preload.');
  }
}

// ============ INTERNAL: EVALUATION PIPELINE ============

async function _evaluateEpDesignHeadless(designParams, settings) {
  // 1) Load and mutate EP config
  const baseConfig =
    energyplusConfigService.getConfig?.(project) ||
    project.energyPlusConfig ||
    {};

  const config = JSON.parse(JSON.stringify(baseConfig)); // clone

  for (const p of settings.parameters) {
    const paramCfg = MASTER_EP_PARAMETER_CONFIG[p.id];
    if (!paramCfg || typeof paramCfg.apply !== 'function') continue;
    const val = designParams[p.id];
    if (val === undefined || val === null) continue;
    paramCfg.apply(config, val, { project });
  }

  if (energyplusConfigService.setConfig) {
    energyplusConfigService.setConfig(project, config);
  } else if (energyplusConfigService.updateConfig) {
    energyplusConfigService.updateConfig(project, config);
  } else {
    // Fallback: store on project (if your app reads from there)
    project.energyPlusConfig = config;
  }

  // 2) Generate IDF
  await generateAndStoreIdf(project);

  const epConfig =
    energyplusConfigService.getConfig?.(project) ||
    project.energyPlusConfig ||
    {};
  const epwPath =
    epConfig.weather?.epwPath || project.energyPlusWeatherPath || project.epwPath;
  const epExecutable =
    epConfig.energyPlusExecutable ||
    project.energyPlusExecutable ||
    project.energyplusPath;

  const runId = `epopt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const idfPath = `${project.dirPath}/model.idf`;

  // 3) Run EnergyPlus via Electron
  const metrics = await new Promise((resolve, reject) => {
    if (!window.electronAPI?.runEnergyPlus || !window.electronAPI.onEnergyPlusExit) {
      return reject(new Error('runEnergyPlus/onEnergyPlusExit not available.'));
    }

    let settled = false;
    let unsubscribe = null;

    const safeSettle = (fn) => {
      if (settled) return;
      settled = true;
      if (typeof unsubscribe === 'function') {
        try {
          unsubscribe();
        } catch (e) {
          console.warn('[EP-Optimization] Failed to unsubscribe EnergyPlusExit listener:', e);
        }
      }
      fn();
    };

    unsubscribe = window.electronAPI.onEnergyPlusExit((payload) => {
      // Expect payload: { runId, exitCode, baseDir, errContent, status }
      if (!payload || payload.runId !== runId) return;
      safeSettle(() => {
        try {
          if (resultsManager.parseEnergyPlusResults) {
            resultsManager.parseEnergyPlusResults(runId, {
              baseDir: payload.baseDir,
              errContent: payload.errContent,
              statusFromRunner: payload.exitCode
            });
          }

          const m = {};
          Object.values(EP_METRICS).forEach(def => {
            const v = def.extract(runId);
            if (v !== null && v !== undefined && !Number.isNaN(v)) {
              m[def.id] = v;
            }
          });

          if (Object.keys(m).length === 0) {
            reject(new Error('No EnergyPlus KPIs extracted for this run. Check EPW/IDF and KPI parsing.'));
          } else {
            resolve(m);
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    try {
      window.electronAPI.runEnergyPlus({
        idfPath,
        epwPath,
        energyPlusPath: epExecutable,
        runId,
        runName: 'ep-optimization'
      });
    } catch (err) {
      safeSettle(() => reject(err));
    }

    // Safety timeout
    setTimeout(() => {
      safeSettle(() => reject(new Error('EnergyPlus run timeout for optimization design. Verify EnergyPlus installation and model stability.')));
    }, 1000 * 60 * 10); // 10 minutes
  });

  return metrics;
}

// ============ INTERNAL: FITNESS & RESULTS UI ============

function _calculateSingleEpFitness(metrics, settings) {
  const { goalId, goalType, targetValue, constraint } = settings;
  const metricDef = EP_METRICS[goalId];
  if (!metricDef) {
    throw new Error(`Unknown EnergyPlus goal metric: ${goalId}`);
  }

  const rawValue = metrics[goalId];
  if (rawValue === undefined || rawValue === null || Number.isNaN(rawValue)) {
    throw new Error(`Missing metric value for ${goalId}`);
  }

  let score;
  if (goalType === 'maximize') {
    score = rawValue;
  } else if (goalType === 'minimize') {
    score = -rawValue;
  } else {
    // set-target
    score = -Math.abs(rawValue - targetValue);
  }

  if (constraint) {
    const ok = _checkEpConstraint(metrics, constraint);
    if (!ok) {
      score = -Infinity;
      _logEp(`    → Constraint FAILED (${constraint}) with metrics: ${JSON.stringify(metrics)}`);
    }
  }

  return {
    score,
    value: rawValue,
    unit: metricDef.unit || ''
  };
}

function _checkEpConstraint(metrics, constraintStr) {
  // Very simple constraint parser:
  // "<metricId> <op> <value>"
  // where <metricId> is an EP_METRICS id, e.g. minimize_total_site_energy
  const parts = constraintStr.trim().split(/\s+/);
  if (parts.length < 3) return true;

  const metricId = parts[0];
  const op = parts[1];
  const val = parseFloat(parts[2]);
  if (!EP_METRICS[metricId] || Number.isNaN(val)) return true;

  const mValue = metrics[metricId];
  if (mValue === undefined || mValue === null) return true;

  switch (op) {
    case '<': return mValue < val;
    case '<=': return mValue <= val;
    case '>': return mValue > val;
    case '>=': return mValue >= val;
    case '==': return Math.abs(mValue - val) < 1e-6;
    default: return true;
  }
}

function _populateEpResults(paretoLikeArray) {
  if (!epOptimizationPanel) return;

  const summaryList = epOptimizationPanel.querySelector('#ep-optimization-summary-list');
  const placeholder = epOptimizationPanel.querySelector('#ep-opt-summary-placeholder');
  const applyBestBtn = epOptimizationPanel.querySelector('#ep-apply-best-design-btn');
  if (!summaryList || !placeholder) return;

  placeholder.style.display = 'none';
  summaryList.innerHTML = '';
  epSelectedDesignParams = null;
  applyBestBtn?.classList.add('hidden');

  const best = paretoLikeArray && paretoLikeArray[0];
  if (!best) return;

  const li = document.createElement('li');
  li.className = 'p-2 bg-[--grid-color] rounded active-result cursor-pointer';
  li.dataset.params = JSON.stringify(best.params);
  li.innerHTML = `
    <strong>Best:</strong> ${typeof best.metricValue === 'number' ? best.metricValue.toFixed(3) : best.metricValue}${best.unit || ''}<br>
    <span class="text-[10px] break-all">${JSON.stringify(best.params)}</span>
  `;

  li.addEventListener('click', () => {
    summaryList.querySelectorAll('li').forEach(x => x.classList.remove('active-result'));
    li.classList.add('active-result');
    epSelectedDesignParams = JSON.parse(li.dataset.params);
    applyBestBtn?.classList.remove('hidden');
  });

  summaryList.appendChild(li);
  epSelectedDesignParams = best.params;
  applyBestBtn?.classList.remove('hidden');
}

async function _applyEpDesign(params, settings) {
  const baseConfig =
    energyplusConfigService.getConfig?.(project) ||
    project.energyPlusConfig ||
    {};
  const config = JSON.parse(JSON.stringify(baseConfig));

  for (const p of settings.parameters) {
    const cfg = MASTER_EP_PARAMETER_CONFIG[p.id];
    const val = params[p.id];
    if (cfg && typeof cfg.apply === 'function' && val !== undefined) {
      cfg.apply(config, val, { project });
    }
  }

  if (energyplusConfigService.setConfig) {
    energyplusConfigService.setConfig(project, config);
  } else if (energyplusConfigService.updateConfig) {
    energyplusConfigService.updateConfig(project, config);
  } else {
    project.energyPlusConfig = config;
  }
}

// ============ INTERNAL: UI HELPERS ============

function _logEp(msg) {
  if (!epOptimizationPanel) {
    console.log('[EP-Optimization]', msg);
    return;
  }
  const logEl = epOptimizationPanel.querySelector('#ep-optimization-log');
  if (logEl) {
    logEl.textContent += `${msg}\n`;
    logEl.scrollTop = logEl.scrollHeight;
  }
  console.log('[EP-Optimization]', msg);
}

function _clearEpLog() {
  if (!epOptimizationPanel) return;
  const logEl = epOptimizationPanel.querySelector('#ep-optimization-log');
  if (logEl) logEl.textContent = '';
}

function _setEpControlsLocked(locked) {
  if (!epOptimizationPanel) return;
  [
    '#ep-start-optimization-btn',
    '#ep-quick-optimize-btn',
    '#ep-resume-optimization-btn',
    '#ep-cancel-optimization-btn'
  ].forEach(sel => {
    const el = epOptimizationPanel.querySelector(sel);
    if (el) el.disabled = locked && sel !== '#ep-cancel-optimization-btn';
  });
}

function _updateEpParamCount() {
  if (!epOptimizationPanel) return;
  const dropdownList = epOptimizationPanel.querySelector('#ep-opt-param-dropdown-list');
  const countEl = epOptimizationPanel.querySelector('#ep-opt-param-count');
  if (!dropdownList || !countEl) return;

  const checked = dropdownList.querySelectorAll('.ep-opt-param-select-checkbox:checked').length;
  countEl.textContent = `${checked} / 3 selected`;
  countEl.classList.toggle('text-[--danger-color]', checked >= 3);
}
