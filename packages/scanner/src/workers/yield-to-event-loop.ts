/** Gives timers, IPC, and renderer work a turn without imposing an arbitrary delay. */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}
