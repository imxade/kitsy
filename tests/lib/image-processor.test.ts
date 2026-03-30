import { describe, it, expect } from "vitest"
import {
	convertImage,
	compressImage,
	resizeImage,
	rotateImage,
	cropImage,
	upscaleImage,
	imageToSvg,
} from "../../src/lib/image-processor"
import { createDummyImage } from "./test-helpers"

// Note: Image processing uses OffscreenCanvas which is not available in jsdom.
// These tests verify the functions exist and type-check correctly.
// Actual processing is tested via browser e2e.

describe("image-processor", () => {
	it("exports all image processing functions", () => {
		expect(typeof convertImage).toBe("function")
		expect(typeof compressImage).toBe("function")
		expect(typeof resizeImage).toBe("function")
		expect(typeof rotateImage).toBe("function")
		expect(typeof cropImage).toBe("function")
		expect(typeof upscaleImage).toBe("function")
		expect(typeof imageToSvg).toBe("function")
	})

	it("createDummyImage produces a valid File object", () => {
		const img = createDummyImage("test.png", "image/png")
		expect(img).toBeInstanceOf(File)
		expect(img.name).toBe("test.png")
		expect(img.type).toBe("image/png")
		expect(img.size).toBeGreaterThan(0)
	})
})
