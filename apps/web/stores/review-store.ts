import { create } from 'zustand'
import type { Asset, AssetVersion } from '@/types'
import type { PlaybackCalibration, ReviewClockEvidence } from '@/lib/review-clock'

type DrawingTool = 'pen' | 'rectangle' | 'arrow' | 'line'
export type TimeFormat = 'standard' | 'timecode' | 'frames'

interface ReviewState {
  currentAsset: Asset | null
  currentVersion: AssetVersion | null
  playheadTime: number
  seekTarget: { time: number; id: number; pause?: boolean; clock?: 'canonical' | 'legacy' } | null
  reviewClock: ReviewClockEvidence | null
  playbackCalibration: PlaybackCalibration | null
  presentedMediaTime: number | null
  reviewFrameIndex: number | null
  setReviewClock: (evidence: ReviewClockEvidence | null) => void
  setPlaybackCalibration: (calibration: PlaybackCalibration | null) => void
  setPresentedFrame: (mediaTime: number | null, index: number | null, canonicalTime?: number) => void
  focusedCommentId: string | null
  pendingAnnotation: Record<string, unknown> | null
  activeAnnotation: Record<string, unknown> | null
  timeFormat: TimeFormat
  isDrawingMode: boolean
  drawingTool: DrawingTool
  drawingColor: string
  brushSize: number
  setCurrentAsset: (asset: Asset) => void
  setCurrentVersion: (version: AssetVersion) => void
  setPlayheadTime: (time: number) => void
  seekTo: (time: number, pause?: boolean, clock?: 'canonical' | 'legacy') => void
  setFocusedCommentId: (id: string | null) => void
  setPendingAnnotation: (data: Record<string, unknown> | null) => void
  setActiveAnnotation: (data: Record<string, unknown> | null) => void
  setTimeFormat: (format: TimeFormat) => void
  toggleDrawingMode: () => void
  setIsDrawingMode: (mode: boolean) => void
  setDrawingTool: (tool: DrawingTool) => void
  setDrawingColor: (color: string) => void
  setBrushSize: (size: number) => void
  reset: () => void
}

const initialState = {
  currentAsset: null,
  currentVersion: null,
  playheadTime: 0,
  seekTarget: null,
  reviewClock: null,
  playbackCalibration: null,
  presentedMediaTime: null,
  reviewFrameIndex: null,
  focusedCommentId: null,
  pendingAnnotation: null,
  activeAnnotation: null,
  timeFormat: 'timecode' as TimeFormat,
  isDrawingMode: false,
  drawingTool: 'pen' as DrawingTool,
  drawingColor: '#FF3B30',
  brushSize: 4,
}

export const useReviewStore = create<ReviewState>()((set) => ({
  ...initialState,

  setCurrentAsset: (asset: Asset) => {
    set({ currentAsset: asset, playheadTime: 0, seekTarget: null })
  },

  setCurrentVersion: (version: AssetVersion) => {
    set((state) =>
      state.currentVersion != null && state.currentVersion.id !== version.id
        ? { currentVersion: version, activeAnnotation: null, focusedCommentId: null, reviewClock:null, playbackCalibration:null, presentedMediaTime:null, reviewFrameIndex:null }
        : { currentVersion: version },
    )
  },
  setReviewClock: (evidence) => set({reviewClock:evidence,playbackCalibration:null,presentedMediaTime:null,reviewFrameIndex:null}),
  setPlaybackCalibration: (calibration) => set({playbackCalibration:calibration}),
  setPresentedFrame: (mediaTime,index,canonicalTime) => set({presentedMediaTime:mediaTime,reviewFrameIndex:index,...(canonicalTime===undefined?{}:{playheadTime:canonicalTime})}),

  setPlayheadTime: (time: number) => {
    set({ playheadTime: time })
  },

  seekTo: (time: number, pause?: boolean, clock: 'canonical' | 'legacy' = 'canonical') => {
    set({ seekTarget: { time, id: Date.now(), pause, clock }, playheadTime: time })
  },

  setFocusedCommentId: (id: string | null) => {
    set({ focusedCommentId: id })
  },

  setPendingAnnotation: (data: Record<string, unknown> | null) => {
    set({ pendingAnnotation: data })
  },

  setActiveAnnotation: (data: Record<string, unknown> | null) => {
    set({ activeAnnotation: data })
  },

  setTimeFormat: (format: TimeFormat) => {
    set({ timeFormat: format })
  },

  toggleDrawingMode: () => {
    set((state) => ({ isDrawingMode: !state.isDrawingMode }))
  },

  setIsDrawingMode: (mode: boolean) => {
    set({ isDrawingMode: mode })
  },

  setDrawingTool: (tool: DrawingTool) => {
    set({ drawingTool: tool })
  },

  setDrawingColor: (color: string) => {
    set({ drawingColor: color })
  },

  setBrushSize: (size: number) => {
    set({ brushSize: size })
  },

  reset: () => {
    set(initialState)
  },
}))
