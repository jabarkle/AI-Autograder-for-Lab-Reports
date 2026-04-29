// Lab Grader — Electron main process
//
// Responsibilities:
//   - On launch: spawn the bundled Python backend (PyInstaller exe) on 127.0.0.1.
//   - Wait for /health to respond, then open the renderer window pointing at it.
//   - On quit: terminate the backend cleanly.
//   - In dev mode (LAB_GRADER_DEV=1): assume the user is running uvicorn + vite
//     manually and just open a window pointing at http://localhost:5173.

const { app, BrowserWindow, shell, dialog, ipcMain, session, safeStorage } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')
const http = require('http')

const IS_DEV = process.env.LAB_GRADER_DEV === '1'
const BACKEND_PORT = 9090
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`

let backendProc = null
let mainWindow = null

// ── Paths ─────────────────────────────────────────────────────────────────────

function backendExePath() {
  // When packaged: resources/backend/server.exe (Win) or resources/backend/server (mac/linux)
  const resourcesDir = process.resourcesPath
  const exeName = process.platform === 'win32' ? 'server.exe' : 'server'
  return path.join(resourcesDir, 'backend', exeName)
}

function userDataLabsDir() {
  return path.join(app.getPath('userData'), 'labs')
}

// ── Backend lifecycle ─────────────────────────────────────────────────────────

function startBackend() {
  if (IS_DEV) return Promise.resolve() // dev: user runs uvicorn separately

  const exe = backendExePath()
  if (!fs.existsSync(exe)) {
    dialog.showErrorBox(
      'Lab Grader',
      `Backend executable not found at:\n${exe}\n\nThe install may be corrupted. Reinstall the app.`,
    )
    app.quit()
    return Promise.reject(new Error('Backend missing'))
  }

  fs.mkdirSync(userDataLabsDir(), { recursive: true })

  backendProc = spawn(exe, [], {
    env: {
      ...process.env,
      LAB_GRADER_LABS_DIR: userDataLabsDir(),
      // Tell uvicorn (inside the bundled server) to bind to localhost only.
      HOST: '127.0.0.1',
      PORT: String(BACKEND_PORT),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })

  backendProc.stdout.on('data', d => process.stdout.write(`[backend] ${d}`))
  backendProc.stderr.on('data', d => process.stderr.write(`[backend!] ${d}`))
  backendProc.on('exit', code => {
    if (code !== 0 && code !== null) {
      dialog.showErrorBox('Lab Grader', `Backend exited with code ${code}.`)
    }
  })

  return waitForBackend()
}

function waitForBackend(maxMs = 30000) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(`${BACKEND_URL}/health`, res => {
        if (res.statusCode === 200) resolve()
        else retry()
      })
      req.on('error', retry)
      req.setTimeout(1500, () => { req.destroy(); retry() })
    }
    const retry = () => {
      if (Date.now() - start > maxMs) reject(new Error('Backend startup timed out'))
      else setTimeout(tryOnce, 400)
    }
    tryOnce()
  })
}

function stopBackend() {
  if (backendProc && !backendProc.killed) {
    try { backendProc.kill() } catch { /* ignore */ }
    backendProc = null
  }
}

// ── Window ────────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'Lab Grader',
    backgroundColor: '#f6f6f6',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Open external links in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost')) {
      return { action: 'allow' }
    }
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Default downloads to the Desktop folder so the batch ZIP lands somewhere
  // obvious for TAs. The user can still pick a different location.
  session.defaultSession.on('will-download', (_e, item) => {
    const fname = item.getFilename()
    const target = path.join(app.getPath('desktop'), fname)
    item.setSavePath(target)
  })

  const url = IS_DEV ? 'http://localhost:5173' : BACKEND_URL
  mainWindow.loadURL(url)
}

// ── IPC for safe key storage (optional Remember Me) ──────────────────────────

const KEYTAR_FILE = () => path.join(app.getPath('userData'), 'apikey.enc')

ipcMain.handle('apiKey:save', (_e, plain) => {
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, reason: 'unavailable' }
  try {
    const buf = safeStorage.encryptString(plain)
    fs.writeFileSync(KEYTAR_FILE(), buf)
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: String(err) }
  }
})

ipcMain.handle('apiKey:load', () => {
  try {
    if (!fs.existsSync(KEYTAR_FILE())) return { ok: true, value: '' }
    if (!safeStorage.isEncryptionAvailable()) return { ok: false, reason: 'unavailable' }
    const buf = fs.readFileSync(KEYTAR_FILE())
    return { ok: true, value: safeStorage.decryptString(buf) }
  } catch (err) {
    return { ok: false, reason: String(err) }
  }
})

ipcMain.handle('apiKey:clear', () => {
  try {
    if (fs.existsSync(KEYTAR_FILE())) fs.unlinkSync(KEYTAR_FILE())
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: String(err) }
  }
})

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  try {
    await startBackend()
  } catch (err) {
    dialog.showErrorBox('Lab Grader', `Failed to start backend: ${err.message}`)
    app.quit()
    return
  }
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopBackend()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', stopBackend)
app.on('quit', stopBackend)
