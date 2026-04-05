import { test, expect } from "@playwright/test"
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
test.afterEach(async ({}, testInfo) => {
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
	{ id: "image-collage", file: ["image.jpg", "image.png"], skipRun: true, customPanel: true },

	// ── PDF ──
	{ id: "pdf-merge", file: ["document.pdf", "document2.pdf"] },
	{ id: "pdf-split", file: "document.pdf" },
	{ id: "pdf-delete-pages", file: "document.pdf" },
	{ id: "pdf-reorder", file: "document.pdf" },
	{ id: "pdf-images-to-pdf", file: "image.jpg" },
	{ id: "pdf-to-text", file: "document.pdf" },
	{ id: "pdf-to-images", file: "document.pdf" },
	{ id: "pdf-compress", file: "document.pdf" },
	{ id: "pdf-watermark", file: "document.pdf" },
	{ id: "pdf-rotate", file: "document.pdf" },

	// ── Video (FFmpeg, longer timeouts) ──
	{ id: "video-convert", file: "video.mp4" },
	{ id: "video-trim", file: "video.mp4", options: { start: "00:00:00", end: "00:00:02" } },
	{ id: "video-extract-audio", file: "video.mp4" },
	{ id: "video-merge", file: ["video.mp4", "video2.mp4"] },
	{ id: "video-audio-merge", file: "video.mp4", options: { audioFile: "audio.mp3" } },
	{ id: "video-mute", file: "video.mp4" },
	{ id: "video-speed", file: "video.mp4" },
	{ id: "video-resize", file: "video.mp4" },
	{ id: "video-crop", file: "video.mp4" },
	{ id: "video-watermark", file: "video.mp4" },
	{ id: "video-extract-frames", file: "video.mp4" },

	// ── Audio (FFmpeg, longer timeouts) ──
	{ id: "audio-convert", file: "audio.mp3" },
	{ id: "audio-trim", file: "audio.mp3", options: { start: "00:00:00", end: "00:00:05" } },
	{ id: "audio-merge", file: ["audio.mp3", "audio2.mp3"] },
	{ id: "audio-volume", file: "audio.mp3" },
	{ id: "audio-fade", file: "audio.mp3" },

	// ── Document ──
	{ id: "document-viewer", file: "document.pdf", skipRun: true },

	// ── File ──
	{ id: "file-zip", file: ["image.jpg", "sample.txt"] },
	{ id: "file-unzip", file: "sample.zip" },

	// ── Data ──
	{ id: "data-csv-to-json", file: "sample.csv" },
	{ id: "data-json-to-csv", file: "sample.json" },
	{ id: "data-format-json", file: "sample.json" },
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
async function smoothScrollTo(locator: import("@playwright/test").Locator, durationMs = 2000) {
	await locator.evaluate(async (el, dur) => {
		const targetY = el.getBoundingClientRect().top + window.scrollY - window.innerHeight / 2
		const startY = window.scrollY
		const distance = targetY - startY
		const start = performance.now()

		return new Promise<void>((resolve) => {
			function step(timestamp: number) {
				const progress = Math.min((timestamp - start) / dur, 1)
				const ease = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2
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

test.describe("Tool Showcase", () => {
	for (const toolTest of TOOL_TESTS) {
		test(toolTest.id, async ({ page }, testInfo) => {
			test.setTimeout(200_000) 

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

			// Wait for file input to be attached
			await page.waitForSelector('[data-testid="file-input"]', { state: "attached" })

			// 2. Upload file(s). Retry with CPU-friendly pacing to survive slow CI hydration.
			const filePaths = getFilePaths(toolTest.file)
			const fileInput = page.locator('[data-testid="file-input"]')

			for (let attempt = 0; attempt < 15; attempt++) {
				await fileInput.evaluate((el: HTMLInputElement) => { el.value = "" })
				await fileInput.setInputFiles(filePaths)

				try {
					if (toolTest.customPanel) {
						// Custom panels (e.g. CollagePanel) render their own UI after upload
						// Just verify the file input disappeared (files were accepted)
						await expect(page.locator('[data-testid="file-input"]')).not.toBeVisible({ timeout: 500 })
					} else if (!toolTest.skipRun) {
						await expect(page.locator('[data-testid="run-button"]')).toBeVisible({ timeout: 500 })
					} else {
						await expect(page.locator('[data-testid="result-card"]')).toBeVisible({ timeout: 500 })
					}
					break
				} catch {
					if (attempt === 14) throw new Error(`Upload failed after 15 attempts for ${toolTest.id}`)
					await page.waitForTimeout(500)
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

			// 4. Smooth scroll to run button and click (unless skipped)
			let cutStartSecs = 0
			let cutEndSecs = 0

			if (!toolTest.skipRun) {
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
						timeout: 240_000,
					})
					cutEndSecs = (Date.now() - testStart) / 1000
				} catch (e) {
					await page.screenshot({ path: "failure-screenshot.png", fullPage: true })
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
			if (cutStartSecs > 0 && cutEndSecs > cutStartSecs + 1 && testInfo.outputDir) {
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
