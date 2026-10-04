"use client";

import { useTranslation } from '@/lib/i18n/locale-provider'
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Maximize,
  Minimize,
  Pause,
  Play,
  Volume2,
  VolumeX,
  ChevronUp,
  Check,
  Repeat,
  MoreHorizontal,
} from "lucide-react";
import { cn, formatTime, formatTimecode, formatFrames } from "@/lib/utils";
import { renderedMediaBox } from "@/lib/media-frame";
import { api } from "@/lib/api";
import { useReviewStore, type TimeFormat } from "@/stores/review-store";
import { useVideoPlayer } from "@/hooks/use-video-player";
import { useMediaQuery, MEDIA_SM } from "@/hooks/use-media-query";
import { useReview } from "./review-provider";
import { ProgressBar } from "./progress-bar";
import type { Comment } from "@/types";
import { formatReviewedTimecode, nearestReviewIndex, presentationTimes, type ReviewClockEvidence } from '@/lib/review-clock';

// ─── Types ────────────────────────────────────────────────────────────────────

interface StreamUrlResponse {
  url: string;
}

interface VideoPlayerProps {
  assetId: string;
  comments?: Comment[];
  overlay?: React.ReactNode;
  className?: string;
  /** Pre-fetched stream URL (for share mode — skips authenticated API call) */
  initialStreamUrl?: string | null;
}

// ─── Video frame constraint ──────────────────────────────────────────────────

/**
 * Wraps children so they are positioned exactly over the visible video frame,
 * excluding the black letterbox bars created by object-contain.
 *
 * Exported for the compare overlay: annotations are AUTHORED inside this
 * constraint (video-frame coordinates), so any viewer that renders them must
 * mount the overlay in the same space.
 */
export function VideoFrameConstraint({
  videoRef,
  children,
}: {
  videoRef: React.RefObject<HTMLVideoElement>;
  children: React.ReactNode;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const calc = () => {
      // Measured from the element's own box, exactly like the image constraint.
      // The main player's <video> is `w-full h-full object-contain`, so its box
      // IS the container and this reduces to fitting against the container. The
      // compare panes use `max-h-full max-w-full`, where the element only ever
      // shrinks and so already hugs the picture — deriving the fit from the
      // container there would upscale the box and misplace every annotation.
      const box = renderedMediaBox({
        naturalWidth: video.videoWidth,
        naturalHeight: video.videoHeight,
        elementWidth: video.offsetWidth,
        elementHeight: video.offsetHeight,
        offsetLeft: video.offsetLeft,
        offsetTop: video.offsetTop,
      });

      if (!box) {
        // Not laid out yet — fill the container and recompute on the next
        // loadedmetadata/resize.
        setStyle({ position: "absolute", inset: 0 });
        return;
      }

      setStyle({
        position: "absolute",
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
      });
    };

    calc();
    video.addEventListener("loadedmetadata", calc);
    video.addEventListener("resize", calc);

    // Observe both: under `max-*` a container resize only RECENTRES the element,
    // moving offsetLeft/offsetTop without changing its own box, and
    // ResizeObserver does not fire on a position-only change.
    const ro = new ResizeObserver(calc);
    ro.observe(video);
    if (video.parentElement) ro.observe(video.parentElement);

    return () => {
      video.removeEventListener("loadedmetadata", calc);
      video.removeEventListener("resize", calc);
      ro.disconnect();
    };
  }, [videoRef]);

  return (
    <div ref={wrapperRef} style={style} className="overflow-hidden">
      {children}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export function VideoPlayer({
  assetId,
  comments = [],
  overlay,
  className,
  initialStreamUrl,
}: VideoPlayerProps) {
  const tr = useTranslation()

  const containerRef = useRef<HTMLDivElement>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [clockEvidence,setClockEvidence] = useState<ReviewClockEvidence|null>(null);
  const [loop, setLoop] = useState(false);

  const { isDrawingMode, timeFormat, setTimeFormat, setPlayheadTime, currentVersion } =
    useReviewStore();
  const { registerPauseHandler } = useReview();
  const [timeFormatOpen, setTimeFormatOpen] = useState(false);
  // The media's own width/height ratio, used to size the stage on a portrait
  // phone. 16/9 until `loadedmetadata` lands, so nothing jumps in the common
  // case. See the stage below for why this is needed at all.
  const [mediaAspect, setMediaAspect] = useState(16 / 9);

  // Below `sm` the transport row runs out of width and the controls crowd, so
  // the secondary ones move behind an overflow menu and the primary ones get a
  // 44px touch target instead of 28px.
  const compact = !useMediaQuery(MEDIA_SM);
  const reviewFrameIndex=useReviewStore((s) => s.reviewFrameIndex);
  const clockRequired=process.env.NEXT_PUBLIC_STUDIO_SSO_ENABLED==='true';
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);
  const timeFormatRef = useRef<HTMLDivElement>(null);

  // Close the overflow menu on an outside press. `pointerdown`, not
  // `mousedown`: the scrubber calls preventDefault on its own pointer events,
  // and a touch there would otherwise never produce the compatibility mouse
  // event this needs to hear.
  useEffect(() => {
    if (!overflowOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!overflowRef.current?.contains(e.target as Node)) setOverflowOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [overflowOpen]);

  // Close time format dropdown on outside click
  useEffect(() => {
    if (!timeFormatOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        timeFormatRef.current &&
        !timeFormatRef.current.contains(e.target as Node)
      )
        setTimeFormatOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [timeFormatOpen]);

  function displayTime(seconds: number): string {
    if (clockEvidence && timeFormat==='frames') return String(nearestReviewIndex(clockEvidence,seconds));
    if (clockEvidence && timeFormat==='timecode') return formatReviewedTimecode(seconds,clockEvidence);
    switch (timeFormat) {
      case "frames":
        return formatFrames(seconds);
      case "standard":
        return formatTime(seconds);
      case "timecode":
        return formatTimecode(seconds);
      default:
        return formatTimecode(seconds);
    }
  }

  // Load the stream URL — reset immediately on asset OR version change so the old
  // video doesn't keep playing while the new URL is being fetched.
  const versionId = currentVersion?.id;
  useEffect(() => {
    // Guard against a superseded fetch: rapid version switching starts overlapping
    // requests, and without this a slower earlier response could land last and leave
    // the player on the wrong version's stream.
    let ignore = false;
    const clockAbort=new AbortController();
    let clockTimeout: ReturnType<typeof setTimeout> | undefined;
    setStreamUrl(null);
    setClockEvidence(null);
    if (clockRequired) useReviewStore.getState().setReviewClock(null);
    if (initialStreamUrl) {
      const resolved = initialStreamUrl.startsWith("/")
        ? `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}${initialStreamUrl}`
        : initialStreamUrl;
      setStreamUrl(resolved);
      return;
    }
    // Pin the stream to the selected version — without version_id the API falls
    // back to the latest version, so the switcher never actually changes the
    // playing stream (#66).
    const streamPath = versionId
      ? `/assets/${assetId}/stream?version_id=${versionId}`
      : `/assets/${assetId}/stream`;
    // Clock verification must not delay playback. Both responses are pinned to
    // this effect's exact version and discarded when the selection changes.
    if (clockRequired && versionId) {
      clockTimeout = setTimeout(() => clockAbort.abort(), 75_000);
      api.get<ReviewClockEvidence>(`/assets/${assetId}/review-clock?version_id=${versionId}`, { signal: clockAbort.signal })
        .then((evidence) => {
          if (ignore) return;
          setClockEvidence(evidence);
          useReviewStore.getState().setReviewClock(evidence);
        })
        .catch(() => { /* Precise timed writes remain disabled without verified evidence. */ })
        .finally(() => clearTimeout(clockTimeout));
    }
    api.get<StreamUrlResponse>(streamPath)
      .then((data) => {
        if (ignore) return;
        const url = data.url.startsWith("/")
          ? `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}${data.url}`
          : data.url;
        setStreamUrl(url);
      })
      .catch(() => {
        /* stream URL errors handled by player error state */
      });
    return () => {
      ignore = true;
      clockAbort.abort();
      clearTimeout(clockTimeout);
    };
  }, [assetId, initialStreamUrl, versionId,clockRequired]);

  const player = useVideoPlayer(streamUrl,{reviewClock:clockEvidence});

  const {
    videoRef,
    isPlaying,
    currentTime,
    duration,
    buffered,
    volume,
    isMuted,
    playbackRate,
    qualityLevels,
    currentQuality,
    isLoading,
    isFullscreen,
    error,
    frameDiagnostic,
    pause,
    togglePlay,
    seek,
    setPlaybackRate,
    setQuality,
    setVolume,
    toggleMute,
    toggleFullscreen,
  } = player;

  // A source can be vertical or 4:3, so the stage must not assume 16:9.
  // `resize` covers a version switch that changes the dimensions without
  // remounting the element.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const read = () => {
      if (video.videoWidth && video.videoHeight) {
        setMediaAspect(video.videoWidth / video.videoHeight);
      }
    };
    read();
    video.addEventListener("loadedmetadata", read);
    video.addEventListener("resize", read);
    return () => {
      video.removeEventListener("loadedmetadata", read);
      video.removeEventListener("resize", read);
    };
  }, [videoRef, streamUrl]);

  // Register pause handler with review provider
  useEffect(() => {
    registerPauseHandler(pause);
  }, [registerPauseHandler, pause]);

  // Sync video currentTime to review store so comment input shows same timecode
  const lastSyncRef = useRef(0);
  useEffect(() => {
    const now = Date.now();
    if (now - lastSyncRef.current > 100) {
      setPlayheadTime(currentTime);
      lastSyncRef.current = now;
    }
  }, [currentTime, setPlayheadTime]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        isDrawingMode
      ) {
        return;
      }

      switch (e.code) {
        case "Space":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          seek(currentTime - 5);
          break;
        case "ArrowRight":
          e.preventDefault();
          seek(currentTime + 5);
          break;
        case "KeyJ":
          seek(currentTime - 10);
          break;
        case "KeyK":
          togglePlay();
          break;
        case "KeyL":
          seek(currentTime + 10);
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [togglePlay, seek, currentTime, isDrawingMode]);

  const handleContainerClick = useCallback(() => {
    if (!isDrawingMode) {
      togglePlay();
    }
  }, [togglePlay, isDrawingMode]);

  const handleFullscreen = useCallback(() => {
    if (containerRef.current) {
      toggleFullscreen(containerRef.current);
    }
  }, [toggleFullscreen]);

  const handleSpeedCycle = useCallback(() => {
    const idx = SPEED_OPTIONS.indexOf(
      playbackRate as (typeof SPEED_OPTIONS)[number],
    );
    const next = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
    setPlaybackRate(next);
  }, [playbackRate, setPlaybackRate]);

  return (
    <div
      ref={containerRef}
      className={cn(
        // Top-aligned in portrait, deliberately. The stage is a fixed-ratio box,
        // so on a portrait phone there is almost always leftover height, and how
        // much depends entirely on the source: a 9:16 clip leaves ~65px, a
        // cinematic one leaves ~470px because it is only ~180px tall at full
        // width. Centring that much slack floats the picture in the middle of
        // the screen with a large gap above it, and pushes the drawing surface
        // away from the thumb. Keeping the media under the header puts the
        // leftover between the controls and the comment sheet, which is where
        // the sheet expands into anyway.
        "flex flex-col h-full w-full",
        isFullscreen && "fixed inset-0 z-50",
        className,
      )}
    >
      {/* Video area — fills available space, object-contain preserves aspect ratio with letterbox */}
      <div
        // On a portrait phone the stage used to be `flex-1` with no relationship
        // to the media, so it took every pixel the column had left and
        // `object-contain` letterboxed a 16:9 video inside a box twice its
        // height: ~200px of black above and below, with the controls pushed off
        // the bottom (#331). Below `md` in portrait it is sized from the media's
        // own ratio instead. Everywhere else it fills the column exactly as
        // before, so desktop is untouched.
        className={cn(
          "relative min-h-0 bg-black overflow-hidden cursor-pointer touch-manipulation",
          // w-full is load-bearing. With only `aspect-ratio` + `max-height`, the
          // clamped height makes the width definite via the ratio, so
          // `align-items: stretch` no longer applies and the stage ends up
          // narrower than the column and flush left: a 608x1080 source measured
          // 302px wide in a 440px column on an iPhone 16 Pro Max, with all 138px
          // of letterbox on the right. Pinning the width instead lets
          // `object-contain` centre the picture and split the bands evenly.
          // (Do not reach for `mx-auto` here: auto cross-axis margins also
          // disable stretch, and the width then collapses to the content width,
          // which is 0 because the video is absolutely positioned.)
          "flex-1 max-md:portrait:flex-none max-md:portrait:w-full max-md:portrait:aspect-[var(--stage-aspect)]",
          // A vertical source (9:16) is taller than the screen at full width, so
          // the ratio alone would push the controls back off the bottom. Cap it
          // and let `object-contain` do the rest.
          // The consumer sets --ff-stage-max to the height actually left above
          // the comment sheet, so the whole frame stays visible as the sheet
          // opens. 70dvh is the fallback for surfaces with no sheet, where the
          // only job is to stop a vertical source pushing the controls off.
          "max-md:portrait:max-h-[var(--ff-stage-max,70dvh)]",
        )}
        style={{ "--stage-aspect": String(mediaAspect) } as React.CSSProperties}
        onClick={handleContainerClick}
      >
        <video
          ref={videoRef}
          className={cn(
            "absolute inset-0 w-full h-full object-contain",
            isDrawingMode ? "pointer-events-none" : "",
          )}
          playsInline
          preload="metadata"
        />

        {/* Loading spinner */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-10 h-10 border-4 border-white/20 border-t-white rounded-full animate-spin" />
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <p className="text-red-400 text-sm">{tr(error)}</p>
          </div>
        )}

        {/* Overlay slot (annotation canvas / overlay) — constrained to video frame */}
        {overlay && (
          <VideoFrameConstraint videoRef={videoRef}>
            {overlay}
          </VideoFrameConstraint>
        )}
      </div>

      {/* Progress bar */}
      <div className="shrink-0 bg-bg-primary">
        <ProgressBar
          currentTime={currentTime}
          duration={duration}
          buffered={buffered}
          comments={comments}
          streamUrl={streamUrl}
          onSeek={seek}
        />
      </div>

      {/* Bottom transport bar (matches audio player style) */}
      {clockRequired && (
        <div role="status" className="flex items-center justify-between gap-3 px-4 py-1 text-xs text-text-secondary">
          <span>{clockEvidence && reviewFrameIndex!==null
            ? tr("Reviewed frame {value0} of {value1} · timing verified", { value0: reviewFrameIndex, value1: clockEvidence.timing.pts.length-1 })
            : clockEvidence ? tr("Waiting for a verified presented frame · play the visible viewer once") : tr("Frame timing unavailable")}</span>
          {process.env.NODE_ENV==='development' && reviewFrameIndex===null && frameDiagnostic && <span>{frameDiagnostic}</span>}
          <div className="flex gap-2">
            {[-1,1].map((step) => <button key={step} aria-label={step<0?tr("Previous reviewed frame"):tr("Next reviewed frame")}
              disabled={!clockEvidence || reviewFrameIndex===null || reviewFrameIndex+step<0 || reviewFrameIndex+step>=clockEvidence.timing.pts.length}
              onClick={() => { if (clockEvidence && reviewFrameIndex!==null) { pause(); seek(presentationTimes(clockEvidence)[reviewFrameIndex+step]); } }}
              className="rounded px-2 py-1 hover:bg-bg-hover disabled:opacity-30">{step<0?tr("Previous frame"):tr("Next frame")}</button>)}
          </div>
        </div>
      )}
      <div
        className={cn(
          "flex items-center justify-between bg-bg-secondary/80 border-t border-border shrink-0",
          // min-h, not h: the row carries its own safe-area padding below, and a
          // fixed height would let that padding eat into the 44px buttons rather
          // than growing the row.
          compact ? "min-h-12 gap-1 px-3" : "h-12 px-4",
        )}
        style={compact ? { paddingBottom: "env(safe-area-inset-bottom)" } : undefined}
      >
        {/* Left: Play, Loop, Speed, Volume */}
        <div className="flex items-center gap-2">
          <button
            onClick={togglePlay}
            className={cn("flex items-center justify-center rounded text-text-primary hover:bg-bg-hover transition-colors", compact ? "h-11 w-11" : "h-7 w-7")}
            aria-label={isPlaying ? tr("Pause") : tr("Play")}
          >
            {isPlaying ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </button>

            {!compact && (
              <>
            <button
              onClick={() => setLoop((p) => !p)}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded transition-colors",
                loop
                  ? "text-accent bg-accent/10"
                  : "text-text-tertiary hover:text-text-secondary hover:bg-bg-hover",
              )}
              aria-label={tr("Loop")}
            >
              <Repeat className="h-4 w-4" />
            </button>
  
            <button
              onClick={handleSpeedCycle}
              className="flex h-7 items-center justify-center rounded px-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors tabular-nums"
              aria-label={tr("Playback speed")}
            >
              {playbackRate}x
            </button>
  
            <button
              onClick={toggleMute}
              className="flex h-7 w-7 items-center justify-center rounded text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors"
              aria-label={isMuted ? tr("Unmute") : tr("Mute")}
            >
              {isMuted || volume === 0 ? (
                <VolumeX className="h-4 w-4" />
              ) : (
                <Volume2 className="h-4 w-4" />
              )}
            </button>
              </>
            )}
        </div>

        {/* Center: Timecode display with format picker */}
        <div className="relative" ref={timeFormatRef}>
          <button
            onClick={() => setTimeFormatOpen((p) => !p)}
            className="flex items-center gap-1.5 rounded-md bg-bg-tertiary px-3 py-1 hover:bg-bg-hover transition-colors"
          >
            <span className="font-mono text-sm text-text-primary tabular-nums tracking-wide">
              {timeFormat === "timecode" ? (
                displayTime(currentTime)
              ) : (
                <>
                  {displayTime(currentTime)}{" "}
                  <span className="text-text-tertiary">/</span>{" "}
                  {displayTime(duration)}
                </>
              )}
            </span>
            <ChevronUp
              className={cn(
                "h-3 w-3 text-text-tertiary transition-transform",
                timeFormatOpen && "rotate-180",
              )}
            />
          </button>
          {timeFormatOpen && (
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 slide-in-from-left-1/2 mb-2 z-50 w-48 rounded-xl border border-white/10 bg-[#2a2a30] shadow-2xl py-1.5 animate-in fade-in zoom-in-95 duration-100">
              <div className="px-3 py-2 text-[11px] text-text-tertiary uppercase tracking-wider font-medium">{tr("Time Format")}</div>
              {(
                [
                  { id: "frames" as TimeFormat, label: "Frames" },
                  { id: "standard" as TimeFormat, label: "Standard" },
                  { id: "timecode" as TimeFormat, label: "Timecode" },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  className={cn(
                    "flex w-full items-center justify-between px-3 py-2 text-[13px] transition-colors",
                    timeFormat === item.id
                      ? "text-text-primary"
                      : "text-text-secondary hover:bg-white/5",
                  )}
                  onClick={() => {
                    setTimeFormat(item.id);
                    setTimeFormatOpen(false);
                  }}
                >
                  {tr(item.label)}
                  {timeFormat === item.id && (
                    <Check className="h-4 w-4 text-accent" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: Quality, Fullscreen */}
        <div className="flex items-center gap-2">
          {compact && (
            <div className="relative" ref={overflowRef}>
              <button
                onClick={() => setOverflowOpen((p) => !p)}
                className="flex h-11 w-11 items-center justify-center rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
                aria-label={tr("More controls")}
                aria-expanded={overflowOpen}
              >
                <MoreHorizontal className="h-5 w-5" />
              </button>
              {overflowOpen && (
                <div className="absolute bottom-full right-0 mb-2 z-50 w-44 rounded-xl border border-border bg-bg-elevated shadow-2xl py-1.5">
                  <button
                    onClick={() => { setLoop((v) => !v); setOverflowOpen(false); }}
                    className="flex h-11 w-full items-center justify-between px-3 text-[13px] text-text-secondary hover:bg-bg-hover transition-colors"
                  >{tr("Loop")}{loop && <Check className="h-4 w-4 text-accent" />}
                  </button>
                  <button
                    onClick={() => { handleSpeedCycle(); }}
                    className="flex h-11 w-full items-center justify-between px-3 text-[13px] text-text-secondary hover:bg-bg-hover transition-colors"
                  >{tr("Speed")}<span className="tabular-nums text-text-tertiary">{playbackRate}x</span>
                  </button>
                  <button
                    onClick={() => { toggleMute(); setOverflowOpen(false); }}
                    className="flex h-11 w-full items-center justify-between px-3 text-[13px] text-text-secondary hover:bg-bg-hover transition-colors"
                  >
                    {isMuted || volume === 0 ? tr("Unmute") : tr("Mute")}
                    {isMuted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                  </button>
                </div>
              )}
            </div>
          )}
          {/* Quality selector */}
          {qualityLevels.length > 0 && (
            <select
              value={currentQuality}
              onChange={(e) => setQuality(parseInt(e.target.value, 10))}
              className="bg-transparent text-text-secondary text-xs border border-border rounded px-1.5 py-1 cursor-pointer shrink-0 hover:text-text-primary transition-colors"
              aria-label={tr("Quality")}
            >
              <option value={-1} className="bg-bg-secondary">{tr("Auto")}</option>
              {qualityLevels.map((level) => (
                <option
                  key={level.index}
                  value={level.index}
                  className="bg-bg-secondary"
                >
                  {tr(level.label)}
                </option>
              ))}
            </select>
          )}

          {/* Fullscreen */}
          <button
            onClick={handleFullscreen}
            className="flex h-7 w-7 items-center justify-center rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
            aria-label={isFullscreen ? tr("Exit fullscreen") : tr("Enter fullscreen")}
          >
            {isFullscreen ? (
              <Minimize className="h-4 w-4" />
            ) : (
              <Maximize className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
