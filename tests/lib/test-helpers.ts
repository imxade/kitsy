/**
 * Test helpers: programmatically generate dummy files for testing.
 * These avoid needing external fixture files.
 */

import { PDFDocument } from "pdf-lib"

/** Create a minimal valid PDF with the given number of pages and optional text. */
export async function createDummyPdf(
	pages: number = 1,
	text?: string,
): Promise<File> {
	const doc = await PDFDocument.create()
	for (let i = 0; i < pages; i++) {
		const page = doc.addPage([612, 792]) // Letter size
		if (text) {
			page.drawText(`${text} (Page ${i + 1})`, { x: 50, y: 700, size: 14 })
		}
	}
	const bytes = await doc.save()
	return new File([bytes.slice()], "test.pdf", { type: "application/pdf" })
}

/** Create a minimal PDF with outline bookmarks pointing to different pages. */
export async function createDummyPdfWithBookmarks(): Promise<File> {
	const { PDFHexString, PDFName } = await import("pdf-lib")
	const doc = await PDFDocument.create()
	const p1 = doc.addPage([612, 792])
	p1.drawText("Chapter 1", { x: 50, y: 700, size: 14 })
	const p2 = doc.addPage([612, 792])
	p2.drawText("Chapter 2", { x: 50, y: 700, size: 14 })
	const p3 = doc.addPage([612, 792])
	p3.drawText("Chapter 3", { x: 50, y: 700, size: 14 })

	const { context } = doc
	const item1Ref = context.nextRef()
	const item2Ref = context.nextRef()
	const outlinesRef = context.nextRef()

	const outlinesDict = context.obj({
		Type: "Outlines",
		First: item1Ref,
		Last: item2Ref,
		Count: 2,
	})
	context.assign(outlinesRef, outlinesDict)

	const item1 = context.obj({
		Title: PDFHexString.fromText("Chapter 1"),
		Parent: outlinesRef,
		Next: item2Ref,
		Dest: [p1.ref, PDFName.of("Fit")],
	})
	context.assign(item1Ref, item1)

	const item2 = context.obj({
		Title: PDFHexString.fromText("Chapter 2"),
		Parent: outlinesRef,
		Prev: item1Ref,
		Dest: [p2.ref, PDFName.of("Fit")],
	})
	context.assign(item2Ref, item2)

	doc.catalog.set(PDFName.of("Outlines"), outlinesRef)
	const bytes = await doc.save()
	return new File([bytes.slice()], "bookmarks.pdf", { type: "application/pdf" })
}

/** Create a minimal 1x1 PNG file. */
export function createDummyImage(name = "test.png", type = "image/png"): File {
	// Minimal 1x1 red pixel PNG
	const pngBytes = new Uint8Array([
		0x89,
		0x50,
		0x4e,
		0x47,
		0x0d,
		0x0a,
		0x1a,
		0x0a, // PNG signature
		0x00,
		0x00,
		0x00,
		0x0d,
		0x49,
		0x48,
		0x44,
		0x52, // IHDR chunk
		0x00,
		0x00,
		0x00,
		0x01,
		0x00,
		0x00,
		0x00,
		0x01,
		0x08,
		0x02,
		0x00,
		0x00,
		0x00,
		0x90,
		0x77,
		0x53,
		0xde,
		0x00,
		0x00,
		0x00,
		0x0c,
		0x49,
		0x44,
		0x41, // IDAT chunk
		0x54,
		0x08,
		0xd7,
		0x63,
		0xf8,
		0xcf,
		0xc0,
		0x00,
		0x00,
		0x00,
		0x02,
		0x00,
		0x01,
		0xe2,
		0x21,
		0xbc,
		0x33,
		0x00,
		0x00,
		0x00,
		0x00,
		0x49,
		0x45,
		0x4e, // IEND chunk
		0x44,
		0xae,
		0x42,
		0x60,
		0x82,
	])
	return new File([pngBytes], name, { type })
}

/** Create a dummy text file. */
export function createDummyTextFile(
	content = "Hello, World!",
	name = "test.txt",
): File {
	return new File([content], name, { type: "text/plain" })
}

/** Create multiple dummy files for batch testing. */
export function createDummyImages(count: number): File[] {
	return Array.from({ length: count }, (_, i) =>
		createDummyImage(`image-${i + 1}.png`),
	)
}
