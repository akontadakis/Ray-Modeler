// scripts/energyplusConfigService.js
//
// Centralized helpers for reading/updating EnergyPlus configuration from project metadata.
// Goals:
// - Single source of truth for how energyPlusConfig is stored and normalized.
// - Backwards compatible with legacy meta.energyplus and legacy fields.
// - No direct metadata mucking in panels or energyplus.js; everything goes through this API.
//
// This module is intentionally dependency-light (only imports project when used by callers).

/**
 * Read raw metadata from project.
 * Handles project.getMetadata() and falls back to project.metadata || {}.
 */
export function getMeta(project) {
    if (!project) return {};
    try {
        if (typeof project.getMetadata === 'function') {
            const m = project.getMetadata() || {};
            return typeof m === 'object' && m !== null ? m : {};
        }
        const m = project.metadata || {};
        return typeof m === 'object' && m !== null ? m : {};
    } catch (err) {
        console.warn('[EnergyPlusConfigService] Failed to read project metadata', err);
        return {};
    }
}

/**
 * Persist metadata back to project.
 * Prefers project.updateMetadata; falls back to assigning project.metadata.
 */
export function setMeta(project, nextMeta) {
    if (!project) {
        console.warn('[EnergyPlusConfigService] setMeta called without project');
        return;
    }
    const safe = nextMeta && typeof nextMeta === 'object' ? nextMeta : {};
    if (typeof project.updateMetadata === 'function') {
        project.updateMetadata(safe);
    } else {
        project.metadata = safe;
    }
}

/**
 * Resolve the raw EnergyPlus config block from metadata.
 * Backwards compatible:
 *  - Prefer meta.energyPlusConfig (canonical)
 *  - Fallback to meta.energyplus (legacy)
 */
export function getRawEnergyPlusConfig(meta) {
    if (!meta || typeof meta !== 'object') return {};
    const epNew = meta.energyPlusConfig;
    const epLegacy = meta.energyplus;

    if (epNew && typeof epNew === 'object') {
        if (epLegacy && typeof epLegacy === 'object' && !meta.__epConfigMigrationWarned) {
            // Soft warning in dev builds to encourage migration.
            console.warn(
                '[EnergyPlusConfigService] Both energyPlusConfig and energyplus found in metadata. ' +
                'Using energyPlusConfig as canonical. Consider migrating away from meta.energyplus.'
            );
            // do not mutate meta here; avoid side effects in a pure getter
        }
        return epNew;
    }

    if (epLegacy && typeof epLegacy === 'object') {
        // Legacy-only config; still supported. Callers will normalize.
        return epLegacy;
    }

    return {};
}

/**
 * Normalize schedules.compact into a predictable internal structure.
 * Supports:
 *  - Array of {name, typeLimits, lines}
 *  - Object map { [name]: { typeLimits, lines } }
 */
export function normalizeSchedules(ep) {
    const result = {
        compact: [],
    };

    if (!ep || typeof ep !== 'object') return result;

    const raw = ep.schedules && ep.schedules.compact;
    if (!raw) return result;

    const pushIfValid = (name, value) => {
        if (!name || !value) return;
        const nm = String(name);
        const lines = Array.isArray(value.lines) ? value.lines.slice() : [];
        if (!lines.length) return;
        result.compact.push({
            name: nm,
            typeLimits: value.typeLimits || 'Fraction',
            lines,
        });
    };

    if (Array.isArray(raw)) {
        raw.forEach((s) => {
            if (!s || !s.name || !Array.isArray(s.lines)) return;
            result.compact.push({
                name: String(s.name),
                typeLimits: s.typeLimits || 'Fraction',
                lines: s.lines.slice(),
            });
        });
        return result;
    }

    if (raw && typeof raw === 'object') {
        Object.keys(raw).forEach((nm) => {
            const v = raw[nm];
            if (!v || !Array.isArray(v.lines)) return;
            pushIfValid(nm, v);
        });
    }

    return result;
}

/**
 * Normalize weather configuration.
 * Canonical structure:
 *  weather: {
 *    epwPath?: string,
 *    locationSource?: 'FromEPW' | 'Custom',
 *    customLocation?: {
 *      name: string,
 *      latitude: number,
 *      longitude: number,
 *      timeZone: number,
 *      elevation: number
 *    }
 *  }
 *
 * Backwards compatible with:
 *  - ep.weatherFilePath
 */
export function normalizeWeather(ep) {
    const base = (ep && ep.weather) || {};
    const weatherFilePath = ep && typeof ep.weatherFilePath === 'string'
        ? ep.weatherFilePath
        : undefined;

    const epwPath = typeof base.epwPath === 'string'
        ? base.epwPath
        : weatherFilePath;

    const locationSource = base.locationSource === 'Custom' ? 'Custom' : 'FromEPW';
    const cl = base.customLocation || {};

    const normalized = {
        epwPath: epwPath || undefined,
        locationSource,
        customLocation: undefined,
    };

    if (locationSource === 'Custom') {
        const name = typeof cl.name === 'string' && cl.name.trim() ? cl.name.trim() : null;
        const lat = Number(cl.latitude);
        const lon = Number(cl.longitude);
        const tz = Number(cl.timeZone);
        const elev = Number(cl.elevation);

        if (
            name &&
            Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
            Number.isFinite(lon) && lon >= -180 && lon <= 180 &&
            Number.isFinite(tz) && tz >= -12 && tz <= 14 &&
            Number.isFinite(elev)
        ) {
            normalized.customLocation = {
                name,
                latitude: lat,
                longitude: lon,
                timeZone: tz,
                elevation: elev,
            };
        } else {
            // Invalid custom location → fall back to FromEPW semantics.
            normalized.locationSource = 'FromEPW';
        }
    }

    return normalized;
}

/**
 * Normalize the simulationControl block.
 * Mirrors logic currently in energyplus.js and Simulation Control Manager.
 * Uses meta for building name fallback.
 */
export function normalizeSimulationControl(ep, meta = {}) {
    const sc = (ep && ep.simulationControl) || {};

    const building = sc.building || {};
    const simFlags = sc.simulationControlFlags || {};
    const ggr = sc.globalGeometryRules || {};
    const shad = sc.shadowCalculation || {};
    const conv = sc.surfaceConvection || {};
    const hb = sc.heatBalanceAlgorithm || {};
    const sp = sc.sizingPeriodWeatherFileDays || {};
    const rp = sc.runPeriod || {};
    const dst = sc.daylightSavingTime || {};

    const normalized = {
        building: {
            name:
                (typeof building.name === 'string' && building.name.trim()) ||
                meta.name ||
                meta.projectName ||
                'OfficeBuilding',
            northAxis: isNum(building.northAxis)
                ? building.northAxis
                : isNum(ep && ep.northAxis)
                ? ep.northAxis
                : 0.0,
            terrain: building.terrain || ep.terrain || 'City',
            loadsTolerance: isNum(building.loadsTolerance)
                ? building.loadsTolerance
                : 0.04,
            tempTolerance: isNum(building.tempTolerance)
                ? building.tempTolerance
                : 0.4,
            solarDistribution:
                building.solarDistribution ||
                'FullInteriorAndExteriorWithReflections',
            maxWarmupDays: isNum(building.maxWarmupDays)
                ? building.maxWarmupDays
                : 25,
            minWarmupDays: isNum(building.minWarmupDays)
                ? building.minWarmupDays
                : 6,
        },
        timestep: {
            timestepsPerHour: isNum(sc.timestep && sc.timestep.timestepsPerHour)
                ? sc.timestep.timestepsPerHour
                : isNum(ep && ep.timestep)
                ? ep.timestep
                : 4,
        },
        simulationControlFlags: {
            doZoneSizing: typeof simFlags.doZoneSizing === 'boolean'
                ? simFlags.doZoneSizing
                : false,
            doSystemSizing: typeof simFlags.doSystemSizing === 'boolean'
                ? simFlags.doSystemSizing
                : false,
            doPlantSizing: typeof simFlags.doPlantSizing === 'boolean'
                ? simFlags.doPlantSizing
                : false,
            runSizingPeriods: typeof simFlags.runSizingPeriods === 'boolean'
                ? simFlags.runSizingPeriods
                : false,
            runWeatherRunPeriods: typeof simFlags.runWeatherRunPeriods === 'boolean'
                ? simFlags.runWeatherRunPeriods
                : true,
        },
        globalGeometryRules: {
            startingVertexPosition:
                ggr.startingVertexPosition || 'UpperLeftCorner',
            vertexEntryDirection:
                ggr.vertexEntryDirection || 'Counterclockwise',
            coordinateSystem: ggr.coordinateSystem || 'Relative',
        },
        shadowCalculation: {
            calculationFrequency: isNum(shad.calculationFrequency)
                ? shad.calculationFrequency
                : 10,
            maxFigures: isNum(shad.maxFigures)
                ? shad.maxFigures
                : 15000,
            algorithm: shad.algorithm || 'ConvexWeilerAtherton',
            skyDiffuseModel: shad.skyDiffuseModel || 'SimpleSkyDiffuseModeling',
        },
        surfaceConvection: {
            insideAlgorithm:
                conv.insideAlgorithm || 'TARP',
            outsideAlgorithm:
                conv.outsideAlgorithm || 'DOE-2',
        },
        heatBalanceAlgorithm: {
            algorithm: hb.algorithm || 'ConductionTransferFunction',
            surfaceTempUpperLimit: isNum(hb.surfaceTempUpperLimit)
                ? hb.surfaceTempUpperLimit
                : 200,
            hConvMin: isNum(hb.hConvMin)
                ? hb.hConvMin
                : 0.1,
            hConvMax: isNum(hb.hConvMax)
                ? hb.hConvMax
                : 1000,
        },
        sizingPeriodWeatherFileDays: {
            name: sp.name || 'Sizing',
            beginMonth: isNum(sp.beginMonth) ? sp.beginMonth : 1,
            beginDayOfMonth: isNum(sp.beginDayOfMonth) ? sp.beginDayOfMonth : 1,
            endMonth: isNum(sp.endMonth) ? sp.endMonth : 12,
            endDayOfMonth: isNum(sp.endDayOfMonth) ? sp.endDayOfMonth : 31,
            useWeatherFileDaylightSaving:
                sp.useWeatherFileDaylightSaving !== false,
            useWeatherFileRainSnowIndicators:
                sp.useWeatherFileRainSnowIndicators !== false,
        },
        runPeriod: {
            name: rp.name || 'Annual_Simulation',
            beginMonth: isNum(rp.beginMonth) ? rp.beginMonth : 1,
            beginDayOfMonth: isNum(rp.beginDayOfMonth) ? rp.beginDayOfMonth : 1,
            endMonth: isNum(rp.endMonth) ? rp.endMonth : 12,
            endDayOfMonth: isNum(rp.endDayOfMonth) ? rp.endDayOfMonth : 31,
            dayOfWeekForStart: rp.dayOfWeekForStart || 'UseWeatherFile',
            useWeatherFileHolidays: !!rp.useWeatherFileHolidays,
            useWeatherFileDaylightSaving: !!rp.useWeatherFileDaylightSaving,
            applyWeekendHolidayRule:
                typeof rp.applyWeekendHolidayRule === 'boolean'
                    ? rp.applyWeekendHolidayRule
                    : true,
            useWeatherFileRain:
                typeof rp.useWeatherFileRain === 'boolean'
                    ? rp.useWeatherFileRain
                    : true,
            useWeatherFileSnow:
                typeof rp.useWeatherFileSnow === 'boolean'
                    ? rp.useWeatherFileSnow
                    : true,
            numTimesRunperiodToBeRepeated: isNum(rp.numTimesRunperiodToBeRepeated)
                ? rp.numTimesRunperiodToBeRepeated
                : 1,
        },
        daylightSavingTime: {
            startDate: dst.startDate || '4/1',
            endDate: dst.endDate || '9/30',
        },
    };

    return normalized;
}

/**
 * Return a fully normalized, read-only-ish EnergyPlus config view.
 * Shape:
 *  {
 *    meta,          // original meta
 *    ep,            // raw ep config (energyPlusConfig or energyplus)
 *    config: {
 *      materials: [],
 *      constructions: [],
 *      defaults: {},
 *      schedules: { compact: [...] },
 *      zoneLoads: [],
 *      thermostats: [],
 *      idealLoads: {},
 *      daylighting: {},
 *      weather: { ... },
 *      simulationControl: { ... }
 *    }
 *  }
 */
export function getConfig(project) {
    const meta = getMeta(project);
    const ep = getRawEnergyPlusConfig(meta) || {};

    const config = {
        // Allow raw values; panels / builder may apply domain-specific logic.
        materials: Array.isArray(ep.materials) ? ep.materials.slice() : [],
        constructions: Array.isArray(ep.constructions) ? ep.constructions.slice() : [],
        defaults: ep.defaults && typeof ep.defaults === 'object' ? { ...ep.defaults } : {},
        schedules: normalizeSchedules(ep),
        zoneLoads: Array.isArray(ep.zoneLoads) ? ep.zoneLoads.slice() : [],
        thermostats: Array.isArray(ep.thermostats) ? ep.thermostats.slice() : [],
        idealLoads: ep.idealLoads && typeof ep.idealLoads === 'object'
            ? { ...ep.idealLoads }
            : {},
        daylighting: ep.daylighting && typeof ep.daylighting === 'object'
            ? { ...ep.daylighting }
            : {},
        weather: normalizeWeather(ep),
        simulationControl: normalizeSimulationControl(ep, meta),
        // Phase 1+: expose raw advanced blocks (panels will work directly on these)
        sizing: ep.sizing && typeof ep.sizing === 'object' ? { ...ep.sizing } : {},
        outdoorAir: ep.outdoorAir && typeof ep.outdoorAir === 'object' ? { ...ep.outdoorAir } : {},
        naturalVentilation: ep.naturalVentilation && typeof ep.naturalVentilation === 'object'
            ? { ...ep.naturalVentilation }
            : {},
        shading: ep.shading && typeof ep.shading === 'object'
            ? { ...ep.shading }
            : {},
    };

    return { meta, ep, config };
}

/**
 * Update helper:
 * - Reads meta/ep.
 * - Calls updater(ep) to produce nextEp.
 * - Writes nextEp to meta.energyPlusConfig (canonical) via setMeta.
 * - Leaves meta.energyplus untouched for now (non-breaking).
 */
export function updateConfig(project, updater) {
    if (typeof updater !== 'function') {
        console.warn('[EnergyPlusConfigService] updateConfig called without updater function');
        return;
    }

    const meta = getMeta(project);
    const currentRaw = getRawEnergyPlusConfig(meta) || {};
    const nextEp = safeClone(updater(currentRaw) || currentRaw);

    const nextMeta = {
        ...meta,
        energyPlusConfig: nextEp,
    };

    setMeta(project, nextMeta);
}

/**
 * Convenience: shallow-merge partial into ep via updateConfig.
 */
export function setConfig(project, partial) {
    if (!partial || typeof partial !== 'object') return;
    updateConfig(project, (ep) => ({
        ...ep,
        ...partial,
    }));
}

/**
 * Focused helpers for common writers.
 * These are thin wrappers around updateConfig for clarity at call sites.
 */

export function setMaterials(project, materials) {
    const safe = Array.isArray(materials) ? materials.slice() : [];
    updateConfig(project, (ep) => ({ ...ep, materials: safe }));
}

export function setConstructions(project, constructions, defaults) {
    const safeCons = Array.isArray(constructions) ? constructions.slice() : [];
    const next = { ...epCloneOrEmpty(null), constructions: safeCons };
    if (defaults && typeof defaults === 'object') {
        next.defaults = { ...(next.defaults || {}), ...defaults };
    }
    updateConfig(project, (ep) => ({
        ...ep,
        constructions: safeCons,
        defaults: next.defaults || ep.defaults,
    }));
}

export function setSchedulesCompact(project, compactArray) {
    const safe = Array.isArray(compactArray) ? compactArray : [];
    // Store as object map for stability; builder/normalizer will accept both.
    const compact = {};
    safe.forEach((s) => {
        if (!s || !s.name || !Array.isArray(s.lines)) return;
        compact[s.name] = {
            typeLimits: s.typeLimits || 'Fraction',
            lines: s.lines.slice(),
        };
    });
    updateConfig(project, (ep) => ({
        ...ep,
        schedules: {
            ...(ep.schedules || {}),
            compact,
        },
    }));
}

export function setZoneLoads(project, zoneLoads) {
    const safe = Array.isArray(zoneLoads) ? zoneLoads.slice() : [];
    updateConfig(project, (ep) => ({
        ...ep,
        zoneLoads: safe,
    }));
}

export function setThermostatsAndIdealLoads(project, { thermostats, idealLoads }) {
    const next = {};
    if (Array.isArray(thermostats)) next.thermostats = thermostats.slice();
    if (idealLoads && typeof idealLoads === 'object') {
        next.idealLoads = { ...idealLoads };
    }
    updateConfig(project, (ep) => ({
        ...ep,
        ...next,
    }));
}

/**
 * Explicit helper for thermostat setpoint definitions.
 * Stores an array of canonical setpoints:
 *  [
 *    {
 *      name: string,
 *      type: 'SingleHeating' | 'SingleCooling' | 'SingleHeatingOrCooling' | 'DualSetpoint',
 *      heatingScheduleName?: string,
 *      coolingScheduleName?: string,
 *      singleScheduleName?: string
 *    },
 *    ...
 *  ]
 *
 * Kept separate from zone/global thermostat mappings for clarity.
 */
export function setThermostatSetpoints(project, setpoints) {
    const safe = Array.isArray(setpoints)
        ? setpoints
              .filter((sp) => sp && typeof sp.name === 'string' && sp.name.trim())
              .map((sp) => ({ ...sp, name: sp.name.trim() }))
        : [];
    updateConfig(project, (ep) => ({
        ...ep,
        thermostatSetpoints: safe,
    }));
}

export function setDaylighting(project, daylighting) {
    const safe = daylighting && typeof daylighting === 'object' ? { ...daylighting } : {};
    updateConfig(project, (ep) => ({
        ...ep,
        daylighting: safe,
    }));
}

/**
 * Phase 1: HVAC Sizing (zones)
 * Overwrite ep.sizing.zones with provided array.
 */
export function setSizingZones(project, zones) {
    const safeZones = Array.isArray(zones) ? zones.map((z) => ({ ...z })) : [];
    updateConfig(project, (ep) => ({
        ...ep,
        sizing: {
            ...(ep.sizing && typeof ep.sizing === 'object' ? ep.sizing : {}),
            zones: safeZones,
        },
    }));
}

/**
 * Phase 5: System Sizing (Sizing:System)
 * Overwrite ep.sizing.systems with provided array (advanced).
 */
export function setSizingSystems(project, systems) {
    const safeSystems = Array.isArray(systems)
        ? systems
              .filter((s) => s && s.airLoopName)
              .map((s) => ({ ...s }))
        : [];
    updateConfig(project, (ep) => ({
        ...ep,
        sizing: {
            ...(ep.sizing && typeof ep.sizing === 'object' ? ep.sizing : {}),
            systems: safeSystems,
        },
    }));
}

/**
 * Phase 5: Plant Sizing (Sizing:Plant)
 * Overwrite ep.sizing.plants with provided array (advanced).
 */
export function setSizingPlants(project, plants) {
    const safePlants = Array.isArray(plants)
        ? plants
              .filter((p) => p && p.plantLoopName)
              .map((p) => ({ ...p }))
        : [];
    updateConfig(project, (ep) => ({
        ...ep,
        sizing: {
            ...(ep.sizing && typeof ep.sizing === 'object' ? ep.sizing : {}),
            plants: safePlants,
        },
    }));
}

/**
 * Phase 1: Outdoor Air Design Specifications
 * Overwrite ep.outdoorAir.designSpecs with provided array.
 */
export function setOutdoorAirDesignSpecs(project, designSpecs) {
    const safe = Array.isArray(designSpecs)
        ? designSpecs
              .filter((d) => d && d.name)
              .map((d) => ({ ...d }))
        : [];
    updateConfig(project, (ep) => ({
        ...ep,
        outdoorAir: {
            ...(ep.outdoorAir && typeof ep.outdoorAir === 'object' ? ep.outdoorAir : {}),
            designSpecs: safe,
        },
    }));
}

/**
 * Phase 2: Natural Ventilation (simple ZoneVentilation:DesignFlowRate)
 * Replace ep.naturalVentilation with provided object (global + perZone).
 */
export function setNaturalVentilation(project, naturalVentilation) {
    const nv = naturalVentilation && typeof naturalVentilation === 'object'
        ? { ...naturalVentilation }
        : {};
    if (Array.isArray(nv.perZone)) {
        nv.perZone = nv.perZone
            .filter((z) => z && z.zoneName)
            .map((z) => ({ ...z }));
    }
    updateConfig(project, (ep) => ({
        ...ep,
        naturalVentilation: nv,
    }));
}

/**
 * Phase 4: Shading & Solar Control
 * Replace ep.shading with provided object (site/zone surfaces, reflectance, window shading controls).
 */
export function setShading(project, shading) {
    const sh = shading && typeof shading === 'object'
        ? { ...shading }
        : {};

    if (Array.isArray(sh.siteSurfaces)) {
        sh.siteSurfaces = sh.siteSurfaces
            .filter((s) => s && s.name)
            .map((s) => ({ ...s }));
    }

    if (Array.isArray(sh.zoneSurfaces)) {
        sh.zoneSurfaces = sh.zoneSurfaces
            .filter((s) => s && s.name)
            .map((s) => ({ ...s }));
    }

    if (Array.isArray(sh.reflectance)) {
        sh.reflectance = sh.reflectance
            .filter((r) => r && r.shadingSurfaceName)
            .map((r) => ({ ...r }));
    }

    if (Array.isArray(sh.windowShadingControls)) {
        sh.windowShadingControls = sh.windowShadingControls
            .filter((c) => c && c.name)
            .map((c) => ({ ...c }));
    }

    updateConfig(project, (ep) => ({
        ...ep,
        shading: sh,
    }));
}

export function setWeather(project, weather) {
    const w = weather && typeof weather === 'object' ? { ...weather } : {};
    updateConfig(project, (ep) => ({
        ...ep,
        weather: w,
    }));
}

export function setSimulationControl(project, simControl) {
    const sc = simControl && typeof simControl === 'object' ? { ...simControl } : {};
    updateConfig(project, (ep) => ({
        ...ep,
        simulationControl: sc,
    }));
}

/**
 * Internal helpers
 */

function isNum(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

function safeClone(obj) {
    if (!obj || typeof obj !== 'object') return {};
    if (Array.isArray(obj)) return obj.map((x) => safeClone(x));
    const out = {};
    for (const k in obj) {
        if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
        const v = obj[k];
        if (v && typeof v === 'object') {
            out[k] = safeClone(v);
        } else {
            out[k] = v;
        }
    }
    return out;
}

// Create an empty ep-like object with stable containers if needed by some helpers.
function epCloneOrEmpty(ep) {
    if (!ep || typeof ep !== 'object') {
        return {
            materials: [],
            constructions: [],
            defaults: {},
            schedules: { compact: {} },
            zoneLoads: [],
            thermostats: [],
            idealLoads: {},
            daylighting: {},
            weather: {},
            simulationControl: {},
        };
    }
    return safeClone(ep);
}
