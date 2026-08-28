const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const os = require('os');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const { pathToFileURL } = require('url');

let mainWindow;
let openDirectoryInFlight = false;
let nextJobId = 1;
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
  // The lexical check above cannot see symlinks. A link inside the project that
  // points outside it would pass, and the subsequent write would follow it.
  // Resolve the deepest ancestor that actually exists on disk and re-check.
  const realBase = realpathOrSelf(normalizedBase);
  const realResolved = realpathDeepest(resolved);
  if (!realResolved.startsWith(realBase + path.sep) && realResolved !== realBase) {
    throw new Error(`Path traversal detected: ${realResolved} is outside ${realBase}`);
  }
  return resolved;
}

/** fs.realpathSync, falling back to the input when the path does not exist yet. */
function realpathOrSelf(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Resolves symlinks on the deepest existing ancestor of `target` and re-appends
 * the not-yet-created tail, so paths that are about to be written are covered.
 */
function realpathDeepest(target) {
  const tail = [];
  let current = target;
  for (;;) {
    try {
      const real = fs.realpathSync(current);
      return tail.length ? path.join(real, ...tail) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return target; // reached the root, nothing resolvable
      tail.unshift(path.basename(current));
      current = parent;
    }
  }
}

const LIVE_PREVIEW_KEEP = 3;
let livePreviewSeq = 0;

/**
 * Writes a finished live-preview HDR somewhere stable (the per-render staging
 * directory is deleted immediately afterwards) and prunes all but the most
 * recent few, so repeated renders cannot fill the temp volume.
 */
async function stashLivePreview(bytes) {
  const dir = path.join(os.tmpdir(), 'ray-modeler-live-preview', 'previews');
  await fsp.mkdir(dir, { recursive: true });
  const seq = String(livePreviewSeq++).padStart(6, '0');
  const name = `preview-${Date.now()}-${seq}-${process.pid}.hdr`;
  const target = path.join(dir, name);
  await fsp.writeFile(target, bytes);

  try {
    const entries = (await fsp.readdir(dir)).filter((f) => f.endsWith('.hdr')).sort();
    for (const stale of entries.slice(0, Math.max(0, entries.length - LIVE_PREVIEW_KEEP))) {
      await fsp.rm(path.join(dir, stale), { force: true }).catch(() => {});
    }
  } catch {
    // Pruning is best-effort; never fail a render over it.
  }
  return target;
}

/**
 * Validates a saveProject file entry and returns a printable form of its path,
 * or null when the entry is malformed. `path` must be an array of non-empty
 * strings and `content` must be writable (string / Buffer / TypedArray).
 */
function describePathSegments(file) {
  if (!file || typeof file !== 'object') return null;
  if (!Array.isArray(file.path) || file.path.length === 0) return null;
  if (!file.path.every((s) => typeof s === 'string' && s.length > 0)) return null;
  const content = file.content;
  const contentOk = typeof content === 'string'
    || Buffer.isBuffer(content)
    || ArrayBuffer.isView(content)
    || content instanceof ArrayBuffer;
  if (!contentOk) return null;
  return file.path.join('/');
}

/**
 * Only http(s) and mailto links may leave the app, and only to the browser.
 * Everything else (file:, javascript:, custom protocols) is refused outright.
 */
function isAllowedExternalUrl(url) {
  if (typeof url !== 'string' || !url) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' || parsed.protocol === 'http:' || parsed.protocol === 'mailto:';
}

/**
 * Kills a child process AND its descendants. A plain child.kill() only signals
 * the direct child (the shell wrapper), leaving oconv/rpict/rtrace grandchildren
 * running. On POSIX the child is spawned detached so it leads its own process
 * group and the whole group can be signalled; on Windows taskkill /T walks the tree.
 */
function killChildTree(child, signal = 'SIGTERM') {
  if (!child || child.killed || child.exitCode !== null) return;
  const pid = child.pid;
  if (!pid) return;
  if (process.platform === 'win32') {
    try {
      execFile('taskkill', ['/pid', String(pid), '/T', '/F']);
    } catch {
      try { child.kill(signal); } catch { /* already gone */ }
    }
    return;
  }
  try {
    process.kill(-pid, signal); // negative pid == the whole process group
  } catch {
    try { child.kill(signal); } catch { /* already gone */ }
  }
}

/**
 * Runs a shell script safely using execFile instead of exec.
 * Returns the child process for tracking.
 */
// Radiance runs can emit a lot of progress text. Rather than aborting a
// finished simulation the way execFile's maxBuffer does, output is truncated.
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

/**
 * Spawns a script in its OWN process group.
 *
 * NOTE: child_process.execFile cannot be used here — it forwards only a fixed
 * subset of options to spawn() and silently drops `detached`, so the child
 * stays in the main process's group and `process.kill(-pid)` fails with ESRCH.
 * spawn() honours it, which is what makes killChildTree able to reach the
 * oconv/rpict/rtrace grandchildren.
 */
function spawnScript(file, args, options) {
  const opts = { ...options };
  if (process.platform !== 'win32') {
    opts.detached = true;
  } else {
    opts.windowsHide = true;
  }
  return spawn(file, args, opts);
}

/**
 * Reproduces execFile's `(error, stdout, stderr)` callback contract on top of a
 * spawn()ed child, so existing callers that read `error.code` are unaffected.
 */
function collectOutput(child, callback) {
  if (typeof callback !== 'function') return child;
  let stdout = '';
  let stderr = '';
  let settled = false;
  const finish = (err) => {
    if (settled) return;
    settled = true;
    callback(err, stdout, stderr);
  };

  if (child.stdout) {
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += d;
    });
  }
  if (child.stderr) {
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => {
      if (stderr.length < MAX_OUTPUT_BYTES) stderr += d;
    });
  }

  child.on('error', (err) => finish(err));
  // 'close' rather than 'exit': it fires once the stdio pipes have drained.
  child.on('close', (code, signal) => {
    if (code === 0) {
      finish(null);
      return;
    }
    const err = new Error(`Command failed: ${child.spawnfile} (${code === null ? signal : code})`);
    err.code = code === null ? signal : code;
    err.signal = signal;
    finish(err);
  });
  return child;
}

function runShellScript(scriptPath, scriptDir, callback, ownerId = null) {
  const isWindows = process.platform === 'win32';
  const child = isWindows
    ? spawnScript('cmd.exe', ['/c', scriptPath], { cwd: scriptDir })
    : spawnScript(scriptPath, [], { cwd: scriptDir, shell: false });
  collectOutput(child, callback);
  child.ownerWebContentsId = ownerId;
  activeChildProcesses.add(child);
  child.on('exit', () => activeChildProcesses.delete(child));
  // Guard against unhandled 'error' events (e.g. spawn failures) crashing the
  // main process. The execFile callback already receives the error, so this
  // listener only needs to keep the process registry clean.
  child.on('error', () => activeChildProcesses.delete(child));
  return child;
}

/** Ensures a generated script is executable without blocking the main thread. */
async function makeExecutable(scriptPath) {
  if (process.platform === 'win32') return;
  await fsp.chmod(scriptPath, 0o755);
}

/** Kills every child process owned by a WebContents (used when its window closes). */
function killChildrenOfWebContents(webContentsId) {
  for (const child of activeChildProcesses) {
    if (child.ownerWebContentsId === webContentsId) {
      killChildTree(child, 'SIGTERM');
    }
  }
}

/**
 * Sends on a WebContents only when it is still alive. Streaming handlers fire
 * long after a window may have been closed; an unguarded send throws
 * "Object has been destroyed" from outside any try/catch and takes down the
 * whole main process.
 */
function safeSend(sender, channel, ...args) {
  try {
    if (!sender || sender.isDestroyed()) return false;
    sender.send(channel, ...args);
    return true;
  } catch {
    return false;
  }
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

  const createdWindow = mainWindow;
  const windowWebContentsId = mainWindow.webContents.id;

  // --- Navigation hardening -------------------------------------------------
  // preload.js exposes electronAPI (script execution, arbitrary file writes) to
  // whatever document is loaded. Without these guards a single navigation to a
  // remote page would hand that API to attacker-controlled script.

  // Never open a renderer-requested window; route safe external links to the
  // user's browser instead.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      shell.openExternal(url).catch((err) => console.error('openExternal failed:', err));
    } else {
      console.warn('Blocked window.open to disallowed URL:', url);
    }
    return { action: 'deny' };
  });

  // Block any navigation away from the bundled file:// application.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      event.preventDefault();
      return;
    }
    if (parsed.protocol !== 'file:') {
      event.preventDefault();
      console.warn('Blocked navigation away from the application:', url);
      if (isAllowedExternalUrl(url)) {
        shell.openExternal(url).catch((err) => console.error('openExternal failed:', err));
      }
    }
  });

  mainWindow.loadFile('index.html');

  // Kill this window's simulations when it closes, otherwise a long rpict keeps
  // running against a destroyed WebContents.
  // Release the reference on close so the destroyed BrowserWindow and its
  // WebContents are not retained until the next launch.
  createdWindow.on('closed', () => {
    killChildrenOfWebContents(windowWebContentsId);
    if (mainWindow === createdWindow) {
      mainWindow = null;
    }
  });

  // mainWindow.webContents.openDevTools(); // Uncomment to see developer tools
}

app.whenReady().then(() => {
  // --- IPC HANDLERS ---

  // Handle request to open a directory
  ipcMain.handle('dialog:openDirectory', async (event) => {
    // Debounce: a repeated channel hit while a picker is up would stack modals.
    if (openDirectoryInFlight) return null;
    openDirectoryInFlight = true;
    try {
      const parent = BrowserWindow.fromWebContents(event.sender);
      const options = { properties: ['openDirectory'] };
      const { canceled, filePaths } = parent && !parent.isDestroyed()
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options);
      if (!canceled) {
        return filePaths[0];
      }
      return null;
    } finally {
      openDirectoryInFlight = false;
    }
  });

  // Handle request to save the entire project
  ipcMain.handle('fs:saveProject', async (event, { projectPath, files }) => {
    if (typeof projectPath !== 'string' || !projectPath) {
      console.error('fs:saveProject - Invalid projectPath');
      return false;
    }
    if (!Array.isArray(files)) {
      console.error('fs:saveProject - files must be an array');
      return false;
    }
    for (const file of files) {
      // The main process is the trust boundary: re-validate shapes here rather
      // than relying on the preload. `path` MUST be an array of segments — a
      // bare string spread into path.resolve() would become one directory per
      // character and silently write to the wrong place.
      const segments = describePathSegments(file);
      if (!segments) {
        console.error('fs:saveProject - invalid file entry (path must be a non-empty array of strings)');
        return false;
      }
      try {
        const fullPath = validatePath(projectPath, ...file.path);
        const dir = path.dirname(fullPath);
        await fsp.mkdir(dir, { recursive: true });
        await fsp.writeFile(fullPath, file.content);
      } catch (err) {
        console.error(`Failed to save file: ${segments}`, err);
        return false;
      }
    }
    return true;
  });


  // Handle request to run a simulation script.
  //
  // This is invoke/handle (not fire-and-forget send) and returns
  // `{ success: true, jobId }`. Output for one run is addressed on the
  // per-job channels `script-output:<jobId>` / `script-exit:<jobId>` so
  // concurrent runs cannot be confused for one another. The legacy global
  // `script-output` / `script-exit` channels still fire for every job so
  // existing subscribers keep working during the migration.
  ipcMain.handle('run-script', async (event, args) => {
    const { projectPath, scriptName } = args || {};
    if (typeof projectPath !== 'string' || !projectPath
      || typeof scriptName !== 'string' || !scriptName) {
      return { success: false, error: 'Invalid projectPath or scriptName' };
    }

    const jobId = `job-${nextJobId++}`;
    const sender = event.sender;
    const outChannel = `script-output:${jobId}`;
    const exitChannel = `script-exit:${jobId}`;
    // Every send is guarded: the window may close mid-run.
    const emitOutput = (text) => {
      safeSend(sender, outChannel, text);
      safeSend(sender, 'script-output', text);
    };
    const emitExit = (code) => {
      safeSend(sender, exitChannel, code);
      safeSend(sender, 'script-exit', code);
    };

    try {
      const scriptPath = validatePath(projectPath, '07_scripts', scriptName);
      const scriptDir = path.dirname(scriptPath);
      const isWindows = process.platform === 'win32';

      let child;
      if (isWindows) {
        child = spawnScript('cmd.exe', ['/c', scriptPath], { cwd: scriptDir });
      } else {
        // Async chmod: fs.chmodSync blocks the main thread, which can be
        // seconds on a network mount and happens once per launched task.
        await makeExecutable(scriptPath);
        child = spawnScript(scriptPath, [], { cwd: scriptDir, shell: false });
      }

      child.ownerWebContentsId = sender.id;
      activeChildProcesses.add(child);

      if (child.stdout) {
        child.stdout.on('data', (data) => emitOutput(data.toString()));
      }

      if (child.stderr) {
        child.stderr.on('data', (data) => emitOutput(`ERROR: ${data.toString()}`));
      }

      // Without this listener a spawn failure (bad shebang, missing
      // interpreter, permissions) emits an unhandled 'error' event that would
      // crash the entire main process.
      child.on('error', (err) => {
        activeChildProcesses.delete(child);
        emitOutput(`ERROR: ${err.message}`);
        emitExit(-1);
      });

      // 'close', not 'exit': 'exit' can fire before the stdio pipes have
      // drained, which would deliver script-exit ahead of the final output.
      child.on('close', (code, signal) => {
        activeChildProcesses.delete(child);
        if (signal) emitOutput(`ERROR: terminated by signal ${signal}\n`);
        emitExit(code === null ? -1 : code);
      });

      return { success: true, jobId };
    } catch (err) {
      console.error('run-script failed:', err);
      emitOutput(`ERROR: ${err.message}`);
      emitExit(-1);
      return { success: false, jobId, error: err.message };
    }
  });

  // Resolve a path coming from the renderer:
  // - If absolute, use as-is.
  // - If relative, interpret as relative to the current working directory






  // Handle request to run a script headlessly (without sending streaming output)
  ipcMain.handle('run-script-headless', async (event, { projectPath, scriptContent, scriptName }) => {
    // Everything, including validatePath and the chmod, must sit INSIDE the try
    // and the promise must be awaited — otherwise a synchronous throw escapes
    // the catch below and callers written against `{ success: false }` receive
    // a rejected promise instead.
    try {
      if (typeof projectPath !== 'string' || !projectPath) {
        return { success: false, stderr: 'Invalid projectPath', code: -1 };
      }
      if (typeof scriptContent !== 'string') {
        return { success: false, stderr: 'scriptContent must be a string', code: -1 };
      }
      if (scriptName !== undefined && scriptName !== null && typeof scriptName !== 'string') {
        return { success: false, stderr: 'scriptName must be a string', code: -1 };
      }
      const finalScriptName = scriptName || `temp-sim-${Date.now()}.sh`;
      const scriptPath = validatePath(projectPath, '07_scripts', finalScriptName);
      const scriptDir = path.dirname(scriptPath);

      await fsp.mkdir(scriptDir, { recursive: true });
      await fsp.writeFile(scriptPath, scriptContent, { mode: 0o755 });
      await makeExecutable(scriptPath);

      return await new Promise((resolve) => {
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
        }, event.sender.id);
      });
    } catch (err) {
      console.error("Failed during headless script setup:", err);
      return { success: false, stderr: err.message, code: -1 };
    }
  });

  // Handle request to run multiple simulations in parallel with a concurrency limit
  ipcMain.handle('run-simulations-parallel', async (event, { simulations }) => {
    if (!Array.isArray(simulations)) {
      return [];
    }
    const maxConcurrent = Math.max(1, os.cpus().length - 1);
    const results = new Array(simulations.length);
    const queue = simulations.map((sim, index) => ({ ...sim, originalIndex: index }));
    const senderId = event.sender.id;

    const runWorker = async () => {
      while (queue.length > 0) {
        const task = queue.shift();
        if (!task) continue;
        console.log(`Worker picking up task ${task.originalIndex}`);
        try {
          // Re-validate the shape here; the main process is the trust boundary.
          if (typeof task.projectPath !== 'string' || !task.projectPath) {
            throw new Error('Invalid projectPath');
          }
          if (typeof task.scriptContent !== 'string') {
            throw new Error('scriptContent must be a string');
          }
          if (task.scriptName !== undefined && task.scriptName !== null
            && typeof task.scriptName !== 'string') {
            throw new Error('scriptName must be a string');
          }
          const finalScriptName = task.scriptName || `temp-sim-${task.originalIndex}-${Date.now()}.sh`;
          const scriptPath = validatePath(task.projectPath, '07_scripts', finalScriptName);
          const scriptDir = path.dirname(scriptPath);

          await fsp.mkdir(scriptDir, { recursive: true });
          await fsp.writeFile(scriptPath, task.scriptContent, { mode: 0o755 });
          await makeExecutable(scriptPath);

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
            }, senderId);
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
      child.ownerWebContentsId = event.sender.id;
      activeChildProcesses.add(child);
      child.on('exit', () => activeChildProcesses.delete(child));
      child.on('error', () => activeChildProcesses.delete(child));
    });
  });

  // Handle a live-preview render request from the renderer.
  // The renderer (scripts/project.js -> runLivePreviewRender) sends the raw
  // Radiance scene content (geometry/materials/viewpoint), the EPW weather
  // content, and a date/time. We stage those into a temporary working
  // directory, build a Radiance sky for the requested moment, oconv the scene
  // into an octree and rpict it into an HDR, then return a file:// URL that the
  // renderer can load with RGBELoader.
  ipcMain.handle('run-live-render', async (event, payload) => {
    let workDir = null;
    try {
      const {
        epwContent,
        geometryContent,
        materialsContent,
        viewpointContent,
        month,
        day,
        time,
      } = payload || {};

      if (
        typeof epwContent !== 'string' ||
        typeof geometryContent !== 'string' ||
        typeof materialsContent !== 'string' ||
        typeof viewpointContent !== 'string'
      ) {
        return { success: false, error: 'Invalid live render payload: missing scene content.' };
      }
      const m = Number(month);
      const d = Number(day);
      const t = Number(time);
      if (!Number.isFinite(m) || !Number.isFinite(d) || !Number.isFinite(t)) {
        return { success: false, error: 'Invalid live render payload: month/day/time must be numbers.' };
      }

      // Stage everything in a temporary, per-render working directory. The
      // payload carries no project path, so we sandbox under the OS temp dir
      // and still route every filename through validatePath as a guard.
      // mkdtemp, not a millisecond timestamp: two renders started in the same
      // millisecond would otherwise share a directory and could interleave
      // writes into one HDR that still passes the non-empty check below.
      // The directory is removed in the `finally` at the end of this handler,
      // so slider-scrubbing no longer leaks a full EPW + octree per frame.
      const baseDir = path.join(os.tmpdir(), 'ray-modeler-live-preview');
      await fsp.mkdir(baseDir, { recursive: true });
      workDir = await fsp.mkdtemp(path.join(baseDir, 'render-'));

      const epwPath = validatePath(workDir, 'weather.epw');
      const geoPath = validatePath(workDir, 'geometry.rad');
      const matPath = validatePath(workDir, 'materials.rad');
      const viewPath = validatePath(workDir, 'view.vf');
      const skyGlowPath = validatePath(workDir, 'sky_glow.rad');
      const genskyPath = validatePath(workDir, 'gensky.rad');
      const octPath = validatePath(workDir, 'scene.oct');
      const hdrPath = validatePath(workDir, 'preview.hdr');

      // Sky/ground hemispheres that pick up the gensky brightness function.
      const skyGlow = [
        'skyfunc glow sky_glow',
        '0', '0', '4 1 1 1 0',
        'sky_glow source sky',
        '0', '0', '4 0 0 1 180',
        'skyfunc glow ground_glow',
        '0', '0', '4 1 1 1 0',
        'ground_glow source ground',
        '0', '0', '4 0 0 -1 180',
        '',
      ].join('\n');

      // Derive gensky location flags from the EPW LOCATION header when present.
      // EPW line: LOCATION,city,state,country,source,wmo,lat,long,tz,elevation
      // Radiance uses west-positive longitude/meridian, EPW east-positive.
      let locFlags = '';
      const firstLine = (epwContent.split(/\r?\n/)[0] || '').split(',');
      const lat = parseFloat(firstLine[6]);
      const lon = parseFloat(firstLine[7]);
      const tz = parseFloat(firstLine[8]);
      if (Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(tz)) {
        locFlags = ` -a ${lat} -o ${-lon} -m ${-15 * tz}`;
      }

      const genskyCmd = `gensky ${m} ${d} ${t} +s${locFlags}`;

      await fsp.writeFile(epwPath, epwContent);
      await fsp.writeFile(geoPath, geometryContent);
      await fsp.writeFile(matPath, materialsContent);
      await fsp.writeFile(viewPath, viewpointContent);
      await fsp.writeFile(skyGlowPath, skyGlow);

      const isWindows = process.platform === 'win32';
      const scriptName = isWindows ? 'render.bat' : 'render.sh';
      const scriptPath = validatePath(workDir, scriptName);

      const cmds = [
        `${genskyCmd} > "${genskyPath}"`,
        `oconv "${matPath}" "${geoPath}" "${genskyPath}" "${skyGlowPath}" > "${octPath}"`,
        `rpict -vf "${viewPath}" -x 512 -y 512 "${octPath}" > "${hdrPath}"`,
      ];

      const scriptBody = isWindows
        ? ['@echo off', ...cmds].join('\r\n') + '\r\n'
        : ['#!/bin/bash', 'set -e', ...cmds].join('\n') + '\n';

      await fsp.writeFile(scriptPath, scriptBody, { mode: 0o755 });
      await makeExecutable(scriptPath);

      const result = await new Promise((resolve) => {
        runShellScript(scriptPath, workDir, (error, stdout, stderr) => {
          if (error) {
            resolve({ success: false, stdout, stderr, error: error.message, code: error.code });
          } else {
            resolve({ success: true, stdout, stderr, code: 0 });
          }
        }, event.sender.id);
      });

      if (!result.success) {
        return result;
      }

      // Make sure rpict actually produced a non-empty HDR before reporting success.
      let hdrBytes;
      try {
        hdrBytes = await fsp.readFile(hdrPath);
        if (!hdrBytes.length) {
          return { success: false, error: 'Render produced an empty image.', stderr: result.stderr };
        }
      } catch (readErr) {
        return { success: false, error: 'Render did not produce an output image.', stderr: result.stderr };
      }

      // The renderer loads the HDR by file:// URL, so it has to outlive the
      // staging directory. Copy just the image out, then prune old previews so
      // a scrubbing session cannot grow without bound.
      const previewPath = await stashLivePreview(hdrBytes);

      return {
        success: true,
        hdrPath: pathToFileURL(previewPath).href,
        outputPath: previewPath,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    } catch (err) {
      console.error('run-live-render failed:', err);
      return { success: false, error: err.message, code: -1 };
    } finally {
      // Always drop the staging directory: it holds the full EPW, the geometry,
      // the octree and the raw HDR — 1-2 GB over a slider-scrubbing session.
      if (workDir) {
        await fsp.rm(workDir, { recursive: true, force: true })
          .catch((err) => console.error('Failed to remove live-render temp dir:', err));
      }
    }
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

let shuttingDown = false;

app.on('before-quit', async (event) => {
  if (shuttingDown || activeChildProcesses.size === 0) return;

  // Hold the quit open long enough to actually reap the children. A plain
  // synchronous SIGTERM only signalled the shell wrapper and returned
  // immediately, leaving the oconv/rpict/rtrace grandchildren orphaned.
  event.preventDefault();
  shuttingDown = true;

  for (const child of activeChildProcesses) {
    killChildTree(child, 'SIGTERM');
  }

  const deadline = Date.now() + 3000;
  while (activeChildProcesses.size > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
  }

  // Anything still alive after the grace period gets SIGKILL.
  for (const child of activeChildProcesses) {
    killChildTree(child, 'SIGKILL');
  }
  activeChildProcesses.clear();

  app.quit();
});
