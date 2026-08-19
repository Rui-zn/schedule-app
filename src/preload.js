'use strict';

/**
 * preload：通过 contextBridge 暴露 window.scheduleAPI。
 * 渲染层只能通过这里访问主进程能力（IPC 契约见 docs/PROJECT.md 第 7 节）。
 */

const { contextBridge, ipcRenderer } = require('electron');

const api = {
  categories: {
    list: () => ipcRenderer.invoke('category:list'),
    create: (data) => ipcRenderer.invoke('category:create', data),
    update: (data) => ipcRenderer.invoke('category:update', data),
    remove: (id) => ipcRenderer.invoke('category:remove', { id })
  },
  schedules: {
    query: (params) => ipcRenderer.invoke('schedule:query', params),
    get: (id) => ipcRenderer.invoke('schedule:get', { id }),
    create: (data) => ipcRenderer.invoke('schedule:create', data),
    update: (data) => ipcRenderer.invoke('schedule:update', data),
    remove: (id) => ipcRenderer.invoke('schedule:remove', { id }),
    toggleDone: (id, done) => ipcRenderer.invoke('schedule:toggleDone', { id, done })
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch)
  },
  autostart: {
    status: () => ipcRenderer.invoke('autostart:status'),
    toggle: (enabled) => ipcRenderer.invoke('autostart:toggle', { enabled })
  },
  data: {
    chooseDir: () => ipcRenderer.invoke('data:chooseDir'),
    switchDir: (dir, moveExisting) => ipcRenderer.invoke('data:switch', { dir, moveExisting }),
    resetDir: () => ipcRenderer.invoke('data:resetDir')
  },
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    openDataPath: () => ipcRenderer.invoke('app:openDataPath')
  },
  onDataChanged: (cb) => {
    ipcRenderer.on('data:changed', () => cb());
  }
};

contextBridge.exposeInMainWorld('scheduleAPI', api);
