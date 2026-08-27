import { contextBridge, ipcRenderer } from "electron"

import { createForgeBridge } from "./bridge.js"

const styleNonceArgument = process.argv.find((argument) => argument.startsWith("--forge-style-nonce="))
const styleNonce = styleNonceArgument?.slice("--forge-style-nonce=".length)
if (styleNonce === undefined || !/^[A-Za-z0-9_-]{24}$/u.test(styleNonce)) {
  throw new Error("Skill Forge style nonce is missing or invalid")
}

contextBridge.exposeInMainWorld("forge", createForgeBridge(ipcRenderer))
contextBridge.exposeInMainWorld("forgeStyleNonce", styleNonce)
