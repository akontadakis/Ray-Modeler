// scripts/energyplusModelBuilder.js
// Minimal EnergyPlus IDF builder integrated with Ray-Modeler data structures.
// Goal: take current project state and global simulation params and emit a runnable IDF.
//
// Canonical configuration entrypoint (single source of truth):
//   meta.energyPlusConfig (or meta.energyplus for backward-compat)
//
// energyPlusConfig schema (summary):
//
//   {
//     timestep?: number,
//     runPeriod?: { startMonth, startDay, endMonth, endDay },
//     northAxis?: number,
//     terrain?: string,
//     weatherFilePath?: string,
//     location?: {
//       name: string,
//       latitude: number,
//       longitude: number,
//       timeZone: number,
//       elevation: number,
//     },
//
//     materials?: (
//       | {
//           type: 'Material',
//           name: string,
//           roughness?: string,
//           thickness?: number,
//           conductivity?: number,
//           density?: number,
//           specificHeat?: number,
//           solarAbsorptance?: number,
//           thermalAbsorptance?: number,
//           visibleAbsorptance?: number,
//         }
//       | {
//           type: 'Material:NoMass',
//           name: string,
//           roughness?: string,
//           thermalResistance?: number,
//           solarAbsorptance?: number,
//           thermalAbsorptance?: number,
//           visibleAbsorptance?: number,
//         }
//       | {
//           type: 'WindowMaterial:SimpleGlazingSystem',
//           name: string,
//           uFactor?: number,
//           solarHeatGainCoeff?: number,
//           visibleTransmittance?: number,
//         }
//     )[],
//
//     constructions?: {
//       name: string,
//       layers: string[], // material names
//     }[],
//
//     schedules?: {
//       compact?: (
//         | {
//             name: string,
//             typeLimits?: string,
//             lines: string[],
//           }[]
//         | {
//             [name: string]: {
//               typeLimits?: string,
//               lines: string[],
//             },
//           }
//       )
//     },
//
//     defaults?: {
//       wallConstruction?: string,
//       roofConstruction?: string,
//       floorConstruction?: string,
//       windowConstruction?: string,
//       // future: intWall, intFloor, door, etc.
//     },
//
//     zoneLoads?: {
//       zoneName: string,
//       people?: {
//         peoplePerArea?: number,
//         schedule?: string,
//         activityLevel?: number,
//       },
//       lighting?: {
//         wattsPerArea?: number,
//         schedule?: string,
//       },
//       equipment?: {
//         wattsPerArea?: number,
//         schedule?: string,
//       },
//       infiltration?: {
//         ach?: number,          // air changes per hour
//         flowPerArea?: number,  // m3/s-m2
//         schedule?: string,
//       },
//     }[],
//
//     thermostats?: {
//       zoneName?: string | 'GLOBAL',
//       heatingScheduleName?: string,
//       coolingScheduleName?: string,
//     }[],
//
//     idealLoads?: {
//       global?: {
//         availabilitySchedule?: string,
//         heatingLimitType?: string,
//         maxHeatingCapacity?: number,
//         coolingLimitType?: string,
//         maxCoolingCapacity?: number,
//         outdoorAirMethod?: string,
//         outdoorAirFlowPerPerson?: number,
//         outdoorAirFlowPerArea?: number,
//       },
//       perZone?: {
//         zoneName: string,
//         availabilitySchedule?: string,
//         heatingLimitType?: string,
//         maxHeatingCapacity?: number,
//         coolingLimitType?: string,
//         maxCoolingCapacity?: number,
//         outdoorAirMethod?: string,
//         outdoorAirFlowPerPerson?: number,
//         outdoorAirFlowPerArea?: number,
//       }[],
//     },
//
//     daylighting?: {
//       controls?: {
//         zoneName: string,
//         enabled?: boolean, // if false, ignore
//         refPoints: { x: number, y: number, z: number }[], // 1–2 points used
//         setpoint: number, // lux
//         fraction?: number, // fraction of zone controlled (0–1)
//         type?: 'Continuous' | 'Stepped' | 'ContinuousOff',
//       }[],
//       outputs?: {
//         illuminanceMaps?: {
//           name: string,
//           zoneName: string,
//           xOrigin: number,
//           yOrigin: number,
//           zHeight: number,
//           xNumPoints: number,
//           xSpacing: number,
//           yNumPoints: number,
//           ySpacing: number,
//         }[],
//         variables?: {
//           key: string, // e.g. zone name, 'Environment', '*', etc.
//           variableName: string,
//           reportingFrequency?: 'Timestep' | 'Hourly' | 'Daily' | 'Monthly' | 'RunPeriod',
//         }[],
//       },
//     },
//   }
//
// Notes:
// - All names are sanitized by sanitize().
// - Builder is pure/deterministic: no DOM, no side effects beyond returning IDF text.
// - Invalid or incomplete entries are gracefully ignored; built-ins provide robustness.

import { project } from './project.js';
import * as energyplusDefaults from './energyplusDefaults.js';

/**
 * Build a minimal EnergyPlus IDF from the current Ray-Modeler project.
 * Pure function: output depends only on (options + project metadata accessors).
 *
 * @param {object} options
 *  - weatherFilePath {string} Optional EPW path for Sizing/RunPeriod context.
 *  - buildingName {string} Optional building name override.
 *  - runPeriod {object} Optional { startMonth, startDay, endMonth, endDay }
 *  - timestep {number} Optional timestep per hour (default 6 → 10-min).
 *  - northAxis {number} Optional north axis in degrees.
 *  - terrain {string} Optional terrain (default 'City').
 *  - location {object} Optional { name, latitude, longitude, timeZone, elevation }
 *  - materials {Array} Optional explicit material definitions (see schema above).
 *  - constructions {Array} Optional construction definitions (layered assemblies).
 *  - schedules {Object} Optional schedule presets and/or custom schedules.
 *  - loads {Array} Optional zone-level internal loads referencing schedules.
 *  - defaults {Object} Optional defaults e.g. { wallConstruction, roofConstruction, ... }.
 *  - idealLoads {Object} Optional global/per-zone IdealLoadsAirSystem config.
 *  - thermostats {Array} Optional thermostat setpoint bindings.
 *  - daylighting {Object} Optional daylighting controls and outputs (see schema).
 *
 * @returns {string} IDF content
 */
export function buildEnergyPlusModel(options = {}) {
    const {
        weatherFilePath,
        buildingName,
        runPeriod,
        timestep,
        northAxis,
        terrain,
        location,
        materials,
        constructions,
        schedules,
        loads,
        defaults,
        idealLoads,
        thermostats,
        daylighting,
    } = options;

    // 1) Base header and defaults
    const idf = [];

    // Load centralized defaults (materials, constructions, schedules, loads, HVAC, outputs)
    // extracted from OffiveRoomModel_WWR40.idf. These provide stable, reusable defaults.
    const epDefaults = energyplusDefaults.loadDefaults();

    idf.push(`! ==============================================================================`);
    idf.push(`!  IDF generated by Ray-Modeler (EnergyPlus integration)`);
    idf.push(`!  This is a minimal auto-generated model; extend mappings as needed.`);
    idf.push(`! ==============================================================================`);
    idf.push('');

    // VERSION
    idf.push(`Version,`);
    idf.push(`  9.5;                       !- Version Identifier`);
    idf.push('');

    // TIMESTEP (prefer user option, otherwise default library if present)
    let ts = Number.isFinite(timestep) && timestep > 0 ? timestep : null;
    if (!ts && epDefaults?.simulation?.Timestep?.NumberOfTimestepsPerHour) {
        ts = epDefaults.simulation.Timestep.NumberOfTimestepsPerHour;
    }
    if (!ts) ts = 6;
    idf.push(`Timestep,`);
    idf.push(`  ${ts};                     !- Number of Timesteps per Hour`);
    idf.push('');

    // SIMULATIONCONTROL
    if (epDefaults?.simulation?.['SimulationControl']) {
        const sc = epDefaults.simulation['SimulationControl'];
        idf.push(`SimulationControl,`);
        idf.push(`  ${sc.DoZoneSizingCalculation || 'No'},  !- Do Zone Sizing Calculation`);
        idf.push(`  ${sc.DoSystemSizingCalculation || 'No'},  !- Do System Sizing Calculation`);
        idf.push(`  ${sc.DoPlantSizingCalculation || 'No'},  !- Do Plant Sizing Calculation`);
        idf.push(`  ${sc.RunSimulationForSizingPeriods || 'No'},  !- Run Simulation for Sizing Periods`);
        idf.push(`  ${sc.RunSimulationForWeatherFileRunPeriods || 'Yes'};  !- Run Simulation for Weather File Run Periods`);
        idf.push('');
    } else {
        idf.push(`SimulationControl,`);
        idf.push(`  Yes,                      !- Do Zone Sizing Calculation`);
        idf.push(`  Yes,                      !- Do System Sizing Calculation`);
        idf.push(`  Yes,                      !- Do Plant Sizing Calculation`);
        idf.push(`  No,                       !- Run Simulation for Sizing Periods`);
        idf.push(`  Yes;                      !- Run Simulation for Weather File Run Periods`);
        idf.push('');
    }

    // SITE:LOCATION (fallback to something valid)
    const loc = location || inferLocationFromProject() || {
        name: 'Athens-GR',
        latitude: 37.98,
        longitude: 23.72,
        timeZone: 2.0,
        elevation: 107.0,
    };

    idf.push(`Site:Location,`);
    idf.push(`  ${sanitize(loc.name)},     !- Name`);
    idf.push(`  ${loc.latitude},           !- Latitude {deg}`);
    idf.push(`  ${loc.longitude},          !- Longitude {deg}`);
    idf.push(`  ${loc.timeZone},           !- Time Zone {hr}`);
    idf.push(`  ${loc.elevation};          !- Elevation {m}`);
    idf.push('');

    // RUNPERIOD
    const rp = runPeriod || {
        startMonth: 1,
        startDay: 1,
        endMonth: 12,
        endDay: 31,
    };

    idf.push(`RunPeriod,`);
    idf.push(`  Annual,                   !- Name`);
    idf.push(`  ${rp.startMonth},         !- Begin Month`);
    idf.push(`  ${rp.startDay},           !- Begin Day of Month`);
    idf.push(`  ,                         !- Begin Year`);
    idf.push(`  ${rp.endMonth},           !- End Month`);
    idf.push(`  ${rp.endDay},             !- End Day of Month`);
    idf.push(`  ,                         !- End Year`);
    idf.push(`  UseWeatherFile,           !- Day of Week for Start Day`);
    idf.push(`  Yes,                      !- Use Weather File Holidays and Special Days`);
    idf.push(`  Yes,                      !- Use Weather File Daylight Saving Period`);
    idf.push(`  Yes,                      !- Apply Weekend Holiday Rule`);
    idf.push(`  Yes,                      !- Use Weather File Rain Indicators`);
    idf.push(`  Yes;                      !- Use Weather File Snow Indicators`);
    idf.push('');

    // BUILDING (prefer defaults, allow overrides)
    const defaultBuilding = epDefaults?.simulation?.Building || {};
    const bName = buildingName || inferBuildingNameFromProject() || defaultBuilding.Name || 'Ray-Modeler Building';
    const bNorthAxis = Number.isFinite(northAxis)
        ? northAxis
        : (typeof defaultBuilding.NorthAxis_deg === 'number' ? defaultBuilding.NorthAxis_deg : 0.0);
    const bTerrain = terrain || defaultBuilding.Terrain || 'City';
    const bLoadsTol = defaultBuilding.LoadsConvergenceTolerance ?? 0.04;
    const bTempTol = defaultBuilding.TemperatureConvergenceTolerance_deltaC ?? 0.4;
    const bSolar = defaultBuilding.SolarDistribution || 'FullExterior';
    const bMaxWU = defaultBuilding.MaximumNumberOfWarmupDays ?? 25;
    const bMinWU = defaultBuilding.MinimumNumberOfWarmupDays ?? 6;

    idf.push(`Building,`);
    idf.push(`  ${sanitize(bName)},        !- Name`);
    idf.push(`  ${bNorthAxis},            !- North Axis {deg}`);
    idf.push(`  ${bTerrain},              !- Terrain`);
    idf.push(`  ${bLoadsTol},             !- Loads Convergence Tolerance Value`);
    idf.push(`  ${bTempTol},              !- Temperature Convergence Tolerance Value {deltaC}`);
    idf.push(`  ${bSolar},                !- Solar Distribution`);
    idf.push(`  ${bMaxWU},                !- Maximum Number of Warmup Days`);
    idf.push(`  ${bMinWU};                !- Minimum Number of Warmup Days`);
    idf.push('');

    // 2) Materials and Constructions
    const materialLibrary = buildMaterialLibrary(materials, epDefaults);
    emitMaterials(idf, materialLibrary);

    const constructionLibrary = buildConstructionLibrary(constructions, materialLibrary);
    emitConstructions(idf, constructionLibrary);

    const defaultConstructions = {
        wall: defaults?.wallConstruction || 'RM_Ext_Wall',
        roof: defaults?.roofConstruction || 'RM_Roof',
        floor: defaults?.floorConstruction || 'RM_Slab_On_Grade',
        window: defaults?.windowConstruction || 'RM_Dbl_Clr_3mm_13mmAir',
    };
    // defaultConstructions reserved for future surface mapping.

    // 3) Schedules
    const scheduleContext = buildSchedules(schedules);
    emitSchedules(idf, scheduleContext);

    // 4) Zones from project
    const zones = inferZonesFromProject();
    if (zones.length === 0) {
        // Provide at least one simple thermal zone so file is runnable.
        idf.push(`Zone,`);
        idf.push(`  Zone_1,                   !- Name`);
        idf.push(`  0.0,                      !- Direction of Relative North {deg}`);
        idf.push(`  0.0, 0.0, 0.0,            !- X,Y,Z Origin {m}`);
        idf.push(`  1,                        !- Type`);
        idf.push(`  1,                        !- Multiplier`);
        idf.push(`  autocalculate,            !- Ceiling Height {m}`);
        idf.push(`  autocalculate;            !- Volume {m3}`);
        idf.push('');
    } else {
        zones.forEach((z) => {
            idf.push(`Zone,`);
            idf.push(`  ${sanitize(z.name)},      !- Name`);
            idf.push(`  0.0,                      !- Direction of Relative North {deg}`);
            idf.push(
                `  ${z.x || 0.0}, ${z.y || 0.0}, ${z.z || 0.0},  !- X,Y,Z Origin {m}`
            );
            idf.push(`  1,                        !- Type`);
            idf.push(`  ${z.multiplier || 1},      !- Multiplier`);
            idf.push(`  autocalculate,            !- Ceiling Height {m}`);
            idf.push(`  autocalculate;            !- Volume {m3}`);
            idf.push('');
        });
    }

    // 5) Internal loads (People, Lights, Equipment, Infiltration)
    emitZoneLoads(idf, zones, loads, scheduleContext);

    // 6) Thermostats and IdealLoads for each zone (configurable)
    emitThermostatsAndIdealLoads(idf, zones, scheduleContext, idealLoads, thermostats);

    // 7) Daylighting & Outputs
    emitDaylighting(idf, zones, daylighting);

    // 8) Optionally embed a reference to weather file as comment
    if (weatherFilePath) {
        idf.push(`! Weather file: ${weatherFilePath}`);
        idf.push('');
    }

    return idf.join('\n');
}

/**
 * THERMOSTATS + IDEAL LOADS
 * Configurable control over ZoneHVAC:IdealLoadsAirSystem per zone.
 *
 * idealLoads shape:
 *  {
 *    global: {
 *      availabilitySchedule,
 *      heatingLimitType,
 *      maxHeatingCapacity,
 *      coolingLimitType,
 *      maxCoolingCapacity,
 *      outdoorAirMethod,
 *      outdoorAirFlowPerPerson,
 *      outdoorAirFlowPerArea
 *    },
 *    perZone: [
 *      {
 *        zoneName,
 *        availabilitySchedule,
 *        heatingLimitType,
 *        maxHeatingCapacity,
 *        coolingLimitType,
 *        maxCoolingCapacity,
 *        outdoorAirMethod,
 *        outdoorAirFlowPerPerson,
 *        outdoorAirFlowPerArea
 *      }
 *    ]
 *  }
 *
 * thermostats shape:
 *  [
 *    {
 *      zoneName or "global",
 *      heatingScheduleName,
 *      coolingScheduleName
 *    }
 *  ]
 */
function emitThermostatsAndIdealLoads(
    idf,
    zones,
    scheduleContext,
    idealLoads = {},
    thermostats = []
) {
    const znList = zones.length ? zones : [{ name: 'Zone_1' }];
    const compact = scheduleContext.compact || {};

    const getSched = (name, fallback) => {
        if (!name) return fallback;
        const key = sanitize(name);
        return compact[key] ? key : fallback;
    };

    const globalCfg = idealLoads.global || {};
    const perZoneCfg = Array.isArray(idealLoads.perZone) ? idealLoads.perZone : [];

    // Index thermostats by zone
    const tstatIndex = new Map();
    (thermostats || []).forEach((t) => {
        if (!t) return;
        const zn = t.zoneName ? sanitize(t.zoneName) : 'GLOBAL';
        tstatIndex.set(zn, {
            heating: t.heatingScheduleName,
            cooling: t.coolingScheduleName,
        });
    });

    // Default setpoint schedules: generate simple ones if referenced but missing
    function ensureSetpointSchedule(name, defaultValue) {
        if (!name) return null;
        const key = sanitize(name);
        if (!compact[key] && defaultValue !== undefined) {
            const lines = ['Through: 12/31', 'For: AllDays', `Until: 24:00, ${defaultValue}`];
            scheduleContext.compact[key] = { typeLimits: 'Temperature', lines };
            emitSchedules(idf, scheduleContext);
        }
        return key;
    }

    znList.forEach((z, idx) => {
        const zn = sanitize(z.name || `Zone_${idx + 1}`);

        // Resolve thermostat schedules (zone-specific or global)
        const zTstat = tstatIndex.get(zn) || tstatIndex.get('GLOBAL') || {};
        const heatSP = zTstat.heating;
        const coolSP = zTstat.cooling;

        const heatSPKey = heatSP ? getSched(heatSP, null) : null;
        const coolSPKey = coolSP ? getSched(coolSP, null) : null;

        if (heatSP && !heatSPKey) ensureSetpointSchedule(heatSP, 21);
        if (coolSP && !coolSPKey) ensureSetpointSchedule(coolSP, 24);

        const finalHeatSP = heatSP ? sanitize(heatSP) : null;
        const finalCoolSP = coolSP ? sanitize(coolSP) : null;

        // Emit ThermostatSetpoint:DualSetpoint if any setpoints defined
        if (finalHeatSP || finalCoolSP) {
            const tName = `TstatSet_${zn}`;
            idf.push(`ThermostatSetpoint:DualSetpoint,`);
            idf.push(`  ${tName},                 !- Name`);
            idf.push(
                `  ${finalHeatSP || ''},     !- Heating Setpoint Temperature Schedule Name`
            );
            idf.push(
                `  ${finalCoolSP || ''};     !- Cooling Setpoint Temperature Schedule Name`
            );
            idf.push('');

            idf.push(`ZoneControl:Thermostat,`);
            idf.push(`  Tstat_${zn},              !- Name`);
            idf.push(`  ${zn},                    !- Zone or ZoneList Name`);
            idf.push(`  ,                         !- Control Type Schedule Name`);
            idf.push(
                `  ThermostatSetpoint:DualSetpoint, !- Control 1 Object Type`
            );
            idf.push(`  ${tName};                 !- Control 1 Name`);
            idf.push('');
        }

        // Resolve IdealLoads configuration
        const zCfg =
            perZoneCfg.find(
                (c) => c.zoneName && sanitize(c.zoneName) === zn
            ) || {};

        const availSchedName = getSched(
            zCfg.availabilitySchedule ||
                globalCfg.availabilitySchedule ||
                'RM_AlwaysOn',
            'RM_AlwaysOn'
        );

        const heatLimitType =
            zCfg.heatingLimitType || globalCfg.heatingLimitType || 'NoLimit';
        const coolLimitType =
            zCfg.coolingLimitType || globalCfg.coolingLimitType || 'NoLimit';

        const maxHeatCap =
            zCfg.maxHeatingCapacity ?? globalCfg.maxHeatingCapacity ?? '';
        const maxCoolCap =
            zCfg.maxCoolingCapacity ?? globalCfg.maxCoolingCapacity ?? '';

        const oaMethod =
            zCfg.outdoorAirMethod || globalCfg.outdoorAirMethod || 'None';
        const oaPerPerson =
            zCfg.outdoorAirFlowPerPerson ??
            globalCfg.outdoorAirFlowPerPerson ??
            '';
        const oaPerArea =
            zCfg.outdoorAirFlowPerArea ??
            globalCfg.outdoorAirFlowPerArea ??
            '';

        idf.push(`ZoneHVAC:IdealLoadsAirSystem,`);
        idf.push(`  IdealLoads_${zn},          !- Name`);
        idf.push(`  ${availSchedName},         !- Availability Schedule Name`);
        idf.push(
            `  ,                          !- Heating Supply Air Temperature Schedule Name`
        );
        idf.push(
            `  ,                          !- Cooling Supply Air Temperature Schedule Name`
        );
        idf.push(`  ${heatLimitType},          !- Heating Limit`);
        idf.push(
            `  ,                          !- Maximum Heating Air Flow Rate {m3/s}`
        );
        idf.push(
            `  ${maxHeatCap || ''},       !- Maximum Sensible Heating Capacity {W}`
        );
        idf.push(`  ${coolLimitType},          !- Cooling Limit`);
        idf.push(
            `  ,                          !- Maximum Cooling Air Flow Rate {m3/s}`
        );
        idf.push(
            `  ${maxCoolCap || ''},       !- Maximum Total Cooling Capacity {W}`
        );
        idf.push(
            `  ,                          !- Heating Availability Schedule Name`
        );
        idf.push(
            `  ,                          !- Cooling Availability Schedule Name`
        );
        idf.push(
            `  ,                          !- Dehumidification Control Type`
        );
        idf.push(
            `  ,                          !- Cooling Sensible Heat Ratio {dimensionless}`
        );
        idf.push(
            `  ,                          !- Dehumidification Setpoint {percent}`
        );
        idf.push(
            `  ,                          !- Humidification Control Type`
        );
        idf.push(
            `  ,                          !- Humidification Setpoint {percent}`
        );
        idf.push(
            `  ,                          !- Outdoor Air Economizer Type`
        );
        idf.push(`  ,                          !- Heat Recovery Type`);
        idf.push(
            `  ,                          !- Sensible Heat Recovery Effectiveness`
        );
        idf.push(
            `  ,                          !- Latent Heat Recovery Effectiveness`
        );

        if (oaMethod !== 'None') {
            idf.push(
                `  ${oaMethod},              !- Outdoor Air Method`
            );
            idf.push(
                `  ${oaPerPerson || ''},     !- Outdoor Air Flow per Person {m3/s-person}`
            );
            idf.push(
                `  ${oaPerArea || ''},       !- Outdoor Air Flow per Zone Floor Area {m3/s-m2}`
            );
            idf.push(
                `  ,                          !- Outdoor Air Flow per Zone {m3/s}`
            );
            idf.push(
                `  ;                          !- Outdoor Air Flow Air Changes per Hour {1/hr}`
            );
        } else {
            idf.push(
                `  None,                     !- Outdoor Air Method`
            );
            idf.push(
                `  ,                          !- Outdoor Air Flow per Person {m3/s-person}`
            );
            idf.push(
                `  ,                          !- Outdoor Air Flow per Zone Floor Area {m3/s-m2}`
            );
            idf.push(
                `  ,                          !- Outdoor Air Flow per Zone {m3/s}`
            );
            idf.push(
                `  ;                          !- Outdoor Air Flow Air Changes per Hour {1/hr}`
            );
        }
        idf.push('');
    });
}

/**
 * MATERIALS
 * Build a combined material library from user-provided materials plus a minimal built-in set.
 */
function buildMaterialLibrary(userMaterials = [], epDefaults) {
    const lib = new Map();

    // 2.1) Start from defaults/energyplusDefaults.json (requested MATERIAL, AIRGAP, WINDOWMATERIAL*)
    if (epDefaults && epDefaults.materials) {
        const m = epDefaults.materials;

        (m['Material'] || []).forEach((mat) => {
            if (!mat || !mat.Name) return;
            const key = sanitize(mat.Name);
            if (!lib.has(key)) {
                lib.set(key, {
                    type: 'Material',
                    name: key,
                    roughness: mat.Roughness,
                    thickness: mat.Thickness_m,
                    conductivity: mat.Conductivity_W_mK,
                    density: mat.Density_kg_m3,
                    specificHeat: mat.SpecificHeat_J_kgK,
                    solarAbsorptance: mat.SolarAbsorptance,
                    thermalAbsorptance: mat.ThermalAbsorptance,
                    visibleAbsorptance: mat.VisibleAbsorptance,
                });
            }
        });

        (m['Material:AirGap'] || []).forEach((mat) => {
            if (!mat || !mat.Name) return;
            const key = sanitize(mat.Name);
            if (!lib.has(key)) {
                lib.set(key, {
                    type: 'Material:AirGap',
                    name: key,
                    thermalResistance: mat.ThermalResistance_m2K_W,
                });
            }
        });

        (m['WindowMaterial:Glazing'] || []).forEach((mat) => {
            if (!mat || !mat.Name) return;
            const key = sanitize(mat.Name);
            if (!lib.has(key)) {
                lib.set(key, {
                    type: 'WindowMaterial:Glazing',
                    name: key,
                    opticalDataType: mat.OpticalDataType,
                    thickness: mat.Thickness_m,
                    solarTransmittance: mat.SolarTransmittance,
                    frontSolarReflectance: mat.FrontSolarReflectance,
                    backSolarReflectance: mat.BackSolarReflectance,
                    visibleTransmittance: mat.VisibleTransmittance,
                    frontVisibleReflectance: mat.FrontVisibleReflectance,
                    backVisibleReflectance: mat.BackVisibleReflectance,
                    infraredTransmittance: mat.InfraredTransmittance,
                    frontEmissivity: mat.FrontIRHemisphericalEmissivity,
                    backEmissivity: mat.BackIRHemisphericalEmissivity,
                    conductivity: mat.Conductivity_W_mK,
                });
            }
        });

        (m['WindowMaterial:Gas'] || []).forEach((mat) => {
            if (!mat || !mat.Name) return;
            const key = sanitize(mat.Name);
            if (!lib.has(key)) {
                lib.set(key, {
                    type: 'WindowMaterial:Gas',
                    name: key,
                    gasType: mat.GasType,
                    thickness: mat.Thickness_m,
                });
            }
        });

        (m['WindowMaterial:Shade'] || []).forEach((mat) => {
            if (!mat || !mat.Name) return;
            const key = sanitize(mat.Name);
            if (!lib.has(key)) {
                lib.set(key, {
                    type: 'WindowMaterial:Shade',
                    name: key,
                    solarTransmittance: mat.SolarTransmittance,
                    solarReflectance: mat.SolarReflectance,
                    visibleTransmittance: mat.VisibleTransmittance,
                    visibleReflectance: mat.VisibleReflectance,
                    irEmissivity: mat.IRHemisphericalEmissivity,
                    irTransmittance: mat.IRTransmittance,
                    thickness: mat.Thickness_m,
                    conductivity: mat.Conductivity_W_mK,
                    shadeToGlassDistance: mat.ShadeToGlassDistance_m,
                });
            }
        });
    }

    // 2.2) User-provided materials extend/override defaults
    [...userMaterials].forEach((m) => {
        if (!m || !m.name) return;
        const key = sanitize(m.name);
        if (!lib.has(key)) {
            lib.set(key, { ...m, name: key });
        }
    });

    return lib;
}

function emitMaterials(idf, lib) {
    for (const m of lib.values()) {
        if (m.type === 'WindowMaterial:SimpleGlazingSystem') {
            idf.push(`WindowMaterial:SimpleGlazingSystem,`);
            idf.push(`  ${m.name},               !- Name`);
            idf.push(`  ${m.uFactor ?? 2.7},    !- U-Factor {W/m2-K}`);
            idf.push(
                `  ${
                    m.solarHeatGainCoeff ?? 0.65
                }, !- Solar Heat Gain Coefficient`
            );
            idf.push(
                `  ${
                    m.visibleTransmittance ?? 0.78
                }; !- Visible Transmittance`
            );
            idf.push('');
        } else if (m.type === 'Material:NoMass') {
            idf.push(`Material:NoMass,`);
            idf.push(`  ${m.name},               !- Name`);
            idf.push(
                `  ${
                    m.roughness || 'Rough'
                }, !- Roughness`
            );
            idf.push(
                `  ${
                    m.thermalResistance ?? 1.0
                }, !- Thermal Resistance {m2-K/W}`
            );
            idf.push(
                `  ${
                    m.solarAbsorptance ?? 0.6
                }, !- Solar Absorptance`
            );
            idf.push(
                `  ${
                    m.thermalAbsorptance ?? 0.9
                }, !- Thermal Absorptance`
            );
            idf.push(
                `  ${
                    m.visibleAbsorptance ?? 0.6
                }; !- Visible Absorptance`
            );
            idf.push('');
        } else {
            idf.push(`Material,`);
            idf.push(`  ${m.name},               !- Name`);
            idf.push(
                `  ${
                    m.roughness || 'MediumRough'
                }, !- Roughness`
            );
            idf.push(
                `  ${
                    m.thickness ?? 0.1
                },  !- Thickness {m}`
            );
            idf.push(
                `  ${
                    m.conductivity ?? 0.5
                }, !- Conductivity {W/m-K}`
            );
            idf.push(
                `  ${
                    m.density ?? 800
                },    !- Density {kg/m3}`
            );
            idf.push(
                `  ${
                    m.specificHeat ?? 1000
                }, !- Specific Heat {J/kg-K}`
            );
            idf.push(
                `  ${
                    m.solarAbsorptance ?? 0.6
                }, !- Solar Absorptance`
            );
            idf.push(
                `  ${
                    m.thermalAbsorptance ?? 0.9
                }, !- Thermal Absorptance`
            );
            idf.push(
                `  ${
                    m.visibleAbsorptance ?? 0.6
                }; !- Visible Absorptance`
            );
            idf.push('');
        }
    }
}

/**
 * CONSTRUCTIONS
 * Build a set of constructions referencing the material library.
 */
function buildConstructionLibrary(userConstructions = [], materialLibrary) {
    const lib = new Map();

    // 3.1) Defaults from energyplusDefaults (requested CONSTRUCTION objects)
    const builtin = [];
    if (energyplusDefaults && typeof energyplusDefaults.getConstructionDefaults === 'function') {
        const defaultsCons = energyplusDefaults.getConstructionDefaults();
        defaultsCons.forEach((c) => {
            if (!c || !c.Name || !Array.isArray(c.Layers)) return;
            builtin.push({
                name: c.Name,
                layers: c.Layers,
            });
        });
    }

    [...builtin, ...userConstructions].forEach((c) => {
        if (!c || !c.name || !Array.isArray(c.layers) || c.layers.length === 0)
            return;
        const key = sanitize(c.name);
        if (!lib.has(key)) {
            const validLayers = c.layers
                .map((ln) => sanitize(ln))
                .filter((ln) => materialLibrary.has(ln));
            if (validLayers.length) {
                lib.set(key, { name: key, layers: validLayers });
            }
        }
    });

    return lib;
}

function emitConstructions(idf, lib) {
    for (const c of lib.values()) {
        idf.push(`Construction,`);
        idf.push(`  ${c.name},                 !- Name`);
        c.layers.forEach((layer, idx) => {
            const suffix = idx === c.layers.length - 1 ? ';' : ',';
            idf.push(
                `  ${layer}${suffix}              !- Layer ${idx + 1}`
            );
        });
        idf.push('');
    }
}

/**
 * SCHEDULES
 * Support built-in schedules and user-defined Schedule:Compact.
 */
function buildSchedules(userSchedules = {}) {
    const builtinCompact = {
        RM_AlwaysOn: {
            typeLimits: 'Fraction',
            lines: ['Through: 12/31', 'For: AllDays', 'Until: 24:00, 1.0'],
        },
        RM_Office_Occ: {
            typeLimits: 'Fraction',
            lines: [
                'Through: 12/31',
                'For: Weekdays',
                'Until: 08:00, 0.0',
                'Until: 09:00, 0.2',
                'Until: 12:00, 0.9',
                'Until: 13:00, 0.7',
                'Until: 18:00, 0.9',
                'Until: 24:00, 0.05',
                'For: Weekends',
                'Until: 24:00, 0.05',
            ],
        },
        RM_Office_Lighting: {
            typeLimits: 'Fraction',
            lines: [
                'Through: 12/31',
                'For: Weekdays',
                'Until: 08:00, 0.0',
                'Until: 18:00, 1.0',
                'Until: 24:00, 0.1',
                'For: Weekends',
                'Until: 24:00, 0.1',
            ],
        },
        RM_Office_Equipment: {
            typeLimits: 'Fraction',
            lines: [
                'Through: 12/31',
                'For: Weekdays',
                'Until: 08:00, 0.2',
                'Until: 18:00, 1.0',
                'Until: 24:00, 0.5',
                'For: Weekends',
                'Until: 24:00, 0.3',
            ],
        },
    };

    const schedules = {
        compact: { ...builtinCompact },
    };

    if (userSchedules && typeof userSchedules === 'object') {
        if (Array.isArray(userSchedules.compact)) {
            userSchedules.compact.forEach((s) => {
                if (!s || !s.name || !Array.isArray(s.lines) || !s.lines.length)
                    return;
                const key = sanitize(s.name);
                schedules.compact[key] = {
                    typeLimits: s.typeLimits || 'Fraction',
                    lines: s.lines.slice(),
                };
            });
        } else if (typeof userSchedules.compact === 'object') {
            Object.keys(userSchedules.compact).forEach((name) => {
                const s = userSchedules.compact[name];
                if (!s || !Array.isArray(s.lines) || !s.lines.length) return;
                const key = sanitize(name);
                schedules.compact[key] = {
                    typeLimits: s.typeLimits || 'Fraction',
                    lines: s.lines.slice(),
                };
            });
        }
    }

    return schedules;
}

function emitSchedules(idf, scheduleContext) {
    idf.push(`ScheduleTypeLimits,`);
    idf.push(`  Fraction,                 !- Name`);
    idf.push(`  0.0,                      !- Lower Limit Value`);
    idf.push(`  1.0,                      !- Upper Limit Value`);
    idf.push(`  CONTINUOUS;               !- Numeric Type`);
    idf.push('');

    const compact = scheduleContext.compact || {};
    Object.keys(compact).forEach((name) => {
        const s = compact[name];
        idf.push(`Schedule:Compact,`);
        idf.push(`  ${name},                  !- Name`);
        idf.push(
            `  ${
                s.typeLimits || 'Fraction'
            }, !- Schedule Type Limits Name`
        );
        s.lines.forEach((line, idx) => {
            const suffix = idx === s.lines.length - 1 ? ';' : ',';
            idf.push(`  ${line}${suffix}`);
        });
        idf.push('');
    });
}

/**
 * LOADS
 * Emit zone-level internal gains based on zoneLoads.
 */
function emitZoneLoads(idf, zones, loads = [], scheduleContext) {
    const znIndex = new Map();
    const znList = zones.length ? zones : [{ name: 'Zone_1' }];
    znList.forEach((z) => {
        znIndex.set(sanitize(z.name), sanitize(z.name));
    });

    const compact = scheduleContext.compact || {};
    const ensureSchedule = (name, fallback) => {
        const key = sanitize(name);
        if (compact[key]) return key;
        return fallback;
    };

    const AlwaysOn = ensureSchedule('RM_AlwaysOn', 'RM_AlwaysOn');

    (loads || []).forEach((l, i) => {
        if (!l || !l.zoneName) return;
        const zn = sanitize(l.zoneName);
        if (!znIndex.has(zn)) return;

        // People
        if (l.people && l.people.peoplePerArea) {
            const sch = ensureSchedule(
                l.people.schedule || 'RM_Office_Occ',
                AlwaysOn
            );
            idf.push(`People,`);
            idf.push(
                `  People_${zn}_${i},       !- Name`
            );
            idf.push(
                `  ${zn},                   !- Zone or ZoneList Name`
            );
            idf.push(
                `  ${sch},                  !- Number of People Schedule Name`
            );
            idf.push(
                `  People/Area,             !- Number of People Calculation Method`
            );
            idf.push(
                `  ,                        !- Number of People`
            );
            idf.push(
                `  ${
                    l.people.peoplePerArea
                }, !- People per Zone Floor Area {person/m2}`
            );
            idf.push(
                `  ,                        !- People per Person`
            );
            idf.push(
                `  0.3,                     !- Fraction Radiant`
            );
            idf.push(
                `  0.5,                     !- Sensible Heat Fraction`
            );
            idf.push(
                `  ${
                    l.people.activityLevel || 120
                }; !- Activity Level {W/person}`
            );
            idf.push('');
        }

        // Lights
        if (l.lighting && l.lighting.wattsPerArea) {
            const sch = ensureSchedule(
                l.lighting.schedule || 'RM_Office_Lighting',
                AlwaysOn
            );
            idf.push(`Lights,`);
            idf.push(
                `  Lights_${zn}_${i},       !- Name`
            );
            idf.push(
                `  ${zn},                   !- Zone or ZoneList Name`
            );
            idf.push(
                `  ${sch},                  !- Schedule Name`
            );
            idf.push(
                `  Watts/Area,              !- Design Level Calculation Method`
            );
            idf.push(
                `  ,                        !- Lighting Level {W}`
            );
            idf.push(
                `  ${
                    l.lighting.wattsPerArea
                }, !- Watts per Zone Floor Area {W/m2}`
            );
            idf.push(
                `  ,                        !- Watts per Person {W/person}`
            );
            idf.push(
                `  0.0,                     !- Return Air Fraction`
            );
            idf.push(
                `  0.6,                     !- Fraction Radiant`
            );
            idf.push(
                `  0.2,                     !- Fraction Visible`
            );
            idf.push(
                `  0.0,                     !- Fraction Replaceable`
            );
            idf.push(
                `  General;                 !- End-Use Subcategory`
            );
            idf.push('');
        }

        // Equipment
        if (l.equipment && l.equipment.wattsPerArea) {
            const sch = ensureSchedule(
                l.equipment.schedule || 'RM_Office_Equipment',
                AlwaysOn
            );
            idf.push(`ElectricEquipment,`);
            idf.push(
                `  Equip_${zn}_${i},        !- Name`
            );
            idf.push(
                `  ${zn},                   !- Zone or ZoneList Name`
            );
            idf.push(
                `  ${sch},                  !- Schedule Name`
            );
            idf.push(
                `  Watts/Area,              !- Design Level Calculation Method`
            );
            idf.push(
                `  ,                        !- Design Level {W}`
            );
            idf.push(
                `  ${
                    l.equipment.wattsPerArea
                }, !- Watts per Zone Floor Area {W/m2}`
            );
            idf.push(
                `  ,                        !- Watts per Person {W/person}`
            );
            idf.push(
                `  0.0,                     !- Fraction Latent`
            );
            idf.push(
                `  0.3,                     !- Fraction Radiant`
            );
            idf.push(
                `  0.7;                     !- Fraction Lost`
            );
            idf.push('');
        }

        // Infiltration
        if (
            l.infiltration &&
            (l.infiltration.ach || l.infiltration.flowPerArea)
        ) {
            const sch = ensureSchedule(
                l.infiltration.schedule || AlwaysOn,
                AlwaysOn
            );
            idf.push(
                `ZoneInfiltration:DesignFlowRate,`
            );
            idf.push(
                `  Infil_${zn}_${i},        !- Name`
            );
            idf.push(
                `  ${zn},                   !- Zone or ZoneList Name`
            );
            idf.push(
                `  ${sch},                  !- Schedule Name`
            );
            if (l.infiltration.ach) {
                idf.push(
                    `  ,                        !- Design Flow Rate {m3/s}`
                );
                idf.push(
                    `  ,                        !- Flow per Zone Floor Area {m3/s-m2}`
                );
                idf.push(
                    `  ,                        !- Flow per Exterior Surface Area {m3/s-m2}`
                );
                idf.push(
                    `  ${
                        l.infiltration.ach
                    };   !- Air Changes per Hour {1/hr}`
                );
            } else {
                idf.push(
                    `  ,                        !- Design Flow Rate {m3/s}`
                );
                idf.push(
                    `  ${
                        l.infiltration.flowPerArea
                    }, !- Flow per Zone Floor Area {m3/s-m2}`
                );
                idf.push(
                    `  ,                        !- Flow per Exterior Surface Area {m3/s-m2}`
                );
                idf.push(
                    `  ;                        !- Air Changes per Hour {1/hr}`
                );
            }
            idf.push('');
        }
    });
}

/**
 * DAYLIGHTING & OUTPUTS
 * Emit Daylighting:Controls, Output:IlluminanceMap, Output:Variable from daylighting config.
 */
function emitDaylighting(idf, zones, daylighting = {}) {
    if (!daylighting) return;

    const znIndex = new Map();
    const znList = zones && zones.length ? zones : [{ name: 'Zone_1' }];
    znList.forEach((z, idx) => {
        const name = sanitize(z.name || `Zone_${idx + 1}`);
        znIndex.set(name, name);
    });

    // Daylighting:Controls
    const controls = Array.isArray(daylighting.controls)
        ? daylighting.controls
        : [];
    controls.forEach((c, idx) => {
        if (!c || !c.zoneName) return;
        if (c.enabled === false) return;

        const zn = sanitize(c.zoneName);
        if (!znIndex.has(zn)) return;

        const refPoints = Array.isArray(c.refPoints)
            ? c.refPoints.slice(0, 2)
            : [];
        if (!refPoints.length || !Number.isFinite(c.setpoint)) return;

        const ctrlType =
            c.type === 'Stepped'
                ? 'Stepped'
                : c.type === 'ContinuousOff'
                ? 'ContinuousOff'
                : 'Continuous';

        const frac =
            typeof c.fraction === 'number' && c.fraction > 0
                ? c.fraction
                : 1.0;

        const rp1 = refPoints[0];
        const rp2 = refPoints[1];

        idf.push(`Daylighting:Controls,`);
        idf.push(
            `  DL_${zn}_${idx + 1},       !- Name`
        );
        idf.push(
            `  ${zn},                    !- Zone Name`
        );
        idf.push(
            `  ${ctrlType},              !- Daylighting System Control Type`
        );
        idf.push(
            `  ,                         !- Availability Schedule Name`
        );
        idf.push(
            `  ${frac},                  !- Lighting Control Throttling Range`
        );
        idf.push(
            `  ${frac},                  !- Lighting Control Type Fraction`
        );
        idf.push(
            `  0.2,                      !- Minimum Input Power Fraction for Continuous Dimming Control`
        );
        idf.push(
            `  0.2,                      !- Minimum Light Output Fraction for Continuous Dimming Control`
        );
        idf.push(
            `  1,                        !- Number of Daylighting Reference Points`
        );

        // Reference point 1
        idf.push(
            `  ${rp1.x},                 !- X-Coordinate of First Reference Point {m}`
        );
        idf.push(
            `  ${rp1.y},                 !- Y-Coordinate of First Reference Point {m}`
        );
        idf.push(
            `  ${rp1.z},                 !- Z-Coordinate of First Reference Point {m}`
        );
        idf.push(
            `  ${c.setpoint},            !- Illuminance Setpoint at First Reference Point {lux}`
        );

        if (rp2) {
            idf.push(
                `  2,                      !- Number of Daylighting Reference Points`
            );
            idf.push(
                `  ${rp2.x},               !- X-Coordinate of Second Reference Point {m}`
            );
            idf.push(
                `  ${rp2.y},               !- Y-Coordinate of Second Reference Point {m}`
            );
            idf.push(
                `  ${rp2.z},               !- Z-Coordinate of Second Reference Point {m}`
            );
            idf.push(
                `  ${c.setpoint};          !- Illuminance Setpoint at Second Reference Point {lux}`
            );
        } else {
            idf.push(
                `  ;                       !- (no second reference point)`
            );
        }

        idf.push('');
    });

    // Output:IlluminanceMap
    const outputs = daylighting.outputs || {};
    const maps = Array.isArray(outputs.illuminanceMaps)
        ? outputs.illuminanceMaps
        : [];
    maps.forEach((m, idx) => {
        if (
            !m ||
            !m.name ||
            !m.zoneName ||
            !Number.isFinite(m.xOrigin) ||
            !Number.isFinite(m.yOrigin) ||
            !Number.isFinite(m.zHeight) ||
            !Number.isFinite(m.xNumPoints) ||
            !Number.isFinite(m.xSpacing) ||
            !Number.isFinite(m.yNumPoints) ||
            !Number.isFinite(m.ySpacing)
        ) {
            return;
        }

        const zn = sanitize(m.zoneName);
        if (!znIndex.has(zn)) return;

        idf.push(`Output:IlluminanceMap,`);
        idf.push(
            `  ${sanitize(m.name)},       !- Name`
        );
        idf.push(
            `  ${zn},                    !- Zone Name`
        );
        idf.push(
            `  ${m.xOrigin},             !- X-Origin {m}`
        );
        idf.push(
            `  ${m.yOrigin},             !- Y-Origin {m}`
        );
        idf.push(
            `  ${m.zHeight},             !- Z-Height {m}`
        );
        idf.push(
            `  ${m.xNumPoints},          !- Number of X-Direction Grid Points`
        );
        idf.push(
            `  ${m.xSpacing},            !- X-Direction Grid Spacing {m}`
        );
        idf.push(
            `  ${m.yNumPoints},          !- Number of Y-Direction Grid Points`
        );
        idf.push(
            `  ${m.ySpacing};            !- Y-Direction Grid Spacing {m}`
        );
        idf.push('');
    });

    // Output:Variable
    const vars = Array.isArray(outputs.variables)
        ? outputs.variables
        : [];
    vars.forEach((v) => {
        if (!v || !v.key || !v.variableName) return;
        const freq = v.reportingFrequency || 'Hourly';
        idf.push(`Output:Variable,`);
        idf.push(
            `  ${v.key},                 !- Key Value`
        );
        idf.push(
            `  ${v.variableName},        !- Variable Name`
        );
        idf.push(
            `  ${freq};                  !- Reporting Frequency`
        );
        idf.push('');
    });
}

/**
 * Try to infer a reasonable location from project metadata.
 */
function inferLocationFromProject() {
    try {
        const meta = project?.metadata || project?.getMetadata?.();
        if (!meta) return null;
        if (meta.location) {
            return {
                name: meta.location.name || 'Site',
                latitude: meta.location.latitude,
                longitude: meta.location.longitude,
                timeZone: meta.location.timeZone,
                elevation: meta.location.elevation,
            };
        }
    } catch (e) {
        console.warn(
            'EnergyPlusModelBuilder: unable to infer location from project.',
            e
        );
    }
    return null;
}

function inferBuildingNameFromProject() {
    try {
        const meta = project?.metadata || project?.getMetadata?.();
        return meta?.name || meta?.projectName || null;
    } catch {
        return null;
    }
}

/**
 * Try to infer zones from project.
 * For now, conservative: look for project.zones or project.getZones().
 */
function inferZonesFromProject() {
    try {
        if (Array.isArray(project?.zones)) {
            return project.zones.map((z, i) => ({
                name: z.name || `Zone_${i + 1}`,
                x: z.xOrigin || 0,
                y: z.yOrigin || 0,
                z: z.zOrigin || 0,
                multiplier: z.multiplier || 1,
            }));
        }
        if (typeof project?.getZones === 'function') {
            const zones = project.getZones();
            if (Array.isArray(zones)) {
                return zones.map((z, i) => ({
                    name: z.name || `Zone_${i + 1}`,
                    x: z.xOrigin || 0,
                    y: z.yOrigin || 0,
                    z: z.zOrigin || 0,
                    multiplier: z.multiplier || 1,
                }));
            }
        }
    } catch (e) {
        console.warn(
            'EnergyPlusModelBuilder: unable to infer zones from project.',
            e
        );
    }
    return [];
}

function sanitize(name) {
    if (!name) return 'Unnamed';
    return String(name).replace(/[;,]/g, '_').trim();
}
