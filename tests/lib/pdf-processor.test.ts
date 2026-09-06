import { describe, it, expect } from "vitest"
import { PDFDocument } from "pdf-lib"
import forge from "node-forge"
import {
	mergePdfs,
	alternateMixPdfs,
	splitPdf,
	splitPdfInHalf,
	splitPdfByText,
	splitPdfByBookmarks,
	flipPdf,
	addPdfTextOverlay,
	comparePdfText,
	fillPdfForm,
	deletePdfPages,
	reorderPdfPages,
	extractPdfPages,
	addPdfHeaderFooter,
	addBatesNumbers,
	addBlankPdfPages,
	removeBlankPdfPages,
	cropPdfPages,
	overlayPdfPages,
	resizePdfPages,
	combinePdfPagesIntoOne,
	nUpPdf,
	pdfPageDimensions,
	signPdfVisually,
	lockPdf,
	unlockPdf,
	digitallySignPdf,
	validatePdfSignatures,
	imagesToPdf,
	pdfToMarkdown,
	compressPdf,
	addPdfWatermark,
	rotatePdf,
	addPageNumbers,
	flattenPdf,
	editPdfMetadata,
	stripPdfMetadata,
	removePdfAnnotations,
} from "../../src/lib/pdf-processor"
import { createDummyPdf, createDummyImage } from "./test-helpers"

function createTestCertificate(password: string): File {
	const keys = forge.pki.rsa.generateKeyPair(1024)
	const cert = forge.pki.createCertificate()
	cert.publicKey = keys.publicKey
	cert.serialNumber = "01"
	cert.validity.notBefore = new Date("2026-01-01T00:00:00.000Z")
	cert.validity.notAfter = new Date("2027-01-01T00:00:00.000Z")
	const attrs = [
		{ name: "commonName", value: "Kitsy Test" },
		{ name: "organizationName", value: "Kitsy" },
	]
	cert.setSubject(attrs)
	cert.setIssuer(attrs)
	cert.sign(keys.privateKey, forge.md.sha256.create())

	const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, {
		algorithm: "3des",
	})
	const der = forge.asn1.toDer(p12).getBytes()
	const bytes = new Uint8Array(der.length)
	for (let i = 0; i < der.length; i++) {
		bytes[i] = der.charCodeAt(i)
	}

	return new File([bytes], "test.p12", { type: "application/x-pkcs12" })
}

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

	it("alternateMixPdfs interleaves source pages", async () => {
		const first = await createDummyPdf(2, "First")
		const second = await createDummyPdf(1, "Second")
		const result = await alternateMixPdfs([first, second])
		const document = await PDFDocument.load(await result.blob.arrayBuffer())

		expect(result.name).toBe("alternated.pdf")
		expect(document.getPageCount()).toBe(3)
	})

	it("splitPdfInHalf creates two valid page-count halves", async () => {
		const pdf = await createDummyPdf(5, "Halves")
		const results = await splitPdfInHalf(pdf)

		expect(results).toHaveLength(2)
		expect(
			await PDFDocument.load(await results[0].blob.arrayBuffer()).then((doc) =>
				doc.getPageCount(),
			),
		).toBe(3)
		expect(
			await PDFDocument.load(await results[1].blob.arrayBuffer()).then((doc) =>
				doc.getPageCount(),
			),
		).toBe(2)
	})

	it("splitPdfByText splits on later matching text-layer pages", async () => {
		const source = await createDummyPdf(3, "Marker")
		const results = await splitPdfByText(source, "Marker")

		expect(results).toHaveLength(3)
		for (const result of results) {
			const document = await PDFDocument.load(await result.blob.arrayBuffer())
			expect(document.getPageCount()).toBe(1)
		}
	})

	it("splitPdfByBookmarks gives a clear error when outlines are absent", async () => {
		const source = await createDummyPdf(2, "No outline")
		await expect(splitPdfByBookmarks(source)).rejects.toThrow(
			"no usable bookmarks",
		)
	})

	it("flipPdf produces a valid mirrored PDF", async () => {
		const source = await createDummyPdf(2, "Flip")
		const result = await flipPdf(source, "horizontal")
		const document = await PDFDocument.load(await result.blob.arrayBuffer())

		expect(result.name).toBe("test-flipped-horizontal.pdf")
		expect(document.getPageCount()).toBe(2)
	})

	it("addPdfTextOverlay produces a valid PDF without editing source text", async () => {
		const source = await createDummyPdf(1, "Source")
		const result = await addPdfTextOverlay(
			source,
			"Added locally",
			1,
			72,
			72,
			14,
			"#000000",
		)
		const document = await PDFDocument.load(await result.blob.arrayBuffer())

		expect(result.name).toBe("test-with-text.pdf")
		expect(document.getPageCount()).toBe(1)
	})

	it("comparePdfText reports changed text-layer pages", async () => {
		const left = await createDummyPdf(1, "Left")
		const right = await createDummyPdf(1, "Right")
		const result = await comparePdfText(left, right)
		const report = JSON.parse(await result.blob.text()) as {
			changedPages: number[]
		}

		expect(result.name).toBe("pdf-text-comparison.json")
		expect(report.changedPages).toEqual([1])
	})

	it("fillPdfForm fills and flattens a standard AcroForm field", async () => {
		const document = await PDFDocument.create()
		document.addPage([612, 792])
		const field = document.getForm().createTextField("name")
		field.addToPage(document.getPage(0), {
			x: 72,
			y: 700,
			width: 180,
			height: 24,
		})
		const source = new File([(await document.save()).slice()], "form.pdf", {
			type: "application/pdf",
		})
		const result = await fillPdfForm(source, { name: "Kitsy" }, true)
		const output = await PDFDocument.load(await result.blob.arrayBuffer())

		expect(result.name).toBe("form-filled.pdf")
		expect(output.getForm().getFields()).toHaveLength(0)
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

	it("extractPdfPages creates a PDF from selected ranges", async () => {
		const pdf = await createDummyPdf(5, "Extract Test")
		const result = await extractPdfPages(pdf, "2,4-5")
		const doc = await PDFDocument.load(await result.blob.arrayBuffer())

		expect(result.name).toBe("test-extracted.pdf")
		expect(result.blob.type).toBe("application/pdf")
		expect(doc.getPageCount()).toBe(3)
	})

	it("addPdfHeaderFooter stamps selected pages", async () => {
		const pdf = await createDummyPdf(2, "Header Footer Test")
		const result = await addPdfHeaderFooter(
			pdf,
			"Left {page}",
			"Center",
			"Right",
			"",
			"Page {page} of {total}",
			"",
			"1",
			10,
			"#000000",
		)

		expect(result.name).toBe("test-header-footer.pdf")
		expect(result.blob.type).toBe("application/pdf")
		expect(result.blob.size).toBeGreaterThan(0)
	})

	it("addBatesNumbers numbers multiple PDFs sequentially", async () => {
		const pdf1 = await createDummyPdf(2, "Bates A")
		const pdf2 = await createDummyPdf(1, "Bates B")
		const results = await addBatesNumbers(
			[pdf1, pdf2],
			"[BATES]",
			10,
			1,
			4,
			"bottom-center",
			10,
			"#000000",
		)

		expect(results).toHaveLength(2)
		expect(results[0].name).toBe("test-bates.pdf")
		expect(results[1].name).toBe("test-bates.pdf")
		expect(results[0].blob.type).toBe("application/pdf")
	})

	it("addBlankPdfPages inserts blank pages", async () => {
		const pdf = await createDummyPdf(2, "Blank Test")
		const result = await addBlankPdfPages(pdf, "end", 2, "letter", 612, 792)
		const doc = await PDFDocument.load(await result.blob.arrayBuffer())

		expect(result.name).toBe("test-blank-pages.pdf")
		expect(result.blob.type).toBe("application/pdf")
		expect(doc.getPageCount()).toBe(4)
	})

	it("removeBlankPdfPages removes structurally blank pages", async () => {
		const doc = await PDFDocument.create()
		const first = doc.addPage([612, 792])
		first.drawText("Not blank", { x: 50, y: 700, size: 14 })
		doc.addPage([612, 792])
		const bytes = await doc.save()
		const pdf = new File([bytes.slice()], "mixed.pdf", {
			type: "application/pdf",
		})
		const result = await removeBlankPdfPages(pdf)
		const out = await PDFDocument.load(await result.blob.arrayBuffer())

		expect(result.name).toBe("mixed-no-blank-pages.pdf")
		expect(result.blob.type).toBe("application/pdf")
		expect(out.getPageCount()).toBe(1)
	})

	it("cropPdfPages sets crop boxes on every page", async () => {
		const pdf = await createDummyPdf(2, "Crop Test")
		const result = await cropPdfPages(pdf, 10, 20, 30, 40)
		const doc = await PDFDocument.load(await result.blob.arrayBuffer())
		const cropBox = doc.getPage(0).getCropBox()

		expect(result.name).toBe("test-cropped.pdf")
		expect(result.blob.type).toBe("application/pdf")
		expect(cropBox.x).toBe(10)
		expect(cropBox.y).toBe(40)
		expect(cropBox.width).toBe(582)
		expect(cropBox.height).toBe(722)
	})

	it("overlayPdfPages draws an overlay PDF onto the base PDF", async () => {
		const base = await createDummyPdf(2, "Base")
		const overlay = await createDummyPdf(1, "Overlay")
		const result = await overlayPdfPages(base, overlay, 0.5)
		const doc = await PDFDocument.load(await result.blob.arrayBuffer())

		expect(result.name).toBe("test-overlay.pdf")
		expect(result.blob.type).toBe("application/pdf")
		expect(doc.getPageCount()).toBe(2)
	})

	it("resizePdfPages changes page dimensions", async () => {
		const pdf = await createDummyPdf(1, "Resize Test")
		const result = await resizePdfPages(pdf, "custom", 300, 400, true)
		const doc = await PDFDocument.load(await result.blob.arrayBuffer())
		const pageSize = doc.getPage(0).getSize()

		expect(result.name).toBe("test-resized-pages.pdf")
		expect(result.blob.type).toBe("application/pdf")
		expect(pageSize.width).toBe(300)
		expect(pageSize.height).toBe(400)
	})

	it("combinePdfPagesIntoOne stacks all pages into one page", async () => {
		const pdf = await createDummyPdf(3, "Combine Test")
		const result = await combinePdfPagesIntoOne(pdf, "vertical", 10)
		const doc = await PDFDocument.load(await result.blob.arrayBuffer())

		expect(result.name).toBe("test-single-page.pdf")
		expect(result.blob.type).toBe("application/pdf")
		expect(doc.getPageCount()).toBe(1)
	})

	it("nUpPdf places multiple pages onto fewer sheets", async () => {
		const pdf = await createDummyPdf(5, "N-up Test")
		const result = await nUpPdf(pdf, 4, 18, 12)
		const doc = await PDFDocument.load(await result.blob.arrayBuffer())

		expect(result.name).toBe("test-n-up.pdf")
		expect(result.blob.type).toBe("application/pdf")
		expect(doc.getPageCount()).toBe(2)
	})

	it("pdfPageDimensions exports page dimensions as CSV", async () => {
		const pdf = await createDummyPdf(2, "Dimensions Test")
		const result = await pdfPageDimensions(pdf)
		const text = await result.blob.text()

		expect(result.name).toBe("test-page-dimensions.csv")
		expect(result.blob.type).toBe("text/csv")
		expect(text).toContain("page,width_pt,height_pt,width_in,height_in")
		expect(text).toContain("1,612.00,792.00,8.50,11.00")
		expect(text).toContain("2,612.00,792.00,8.50,11.00")
	})

	it("signPdfVisually adds a visible text signature stamp", async () => {
		const pdf = await createDummyPdf(1, "Sign Test")
		const result = await signPdfVisually(
			pdf,
			"Jane Example",
			undefined,
			1,
			72,
			72,
			180,
			24,
		)
		const doc = await PDFDocument.load(await result.blob.arrayBuffer())

		expect(result.name).toBe("test-signed.pdf")
		expect(result.blob.type).toBe("application/pdf")
		expect(doc.getPageCount()).toBe(1)
		expect(result.blob.size).toBeGreaterThan(pdf.size)
	})

	it("lockPdf encrypts and unlockPdf decrypts a PDF", async () => {
		const pdf = await createDummyPdf(1, "Lock Test")
		const locked = await lockPdf(pdf, "kitsy-test", "kitsy-test")
		const unlockedFile = new File([locked.blob], locked.name, {
			type: "application/pdf",
		})
		const unlocked = await unlockPdf(unlockedFile, "kitsy-test")
		const doc = await PDFDocument.load(await unlocked.blob.arrayBuffer())

		expect(locked.name).toBe("test-locked.pdf")
		expect(unlocked.name).toBe("test-locked-unlocked.pdf")
		expect(doc.getPageCount()).toBe(1)
	})

	it("digitallySignPdf signs a PDF with a P12 certificate", async () => {
		const pdf = await createDummyPdf(1, "Digital Sign Test")
		const certificate = createTestCertificate("secret")
		const result = await digitallySignPdf(
			pdf,
			certificate,
			"secret",
			"Approved",
			"Test",
		)

		expect(result.name).toBe("test-digitally-signed.pdf")
		expect(result.blob.type).toBe("application/pdf")
		expect(result.blob.size).toBeGreaterThan(pdf.size)
	})

	it("validatePdfSignatures exports a report for a signed PDF", async () => {
		const pdf = await createDummyPdf(1, "Validate Signature Test")
		const certificate = createTestCertificate("secret")
		const signed = await digitallySignPdf(
			pdf,
			certificate,
			"secret",
			"Approved",
			"Test",
		)
		const signedFile = new File([signed.blob], signed.name, {
			type: "application/pdf",
		})
		const report = await validatePdfSignatures(signedFile)
		const json = JSON.parse(await report.blob.text()) as {
			signatureCount: number
			signatures: Array<{
				signerName: string
				cryptoVerificationStatus?: string
			}>
		}

		expect(report.name).toBe("test-digitally-signed-signature-report.json")
		expect(report.blob.type).toBe("application/json")
		expect(json.signatureCount).toBeGreaterThanOrEqual(1)
		expect(json.signatures[0].signerName).toBe("Kitsy Test")
		expect(json.signatures[0].cryptoVerificationStatus).toBe("verified")
	})

	it("pdfToMarkdown extracts text into Markdown", async () => {
		const pdf = await createDummyPdf(1, "Markdown Test")
		const result = await pdfToMarkdown(pdf)
		const markdown = await result.blob.text()

		expect(result.name).toBe("test.md")
		expect(result.blob.type).toBe("text/markdown")
		expect(markdown).toContain("# test")
		expect(markdown).toContain("## Page 1")
		expect(markdown).toContain("Markdown Test")
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

	it("stripPdfMetadata removes all metadata", async () => {
		const pdf = await createDummyPdf(1, "Strip Test")
		const result = await stripPdfMetadata(pdf)
		expect(result.name).toBe("test-stripped.pdf")
		expect(result.blob.type).toBe("application/pdf")
		expect(result.blob.size).toBeGreaterThan(0)
	})

	it("removePdfAnnotations produces a valid PDF", async () => {
		const pdf = await createDummyPdf(2)
		const result = await removePdfAnnotations(pdf)
		expect(result.name).toBe("test-no-annotations.pdf")
		expect(result.blob.type).toBe("application/pdf")
		expect(result.blob.size).toBeGreaterThan(0)
	})
})
