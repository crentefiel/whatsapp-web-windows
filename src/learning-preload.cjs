'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('learningAPI', {
  getData: () => ipcRenderer.invoke('learning:getData'),
});
