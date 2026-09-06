// @vitest-environment jsdom

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../src/lib/pdf-processor", () => ({
	imagesToPdf: vi.fn(async (files: File[]) => ({
		blob: new Blob(["pdf"], { type: "application/pdf" }),
		name: `${files.length}-pages.pdf`,
	})),
}))

vi.mock("../../src/lib/image-processor", () => ({
	perspectiveCropImage: vi.fn(async () => ({
		blob: new Blob(["cropped"], { type: "image/jpeg" }),
		name: "first-flattened.jpg",
	})),
}))

import ScannerPanel from "../../src/components/ScannerPanel"
import { perspectiveCropImage } from "../../src/lib/image-processor"

describe("ScannerPanel", () => {
	beforeEach(() => {
		vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)
		vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:scanner-preview")
		vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined)
	})

	afterEach(() => {
		cleanup()
		vi.restoreAllMocks()
	})

	it("mounts the camera preview before attaching its stream", async () => {
		const stream = {
			getTracks: () => [{ stop: vi.fn() }],
		} as unknown as MediaStream
		Object.defineProperty(navigator, "mediaDevices", {
			configurable: true,
			value: { getUserMedia: vi.fn(async () => stream) },
		})

		render(<ScannerPanel onResultsChange={vi.fn()} onErrorChange={vi.fn()} />)
		fireEvent.click(screen.getByRole("button", { name: "Start camera" }))

		const preview = (await screen.findByTestId(
			"scanner-preview",
		)) as HTMLVideoElement
		await waitFor(() => expect(preview.srcObject).toBe(stream))
		expect(HTMLMediaElement.prototype.play).toHaveBeenCalled()
		expect(preview.className).toContain("w-full")
		expect(preview.className).toContain("h-auto")
		expect(preview.className).not.toContain("aspect-video")
	})

	it("accepts local image pages, allows reordering, and creates a PDF", async () => {
		const onResultsChange = vi.fn()
		const onErrorChange = vi.fn()
		render(
			<ScannerPanel
				onResultsChange={onResultsChange}
				onErrorChange={onErrorChange}
			/>,
		)

		fireEvent.change(screen.getByTestId("scanner-image-input"), {
			target: {
				files: [
					new File(["first"], "first.jpg", { type: "image/jpeg" }),
					new File(["second"], "second.jpg", { type: "image/jpeg" }),
				],
			},
		})

		expect(await screen.findByText(/1\. first\.jpg/)).toBeTruthy()
		fireEvent.click(screen.getAllByLabelText("Move page down")[0])
		expect(screen.getByText(/1\. second\.jpg/)).toBeTruthy()
		fireEvent.click(screen.getByTestId("scanner-create-pdf"))

		await waitFor(() => {
			expect(onResultsChange).toHaveBeenLastCalledWith([
				expect.objectContaining({ name: "2-pages.pdf" }),
			])
		})
		expect(onErrorChange).toHaveBeenCalledWith(null)
	})

	it("flattens an irregular four-corner scan selection before PDF creation", async () => {
		render(<ScannerPanel onResultsChange={vi.fn()} onErrorChange={vi.fn()} />)
		const source = new File(["first"], "first.jpg", { type: "image/jpeg" })
		fireEvent.change(screen.getByTestId("scanner-image-input"), {
			target: { files: [source] },
		})

		fireEvent.click(await screen.findByRole("button", { name: "Crop" }))
		const preview = (await screen.findByAltText(
			"Selected scan crop preview",
		)) as HTMLImageElement
		Object.defineProperty(preview, "naturalWidth", {
			configurable: true,
			value: 1200,
		})
		Object.defineProperty(preview, "naturalHeight", {
			configurable: true,
			value: 800,
		})
		fireEvent.load(preview)

		fireEvent.change(screen.getByLabelText("Top left X"), {
			target: { value: "100" },
		})
		fireEvent.change(screen.getByLabelText("Top left Y"), {
			target: { value: "50" },
		})
		fireEvent.change(screen.getByLabelText("Top right X"), {
			target: { value: "1100" },
		})
		fireEvent.change(screen.getByLabelText("Top right Y"), {
			target: { value: "75" },
		})
		fireEvent.change(screen.getByLabelText("Bottom right X"), {
			target: { value: "1050" },
		})
		fireEvent.change(screen.getByLabelText("Bottom right Y"), {
			target: { value: "700" },
		})
		fireEvent.change(screen.getByLabelText("Bottom left X"), {
			target: { value: "80" },
		})
		fireEvent.change(screen.getByLabelText("Bottom left Y"), {
			target: { value: "720" },
		})
		fireEvent.click(screen.getByTestId("scanner-apply-crop"))

		await waitFor(() => {
			expect(perspectiveCropImage).toHaveBeenCalledWith(source, [
				{ x: 100, y: 50 },
				{ x: 1100, y: 75 },
				{ x: 1050, y: 700 },
				{ x: 80, y: 720 },
			])
		})
		expect(await screen.findByText(/first-flattened\.jpg/)).toBeTruthy()
	})

	it("moves each scan crop corner directly on the preview", async () => {
		render(<ScannerPanel onResultsChange={vi.fn()} onErrorChange={vi.fn()} />)
		const source = new File(["first"], "first.jpg", { type: "image/jpeg" })
		fireEvent.change(screen.getByTestId("scanner-image-input"), {
			target: { files: [source] },
		})

		fireEvent.click(await screen.findByRole("button", { name: "Crop" }))
		const preview = (await screen.findByAltText(
			"Selected scan crop preview",
		)) as HTMLImageElement
		Object.defineProperty(preview, "naturalWidth", {
			configurable: true,
			value: 1200,
		})
		Object.defineProperty(preview, "naturalHeight", {
			configurable: true,
			value: 800,
		})
		Object.defineProperty(preview, "clientWidth", {
			configurable: true,
			value: 600,
		})
		Object.defineProperty(preview, "clientHeight", {
			configurable: true,
			value: 400,
		})
		vi.spyOn(preview, "getBoundingClientRect").mockReturnValue({
			width: 600,
			height: 400,
			top: 0,
			left: 0,
			bottom: 400,
			right: 600,
			x: 0,
			y: 0,
			toJSON: () => ({}),
		})
		fireEvent.load(preview)

		fireEvent.pointerDown(screen.getByTestId("scanner-crop-corner-0"), {
			clientX: 100,
			clientY: 100,
		})
		fireEvent.pointerMove(window, { clientX: 150, clientY: 125 })
		fireEvent.pointerUp(window)

		await waitFor(() => {
			expect(
				(screen.getByLabelText("Top left X") as HTMLInputElement).value,
			).toBe("300")
			expect(
				(screen.getByLabelText("Top left Y") as HTMLInputElement).value,
			).toBe("250")
		})

		fireEvent.pointerDown(screen.getByTestId("scanner-crop-corner-2"), {
			clientX: 500,
			clientY: 300,
		})
		fireEvent.pointerMove(window, { clientX: 450, clientY: 325 })
		fireEvent.pointerUp(window)

		await waitFor(() => {
			expect(
				(screen.getByLabelText("Bottom right X") as HTMLInputElement).value,
			).toBe("900")
			expect(
				(screen.getByLabelText("Bottom right Y") as HTMLInputElement).value,
			).toBe("650")
		})
	})

	it("adapts preview to camera aspect ratio with full width and auto height", () => {
		const track = {
			kind: "video",
			stop: vi.fn(),
			getSettings: () => ({ width: 1600, height: 1200 }),
		}
		Object.defineProperty(navigator, "mediaDevices", {
			configurable: true,
			value: {
				getUserMedia: async () => ({
					getTracks: () => [track],
					getVideoTracks: () => [track],
				}),
			},
		})
		vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)

		render(<ScannerPanel onResultsChange={vi.fn()} onErrorChange={vi.fn()} />)
		fireEvent.click(screen.getByText("Start camera"))

		return screen.findByTestId("scanner-preview").then((preview) => {
			expect(preview.className).toContain("w-full")
			expect(preview.className).toContain("h-auto")
			expect(preview.className).not.toContain("aspect-video")
			expect((preview as HTMLElement).style.aspectRatio).toBe("1600 / 1200")
		})
	})

	it("allows switching and flipping cameras with camera UI controls", async () => {
		const rearTrack = {
			kind: "video",
			stop: vi.fn(),
			getSettings: () => ({
				deviceId: "rear-cam-id",
				facingMode: "environment",
				width: 1920,
				height: 1080,
			}),
		}
		const frontTrack = {
			kind: "video",
			stop: vi.fn(),
			getSettings: () => ({
				deviceId: "front-cam-id",
				facingMode: "user",
				width: 1280,
				height: 720,
			}),
		}

		const getUserMediaMock = vi.fn(
			async (constraints: MediaStreamConstraints) => {
				const videoConstraints = constraints.video as
					| MediaTrackConstraints
					| undefined
				const isFront =
					(videoConstraints?.deviceId as { exact?: string })?.exact ===
						"front-cam-id" ||
					(videoConstraints?.facingMode as { ideal?: string })?.ideal === "user"
				const track = isFront ? frontTrack : rearTrack
				return {
					getTracks: () => [track],
					getVideoTracks: () => [track],
				}
			},
		)

		Object.defineProperty(navigator, "mediaDevices", {
			configurable: true,
			value: {
				getUserMedia: getUserMediaMock,
				enumerateDevices: async () => [
					{
						kind: "videoinput",
						deviceId: "rear-cam-id",
						label: "Back Camera",
					},
					{
						kind: "videoinput",
						deviceId: "front-cam-id",
						label: "Front Camera",
					},
				],
			},
		})
		vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)

		render(<ScannerPanel onResultsChange={vi.fn()} onErrorChange={vi.fn()} />)

		// Before starting camera: check camera select options
		const initialSelect = (await screen.findByTestId(
			"scanner-camera-select",
		)) as HTMLSelectElement
		const optionValues = Array.from(initialSelect.options).map(
			(opt) => opt.value,
		)
		expect(optionValues).not.toContain("user")
		expect(optionValues).not.toContain("environment")
		expect(optionValues).toEqual(["rear-cam-id", "front-cam-id"])

		fireEvent.click(screen.getByText("Start camera"))

		await screen.findByTestId("scanner-preview")
		expect(screen.getByTestId("scanner-capture-page")).toBeTruthy()
		expect(screen.getByTestId("scanner-flip-camera")).toBeTruthy()

		// Live switch via active dropdown in viewfinder
		const activeSelect = screen.getByTestId(
			"scanner-camera-select-active",
		) as HTMLSelectElement
		expect(activeSelect).toBeTruthy()
		const activeOptionValues = Array.from(activeSelect.options).map(
			(opt) => opt.value,
		)
		expect(activeOptionValues).toEqual(["rear-cam-id", "front-cam-id"])

		fireEvent.change(activeSelect, { target: { value: "front-cam-id" } })
		await waitFor(() => expect(getUserMediaMock).toHaveBeenCalledTimes(2))

		// Live switch via flip button
		fireEvent.click(screen.getByTestId("scanner-flip-camera"))
		await waitFor(() => expect(getUserMediaMock).toHaveBeenCalledTimes(3))
	})
})
