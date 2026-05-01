import { describe, expect, it } from "vitest"
import {
	buildRecordingName,
	clampOverlayRect,
	getPreferredRecordingMimeType,
} from "../../src/lib/recorder"

describe("recorder helpers", () => {
	it("clamps the camera overlay inside the canvas bounds", () => {
		expect(
			clampOverlayRect({
				x: 0.95,
				y: -0.1,
				width: 0.8,
				height: 0.05,
			}),
		).toEqual({
			x: 0.2,
			y: 0,
			width: 0.8,
			height: 0.12,
		})
	})

	it("chooses the first supported mime type", () => {
		const mimeType = getPreferredRecordingMimeType(
			"audio",
			(value) => value === "audio/ogg;codecs=opus",
		)
		expect(mimeType).toBe("audio/ogg;codecs=opus")
	})

	it("builds a stable recording filename", () => {
		const name = buildRecordingName(
			"screen",
			"video/webm",
			new Date("2026-04-27T12:34:56.000Z"),
		)
		expect(name).toBe("screen-recording-2026-04-27T12-34-56Z.webm")
	})
})
