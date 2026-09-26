import { describe, expect, it } from 'vitest'
import {
  annotationClockCapture,
  calibrateHls,
  formatReviewedTimecode,
  nearestReviewIndex,
  presentationTimes,
  presentedReviewFrame,
  reviewedFrameSeekSeconds,
  verifiedDrawingData,
  type ReviewClockEvidence,
} from '../review-clock'

function evidence(originPts = 0, browserOrigin = '0'): ReviewClockEvidence {
  return {
    timing: {
      timeBase: '1/24000', presentationOriginPts: originPts,
      pts: [0, 1000, 2000, 3100, 24240].map((pts) => pts + originPts),
      duration: '3/2', width: 1920, height: 1080, observedFps: '24/1',
    },
    reviewClock: {
      schema: 'freeframe-review-clock/v1', versionId: 'review-version',
      clockSha256: 'c'.repeat(64), rawSha256: 'a'.repeat(64),
      reviewSha256: 'b'.repeat(64), timingSha256: 'd'.repeat(64),
      hls: { variants: [{
        level: 0, browserOriginSeconds: browserOrigin, initDecodeSeconds: '7/5',
        timeBase: '1/90000', segments: [
          { sequence: 40, firstNormalizedPresentationSeconds: '0', sha256: 'e'.repeat(64) },
        ],
      }] },
    },
  }
}

function calibration(value: ReviewClockEvidence, origin = 0) {
  const measured = calibrateHls(value, 0, 40, origin, 126000, 90000)
  expect(measured).not.toBeNull()
  return measured!
}

describe('native review presentation clock', () => {
  it.each([0, 9000])('normalizes actual PTS with presentation origin %i', (originPts) => {
    const actual = presentationTimes(evidence(originPts))
    const expected = [0, 1 / 24, 1 / 12, 3100 / 24000, 1.01]
    expect(actual).toHaveLength(expected.length)
    actual.forEach((time, index) => expect(time).toBeCloseTo(expected[index], 12))
  })

  it('uses nearest actual VFR PTS and never reconstructs a nominal 24 fps frame', () => {
    const value = evidence()
    expect(nearestReviewIndex(value, 0.128)).toBe(3)
    expect(presentationTimes(value)[3]).toBeCloseTo(3100 / 24000, 12)
    expect(presentationTimes(value)[3]).not.toBe(3 / 24)
    // The frame label counts actual PTS within that second even when the
    // provider's observed average reports 24 fps.
    expect(formatReviewedTimecode(0.128, value)).toBe('00:00:00:03')
    expect(formatReviewedTimecode(1.01, value)).toBe('00:00:01:00')
    value.timing.observedFps = '12/1'
    expect(formatReviewedTimecode(0.128, value)).toBe('00:00:00:03')
  })

  it.each([['0', 0], ['7/5', 1.4]] as const)('calibrates browser origin %s separately from media PTS', (origin, seconds) => {
    const value = evidence(9000, origin)
    const measured = calibration(value, seconds)
    expect(measured.measuredOriginSeconds).toBe(seconds)
    const frame = presentedReviewFrame(value, measured, seconds + 3100 / 24000)
    expect(frame?.index).toBe(3)
    expect(frame?.canonicalTime).toBeCloseTo(3100 / 24000, 12)
  })

  it('accepts presented rVFC time within a native tick and rejects nominal currentTime between frames', () => {
    const value = evidence()
    const measured = calibration(value)
    const actualTime = 3100 / 24000
    const tick = 1 / 90000
    expect(presentedReviewFrame(value, measured, actualTime + tick / 2)?.index).toBe(3)
    expect(presentedReviewFrame(value, measured, actualTime + tick * 1.1)).toBeNull()
    expect(presentedReviewFrame(value, measured, 0.1)).toBeNull()
    expect(() => annotationClockCapture(value, measured, 0.1)).toThrow('Wait for verified frame timing')
  })

  it('denies capture while native evidence, calibration or the presented frame is pending', () => {
    const value = evidence()
    const measured = calibration(value)
    expect(() => annotationClockCapture(null, measured, 0)).toThrow()
    expect(() => annotationClockCapture(value, null, 0)).toThrow()
    expect(() => annotationClockCapture(value, measured, null)).toThrow()
    expect(presentedReviewFrame(value, measured, Number.NaN)).toBeNull()
    expect(presentedReviewFrame(value, { ...measured, reviewClockSha256: 'f'.repeat(64) }, 0)).toBeNull()
  })

  it('captures the displayed segment even when calibration came from a future buffered segment', () => {
    const value = evidence(9000, '7/5')
    value.timing.timeBase = '1/30000'
    value.timing.pts = [0, 1000, 3100, 45000, 46000, 90000, 91000].map((pts) => pts + 9000)
    value.timing.duration = '4'
    value.reviewClock.hls.variants[0].segments = [
      { sequence: 40, firstNormalizedPresentationSeconds: '0', sha256: '1'.repeat(64) },
      { sequence: 41, firstNormalizedPresentationSeconds: '3/2', sha256: '2'.repeat(64) },
      { sequence: 42, firstNormalizedPresentationSeconds: '3', sha256: '3'.repeat(64) },
    ]
    const futureBuffer = calibrateHls(value, 0, 42, 4.4, 126000, 90000)
    expect(futureBuffer?.sequence).toBe(42)
    const capture = annotationClockCapture(value, futureBuffer, 1.4 + 46000 / 30000)
    expect(capture.sequence).toBe(41)
    expect(capture.reviewIndex).toBe(4)
    expect(capture.reviewClockSha256).toBe(value.reviewClock.clockSha256)
    expect(annotationClockCapture(value, futureBuffer, 2.9).sequence).toBe(41)
  })

  it('rejects mismatched native init decode time, browser offset and unknown HLS segments', () => {
    const value = evidence(9000, '7/5')
    expect(calibrateHls(value, 0, 40, 1.4, 126003, 90000)).toBeNull()
    expect(calibrateHls(value, 0, 40, 1.4001, 126000, 90000)).toBeNull()
    expect(calibrateHls(value, 0, 999, 1.4, 126000, 90000)).toBeNull()
    expect(calibrateHls(value, 1, 40, 1.4, 126000, 90000)).toBeNull()
    expect(calibrateHls(value, 0, 40, 1.4, 126000, 0)).toBeNull()
  })
})

describe('drawing frame identity', () => {
  it('preserves exact drawing geometry and strips only the local capture', () => {
    const value = evidence(9000, '7/5')
    const captured = annotationClockCapture(value, calibration(value, 1.4), 1.4 + 3100 / 24000)
    const geometry = {
      _canvasWidth: 960, _canvasHeight: 540, _frameSpace: 'media',
      objects: [{ type: 'path', stroke: '#ff0000', strokeWidth: 3,
        path: [['M', 120, 200], ['Q', 140, 215, 160, 210], ['L', 175, 205]],
      }],
    }
    const annotation = { ...geometry, _reviewClockCapture: captured }
    expect(verifiedDrawingData(annotation, { ...captured })).toEqual(geometry)
    expect(verifiedDrawingData(annotation, captured)).not.toHaveProperty('_reviewClockCapture')
    expect(annotation._reviewClockCapture).toBe(captured)
    expect(annotation.objects[0].path[1]).toEqual(['Q', 140, 215, 160, 210])
  })

  it('rejects pending/missing capture and a drawing captured on another clock or frame', () => {
    const value = evidence()
    const captured = annotationClockCapture(value, calibration(value), 1000 / 24000)
    const geometry = { objects: [{ type: 'path', path: [['M', 10, 20], ['L', 30, 40]] }] }
    for (const stored of [null, undefined,
      { ...captured, reviewClockSha256: 'f'.repeat(64) },
      { ...captured, reviewIndex: captured.reviewIndex + 1 },
    ]) {
      expect(() => verifiedDrawingData({ ...geometry, _reviewClockCapture: stored }, captured)).toThrow('different or unverified frame')
    }
    expect(() => verifiedDrawingData(geometry, captured)).toThrow('different or unverified frame')
  })
})

describe('seek within the native frame display interval', () => {
  it.each([0, 9000])('seeks to a VFR midpoint without changing canonical frame proof at origin %i', (originPts) => {
    const value = evidence(originPts)
    const before = presentationTimes(value)
    const seek = reviewedFrameSeekSeconds(value, 2)
    expect(seek).toBeCloseTo((2000 / 24000 + 3100 / 24000) / 2, 12)
    expect(seek).toBeGreaterThan(before[2])
    expect(seek).toBeLessThan(before[3])
    expect(seek).not.toBe(2.5 / 24)
    expect(presentationTimes(value)).toEqual(before)
  })

  it('uses duration for the final frame interval and stays before the media end', () => {
    const value = evidence(9000)
    const last = value.timing.pts.length - 1
    const seek = reviewedFrameSeekSeconds(value, last)
    expect(seek).toBeCloseTo((1.01 + 1.5) / 2, 12)
    expect(seek).toBeGreaterThan(presentationTimes(value)[last])
    expect(seek).toBeLessThan(1.5)
  })

  it.each([-1, 5, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects unknown frame index %s', (index) => {
    expect(() => reviewedFrameSeekSeconds(evidence(), index)).toThrow('Unknown reviewed frame')
  })

  it('rejects zero/reversed display intervals including a last frame beyond duration', () => {
    const repeated = evidence()
    repeated.timing.pts[3] = repeated.timing.pts[2]
    expect(() => reviewedFrameSeekSeconds(repeated, 2)).toThrow('Invalid reviewed frame display interval')
    const reversed = evidence()
    reversed.timing.pts[3] = reversed.timing.pts[2] - 1
    expect(() => reviewedFrameSeekSeconds(reversed, 2)).toThrow('Invalid reviewed frame display interval')
    const ended = evidence()
    ended.timing.duration = '1'
    expect(() => reviewedFrameSeekSeconds(ended, 4)).toThrow('Invalid reviewed frame display interval')
  })
})
