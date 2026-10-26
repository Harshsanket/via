import { describe, expect, it } from 'vitest'

import { TransferRateTracker, formatDuration } from './transfer-rate'

describe('TransferRateTracker', () => {
  it('estimates speed and ETA after a sample interval', () => {
    const tracker = new TransferRateTracker()
    tracker.start(1_000, 0, 0)

    expect(tracker.update(100, 250).bytesPerSecond).toBeNull()

    const snapshot = tracker.update(500, 1_000)
    expect(snapshot.bytesPerSecond).toBeCloseTo(500)
    expect(snapshot.etaSeconds).toBeCloseTo(1)
  })

  it('starts from a resumed offset without counting skipped bytes', () => {
    const tracker = new TransferRateTracker()
    tracker.start(1_000, 400, 0)

    const snapshot = tracker.update(500, 1_000)
    expect(snapshot.bytesPerSecond).toBeCloseTo(100)
    expect(snapshot.etaSeconds).toBeCloseTo(5)
  })

  it('reports no ETA when complete', () => {
    const tracker = new TransferRateTracker()
    tracker.start(100, 0, 0)
    tracker.update(100, 1_000)

    expect(tracker.snapshot()).toEqual({
      bytesPerSecond: 100,
      etaSeconds: null,
    })
  })
})

describe('formatDuration', () => {
  it('formats short and long durations', () => {
    expect(formatDuration(null)).toBe('—')
    expect(formatDuration(0.5)).toBe('<1s')
    expect(formatDuration(5)).toBe('5s')
    expect(formatDuration(65)).toBe('1m 5s')
    expect(formatDuration(3_700)).toBe('1h 2m')
  })
})
