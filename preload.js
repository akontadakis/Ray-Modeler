const { contextBridge, ipcRenderer } = require('electron');

/**
 * Electron preload → renderer bridge.
 */
contextBridge.exposeInMainWorld('electronAPI', {
  // --- Methods that expect a return value (invoked) ---
  openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  saveProject: (args) => ipcRenderer.invoke('fs:saveProject', args),
  runScriptHeadless: (args) => ipcRenderer.invoke('run-script-headless', args),
  runSimulationsParallel: (args) => ipcRenderer.invoke('run-simulations-parallel', args),
  readFile: (args) => ipcRenderer.invoke('fs:readFile', args),
  checkFileExists: (args) => ipcRenderer.invoke('fs:checkFileExists', args),
  writeFile: (args) => ipcRenderer.invoke('fs:writeFile', args),
  runPythonScript: (args) => ipcRenderer.invoke('run-python-script', args),

  // --- Methods for one-way communication or event listeners ---
  runScript: (args) => ipcRenderer.send('run-script', args),

  onScriptOutput: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('script-output', listener);
    return listener;
  },
  onScriptExit: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('script-exit', listener);
    return listener;
  },






});
