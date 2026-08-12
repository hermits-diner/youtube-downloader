const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),

  // Dependencies
  checkDependencies: () => ipcRenderer.invoke('check-dependencies'),

  // Engine (yt-dlp) version & update
  getEngineInfo: () => ipcRenderer.invoke('get-engine-info'),
  updateEngine: (options) => ipcRenderer.invoke('update-engine', options),

  // Video operations
  getVideoInfo: (url) => ipcRenderer.invoke('get-video-info', url),
  getPlaylistInfo: (url) => ipcRenderer.invoke('get-playlist-info', url),
  searchVideos: (options) => ipcRenderer.invoke('search-videos', options),
  downloadVideo: (options) => ipcRenderer.invoke('download-video', options),
  downloadPlaylist: (options) => ipcRenderer.invoke('download-playlist', options),
  downloadVideos: (options) => ipcRenderer.invoke('download-videos', options),
  cancelDownload: () => ipcRenderer.send('cancel-download'),

  // Directory
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  getDefaultDownloadPath: () => ipcRenderer.invoke('get-default-download-path'),
  pathExists: (p) => ipcRenderer.invoke('path-exists', p),

  // File operations
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),
  showItemInFolder: (filePath) => ipcRenderer.invoke('show-item-in-folder', filePath),
  sendToPolyglot: (filePath) => ipcRenderer.invoke('send-to-polyglot', filePath),

  // Make (변환)
  makeGif: (options) => ipcRenderer.invoke('make-gif', options),
  makeVertical: (options) => ipcRenderer.invoke('make-vertical', options),
  makeMirror: (options) => ipcRenderer.invoke('make-mirror', options),
  makeStoryboard: (options) => ipcRenderer.invoke('make-storyboard', options),
  makeSlides: (options) => ipcRenderer.invoke('make-slides', options),
  cancelConvert: () => ipcRenderer.send('cancel-convert'),
  onConvertProgress: (callback) => {
    ipcRenderer.on('convert-progress', (event, data) => callback(data));
  },

  // Clipboard watch
  onClipboardUrl: (callback) => {
    ipcRenderer.on('clipboard-url', (event, url) => callback(url));
  },

  // Progress listener
  onDownloadProgress: (callback) => {
    ipcRenderer.on('download-progress', (event, data) => callback(data));
  },
  removeDownloadProgressListener: () => {
    ipcRenderer.removeAllListeners('download-progress');
  },
});
