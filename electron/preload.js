// Renderer-side bridge for the optional OS-encrypted "Remember me" feature.
// In a regular browser this object simply doesn't exist; the frontend falls
// back to localStorage in that case.

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('labGrader', {
  isDesktop: true,
  apiKey: {
    save:  (key) => ipcRenderer.invoke('apiKey:save', key),
    load:  ()    => ipcRenderer.invoke('apiKey:load'),
    clear: ()    => ipcRenderer.invoke('apiKey:clear'),
  },
})
