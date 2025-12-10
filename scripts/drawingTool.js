import * as THREE from 'three';
import { renderer, activeCamera, controls, orthoCamera, setActiveCamera, scene } from './scene.js';
import { roomObject, wallSelectionGroup, updateScene, setIsCustomGeometry } from './geometry.js';
import { getDom } from './dom.js';
import { createCustomRoom, addCustomPartition, getCustomRoomHeight } from './customGeometryManager.js';

export let isDrawing = false;
export let isDrawingPartition = false; // New flag for partition mode
let points = []; // Array of THREE.Vector3
let activeLine = null;
let cursorMarker = null;
let startMarker = null;
let segmentLabelData = []; // Array of {div, p1, p2}
let tempGroup = new THREE.Group();
// scene.add(tempGroup); // Moved to startDrawingMode to avoid init issues

// State for precision input
let currentInput = "";
let isSnappingEnabled = true;
let isOrthoLockEnabled = true; // When true, walls snap to horizontal/vertical only

// Floor plan image state
let floorPlanMesh = null;
let floorPlanTexture = null;
let pendingFloorPlanFile = null;
let pendingFloorPlanWidth = 10;

/**
 * Shows the drawing setup modal to optionally load a floor plan image.
 * This is called before starting drawing mode.
 */
export function showDrawSetupModal() {
    const modal = document.getElementById('draw-setup-modal');
    const fileInput = document.getElementById('draw-floor-plan-input');
    const fileName = document.getElementById('draw-floor-plan-name');
    const scaleSection = document.getElementById('draw-floor-plan-scale-section');
    const widthInput = document.getElementById('draw-floor-plan-width');
    const previewImg = document.getElementById('draw-floor-plan-preview-img');
    const skipBtn = document.getElementById('draw-setup-skip');
    const confirmBtn = document.getElementById('draw-setup-confirm');

    if (!modal) {
        // Fallback: if modal doesn't exist, start drawing directly
        startDrawingMode();
        return;
    }

    // Reset state
    pendingFloorPlanFile = null;
    pendingFloorPlanWidth = 10;
    fileInput.value = '';
    fileName.textContent = 'No image selected';
    scaleSection.classList.add('hidden');
    widthInput.value = 10;

    // Show modal
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    // File input change handler
    const onFileChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            pendingFloorPlanFile = file;
            fileName.textContent = file.name;
            scaleSection.classList.remove('hidden');

            // Show preview
            const reader = new FileReader();
            reader.onload = (evt) => {
                previewImg.src = evt.target.result;
            };
            reader.readAsDataURL(file);
        } else {
            pendingFloorPlanFile = null;
            fileName.textContent = 'No image selected';
            scaleSection.classList.add('hidden');
        }
    };

    // Width input change handler
    const onWidthChange = (e) => {
        pendingFloorPlanWidth = parseFloat(e.target.value) || 10;
    };

    // Skip button - start drawing without floor plan
    const onSkip = () => {
        cleanup();
        modal.classList.remove('flex');
        modal.classList.add('hidden');
        startDrawingMode();
    };

    // Confirm button - start drawing with floor plan
    const onConfirm = () => {
        cleanup();
        modal.classList.remove('flex');
        modal.classList.add('hidden');

        if (pendingFloorPlanFile) {
            // Load the floor plan and then start drawing
            loadFloorPlanImage(pendingFloorPlanFile, pendingFloorPlanWidth).then(() => {
                startDrawingMode();
            });
        } else {
            startDrawingMode();
        }
    };

    // Cleanup function to remove event listeners
    const cleanup = () => {
        fileInput.removeEventListener('change', onFileChange);
        widthInput.removeEventListener('input', onWidthChange);
        skipBtn.removeEventListener('click', onSkip);
        confirmBtn.removeEventListener('click', onConfirm);
    };

    // Add event listeners
    fileInput.addEventListener('change', onFileChange);
    widthInput.addEventListener('input', onWidthChange);
    skipBtn.addEventListener('click', onSkip);
    confirmBtn.addEventListener('click', onConfirm);
}

/**
 * Loads a floor plan image and creates a 3D plane to display it.
 * @param {File} imageFile - The image file to load
 * @param {number} widthMeters - The real-world width of the image in meters
 * @returns {Promise} Resolves when the image is loaded
 */
function loadFloorPlanImage(imageFile, widthMeters) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            const textureLoader = new THREE.TextureLoader();
            textureLoader.load(e.target.result, (texture) => {
                floorPlanTexture = texture;

                // Calculate height based on aspect ratio
                const aspectRatio = texture.image.height / texture.image.width;
                const heightMeters = widthMeters * aspectRatio;

                // Create plane geometry
                const geometry = new THREE.PlaneGeometry(widthMeters, heightMeters);
                const material = new THREE.MeshBasicMaterial({
                    map: texture,
                    transparent: true,
                    opacity: 0.7,
                    side: THREE.DoubleSide,
                    depthTest: true,
                    depthWrite: false
                });

                floorPlanMesh = new THREE.Mesh(geometry, material);

                // Position the plane on the floor (Y=0) slightly below drawing plane
                floorPlanMesh.rotation.x = -Math.PI / 2; // Lay flat on XZ plane
                floorPlanMesh.position.set(widthMeters / 2, -0.01, heightMeters / 2);
                floorPlanMesh.renderOrder = -1; // Render behind other objects

                // Add to tempGroup so it's cleaned up with drawing
                if (!tempGroup.parent) {
                    scene.add(tempGroup);
                }
                tempGroup.add(floorPlanMesh);

                console.log(`[DrawingTool] Floor plan loaded: ${widthMeters}m x ${heightMeters.toFixed(2)}m`);
                resolve();
            }, undefined, (error) => {
                console.error('[DrawingTool] Error loading floor plan texture:', error);
                reject(error);
            });
        };

        reader.onerror = (error) => {
            console.error('[DrawingTool] Error reading floor plan file:', error);
            reject(error);
        };

        reader.readAsDataURL(imageFile);
    });
}

/**
 * Clears the floor plan from the scene.
 */
function clearFloorPlan() {
    if (floorPlanMesh) {
        tempGroup.remove(floorPlanMesh);
        if (floorPlanMesh.geometry) floorPlanMesh.geometry.dispose();
        if (floorPlanMesh.material) {
            if (floorPlanMesh.material.map) floorPlanMesh.material.map.dispose();
            floorPlanMesh.material.dispose();
        }
        floorPlanMesh = null;
    }
    if (floorPlanTexture) {
        floorPlanTexture.dispose();
        floorPlanTexture = null;
    }
    pendingFloorPlanFile = null;
}



export function startDrawingMode() {
    const dom = getDom();
    isDrawing = true;
    points = [];
    startMarker = null;
    segmentLabelData = [];
    currentInput = "";

    // --- FIX: Clear existing parametric geometry ---
    setIsCustomGeometry(true); // Prevent parametric updates
    while (roomObject.children.length > 0) roomObject.remove(roomObject.children[0]);
    while (wallSelectionGroup.children.length > 0) wallSelectionGroup.remove(wallSelectionGroup.children[0]);
    updateScene(); // Refresh scene state
    // -----------------------------------------------

    // Ensure group is in scene
    if (!tempGroup.parent) {
        scene.add(tempGroup);
    }

    // Switch to Top View (Ortho)
    import('./ui.js').then(({ setCameraView, showAlert, setCustomGeometryUI }) => {
        setCustomGeometryUI(true); // Hide parametric dimensions
        setCameraView('top'); // Ensure we are looking down
        // Force Ortho camera just in case
        setActiveCamera(orthoCamera);
        controls.enabled = true; // Enable orbit controls for pan/zoom
        controls.enableRotate = false; // Lock rotation for top-down view
        controls.enableZoom = true;
        controls.enablePan = true;

        // Save original mouse buttons to restore later
        // Note: OrbitControls doesn't have userData by default, so we initialize it
        if (!controls.userData) controls.userData = {};
        controls.userData.originalMouseButtons = { ...controls.mouseButtons };

        // Configure Mouse Buttons: 
        // LEFT: Draw (Handled by our listeners, effectively nothing for OrbitControls since rotate is off)
        // MIDDLE: Zoom/Pan
        // RIGHT: Pan
        controls.mouseButtons = {
            LEFT: THREE.MOUSE.PAN, // Or DOLLY, or null? If PAN, dragging left button will pan. User wants to Draw with Click. 
            // If we set it to PAN, drawing might be harder if they drag slightly.
            // Better to set LEFT to null (or keep ROTATE but we disabled enableRotate).
            // If we set LEFT: THREE.MOUSE.PAN, then left-drag pans.
            // If we want drawing (click), we should probably avoid PAN on left drag unless user specifically wants it.
            // Usually 2D tools: Left Click = Draw. Middle/Right/Space = Pan. Wheel = Zoom.
            // So set LEFT to null to assume it's for custom actions (drawing).
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.PAN
        };
        // Actually, if we set LEFT to null, then clicking won't be swallowed by "drag" detection if the user moves slightly?
        // Let's set LEFT to null to be safe for drawing.
        controls.mouseButtons.LEFT = null;

        showAlert("Top-Down Drawing Mode Active.<br>Click to start. Double-click to finish. Type numbers for length.<br>Press 'O' to toggle diagonal drawing, 'S' for snapping.", "Drawing Mode");
    });

    // Visual Helpers - Use theme-aware colors
    // Get drawing color from theme
    const drawingColor = getThemeDrawingColor();

    if (!cursorMarker) {
        cursorMarker = new THREE.Mesh(
            new THREE.SphereGeometry(0.2, 16, 16),
            new THREE.MeshBasicMaterial({ color: drawingColor, depthTest: false, depthWrite: false })
        );
        cursorMarker.renderOrder = 999;
        tempGroup.add(cursorMarker);
    }

    // Add event listeners
    const canvas = dom['render-container'];
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('dblclick', onDoubleClick);
    // Use Capture Phase (true) to intercept keys before UI shortcuts
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', onWindowResize);
    controls.addEventListener('change', updateAllLabels);
}

export function startPartitionDrawingMode() {
    const dom = getDom();
    isDrawing = true;
    isDrawingPartition = true;
    points = [];
    startMarker = null;
    segmentLabelData = [];
    currentInput = "";

    // DO NOT Clear existing parametric geometry - we are drawing inside it
    setIsCustomGeometry(true);

    // Ensure group is in scene
    if (!tempGroup.parent) {
        scene.add(tempGroup);
    }

    // Switch to Top View (reuse UI logic)
    import('./ui.js').then(({ setCameraView, showAlert, setCustomGeometryUI }) => {
        setCustomGeometryUI(true);
        setCameraView('top');
        setActiveCamera(orthoCamera);
        controls.enabled = true;
        controls.enableRotate = false;
        controls.enableZoom = true;
        controls.enablePan = true;

        if (!controls.userData) controls.userData = {};
        controls.userData.originalMouseButtons = { ...controls.mouseButtons };

        controls.mouseButtons = {
            LEFT: null,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.PAN
        };

        showAlert("Partition Drawing Mode.<br>Click to start chain. Double-click to finish chain. Esc to exit.<br>Press 'O' to toggle diagonal drawing.", "Drawing Mode");
    });

    const drawingColor = getThemeDrawingColor();
    if (!cursorMarker) {
        cursorMarker = new THREE.Mesh(
            new THREE.SphereGeometry(0.2, 16, 16),
            new THREE.MeshBasicMaterial({ color: drawingColor, depthTest: false, depthWrite: false })
        );
        cursorMarker.renderOrder = 999;
        tempGroup.add(cursorMarker);
    }

    const canvas = dom['render-container'];
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('dblclick', onDoubleClick);
    canvas.addEventListener('contextmenu', onContextMenu); // Right-click to finish
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', onWindowResize);
    controls.addEventListener('change', updateAllLabels);
}

function onContextMenu(e) {
    if (!isDrawingPartition) return;
    e.preventDefault();
    console.log("Right-click detected - calling finishDrawing");
    finishDrawing();
}

function onWindowResize() {
    // No-op for Mesh based drawing (handled by renderer auto-resize)
}

function getMousePosition(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera({ x, y }, activeCamera);

    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const target = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, target);

    // Grid Snapping (0.5m snap)
    const SNAP = 0.5;
    if (isSnappingEnabled) {
        target.x = Math.round(target.x / SNAP) * SNAP;
        target.z = Math.round(target.z / SNAP) * SNAP;
    }
    target.y = 0;

    return target;
}

function onMouseMove(e) {
    if (!isDrawing) return;

    let target = getMousePosition(e);

    // Ortho Lock Logic (only when enabled)
    if (points.length > 0 && isOrthoLockEnabled) {
        const last = points[points.length - 1];
        const dx = Math.abs(target.x - last.x);
        const dz = Math.abs(target.z - last.z);

        // Force Manhattan Geometry
        if (dx > dz) {
            target.z = last.z;
        } else {
            target.x = last.x;
        }
    }

    cursorMarker.position.copy(target);
    updateTooltip(e.clientX, e.clientY, target);

    // Wall Visualization & Ruler Logic
    if (points.length > 0) {
        // --- 1. WALL VISUALIZATION (Thick Mesh) ---
        if (!activeLine) {
            // Create "Active Wall" Mesh instead of Line2
            // We'll use a BoxGeometry to simulate thickness, even in top view
            const geometry = new THREE.BoxGeometry(1, 1, 1);
            // Pivot adjustment: By default Box is centered. We prefer to scale it from one end?
            // Easier: just place it at midpoint and scale length.

            const activeColor = getThemeDrawingColor();
            const material = new THREE.MeshBasicMaterial({
                color: activeColor,
                transparent: true,
                opacity: 0.5,
                depthTest: false,
                depthWrite: false
            });

            activeLine = new THREE.Mesh(geometry, material);
            activeLine.renderOrder = 998;
            activeLine.userData.isWallPreview = true;
            tempGroup.add(activeLine);
        }

        const lastPoint = points[points.length - 1];

        // Calculate Wall Dimensions
        const dist = lastPoint.distanceTo(target);
        const thickness = 0.2; // Default drawing thickness

        const angle = -Math.atan2(target.z - lastPoint.z, target.x - lastPoint.x);
        const midX = (lastPoint.x + target.x) / 2;
        const midZ = (lastPoint.z + target.z) / 2;

        // Update Wall Mesh (show raw drawn length, no extension during preview)
        activeLine.position.set(midX, 0, midZ);
        activeLine.rotation.y = angle;
        // Scale: X=Length, Y=Height(dummy small), Z=Thickness
        // BoxGeometry(1,1,1) -> Scale(dist, 0.1, thickness)
        // Note: In ThreeJS BoxGeometry, if we rotate Y, the X axis aligns with length.
        activeLine.scale.set(dist, 0.1, thickness);

        // --- 2. RULER VISUALIZATION ---
        updateRuler(lastPoint, target, dist, angle);
    }
}

// Global Ruler Object (reused)
let rulerGroup = null;

function updateRuler(p1, p2, dist, angle) {
    if (!rulerGroup) {
        rulerGroup = new THREE.Group();
        tempGroup.add(rulerGroup);
    }

    // Clear previous ruler
    while (rulerGroup.children.length > 0) {
        const c = rulerGroup.children[0];
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
        rulerGroup.remove(c);
    }

    // Ruler Parameters
    const rulerOffset = 0.5; // Distance from wall center
    const tickSize = 0.1;

    // Create Ruler Line Geometry
    // We want the ruler to be offset to the "right" relative to the drawing direction?
    // Or just fixed offset. Let's do "right" side.

    // Direction Vector
    const dir = new THREE.Vector3().subVectors(p2, p1).normalize();
    const right = new THREE.Vector3(dir.z, 0, -dir.x).normalize(); // Perpendicular

    const startRuler = p1.clone().add(right.clone().multiplyScalar(rulerOffset));
    const endRuler = p2.clone().add(right.clone().multiplyScalar(rulerOffset));

    // Main Line
    const rulerColor = getThemeDrawingColor();
    const lineGeo = new THREE.BufferGeometry().setFromPoints([startRuler, endRuler]);
    const lineMat = new THREE.LineBasicMaterial({ color: rulerColor });
    const mainLine = new THREE.Line(lineGeo, lineMat);
    rulerGroup.add(mainLine);

    // End Ticks
    const addTick = (pos) => {
        const tStart = pos.clone().add(right.clone().multiplyScalar(-tickSize / 2));
        const tEnd = pos.clone().add(right.clone().multiplyScalar(tickSize / 2));
        const tGeo = new THREE.BufferGeometry().setFromPoints([tStart, tEnd]);
        const tLine = new THREE.Line(tGeo, lineMat);
        rulerGroup.add(tLine);
    };

    addTick(startRuler);
    addTick(endRuler);

    // Text Label (Replacing old HTML label or supplementing? Let's use Sprite or reuse HTML)
    // The user asked for "displayed like a ruller". Text on 3D canvas is tricky without HTML.
    // We already have HTML tooltip. Let's Enhance UpdateTooltip instead of 3D text for now?
    // Or maybe add simple ticks every meter?

    // Add meter ticks
    if (dist > 1) {
        const fullMeters = Math.floor(dist);
        for (let i = 1; i <= fullMeters; i++) {
            const tickPos = startRuler.clone().add(dir.clone().multiplyScalar(i));
            // Smaller tick for meters
            const tStart = tickPos.clone().add(right.clone().multiplyScalar(-tickSize / 3));
            const tEnd = tickPos.clone().add(right.clone().multiplyScalar(tickSize / 3));
            const tGeo = new THREE.BufferGeometry().setFromPoints([tStart, tEnd]);
            const tLine = new THREE.Line(tGeo, new THREE.LineBasicMaterial({ color: rulerColor }));
            rulerGroup.add(tLine);
        }
    }
}

function updateTooltip(screenX, screenY, targetPos) {
    const tooltip = document.getElementById('drawing-input-tooltip');
    if (!tooltip) return;

    const valSpan = document.getElementById('drawing-val');

    // Remove hidden class (which has !important) instead of setting display
    tooltip.classList.remove('hidden');

    // Offset slightly more to not cover cursor
    tooltip.style.left = (screenX + 20) + 'px';
    tooltip.style.top = (screenY + 20) + 'px';
    tooltip.style.zIndex = '9999'; // Ensure it's on top of everything

    let text = "";
    // Always show input prompt
    if (currentInput.length > 0) {
        text = `> ${currentInput}_`; // Command-line style input
        tooltip.style.borderColor = 'var(--highlight-color)';
        tooltip.style.borderWidth = '2px';
        tooltip.style.backgroundColor = 'rgba(0, 0, 0, 0.9)'; // Darker background for input mode
    } else if (points.length > 0) {
        const dist = targetPos.distanceTo(points[points.length - 1]);
        text = `L: ${dist.toFixed(2)}m`; // Concise length
        tooltip.style.borderColor = 'var(--text-secondary)';
        tooltip.style.borderWidth = '1px';
        tooltip.style.backgroundColor = 'var(--panel-bg)';
    } else {
        text = "Start";
        tooltip.style.borderColor = 'var(--text-secondary)';
        tooltip.style.borderWidth = '1px';
        tooltip.style.backgroundColor = 'var(--panel-bg)';
    }

    if (!isSnappingEnabled) {
        text += " [NoSnap]";
    }
    if (!isOrthoLockEnabled) {
        text += " [Free]";
    }

    valSpan.textContent = text;
    valSpan.style.whiteSpace = 'pre';
}

function onClick(e) {
    if (!isDrawing) return;
    const target = cursorMarker.position.clone();

    console.log(`Click at (${target.x.toFixed(2)}, ${target.z.toFixed(2)}), points: ${points.length}`);

    // Check for closing loop
    if (points.length > 2) {
        const distToStart = target.distanceTo(points[0]);
        console.log(`Distance to start: ${distToStart.toFixed(2)}`);
        // Increased threshold for easier closing
        if (distToStart < 0.8) {
            console.log("Closing loop - calling finishDrawing");
            finishDrawing();
            return;
        }
    }

    addPoint(target);
}

function onDoubleClick(e) {
    if (!isDrawing) return;
    console.log("Double-click detected - calling finishDrawing");
    e.stopPropagation();
    e.preventDefault();
    finishDrawing();
}

function addPoint(pt) {
    // Prevent duplicate points
    if (points.length > 0 && pt.distanceTo(points[points.length - 1]) < 0.01) return;

    points.push(pt);

    // Create permanent WALL VISUALIZATION for this segment
    if (points.length > 1) {
        const p1 = points[points.length - 2];
        const p2 = points[points.length - 1];

        const dist = p1.distanceTo(p2);
        const thickness = 0.2;

        const angle = -Math.atan2(p2.z - p1.z, p2.x - p1.x);
        const midX = (p1.x + p2.x) / 2;
        const midZ = (p1.z + p2.z) / 2;

        const segmentColor = getThemeContrastColor(); // Permanent wall color (e.g. white or dark grey)

        // Use BoxGeometry for consistent thick wall look
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const material = new THREE.MeshBasicMaterial({
            color: segmentColor,
            transparent: true,
            opacity: 0.8 // More opaque than preview
        });

        const segment = new THREE.Mesh(geometry, material);

        // Transform (show raw drawn length, no extension during drawing phase)
        segment.position.set(midX, 0, midZ);
        segment.rotation.y = angle;
        segment.scale.set(dist, 0.1, thickness);
        segment.renderOrder = 997;

        tempGroup.add(segment);

        // Add Persistent Label (Length)
        addSegmentLabel(p1, p2, dist);
    }

    // Add Start Marker if first point
    if (points.length === 1) {
        const startColor = getThemeDrawingColor();
        startMarker = new THREE.Mesh(
            new THREE.SphereGeometry(0.3, 16, 16),
            new THREE.MeshBasicMaterial({ color: startColor, depthTest: false, depthWrite: false })
        );
        startMarker.position.copy(pt);
        startMarker.renderOrder = 1000;
        tempGroup.add(startMarker);
    }

    // Reset input
    currentInput = "";

    // Clear Active Preview Line
    if (activeLine) {
        tempGroup.remove(activeLine);
        activeLine = null;
    }

    // Clear Ruler
    if (rulerGroup) {
        // Keep ruler? No, usually ruler is only for active segment.
        while (rulerGroup.children.length > 0) rulerGroup.remove(rulerGroup.children[0]);
    }
}

function onKeyDown(e) {
    if (!isDrawing) return;

    // Handle Numeric Input & Control Keys
    // We use stopPropagation to prevent global shortcuts (like View switching) from firing
    const isNumber = (e.key >= '0' && e.key <= '9') || e.key === '.';
    const isControl = e.key === 'Backspace' || e.key === 'Enter' || e.key === 'Escape' || e.key.toLowerCase() === 's' || e.key.toLowerCase() === 'o';

    if (isNumber || isControl) {
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (e.key !== 'Escape') e.preventDefault(); // Allow Escape to bubble if needed, but usually we handle it
    }

    // Snapping Toggle
    if (e.key.toLowerCase() === 's') {
        isSnappingEnabled = !isSnappingEnabled;
        // Force tooltip update
        import('./ui.js').then(({ showAlert }) => showAlert(`Snapping ${isSnappingEnabled ? 'Enabled' : 'Disabled'}`, 'Info', 1000));
        return;
    }

    // Ortho Lock Toggle (allows diagonal drawing when disabled)
    if (e.key.toLowerCase() === 'o') {
        isOrthoLockEnabled = !isOrthoLockEnabled;
        import('./ui.js').then(({ showAlert }) => showAlert(`Ortho Lock ${isOrthoLockEnabled ? 'Enabled (H/V only)' : 'Disabled (Free Draw)'}`, 'Info', 1000));
        return;
    }

    // Numeric Input
    if (isNumber) {
        currentInput += e.key;
        // Visual update happens in onMouseMove or we force it here
        const tooltip = document.getElementById('drawing-input-tooltip');
        if (tooltip) {
            // Force update
            document.getElementById('drawing-val').textContent = `> ${currentInput}_`;
            tooltip.style.borderColor = 'var(--highlight-color)';
            tooltip.style.borderWidth = '2px';
            tooltip.style.backgroundColor = 'rgba(0, 0, 0, 0.9)';
        }
    }
    else if (e.key === 'Backspace') {
        currentInput = currentInput.slice(0, -1);
        // Force update
        const tooltip = document.getElementById('drawing-input-tooltip');
        if (tooltip && currentInput.length > 0) {
            document.getElementById('drawing-val').textContent = `> ${currentInput}_`;
        } else if (tooltip) {
            // Revert to default text (will be updated on next mouse move, but let's reset)
            document.getElementById('drawing-val').textContent = "Type number";
            tooltip.style.borderColor = 'var(--text-secondary)';
            tooltip.style.backgroundColor = 'var(--panel-bg)';
        }
    }
    else if (e.key === 'Enter') {
        if (currentInput.length > 0 && points.length > 0) {
            // Calculate point based on direction and typed length
            const last = points[points.length - 1];
            const cursor = cursorMarker.position;

            const direction = new THREE.Vector3().subVectors(cursor, last).normalize();

            // Fallback if cursor is exactly on last point (no direction)
            if (direction.lengthSq() === 0) return;

            const dist = parseFloat(currentInput);
            const newPt = last.clone().add(direction.multiplyScalar(dist));

            addPoint(newPt);
        } else if (isDrawingPartition && points.length >= 2) {
            // Finish drawing on Enter if not inputting value
            finishDrawing();
        }
    }
    else if (e.key === 'Escape') {
        cancelDrawing();
    }
}

function finishDrawing() {
    if (!isDrawing) return; // Prevent double calls

    if (points.length < 3 && !isDrawingPartition) {
        import('./ui.js').then(({ showAlert }) => showAlert("You need at least 3 points to create a room.", "Error"));
        return;
    }

    if (isDrawingPartition) {
        if (points.length < 2) return;

        console.log("Finishing partition chain");
        const h = getCustomRoomHeight();
        const t = 0.1; // Default partition thickness

        for (let i = 0; i < points.length - 1; i++) {
            addCustomPartition(points[i], points[i + 1], h, t);
        }

        // Reset for next chain
        points = [];
        cleanupHelpers(true); // partial cleanup (keep listeners)
        import('./ui.js').then(({ showAlert }) => showAlert("Partition created. Draw next or Esc to exit.", "Success"));
        return;
    }

    isDrawing = false;
    const tooltip = document.getElementById('drawing-input-tooltip');
    if (tooltip) tooltip.classList.add('hidden');

    // Show Height Modal
    const modal = document.getElementById('draw-height-modal');
    if (modal) {
        console.log("Showing height modal");
        // Show modal by removing hidden and adding flex
        modal.classList.remove('hidden');
        modal.classList.add('flex');

        const confirmBtn = document.getElementById('draw-height-confirm');
        const cancelBtn = document.getElementById('draw-height-cancel');

        // Ensure clean listeners
        const onConfirm = () => {
            const h = parseFloat(document.getElementById('draw-height-input').value);
            const t = parseFloat(document.getElementById('draw-thickness-input').value) || 0.2;

            console.log(`Creating room with height ${h}m and thickness ${t}m`);

            // Hide modal
            modal.classList.remove('flex');
            modal.classList.add('hidden');

            cleanupHelpers();
            createCustomRoom(points, h, t); // Trigger geometry generation

            // Remove listeners
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);

            startPartitionDrawingMode();
        };

        const onCancel = () => {
            console.log("Modal cancelled");

            // Hide modal
            modal.classList.remove('flex');
            modal.classList.add('hidden');

            // Restart drawing mode
            cancelDrawing();

            // Remove listeners
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
        };

        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
    } else {
        console.error("Height modal not found!");
        cleanupHelpers();
    }
}

export function cancelDrawing(silent = false) {
    const wasPartitionMode = isDrawingPartition;
    isDrawing = false;
    isDrawingPartition = false;
    cleanupHelpers();

    if (!silent) {
        import('./ui.js').then(({ showAlert, setCustomGeometryUI, setCameraView }) => {
            if (wasPartitionMode) {
                // If we were drawing partitions, just exit to the 3D view
                // Don't restore welcome screen - room already exists
                showAlert("Partition drawing finished.", "Info");
                setCameraView('persp'); // Return to 3D perspective view
            } else {
                showAlert("Drawing cancelled.", "Info");
                setCustomGeometryUI(false); // Reset UI
                // Restore Welcome Screen only if no room was created
                const welcomeScreen = document.getElementById('welcome-screen');
                if (welcomeScreen) welcomeScreen.classList.remove('hidden');
            }
        });
    }
}

function cleanupHelpers(partial = false) {
    // Remove listeners
    const dom = getDom();
    if (!partial) {
        const canvas = dom['render-container'];
        canvas.removeEventListener('mousemove', onMouseMove);
        canvas.removeEventListener('click', onClick);
        canvas.removeEventListener('dblclick', onDoubleClick);
        canvas.removeEventListener('contextmenu', onContextMenu);
        window.removeEventListener('keydown', onKeyDown, true);
        window.removeEventListener('resize', onWindowResize);
        controls.removeEventListener('change', updateAllLabels);

        // Restore controls
        controls.enableRotate = true;
        controls.enabled = true;

        if (controls.userData && controls.userData.originalMouseButtons) {
            controls.mouseButtons = { ...controls.userData.originalMouseButtons };
            delete controls.userData.originalMouseButtons;
        } else {
            controls.mouseButtons = {
                LEFT: THREE.MOUSE.ROTATE,
                MIDDLE: THREE.MOUSE.DOLLY,
                RIGHT: THREE.MOUSE.PAN
            };
        }

        // Hide tooltip
        const tooltip = document.getElementById('drawing-input-tooltip');
        if (tooltip) tooltip.classList.add('hidden');
    }

    // Clear temp geometry
    while (tempGroup.children.length > 0) {
        tempGroup.remove(tempGroup.children[0]);
    }

    // Clear refs (but keep marker if partial?)
    // Actually simpler to just rebuild marker in start/partial logic if needed
    // But cursorMarker is useful.
    if (partial && cursorMarker) {
        // Keep cursorMarker, remove others
        // Iterate backwards
        for (let i = tempGroup.children.length - 1; i >= 0; i--) {
            const c = tempGroup.children[i];
            if (c !== cursorMarker) tempGroup.remove(c);
        }
    } else {
        activeLine = null;
        cursorMarker = null;
        startMarker = null;
        rulerGroup = null;
    }

    // Remove labels always on reset
    segmentLabelData.forEach(item => item.div.remove());
    segmentLabelData = [];
}

function addSegmentLabel(p1, p2, length) {
    const div = document.createElement('div');
    // Use theme-aware colors for label
    div.className = 'absolute text-xs px-2 py-1 rounded pointer-events-none font-semibold';
    div.style.backgroundColor = 'var(--bg-selection)';
    div.style.color = 'var(--text-on-selection)';
    div.style.border = '1px solid var(--highlight-color)';
    div.textContent = length.toFixed(2) + 'm';
    document.body.appendChild(div);

    segmentLabelData.push({ div, p1, p2 });

    // Initial position update
    updateLabelPosition(div, p1, p2);
}

function updateAllLabels() {
    segmentLabelData.forEach(item => {
        updateLabelPosition(item.div, item.p1, item.p2);
    });
}

function updateLabelPosition(div, p1, p2) {
    if (!div) return;
    const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
    mid.project(activeCamera);

    const x = (mid.x * .5 + .5) * window.innerWidth;
    const y = (-(mid.y * .5) + .5) * window.innerHeight;

    div.style.left = x + 'px';
    div.style.top = y + 'px';
    div.style.transform = 'translate(-50%, -50%)';
}

// Helper functions to get theme-aware colors
function getThemeDrawingColor() {
    try {
        // For markers, we can still use highlight color, but ensure it's visible
        const style = getComputedStyle(document.documentElement);
        const highlightRgb = style.getPropertyValue('--highlight-rgb').trim();

        if (!highlightRgb) {
            // Fallback to a bright cyan color
            return new THREE.Color(0x00d9ff);
        }

        const [r, g, b] = highlightRgb.split(',').map(val => parseInt(val.trim()) / 255);

        // Validate that we got valid numbers
        if (isNaN(r) || isNaN(g) || isNaN(b)) {
            return new THREE.Color(0x00d9ff);
        }

        return new THREE.Color(r, g, b);
    } catch (error) {
        console.warn('Failed to get theme drawing color, using fallback:', error);
        return new THREE.Color(0x00d9ff);
    }
}

function getThemeContrastColor() {
    try {
        // Use --text-primary-rgb for maximum contrast against background
        const style = getComputedStyle(document.documentElement);
        const textRgb = style.getPropertyValue('--text-primary-rgb').trim();

        if (!textRgb) {
            // Fallback to white
            return new THREE.Color(0xffffff);
        }

        const [r, g, b] = textRgb.split(',').map(val => parseInt(val.trim()) / 255);

        // Validate that we got valid numbers
        if (isNaN(r) || isNaN(g) || isNaN(b)) {
            return new THREE.Color(0xffffff);
        }

        return new THREE.Color(r, g, b);
    } catch (error) {
        console.warn('Failed to get theme contrast color, using fallback:', error);
        return new THREE.Color(0xffffff);
    }
}
