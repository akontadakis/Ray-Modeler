const { contextBridge, ipcRenderer } = require('electron');

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
  runEnergyPlusScript: (args) => ipcRenderer.send('run-energyplus-script', args),
  onScriptOutput: (callback) => ipcRenderer.on('script-output', (_event, value) => callback(value)),
  onScriptExit: (callback) => ipcRenderer.on('script-exit', (_event, value) => callback(value)),

  // --- EnergyPlus integration ---
  runEnergyPlus: (args) => ipcRenderer.send('run-energyplus', args),
  onEnergyPlusOutput: (callback) => ipcRenderer.on('energyplus-output', (_event, value) => callback(value)),
  onEnergyPlusExit: (callback) => ipcRenderer.on('energyplus-exit', (_event, value) => callback(value)),
});
