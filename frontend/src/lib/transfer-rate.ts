export interface TransferRateSnapshot {
  bytesPerSecond: number | null
  etaSeconds: number | null
}

const SAMPLE_INTERVAL_MS = 500

export class TransferRateTracker {
  private totalBytes = 0
  private currentBytes = 0
  private lastSampleAt = -1
  private lastSampleBytes = 0
  private smoothedBytesPerSecond: number | null = null

  start(totalBytes: number, initialBytes = 0, now = Date.now()): void {
    this.totalBytes = Math.max(0, totalBytes)
    this.currentBytes = Math.max(0, initialBytes)
    this.lastSampleAt = now
    this.lastSampleBytes = this.currentBytes
    this.smoothedBytesPerSecond = null
  }

  update(currentBytes: number, now = Date.now()): TransferRateSnapshot {
    const bounded = Math.min(Math.max(0, currentBytes), this.totalBytes)
    this.currentBytes = bounded

    if (this.lastSampleAt < 0) {
      this.lastSampleAt = now
      this.lastSampleBytes = bounded
      return this.snapshot()
    }

    const elapsedMs = now - this.lastSampleAt
    if (elapsedMs < SAMPLE_INTERVAL_MS) return this.snapshot()

    const deltaBytes = bounded - this.lastSampleBytes
    if (deltaBytes >= 0) {
      const instant = (deltaBytes * 1000) / elapsedMs
      this.smoothedBytesPerSecond =
        this.smoothedBytesPerSecond === null
          ? instant
          : this.smoothedBytesPerSecond * 0.6 + instant * 0.4
    }

    this.lastSampleAt = now
    this.lastSampleBytes = bounded
    return this.snapshot()
  }

  snapshot(): TransferRateSnapshot {
    const bytesPerSecond =
      this.smoothedBytesPerSecond !== null && this.smoothedBytesPerSecond > 0
        ? this.smoothedBytesPerSecond
        : null

    if (bytesPerSecond === null || this.currentBytes >= this.totalBytes) {
      return { bytesPerSecond, etaSeconds: null }
    }

    return {
      bytesPerSecond,
      etaSeconds: (this.totalBytes - this.currentBytes) / bytesPerSecond,
    }
  }

  reset(): void {
    this.totalBytes = 0
    this.currentBytes = 0
    this.lastSampleAt = -1
    this.lastSampleBytes = 0
    this.smoothedBytesPerSecond = null
  }
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '—'
  if (seconds < 1) return '<1s'
  if (seconds < 60) return `${Math.ceil(seconds)}s`
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ${Math.ceil(seconds % 60)}s`
  }
  return `${Math.floor(seconds / 3600)}h ${Math.ceil((seconds % 3600) / 60)}m`
}
