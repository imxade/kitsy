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
	cropImage: vi.fn(async () => ({
		blob: new Blob(["cropped"], { type: "image/jpeg" }),
		name: "first-cropped.jpg",
	})),
}))

import ScannerPanel from "../../src/components/ScannerPanel"
import { cropImage } from "../../src/lib/image-processor"

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
		expect(preview.className).toContain("aspect-video")
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

	it("previews and crops a selected local page before PDF creation", async () => {
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

		fireEvent.change(screen.getByLabelText("Crop Width"), {
			target: { value: "1000" },
		})
		fireEvent.change(screen.getByLabelText("Crop Height"), {
			target: { value: "600" },
		})
		fireEvent.change(screen.getByLabelText("Crop X"), {
			target: { value: "100" },
		})
		fireEvent.change(screen.getByLabelText("Crop Y"), {
			target: { value: "50" },
		})
		fireEvent.click(screen.getByTestId("scanner-apply-crop"))

		await waitFor(() => {
			expect(cropImage).toHaveBeenCalledWith(source, 100, 50, 1000, 600)
		})
		expect(await screen.findByText(/first-cropped\.jpg/)).toBeTruthy()
	})

	it("moves and resizes the crop selection directly on the scan preview", async () => {
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

		fireEvent.change(screen.getByLabelText("Crop Width"), {
			target: { value: "800" },
		})
		fireEvent.change(screen.getByLabelText("Crop Height"), {
			target: { value: "500" },
		})
		fireEvent.change(screen.getByLabelText("Crop X"), {
			target: { value: "100" },
		})
		fireEvent.change(screen.getByLabelText("Crop Y"), {
			target: { value: "50" },
		})

		fireEvent.pointerDown(screen.getByTestId("scanner-crop-selection"), {
			clientX: 100,
			clientY: 100,
		})
		fireEvent.pointerMove(window, { clientX: 150, clientY: 125 })
		fireEvent.pointerUp(window)

		await waitFor(() => {
			expect((screen.getByLabelText("Crop X") as HTMLInputElement).value).toBe(
				"200",
			)
			expect((screen.getByLabelText("Crop Y") as HTMLInputElement).value).toBe(
				"100",
			)
		})

		fireEvent.pointerDown(screen.getByTestId("scanner-crop-resize-handle"), {
			clientX: 100,
			clientY: 100,
		})
		fireEvent.pointerMove(window, { clientX: 150, clientY: 125 })
		fireEvent.pointerUp(window)

		await waitFor(() => {
			expect(
				(screen.getByLabelText("Crop Width") as HTMLInputElement).value,
			).toBe("900")
			expect(
				(screen.getByLabelText("Crop Height") as HTMLInputElement).value,
			).toBe("550")
		})
	})

	it("uses the same aspect-video preview treatment as camera recording", () => {
		Object.defineProperty(navigator, "mediaDevices", {
			configurable: true,
			value: {
				getUserMedia: async () => ({ getTracks: () => [] }),
			},
		})
		vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)

		render(<ScannerPanel onResultsChange={vi.fn()} onErrorChange={vi.fn()} />)
		fireEvent.click(screen.getByText("Start camera"))

		return screen.findByTestId("scanner-preview").then((preview) => {
			expect(preview.className).toContain("aspect-video")
			expect(preview.className).toContain("w-full")
			expect(preview.className).not.toContain("object-cover")
		})
	})
})
