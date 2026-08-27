declare module "*.css"

interface Window {
  readonly forge: import("@forge/contracts").ForgeBridge
  readonly forgeStyleNonce?: string
}
