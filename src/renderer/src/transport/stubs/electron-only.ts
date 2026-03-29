export function notAvailableInWeb(name: string) {
  return async (..._args: unknown[]) => {
    console.warn(`[web-mode] ${name} is not available in web mode`)
    return { success: false, error: `${name} is not available in web mode` }
  }
}

export function noopSubscription(): () => void {
  return () => {}
}

export function noopAsync() {
  return async () => {}
}

export function noopSync() {
  return () => {}
}
