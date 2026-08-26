import { contextBridge, ipcRenderer } from "electron"

import { createForgeBridge } from "./bridge.js"

contextBridge.exposeInMainWorld("forge", createForgeBridge(ipcRenderer))
