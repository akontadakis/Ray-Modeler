
// scripts/sidebar.js

import { getDom } from './dom.js';
import { makeDraggable } from './ui.js';

let isLeftSidebarDocked = localStorage.getItem('isLeftSidebarDocked') === 'true';
let isTopSidebarDocked = localStorage.getItem('isTopSidebarDocked') === 'true';

const dom = getDom();

/**
 * Initializes sidebar docking functionality, applying initial state and attaching listeners.
 */
export function initSidebar() {
    // Apply initial states
    applyInitialDockState();
    applyInitialTopDockState();

    // Attach event listeners
    dom['dock-left-sidebar-btn']?.addEventListener('click', toggleLeftSidebarDock);
    dom['dock-top-sidebar-btn']?.addEventListener('click', toggleTopSidebarDock);
}

export function toggleLeftSidebarDock() {
    isLeftSidebarDocked = !isLeftSidebarDocked;
    localStorage.setItem('isLeftSidebarDocked', isLeftSidebarDocked);
    applyInitialDockState();
}

export function applyInitialDockState() {
    const leftControls = dom['left-controls-container'];
    const dockBtn = dom['dock-left-sidebar-btn'];

    if (!leftControls || !dockBtn) return;

    const undockedIcon = dockBtn.querySelector('.dock-icon-undocked');
    const dockedIcon = dockBtn.querySelector('.dock-icon-docked');

    if (isLeftSidebarDocked) {
        document.body.classList.add('left-sidebar-docked');
        dockBtn.classList.add('active');
        leftControls.classList.add('docked');
        if (undockedIcon) undockedIcon.classList.add('hidden');
        if (dockedIcon) dockedIcon.classList.remove('hidden');

        if (leftControls._draggable) {
            leftControls._draggable.destroy();
            leftControls._draggable = null;
        }
        // Reset position for docking
        leftControls.style.transform = '';
        leftControls.style.left = '0';
        leftControls.style.top = '0'; // Should start from the top
    } else {
        document.body.classList.remove('left-sidebar-docked');
        dockBtn.classList.remove('active');
        leftControls.classList.remove('docked');
        if (undockedIcon) undockedIcon.classList.remove('hidden');
        if (dockedIcon) dockedIcon.classList.add('hidden');
        
        // Restore styles for floating. These match the initial Tailwind classes.
        leftControls.style.top = '50%';
        leftControls.style.transform = 'translateY(-50%)';
        leftControls.style.left = '1rem'; // Corresponds to left-4

        if (!leftControls._draggable) {
            makeDraggable(leftControls, leftControls);
        }
    }
}

export function toggleTopSidebarDock() {
    isTopSidebarDocked = !isTopSidebarDocked;
    localStorage.setItem('isTopSidebarDocked', isTopSidebarDocked);
    applyInitialTopDockState();
}

export function applyInitialTopDockState() {
    const viewControls = dom['view-controls'];
    const dockBtn = dom['dock-top-sidebar-btn'];

    if (!viewControls || !dockBtn) return;

    const undockedIcon = dockBtn.querySelector('.dock-icon-undocked');
    const dockedIcon = dockBtn.querySelector('.dock-icon-docked');

    if (isTopSidebarDocked) {
        document.body.classList.add('top-sidebar-docked');
        dockBtn.classList.add('active');
        viewControls.classList.add('docked');
        if (undockedIcon) undockedIcon.classList.add('hidden');
        if (dockedIcon) dockedIcon.classList.remove('hidden');

        if (viewControls._draggable) {
            viewControls._draggable.destroy();
            viewControls._draggable = null;
        }
        viewControls.style.transform = '';
        viewControls.style.top = '0';
        viewControls.style.left = ''; // Clear inline 'left' to allow CSS to take over
    } else {
        document.body.classList.remove('top-sidebar-docked');
        dockBtn.classList.remove('active');
        viewControls.classList.remove('docked');
        if (undockedIcon) undockedIcon.classList.remove('hidden');
        if (dockedIcon) dockedIcon.classList.add('hidden');

        // Restore styles for floating. These match the initial Tailwind classes.
        viewControls.style.top = '1rem'; // Corresponds to top-4
        viewControls.style.left = '50%';
        viewControls.style.transform = 'translateX(-50%)';

        if (!viewControls._draggable) {
            makeDraggable(viewControls, viewControls);
        }
    }
}

export function getIsLeftSidebarDocked() {
    return isLeftSidebarDocked;
}

export function getIsTopSidebarDocked() {
    return isTopSidebarDocked;
}
