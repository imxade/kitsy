import { describe, it, expect } from "vitest"
import { createZip } from "../../src/lib/file-processor"
import { createDummyTextFile, createDummyImage } from "./test-helpers"

describe("file-processor", () => {
	it("createZip produces a valid ZIP blob", async () => {
		const file1 = createDummyTextFile("Hello", "hello.txt")
		const file2 = createDummyTextFile("World", "world.txt")
		const result = await createZip([file1, file2])
		expect(result.name).toBe("archive.zip")
		expect(result.blob.type).toBe("application/zip")
		expect(result.blob.size).toBeGreaterThan(0)
	})

	it("createZip works with a single file", async () => {
		const file = createDummyTextFile("Only one", "single.txt")
		const result = await createZip([file])
		expect(result.blob.size).toBeGreaterThan(0)
	})

	it("createZip works with image files", async () => {
		const img = createDummyImage("photo.png")
		const result = await createZip([img])
		expect(result.name).toBe("archive.zip")
		expect(result.blob.size).toBeGreaterThan(0)
	})
})
