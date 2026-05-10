import { test, expect, type Locator } from "@playwright/test"
import { join } from "node:path"
import { downloadSamples, ASSETS_DIR } from "./download-samples"
import { writeFileSync, mkdirSync } from "node:fs"

// ── Download samples and warm up Vite once before all tests ──
test.beforeAll(async ({ browser }) => {
	await downloadSamples()

	// Warm up the dev server so initial load latency isn't included in recordings
	console.log("[SETUP] Warming up dev server...")
	const page = await browser.newPage()
	await page.goto("http://localhost:3000/tool/video-convert")
	await page.waitForTimeout(30000)
	await page.close()
	console.log("[SETUP] Warmup complete")
})

// ── Drop the SUCCESS manifest in the output directory if test passes ──
test.afterEach(async ({ page }, testInfo) => {
	void page
	if (testInfo.status === "passed" && testInfo.outputDir) {
		mkdirSync(testInfo.outputDir, { recursive: true })
		writeFileSync(join(testInfo.outputDir, "SUCCESS"), "ok")
	}
})

// ── Tool test definitions ──

interface ToolTest {
	id: string
	file: string | string[]
	/** Extra options to set before running (selector → value) */
	options?: Record<string, string>
	/** Timeout override for slow tools */
	timeout?: number
	/** Skip Run button (e.g. document-viewer auto-processes) */
	skipRun?: boolean
	/** Tool uses custom panel instead of standard result-card (e.g. image-collage) */
	customPanel?: boolean
	/** Tool does not require uploaded input files */
	skipUpload?: boolean
	/** Custom interaction flow for non-standard tools */
	interaction?: "record" | "todo"
}

const TOOL_TESTS: ToolTest[] = [
	// ── Image ──
	{ id: "image-convert", file: "image.jpg" },
	{ id: "image-resize", file: "image.jpg" },
	{ id: "image-rotate", file: "image.jpg" },
	{ id: "image-crop", file: "image.jpg" },
	{ id: "image-upscale", file: "image.jpg" },
	{ id: "image-blur", file: "image.jpg" },
	{ id: "image-pixelate", file: "image.jpg" },
	{ id: "image-watermark", file: "image.jpg" },
	{
		id: "image-collage",
		file: ["image.jpg", "image.png"],
		skipRun: true,
		customPanel: true,
	},

	// ── PDF ──
	{ id: "pdf-merge", file: ["document.pdf", "document2.pdf"] },
	{ id: "pdf-split", file: "document.pdf" },
	{ id: "pdf-delete-pages", file: "document.pdf" },
	{ id: "pdf-reorder", file: "document.pdf" },
	{ id: "pdf-header-footer", file: "document.pdf" },
	{ id: "pdf-bates-numbering", file: ["document.pdf", "document2.pdf"] },
	{ id: "pdf-add-blank-pages", file: "document.pdf" },
	{ id: "pdf-remove-blank-pages", file: "document.pdf" },
	{ id: "pdf-crop-pages", file: "document.pdf" },
	{
		id: "pdf-overlay-pages",
		file: "document.pdf",
		options: { overlay: "document2.pdf" },
	},
	{ id: "pdf-resize-pages", file: "document.pdf" },
	{ id: "pdf-n-up", file: "document.pdf" },
	{ id: "pdf-page-dimensions", file: "document.pdf" },
	{ id: "pdf-images-to-pdf", file: "image.jpg" },
	{ id: "pdf-to-images", file: "document.pdf", timeout: 420_000 },
	{ id: "pdf-compress", file: "document.pdf" },
	{ id: "pdf-watermark", file: "document.pdf" },
	{ id: "pdf-rotate", file: "document.pdf" },
	{ id: "pdf-flatten", file: "document.pdf" },
	{
		id: "pdf-metadata",
		file: "document.pdf",
		options: {
			title: "Kitsy E2E",
			author: "Kitsy",
			subject: "Showcase",
			keywords: "kitsy,e2e",
		},
	},
	{ id: "pdf-strip-metadata", file: "document.pdf" },
	{ id: "pdf-remove-annotations", file: "document.pdf" },
	{ id: "pdf-sign-visual", file: "document.pdf" },
	{
		id: "pdf-lock",
		file: "document.pdf",
		options: { userPassword: "kitsy-e2e", ownerPassword: "kitsy-e2e" },
	},

	// ── Video (FFmpeg, longer timeouts) ──
	{ id: "video-convert", file: "video.mp4" },
	{
		id: "video-trim",
		file: "video.mp4",
		options: { start: "00:00:00", end: "00:00:02" },
	},
	{ id: "video-extract-audio", file: "video.mp4" },
	{ id: "video-merge", file: ["video.mp4", "video2.mp4"] },
	{
		id: "video-audio-merge",
		file: "video.mp4",
		options: { audioFile: "audio.mp3" },
	},
	{ id: "video-mute", file: "video.mp4" },
	{ id: "video-speed", file: "video.mp4" },
	{ id: "video-resize", file: "video.mp4" },
	{ id: "video-crop", file: "video.mp4" },
	{ id: "video-watermark", file: "video.mp4" },
	{ id: "video-extract-frames", file: "video.mp4" },

	// ── Audio (FFmpeg, longer timeouts) ──
	{ id: "audio-convert", file: "audio.mp3" },
	{
		id: "audio-trim",
		file: "audio.mp3",
		options: { start: "00:00:00", end: "00:00:05" },
	},
	{ id: "audio-merge", file: ["audio.mp3", "audio2.mp3"] },
	{ id: "audio-volume", file: "audio.mp3" },
	{ id: "audio-fade", file: "audio.mp3" },
	{
		id: "screen-recorder",
		file: "",
		skipUpload: true,
		skipRun: true,
		customPanel: true,
	},
	{
		id: "camera-recorder",
		file: "",
		skipUpload: true,
		skipRun: true,
		customPanel: true,
	},
	{
		id: "audio-recorder",
		file: "",
		skipUpload: true,
		skipRun: true,
		customPanel: true,
	},

	// ── Document ──
	{ id: "document-viewer", file: "document.pdf", skipRun: true },

	// ── File ──
	{ id: "file-zip", file: ["image.jpg", "sample.txt"] },
	{ id: "file-unzip", file: "sample.zip" },

	// ── Data ──
	{ id: "data-csv-to-json", file: "sample.csv" },
	{ id: "data-json-to-csv", file: "sample.json" },
	{ id: "data-format-json", file: "sample.json" },
	{
		id: "todo-list",
		file: "",
		skipUpload: true,
		skipRun: true,
		customPanel: true,
		interaction: "todo",
	},
]

// ── Helpers ──

function getFilePaths(fileSpec: string | string[]): string[] {
	const files = Array.isArray(fileSpec) ? fileSpec : [fileSpec]
	return files.map((f) => join(ASSETS_DIR, f))
}

function elapsed(start: number): string {
	return ((performance.now() - start) / 1000).toFixed(1)
}

/** Smooth scroll to element over `durationMs` with cubic ease-in-out */
async function smoothScrollTo(locator: Locator, durationMs = 2000) {
	await locator.evaluate(async (el, dur) => {
		const targetY =
			el.getBoundingClientRect().top + window.scrollY - window.innerHeight / 2
		const startY = window.scrollY
		const distance = targetY - startY
		const start = performance.now()

		return new Promise<void>((resolve) => {
			function step(timestamp: number) {
				const progress = Math.min((timestamp - start) / dur, 1)
				const ease =
					progress < 0.5
						? 4 * progress * progress * progress
						: 1 - (-2 * progress + 2) ** 3 / 2
				window.scrollTo(0, startY + distance * ease)
				if (progress < 1) {
					requestAnimationFrame(step)
				} else {
					resolve()
				}
			}
			requestAnimationFrame(step)
		})
	}, durationMs)
}

// ── Tests (non-serial: failures don't block subsequent tools) ──

test.beforeEach(async ({ page }) => {
	await page.addInitScript(() => {
		const noop = () => undefined
		const originalGetContext = HTMLCanvasElement.prototype.getContext
		const recorderCanvasContext = {
			canvas: null as HTMLCanvasElement | null,
			fillStyle: "",
			strokeStyle: "",
			lineWidth: 1,
			fillRect: noop,
			drawImage: noop,
			save: noop,
			restore: noop,
			beginPath: noop,
			roundRect: noop,
			clip: noop,
			strokeRect: noop,
		}

		class MockMediaStreamTrack {
			kind: string
			enabled = true
			readyState = "live"

			constructor(kind: string) {
				this.kind = kind
			}

			stop() {
				this.readyState = "ended"
			}

			getSettings() {
				return { width: 1280, height: 720, frameRate: 30 }
			}
		}

		class MockMediaStream {
			private tracks: MockMediaStreamTrack[]

			constructor(tracks: MockMediaStreamTrack[] = []) {
				this.tracks = [...tracks]
			}

			getTracks() {
				return [...this.tracks]
			}

			getVideoTracks() {
				return this.tracks.filter((track) => track.kind === "video")
			}

			getAudioTracks() {
				return this.tracks.filter((track) => track.kind === "audio")
			}
		}

		class MockMediaRecorder {
			static isTypeSupported() {
				return true
			}

			state = "inactive"
			stream: MockMediaStream
			mimeType: string
			ondataavailable: ((event: BlobEvent) => void) | null = null
			onstop: (() => void) | null = null
			onerror: (() => void) | null = null

			constructor(stream: MockMediaStream, options?: { mimeType?: string }) {
				this.stream = stream
				this.mimeType = options?.mimeType || "video/webm"
			}

			start() {
				this.state = "recording"
				window.setTimeout(() => {
					this.ondataavailable?.(
						new BlobEvent("dataavailable", {
							data: new Blob(["mock-recording"], { type: this.mimeType }),
						}),
					)
				}, 100)
			}

			stop() {
				this.state = "inactive"
				this.onstop?.()
			}
		}

		class MockAudioContext {
			createMediaStreamDestination() {
				return {
					stream: new MockMediaStream([new MockMediaStreamTrack("audio")]),
				}
			}

			createMediaStreamSource() {
				return { connect() {} }
			}

			close() {
				return Promise.resolve()
			}
		}

		Object.defineProperty(globalThis, "MediaStream", {
			value: MockMediaStream,
			configurable: true,
		})
		Object.defineProperty(globalThis, "MediaRecorder", {
			value: MockMediaRecorder,
			configurable: true,
		})
		Object.defineProperty(globalThis, "AudioContext", {
			value: MockAudioContext,
			configurable: true,
		})
		Object.defineProperty(globalThis, "__KITSY_RECORDER_E2E__", {
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

		Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
			get() {
				return (this as HTMLMediaElement & { __srcObject?: unknown })
					.__srcObject
			},
			set(value) {
				;(this as HTMLMediaElement & { __srcObject?: unknown }).__srcObject =
					value
			},
			configurable: true,
		})
		HTMLMediaElement.prototype.play = async () => undefined

		HTMLCanvasElement.prototype.getContext = function (
			contextId: string,
			options?: CanvasRenderingContext2DSettings,
		) {
			if (window.location.pathname.includes("recorder")) {
				recorderCanvasContext.canvas = this
				return recorderCanvasContext as CanvasRenderingContext2D
			}
			return originalGetContext.call(this, contextId, options)
		}

		if (!HTMLCanvasElement.prototype.captureStream) {
			HTMLCanvasElement.prototype.captureStream = () =>
				new MockMediaStream([new MockMediaStreamTrack("video")]) as never
		}

		Object.defineProperty(navigator, "mediaDevices", {
			value: {
				getUserMedia: async (constraints: {
					video?: boolean
					audio?: boolean
				}) =>
					new MockMediaStream([
						...(constraints.video ? [new MockMediaStreamTrack("video")] : []),
						...(constraints.audio ? [new MockMediaStreamTrack("audio")] : []),
					]),
				getDisplayMedia: async (constraints: { audio?: boolean }) =>
					new MockMediaStream([
						new MockMediaStreamTrack("video"),
						...(constraints.audio ? [new MockMediaStreamTrack("audio")] : []),
					]),
			},
			configurable: true,
		})
	})
})

test.describe("Tool Showcase", () => {
	for (const toolTest of TOOL_TESTS) {
		test(toolTest.id, async ({ page }, testInfo) => {
			const timeoutMs = toolTest.timeout ?? 200_000
			test.setTimeout(timeoutMs)

			const start = performance.now()
			const testStart = Date.now()
			console.log(`[START] ${toolTest.id} - ${new Date().toISOString()}`)

			// 1. Navigate to tool page and wait for DOM
			await page.goto(`/tool/${toolTest.id}`)
			await page.waitForLoadState("domcontentloaded")

			// Inject professional showcase watermark
			await page.evaluate((name) => {
				const watermark = document.createElement("div")
				watermark.innerHTML = `<span style="opacity: 0.7">Showcasing:</span> <strong style="color: #4ecdc4">${name}</strong>`
				watermark.style.cssText =
					"position: fixed; bottom: 30px; right: 30px; background: rgba(0,0,0,0.7); backdrop-filter: blur(12px); color: white; padding: 12px 24px; border-radius: 100px; font-family: system-ui, sans-serif; font-size: 18px; z-index: 9999; border: 1px solid rgba(255,255,255,0.15); box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5); transform: translateY(20px); opacity: 0; transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1); pointer-events: none;"
				document.body.appendChild(watermark)
				requestAnimationFrame(() => {
					watermark.style.transform = "translateY(0)"
					watermark.style.opacity = "1"
				})
			}, toolTest.id)

			if (!toolTest.skipUpload) {
				await page.waitForSelector('[data-testid="file-input"]', {
					state: "attached",
				})

				// 2. Upload file(s). Retry with CPU-friendly pacing to survive slow CI hydration.
				const filePaths = getFilePaths(toolTest.file)
				const fileInput = page.locator('[data-testid="file-input"]')

				for (let attempt = 0; attempt < 15; attempt++) {
					await fileInput.evaluate((el: HTMLInputElement) => {
						el.value = ""
					})
					await fileInput.setInputFiles(filePaths)

					try {
						if (toolTest.customPanel) {
							await expect(
								page.locator('[data-testid="file-input"]'),
							).not.toBeVisible({ timeout: 500 })
						} else if (!toolTest.skipRun) {
							await expect(
								page.locator('[data-testid="run-button"]'),
							).toBeVisible({ timeout: 500 })
						} else {
							await expect(
								page.locator('[data-testid="result-card"]'),
							).toBeVisible({ timeout: 500 })
						}
						break
					} catch {
						if (attempt === 14)
							throw new Error(
								`Upload failed after 15 attempts for ${toolTest.id}`,
							)
						await page.waitForTimeout(500)
					}
				}
			}

			// 3. Set options if needed
			if (toolTest.options) {
				for (const [optId, value] of Object.entries(toolTest.options)) {
					const input = page.locator(`#opt-${optId}`)
					const inputType = await input.getAttribute("type")
					if (inputType === "file") {
						await input.setInputFiles(getFilePaths(value))
					} else {
						await input.fill(value)
					}
				}
			}

			// Custom interactions before run
			if (toolTest.id === "pdf-delete-pages") {
				await page.waitForTimeout(2500) // Let the canvas previews render
				await page.locator('button[aria-label="Remove page"]').first().click()
			}

			if (toolTest.interaction === "record") {
				await page.waitForSelector('[data-testid="recorder-mounted"]', {
					state: "attached",
				})
				const recorderToggle = page.locator('[data-testid="recorder-toggle"]')
				await recorderToggle.evaluate((button: HTMLButtonElement) =>
					button.click(),
				)
				await expect(recorderToggle).toHaveText("Stop Recording", {
					timeout: 15_000,
				})
				await page.waitForTimeout(500)
				await recorderToggle.evaluate((button: HTMLButtonElement) =>
					button.click(),
				)
			}

			if (toolTest.interaction === "todo") {
				await page.waitForSelector('[data-testid="todo-mounted"]', {
					state: "attached",
				})
				await page.locator('[data-testid="todo-draft-input"]').fill("E2E task")
				await page.locator('[data-testid="todo-draft-input"]').blur()
				const importPath = testInfo.outputPath("todo-import.json")
				writeFileSync(
					importPath,
					JSON.stringify([
						{
							id: "imported-e2e",
							text: "Imported E2E task",
							completed: false,
							createdAt: "2026-04-27T00:00:00.000Z",
							updatedAt: "2026-04-27T00:00:00.000Z",
							reminderDate: null,
							deletedAt: null,
							draft: false,
						},
					]),
				)
				await page
					.locator('[data-testid="todo-import"]')
					.setInputFiles(importPath)
				await expect(page.locator('[data-testid="todo-item"]')).toHaveCount(2)
			}

			// 4. Smooth scroll to run button and click (unless skipped)
			let cutStartSecs = 0
			let cutEndSecs = 0

			if (!toolTest.skipRun && !toolTest.interaction) {
				const runButton = page.locator('[data-testid="run-button"]')
				await smoothScrollTo(runButton)
				await page.waitForTimeout(1000)
				await runButton.click()

				// Allow exactly 2s of "Processing..." UI to be included
				await page.waitForTimeout(2000)
				cutStartSecs = (Date.now() - testStart) / 1000
			}

			// 5. Wait for result (skip for custom panels like collage)
			if (!toolTest.customPanel) {
				const resultCard = page.locator('[data-testid="result-card"]')
				try {
					await resultCard.waitFor({
						state: "visible",
						timeout: Math.max(15_000, timeoutMs - 20_000),
					})
					cutEndSecs = (Date.now() - testStart) / 1000
				} catch (e) {
					await page.screenshot({
						path: "failure-screenshot.png",
						fullPage: true,
					})
					throw e
				}

				// 6. Wait for preview
				const preview = page.locator(
					'[data-testid="preview"], [data-testid="result-card"] img, [data-testid="result-card"] video',
				)
				try {
					await preview.first().waitFor({ state: "visible", timeout: 5_000 })
				} catch {
					// Some tools don't have visual previews (e.g. ZIP), result card is enough
				}

				// 7. Scroll to result and hold for showcase
				await smoothScrollTo(resultCard)
				await page.waitForTimeout(2000)
			} else {
				// For custom panels, just hold on the current view
				await page.waitForTimeout(3000)
			}

			// Save trim markers if we captured a processing wait period > 1s
			if (
				cutStartSecs > 0 &&
				cutEndSecs > cutStartSecs + 1 &&
				testInfo.outputDir
			) {
				mkdirSync(testInfo.outputDir, { recursive: true })
				writeFileSync(
					join(testInfo.outputDir, "trim.json"),
					JSON.stringify({ cutStart: cutStartSecs, cutEnd: cutEndSecs }),
				)
			}

			console.log(`[END] ${toolTest.id} - ${elapsed(start)}s`)
		})
	}
})
