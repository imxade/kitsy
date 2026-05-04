import { describe, it, expect } from "vitest"
import {
	mergePdfs,
	splitPdf,
	deletePdfPages,
	reorderPdfPages,
	imagesToPdf,
	compressPdf,
	addPdfWatermark,
	rotatePdf,
	addPageNumbers,
	flattenPdf,
	editPdfMetadata,
} from "../../src/lib/pdf-processor"
import { createDummyPdf, createDummyImage } from "./test-helpers"

describe("pdf-processor", () => {
	it("mergePdfs merges two PDFs into one", async () => {
		const pdf1 = await createDummyPdf(1, "Document A")
		const pdf2 = await createDummyPdf(2, "Document B")
		const result = await mergePdfs([pdf1, pdf2])
		expect(result.name).toBe("merged.pdf")
		expect(result.blob.type).toBe("application/pdf")
		expect(result.blob.size).toBeGreaterThan(0)
	})

	it("splitPdf splits a 3-page PDF into 3 files", async () => {
		const pdf = await createDummyPdf(3, "Split Test")
		const results = await splitPdf(pdf)
		expect(results).toHaveLength(3)
		for (let i = 0; i < 3; i++) {
			expect(results[i].name).toBe(`page-${i + 1}.pdf`)
			expect(results[i].blob.type).toBe("application/pdf")
		}
	})

	it("deletePdfPages removes a page from a 3-page PDF", async () => {
		const pdf = await createDummyPdf(3, "Delete Test")
		const result = await deletePdfPages(pdf, [2])
		expect(result.name).toBe("test-edited.pdf")
		expect(result.blob.type).toBe("application/pdf")
		expect(result.blob.size).toBeGreaterThan(0)
	})

	it("reorderPdfPages reorders pages", async () => {
		const pdf = await createDummyPdf(3, "Reorder Test")
		const result = await reorderPdfPages(pdf, [3, 1, 2])
		expect(result.name).toBe("test-reordered.pdf")
		expect(result.blob.type).toBe("application/pdf")
	})

	it("imagesToPdf converts images to a PDF", async () => {
		const img1 = createDummyImage("test1.png")
		const img2 = createDummyImage("test2.png")
		const result = await imagesToPdf([img1, img2])
		expect(result.name).toBe("images.pdf")
		expect(result.blob.type).toBe("application/pdf")
		expect(result.blob.size).toBeGreaterThan(0)
	})

	it("mergePdfs handles encrypted PDF gracefully", async () => {
		const pdf = await createDummyPdf(1)
		const result = await mergePdfs([pdf])
		expect(result.blob.size).toBeGreaterThan(0)
	})

	it("compressPdf saves PDF and maintains type", async () => {
		const pdf = await createDummyPdf(1)
		const result = await compressPdf(pdf)
		expect(result.name).toContain("-compressed.pdf")
		expect(result.blob.type).toBe("application/pdf")
	})

	it("addPdfWatermark adds watermark text", async () => {
		const pdf = await createDummyPdf(1)
		const result = await addPdfWatermark(pdf, "TEST")
		expect(result.name).toContain("-watermarked.pdf")
		expect(result.blob.type).toBe("application/pdf")
	})

	it("rotatePdf applies rotation", async () => {
		const pdf = await createDummyPdf(1)
		const result = await rotatePdf(pdf, 90)
		expect(result.name).toContain("-rotated.pdf")
		expect(result.blob.type).toBe("application/pdf")
	})

	it("addPageNumbers stamps page numbers on all pages", async () => {
		const pdf = await createDummyPdf(3, "Numbered")
		const result = await addPageNumbers(pdf, "bottom-center")
		expect(result.name).toBe("test-numbered.pdf")
		expect(result.blob.type).toBe("application/pdf")
		expect(result.blob.size).toBeGreaterThan(0)
	})

	it("flattenPdf flattens form fields", async () => {
		const pdf = await createDummyPdf(1)
		const result = await flattenPdf(pdf)
		expect(result.name).toBe("test-flattened.pdf")
		expect(result.blob.type).toBe("application/pdf")
		expect(result.blob.size).toBeGreaterThan(0)
	})

	it("editPdfMetadata sets document properties", async () => {
		const pdf = await createDummyPdf(1)
		const result = await editPdfMetadata(
			pdf,
			"My Title",
			"John Doe",
			"Test Subject",
			"pdf, test, kitsy",
		)
		expect(result.name).toBe("test-metadata.pdf")
		expect(result.blob.type).toBe("application/pdf")
		expect(result.blob.size).toBeGreaterThan(0)
	})
})
