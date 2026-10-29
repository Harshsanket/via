/**
 * Free space the browser reports for this origin, or null when the estimate
 * is unavailable. `quota` is usually generous (a share of the disk), so this
 * is a sanity check, not a guarantee that the chosen file has room.
 */
export const getAvailableBytes = (
  estimate: StorageEstimate | null | undefined,
): number | null => {
  const quota = estimate?.quota
  if (typeof quota !== 'number' || !Number.isFinite(quota) || quota <= 0) {
    return null
  }
  const usage = estimate?.usage
  const used = typeof usage === 'number' && Number.isFinite(usage) ? usage : 0
  return Math.max(0, quota - used)
}

/** True unless the browser says there is not enough room for the file. */
export const hasEnoughStorage = async (requiredBytes: number): Promise<boolean> => {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return true
  }

  try {
    const available = getAvailableBytes(await navigator.storage.estimate())
    return available === null || available >= requiredBytes
  } catch {
    return true
  }
}
