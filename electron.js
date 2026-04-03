const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const os = require('os');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');

let mainWindow;
const activeChildProcesses = new Set();

/**
 * Validates that a resolved file path stays within the expected base directory.
 * Prevents path traversal attacks (e.g., ../../etc/passwd).
 */
function validatePath(basePath, ...segments) {
  const resolved = path.resolve(basePath, ...segments);
  const normalizedBase = path.resolve(basePath);
  if (!resolved.startsWith(normalizedBase + path.sep) && resolved !== normalizedBase) {
    throw new Error(`Path traversal detected: ${resolved} is outside ${normalizedBase}`);
  }
  return resolved;
}

/**
 * Runs a shell script safely using execFile instead of exec.
 * Returns the child process for tracking.
 */
function runShellScript(scriptPath, scriptDir, callback) {
  const isWindows = process.platform === 'win32';
  let child;
  if (isWindows) {
    child = execFile('cmd.exe', ['/c', scriptPath], { cwd: scriptDir }, callback);
  } else {
    fs.chmodSync(scriptPath, 0o755);
    child = execFile(scriptPath, [], { cwd: scriptDir, shell: false }, callback);
  }
  activeChildProcesses.add(child);
  child.on('exit', () => activeChildProcesses.delete(child));
  return child;
}

function createWindow() {
  mainWindow = new BrowserWindow({
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
    if (typeof projectPath !== 'string' || !projectPath) {
      console.error('fs:saveProject - Invalid projectPath');
      return false;
    }
    for (const file of files) {
      try {
        const fullPath = validatePath(projectPath, ...file.path);
        const dir = path.dirname(fullPath);
        await fsp.mkdir(dir, { recursive: true });
        await fsp.writeFile(fullPath, file.content);
      } catch (err) {
        console.error(`Failed to save file: ${file.path.join('/')}`, err);
        return false;
      }
    }
    return true;
  });


  // Handle request to run a simulation script
  ipcMain.on('run-script', (event, { projectPath, scriptName }) => {
    try {
      const scriptPath = validatePath(projectPath, '07_scripts', scriptName);
      const scriptDir = path.dirname(scriptPath);
      const isWindows = process.platform === 'win32';

      let child;
      if (isWindows) {
        child = execFile('cmd.exe', ['/c', scriptPath], { cwd: scriptDir });
      } else {
        fs.chmodSync(scriptPath, 0o755);
        child = execFile(scriptPath, [], { cwd: scriptDir, shell: false });
      }

      activeChildProcesses.add(child);

      child.stdout.on('data', (data) => {
        event.sender.send('script-output', data.toString());
      });

      child.stderr.on('data', (data) => {
        event.sender.send('script-output', `ERROR: ${data.toString()}`);
      });

      child.on('exit', (code) => {
        activeChildProcesses.delete(child);
        event.sender.send('script-exit', code);
      });
    } catch (err) {
      console.error('run-script failed:', err);
      event.sender.send('script-output', `ERROR: ${err.message}`);
      event.sender.send('script-exit', -1);
    }
  });

  // Resolve a path coming from the renderer:
  // - If absolute, use as-is.
  // - If relative, interpret as relative to the current working directory






  // Handle request to run a script headlessly (without sending streaming output)
  ipcMain.handle('run-script-headless', async (event, { projectPath, scriptContent, scriptName }) => {
    const finalScriptName = scriptName || `temp-sim-${Date.now()}.sh`;
    const scriptPath = validatePath(projectPath, '07_scripts', finalScriptName);
    const scriptDir = path.dirname(scriptPath);

    try {
      await fsp.mkdir(scriptDir, { recursive: true });
      await fsp.writeFile(scriptPath, scriptContent);

      return new Promise((resolve) => {
        runShellScript(scriptPath, scriptDir, (error, stdout, stderr) => {
          // Clean up the temporary script after process exits
          if (!scriptName) {
            fsp.unlink(scriptPath).catch(err => console.error("Failed to delete temp script:", err));
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
    const queue = simulations.map((sim, index) => ({ ...sim, originalIndex: index }));

    const runWorker = async () => {
      while (queue.length > 0) {
        const task = queue.shift();
        if (!task) continue;
        console.log(`Worker picking up task ${task.originalIndex}`);
        try {
          const finalScriptName = task.scriptName || `temp-sim-${task.originalIndex}-${Date.now()}.sh`;
          const scriptPath = validatePath(task.projectPath, '07_scripts', finalScriptName);
          const scriptDir = path.dirname(scriptPath);

          await fsp.mkdir(scriptDir, { recursive: true });
          await fsp.writeFile(scriptPath, task.scriptContent);

          const result = await new Promise((resolve) => {
            runShellScript(scriptPath, scriptDir, (error, stdout, stderr) => {
              if (!task.scriptName) {
                fsp.unlink(scriptPath).catch(err => console.error("Failed to delete temp script:", err));
              }
              if (error) {
                resolve({ success: false, stdout, stderr, code: error.code });
              } else {
                resolve({ success: true, stdout, stderr, code: 0 });
              }
            });
          });
          results[task.originalIndex] = result;
        } catch (err) {
          results[task.originalIndex] = { success: false, stderr: err.message, code: -1 };
        }
        console.log(`Worker finished task ${task.originalIndex}`);
      }
    };

    const workers = Array(maxConcurrent).fill(null).map(() => runWorker());
    await Promise.all(workers);

    return results;
  });

  // Handle request to read a file and return its content
  ipcMain.handle('fs:readFile', async (event, { projectPath, filePath }) => {
    try {
      if (typeof projectPath !== 'string' || typeof filePath !== 'string' || !projectPath || !filePath) {
        console.error('fs:readFile - Invalid projectPath or filePath', { projectPath, filePath });
        return { success: false, error: 'Invalid projectPath or filePath', projectPath, filePath };
      }
      const fullPath = validatePath(projectPath, filePath);
      const content = await fsp.readFile(fullPath); // Returns a Buffer
      return { success: true, content: content, name: path.basename(filePath) };
    } catch (err) {
      console.error(`Failed to read file: ${filePath}`, err);
      return { success: false, error: err.message };
    }
  });

  // Handle request to check if a file exists
  ipcMain.handle('fs:checkFileExists', async (event, { projectPath, filePath }) => {
    try {
      if (typeof projectPath !== 'string' || typeof filePath !== 'string' || !projectPath || !filePath) {
        console.error('fs:checkFileExists - Invalid projectPath or filePath', { projectPath, filePath });
        return false;
      }
      const fullPath = validatePath(projectPath, filePath);
      await fsp.access(fullPath);
      return true;
    } catch {
      return false;
    }
  });

  // Handle request to write a file
  ipcMain.handle('fs:writeFile', async (event, { projectPath, filePath, content }) => {
    try {
      if (typeof projectPath !== 'string' || typeof filePath !== 'string' || !projectPath || !filePath) {
        console.error('fs:writeFile - Invalid projectPath or filePath', { projectPath, filePath });
        return { success: false, error: 'Invalid projectPath or filePath', projectPath, filePath };
      }
      const fullPath = validatePath(projectPath, filePath);
      const dir = path.dirname(fullPath);
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(fullPath, content);
      return { success: true };
    } catch (err) {
      console.error(`Failed to write file: ${filePath}`, err);
      return { success: false, error: err.message };
    }
  });

  // Handle request to run a Python script
  ipcMain.handle('run-python-script', async (event, { projectPath, scriptPath: relScriptPath }) => {
    return new Promise((resolve) => {
      let fullScriptPath;
      try {
        fullScriptPath = validatePath(projectPath, relScriptPath);
      } catch (err) {
        resolve({ success: false, stderr: err.message, error: err.message, code: -1 });
        return;
      }
      const scriptDir = path.dirname(fullScriptPath);
      const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';

      console.log(`Executing Python script: ${pythonCommand} ${fullScriptPath}`);

      const child = execFile(pythonCommand, [fullScriptPath], { cwd: scriptDir }, (error, stdout, stderr) => {
        if (error) {
          console.error(`Python script error: ${error}`);
          resolve({ success: false, stdout, stderr, error: error.message, code: error.code });
          return;
        }
        console.log(`Python script completed successfully`);
        resolve({ success: true, stdout, stderr, code: 0 });
      });
      activeChildProcesses.add(child);
      child.on('exit', () => activeChildProcesses.delete(child));
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

app.on('before-quit', () => {
  // Kill all active child processes to prevent orphans
  for (const child of activeChildProcesses) {
    try {
      child.kill('SIGTERM');
    } catch (e) {
      // Process may have already exited
    }
  }
  activeChildProcesses.clear();
});
