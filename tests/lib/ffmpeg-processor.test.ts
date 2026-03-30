import { describe, it, expect } from "vitest"
import {
	convertVideo,
	trimVideo,
	extractAudio,
	convertAudio,
	trimAudio,
	videoToGif,
	gifToMp4,
	mergeVideos,
	mergeAudio,
	mergeAudioVideo,
	muteVideo,
	changeVideoSpeed,
	resizeVideo,
	cropVideo,
	addVideoWatermark,
	extractFrames,
	changeVolume,
	fadeAudio,
	prefetchFFmpeg,
} from "../../src/lib/ffmpeg-processor"

// Note: FFmpeg.wasm requires SharedArrayBuffer and WASM support not available in jsdom.
// These tests verify the functions exist and type-check correctly.
// Actual processing is tested via browser e2e.

describe("ffmpeg-processor", () => {
	it("exports all video processing functions", () => {
		expect(typeof convertVideo).toBe("function")
		expect(typeof trimVideo).toBe("function")
		expect(typeof extractAudio).toBe("function")
		expect(typeof mergeVideos).toBe("function")
		expect(typeof mergeAudioVideo).toBe("function")
		expect(typeof muteVideo).toBe("function")
		expect(typeof changeVideoSpeed).toBe("function")
		expect(typeof resizeVideo).toBe("function")
		expect(typeof cropVideo).toBe("function")
		expect(typeof addVideoWatermark).toBe("function")
		expect(typeof extractFrames).toBe("function")
	})

	it("exports all audio processing functions", () => {
		expect(typeof convertAudio).toBe("function")
		expect(typeof trimAudio).toBe("function")
		expect(typeof mergeAudio).toBe("function")
		expect(typeof changeVolume).toBe("function")
		expect(typeof fadeAudio).toBe("function")
	})

	it("exports GIF functions", () => {
		expect(typeof videoToGif).toBe("function")
		expect(typeof gifToMp4).toBe("function")
	})

	it("exports prefetchFFmpeg utility", () => {
		expect(typeof prefetchFFmpeg).toBe("function")
	})
})
