// scripts/scene.js

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { roomObject, shadingObject, sensorGridObject, axesObject, northArrowObject, groundObject, wallSelectionGroup } from './geometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/**
 * Debounce utility to limit the rate at which a function gets called.
 * @param {Function} func The function to debounce.
 * @param {number} delay The delay in milliseconds.
 * @returns {Function} The debounced function.
 */
function debounce(func, delay) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), delay);
    };
}

export let composer, fisheyePass;

// --- MODULE-LEVEL VARIABLES ---
// Set the default coordinate system to Y-up
THREE.Object3D.DEFAULT_UP.set(0, 1, 0);
let renderPass; 

// Flag to manage camera update source and prevent feedback loops
export let isUpdatingCameraFromSliders = false;
export function setUpdatingFromSliders(value) {
    isUpdatingCameraFromSliders = value;
}

// --- EXPORTED VARIABLES ---
export let scene, perspectiveCamera, orthoCamera, activeCamera, renderer, labelRenderer, controls;
export let viewpointCamera, viewCamHelper, transformControls, fpvOrthoCamera, sensorTransformControls;
export let sunRayObject;
export let horizontalClipPlane, verticalClipPlane;
export let daylightingSensorsGroup;
export let isFirstPersonView = false;
export let currentViewType = 'v'; // Default to perspective
let preFpvCamera; // To store the camera state before entering FPV

// --- CORE FUNCTIONS ---

/**
 * Fisheye GLSL shader object for post-processing.
 * This distorts a standard perspective render into a fisheye view.
 */
const FisheyeShader = {
    uniforms: {
        'tDiffuse': { value: null }, // The texture of the rendered scene
        'strength': { value: 0.8 },  // How strong the fisheye effect is
        'aspect':   { value: 1.0 }   // The aspect ratio of the viewport
    },
    vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
    fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform float strength;
        uniform float aspect;
        varying vec2 vUv;

        void main() {
            // Center the UV coordinates
            vec2 centeredUv = vUv - 0.5;

            // Correct for aspect ratio to make the effect circular
            centeredUv.x *= aspect;

            // Calculate the distance from the center and apply the distortion
            float dist = length(centeredUv);
            float r = atan(dist * strength) / atan(strength);
            
            vec2 distortedUv = normalize(centeredUv) * r;

            // Un-correct the aspect ratio
            distortedUv.x /= aspect;

            // Un-center the UVs
            distortedUv += 0.5;
            
            // Sample the original scene texture at the new, distorted coordinates
            // and handle edge cases where the coordinate is outside the [0,1] range.
            if (distortedUv.x > 0.0 && distortedUv.x < 1.0 && distortedUv.y > 0.0 && distortedUv.y < 1.0) {
                 gl_FragColor = texture2D(tDiffuse, distortedUv);
            } else {
                 gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); // Black for outside the fisheye circle
            }
        }`
};

/**
* Sets up the entire Three.js scene, including cameras, renderers, and controls.
*/
export function setupScene(container) {
    if (!container) {
        console.error("Render container not found!");
        return;
    }

    // 1. Scene Initialization
    scene = new THREE.Scene();
    scene.background = new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--bg-main').trim());

    // 2. Camera Setup
    _setupCameras(container);

    // 3. Renderer Setup
    _setupRenderers(container);
    
    // 4. Post-Processing Composer Setup
    composer = new EffectComposer(renderer);
    renderPass = new RenderPass(scene, perspectiveCamera); // Use perspective as the base
    composer.addPass(renderPass);

    fisheyePass = new ShaderPass(FisheyeShader);
    fisheyePass.enabled = false; // Disabled by default
    composer.addPass(fisheyePass);

    // 5. Controls Setup
    _setupControls(renderer.domElement);
    
    // 6. Helpers & Gizmos Setup
    _setupHelpersAndGizmos();

    // 7. Daylighting Sensor Group Setup
    daylightingSensorsGroup = new THREE.Group();
    daylightingSensorsGroup.name = 'DaylightingControlSensors';

    // 8. Clipping Plane Setup
    horizontalClipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
    verticalClipPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);

    // 9. Add Geometry Groups to Scene
    sunRayObject = new THREE.Group();
    sunRayObject.name = 'SunRays';
    scene.add(roomObject, shadingObject, sensorGridObject, axesObject, northArrowObject, groundObject, daylightingSensorsGroup, wallSelectionGroup, sunRayObject);

    // 10. Signal that the scene is initialized and ready for interaction.
    container.dispatchEvent(new CustomEvent('sceneReady', { bubbles: true }));
}


/**
* The main animation loop, called every frame to render the scene.
*/
export function animate() {
    requestAnimationFrame(animate);

    // The composer's active camera is now managed by other functions,
    // so we can just render it. This ensures effects like fisheye always work.
    composer.render();

    // The label renderer now simply uses the globally active camera,
    // which is correctly managed by toggleFirstPersonView and setActiveCamera.
    labelRenderer.render(scene, activeCamera);

    if (controls.enabled) {
        controls.update();
    }
}

/**
 * Handles window resize events to keep the camera and renderer updated.
 */
export function onWindowResize() {
    if (!renderer) return;
    const container = renderer.domElement.parentElement;
    if (!container || container.clientWidth === 0 || container.clientHeight === 0) return;

    const aspect = container.clientWidth / container.clientHeight;

    // Update perspective camera
    perspectiveCamera.aspect = aspect;
    perspectiveCamera.updateProjectionMatrix();

    // Update orthographic camera
    const frustumSize = 15;
    orthoCamera.left = frustumSize * aspect / -2;
    orthoCamera.right = frustumSize * aspect / 2;
    orthoCamera.top = frustumSize / 2;
    orthoCamera.bottom = frustumSize / -2;
    orthoCamera.updateProjectionMatrix();

    // Update FPV orthographic camera
    fpvOrthoCamera.left = frustumSize * aspect / -2;
    fpvOrthoCamera.right = frustumSize * aspect / 2;
    fpvOrthoCamera.top = frustumSize / 2;
    fpvOrthoCamera.bottom = frustumSize / -2;
    fpvOrthoCamera.updateProjectionMatrix();
    
    if (viewpointCamera) {
        viewpointCamera.aspect = aspect;
        viewpointCamera.updateProjectionMatrix();
    }

    renderer.setSize(container.clientWidth, container.clientHeight);
    labelRenderer.setSize(container.clientWidth, container.clientHeight);

    // Update composer and shader uniforms
    composer.setSize(container.clientWidth, container.clientHeight);
    fisheyePass.uniforms['aspect'].value = aspect;
}

/**
 * Sets the currently active camera for the main viewport and updates controls.
 * @param {THREE.Camera} newCamera The camera to make active.
 */
export function setActiveCamera(newCamera) {
    activeCamera = newCamera;
    controls.object = activeCamera;
    transformControls.camera = activeCamera;
    if (sensorTransformControls) sensorTransformControls.camera = activeCamera;

    // This ensures the post-processing composer always uses the currently active camera.
    if (renderPass) {
        renderPass.camera = activeCamera;
    }
}

/**
* Updates the viewpoint camera's properties based on values from the UI.
* This function centralizes scene manipulation logic, called by the UI layer.
* @param {object} params - An object containing viewpoint parameters.
*/
export function updateViewpointFromUI(params) {
    if (!viewpointCamera || !viewCamHelper) return;

    const { W, L, vpx, vpy, vpz, vdx, vdy, vdz, fov, dist } = params;
    
    const pos = new THREE.Vector3(vpx, vpy, vpz);
    const localDir = new THREE.Vector3(vdx, vdy, vdz);

    // Prevent normalization of a zero vector, which results in NaNs
    if (localDir.lengthSq() === 0) {
        localDir.set(0, 0, -1); // Default to looking along negative Z in local space
    }

    // Convert UI's corner-based coordinates to the scene's center-based world coordinates
    const worldPos = new THREE.Vector3(pos.x - W / 2, pos.y, pos.z - L / 2);
    
    // Rotate the local direction vector by the room's current rotation to get the world direction
    const localDirNormalized = localDir.clone().normalize();

    // Create a quaternion representing the desired local rotation for the camera
    // (i.e., rotating the default forward vector -Z to the desired local direction).
    const localQuaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), localDirNormalized);

    // The final world rotation is the room's rotation followed by the camera's local rotation.
    const finalWorldQuaternion = roomObject.quaternion.clone().multiply(localQuaternion);

    // Apply the final calculated position and rotation.
    viewpointCamera.position.copy(worldPos);
    viewpointCamera.quaternion.copy(finalWorldQuaternion);
    viewpointCamera.fov = fov;
    viewpointCamera.far = dist;
    viewpointCamera.updateProjectionMatrix();
    viewCamHelper.update();
}

/**
* Sets the visibility of the viewpoint gizmo and its helper.
* @param {boolean} isVisible - True to show the gizmo, false to hide it.
*/
export function setGizmoVisibility(isVisible) {
    if (!transformControls || !viewCamHelper) return;
    transformControls.visible = isVisible;
    transformControls.enabled = isVisible;
    viewCamHelper.visible = isVisible;
}

/**
* Sets the mode for the transform controls gizmo ('translate' or 'rotate').
* @param {string} mode - The desired gizmo mode.
*/
export function setGizmoMode(mode) {
    if (transformControls) {
        transformControls.setMode(mode);
    }
}

// --- HELPER FUNCTIONS for setupScene ---

/**
 * Initializes and configures all cameras.
 * @param {HTMLElement} container - The DOM element for aspect ratio calculation.
 * @private
 */
function _setupCameras(container) {
    const aspect = container.clientWidth / container.clientHeight;
    const frustumSize = 15;

    const initialCameraPosition = new THREE.Vector3(5, 5, 10);

    // Perspective Camera (for 3D views)
    perspectiveCamera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
    perspectiveCamera.position.copy(initialCameraPosition);

    // Orthographic Camera (for 2D views like Top, Front, etc.)
    orthoCamera = new THREE.OrthographicCamera(frustumSize * aspect / -2, frustumSize * aspect / 2, frustumSize / 2, frustumSize / -2, 0.1, 1000);
    orthoCamera.position.copy(initialCameraPosition);
    
    // Viewpoint Camera (for first-person view and Radiance renderings)
    viewpointCamera = new THREE.PerspectiveCamera(60, 1, 0.1, 50);

    // Set the initial active camera
    activeCamera = perspectiveCamera;

    // Orthographic Camera for FPV mode when "Parallel" is selected
    fpvOrthoCamera = new THREE.OrthographicCamera(frustumSize * aspect / -2, frustumSize * aspect / 2, frustumSize / 2, frustumSize / -2, 0.1, 1000);
    fpvOrthoCamera.zoom = 0.2; // A sensible default zoom for FPV ortho
}

/**
 * Initializes and configures WebGL and CSS2D renderers.
 * @param {HTMLElement} container - The DOM element to append the renderers to.
 * @private
 */
function _setupRenderers(container) {
    // Main WebGL renderer for 3D objects
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.localClippingEnabled = true;
    container.appendChild(renderer.domElement);

    // CSS2D renderer for HTML-based labels
    labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(container.clientWidth, container.clientHeight);
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.top = '0px';
    labelRenderer.domElement.style.pointerEvents = 'none';
    container.appendChild(labelRenderer.domElement);
}

/**
 * Initializes and configures OrbitControls and TransformControls.
 * @param {HTMLElement} domElement - The canvas element for event listeners.
 * @private
 */
function _setupControls(domElement) {
    // OrbitControls for navigating the scene
    controls = new OrbitControls(activeCamera, domElement);
    controls.enableDamping = true;

    // TransformControls for moving/rotating the viewpoint gizmo
    transformControls = new TransformControls(activeCamera, domElement);
    transformControls.addEventListener('dragging-changed', (event) => {
        controls.enabled = !event.value; // Disable orbit controls while dragging the gizmo
    });
    // This listener clamps the camera and notifies the UI to update the sliders,
    // but uses the isUpdatingCameraFromSliders flag to prevent feedback loops.
    // Use immediate updates for better responsiveness during dragging.
        transformControls.addEventListener('objectChange', () => {
            if (isUpdatingCameraFromSliders) return; // Prevent feedback loop

            if (renderer && viewpointCamera && roomObject) {
                const roomBox = new THREE.Box3().setFromObject(roomObject);
                const roomSize = new THREE.Vector3();
                roomBox.getSize(roomSize);

                // Clamp world position to keep gizmo inside room boundaries
                viewpointCamera.position.x = THREE.MathUtils.clamp(viewpointCamera.position.x, -roomSize.x / 2, roomSize.x / 2);
                viewpointCamera.position.y = THREE.MathUtils.clamp(viewpointCamera.position.y, 0, roomSize.y);
            viewpointCamera.position.z = THREE.MathUtils.clamp(viewpointCamera.position.z, -roomSize.z / 2, roomSize.z / 2);

            // Dispatch a custom event on the renderer's DOM element that the UI can listen to.
            // This re-establishes the link for updating sliders from the gizmo.
            renderer.domElement.dispatchEvent(new CustomEvent('gizmoUpdated', { bubbles: true }));
        }
    });

    // TransformControls for the daylighting sensor
    sensorTransformControls = new TransformControls(activeCamera, domElement);
    sensorTransformControls.addEventListener('dragging-changed', (event) => {
        controls.enabled = !event.value;
    });
    // The 'objectChange' listener is added in ui.js where it has access to the DOM
}

/**
 * Creates and adds helper objects and gizmos to the scene.
 * @private
 */
function _setupHelpersAndGizmos() {
    // Add the viewpoint camera to the scene so we can see its gizmo
    scene.add(viewpointCamera);

    // Create a helper to visualize the viewpoint camera's frustum
    viewCamHelper = new THREE.CameraHelper(viewpointCamera);
    scene.add(viewCamHelper);

    // Attach the transform controls to the viewpoint camera
    transformControls.attach(viewpointCamera);
    scene.add(transformControls);

    // Add the sensor transform controls to the scene (it's attached to an object later)
    scene.add(sensorTransformControls);

    // Set the gizmo to be invisible by default, matching the UI checkbox on startup.
    setGizmoVisibility(false);
}

/**
 * Updates the live view to apply a specific view type effect.
 * @param {string} viewType - The view type from the dropdown (e.g., 'h', 'v').
 */
export function updateLiveViewType(viewType) {
    if (!fisheyePass) return;
    currentViewType = viewType; // Store the current view type for the animation loop

    const isFisheye = viewType === 'h' || viewType === 'a';
    const isParallel = viewType === 'l';

    // 1. Enable the fisheye shader only for the two fisheye view types
    fisheyePass.enabled = isFisheye;

    // 2. Switch the active camera based on the required projection
    if (isParallel) {
        // The "Parallel" view type corresponds to an orthographic projection
        setActiveCamera(orthoCamera);
    } else {
        // All other views (Perspective, Fisheye, Cylindrical) use the perspective
        // camera as a base. The fisheye effect is a post-processing shader.
        setActiveCamera(perspectiveCamera);
    }
}

/**
 * Toggles the First-Person View (FPV) mode.
 * This now lives in scene.js to control rendering state directly.
 * @param {string} viewType - The currently selected view type (e.g., 'v', 'l', 'h').
 */
export function toggleFirstPersonView(viewType) {
    isFirstPersonView = !isFirstPersonView;
    const isParallel = viewType === 'l';

    controls.enabled = !isFirstPersonView;

    if (isFirstPersonView) {
        preFpvCamera = activeCamera; // Store the camera that was active before FPV
        transformControls.detach();
        if (viewCamHelper) viewCamHelper.visible = false;
        if (axesObject) axesObject.visible = false;
        // Set the FPV camera as the globally active one for all renderers
        setActiveCamera(isParallel ? fpvOrthoCamera : viewpointCamera);
    } else {
        transformControls.attach(viewpointCamera);
        if (axesObject) axesObject.visible = true;
        // Restore the camera that was active before entering FPV
        setActiveCamera(preFpvCamera || perspectiveCamera);
    }

    // Return the new state so the UI layer can handle UI updates.
    return isFirstPersonView;
}

/**
 * Captures a snapshot of the current 3D view.
 * @returns {string} A base64 encoded data URL of the canvas image.
 */
export function captureSceneSnapshot() {
    // Force a render of the current frame to ensure it's up-to-date
    composer.render();
    // Return the data URL from the main renderer's canvas
    return renderer.domElement.toDataURL('image/png');
}
