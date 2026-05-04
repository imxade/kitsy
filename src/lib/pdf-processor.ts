// ── PDF Processor — pdf-lib + pdfjs-dist ──

import {
	PDFDocument,
	StandardFonts,
	degrees,
	rgb,
	type PDFImage,
} from "pdf-lib"
import { type ProcessedFile, loadDrawable } from "./image-processor"
import { getPdfjsLib } from "./pdfjs"

/** pdf-lib returns Uint8Array<ArrayBufferLike> which TS6 rejects as BlobPart.
 *  Slice to get a fresh ArrayBuffer-backed copy. */
function pdfBlob(data: Uint8Array): Blob {
	return new Blob([data.slice()], { type: "application/pdf" })
}

export async function mergePdfs(files: File[]): Promise<ProcessedFile> {
	const merged = await PDFDocument.create()

	for (const file of files) {
		const bytes = await file.arrayBuffer()
		const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
		const pages = await merged.copyPages(src, src.getPageIndices())
		for (const page of pages) {
			merged.addPage(page)
		}
	}

	const outBytes = await merged.save()
	return {
		blob: pdfBlob(outBytes),
		name: "merged.pdf",
	}
}

export async function splitPdf(file: File): Promise<ProcessedFile[]> {
	const bytes = await file.arrayBuffer()
	const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
	const results: ProcessedFile[] = []

	for (let i = 0; i < src.getPageCount(); i++) {
		const single = await PDFDocument.create()
		const [page] = await single.copyPages(src, [i])
		single.addPage(page)
		const pageOut = await single.save()
		results.push({
			blob: pdfBlob(pageOut),
			name: `page-${i + 1}.pdf`,
		})
	}

	return results
}

export async function deletePdfPages(
	file: File,
	pageNumbers: number[],
): Promise<ProcessedFile> {
	const bytes = await file.arrayBuffer()
	const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
	const total = src.getPageCount()

	// Convert 1-indexed page numbers to 0-indexed, sort descending to remove from end
	const indices = pageNumbers
		.map((n) => n - 1)
		.filter((i) => i >= 0 && i < total)
		.sort((a, b) => b - a)

	for (const idx of indices) {
		src.removePage(idx)
	}

	if (src.getPageCount() === 0) {
		throw new Error("Cannot delete all pages from PDF")
	}

	const delBytes = await src.save()
	const baseName = file.name.replace(/\.pdf$/i, "")
	return {
		blob: pdfBlob(delBytes),
		name: `${baseName}-edited.pdf`,
	}
}

export async function reorderPdfPages(
	file: File,
	newOrder: number[],
): Promise<ProcessedFile> {
	const bytes = await file.arrayBuffer()
	const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
	const dest = await PDFDocument.create()

	// newOrder is 1-indexed page numbers in desired order
	for (const pageNum of newOrder) {
		const idx = pageNum - 1
		if (idx >= 0 && idx < src.getPageCount()) {
			const [page] = await dest.copyPages(src, [idx])
			dest.addPage(page)
		}
	}

	if (dest.getPageCount() === 0) {
		throw new Error("No valid pages in the new order")
	}

	const reorderBytes = await dest.save()
	const baseName = file.name.replace(/\.pdf$/i, "")
	return {
		blob: pdfBlob(reorderBytes),
		name: `${baseName}-reordered.pdf`,
	}
}

export async function imagesToPdf(files: File[]): Promise<ProcessedFile> {
	const doc = await PDFDocument.create()

	for (const file of files) {
		const imgBytes = await file.arrayBuffer()
		const uint8 = new Uint8Array(imgBytes)
		let image: PDFImage
		if (file.type === "image/png") {
			image = await doc.embedPng(uint8)
		} else if (file.type === "image/jpeg" || file.type === "image/jpg") {
			image = await doc.embedJpg(uint8)
		} else {
			// Convert other formats to PNG via canvas first
			const {
				img: bitmap,
				width: bmpW,
				height: bmpH,
				close,
			} = await loadDrawable(file)
			const canvas = new OffscreenCanvas(bmpW, bmpH)
			const ctx = canvas.getContext("2d")
			if (!ctx) throw new Error("Could not get 2D context")
			ctx.drawImage(bitmap, 0, 0, bmpW, bmpH)
			close()
			const pngBlob = await canvas.convertToBlob({ type: "image/png" })
			const pngBytes = new Uint8Array(await pngBlob.arrayBuffer())
			image = await doc.embedPng(pngBytes)
		}

		const page = doc.addPage([image.width, image.height])
		page.drawImage(image, {
			x: 0,
			y: 0,
			width: image.width,
			height: image.height,
		})
	}

	const imgPdfBytes = await doc.save()
	return {
		blob: pdfBlob(imgPdfBytes),
		name: "images.pdf",
	}
}

export async function compressPdf(file: File): Promise<ProcessedFile> {
	const bytes = await file.arrayBuffer()
	const doc = await PDFDocument.load(bytes)
	const compressedBytes = await doc.save({
		useObjectStreams: true,
	})
	return {
		blob: pdfBlob(new Uint8Array(compressedBytes)),
		name: `${file.name.replace(/\.pdf$/i, "")}-compressed.pdf`,
	}
}

export async function addPdfWatermark(
	file: File,
	text: string,
): Promise<ProcessedFile> {
	const bytes = await file.arrayBuffer()
	const doc = await PDFDocument.load(bytes)
	const font = await doc.embedFont(StandardFonts.Helvetica)
	const pages = doc.getPages()

	for (const page of pages) {
		const { width, height } = page.getSize()
		page.drawText(text, {
			x: width / 4,
			y: height / 2,
			size: 50,
			font,
			color: rgb(0.7, 0.7, 0.7),
			opacity: 0.3,
			rotate: degrees(45),
		})
	}

	const watermarkedBytes = await doc.save()
	return {
		blob: pdfBlob(new Uint8Array(watermarkedBytes)),
		name: `${file.name.replace(/\.pdf$/i, "")}-watermarked.pdf`,
	}
}

export async function rotatePdf(
	file: File,
	angle: number,
): Promise<ProcessedFile> {
	const bytes = await file.arrayBuffer()
	const doc = await PDFDocument.load(bytes)
	const pages = doc.getPages()

	for (const page of pages) {
		const currentRotation = page.getRotation().angle
		page.setRotation(degrees(currentRotation + angle))
	}

	const rotatedBytes = await doc.save()
	return {
		blob: pdfBlob(new Uint8Array(rotatedBytes)),
		name: `${file.name.replace(/\.pdf$/i, "")}-rotated.pdf`,
	}
}

export async function pdfToText(file: File): Promise<ProcessedFile> {
	const pdfjsLib = await getPdfjsLib()

	const bytes = await file.arrayBuffer()
	const uint8 = new Uint8Array(bytes)
	const doc = await pdfjsLib.getDocument({
		data: uint8,
		useWorkerFetch: false,
		isEvalSupported: false,
		useSystemFonts: true,
	}).promise

	const textParts: string[] = []

	for (let i = 1; i <= doc.numPages; i++) {
		const page = await doc.getPage(i)
		const content = await page.getTextContent()
		const pageText = content.items
			.map((item: unknown) => {
				const ti = item as { str?: string }
				return ti.str ?? ""
			})
			.join(" ")
		textParts.push(`--- Page ${i} ---\n${pageText}`)
	}

	const fullText = textParts.join("\n\n")
	const baseName = file.name.replace(/\.pdf$/i, "")
	return {
		blob: new Blob([fullText], { type: "text/plain" }),
		name: `${baseName}.txt`,
	}
}

export async function pdfToImages(
	file: File,
	format: string,
	scale: number,
): Promise<ProcessedFile[]> {
	const pdfjsLib = await getPdfjsLib()

	const bytes = await file.arrayBuffer()
	const uint8 = new Uint8Array(bytes)
	const doc = await pdfjsLib.getDocument({
		data: uint8,
		useWorkerFetch: false,
		isEvalSupported: false,
		useSystemFonts: true,
	}).promise

	const mime = format === "jpg" ? "image/jpeg" : "image/png"
	const ext = format === "jpg" ? ".jpg" : ".png"
	const results: ProcessedFile[] = []
	const baseName = file.name.replace(/\.pdf$/i, "")

	for (let i = 1; i <= doc.numPages; i++) {
		const page = await doc.getPage(i)
		const viewport = page.getViewport({ scale })
		const canvas = new OffscreenCanvas(viewport.width, viewport.height)
		const ctx = canvas.getContext("2d")
		if (!ctx) throw new Error("Could not get 2D context")

		await page.render({
			canvasContext: ctx as unknown as CanvasRenderingContext2D,
			viewport,
			canvas: canvas as unknown as HTMLCanvasElement,
		}).promise

		const blob = await canvas.convertToBlob({
			type: mime,
			quality: 0.92,
		})
		results.push({
			blob,
			name: `${baseName}-page-${i}${ext}`,
		})
	}

	return results
}

export async function addPageNumbers(
	file: File,
	position: string,
): Promise<ProcessedFile> {
	const bytes = await file.arrayBuffer()
	const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
	const font = await doc.embedFont(StandardFonts.Helvetica)
	const pages = doc.getPages()
	const total = pages.length

	for (let i = 0; i < total; i++) {
		const page = pages[i]
		const { width, height } = page.getSize()
		const text = `${i + 1} / ${total}`
		const textWidth = font.widthOfTextAtSize(text, 12)

		let x: number
		let y: number

		switch (position) {
			case "top-left":
				x = 40
				y = height - 30
				break
			case "top-center":
				x = (width - textWidth) / 2
				y = height - 30
				break
			case "top-right":
				x = width - textWidth - 40
				y = height - 30
				break
			case "bottom-left":
				x = 40
				y = 20
				break
			case "bottom-right":
				x = width - textWidth - 40
				y = 20
				break
			default:
				// bottom-center
				x = (width - textWidth) / 2
				y = 20
				break
		}

		page.drawText(text, {
			x,
			y,
			size: 12,
			font,
			color: rgb(0.3, 0.3, 0.3),
		})
	}

	const numberedBytes = await doc.save()
	const baseName = file.name.replace(/\.pdf$/i, "")
	return {
		blob: pdfBlob(numberedBytes),
		name: `${baseName}-numbered.pdf`,
	}
}

export async function flattenPdf(file: File): Promise<ProcessedFile> {
	const bytes = await file.arrayBuffer()
	const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
	const form = doc.getForm()
	form.flatten()
	const flatBytes = await doc.save()
	const baseName = file.name.replace(/\.pdf$/i, "")
	return {
		blob: pdfBlob(flatBytes),
		name: `${baseName}-flattened.pdf`,
	}
}

export async function editPdfMetadata(
	file: File,
	title: string,
	author: string,
	subject: string,
	keywords: string,
): Promise<ProcessedFile> {
	const bytes = await file.arrayBuffer()
	const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })

	if (title) doc.setTitle(title)
	if (author) doc.setAuthor(author)
	if (subject) doc.setSubject(subject)
	if (keywords) {
		doc.setKeywords(keywords.split(",").map((k) => k.trim()))
	}

	const metaBytes = await doc.save()
	const baseName = file.name.replace(/\.pdf$/i, "")
	return {
		blob: pdfBlob(metaBytes),
		name: `${baseName}-metadata.pdf`,
	}
}
