// scripts/hdrViewer.js

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { getNewZIndex, ensureWindowInView } from './ui.js';


// --- MODULE STATE ---
let scene, camera, renderer, material, planeMesh, controls;
let glareOverlayContainer;
let domElements = {};
let currentTexture = null;
// Glare source markers, kept in module state so they can be re-projected whenever the
// camera moves. Each entry is { el, x, y } where x/y are plane-space coordinates.
let glareMarkers = [];
let animationFrameId = null;

/**
 * Throttles a function so it's called at most once per limit milliseconds.
 * @param {Function} func The function to throttle.
 * @param {number} limit The throttle interval in milliseconds.
 */
function throttle(func, limit) {
    let inThrottle;
    return function(...args) {
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// --- SHADERS ---
const vertexShader = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const fragmentShader = `
    uniform sampler2D hdrTexture;
    uniform float exposure;
    uniform bool isFalseColor;
    varying vec2 vUv;

    // Helper to map a value from one range to another
    float mapRange(float value, float inMin, float inMax, float outMin, float outMax) {
        return outMin + (outMax - outMin) * (value - inMin) / (inMax - inMin);
    }

    // Viridis color map function (approximated)
    vec3 viridis(float t) {
        t = clamp(t, 0.0, 1.0);
        vec3 c = vec3(0.267, 0.005, 0.329);
        vec3 s = vec3(2.55, 2.51, 2.05);
        vec3 a = vec3(0.21, 0.96, 0.22);
        vec3 b = vec3(0.5, 0.49, 0.5);
        vec3 d = vec3(1.13, 0.25, 1.95);
        return c + s * cos(6.28318 * (a * t + b)) * d;
    }

    void main() {
        vec3 hdrColor = texture2D(hdrTexture, vUv).rgb;
        hdrColor *= pow(2.0, exposure);

        if (isFalseColor) {
            // Convert to luminance (cd/m^2) using standard Radiance factor
            float luminance = dot(hdrColor, vec3(0.265, 0.670, 0.065)) * 179.0;
            
            // Map log10 of luminance to a 0-1 range for the color map
            // We map a typical range from 0.1 cd/m^2 (log10 = -1) to 100,000 cd/m^2 (log10 = 5)
            float logLum = log(max(0.1, luminance)) / log(10.0);
            float normalizedLum = mapRange(logLum, -1.0, 5.0, 0.0, 1.0);
            
            gl_FragColor = vec4(viridis(normalizedLum), 1.0);
        } else {
            // Simple Reinhard tone mapping
            vec3 ldrColor = hdrColor / (hdrColor + vec3(1.0));
            
            // Gamma correction
            ldrColor = pow(ldrColor, vec3(1.0 / 2.2));
            gl_FragColor = vec4(ldrColor, 1.0);
        }
    }
`;

/**
 * Maps a glare source's Ev value to a color for visualization.
 * Uses a logarithmic scale from yellow (lower severity) to red (higher severity).
 * @param {number} ev - The vertical illuminance value of the glare source.
 * @returns {string} An rgba color string.
 */
function mapEvToColor(ev) {
    const logEv = Math.log10(Math.max(1, ev));
    const minLogEv = 3; // Corresponds to Ev = 1,000
    const maxLogEv = 5; // Corresponds to Ev = 100,000

    // Normalize the log value to a 0-1 range
    const t = Math.max(0, Math.min(1, (logEv - minLogEv) / (maxLogEv - minLogEv)));

    // Interpolate green component from 255 (yellow) down to 0 (red)
    const red = 255;
    const green = Math.round(255 * (1 - t));
    const blue = 0;

    // Make more severe sources slightly more opaque
    const alpha = 0.5 + t * 0.2; 

    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

/**
 * Creates and displays semi-transparent overlays for each glare source on the HDR image.
 * @param {Array<object>} sources - An array of glare source objects from an evalglare report.
 * @param {number} imageWidth - The width of the source HDR image.
 * @param {number} imageHeight - The height of the source HDR image.
 */
function drawGlareSourcesOverlay(sources, imageWidth, imageHeight) {
    if (!glareOverlayContainer) return;
    glareOverlayContainer.innerHTML = ''; // Clear previous overlays
    glareMarkers = [];

    // If dimensions are missing, we cannot accurately place overlays.
    if (!imageWidth || !imageHeight) {
        console.warn("Glare overlay skipped: Source image dimensions were not found in the report.");
        return;
    }

    // The image is letterboxed inside the container by the orthographic camera fit and
    // can be panned and zoomed with OrbitControls, so a percentage of the CONTAINER is
    // the wrong frame: markers landed in the wrong place whenever the aspect ratios
    // differed and never moved when the view changed. Convert each source to
    // plane-space coordinates once, then project them through the camera every frame.
    const aspect = planeMesh ? planeMesh.scale.x : (imageWidth / imageHeight);

    sources.forEach(source => {
        const overlay = document.createElement('div');
        // Use a fixed size for the marker for better visibility, as source.size is not a pixel dimension.
        const markerSize = '12px';

        overlay.style.position = 'absolute';
        overlay.style.width = markerSize;
        overlay.style.height = markerSize;
        overlay.style.transform = 'translate(-50%, -50%)';
        overlay.style.borderRadius = '50%';
        overlay.style.backgroundColor = mapEvToColor(source.Ev);
        overlay.style.border = '1px solid rgba(255, 255, 255, 0.7)';
        overlay.style.boxSizing = 'border-box';

        // evalglare reports pixel positions from the top-left of the image. The plane
        // spans x in [-aspect, +aspect] and y in [+1 (top), -1 (bottom)].
        const u = source.pos.x / imageWidth;
        const v = source.pos.y / imageHeight;

        glareOverlayContainer.appendChild(overlay);
        glareMarkers.push({ el: overlay, x: (u * 2 - 1) * aspect, y: 1 - v * 2 });
    });

    updateGlareOverlayPositions();
}

/**
 * Projects every glare marker's plane-space position through the current camera and
 * places it over the canvas. Called on every rendered frame so markers track pan/zoom.
 */
function updateGlareOverlayPositions() {
    if (!glareMarkers.length || !camera || !renderer) return;

    const width = renderer.domElement.clientWidth;
    const height = renderer.domElement.clientHeight;
    if (!width || !height) return;

    const v = new THREE.Vector3();
    for (const marker of glareMarkers) {
        v.set(marker.x, marker.y, 0).project(camera);
        const inView = v.x >= -1 && v.x <= 1 && v.y >= -1 && v.y <= 1;
        marker.el.style.display = inView ? '' : 'none';
        if (!inView) continue;
        marker.el.style.left = `${(v.x * 0.5 + 0.5) * width}px`;
        marker.el.style.top = `${(-v.y * 0.5 + 0.5) * height}px`;
    }
}

/**
 * Initializes the HDR viewer scene, renderer, and event listeners.
 * Should be called once when the application starts.
 */
export function initHdrViewer() {
    const ids = ['hdr-viewer-panel', 'hdr-canvas-container', 'hdr-exposure', 'hdr-exposure-val', 'hdr-false-color-toggle', 'hdr-luminance-probe', 'hdr-luminance-value'];
    ids.forEach(id => domElements[id] = document.getElementById(id));

    // 1. Setup Three.js Scene
    scene = new THREE.Scene();
    renderer = new THREE.WebGLRenderer();
    renderer.setSize(domElements['hdr-canvas-container'].clientWidth, domElements['hdr-canvas-container'].clientHeight);
    domElements['hdr-canvas-container'].appendChild(renderer.domElement);
    
    // Create a container for glare source overlays
    glareOverlayContainer = document.createElement('div');
    glareOverlayContainer.className = 'absolute top-0 left-0 w-full h-full pointer-events-none';
    domElements['hdr-canvas-container'].appendChild(glareOverlayContainer);

    // Use an orthographic camera for a 2D view
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 1;

    // 2. Setup Shader Material and Plane Mesh
    material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
            hdrTexture: { value: null },
            exposure: { value: 0.0 },
            isFalseColor: { value: false },
        },
    });
    const geometry = new THREE.PlaneGeometry(2, 2);
    planeMesh = new THREE.Mesh(geometry, material);
    scene.add(planeMesh);

    // 3. Setup Controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableRotate = false; // Allow pan and zoom only
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;

    // 4. Setup Event Listeners
    domElements['hdr-exposure'].addEventListener('input', (e) => {
        const exposureValue = parseFloat(e.target.value);
        material.uniforms.exposure.value = exposureValue;
        domElements['hdr-exposure-val'].textContent = exposureValue.toFixed(1);
    });

    domElements['hdr-false-color-toggle'].addEventListener('change', (e) => {
        material.uniforms.isFalseColor.value = e.target.checked;
    });

    // Create a throttled version of the probe function to limit calls to 10 per second.
    const throttledUpdateProbe = throttle(updateLuminanceProbe, 100);

    domElements['hdr-canvas-container'].addEventListener('mousemove', throttledUpdateProbe);

    domElements['hdr-canvas-container'].addEventListener('mouseleave', () => {
        domElements['hdr-luminance-probe'].classList.add('hidden');
    });
    
    // Handle resizing of the viewer window
    const resizeObserver = new ResizeObserver(entries => {
        const entry = entries[0];
        const { width, height } = entry.contentRect;
        if (width === 0 || height === 0) return;

        renderer.setSize(width, height);

        // Update camera to maintain aspect ratio and prevent distortion
        const textureAspect = planeMesh.scale.x; // Aspect is stored in the plane's x-scale
        const canvasAspect = width / height;

        if (textureAspect > canvasAspect) {
            // Canvas is taller than the image, so width is the constraint
            camera.left = -textureAspect;
            camera.right = textureAspect;
            camera.top = textureAspect / canvasAspect;
            camera.bottom = -textureAspect / canvasAspect;
        } else {
            // Canvas is wider than the image, so height is the constraint
            camera.left = -canvasAspect * 1; // 1 is the plane's height
            camera.right = canvasAspect * 1;
            camera.top = 1;
            camera.bottom = -1;
        }
        camera.updateProjectionMatrix();
    });
    resizeObserver.observe(domElements['hdr-canvas-container']);

    // Resume the render loop whenever the panel is un-hidden by any code path, not just
    // by openHdrViewer().
    if (domElements['hdr-viewer-panel']) {
        new MutationObserver(() => startRenderLoop())
            .observe(domElements['hdr-viewer-panel'], { attributes: true, attributeFilter: ['class'] });
    }

    // Start the viewer's render loop (a no-op while the panel is still hidden).
    startRenderLoop();
}

/**
* Reads pixel data from the HDR texture based on the mouse position to display luminance.
* This function is throttled to improve performance.
* @param {MouseEvent} e - The mousemove event.
*/
function updateLuminanceProbe(e) {
    if (!currentTexture || !material.uniforms.isFalseColor.value) {
        domElements['hdr-luminance-probe'].classList.add('hidden');
        return;
    }

    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2();
    // Normalize mouse coordinates to [-1, 1] range for raycasting
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    // Use a raycaster to find the precise UV coordinate on the plane
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(planeMesh);

    if (intersects.length > 0) {
        const uv = intersects[0].uv;
        if (!uv) return;

        // Read pixel data from the original texture.
        // HDR image rows are stored top-down, while UV y originates at the bottom,
        // so flip the row index to sample the pixel that is actually displayed.
        const width = currentTexture.image.width;
        const height = currentTexture.image.height;
        const x = Math.min(width - 1, Math.floor(uv.x * width));
        const y = Math.min(height - 1, Math.floor((1 - uv.y) * height));
        const index = (y * width + x) * 4;
        const pixelData = currentTexture.image.data;
        if (!pixelData || index + 2 >= pixelData.length) return;

        // three's HDRLoader defaults to HalfFloatType, which allocates a Uint16Array of
        // half-float BIT PATTERNS: a true radiance of 1.0 is stored as 0x3C00 = 15360
        // and would be reported as ~2.7e6 cd/m2 if read as a linear float. Decode when
        // the backing array is 16-bit, and pass Float32/Float64 data straight through so
        // the probe is correct whichever type the loader was configured with.
        const decode = (pixelData instanceof Uint16Array || pixelData instanceof Int16Array)
            ? (v) => THREE.DataUtils.fromHalfFloat(v)
            : (v) => v;

        const r = decode(pixelData[index]);
        const g = decode(pixelData[index + 1]);
        const b = decode(pixelData[index + 2]);

        const exposedColor = new THREE.Vector3(r, g, b).multiplyScalar(Math.pow(2.0, material.uniforms.exposure.value));
        const luminance = exposedColor.dot(new THREE.Vector3(0.265, 0.670, 0.065)) * 179.0;

        domElements['hdr-luminance-value'].textContent = luminance.toExponential(2);

        // Position the probe element next to the cursor
        const probe = domElements['hdr-luminance-probe'];
        probe.style.left = `${e.clientX - rect.left + 15}px`;
        probe.style.top = `${e.clientY - rect.top + 15}px`;
        probe.classList.remove('hidden');
    } else {
        domElements['hdr-luminance-probe'].classList.add('hidden');
    }
}

/**
 * Opens the HDR viewer panel and displays the provided texture, optionally with glare overlays.
 * @param {THREE.DataTexture} texture - The HDR texture to display.
 * @param {object|null} [glareResult=null] - Optional parsed glare result from evalglare.
 */
/**
 * Sets the HDR viewer exposure by driving the existing exposure control, so the
 * slider, its readout and the shader uniform stay in sync. Imported by the
 * configureHdrViewer agent tool, which previously destructured a name this
 * module never exported and threw "setHdrExposure is not a function".
 * @param {number} value - Exposure in stops.
 */
export function setHdrExposure(value) {
    const el = domElements['hdr-exposure'];
    if (!el) throw new Error('HDR viewer is not open, so exposure cannot be set.');
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Turns the false-colour overlay on or off through its existing toggle.
 * @param {boolean} enabled
 */
export function toggleHdrFalseColor(enabled) {
    const el = domElements['hdr-false-color-toggle'];
    if (!el) throw new Error('HDR viewer is not open, so false colour cannot be toggled.');
    if (el.checked !== !!enabled) {
        el.checked = !!enabled;
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }
}

export function openHdrViewer(texture, glareResult = null) {
    if (!texture) {
        console.error("HDR Viewer: No texture provided.");
        return;
    }
    if (!scene || !camera || !renderer || !material || !planeMesh || !controls) {
        console.error("HDR Viewer: Viewer has not been initialized. Call initHdrViewer() before openHdrViewer().");
        return;
    }
    // Release the GPU/CPU memory of the previously displayed image before replacing it.
    if (currentTexture && currentTexture !== texture) {
        disposeTextureIfUnowned(currentTexture);
    }
    currentTexture = texture;
    if (glareOverlayContainer) {
        glareOverlayContainer.innerHTML = ''; // Clear previous overlays
    }
    glareMarkers = [];

    // Update shader with new texture
    material.uniforms.hdrTexture.value = texture;
    material.needsUpdate = true;

    // Adjust camera and plane to match texture aspect ratio
    const aspect = texture.image.width / texture.image.height;
    planeMesh.scale.set(aspect, 1, 1);
    camera.left = -aspect;
    camera.right = aspect;
    camera.updateProjectionMatrix();
    controls.reset();

   // If glare results are provided, draw the overlays
   if (glareResult && glareResult.sources && glareResult.sources.length > 0) {
        // The loaded texture is the authoritative source of the image dimensions the
        // evalglare pixel positions refer to. The report's own width/height are only a
        // fallback (and are approximate when they came from rpict's -x/-y maxima).
        const imageWidth = texture.image?.width || glareResult.imageWidth;
        const imageHeight = texture.image?.height || glareResult.imageHeight;
        drawGlareSourcesOverlay(glareResult.sources, imageWidth, imageHeight);
    }

    // Show the panel
    domElements['hdr-viewer-panel'].classList.remove('hidden');
    domElements['hdr-viewer-panel'].style.zIndex = getNewZIndex();
    ensureWindowInView(domElements['hdr-viewer-panel']);

    startRenderLoop();
}

/**
 * Disposes a texture the viewer has finished with, unless something else still holds
 * it. `resultsManager.hdrResult.texture` is re-opened every time the "View HDR" button
 * is pressed, so disposing it would leave that button showing a dead texture.
 * The import is dynamic to avoid a static import cycle (resultsManager -> ui -> hdrViewer).
 * @param {THREE.Texture} texture
 */
async function disposeTextureIfUnowned(texture) {
    try {
        const { resultsManager } = await import('./resultsManager.js');
        if (resultsManager?.hdrResult?.texture === texture) return;
    } catch (e) {
        // Fall through: if ownership cannot be checked, still release the memory.
    }
    texture.dispose();
}

/**
 * True when the HDR viewer panel is on screen.
 * @returns {boolean}
 */
function isViewerVisible() {
    const panel = domElements['hdr-viewer-panel'];
    return !!panel && !panel.classList.contains('hidden');
}

/**
 * Starts the render loop if it is not already running and the panel is visible.
 */
function startRenderLoop() {
    if (animationFrameId === null && isViewerVisible()) {
        animationFrameId = requestAnimationFrame(animate);
    }
}

/**
 * The dedicated render loop for the HDR viewer.
 * It renders only while the panel is visible; when the panel is hidden the loop stops
 * entirely (a MutationObserver installed in initHdrViewer restarts it on re-show)
 * instead of burning a render every frame behind a hidden panel.
 */
function animate() {
    if (!isViewerVisible()) {
        animationFrameId = null;
        return;
    }
    animationFrameId = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
    updateGlareOverlayPositions();
}
