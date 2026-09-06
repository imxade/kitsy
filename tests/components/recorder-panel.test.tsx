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

	it("adapts camera recording preview to camera aspect ratio with full width and auto height", async () => {
		delete window.__KITSY_RECORDER_E2E__

		class MockCameraTrack {
			kind = "video"
			stop = vi.fn()
			getSettings = () => ({ width: 1920, height: 1080 })
		}
		class MockCameraStream {
			tracks = [new MockCameraTrack()]
			getTracks = () => this.tracks
			getVideoTracks = () => this.tracks
			getAudioTracks = () => []
		}

		class MockRecorder {
			state = "inactive"
			ondataavailable: ((event: { data: Blob }) => void) | null = null
			onstop: (() => void) | null = null
			onerror: (() => void) | null = null
			start = vi.fn(() => {
				this.state = "recording"
			})
			stop = vi.fn(() => {
				this.state = "inactive"
				this.onstop?.()
			})
		}
		Object.defineProperty(window, "MediaRecorder", {
			configurable: true,
			value: MockRecorder,
		})

		Object.defineProperty(navigator, "mediaDevices", {
			configurable: true,
			value: {
				getUserMedia: vi.fn(async () => new MockCameraStream()),
			},
		})
		vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)

		render(
			<RecorderPanel
				kind="camera"
				onResultsChange={vi.fn()}
				onErrorChange={vi.fn()}
			/>,
		)

		const preview = screen.getByTestId("recorder-preview")
		expect(preview.className).toContain("w-full")
		expect(preview.className).toContain("h-auto")
		expect(preview.className).not.toContain("aspect-video")

		fireEvent.click(screen.getByTestId("recorder-toggle"))
		await waitFor(() => {
			expect(preview.style.aspectRatio).toBe("1920 / 1080")
		})
	})

	it("allows selecting camera device and flipping camera before recording", async () => {
		delete window.__KITSY_RECORDER_E2E__

		Object.defineProperty(navigator, "mediaDevices", {
			configurable: true,
			value: {
				enumerateDevices: async () => [
					{
						kind: "videoinput",
						deviceId: "back-camera-id",
						label: "Back Camera",
					},
					{
						kind: "videoinput",
						deviceId: "front-camera-id",
						label: "Front Camera",
					},
				],
			},
		})

		render(
			<RecorderPanel
				kind="camera"
				onResultsChange={vi.fn()}
				onErrorChange={vi.fn()}
			/>,
		)

		const cameraSelect = (await screen.findByTestId(
			"recorder-camera-select",
		)) as HTMLSelectElement
		expect(cameraSelect).toBeTruthy()
		expect(screen.getByTestId("recorder-flip-camera")).toBeTruthy()

		// Verify no separate dummy back/front options exist
		const optionValues = Array.from(cameraSelect.options).map(
			(opt) => opt.value,
		)
		expect(optionValues).not.toContain("user")
		expect(optionValues).not.toContain("environment")
		expect(optionValues).toEqual(["back-camera-id", "front-camera-id"])

		fireEvent.change(cameraSelect, {
			target: { value: "back-camera-id" },
		})
		expect(cameraSelect.value).toBe("back-camera-id")

		fireEvent.click(screen.getByTestId("recorder-flip-camera"))
		expect(cameraSelect.value).toBe("front-camera-id")
	})

	it("allows switching camera live while recording without disabling controls", async () => {
		delete window.__KITSY_RECORDER_E2E__

		class MockCameraTrack {
			kind = "video"
			id: string
			stop = vi.fn()
			constructor(id: string) {
				this.id = id
			}
			getSettings = () => ({
				deviceId: this.id,
				width: 1920,
				height: 1080,
			})
		}

		class MockCameraStream {
			tracks: MockCameraTrack[]
			constructor(track: MockCameraTrack) {
				this.tracks = [track]
			}
			getTracks = () => this.tracks
			getVideoTracks = () => this.tracks
			getAudioTracks = () => []
			addTrack = vi.fn((t: MockCameraTrack) => {
				this.tracks.push(t)
			})
			removeTrack = vi.fn((t: MockCameraTrack) => {
				this.tracks = this.tracks.filter((track) => track !== t)
			})
		}

		class MockRecorder {
			state = "inactive"
			ondataavailable: ((event: { data: Blob }) => void) | null = null
			onstop: (() => void) | null = null
			onerror: (() => void) | null = null
			start = vi.fn(() => {
				this.state = "recording"
			})
			stop = vi.fn(() => {
				this.state = "inactive"
				this.ondataavailable?.({
					data: new Blob(["recorded-video"], { type: "video/webm" }),
				})
				this.onstop?.()
			})
		}
		Object.defineProperty(window, "MediaRecorder", {
			configurable: true,
			value: MockRecorder,
		})

		const getUserMediaMock = vi.fn(
			async (constraints?: MediaStreamConstraints) => {
				const videoConstraints = constraints?.video as
					| MediaTrackConstraints
					| undefined
				const exactId = (videoConstraints?.deviceId as { exact?: string })
					?.exact
				const isFront = exactId === "front-camera-id"
				return new MockCameraStream(
					new MockCameraTrack(isFront ? "front-camera-id" : "back-camera-id"),
				)
			},
		)

		Object.defineProperty(navigator, "mediaDevices", {
			configurable: true,
			value: {
				getUserMedia: getUserMediaMock,
				enumerateDevices: async () => [
					{
						kind: "videoinput",
						deviceId: "back-camera-id",
						label: "Back Camera",
					},
					{
						kind: "videoinput",
						deviceId: "front-camera-id",
						label: "Front Camera",
					},
				],
			},
		})
		vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)

		const onResultsChange = vi.fn()
		render(
			<RecorderPanel
				kind="camera"
				onResultsChange={onResultsChange}
				onErrorChange={vi.fn()}
			/>,
		)

		// Start recording
		fireEvent.click(screen.getByTestId("recorder-toggle"))
		await waitFor(() => {
			expect(
				screen.getByTestId("recorder-toggle").getAttribute("aria-label"),
			).toBe("Stop Recording")
		})

		const cameraSelect = screen.getByTestId(
			"recorder-camera-select",
		) as HTMLSelectElement
		const flipButton = screen.getByTestId(
			"recorder-flip-camera",
		) as HTMLButtonElement

		// Controls MUST NOT be disabled while recording
		expect(cameraSelect.disabled).toBe(false)
		expect(flipButton.disabled).toBe(false)

		// Switch camera while recording
		fireEvent.click(flipButton)
		await waitFor(() => {
			expect(getUserMediaMock).toHaveBeenCalledTimes(2)
		})

		// Stop recording
		fireEvent.click(screen.getByTestId("recorder-toggle"))
		await waitFor(() => {
			expect(onResultsChange).toHaveBeenCalledWith([
				expect.objectContaining({ name: expect.stringContaining(".webm") }),
			])
		})
	})
})
