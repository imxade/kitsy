// @vitest-environment jsdom

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import RecorderPanel from "../../src/components/RecorderPanel"

describe("RecorderPanel", () => {
	beforeEach(() => {
		Object.defineProperty(window, "__KITSY_RECORDER_E2E__", {
			value: {
				start: (kind: "screen" | "camera" | "audio") => ({
					blob: new Blob(["mock-recording"], {
						type: kind === "audio" ? "audio/webm" : "video/webm",
					}),
					name: `${kind}-recording.webm`,
				}),
			},
			configurable: true,
		})
	})

	afterEach(() => {
		cleanup()
		delete window.__KITSY_RECORDER_E2E__
	})

	it("starts and stops a mocked screen recording", async () => {
		const onResultsChange = vi.fn()
		const onErrorChange = vi.fn()

		render(
			<RecorderPanel
				kind="screen"
				onResultsChange={onResultsChange}
				onErrorChange={onErrorChange}
			/>,
		)

		await screen.findByTestId("recorder-mounted")
		fireEvent.click(screen.getByTestId("recorder-toggle"))
		await waitFor(() => {
			expect(screen.getByTestId("recorder-toggle").textContent).toBe(
				"Stop Recording",
			)
		})

		fireEvent.click(screen.getByTestId("recorder-toggle"))
		await waitFor(() => {
			expect(onResultsChange).toHaveBeenLastCalledWith([
				expect.objectContaining({
					name: "screen-recording.webm",
				}),
			])
		})
		expect(onErrorChange).toHaveBeenCalledWith(null)
	})

	it("records the raw display stream when camera overlay is off", async () => {
		delete window.__KITSY_RECORDER_E2E__

		class MockTrack {
			kind: string

			constructor(kind: string) {
				this.kind = kind
			}

			stop = vi.fn()
			getSettings = () => ({ width: 1280, height: 720 })
		}

		class MockStream {
			private tracks: MockTrack[]

			constructor(tracks: MockTrack[]) {
				this.tracks = tracks
			}

			getTracks = () => this.tracks
			getVideoTracks = () =>
				this.tracks.filter((track) => track.kind === "video")
			getAudioTracks = () =>
				this.tracks.filter((track) => track.kind === "audio")
		}

		let recorderStream: MockStream | null = null
		class MockMediaRecorder {
			state = "inactive"
			ondataavailable: ((event: { data: Blob }) => void) | null = null
			onstop: (() => void) | null = null
			onerror: (() => void) | null = null

			constructor(stream: MockStream) {
				recorderStream = stream
			}

			start() {
				this.state = "recording"
			}

			stop() {
				this.state = "inactive"
				this.ondataavailable?.({
					data: new Blob(["raw-display"], { type: "video/webm" }),
				})
				this.onstop?.()
			}

			static isTypeSupported = () => true
		}

		vi.stubGlobal("MediaStream", MockStream)
		vi.stubGlobal("MediaRecorder", MockMediaRecorder)
		Object.defineProperty(navigator, "mediaDevices", {
			configurable: true,
			value: {
				getDisplayMedia: vi.fn(
					async () => new MockStream([new MockTrack("video")]),
				),
				getUserMedia: vi.fn(
					async () => new MockStream([new MockTrack("audio")]),
				),
			},
		})
		vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
			fillStyle: "",
			strokeStyle: "",
			lineWidth: 0,
			fillRect: vi.fn(),
			drawImage: vi.fn(),
			save: vi.fn(),
			restore: vi.fn(),
			beginPath: vi.fn(),
			roundRect: vi.fn(),
			clip: vi.fn(),
			strokeRect: vi.fn(),
		} as unknown as CanvasRenderingContext2D)
		Object.defineProperty(HTMLCanvasElement.prototype, "captureStream", {
			configurable: true,
			value: vi.fn(),
		})
		const captureStreamSpy = vi
			.spyOn(HTMLCanvasElement.prototype, "captureStream")
			.mockReturnValue(new MockStream([new MockTrack("video")]) as never)
		const onResultsChange = vi.fn()
		const onErrorChange = vi.fn()

		render(
			<RecorderPanel
				kind="screen"
				onResultsChange={onResultsChange}
				onErrorChange={onErrorChange}
			/>,
		)

		await screen.findByTestId("recorder-mounted")
		fireEvent.click(screen.getByTestId("recorder-toggle"))
		await waitFor(() => {
			expect(screen.getByTestId("recorder-toggle").textContent).toBe(
				"Stop Recording",
			)
		})

		expect(captureStreamSpy).not.toHaveBeenCalled()
		expect(recorderStream?.getVideoTracks()).toHaveLength(1)
		fireEvent.click(screen.getByTestId("recorder-toggle"))
		await waitFor(() => expect(onResultsChange).toHaveBeenCalled())
		expect(onErrorChange).toHaveBeenCalledWith(null)
	})
})
