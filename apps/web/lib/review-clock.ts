export interface ClockTiming {
  timeBase: string; presentationOriginPts: number; pts: number[]; duration: string;
  width: number; height: number; observedFps: string
}
export interface ClockVariant {
  level: number; browserOriginSeconds: string; initDecodeSeconds: string; timeBase: string;
  segments: { sequence: number; firstNormalizedPresentationSeconds: string; sha256: string }[]
}
export interface ReviewClockEvidence {
  timing: ClockTiming;
  reviewClock: {
    schema: 'freeframe-review-clock/v1'; versionId: string; clockSha256: string;
    rawSha256: string; reviewSha256: string; timingSha256: string;
    hls: { variants: ClockVariant[] }
  }
}
export interface PlaybackCalibration {
  reviewClockSha256: string; level: number; sequence: number;
  measuredOriginSeconds: number; hlsInitPts: number; hlsTimescale: number;
}

export function rationalNumber(value: string): number {
  const [numerator, denominator = '1'] = value.split('/');
  const result = Number(numerator) / Number(denominator);
  if (!Number.isFinite(result) || Number(denominator) <= 0) throw new Error('Invalid native frame timing');
  return result;
}
export function presentationTimes(evidence: ReviewClockEvidence): number[] {
  const t = evidence.timing;
  return t.pts.map((p) => (p - t.presentationOriginPts) * rationalNumber(t.timeBase));
}
export function nearestReviewIndex(evidence: ReviewClockEvidence, seconds: number): number {
  const times = presentationTimes(evidence);
  return times.reduce((best, value, index) => Math.abs(value - seconds) < Math.abs(times[best] - seconds) ? index : best, 0);
}
export function calibrateHls(
  evidence: ReviewClockEvidence, level: number, sequence: number, videoStartPts: number,
  hlsInitPts: number, hlsTimescale: number,
): PlaybackCalibration | null {
  const variant = evidence.reviewClock.hls.variants.find((v) => v.level === level);
  const segment = variant?.segments.find((s) => s.sequence === sequence);
  if (!variant || !segment || ![videoStartPts,hlsInitPts,hlsTimescale].every(Number.isFinite) || hlsTimescale <= 0) return null;
  const measuredOriginSeconds = videoStartPts - rationalNumber(segment.firstNormalizedPresentationSeconds);
  const tick = rationalNumber(variant.timeBase);
  if (Math.abs(measuredOriginSeconds - rationalNumber(variant.browserOriginSeconds)) > tick
    || Math.abs(hlsInitPts / hlsTimescale - rationalNumber(variant.initDecodeSeconds)) > tick) return null;
  return { reviewClockSha256:evidence.reviewClock.clockSha256,level,sequence,measuredOriginSeconds,hlsInitPts,hlsTimescale };
}
export function presentedReviewFrame(evidence: ReviewClockEvidence, calibration: PlaybackCalibration, mediaTime: number) {
  if (calibration.reviewClockSha256 !== evidence.reviewClock.clockSha256 || !Number.isFinite(mediaTime)) return null;
  const variant = evidence.reviewClock.hls.variants.find((v) => v.level === calibration.level);
  if (!variant) return null;
  const time = mediaTime - rationalNumber(variant.browserOriginSeconds);
  const index = nearestReviewIndex(evidence,time); const canonicalTime = presentationTimes(evidence)[index];
  if (Math.abs(time-canonicalTime) > rationalNumber(variant.timeBase)) return null;
  return { index, canonicalTime, mediaTime };
}
export function annotationClockCapture(evidence: ReviewClockEvidence | null, calibration: PlaybackCalibration | null, mediaTime: number | null) {
  const frame = evidence && calibration && mediaTime !== null ? presentedReviewFrame(evidence,calibration,mediaTime) : null;
  if (!evidence || !calibration || !frame) throw new Error('Wait for verified frame timing before adding timed video feedback.');
  const variant=evidence.reviewClock.hls.variants.find((v) => v.level===calibration.level)!;
  const segment=variant.segments.find((s,i) => frame.canonicalTime>=rationalNumber(s.firstNormalizedPresentationSeconds)
    && frame.canonicalTime<(i+1<variant.segments.length?rationalNumber(variant.segments[i+1].firstNormalizedPresentationSeconds):rationalNumber(evidence.timing.duration)));
  if (!segment) throw new Error('The displayed frame has no verified media segment.');
  return { schema:'freeframe-annotation-clock/v1',...calibration,sequence:segment.sequence,mediaTimeSeconds:frame.mediaTime,reviewIndex:frame.index };
}

/** Frame labels count actual presented PTS within the second, including VFR. */
export function formatReviewedTimecode(seconds: number, evidence: ReviewClockEvidence): string {
  const times=presentationTimes(evidence); const index=nearestReviewIndex(evidence,seconds);
  const whole=Math.floor(times[index]); const first=times.findIndex((t) => Math.floor(t)===whole);
  return [Math.floor(whole/3600),Math.floor(whole/60)%60,whole%60,index-first].map((n) => String(n).padStart(2,'0')).join(':');
}

/** Keep a drawing on the frame where its first pointer-down was captured. */
export function verifiedDrawingData(
  annotation:Record<string,unknown>, capture:ReturnType<typeof annotationClockCapture>,
):Record<string,unknown> {
  const drawn=annotation._reviewClockCapture as Record<string,unknown>|null|undefined
  if (!drawn || drawn.reviewClockSha256!==capture.reviewClockSha256 || drawn.reviewIndex!==capture.reviewIndex) {
    throw new Error('The drawing was made on a different or unverified frame. Clear it and redraw on the selected reviewed frame.')
  }
  const {_reviewClockCapture:_localCapture,...drawingData}=annotation
  return drawingData
}

/** Seek inside the native display interval; proof remains its original presented PTS. */
export function reviewedFrameSeekSeconds(evidence:ReviewClockEvidence,index:number):number {
  const times=presentationTimes(evidence)
  if (!Number.isInteger(index) || index<0 || index>=times.length) throw new Error('Unknown reviewed frame')
  const end=index+1<times.length ? times[index+1] : rationalNumber(evidence.timing.duration)
  if (end<=times[index]) throw new Error('Invalid reviewed frame display interval')
  return (times[index]+end)/2
}
