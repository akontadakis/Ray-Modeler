## EnergyPlus Integration Gap Analysis

### High-Level Summary

The current EnergyPlus integration in Ray Modeler is well-suited for **early-stage, load-focused analysis** of simple, single-zone, or multi-zone building models. It effectively allows users to define basic geometry, materials, constructions, internal loads, and some daylighting parameters to estimate heating and cooling demands using an "ideal loads" HVAC system. The integration provides a structured UI workflow for configuration and includes validation checks to prevent common errors.

However, the integration has significant limitations that prevent it from being used for detailed, comprehensive energy analysis or real-world HVAC system design.

### Identified Gaps and Limitations

1.  **HVAC Systems (Most Significant Gap):**
    *   **Limited to Ideal Loads:** The integration is explicitly limited to `ZoneHVAC:IdealLoadsAirSystem`. This means the application assumes a perfect, infinite-capacity HVAC system, which is useful for early-stage demand estimation but entirely insufficient for modeling actual HVAC equipment performance, energy consumption, or system interactions.
    *   **No Detailed HVAC Components:** There is a complete lack of support for detailed HVAC components and systems, including:
        *   Air loops (`AirLoopHVAC`).
        *   Plant loops (chilled water, hot water, condenser water).
        *   Specific equipment like coils, fans, pumps, boilers, chillers, cooling towers, heat exchangers, etc.

2.  **Geometry Representation:**
    *   **Simplistic Geometry:** The geometry generation is primarily designed for a single-room parametric model, with hardcoded logic for creating surfaces and windows for rectangular rooms.
    *   **Limited Complex Geometry Support:** There is no apparent support for importing complex geometry from external sources (e.g., gbXML, IFC) or for defining non-rectangular or multi-faceted zones.
    *   **No Adjacency Handling:** The current model does not seem to handle adjacencies between zones, implying that all surfaces are treated as exterior, which can lead to inaccurate energy calculations for multi-zone buildings.

3.  **Hardcoded Values and Assumptions:**
    *   **EnergyPlus Version:** The EnergyPlus version is hardcoded to `25.1`. This targets a modern release, but you should ensure your installed EnergyPlus runtime matches this version for full compatibility.
    *   **Default Parameters:** Many default values are used for simulation parameters (`SimulationControl`, `Building` settings, ideal loads parameters) if not explicitly provided by the user. While this adds robustness, it can obscure important assumptions from the user.
    *   **RunPeriod Simplification:** The `RunPeriod` object is simplified, hardcoded to "Annual," and does not fully expose the detailed configuration options available in EnergyPlus.

4.  **Limited EnergyPlus Object Support:**
    *   While essential objects are covered, many important EnergyPlus objects are missing, limiting the depth of analysis:
*   **Sizing Objects:** `Sizing:*` objects (e.g., `Sizing:Zone`, `Sizing:System`, `Sizing:Plant`) are not explicitly generated, even though `SimulationControl` is set to perform sizing calculations.
        *   **Outdoor Air Design:** `DesignSpecification:OutdoorAir` is mentioned but requires the user to provide the object name, lacking builder logic for its definition.
        *   **Natural Ventilation:** No support for natural ventilation objects like `ZoneVentilation:DesignFlowRate`.
        *   **Advanced Daylighting:** While `Daylighting:Controls` and `Output:IlluminanceMap` are supported, more advanced daylighting objects or detailed sensor definitions are not.
        *   **Shading:** No support for detailed shading objects (`Shading:Site`, `Shading:Building`, `Shading:Zone`).

1.  **User Experience and Guidance:**
    *   **Disabled Contextual Help:** The `energyplusHelp.js` module is disabled, indicating a lack of contextual guidance for users navigating the EnergyPlus features.

### Recommendations for Improvement

1.  **Implement Detailed HVAC Modeling:**
    *   **Phased Approach:** Introduce support for detailed HVAC systems in phases, starting with common system types (e.g., VAV, FCU).
    *   **New UI Panels:** Develop dedicated UI panels for defining air loops, plant loops, and their associated components (coils, fans, pumps, etc.).
    *   **Component Library:** Integrate a library of common HVAC components with editable parameters.

2.  **Enhance Geometry Support:**
    *   **Advanced Parametric Modeling:** Expand the parametric modeling capabilities to support more complex room shapes and multi-zone configurations with accurate adjacency definitions.
    *   **Import Capabilities:** Investigate and implement support for importing geometry from industry-standard formats like gbXML or IFC to allow users to work with existing building models.

3.  **Expand EnergyPlus Object Coverage:**
    *   **Prioritize Missing Objects:** Identify and prioritize the most critical missing EnergyPlus objects based on user needs and common energy modeling practices (e.g., detailed sizing, natural ventilation, advanced shading).
    *   **Output Customization:** Provide more comprehensive and user-friendly options for customizing EnergyPlus outputs.

4.  **Improve User Experience and Transparency:**
    *   **Enable Contextual Help:** Activate and populate `energyplusHelp.js` to provide in-app, contextual guidance for all EnergyPlus features.
    *   **Clarify Assumptions:** Make the default values and assumptions used in IDF generation more transparent to the user, perhaps through tooltips or a dedicated "Simulation Settings" summary.
    *   **Enhanced Validation Feedback:** Provide more detailed and actionable feedback from `energyplusValidation.js` to guide users in resolving configuration issues.

By addressing these gaps, Ray Modeler can evolve from a tool for early-stage load analysis to a more comprehensive platform for detailed building energy modeling and HVAC system design.
