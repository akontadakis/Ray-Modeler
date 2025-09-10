const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { exec } = require('child_process');

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile('index.html');
  // mainWindow.webContents.openDevTools(); // Uncomment to see developer tools
}

app.whenReady().then(() => {
  // --- IPC HANDLERS ---

  // Handle request to open a directory
  ipcMain.handle('dialog:openDirectory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });
    if (!canceled) {
      return filePaths[0];
    }
    return null;
  });

  // Handle request to save the entire project
  ipcMain.handle('fs:saveProject', async (event, { projectPath, files }) => {
      for (const file of files) {
          try {
              const fullPath = path.join(projectPath, ...file.path);
              const dir = path.dirname(fullPath);
              await fs.mkdir(dir, { recursive: true });
              await fs.writeFile(fullPath, file.content);
          } catch (err) {
              console.error(`Failed to save file: ${file.path.join('/')}`, err);
              // You could send an error message back to the renderer here
              return false; // Indicate failure
          }
      }
      return true; // Indicate success
  });


  // Handle request to run a simulation script
  ipcMain.on('run-script', (event, { projectPath, scriptName }) => {
    const scriptPath = path.join(projectPath, '07_scripts', scriptName);
    const isWindows = process.platform === 'win32';
    const command = isWindows ? `cd "${path.dirname(scriptPath)}" && ${scriptName}` : `chmod +x "${scriptPath}" && "${scriptPath}"`;

    const child = exec(command, { cwd: path.join(projectPath, '07_scripts') });

    child.stdout.on('data', (data) => {
      event.sender.send('script-output', data.toString());
    });

    child.stderr.on('data', (data) => {
      event.sender.send('script-output', `ERROR: ${data.toString()}`);
    });

    child.on('exit', (code) => {
      event.sender.send('script-exit', code);
    });
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});