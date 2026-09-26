/**
 * 高频进度事件的节流合并（等价 ZCode workflowRunThrottle）：单位时间内至多
 * 落一次最新帧，尾部帧必达——不丢终态，只压中间帧。
 */

/**
 * Wrap a handler so it runs at most once per interval, always with the latest arguments.
 * @param handler - the handler to throttle.
 * @param intervalMs - minimum spacing between invocations.
 * @returns the throttled handler with a `flush` for terminal frames.
 */
export function createThrottledHandler<A>(handler: (argument: A) => void, intervalMs: number): {
  (argument: A): void
  flush(): void
} {
  let last = 0
  let pending: { argument: A } | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const run = (): void => {
    timer = undefined
    last = Date.now()
    const argument = pending?.argument
    pending = undefined
    if (argument !== undefined) handler(argument)
  }
  const throttled = (argument: A): void => {
    pending = { argument }
    if (timer !== undefined) return
    const wait = Math.max(0, intervalMs - (Date.now() - last))
    if (wait === 0) {
      run()
      return
    }
    timer = setTimeout(run, wait)
  }
  throttled.flush = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer)
      run()
      return
    }
    if (pending !== undefined) run()
  }
  return throttled
}
