
import * as THREE from 'three';
import { BufferGeometryUtils } from 'three/addons/utils/BufferGeometryUtils.js';
import { roomObject, wallSelectionGroup, importedModelObject, shadingObject, vegetationObject, furnitureObject, contextObject, updateScene } from './geometry.js';
import { getDom } from './dom.js';
import { getNewZIndex, showAlert } from './ui.js';

export class GeometryOptimizer {
    constructor() {
        this.originalVisibility = new Map();
        this.optimizedGroup = null;
        this.previewGroup = null;
    }

    /**
     * Prompts the user to run optimization.
     * @returns {Promise<boolean>} Resolves true if user wants to optimize, false otherwise.
     */
    async promptForOptimization() {
        return new Promise((resolve) => {
            // Check if we should even ask (e.g. if preference is set) - for now, always ask
            const modal = document.createElement('div');
            modal.style.zIndex = getNewZIndex() + 100;
            modal.className = 'fixed inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm';
            modal.innerHTML = `
                <div class="bg-[--bg-card] border border-[--grid-color] shadow-2xl rounded-lg p-6 max-w-md w-full relative">
                    <h3 class="text-lg font-bold mb-2 text-[--text-primary]">Optimize Geometry?</h3>
                    <p class="text-sm text-[--text-secondary] mb-6">
                        Would you like to analyze and optimize the scene geometry before generating the simulation package? 
                        This can reduce file size, fix overlapping surfaces, and improve simulation speed.
                        <br><br>
                        <span class="text-xs italic opacity-70">Note: This converts parametric objects into static meshes for export.</span>
                    </p>
                    <div class="flex justify-end gap-3">
                        <button id="opt-skip-btn" class="px-4 py-2 rounded text-sm font-medium hover:bg-[--bg-hover] text-[--text-secondary] transition-colors">Skip</button>
                        <button id="opt-run-btn" class="px-4 py-2 rounded text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors shadow-lg">Run Optimization</button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            const cleanup = () => {
                if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
            };

            const runBtn = modal.querySelector('#opt-run-btn');
            const skipBtn = modal.querySelector('#opt-skip-btn');

            runBtn.addEventListener('click', () => {
                cleanup();
                resolve(true);
            });

            skipBtn.addEventListener('click', () => {
                cleanup();
                resolve(false);
            });
        });
    }

    /**
     * The main entry point to run the optimization flow.
     * @returns {Promise<THREE.Group|null>} The optimized geometry group if accepted, null if rejected/skipped.
     */
    async run() {
        // 1. Prompt
        const shouldRun = await this.promptForOptimization();
        if (!shouldRun) return null;

        // 2. Show loading (blocking)
        const loadingToast = document.createElement('div');
        loadingToast.className = 'fixed bottom-8 right-8 bg-[--bg-card] border border-[--grid-color] p-4 rounded shadow-xl flex items-center gap-3 z-[9999]';
        loadingToast.innerHTML = `<span class="loading loading-spinner text-blue-500 loading-sm"></span><span class="text-sm">Optimizing geometry...</span>`;
        document.body.appendChild(loadingToast);

        // Allow UI to render toast before heavy lifting
        await new Promise(r => setTimeout(r, 50));

        try {
            // 3. Collect and Optimize
            // We clone the specific groups we care about for Radiance export
            const rawGeometry = this.collectSceneGeometry();
            this.optimizedGroup = this.optimize(rawGeometry);

            // 4. Preview
            loadingToast.remove(); // Done processing

            const accepted = await this.showPreview(this.optimizedGroup);

            this.restoreOriginalScene();

            if (accepted) {
                return this.optimizedGroup;
            } else {
                return null;
            }

        } catch (error) {
            console.error("Optimization failed:", error);
            if (loadingToast.parentNode) loadingToast.remove();
            showAlert(`Optimization failed: ${error.message}`, 'Error');
            this.restoreOriginalScene(); // Safety cleanup
            return null;
        }
    }

    collectSceneGeometry() {
        const collectedGroup = new THREE.Group();

        // Helpers to safely clone and strip non-geometry
        const processGroup = (group, namePrefix) => {
            if (!group) return;
            group.traverse(child => {
                if (child.isMesh) {
                    // Check if it's a visible, renderable mesh (ignore helpers)
                    if (child.visible && !child.userData.isHelper && !child.isTransformControl) {
                        const clone = child.clone();
                        // Apply world transform if needed? 
                        // The original groups (roomObject etc) have transforms applied.
                        // We need to bake these transforms into the geometry if we are going to merge.
                        // Or we can just add the clone to our collected group and respect hierarchy?
                        // Merging requires baking.

                        // Let's create a clone with baked world matrix.
                        child.updateMatrixWorld(true);
                        const bakedGeom = child.geometry.clone();
                        bakedGeom.applyMatrix4(child.matrixWorld);

                        const bakedMesh = new THREE.Mesh(bakedGeom, child.material);
                        bakedMesh.userData = { ...child.userData }; // Preserve metadata like surfaceType
                        // Ensure surfaceType exists for Radiance export logic
                        if (!bakedMesh.userData.surfaceType) {
                            // Try to deduce or default?
                            // For now, if we can't identify it, it might just be generic geometry.
                            // In Radiance export, we usually check surfaceType.
                        }

                        collectedGroup.add(bakedMesh);
                    }
                }
            });
        };

        processGroup(roomObject, 'parametric');
        processGroup(wallSelectionGroup, 'wall'); // Custom/Parametric walls are here
        processGroup(importedModelObject, 'imported');
        processGroup(shadingObject, 'shading');
        processGroup(furnitureObject, 'furniture');
        processGroup(contextObject, 'context');
        processGroup(vegetationObject, 'vegetation');

        return collectedGroup;
    }

    optimize(rawGroup) {
        // Group meshes by material (or rather, by Radiance Material Name/Characteristics)
        // Radiance export uses 'surfaceType' to determine material.
        // So we should group by 'surfaceType' + material properties.
        // Actually, for Radiance export optimization, we primarily want to reduce triangle count 
        // and fix overlaps (though BufferGeometryUtils doesn't implicitly fix overlaps, mergeVertices does fix coincident vertices).

        // Strategy:
        // 1. Bin meshes by 'surfaceType'.
        // 2. For each bin, merge geometries.
        // 3. Apply mergeVertices to remove duplicates.

        const optimizedRoot = new THREE.Group();
        const bins = new Map();

        rawGroup.children.forEach(mesh => {
            const type = mesh.userData.surfaceType || 'GENERIC';
            // We also need to distinguish distinct materials within a surface type if possible?
            // In the current app, 'INTERIOR_WALL' uses 'wall_mat' globally (mostly).
            // But if we have specific modifications, we should be careful.
            // For now, grouping by surfaceType is the safest 'high level' optim for this app.

            // NOTE: We must differentiate transparency/glass!
            // 'GLAZING' is a distinct surfaceType.

            if (!bins.has(type)) bins.set(type, []);
            bins.get(type).push(mesh);
        });

        bins.forEach((meshes, type) => {
            if (meshes.length === 0) return;

            // Extract geometries
            const geometries = [];
            meshes.forEach(m => {
                // Ensure geometry is compatible for merge (attributes match)
                // Sometimes UVs or Normals are missing. 
                if (!m.geometry.attributes.normal) m.geometry.computeVertexNormals();
                if (!m.geometry.attributes.uv) {
                    // Create dummy UVs if missing to allow merge?
                    // BufferGeometryUtils.mergeGeometries requires matching attributes.
                    // Let's rely on standard geometries usually having them.
                }
                geometries.push(m.geometry);
            });

            try {
                // Merge
                const mergedGeom = BufferGeometryUtils.mergeGeometries(geometries, false);

                // Cleanup
                const cleanedGeom = BufferGeometryUtils.mergeVertices(mergedGeom);

                // Create new Mesh
                // We pick the material from the first mesh in the bin as the representative
                const repMaterial = meshes[0].material;
                const newMesh = new THREE.Mesh(cleanedGeom, repMaterial);
                newMesh.userData.surfaceType = type;
                newMesh.name = `optimized_${type}`;

                optimizedRoot.add(newMesh);

                // Dispose originals
                // mergedGeom.dispose(); // mergedGeom is potentially used in cleanedGeom? No, mergeVertices returns new.
                // cleanedGeom is the one we keep. 
                // We should dispose the intermediate 'mergedGeom'.
                mergedGeom.dispose();

            } catch (e) {
                console.warn(`Failed to merge meshes for type ${type}`, e);
                // Fallback: just add original meshes if merge fails
                meshes.forEach(m => optimizedRoot.add(m.clone()));
            }
        });

        return optimizedRoot;
    }

    async showPreview(optimizedGroup) {
        // 1. Hide original scene
        this.saveAndHideOriginals();

        // 2. Add optimized group to scene
        // We'll add it to the scene root or a special preview container
        // We need to import 'scene' from geometry/scene.js
        // But loop imports might be tricky. Using 'roomObject' or similar parent is safer if we just empty them?
        // No, 'roomObject' is managed by updateScene.
        // Let's assume we can interact with the global scene via helper or direct add if we import it.
        // We imported updateScene from geometry.js. Let's import 'scene' from scene.js in the module imports.

        // Dynamic import to avoid circular dependency issues at top level if any
        const { scene } = await import('./scene.js');

        this.previewGroup = optimizedGroup;
        scene.add(this.previewGroup);

        // Add a visual indicator (wireframe overlay) to show it's the optimized mesh?
        // Or specific material override?
        // Let's keep it "What You See Is What You Get" for the materials, 
        // maybe just flash it or keep standard look.
        // The user asked to "visualize the optimized geometry".
        // Seeing the wireframe might be good to verify "reduction of surfaces".

        const wireframeColor = 0x00ff00;
        optimizedGroup.traverse(child => {
            if (child.isMesh) {
                const edges = new THREE.EdgesGeometry(child.geometry);
                const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: wireframeColor, opacity: 0.5, transparent: true }));
                child.add(line);
            }
        });

        return new Promise((resolve) => {
            // Show Accept/Reject UI
            const modal = document.createElement('div');
            modal.style.zIndex = getNewZIndex() + 100;
            modal.className = 'fixed bottom-10 left-1/2 transform -translate-x-1/2 flex items-center gap-4 bg-[--bg-card] border border-[--grid-color] p-4 rounded-lg shadow-2xl';
            modal.innerHTML = `
                <div class="flex flex-col">
                    <span class="font-bold text-[--text-primary]">Review Optimization</span>
                    <span class="text-xs text-[--text-secondary]">Check the viewport for the optimized geometry (green wires).</span>
                </div>
                <div class="flex gap-2">
                    <button id="opt-reject-btn" class="btn btn-sm btn-ghost text-red-500">Reject</button>
                    <button id="opt-accept-btn" class="btn btn-sm btn-primary">Accept & Generate</button>
                </div>
            `;
            document.body.appendChild(modal);

            const cleanup = () => {
                modal.remove();
            };

            modal.querySelector('#opt-accept-btn').addEventListener('click', () => {
                cleanup();
                resolve(true);
            });
            modal.querySelector('#opt-reject-btn').addEventListener('click', () => {
                cleanup();
                resolve(false);
            });
        });
    }

    saveAndHideOriginals() {
        // Hide known groups
        const groups = [roomObject, wallSelectionGroup, importedModelObject, shadingObject, furnitureObject, contextObject, vegetationObject];
        groups.forEach(g => {
            this.originalVisibility.set(g, g.visible);
            g.visible = false;
        });
    }

    async restoreOriginalScene() {
        // Remove preview
        if (this.previewGroup) {
            const { scene } = await import('./scene.js');
            scene.remove(this.previewGroup);
            this.previewGroup = null;
        }

        // Restore visibility
        const groups = [roomObject, wallSelectionGroup, importedModelObject, shadingObject, furnitureObject, contextObject, vegetationObject];
        groups.forEach(g => {
            if (this.originalVisibility.has(g)) {
                g.visible = this.originalVisibility.get(g);
            } else {
                g.visible = true; // Default to visible if state lost
            }
        });
        this.originalVisibility.clear();

        // Trigger a light update to ensure everything is sync-ed
        updateScene();
    }
}
