const { contextBridge, ipcRenderer } = require('electron');

/**
 * Electron preload → renderer bridge.
 *
 * EnergyPlus contract (renderer expectations):
 *
 * Methods:
 *  - runEnergyPlus(options)
 *  - onEnergyPlusOutput(callback)
 *  - onceEnergyPlusOutput(callback)
 *  - offEnergyPlusOutput(callback)
 *  - onEnergyPlusExit(callback)
 *  - onceEnergyPlusExit(callback)
 *  - offEnergyPlusExit(callback)
 *
 * runEnergyPlus(options):
 *  - options.idfPath        string (required/validated in main)
 *  - options.epwPath        string (required)
 *  - options.energyPlusPath string (required)
 *  - options.runName        string (optional; used for output dir, e.g. runs/annual)
 *  - options.runId          string (optional; if omitted, main generates one)
 *
 * Event payloads:
 *  - 'energyplus-output':
 *      { runId: string, chunk: string, stream?: 'stdout' | 'stderr' }
 *    (legacy: plain string still accepted by callers)
 *
 *  - 'energyplus-exit':
 *      {
 *        runId: string,
 *        exitCode: number,
 *        outputDir?: string,
 *        errContent?: string,
 *        csvContents?: Record<string,string>
 *      }
 *    (legacy: bare exitCode number still accepted by callers)
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
