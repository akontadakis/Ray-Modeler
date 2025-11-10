// scripts/energyplusDefaults.js
// ESM-compatible defaults module for EnergyPlus, derived from OffiveRoomModel_WWR40.idf.
// No fs/require/browser fetch: all data is bundled via static JSON import.

import defaults from '../defaults/energyplusDefaultsData.js';

let cache = null;

export function loadDefaults() {
  if (cache) return cache;
  cache = defaults;
  return cache;
}

// Generic accessors

export function getSimulationDefaults() {
  return loadDefaults().simulation || {};
}

export function getScheduleTypeLimitsDefaults() {
  return loadDefaults().scheduleTypeLimits || [];
}

export function getSchedulesCompactDefaults() {
  return loadDefaults().schedulesCompact || [];
}

export function getMaterialDefaults() {
  return loadDefaults().materials || {};
}

export function getConstructionDefaults() {
  return loadDefaults().constructions || [];
}

export function getLoadDefaults() {
  return loadDefaults().loads || {};
}

export function getHVACTemplateDefaults() {
  return loadDefaults().hvacTemplates || {};
}

export function getOutputDefaults() {
  return loadDefaults().outputs || {};
}

// Role-based helpers

export function getDefaultOfficePeopleTemplate() {
  const loads = getLoadDefaults();
  return (loads.People || []).find(p => p.Name === 'Default_Office_People') || null;
}

export function getDefaultOfficeLightingTemplates() {
  const loads = getLoadDefaults();
  return loads.Lights || [];
}

export function getDefaultOfficeEquipmentTemplate() {
  const loads = getLoadDefaults();
  return (loads.ElectricEquipment || [])[0] || null;
}

export function getDefaultInfiltrationTemplate() {
  const loads = getLoadDefaults();
  return (loads['ZoneInfiltration:DesignFlowRate'] || [])[0] || null;
}

export function getDefaultVentilationTemplate() {
  const loads = getLoadDefaults();
  return (loads['ZoneVentilation:DesignFlowRate'] || [])[0] || null;
}

export function getDefaultThermostatTemplate() {
  const hvac = getHVACTemplateDefaults();
  return (hvac.Thermostats || [])[0] || null;
}

export function getDefaultIdealLoadsTemplate() {
  const hvac = getHVACTemplateDefaults();
  return (hvac.IdealLoads || [])[0] || null;
}

// Build flat IDF object list in dependency-safe order, if needed externally.
export function buildDefaultIdfObjects() {
  const sim = getSimulationDefaults();
  const stl = getScheduleTypeLimitsDefaults();
  const sch = getSchedulesCompactDefaults();
  const mats = getMaterialDefaults();
  const cons = getConstructionDefaults();
  const loads = getLoadDefaults();
  const hvac = getHVACTemplateDefaults();
  const outputs = getOutputDefaults();

  const objects = [];

  // Simulation / global
  if (sim['SimulationControl']) {
    objects.push({ type: 'SimulationControl', fields: sim['SimulationControl'] });
  }
  if (sim['Building']) {
    objects.push({ type: 'Building', fields: sim['Building'] });
  }
  if (sim['SurfaceConvectionAlgorithm:Inside']) {
    objects.push({
      type: 'SurfaceConvectionAlgorithm:Inside',
      fields: sim['SurfaceConvectionAlgorithm:Inside'],
    });
  }
  if (sim['SurfaceConvectionAlgorithm:Outside']) {
    objects.push({
      type: 'SurfaceConvectionAlgorithm:Outside',
      fields: sim['SurfaceConvectionAlgorithm:Outside'],
    });
  }
  if (sim['HeatBalanceAlgorithm']) {
    objects.push({ type: 'HeatBalanceAlgorithm', fields: sim['HeatBalanceAlgorithm'] });
  }
  if (sim['Timestep']) {
    objects.push({ type: 'Timestep', fields: sim['Timestep'] });
  }
  if (sim['Site:Location']) {
    objects.push({ type: 'Site:Location', fields: sim['Site:Location'] });
  }
  if (sim['SizingPeriod:WeatherFileDays']) {
    objects.push({
      type: 'SizingPeriod:WeatherFileDays',
      fields: sim['SizingPeriod:WeatherFileDays'],
    });
  }
  if (sim['RunPeriod']) {
    objects.push({ type: 'RunPeriod', fields: sim['RunPeriod'] });
  }
  if (sim['RunPeriodControl:DaylightSavingTime']) {
    objects.push({
      type: 'RunPeriodControl:DaylightSavingTime',
      fields: sim['RunPeriodControl:DaylightSavingTime'],
    });
  }

  // ScheduleTypeLimits
  stl.forEach(s => {
    objects.push({ type: 'ScheduleTypeLimits', fields: s });
  });

  // Schedule:Compact
  sch.forEach(s => {
    objects.push({ type: 'Schedule:Compact', fields: s });
  });

  // Materials
  (mats['Material'] || []).forEach(m => {
    objects.push({ type: 'Material', fields: m });
  });
  (mats['Material:AirGap'] || []).forEach(m => {
    objects.push({ type: 'Material:AirGap', fields: m });
  });
  (mats['WindowMaterial:Glazing'] || []).forEach(m => {
    objects.push({ type: 'WindowMaterial:Glazing', fields: m });
  });
  (mats['WindowMaterial:Gas'] || []).forEach(m => {
    objects.push({ type: 'WindowMaterial:Gas', fields: m });
  });
  (mats['WindowMaterial:Shade'] || []).forEach(m => {
    objects.push({ type: 'WindowMaterial:Shade', fields: m });
  });

  // Constructions
  cons.forEach(c => {
    objects.push({ type: 'Construction', fields: c });
  });

  // Loads
  (loads.People || []).forEach(p => {
    objects.push({ type: 'People', fields: p });
  });
  (loads.Lights || []).forEach(l => {
    objects.push({ type: 'Lights', fields: l });
  });
  (loads.ElectricEquipment || []).forEach(e => {
    objects.push({ type: 'ElectricEquipment', fields: e });
  });
  (loads['ZoneInfiltration:DesignFlowRate'] || []).forEach(z => {
    objects.push({ type: 'ZoneInfiltration:DesignFlowRate', fields: z });
  });
  (loads['ZoneVentilation:DesignFlowRate'] || []).forEach(z => {
    objects.push({ type: 'ZoneVentilation:DesignFlowRate', fields: z });
  });

  // HVAC Templates
  (hvac.Thermostats || []).forEach(t => {
    objects.push({ type: 'HVACTemplate:Thermostat', fields: t });
  });
  (hvac.IdealLoads || []).forEach(i => {
    objects.push({
      type: 'HVACTemplate:Zone:IdealLoadsAirSystem',
      fields: i,
    });
  });

  // Outputs
  (outputs['Output:IlluminanceMap'] || []).forEach(m => {
    objects.push({ type: 'Output:IlluminanceMap', fields: m });
  });
  if (outputs['Output:VariableDictionary']) {
    objects.push({
      type: 'Output:VariableDictionary',
      fields: outputs['Output:VariableDictionary'],
    });
  }
  if (outputs['Output:Surfaces:List']) {
    objects.push({
      type: 'Output:Surfaces:List',
      fields: outputs['Output:Surfaces:List'],
    });
  }
  if (outputs['Output:Surfaces:Drawing']) {
    objects.push({
      type: 'Output:Surfaces:Drawing',
      fields: outputs['Output:Surfaces:Drawing'],
    });
  }
  if (outputs['Output:Constructions']) {
    objects.push({
      type: 'Output:Constructions',
      fields: outputs['Output:Constructions'],
    });
  }
  if (outputs['Output:Table:SummaryReports']) {
    objects.push({
      type: 'Output:Table:SummaryReports',
      fields: outputs['Output:Table:SummaryReports'],
    });
  }
  if (outputs['OutputControl:Table:Style']) {
    objects.push({
      type: 'OutputControl:Table:Style',
      fields: outputs['OutputControl:Table:Style'],
    });
  }
  (outputs['Output:Variable'] || []).forEach(v => {
    objects.push({ type: 'Output:Variable', fields: v });
  });
  if (outputs['Output:SQLite']) {
    objects.push({ type: 'Output:SQLite', fields: outputs['Output:SQLite'] });
  }
  if (outputs['Output:Diagnostics']) {
    objects.push({
      type: 'Output:Diagnostics',
      fields: outputs['Output:Diagnostics'],
    });
  }

  return objects;
}
