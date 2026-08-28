// scripts/dom.js

const dom = {};

/**
 * Caches references to every element in the document that carries an `id`.
 *
 * This replaces the former hand-maintained allowlist, which had drifted from
 * index.html and silently left dozens of live elements uncached (a missing
 * entry simply yielded `undefined` at the call site).
 *
 * Notes:
 * - The same `dom` object is mutated in place on every call. Modules capture
 *   the reference once at import time (`const dom = getDom()`), so it must
 *   never be reassigned or replaced.
 * - `document.querySelectorAll('[id]')` does not descend into `<template>`
 *   content, so ids that only exist inside a template are intentionally not
 *   cached. Those elements only become real when a recipe/aperture panel is
 *   cloned into the document; read them from the cloned container instead.
 * - The function is idempotent and safe to re-run. It must be called again
 *   after any dynamic UI injection that creates new ids (for example
 *   `AperturePanelUI.render()`, which is why `setupEventListeners()` calls it
 *   a second time immediately after rendering the aperture panel).
 */
export function setupDOM() {
    const found = document.querySelectorAll('[id]');

    // Drop entries whose cached element has been detached from the document,
    // so a re-render replaces stale references instead of keeping them alive.
    for (const key of Object.keys(dom)) {
        const el = dom[key];
        if (!el || (el.isConnected === false)) delete dom[key];
    }

    for (const el of found) {
        const id = el.id;
        if (!id) continue;
        // First element wins, matching document.getElementById() semantics.
        if (!dom[id]) dom[id] = el;
    }
}

/**
 * Provides read-only access to the cached DOM elements.
 * @returns {object} The DOM cache.
 */
export function getDom() {
    return dom;
}
