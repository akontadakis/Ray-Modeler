const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { exec } = require('child_process');
const os = require('os');

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
    const scriptDir = path.dirname(scriptPath); // Get the script's directory
    // For Windows, the command is just the script name. Rely on 'cwd'.
    // For non-Windows, ensure executable and run.
    const command = isWindows ? scriptName : `chmod +x "${scriptPath}" && "${scriptPath}"`;

    const child = exec(command, { cwd: scriptDir }); // Set cwd to the script's directory

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

// Handle request to run a script headlessly (without sending streaming output)
ipcMain.handle('run-script-headless', async (event, { projectPath, scriptContent, scriptName }) => {
  // If no specific name is given, create a temporary one
  const finalScriptName = scriptName || `temp-sim-${Date.now()}.sh`;
  const scriptPath = path.join(projectPath, '07_scripts', finalScriptName);
  const scriptDir = path.dirname(scriptPath);

  try {
    await fs.mkdir(scriptDir, { recursive: true });
    await fs.writeFile(scriptPath, scriptContent);

    return new Promise((resolve) => {
    const isWindows = process.platform === 'win32';
    // For Windows, the command is just the script name. Rely on 'cwd'.
    // For non-Windows, ensure executable and run.
    const command = isWindows
      ? finalScriptName
      : `chmod +x "${scriptPath}" && "${scriptPath}"`;

    exec(command, { cwd: scriptDir }, (error, stdout, stderr) => {
      // Clean up the temporary script
        if (!scriptName) {
          fs.unlink(scriptPath).catch(err => console.error("Failed to delete temp script:", err));
        }

        if (error) {
          console.error(`Headless exec error: ${error}`);
          resolve({ success: false, stdout: stdout, stderr: stderr, code: error.code });
          return;
        }
        resolve({ success: true, stdout: stdout, stderr: stderr, code: 0 });
      });
    });
  } catch (err) {
      console.error("Failed during headless script setup:", err);
      return { success: false, stderr: err.message, code: -1 };
  }
});

// Handle request to run multiple simulations in parallel with a concurrency limit
ipcMain.handle('run-simulations-parallel', async (event, { simulations }) => {
  const maxConcurrent = Math.max(1, os.cpus().length - 1);
  const results = new Array(simulations.length);
  const queue = simulations.map((sim, index) => ({ ...sim, originalIndex: index })); // Keep track of original order

  const runWorker = async () => {
      while (queue.length > 0) {
          const task = queue.shift();
          if (task) {
              console.log(`Worker picking up task ${task.originalIndex}`);
              const result = await new Promise(async (resolve) => {
                  const finalScriptName = task.scriptName || `temp-sim-${task.originalIndex}-${Date.now()}.sh`;
                  const scriptPath = path.join(task.projectPath, '07_scripts', finalScriptName);
                  const scriptDir = path.dirname(scriptPath);

                  try {
                      await fs.mkdir(scriptDir, { recursive: true });
                      await fs.writeFile(scriptPath, task.scriptContent);

                  const isWindows = process.platform === 'win32';
                  // For Windows, the command is just the script name. Rely on 'cwd'.
                  // For non-Windows, ensure executable and run.
                  const command = isWindows ? finalScriptName : `chmod +x "${scriptPath}" && "${scriptPath}"`;

                  exec(command, { cwd: scriptDir }, (error, stdout, stderr) => {
                      if (!task.scriptName) {
                              fs.unlink(scriptPath).catch(err => console.error("Failed to delete temp script:", err));
                          }
                          if (error) {
                              resolve({ success: false, stdout, stderr, code: error.code });
                          } else {
                              resolve({ success: true, stdout, stderr, code: 0 });
                          }
                      });
                  } catch (err) {
                      resolve({ success: false, stderr: err.message, code: -1 });
                  }
              });
              results[task.originalIndex] = result;
              console.log(`Worker finished task ${task.originalIndex}`);
          }
      }
  };

  const workers = Array(maxConcurrent).fill(null).map(() => runWorker());
  await Promise.all(workers);

  return results;
});

// Handle request to read a file and return its content
ipcMain.handle('fs:readFile', async (event, { projectPath, filePath }) => {
  try {
    const fullPath = path.join(projectPath, filePath);
    const content = await fs.readFile(fullPath); // Returns a Buffer
    return { success: true, content: content, name: path.basename(filePath) };
  } catch (err) {
    console.error(`Failed to read file: ${filePath}`, err);
    return { success: false, error: err.message };
  }
});

// Handle request to check if a file exists
ipcMain.handle('fs:checkFileExists', async (event, { projectPath, filePath }) => {
  try {
    const fullPath = path.join(projectPath, filePath);
    await fs.access(fullPath);
    return true;
  } catch {
    return false;
  }
});

// Handle request to write a file
ipcMain.handle('fs:writeFile', async (event, { projectPath, filePath, content }) => {
  try {
    const fullPath = path.join(projectPath, filePath);
    const dir = path.dirname(fullPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(fullPath, content);
    return { success: true };
  } catch (err) {
    console.error(`Failed to write file: ${filePath}`, err);
    return { success: false, error: err.message };
  }
});

// Handle request to run a Python script
ipcMain.handle('run-python-script', async (event, { projectPath, scriptPath }) => {
  return new Promise((resolve) => {
    const fullScriptPath = path.join(projectPath, scriptPath);
    const scriptDir = path.dirname(fullScriptPath);
    
    // Use python3 command (works on macOS/Linux, may need adjustment for Windows)
    const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
    const command = `${pythonCommand} "${fullScriptPath}"`;
    
    console.log(`Executing Python script: ${command}`);
    
    exec(command, { cwd: scriptDir }, (error, stdout, stderr) => {
      if (error) {
        console.error(`Python script error: ${error}`);
        resolve({ 
          success: false, 
          stdout: stdout, 
          stderr: stderr, 
          error: error.message,
          code: error.code 
        });
        return;
      }
      
      console.log(`Python script completed successfully`);
      resolve({ 
        success: true, 
        stdout: stdout, 
        stderr: stderr, 
        code: 0 
      });
    });
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
