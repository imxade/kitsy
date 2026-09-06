import { beforeAll, describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { splitPdfByBookmarks, imagesToPdf } from "../../src/lib/pdf-processor"
import { getToolById } from "../../src/lib/tool-registry"
import { PDFDocument } from "pdf-lib"
import { createDummyImage, createDummyPdfWithBookmarks } from "./test-helpers"

const PDF_SOURCES: Record<string, string> = {
	"tracemonkey.pdf":
		"https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/tracemonkey.pdf",
	"normal.pdf":
		"https://raw.githubusercontent.com/Hopding/pdf-lib/master/assets/pdfs/normal.pdf",
}

async function ensureScratchPdf(filename: string): Promise<File> {
	const scratchDir = path.resolve(process.cwd(), "scratch")
	if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true })
	const filePath = path.join(scratchDir, filename)
	if (!fs.existsSync(filePath)) {
		const url = PDF_SOURCES[filename]
		if (url) {
			const res = await fetch(url)
			const buf = Buffer.from(await res.arrayBuffer())
			fs.writeFileSync(filePath, buf)
		}
	}
	const buf = fs.readFileSync(filePath)
	return new File([buf], filename, { type: "application/pdf" })
}

function getRequiredTool(id: string) {
	const tool = getToolById(id)
	if (!tool) throw new Error(`Tool not found: ${id}`)
	return tool
}

describe("Real-world PDF testing for all tools added today", () => {
	let tracemonkey: File
	let normal: File

	beforeAll(async () => {
		tracemonkey = await ensureScratchPdf("tracemonkey.pdf")
		normal = await ensureScratchPdf("normal.pdf")
	})

	// Tool 1: Alternate & Mix PDF
	it("1. Alternate & Mix PDF interleaves two real PDFs correctly", async () => {
		const tool = getRequiredTool("pdf-alternate-mix")
		const results = await tool.process([normal, normal], {})
		expect(results).toHaveLength(1)
		const doc = await PDFDocument.load(await results[0].blob.arrayBuffer())
		const normalDoc = await PDFDocument.load(await normal.arrayBuffer())
		expect(doc.getPageCount()).toBe(normalDoc.getPageCount() * 2)
	})

	// Tool 2: Split PDF in Half
	it("2. Split PDF in Half divides a 14-page PDF into two 7-page PDFs", async () => {
		const tool = getRequiredTool("pdf-split-half")
		const results = await tool.process([tracemonkey], {})
		expect(results).toHaveLength(2)
		expect(results[0].name).toBe("tracemonkey-part-1.pdf")
		expect(results[1].name).toBe("tracemonkey-part-2.pdf")

		const doc1 = await PDFDocument.load(await results[0].blob.arrayBuffer())
		const doc2 = await PDFDocument.load(await results[1].blob.arrayBuffer())
		expect(doc1.getPageCount()).toBe(7)
		expect(doc2.getPageCount()).toBe(7)
	})

	// Tool 3: Split PDF by Bookmarks
	it("3. Split PDF by Bookmarks gives a clear error when outlines are missing", async () => {
		const tool = getRequiredTool("pdf-split-bookmarks")
		await expect(tool.process([tracemonkey], {})).rejects.toThrow(
			"no usable bookmarks",
		)
	})

	it("3b. Split PDF by Bookmarks splits a PDF that has real bookmarks", async () => {
		const bookmarkedPdf = await createDummyPdfWithBookmarks()
		const results = await splitPdfByBookmarks(bookmarkedPdf)
		expect(results).toHaveLength(2)
		expect(results[0].name).toBe("bookmarks-bookmark-split-1.pdf")
		expect(results[1].name).toBe("bookmarks-bookmark-split-2.pdf")
		const doc1 = await PDFDocument.load(await results[0].blob.arrayBuffer())
		const doc2 = await PDFDocument.load(await results[1].blob.arrayBuffer())
		expect(doc1.getPageCount()).toBe(1)
		expect(doc2.getPageCount()).toBe(2)
	})

	// Tool 4: Split PDF by Text
	it("4. Split PDF by Text splits before matching pages (e.g. 'References')", async () => {
		const tool = getRequiredTool("pdf-split-text")
		const results = await tool.process([tracemonkey], { phrase: "References" })
		expect(results.length).toBe(2)
		expect(results[0].name).toBe("tracemonkey-text-split-1.pdf")
		expect(results[1].name).toBe("tracemonkey-text-split-2.pdf")

		const doc1 = await PDFDocument.load(await results[0].blob.arrayBuffer())
		const doc2 = await PDFDocument.load(await results[1].blob.arrayBuffer())
		expect(doc1.getPageCount() + doc2.getPageCount()).toBe(14)
	})

	it("4b. Split PDF by Text splits after matching page on real PDF", async () => {
		const tool = getRequiredTool("pdf-split-text")
		const results = await tool.process([normal], {
			phrase: "Enter Line 5 amount",
			splitPosition: "after",
		})
		expect(results).toHaveLength(2)
		const doc1 = await PDFDocument.load(await results[0].blob.arrayBuffer())
		const doc2 = await PDFDocument.load(await results[1].blob.arrayBuffer())
		expect(doc1.getPageCount()).toBe(1)
		expect(doc2.getPageCount()).toBe(1)
	})

	it("4c. Split PDF by Text gives helpful error when text is only on page 1 with 'before'", async () => {
		const tool = getRequiredTool("pdf-split-text")
		await expect(
			tool.process([normal], {
				phrase: "Enter Line 5 amount",
				splitPosition: "before",
			}),
		).rejects.toThrow('Choose "After matching page" as the split position')
	})

	it("4d. Split PDF by Text matches words across line breaks (de-hyphenation)", async () => {
		const tool = getRequiredTool("pdf-split-text")
		// 'TraceMonkey' appears as 'Trace-\nMonkey' on page 2 in tracemonkey.pdf
		const results = await tool.process([tracemonkey], { phrase: "TraceMonkey" })
		expect(results.length).toBeGreaterThan(1)
	})

	// Tool 5: Flip PDF
	it("5. Flip PDF produces valid horizontal and vertical flipped PDFs", async () => {
		const tool = getRequiredTool("pdf-flip")
		const resH = await tool.process([normal], { direction: "horizontal" })
		const resV = await tool.process([normal], { direction: "vertical" })
		expect(resH[0].name).toBe("normal-flipped-horizontal.pdf")
		expect(resV[0].name).toBe("normal-flipped-vertical.pdf")

		const docH = await PDFDocument.load(await resH[0].blob.arrayBuffer())
		const docV = await PDFDocument.load(await resV[0].blob.arrayBuffer())
		expect(docH.getPageCount()).toBe(2)
		expect(docV.getPageCount()).toBe(2)
	})

	// Tool 6: Add PDF Page Numbers
	it("6. Add PDF Page Numbers stamps page numbers at different positions", async () => {
		const tool = getRequiredTool("pdf-page-numbers")
		for (const pos of [
			"bottom-center",
			"top-center",
			"bottom-left",
			"bottom-right",
		]) {
			const res = await tool.process([normal], { position: pos })
			expect(res[0].name).toBe("normal-numbered.pdf")
			const doc = await PDFDocument.load(await res[0].blob.arrayBuffer())
			expect(doc.getPageCount()).toBe(2)
		}
	})

	// Tool 7: Extract PDF Text
	it("7. Extract PDF Text exports markdown from real multi-page PDF", async () => {
		const tool = getRequiredTool("pdf-extract-text")
		const res = await tool.process([tracemonkey], {})
		expect(res[0].name).toBe("tracemonkey.md")
		const markdown = await res[0].blob.text()
		expect(markdown).toContain("# tracemonkey")
		expect(markdown).toContain("## Page 1")
		expect(markdown).toContain("## Page 14")
	})

	// Tool 8: Compare PDF Text
	it("8. Compare PDF Text generates JSON report of text differences", async () => {
		const tool = getRequiredTool("pdf-compare-text")
		const res = await tool.process([tracemonkey, normal], {})
		expect(res[0].name).toBe("pdf-text-comparison.json")
		const text = await res[0].blob.text()
		const report = JSON.parse(text)
		expect(report.kind).toBe("text-layer-comparison")
		expect(report.changedPages.length).toBeGreaterThan(0)
	})

	// Tool 9: Add PDF Text (Overlay)
	it("9. Add PDF Text adds overlay with unicode & non-WinAnsi text safely", async () => {
		const tool = getRequiredTool("pdf-add-content")
		const res = await tool.process([normal], {
			text: "“Confidential” — Checked ✓ by Reviewer",
			page: 1,
			x: 72,
			y: 700,
			fontSize: 14,
			color: "#cc0000",
		})
		expect(res[0].name).toBe("normal-with-text.pdf")
		const doc = await PDFDocument.load(await res[0].blob.arrayBuffer())
		expect(doc.getPageCount()).toBe(2)
	})

	// Tool 10: Scan to PDF
	it("10. Scan to PDF converts images into PDF pages", async () => {
		const tool = getRequiredTool("scan-to-pdf")
		expect(tool.uiMode).toBe("scanner")
		expect(tool.requiresFiles).toBe(false)

		const img1 = createDummyImage("scan1.png", "image/png")
		const img2 = createDummyImage("scan2.png", "image/png")
		const pdfResult = await imagesToPdf([img1, img2])
		expect(pdfResult.name).toBe("images.pdf")
		const doc = await PDFDocument.load(await pdfResult.blob.arrayBuffer())
		expect(doc.getPageCount()).toBe(2)
	})
})
