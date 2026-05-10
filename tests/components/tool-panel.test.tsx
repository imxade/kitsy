// @vitest-environment jsdom

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
	GlobalWorkerOptions: { workerSrc: "" },
	getDocument: vi.fn(() => ({
		promise: Promise.resolve({ numPages: 0 }),
	})),
}))

vi.mock("pdfjs-dist/legacy/build/pdf.worker.mjs?url", () => ({
	default: "/pdf.worker.js",
}))

vi.mock("../../src/components/CollagePanel", () => ({
	default: () => <div data-testid="collage-panel" />,
}))

import ToolPanel from "../../src/components/ToolPanel"
import { getToolById } from "../../src/lib/tool-registry"

describe("ToolPanel crop interactions", () => {
	beforeEach(() => {
		vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:crop-preview")
		vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined)
	})

	afterEach(() => {
		cleanup()
		vi.restoreAllMocks()
	})

	async function renderImageCropTool() {
		const tool = getToolById("image-crop")
		if (!tool) throw new Error("image-crop tool is missing")

		render(<ToolPanel tool={tool} />)
		fireEvent.change(screen.getByTestId("file-input"), {
			target: {
				files: [new File(["mock-image"], "photo.png", { type: "image/png" })],
			},
		})

		const cropSource = (await screen.findByAltText(
			"Crop source",
		)) as HTMLImageElement
		Object.defineProperty(cropSource, "naturalWidth", {
			configurable: true,
			value: 1200,
		})
		Object.defineProperty(cropSource, "naturalHeight", {
			configurable: true,
			value: 900,
		})
		fireEvent.load(cropSource)

		await screen.findByTestId("crop-selection")
		return {
			xInput: screen.getByLabelText("X Offset (px)") as HTMLInputElement,
			yInput: screen.getByLabelText("Y Offset (px)") as HTMLInputElement,
			widthInput: screen.getByLabelText("Crop Width (px)") as HTMLInputElement,
			heightInput: screen.getByLabelText(
				"Crop Height (px)",
			) as HTMLInputElement,
		}
	}

	it("moves the crop selection with pointer events", async () => {
		const { xInput, yInput } = await renderImageCropTool()
		fireEvent.pointerDown(screen.getByTestId("crop-selection"), {
			clientX: 100,
			clientY: 100,
		})
		fireEvent.pointerMove(window, {
			clientX: 160,
			clientY: 140,
		})
		fireEvent.pointerUp(window)

		await waitFor(() => {
			expect(xInput.value).toBe("180")
			expect(yInput.value).toBe("120")
		})
	})

	it("resizes the crop selection with pointer events", async () => {
		const { widthInput, heightInput } = await renderImageCropTool()
		fireEvent.pointerDown(screen.getByTestId("crop-resize-handle"), {
			clientX: 100,
			clientY: 100,
		})
		fireEvent.pointerMove(window, {
			clientX: 160,
			clientY: 140,
		})
		fireEvent.pointerUp(window)

		await waitFor(() => {
			expect(widthInput.value).toBe("580")
			expect(heightInput.value).toBe("520")
		})
	})
})
