// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
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
})
