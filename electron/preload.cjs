// 预加载脚本：把桌宠主进程的接口以 window.pet 暴露给页面（页面拿不到 ipcRenderer 本身）。
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pet', {
  getInfo: () => ipcRenderer.invoke('pet:getInfo'),

  displayNear: (x, y) => ipcRenderer.invoke('pet:displayNear', x, y),

  getCursor: () => ipcRenderer.invoke('pet:getCursor'),

  // 桌面图标矩形（屏幕坐标，只读）；{ ok, count, icons: [{x,y,w,h}], updatedAt }
  desktopIcons: () => ipcRenderer.invoke('pet:desktopIcons'),

  setBounds: (x, y, width, height) => {
    ipcRenderer.send('pet:setBounds', x, y, width, height);
  },

  setIgnoreMouse: (ignore) => {
    ipcRenderer.send('pet:setIgnoreMouse', ignore);
  },

  saveSettings: (obj) => {
    ipcRenderer.send('pet:saveSettings', obj);
  },

  setOutfits: (list) => {
    ipcRenderer.send('pet:setOutfits', list);
  },

  setMotions: (list) => {
    ipcRenderer.send('pet:setMotions', list);
  },

  setState: (state) => {
    ipcRenderer.send('pet:setState', state);
  },

  showMenu: () => {
    ipcRenderer.send('pet:showMenu');
  },

  onCommand: (callback) => {
    if (typeof callback !== 'function') {
      throw new TypeError('onCommand 的参数必须是函数');
    }

    // 只传递命令，不向页面暴露 Electron 事件对象。
    const listener = (_event, command) => callback(command);
    ipcRenderer.on('pet:command', listener);

    // 返回取消订阅函数，便于页面卸载或开发热更新时清理。
    return () => {
      ipcRenderer.removeListener('pet:command', listener);
    };
  },

  quit: () => {
    ipcRenderer.send('pet:quit');
  },
});
