const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // --- Methods that expect a return value (invoked) ---
  openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  saveProject: (args) => ipcRenderer.invoke('fs:saveProject', args),

  // --- Methods for one-way communication or event listeners ---
  runScript: (args) => ipcRenderer.send('run-script', args),
  onScriptOutput: (callback) => ipcRenderer.on('script-output', (_event, value) => callback(value)),
  onScriptExit: (callback) => ipcRenderer.on('script-exit', (_event, value) => callback(value)),
});