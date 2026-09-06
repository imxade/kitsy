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

import ScannerPanel from "../../src/components/ScannerPanel"

describe("ScannerPanel", () => {
	beforeEach(() => {
		vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)
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
})
