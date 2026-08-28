const { contextBridge, ipcRenderer } = require('electron');

/**
 * Validates that an argument is a plain object with expected string fields.
 */
function validatePathArgs(args, requiredFields) {
  if (!args || typeof args !== 'object') {
    throw new Error('Invalid arguments: expected an object');
  }
  for (const field of requiredFields) {
    if (typeof args[field] !== 'string' || !args[field]) {
      throw new Error(`Invalid argument: '${field}' must be a non-empty string`);
    }
  }
}

/**
 * Electron preload → renderer bridge.
 * All methods validate arguments before forwarding to the main process.
 */
contextBridge.exposeInMainWorld('electronAPI', {
  // --- Methods that expect a return value (invoked) ---
  openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),

  saveProject: (args) => {
    validatePathArgs(args, ['projectPath']);
    if (!Array.isArray(args.files)) throw new Error('Invalid argument: files must be an array');
    return ipcRenderer.invoke('fs:saveProject', args);
  },

  runScriptHeadless: (args) => {
    validatePathArgs(args, ['projectPath']);
    return ipcRenderer.invoke('run-script-headless', args);
  },

  runSimulationsParallel: (args) => {
    if (!args || !Array.isArray(args.simulations)) throw new Error('Invalid argument: simulations must be an array');
    return ipcRenderer.invoke('run-simulations-parallel', args);
  },

  readFile: (args) => {
    validatePathArgs(args, ['projectPath', 'filePath']);
    return ipcRenderer.invoke('fs:readFile', args);
  },

  checkFileExists: (args) => {
    validatePathArgs(args, ['projectPath', 'filePath']);
    return ipcRenderer.invoke('fs:checkFileExists', args);
  },

  writeFile: (args) => {
    validatePathArgs(args, ['projectPath', 'filePath']);
    return ipcRenderer.invoke('fs:writeFile', args);
  },

  runPythonScript: (args) => {
    validatePathArgs(args, ['projectPath', 'scriptPath']);
    return ipcRenderer.invoke('run-python-script', args);
  },

  runLiveRender: (args) => {
    if (!args || typeof args !== 'object') {
      throw new Error('Invalid arguments: expected an object');
    }
    for (const field of ['epwContent', 'geometryContent', 'materialsContent', 'viewpointContent']) {
      if (typeof args[field] !== 'string') {
        throw new Error(`Invalid argument: '${field}' must be a string`);
      }
    }
    for (const field of ['month', 'day', 'time']) {
      if (typeof args[field] !== 'number' || !Number.isFinite(args[field])) {
        throw new Error(`Invalid argument: '${field}' must be a finite number`);
      }
    }
    return ipcRenderer.invoke('run-live-render', args);
  },

  // --- Script execution and its output streams ---

  /**
   * Starts a script. Resolves to `{ success: true, jobId }` (or
   * `{ success: false, error }`). Pass the jobId to onScriptOutputFor /
   * onScriptExitFor to receive only THIS run's output; the legacy global
   * onScriptOutput / onScriptExit still fire for every run.
   */
  runScript: (args) => {
    validatePathArgs(args, ['projectPath', 'scriptName']);
    // Never reject: several callers fire this without awaiting.
    return ipcRenderer.invoke('run-script', args)
      .catch((err) => ({ success: false, error: err && err.message ? err.message : String(err) }));
  },

  onScriptOutput: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('script-output', listener);
    // Return unsubscribe function to prevent listener leaks
    return () => ipcRenderer.removeListener('script-output', listener);
  },

  onScriptExit: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('script-exit', listener);
    // Return unsubscribe function to prevent listener leaks
    return () => ipcRenderer.removeListener('script-exit', listener);
  },

  /** Output for one specific job only. Returns an unsubscribe function. */
  onScriptOutputFor: (jobId, callback) => {
    if (typeof jobId !== 'string' || !jobId) throw new Error("Invalid argument: 'jobId' must be a non-empty string");
    const channel = `script-output:${jobId}`;
    const listener = (_event, value) => callback(value);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },

  /** Exit code for one specific job only. Returns an unsubscribe function. */
  onScriptExitFor: (jobId, callback) => {
    if (typeof jobId !== 'string' || !jobId) throw new Error("Invalid argument: 'jobId' must be a non-empty string");
    const channel = `script-exit:${jobId}`;
    const listener = (_event, value) => callback(value);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
