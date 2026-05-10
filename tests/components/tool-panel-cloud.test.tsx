// @vitest-environment jsdom

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react"
import type { ReactNode } from "react"
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

const uploadProcessedFile = vi.fn()
const uploadProcessedFiles = vi.fn()

vi.mock("../../src/components/AppShellProvider", () => ({
	useAppShell: () => ({
		isOnline: true,
		isOfflineReady: false,
		dismissOfflineReadyToast: () => undefined,
		cloud: {
			configured: true,
			connected: false,
			connecting: false,
			status: "Drive disconnected",
			error: null,
			disabledReason: null,
			connect: async () => true,
			disconnect: async () => undefined,
			loadTodoDocument: async () => null,
			saveTodoDocument: async () => false,
			uploadProcessedFile,
			uploadProcessedFiles,
		},
	}),
	default: ({ children }: { children: ReactNode }) => children,
}))

import ToolPanel from "../../src/components/ToolPanel"
import { getToolById } from "../../src/lib/tool-registry"

describe("ToolPanel cloud uploads", () => {
	beforeEach(() => {
		uploadProcessedFile.mockReset()
		uploadProcessedFiles.mockReset()
		uploadProcessedFile.mockResolvedValue({
			id: "drive-file-1",
			name: "sample.json",
			webViewLink: "https://drive.google.com/file/d/drive-file-1/view",
		})
	})

	afterEach(() => {
		cleanup()
		vi.restoreAllMocks()
	})

	it("uploads a processed result to Google Drive", async () => {
		const tool = getToolById("data-format-json")
		if (!tool) throw new Error("data-format-json tool is missing")

		render(<ToolPanel tool={tool} />)
		fireEvent.change(screen.getByTestId("file-input"), {
			target: {
				files: [
					new File(['{"value":1}'], "sample.json", {
						type: "application/json",
					}),
				],
			},
		})

		fireEvent.click(screen.getByTestId("run-button"))
		expect(await screen.findByTestId("result-card")).toBeTruthy()

		fireEvent.click(screen.getByTestId("result-save-to-drive"))

		await waitFor(() => {
			expect(uploadProcessedFile).toHaveBeenCalledTimes(1)
		})
		expect(
			screen.getByText('Saved "sample.json" to Google Drive.'),
		).toBeTruthy()
	})
})
