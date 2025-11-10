// This file inlines the EnergyPlus defaults JSON as a JS module to avoid JSON module/MIME issues.
// It must mirror defaults/energyplusDefaults.json.

const defaults = {
  "simulation": {
    "SimulationControl": {
      "DoZoneSizingCalculation": "Yes",
      "DoSystemSizingCalculation": "Yes",
      "DoPlantSizingCalculation": "Yes",
      "RunSimulationForSizingPeriods": "No",
      "RunSimulationForWeatherFileRunPeriods": "Yes",
      "role": "simulation_control"
    },
    "Building": {
      "Name": "RM_Office_Building",
      "NorthAxis_deg": 0,
      "Terrain": "City",
      "LoadsConvergenceTolerance": 0.04,
      "TemperatureConvergenceTolerance_deltaC": 0.4,
      "SolarDistribution": "FullInteriorAndExterior",
      "MaximumNumberOfWarmupDays": 25,
      "MinimumNumberOfWarmupDays": 6,
      "role": "building"
    },
    "SurfaceConvectionAlgorithm:Inside": {
      "Algorithm": "TARP",
      "role": "inside_convection_algorithm"
    },
    "SurfaceConvectionAlgorithm:Outside": {
      "Algorithm": "DOE-2",
      "role": "outside_convection_algorithm"
    },
    "HeatBalanceAlgorithm": {
      "Algorithm": "ConductionTransferFunction",
      "role": "heat_balance_algorithm"
    },
    "Timestep": {
      "NumberOfTimestepsPerHour": 6,
      "role": "timestep"
    },
    "Site:Location": {
      "Name": "RM_Default_Location",
      "Latitude": 37.98,
      "Longitude": 23.72,
      "TimeZone": 2.0,
      "Elevation": 107.0,
      "role": "site_location"
    },
    "SizingPeriod:WeatherFileDays": {
      "Name": "RM_WeatherFileDays",
      "role": "sizingperiod_weatherfiledays"
    },
    "RunPeriod": {
      "Name": "Annual",
      "BeginMonth": 1,
      "BeginDayOfMonth": 1,
      "EndMonth": 12,
      "EndDayOfMonth": 31,
      "DayOfWeekForStartDay": "UseWeatherFile",
      "UseWeatherFileHolidaysAndSpecialDays": "Yes",
      "UseWeatherFileDaylightSavingPeriod": "Yes",
      "ApplyWeekendHolidayRule": "Yes",
      "UseWeatherFileRainIndicators": "Yes",
      "UseWeatherFileSnowIndicators": "Yes",
      "role": "runperiod"
    }
  },
  "scheduleTypeLimits": [
    {
      "Name": "Fraction",
      "LowerLimitValue": 0.0,
      "UpperLimitValue": 1.0,
      "NumericType": "CONTINUOUS",
      "role": "fraction_type"
    },
    {
      "Name": "Temperature",
      "LowerLimitValue": -60.0,
      "UpperLimitValue": 200.0,
      "NumericType": "CONTINUOUS",
      "role": "temperature_type"
    }
  ],
  "schedulesCompact": [
    {
      "Name": "RM_AlwaysOn",
      "TypeLimits": "Fraction",
      "Lines": ["Through: 12/31", "For: AllDays", "Until: 24:00, 1.0"],
      "role": "always_on"
    },
    {
      "Name": "RM_Office_Occ",
      "TypeLimits": "Fraction",
      "Lines": [
        "Through: 12/31",
        "For: Weekdays",
        "Until: 08:00, 0.0",
        "Until: 09:00, 0.2",
        "Until: 12:00, 0.9",
        "Until: 13:00, 0.7",
        "Until: 18:00, 0.9",
        "Until: 24:00, 0.05",
        "For: Weekends",
        "Until: 24:00, 0.05"
      ],
      "role": "typical_office_occupancy_schedule"
    },
    {
      "Name": "RM_Office_Lighting",
      "TypeLimits": "Fraction",
      "Lines": [
        "Through: 12/31",
        "For: Weekdays",
        "Until: 08:00, 0.0",
        "Until: 18:00, 1.0",
        "Until: 24:00, 0.1",
        "For: Weekends",
        "Until: 24:00, 0.1"
      ],
      "role": "typical_office_lighting_schedule"
    },
    {
      "Name": "RM_Office_Equipment",
      "TypeLimits": "Fraction",
      "Lines": [
        "Through: 12/31",
        "For: Weekdays",
        "Until: 08:00, 0.2",
        "Until: 18:00, 1.0",
        "Until: 24:00, 0.5",
        "For: Weekends",
        "Until: 24:00, 0.3"
      ],
      "role": "typical_office_equipment_schedule"
    }
  ],
  "materials": {
    "Material": [
      {
        "Name": "RM_Concrete_200mm",
        "Roughness": "MediumRough",
        "Thickness_m": 0.2,
        "Conductivity_W_mK": 1.75,
        "Density_kg_m3": 2300,
        "SpecificHeat_J_kgK": 900,
        "SolarAbsorptance": 0.6,
        "ThermalAbsorptance": 0.9,
        "VisibleAbsorptance": 0.6,
        "role": "opaque_exterior_wall_layer"
      }
      // ... (keep the rest of your material definitions from energyplusDefaults.json)
    ],
    "Material:AirGap": [
      {
        "Name": "RM_AirGap_50mm",
        "ThermalResistance_m2K_W": 0.18,
        "role": "air_gap_layer"
      }
    ],
    "WindowMaterial:Glazing": [
      {
        "Name": "RM_Clear_3mm",
        "OpticalDataType": "SpectralAverage",
        "Thickness_m": 0.003,
        "SolarTransmittance": 0.837,
        "FrontSolarReflectance": 0.075,
        "BackSolarReflectance": 0.075,
        "VisibleTransmittance": 0.898,
        "FrontVisibleReflectance": 0.081,
        "BackVisibleReflectance": 0.081,
        "InfraredTransmittance": 0.0,
        "FrontIRHemisphericalEmissivity": 0.84,
        "BackIRHemisphericalEmissivity": 0.84,
        "Conductivity_W_mK": 1.0,
        "role": "window_glazing_layer"
      }
    ],
    "WindowMaterial:Gas": [
      {
        "Name": "RM_Air_13mm",
        "GasType": "Air",
        "Thickness_m": 0.013,
        "role": "window_gas_layer"
      }
    ],
    "WindowMaterial:Shade": []
  },
  "constructions": [
    {
      "Name": "RM_Ext_Wall",
      "Layers": ["RM_Concrete_200mm"],
      "role": "opaque_exterior_wall"
    },
    {
      "Name": "RM_Roof",
      "Layers": ["RM_Concrete_200mm"],
      "role": "opaque_roof"
    },
    {
      "Name": "RM_Slab_On_Grade",
      "Layers": ["RM_Concrete_200mm"],
      "role": "slab_on_grade"
    },
    {
      "Name": "RM_Dbl_Clr_3mm_13mmAir",
      "Layers": ["RM_Clear_3mm", "RM_Air_13mm", "RM_Clear_3mm"],
      "role": "window_double_clear"
    }
  ],
  "loads": {
    "People": [
      {
        "Name": "Default_Office_People",
        "PeoplePerFloorArea": 0.1,
        "ActivityLevel": 120,
        "ScheduleName": "RM_Office_Occ",
        "role": "typical_office_occupancy_per_m2"
      }
    ],
    "Lights": [
      {
        "Name": "Default_Office_Lighting",
        "WattsPerFloorArea": 8.0,
        "ScheduleName": "RM_Office_Lighting",
        "role": "typical_office_lighting_per_m2"
      }
    ],
    "ElectricEquipment": [
      {
        "Name": "Default_Office_Equipment",
        "WattsPerFloorArea": 10.0,
        "ScheduleName": "RM_Office_Equipment",
        "role": "typical_office_equipment_per_m2"
      }
    ],
    "ZoneInfiltration:DesignFlowRate": [
      {
        "Name": "Default_Office_Infiltration",
        "AirChangesPerHour": 0.5,
        "ScheduleName": "RM_AlwaysOn",
        "role": "typical_office_infiltration"
      }
    ],
    "ZoneVentilation:DesignFlowRate": [
      {
        "Name": "Default_Office_Ventilation",
        "FlowPerPerson_m3_s": 0.01,
        "ScheduleName": "RM_AlwaysOn",
        "role": "typical_office_ventilation"
      }
    ]
  },
  "hvacTemplates": {
    "Thermostats": [
      {
        "Name": "RM_Default_Thermostat",
        "HeatingScheduleName": "RM_AlwaysOn",
        "CoolingScheduleName": "RM_AlwaysOn",
        "role": "default_thermostat"
      }
    ],
    "IdealLoads": [
      {
        "Name": "RM_Default_IdealLoads",
        "AvailabilityScheduleName": "RM_AlwaysOn",
        "OutdoorAirMethod": "None",
        "role": "default_ideal_loads_system"
      }
    ]
  },
  "outputs": {
    "Output:IlluminanceMap": [],
    "Output:VariableDictionary": {
      "KeyField": "Regular",
      "role": "variable_dictionary"
    },
    "Output:Surfaces:List": {
      "report_type": "AllDetailed",
      "role": "surfaces_list"
    },
    "Output:Surfaces:Drawing": {
      "report_type": "DXF",
      "role": "surfaces_drawing"
    },
    "Output:Constructions": {
      "DetailsType": "Constructions",
      "role": "constructions_report"
    },
    "Output:Table:SummaryReports": {
      "Reports": ["AllSummary"],
      "role": "summary_reports"
    },
    "OutputControl:Table:Style": {
      "ColumnSeparator": "Comma",
      "role": "table_style"
    },
    "Output:Variable": [],
    "Output:SQLite": {
      "OptionType": "SimpleAndTabular",
      "role": "sqlite_output"
    },
    "Output:Diagnostics": {
      "Keys": ["DisplayAdvancedReportVariables"],
      "role": "diagnostics"
    }
  }
};

export default defaults;
