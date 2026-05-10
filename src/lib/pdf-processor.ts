// ── PDF Processor — pdf-lib + pdfjs-dist ──

import createQpdfModule, { type QpdfInstance } from "@neslinesli93/qpdf-wasm"
import forge from "node-forge"
import zgaPdfSigner from "zgapdfsigner"
import type { PdfSigner as PdfSignerClass } from "zgapdfsigner"
import {
	PDFDocument,
	PDFName,
	StandardFonts,
	degrees,
	rgb,
	type PDFFont,
	type PDFImage,
	type PDFPage,
} from "pdf-lib"
import { type ProcessedFile, loadDrawable } from "./image-processor"
import { getPdfjsLib } from "./pdfjs"

interface ZgaPdfSignerModule {
	PdfSigner: typeof PdfSignerClass
}

const { PdfSigner } = zgaPdfSigner as ZgaPdfSignerModule

function wasmLog(moduleName: string, message: string, detail?: unknown) {
	if (detail === undefined) {
		console.log(`[${moduleName}]`, message)
		return
	}
	console.log(`[${moduleName}]`, message, detail)
}

/** pdf-lib returns Uint8Array<ArrayBufferLike> which TS6 rejects as BlobPart.
 *  Slice to get a fresh ArrayBuffer-backed copy. */
function pdfBlob(data: Uint8Array): Blob {
	return new Blob([data.slice()], { type: "application/pdf" })
}

let qpdfInstance: Promise<QpdfInstance> | undefined
function getQpdf(): Promise<QpdfInstance> {
	qpdfInstance ??= (async () => {
		wasmLog("qpdf", "loading wasm")
		try {
			const qpdfConfig = {
				locateFile: () => {
					wasmLog("qpdf", "locating qpdf.wasm")
					return typeof window === "undefined"
						? "public/qpdf.wasm"
						: "/qpdf.wasm"
				},
				print: (message: string) => wasmLog("qpdf", message),
				printErr: (message: string) => console.warn("[qpdf]", message),
			}
			const instance = await createQpdfModule(qpdfConfig)
			wasmLog("qpdf", "ready")
			return instance
		} catch (error) {
			console.error("[qpdf]", "failed to load", error)
			throw error
		}
	})()
	return qpdfInstance
}

type QpdfRuntime = QpdfInstance & {
	FS: QpdfInstance["FS"] & {
		writeFile: (path: string, data: Uint8Array) => void
		unlink: (path: string) => void
		analyzePath?: (path: string) => { exists: boolean }
	}
}

async function runQpdf(
	file: File,
	argsFor: (inputPath: string, outputPath: string) => string[],
	suffix: string,
): Promise<ProcessedFile> {
	wasmLog("qpdf", `starting ${suffix}`, file.name)
	const qpdf = (await getQpdf()) as QpdfRuntime
	const token = Math.random().toString(36).slice(2)
	const inputPath = `/input-${token}.pdf`
	const outputPath = `/output-${token}.pdf`

	try {
		wasmLog("qpdf", "writing input", inputPath)
		qpdf.FS.writeFile(inputPath, new Uint8Array(await file.arrayBuffer()))
		const args = argsFor(inputPath, outputPath)
		wasmLog("qpdf", "running", args)
		qpdf.callMain(args)
		const output = qpdf.FS.readFile(outputPath)
		wasmLog("qpdf", `finished ${suffix}`, `${output.length} bytes`)
		const baseName = file.name.replace(/\.pdf$/i, "")
		return {
			blob: pdfBlob(output),
			name: `${baseName}-${suffix}.pdf`,
		}
	} finally {
		for (const path of [inputPath, outputPath]) {
			try {
				if (!qpdf.FS.analyzePath || qpdf.FS.analyzePath(path).exists) {
					qpdf.FS.unlink(path)
				}
			} catch {
				// qpdf may not create the output file if conversion fails.
			}
		}
	}
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

function parsePageRanges(selection: string, total: number): number[] {
	const selected = new Set<number>()
	const parts = selection
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean)

	for (const part of parts) {
		const [startRaw, endRaw] = part.split("-")
		const start = Number(startRaw)
		const end = endRaw ? Number(endRaw) : start
		if (!Number.isInteger(start) || !Number.isInteger(end)) continue

		const min = Math.max(1, Math.min(start, end))
		const max = Math.min(total, Math.max(start, end))
		for (let page = min; page <= max; page++) {
			selected.add(page - 1)
		}
	}

	return [...selected].sort((a, b) => a - b)
}

function parseOptionalPageRanges(selection: string, total: number): number[] {
	const normalized = selection.trim().toLowerCase()
	if (!normalized || normalized === "all") {
		return Array.from({ length: total }, (_, index) => index)
	}
	return parsePageRanges(selection, total)
}

function getPageSize(
	size: string,
	width: number,
	height: number,
): [number, number] {
	switch (size) {
		case "a4":
			return [595.28, 841.89]
		case "letter":
			return [612, 792]
		case "custom":
			return [width, height]
		default:
			return [0, 0]
	}
}

async function embedSignatureImage(
	pdf: PDFDocument,
	file: File,
): Promise<PDFImage> {
	const bytes = await file.arrayBuffer()
	const name = file.name.toLowerCase()
	if (file.type === "image/png" || name.endsWith(".png")) {
		return pdf.embedPng(bytes)
	}
	if (
		file.type === "image/jpeg" ||
		name.endsWith(".jpg") ||
		name.endsWith(".jpeg")
	) {
		return pdf.embedJpg(bytes)
	}

	const { img, width, height, close } = await loadDrawable(file)
	const canvas = new OffscreenCanvas(width, height)
	const ctx = canvas.getContext("2d")
	if (!ctx) throw new Error("Could not get canvas context")
	ctx.drawImage(img, 0, 0)
	close()
	const png = await canvas.convertToBlob({ type: "image/png" })
	return pdf.embedPng(await png.arrayBuffer())
}

function parseHexColor(hex: string): { r: number; g: number; b: number } {
	const cleaned = hex.replace("#", "").trim()
	if (!/^[0-9a-f]{6}$/i.test(cleaned)) {
		return { r: 0, g: 0, b: 0 }
	}

	return {
		r: Number.parseInt(cleaned.slice(0, 2), 16) / 255,
		g: Number.parseInt(cleaned.slice(2, 4), 16) / 255,
		b: Number.parseInt(cleaned.slice(4, 6), 16) / 255,
	}
}

function drawAlignedText(
	page: PDFPage,
	text: string,
	horizontal: "left" | "center" | "right",
	y: number,
	font: PDFFont,
	size: number,
	colorHex: string,
) {
	if (!text) return

	const { width } = page.getSize()
	const margin = 40
	const textWidth = font.widthOfTextAtSize(text, size)
	const x =
		horizontal === "center"
			? (width - textWidth) / 2
			: horizontal === "right"
				? width - textWidth - margin
				: margin
	const color = parseHexColor(colorHex)

	page.drawText(text, {
		x,
		y,
		size,
		font,
		color: rgb(color.r, color.g, color.b),
	})
}

export async function extractPdfPages(
	file: File,
	selection: string,
): Promise<ProcessedFile> {
	const bytes = await file.arrayBuffer()
	const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
	const indices = parsePageRanges(selection, src.getPageCount())
	if (indices.length === 0) {
		throw new Error("Enter at least one valid page or range, such as 1,3-5")
	}

	const dest = await PDFDocument.create()
	const pages = await dest.copyPages(src, indices)
	for (const page of pages) {
		dest.addPage(page)
	}

	const outBytes = await dest.save()
	const baseName = file.name.replace(/\.pdf$/i, "")
	return {
		blob: pdfBlob(outBytes),
		name: `${baseName}-extracted.pdf`,
	}
}

export async function addPdfHeaderFooter(
	file: File,
	headerLeft: string,
	headerCenter: string,
	headerRight: string,
	footerLeft: string,
	footerCenter: string,
	footerRight: string,
	pageRange: string,
	fontSize: number,
	colorHex: string,
): Promise<ProcessedFile> {
	const bytes = await file.arrayBuffer()
	const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
	const font = await doc.embedFont(StandardFonts.Helvetica)
	const pages = doc.getPages()
	const indices = parseOptionalPageRanges(pageRange, pages.length)
	const size = Math.max(6, Math.min(72, Math.floor(fontSize || 10)))

	if (indices.length === 0) {
		throw new Error("No valid pages in the selected range")
	}

	for (const index of indices) {
		const page = pages[index]
		const { height } = page.getSize()
		const pageNumber = index + 1
		const replaceTokens = (text: string) =>
			text
				.replace(/\{page\}/g, String(pageNumber))
				.replace(/\{total\}/g, String(pages.length))

		drawAlignedText(
			page,
			replaceTokens(headerLeft),
			"left",
			height - 40,
			font,
			size,
			colorHex,
		)
		drawAlignedText(
			page,
			replaceTokens(headerCenter),
			"center",
			height - 40,
			font,
			size,
			colorHex,
		)
		drawAlignedText(
			page,
			replaceTokens(headerRight),
			"right",
			height - 40,
			font,
			size,
			colorHex,
		)
		drawAlignedText(
			page,
			replaceTokens(footerLeft),
			"left",
			40,
			font,
			size,
			colorHex,
		)
		drawAlignedText(
			page,
			replaceTokens(footerCenter),
			"center",
			40,
			font,
			size,
			colorHex,
		)
		drawAlignedText(
			page,
			replaceTokens(footerRight),
			"right",
			40,
			font,
			size,
			colorHex,
		)
	}

	const outBytes = await doc.save()
	const baseName = file.name.replace(/\.pdf$/i, "")
	return {
		blob: pdfBlob(outBytes),
		name: `${baseName}-header-footer.pdf`,
	}
}

function formatBatesText(
	template: string,
	batesNumber: number,
	pageNumber: number,
	fileNumber: number,
	fileName: string,
	padding: number,
): string {
	const bates =
		padding > 0
			? String(batesNumber).padStart(Math.min(12, padding), "0")
			: String(batesNumber)
	return template
		.replace(/\[BATES\]/g, bates)
		.replace(/\[PAGE\]/g, String(pageNumber))
		.replace(/\[FILE\]/g, String(fileNumber))
		.replace(/\[FILENAME\]/g, fileName)
}

export async function addBatesNumbers(
	files: File[],
	template: string,
	startNumber: number,
	fileStart: number,
	padding: number,
	position: string,
	fontSize: number,
	colorHex: string,
): Promise<ProcessedFile[]> {
	const results: ProcessedFile[] = []
	let batesCounter = Math.max(0, Math.floor(startNumber || 1))
	let fileCounter = Math.max(0, Math.floor(fileStart || 1))
	const size = Math.max(6, Math.min(72, Math.floor(fontSize || 10)))
	const pad = Math.max(0, Math.min(12, Math.floor(padding || 0)))

	for (const file of files) {
		const bytes = await file.arrayBuffer()
		const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
		const font = await doc.embedFont(StandardFonts.Helvetica)
		const color = parseHexColor(colorHex)
		const fileName = file.name.replace(/\.pdf$/i, "")

		doc.getPages().forEach((page, index) => {
			const { width, height } = page.getSize()
			const text = formatBatesText(
				template || "[BATES]",
				batesCounter,
				index + 1,
				fileCounter,
				fileName,
				pad,
			)
			const textWidth = font.widthOfTextAtSize(text, size)
			const margin = 40
			const x = position.endsWith("right")
				? width - textWidth - margin
				: position.endsWith("center")
					? (width - textWidth) / 2
					: margin
			const y = position.startsWith("top") ? height - margin : margin

			page.drawText(text, {
				x,
				y,
				size,
				font,
				color: rgb(color.r, color.g, color.b),
			})
			batesCounter++
		})

		fileCounter++
		const outBytes = await doc.save()
		results.push({
			blob: pdfBlob(outBytes),
			name: `${file.name.replace(/\.pdf$/i, "")}-bates.pdf`,
		})
	}

	return results
}

export async function addBlankPdfPages(
	file: File,
	position: string,
	count: number,
	size: string,
	width: number,
	height: number,
): Promise<ProcessedFile> {
	const bytes = await file.arrayBuffer()
	const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
	const pageCount = Math.max(1, Math.min(50, Math.floor(count || 1)))
	const firstPage = doc.getPage(0)
	const fallbackSize = firstPage.getSize()
	const selectedSize = getPageSize(size, width, height)
	const pageSize: [number, number] =
		selectedSize[0] > 0 && selectedSize[1] > 0
			? selectedSize
			: [fallbackSize.width, fallbackSize.height]

	if (pageSize[0] <= 0 || pageSize[1] <= 0) {
		throw new Error("Blank page dimensions must be greater than zero")
	}

	if (position === "start") {
		for (let i = 0; i < pageCount; i++) {
			doc.insertPage(i, pageSize)
		}
	} else {
		for (let i = 0; i < pageCount; i++) {
			doc.addPage(pageSize)
		}
	}

	const outBytes = await doc.save()
	const baseName = file.name.replace(/\.pdf$/i, "")
	return {
		blob: pdfBlob(outBytes),
		name: `${baseName}-blank-pages.pdf`,
	}
}

function pageLooksBlank(page: PDFPage) {
	const contents = page.node.Contents()
	const annots = page.node.Annots()?.asArray()
	return !contents && (!annots || annots.length === 0)
}

export async function removeBlankPdfPages(file: File): Promise<ProcessedFile> {
	const bytes = await file.arrayBuffer()
	const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
	const blankIndices = new Set(
		src
			.getPages()
			.map((page, index) => (pageLooksBlank(page) ? index : -1))
			.filter((index) => index >= 0),
	)

	if (blankIndices.size === 0) {
		throw new Error("No blank pages detected")
	}

	if (blankIndices.size === src.getPageCount()) {
		throw new Error("Cannot remove every page from a PDF")
	}

	const dest = await PDFDocument.create()
	for (let index = 0; index < src.getPageCount(); index++) {
		if (!blankIndices.has(index)) {
			const [page] = await dest.copyPages(src, [index])
			dest.addPage(page)
		}
	}

	const outBytes = await dest.save()
	const baseName = file.name.replace(/\.pdf$/i, "")
	return {
		blob: pdfBlob(outBytes),
		name: `${baseName}-no-blank-pages.pdf`,
	}
}

export async function cropPdfPages(
	file: File,
	left: number,
	right: number,
	top: number,
	bottom: number,
): Promise<ProcessedFile> {
	const bytes = await file.arrayBuffer()
	const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })

	for (const page of doc.getPages()) {
		const { width, height } = page.getSize()
		const cropLeft = Math.max(0, left)
		const cropRight = Math.max(0, right)
		const cropTop = Math.max(0, top)
		const cropBottom = Math.max(0, bottom)
		const croppedWidth = width - cropLeft - cropRight
		const croppedHeight = height - cropTop - cropBottom

		if (croppedWidth <= 0 || croppedHeight <= 0) {
			throw new Error("Crop margins are larger than the PDF page size")
		}

		page.setCropBox(cropLeft, cropBottom, croppedWidth, croppedHeight)
	}

	const outBytes = await doc.save()
	const baseName = file.name.replace(/\.pdf$/i, "")
	return {
		blob: pdfBlob(outBytes),
		name: `${baseName}-cropped.pdf`,
	}
}

export async function overlayPdfPages(
	file: File,
	overlayFile: File,
	opacity: number,
): Promise<ProcessedFile> {
	const bytes = await file.arrayBuffer()
	const overlayBytes = await overlayFile.arrayBuffer()
	const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
	const overlayDoc = await PDFDocument.load(overlayBytes, {
		ignoreEncryption: true,
	})
	const overlayPages = overlayDoc.getPages()
	if (overlayPages.length === 0) {
		throw new Error("Overlay PDF has no pages")
	}

	const normalizedOpacity = Math.max(0, Math.min(1, opacity))

	for (const [index, page] of doc.getPages().entries()) {
		const overlayPage = overlayPages[Math.min(index, overlayPages.length - 1)]
		const embedded = await doc.embedPage(overlayPage)
		const { width, height } = page.getSize()
		const scale = Math.min(width / embedded.width, height / embedded.height)
		const drawWidth = embedded.width * scale
		const drawHeight = embedded.height * scale
		page.drawPage(embedded, {
			x: (width - drawWidth) / 2,
			y: (height - drawHeight) / 2,
			width: drawWidth,
			height: drawHeight,
			opacity: normalizedOpacity,
		})
	}

	const outBytes = await doc.save()
	const baseName = file.name.replace(/\.pdf$/i, "")
	return {
		blob: pdfBlob(outBytes),
		name: `${baseName}-overlay.pdf`,
	}
}

export async function pdfPageDimensions(file: File): Promise<ProcessedFile> {
	const bytes = await file.arrayBuffer()
	const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
	const rows = ["page,width_pt,height_pt,width_in,height_in,rotation_deg"]

	doc.getPages().forEach((page, index) => {
		const { width, height } = page.getSize()
		rows.push(
			[
				index + 1,
				width.toFixed(2),
				height.toFixed(2),
				(width / 72).toFixed(2),
				(height / 72).toFixed(2),
				page.getRotation().angle,
			].join(","),
		)
	})

	const baseName = file.name.replace(/\.pdf$/i, "")
	return {
		blob: new Blob([rows.join("\n")], { type: "text/csv" }),
		name: `${baseName}-page-dimensions.csv`,
	}
}

export async function combinePdfPagesIntoOne(
	file: File,
	orientation: string,
	spacing: number,
): Promise<ProcessedFile> {
	const bytes = await file.arrayBuffer()
	const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
	const dest = await PDFDocument.create()
	const sourcePages = src.getPages()
	const embeddedPages = await dest.embedPages(sourcePages)
	const safeSpacing = Math.max(0, Math.min(500, spacing || 0))
	const horizontal = orientation === "horizontal"

	const finalWidth = horizontal
		? embeddedPages.reduce((sum, page) => sum + page.width, 0) +
			safeSpacing * Math.max(0, embeddedPages.length - 1)
		: Math.max(...embeddedPages.map((page) => page.width))
	const finalHeight = horizontal
		? Math.max(...embeddedPages.map((page) => page.height))
		: embeddedPages.reduce((sum, page) => sum + page.height, 0) +
			safeSpacing * Math.max(0, embeddedPages.length - 1)
	const page = dest.addPage([finalWidth, finalHeight])

	let x = 0
	let y = finalHeight
	for (const embedded of embeddedPages) {
		if (horizontal) {
			page.drawPage(embedded, {
				x,
				y: (finalHeight - embedded.height) / 2,
				width: embedded.width,
				height: embedded.height,
			})
			x += embedded.width + safeSpacing
		} else {
			y -= embedded.height
			page.drawPage(embedded, {
				x: (finalWidth - embedded.width) / 2,
				y,
				width: embedded.width,
				height: embedded.height,
			})
			y -= safeSpacing
		}
	}

	const outBytes = await dest.save()
	const baseName = file.name.replace(/\.pdf$/i, "")
	return {
		blob: pdfBlob(outBytes),
		name: `${baseName}-single-page.pdf`,
	}
}

export async function resizePdfPages(
	file: File,
	size: string,
	width: number,
	height: number,
	scaleContent: boolean,
): Promise<ProcessedFile> {
	const bytes = await file.arrayBuffer()
	const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
	const [targetWidth, targetHeight] = getPageSize(size, width, height)

	if (targetWidth <= 0 || targetHeight <= 0) {
		throw new Error("Target page dimensions must be greater than zero")
	}

	for (const page of doc.getPages()) {
		const { width: oldWidth, height: oldHeight } = page.getSize()
		page.setSize(targetWidth, targetHeight)
		if (scaleContent) {
			page.scaleContent(targetWidth / oldWidth, targetHeight / oldHeight)
			page.scaleAnnotations(targetWidth / oldWidth, targetHeight / oldHeight)
		}
	}

	const outBytes = await doc.save()
	const baseName = file.name.replace(/\.pdf$/i, "")
	return {
		blob: pdfBlob(outBytes),
		name: `${baseName}-resized-pages.pdf`,
	}
}

function getNUpGrid(pagesPerSheet: number): { columns: number; rows: number } {
	switch (pagesPerSheet) {
		case 2:
			return { columns: 1, rows: 2 }
		case 6:
			return { columns: 2, rows: 3 }
		case 8:
			return { columns: 2, rows: 4 }
		default:
			return { columns: 2, rows: 2 }
	}
}

export async function nUpPdf(
	file: File,
	pagesPerSheet: number,
	margin: number,
	gutter: number,
): Promise<ProcessedFile> {
	const bytes = await file.arrayBuffer()
	const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
	const dest = await PDFDocument.create()
	const sourcePages = src.getPages()
	const firstSize = sourcePages[0].getSize()
	const grid = getNUpGrid(pagesPerSheet)
	const safeMargin = Math.max(0, margin)
	const safeGutter = Math.max(0, gutter)
	const sheetWidth = firstSize.width
	const sheetHeight = firstSize.height
	const cellWidth =
		(sheetWidth - safeMargin * 2 - safeGutter * (grid.columns - 1)) /
		grid.columns
	const cellHeight =
		(sheetHeight - safeMargin * 2 - safeGutter * (grid.rows - 1)) / grid.rows

	if (cellWidth <= 0 || cellHeight <= 0) {
		throw new Error("N-up margins and gutters leave no room for pages")
	}

	for (let index = 0; index < sourcePages.length; index += pagesPerSheet) {
		const sheet = dest.addPage([sheetWidth, sheetHeight])
		const chunk = sourcePages.slice(index, index + pagesPerSheet)
		const embeddedPages = await dest.embedPages(chunk)

		embeddedPages.forEach((embeddedPage, chunkIndex) => {
			const column = chunkIndex % grid.columns
			const row = Math.floor(chunkIndex / grid.columns)
			const scale = Math.min(
				cellWidth / embeddedPage.width,
				cellHeight / embeddedPage.height,
			)
			const width = embeddedPage.width * scale
			const height = embeddedPage.height * scale
			const x =
				safeMargin + column * (cellWidth + safeGutter) + (cellWidth - width) / 2
			const y =
				sheetHeight -
				safeMargin -
				(row + 1) * cellHeight -
				row * safeGutter +
				(cellHeight - height) / 2

			sheet.drawPage(embeddedPage, { x, y, width, height })
		})
	}

	const outBytes = await dest.save()
	const baseName = file.name.replace(/\.pdf$/i, "")
	return {
		blob: pdfBlob(outBytes),
		name: `${baseName}-n-up.pdf`,
	}
}

export async function signPdfVisually(
	file: File,
	text: string,
	signatureImage: File | undefined,
	pageNumber: number,
	x: number,
	y: number,
	width: number,
	fontSize: number,
): Promise<ProcessedFile> {
	const bytes = await file.arrayBuffer()
	const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
	if (pdf.getPageCount() === 0) throw new Error("PDF has no pages")

	const pageIndex = Math.min(
		Math.max(0, Math.trunc(pageNumber) - 1),
		pdf.getPageCount() - 1,
	)
	const page = pdf.getPage(pageIndex)
	const pageSize = page.getSize()
	const left = Math.max(
		0,
		Math.min(Number.isFinite(x) ? x : 72, pageSize.width),
	)
	const bottom = Math.max(
		0,
		Math.min(Number.isFinite(y) ? y : 72, pageSize.height),
	)
	const stampWidth = Math.max(24, Number.isFinite(width) ? width : 180)
	const safeFontSize = Math.max(6, Number.isFinite(fontSize) ? fontSize : 24)
	const label = text.trim()

	if (!signatureImage && !label) {
		throw new Error("Provide signature text or an image")
	}

	if (signatureImage) {
		const image = await embedSignatureImage(pdf, signatureImage)
		const scaled = image.scale(stampWidth / image.width)
		page.drawImage(image, {
			x: left,
			y: bottom,
			width: scaled.width,
			height: scaled.height,
		})
	}

	if (label) {
		const font = await pdf.embedFont(StandardFonts.Helvetica)
		page.drawText(label, {
			x: left,
			y: signatureImage ? bottom - safeFontSize - 4 : bottom,
			size: safeFontSize,
			font,
			color: rgb(0.05, 0.05, 0.05),
		})
	}

	const outBytes = await pdf.save()
	const baseName = file.name.replace(/\.pdf$/i, "")
	return {
		blob: pdfBlob(outBytes),
		name: `${baseName}-signed.pdf`,
	}
}

export async function lockPdf(
	file: File,
	userPassword: string,
	ownerPassword: string,
): Promise<ProcessedFile> {
	const openPassword = userPassword.trim()
	if (!openPassword) throw new Error("Enter a password to lock the PDF")

	const permissionsPassword = ownerPassword.trim() || openPassword
	return runQpdf(
		file,
		(inputPath, outputPath) => [
			inputPath,
			"--encrypt",
			openPassword,
			permissionsPassword,
			"256",
			"--",
			outputPath,
		],
		"locked",
	)
}

export async function unlockPdf(
	file: File,
	password: string,
): Promise<ProcessedFile> {
	return runQpdf(
		file,
		(inputPath, outputPath) => {
			const args = [inputPath]
			const normalized = password.trim()
			if (normalized) args.push(`--password=${normalized}`)
			args.push("--decrypt", "--", outputPath)
			return args
		},
		"unlocked",
	)
}

export async function digitallySignPdf(
	file: File,
	certificateFile: File | undefined,
	password: string,
	reason: string,
	location: string,
): Promise<ProcessedFile> {
	if (!certificateFile) throw new Error("Select a PFX or P12 certificate file")

	wasmLog("zgapdfsigner", "signing PDF", file.name)
	const signer = new PdfSigner({
		p12cert: await certificateFile.arrayBuffer(),
		pwd: password,
		permission: 1,
		reason: reason.trim() || undefined,
		location: location.trim() || undefined,
	})
	const signed = await signer.sign(await file.arrayBuffer())
	wasmLog("zgapdfsigner", "signed PDF", `${signed.length} bytes`)
	const baseName = file.name.replace(/\.pdf$/i, "")
	return {
		blob: pdfBlob(signed),
		name: `${baseName}-digitally-signed.pdf`,
	}
}

const insecureDigestOids = new Set(["1.2.840.113549.2.5", "1.3.14.3.2.26"])

interface ExtractedPdfSignature {
	index: number
	contents: Uint8Array
	byteRange: number[]
	reason?: string
	location?: string
	contactInfo?: string
	name?: string
	signingTime?: string
}

interface PdfSignatureValidationResult {
	signatureIndex: number
	isValid: boolean
	signerName: string
	signerOrg?: string
	signerEmail?: string
	issuer: string
	issuerOrg?: string
	validFrom: string
	validTo: string
	isExpired: boolean
	isSelfSigned: boolean
	isTrusted: boolean
	algorithms: { digest: string; signature: string }
	serialNumber: string
	byteRange: number[]
	coverageStatus: "full" | "partial" | "unknown"
	reason?: string
	location?: string
	contactInfo?: string
	signatureDate?: string
	usesInsecureDigest?: boolean
	cryptoVerified?: boolean
	cryptoVerificationStatus?: CryptoVerificationResult["status"]
	unsupportedAlgorithmReason?: string
	errorMessage?: string
}

interface SignerInfoFields {
	digestOid: string
	authAttrs: forge.asn1.Asn1[] | null
	signatureBytes: string
}

type CryptoVerificationResult =
	| { status: "verified" }
	| { status: "failed"; reason: string }
	| { status: "unsupported"; reason: string }

interface SigScheme {
	kind: "rsa-pkcs1" | "rsa-pss" | "ecdsa" | "rsa-raw"
	hashName: "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512"
	pssSaltLength?: number
}

function latin1ToUint8(str: string): Uint8Array {
	const out = new Uint8Array(str.length)
	for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i)
	return out
}

function uint8ToLatin1(bytes: Uint8Array): string {
	let out = ""
	for (let i = 0; i < bytes.length; i++) {
		out += String.fromCharCode(bytes[i])
	}
	return out
}

function hexToBytes(hex: string): Uint8Array {
	const bytes = new Uint8Array(hex.length / 2)
	for (let i = 0; i < hex.length; i += 2) {
		bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16)
	}

	let actualLength = bytes.length
	while (actualLength > 0 && bytes[actualLength - 1] === 0) actualLength--
	return bytes.slice(0, actualLength)
}

function decodePdfLiteral(value: string): string {
	return value.replace(/\\([nrtbf()\\])/g, (_, escaped: string) => {
		const values: Record<string, string> = {
			n: "\n",
			r: "\r",
			t: "\t",
			b: "\b",
			f: "\f",
			"(": "(",
			")": ")",
			"\\": "\\",
		}
		return values[escaped] ?? escaped
	})
}

function extractPdfSignatures(pdfBytes: Uint8Array): ExtractedPdfSignature[] {
	const signatures: ExtractedPdfSignature[] = []
	const pdfString = new TextDecoder("latin1").decode(pdfBytes)
	const sigRegex = /\/Type\s*\/Sig\b/g
	let sigIndex = 0
	let sigMatch = sigRegex.exec(pdfString)

	while (sigMatch !== null) {
		const currentMatch = sigMatch
		sigMatch = sigRegex.exec(pdfString)
		const searchStart = Math.max(0, currentMatch.index - 5000)
		const searchEnd = Math.min(pdfString.length, currentMatch.index + 10000)
		const context = pdfString.slice(searchStart, searchEnd)
		const byteRangeMatch = context.match(
			/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/,
		)
		const contentsMatch = context.match(/\/Contents\s*<([0-9A-Fa-f]+)>/)
		if (!byteRangeMatch || !contentsMatch) continue

		const timeMatch = context.match(
			/\/M\s*\(D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/,
		)
		const reasonMatch = context.match(/\/Reason\s*\(([^)]*)\)/)
		const locationMatch = context.match(/\/Location\s*\(([^)]*)\)/)
		const contactMatch = context.match(/\/ContactInfo\s*\(([^)]*)\)/)
		const nameMatch = context.match(/\/Name\s*\(([^)]*)\)/)

		signatures.push({
			index: sigIndex++,
			contents: hexToBytes(contentsMatch[1]),
			byteRange: [
				Number.parseInt(byteRangeMatch[1], 10),
				Number.parseInt(byteRangeMatch[2], 10),
				Number.parseInt(byteRangeMatch[3], 10),
				Number.parseInt(byteRangeMatch[4], 10),
			],
			reason: reasonMatch ? decodePdfLiteral(reasonMatch[1]) : undefined,
			location: locationMatch ? decodePdfLiteral(locationMatch[1]) : undefined,
			contactInfo: contactMatch ? decodePdfLiteral(contactMatch[1]) : undefined,
			name: nameMatch ? decodePdfLiteral(nameMatch[1]) : undefined,
			signingTime: timeMatch
				? `${timeMatch[1]}-${timeMatch[2]}-${timeMatch[3]}T${timeMatch[4]}:${timeMatch[5]}:${timeMatch[6]}`
				: undefined,
		})
	}

	return signatures
}

function getDigestAlgorithmName(oid: string): string {
	const digestAlgorithms: Record<string, string> = {
		"1.2.840.113549.2.5": "MD5",
		"1.3.14.3.2.26": "SHA-1",
		"2.16.840.1.101.3.4.2.1": "SHA-256",
		"2.16.840.1.101.3.4.2.2": "SHA-384",
		"2.16.840.1.101.3.4.2.3": "SHA-512",
		"2.16.840.1.101.3.4.2.4": "SHA-224",
	}
	return digestAlgorithms[oid] || oid || "Unknown"
}

function getSignatureAlgorithmName(oid: string): string {
	const signatureAlgorithms: Record<string, string> = {
		"1.2.840.113549.1.1.1": "RSA",
		"1.2.840.113549.1.1.5": "RSA with SHA-1",
		"1.2.840.113549.1.1.11": "RSA with SHA-256",
		"1.2.840.113549.1.1.12": "RSA with SHA-384",
		"1.2.840.113549.1.1.13": "RSA with SHA-512",
		"1.2.840.10045.2.1": "ECDSA",
		"1.2.840.10045.4.1": "ECDSA with SHA-1",
		"1.2.840.10045.4.3.2": "ECDSA with SHA-256",
		"1.2.840.10045.4.3.3": "ECDSA with SHA-384",
		"1.2.840.10045.4.3.4": "ECDSA with SHA-512",
	}
	return signatureAlgorithms[oid] || oid || "Unknown"
}

function createMd(digestOid: string): forge.md.MessageDigest | null {
	switch (digestOid) {
		case forge.pki.oids.sha256:
			return forge.md.sha256.create()
		case forge.pki.oids.sha384:
			return forge.md.sha384.create()
		case forge.pki.oids.sha512:
			return forge.md.sha512.create()
		case forge.pki.oids.sha1:
			return forge.md.sha1.create()
		case forge.pki.oids.md5:
			return forge.md.md5.create()
		default:
			return null
	}
}

function hashNameFromOid(oid: string): SigScheme["hashName"] | null {
	switch (oid) {
		case "1.3.14.3.2.26":
			return "SHA-1"
		case "2.16.840.1.101.3.4.2.1":
			return "SHA-256"
		case "2.16.840.1.101.3.4.2.2":
			return "SHA-384"
		case "2.16.840.1.101.3.4.2.3":
			return "SHA-512"
		default:
			return null
	}
}

function parsePssParams(paramsNode: forge.asn1.Asn1 | undefined): {
	hashName: SigScheme["hashName"]
	saltLength: number
} {
	const fallback = { hashName: "SHA-1" as const, saltLength: 20 }
	if (!paramsNode || !Array.isArray(paramsNode.value)) return fallback
	let hashName: SigScheme["hashName"] = "SHA-1"
	let saltLength = 20
	for (const item of paramsNode.value) {
		if (item.tagClass !== forge.asn1.Class.CONTEXT_SPECIFIC) continue
		if (item.type === 0 && Array.isArray(item.value) && item.value[0]) {
			const algoIdSeq = item.value[0]
			if (Array.isArray(algoIdSeq.value) && algoIdSeq.value[0]) {
				const hashOid = forge.asn1.derToOid(algoIdSeq.value[0].value as string)
				const resolved = hashNameFromOid(hashOid)
				if (resolved) hashName = resolved
			}
		} else if (item.type === 2 && typeof item.value === "string") {
			let n = 0
			for (let i = 0; i < item.value.length; i++) {
				n = (n << 8) | item.value.charCodeAt(i)
			}
			if (n > 0 && n < 1024) saltLength = n
		}
	}
	return { hashName, saltLength }
}

function detectSigScheme(
	signatureAlgorithmArr: forge.asn1.Asn1[] | undefined,
	digestOid: string,
): SigScheme | { unsupported: string } {
	if (!signatureAlgorithmArr?.length)
		return { unsupported: "Missing signatureAlgorithm" }
	const oidNode = signatureAlgorithmArr[0]
	if (!oidNode || oidNode.type !== forge.asn1.Type.OID) {
		return { unsupported: "Malformed signatureAlgorithm" }
	}
	const oid = forge.asn1.derToOid(oidNode.value as string)
	const implicitHash = hashNameFromOid(digestOid)

	switch (oid) {
		case "1.2.840.113549.1.1.1":
			return implicitHash
				? { kind: "rsa-pkcs1", hashName: implicitHash }
				: { unsupported: `Unsupported digest OID ${digestOid}` }
		case "1.2.840.113549.1.1.5":
			return { kind: "rsa-pkcs1", hashName: "SHA-1" }
		case "1.2.840.113549.1.1.11":
			return { kind: "rsa-pkcs1", hashName: "SHA-256" }
		case "1.2.840.113549.1.1.12":
			return { kind: "rsa-pkcs1", hashName: "SHA-384" }
		case "1.2.840.113549.1.1.13":
			return { kind: "rsa-pkcs1", hashName: "SHA-512" }
		case "1.2.840.113549.1.1.10": {
			const params = parsePssParams(signatureAlgorithmArr[1])
			return {
				kind: "rsa-pss",
				hashName: params.hashName,
				pssSaltLength: params.saltLength,
			}
		}
		case "1.2.840.10045.4.1":
			return { kind: "ecdsa", hashName: "SHA-1" }
		case "1.2.840.10045.4.3.2":
			return { kind: "ecdsa", hashName: "SHA-256" }
		case "1.2.840.10045.4.3.3":
			return { kind: "ecdsa", hashName: "SHA-384" }
		case "1.2.840.10045.4.3.4":
			return { kind: "ecdsa", hashName: "SHA-512" }
		case "1.2.840.10045.2.1":
			return implicitHash
				? { kind: "ecdsa", hashName: implicitHash }
				: { unsupported: `Unsupported digest OID ${digestOid}` }
		default:
			return { unsupported: `Unsupported signature algorithm OID ${oid}` }
	}
}

function extractSignerInfoFields(
	p7: forge.pkcs7.PkcsSignedData & {
		rawCapture?: {
			digestAlgorithm?: string
			authenticatedAttributes?: forge.asn1.Asn1[]
			signature?: string
		}
	},
): SignerInfoFields | null {
	const rc = p7.rawCapture
	if (!rc || typeof rc.digestAlgorithm !== "string" || !rc.signature) {
		return null
	}
	return {
		digestOid: forge.asn1.derToOid(rc.digestAlgorithm),
		authAttrs: Array.isArray(rc.authenticatedAttributes)
			? rc.authenticatedAttributes
			: null,
		signatureBytes: rc.signature,
	}
}

function extractSpkiDer(
	p7: forge.pkcs7.PkcsSignedData & {
		rawCapture?: { certificates?: forge.asn1.Asn1 }
	},
): Uint8Array | null {
	try {
		const certsNode = p7.rawCapture?.certificates
		if (!certsNode || !Array.isArray(certsNode.value) || !certsNode.value[0]) {
			return null
		}
		const certAsn1 = certsNode.value[0]
		if (!Array.isArray(certAsn1.value) || !certAsn1.value[0]) return null
		const tbs = certAsn1.value[0]
		if (!Array.isArray(tbs.value)) return null
		const startIdx =
			tbs.value[0]?.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC ? 1 : 0
		const spkiAsn1 = tbs.value[startIdx + 5]
		return spkiAsn1
			? latin1ToUint8(forge.asn1.toDer(spkiAsn1).getBytes())
			: null
	} catch {
		return null
	}
}

function curveFromSpki(
	spkiDer: Uint8Array,
): { name: "P-256" | "P-384" | "P-521"; coordBytes: number } | null {
	try {
		const spki = forge.asn1.fromDer(uint8ToLatin1(spkiDer))
		if (!Array.isArray(spki.value) || !spki.value[0]) return null
		const algoId = spki.value[0]
		if (!Array.isArray(algoId.value) || !algoId.value[1]) return null
		const params = algoId.value[1]
		if (params.type !== forge.asn1.Type.OID) return null
		const oid = forge.asn1.derToOid(params.value as string)
		if (oid === "1.2.840.10045.3.1.7") {
			return { name: "P-256", coordBytes: 32 }
		}
		if (oid === "1.3.132.0.34") return { name: "P-384", coordBytes: 48 }
		if (oid === "1.3.132.0.35") return { name: "P-521", coordBytes: 66 }
		return null
	} catch {
		return null
	}
}

function ecdsaDerToP1363(
	derSig: Uint8Array,
	coordBytes: number,
): Uint8Array | null {
	try {
		const parsed = forge.asn1.fromDer(uint8ToLatin1(derSig))
		if (!Array.isArray(parsed.value) || parsed.value.length !== 2) return null
		const r = latin1ToUint8(parsed.value[0].value as string)
		const s = latin1ToUint8(parsed.value[1].value as string)
		const rStripped = r[0] === 0 && r.length > 1 ? r.slice(1) : r
		const sStripped = s[0] === 0 && s.length > 1 ? s.slice(1) : s
		if (rStripped.length > coordBytes || sStripped.length > coordBytes) {
			return null
		}
		const out = new Uint8Array(coordBytes * 2)
		out.set(rStripped, coordBytes - rStripped.length)
		out.set(sStripped, coordBytes * 2 - sStripped.length)
		return out
	} catch {
		return null
	}
}

async function verifyViaWebCrypto(
	scheme: SigScheme,
	spkiDer: Uint8Array,
	signedBytes: Uint8Array,
	signatureBytes: Uint8Array,
): Promise<CryptoVerificationResult> {
	const subtle = globalThis.crypto?.subtle
	if (!subtle) {
		return { status: "unsupported", reason: "Web Crypto API is unavailable" }
	}

	try {
		if (scheme.kind === "rsa-pss") {
			const key = await subtle.importKey(
				"spki",
				spkiDer,
				{ name: "RSA-PSS", hash: scheme.hashName },
				false,
				["verify"],
			)
			const ok = await subtle.verify(
				{ name: "RSA-PSS", saltLength: scheme.pssSaltLength ?? 32 },
				key,
				signatureBytes,
				signedBytes,
			)
			return ok
				? { status: "verified" }
				: { status: "failed", reason: "RSA-PSS verification failed" }
		}

		if (scheme.kind === "ecdsa") {
			const curve = curveFromSpki(spkiDer)
			if (!curve) {
				return { status: "unsupported", reason: "Unsupported ECDSA curve" }
			}
			const p1363 = ecdsaDerToP1363(signatureBytes, curve.coordBytes)
			if (!p1363) {
				return { status: "failed", reason: "Malformed ECDSA signature" }
			}
			const key = await subtle.importKey(
				"spki",
				spkiDer,
				{ name: "ECDSA", namedCurve: curve.name },
				false,
				["verify"],
			)
			const ok = await subtle.verify(
				{ name: "ECDSA", hash: scheme.hashName },
				key,
				p1363,
				signedBytes,
			)
			return ok
				? { status: "verified" }
				: { status: "failed", reason: "ECDSA verification failed" }
		}

		if (scheme.kind === "rsa-pkcs1") {
			const key = await subtle.importKey(
				"spki",
				spkiDer,
				{ name: "RSASSA-PKCS1-v1_5", hash: scheme.hashName },
				false,
				["verify"],
			)
			const ok = await subtle.verify(
				"RSASSA-PKCS1-v1_5",
				key,
				signatureBytes,
				signedBytes,
			)
			return ok
				? { status: "verified" }
				: { status: "failed", reason: "RSA-PKCS1 verification failed" }
		}

		return {
			status: "unsupported",
			reason: `Signature scheme ${scheme.kind} is unsupported`,
		}
	} catch (error) {
		return {
			status: "unsupported",
			reason:
				"Web Crypto import/verify failed: " +
				(error instanceof Error ? error.message : String(error)),
		}
	}
}

async function performCryptoVerification(
	p7: forge.pkcs7.PkcsSignedData & {
		rawCapture?: {
			signatureAlgorithm?: forge.asn1.Asn1[]
			certificates?: forge.asn1.Asn1
		}
	},
	pdfBytes: Uint8Array,
	byteRange: number[],
	signerCert: forge.pki.Certificate,
	fields: SignerInfoFields | null,
): Promise<CryptoVerificationResult> {
	if (!fields)
		return { status: "failed", reason: "Could not parse signer info" }
	if (byteRange.length !== 4) {
		return { status: "failed", reason: "Malformed ByteRange" }
	}

	const md = createMd(fields.digestOid)
	if (!md) {
		return {
			status: "unsupported",
			reason: `Unsupported digest OID ${fields.digestOid}`,
		}
	}

	const [start1, len1, start2, len2] = byteRange
	if (
		start1 < 0 ||
		len1 < 0 ||
		start2 < 0 ||
		len2 < 0 ||
		start1 + len1 > pdfBytes.length ||
		start2 + len2 > pdfBytes.length
	) {
		return { status: "failed", reason: "ByteRange out of bounds" }
	}

	const signedContent = new Uint8Array(len1 + len2)
	signedContent.set(pdfBytes.subarray(start1, start1 + len1), 0)
	signedContent.set(pdfBytes.subarray(start2, start2 + len2), len1)
	md.update(uint8ToLatin1(signedContent))
	const contentHashBytes = md.digest().bytes()

	const scheme = detectSigScheme(
		p7.rawCapture?.signatureAlgorithm,
		fields.digestOid,
	)
	if ("unsupported" in scheme) {
		return { status: "unsupported", reason: scheme.unsupported }
	}

	let signedBytesForVerify = signedContent
	if (fields.authAttrs) {
		let messageDigestAttrValue: string | null = null
		for (const attr of fields.authAttrs) {
			if (!Array.isArray(attr.value) || attr.value.length < 2) continue
			const oidNode = attr.value[0]
			const setNode = attr.value[1]
			if (!oidNode || oidNode.type !== forge.asn1.Type.OID) continue
			const oid = forge.asn1.derToOid(oidNode.value as string)
			if (oid !== forge.pki.oids.messageDigest) continue
			if (Array.isArray(setNode?.value) && setNode.value[0]) {
				messageDigestAttrValue = setNode.value[0].value as string
			}
			break
		}

		if (messageDigestAttrValue === null) {
			return {
				status: "failed",
				reason: "messageDigest attribute missing from authenticated attributes",
			}
		}
		if (messageDigestAttrValue !== contentHashBytes) {
			return {
				status: "failed",
				reason:
					"Content hash does not match messageDigest attribute; PDF was modified after signing",
			}
		}

		const asSet = forge.asn1.create(
			forge.asn1.Class.UNIVERSAL,
			forge.asn1.Type.SET,
			true,
			fields.authAttrs,
		)
		signedBytesForVerify = latin1ToUint8(forge.asn1.toDer(asSet).getBytes())
	}

	if (scheme.kind === "rsa-pkcs1") {
		try {
			const publicKey = signerCert.publicKey as forge.pki.rsa.PublicKey
			const md2 = createMd(fields.digestOid)
			if (md2) {
				md2.update(uint8ToLatin1(signedBytesForVerify))
				if (publicKey.verify(md2.digest().bytes(), fields.signatureBytes)) {
					return { status: "verified" }
				}
			}
		} catch {
			// Fall through to Web Crypto for implementations forge cannot verify.
		}
	}

	const spkiDer = extractSpkiDer(p7)
	if (!spkiDer) {
		return { status: "unsupported", reason: "Could not extract public key" }
	}
	return verifyViaWebCrypto(
		scheme,
		spkiDer,
		signedBytesForVerify,
		latin1ToUint8(fields.signatureBytes),
	)
}

async function parseTrustedCertificate(
	file: File | undefined,
): Promise<forge.pki.Certificate | undefined> {
	if (!file) return undefined
	const bytes = new Uint8Array(await file.arrayBuffer())
	const text = new TextDecoder().decode(bytes)
	if (text.includes("-----BEGIN CERTIFICATE-----")) {
		return forge.pki.certificateFromPem(text)
	}
	return forge.pki.certificateFromAsn1(forge.asn1.fromDer(uint8ToLatin1(bytes)))
}

async function validateOnePdfSignature(
	signature: ExtractedPdfSignature,
	pdfBytes: Uint8Array,
	trustedCert?: forge.pki.Certificate,
): Promise<PdfSignatureValidationResult> {
	const result: PdfSignatureValidationResult = {
		signatureIndex: signature.index,
		isValid: false,
		signerName: "Unknown",
		issuer: "Unknown",
		validFrom: new Date(0).toISOString(),
		validTo: new Date(0).toISOString(),
		isExpired: false,
		isSelfSigned: false,
		isTrusted: false,
		algorithms: { digest: "Unknown", signature: "Unknown" },
		serialNumber: "",
		byteRange: signature.byteRange,
		coverageStatus: "unknown",
		reason: signature.reason,
		location: signature.location,
		contactInfo: signature.contactInfo,
	}

	try {
		const asn1 = forge.asn1.fromDer(uint8ToLatin1(signature.contents))
		const p7 = forge.pkcs7.messageFromAsn1(
			asn1,
		) as forge.pkcs7.PkcsSignedData & {
			rawCapture?: {
				digestAlgorithm?: string
				authenticatedAttributes?: forge.asn1.Asn1[]
				signature?: string
				signatureAlgorithm?: forge.asn1.Asn1[]
				certificates?: forge.asn1.Asn1
			}
		}

		if (!p7.certificates?.length) {
			result.errorMessage = "No certificates found in signature"
			return result
		}

		const signerCert = p7.certificates[0] as forge.pki.Certificate
		const subjectCN = signerCert.subject.getField("CN")
		const subjectO = signerCert.subject.getField("O")
		const subjectE =
			signerCert.subject.getField("E") ||
			signerCert.subject.getField("emailAddress")
		const issuerCN = signerCert.issuer.getField("CN")
		const issuerO = signerCert.issuer.getField("O")
		const now = new Date()

		result.signerName = (subjectCN?.value as string | undefined) ?? "Unknown"
		result.signerOrg = subjectO?.value as string | undefined
		result.signerEmail = subjectE?.value as string | undefined
		result.issuer = (issuerCN?.value as string | undefined) ?? "Unknown"
		result.issuerOrg = issuerO?.value as string | undefined
		result.validFrom = signerCert.validity.notBefore.toISOString()
		result.validTo = signerCert.validity.notAfter.toISOString()
		result.serialNumber = signerCert.serialNumber
		result.isExpired =
			now > signerCert.validity.notAfter || now < signerCert.validity.notBefore
		result.isSelfSigned = signerCert.isIssuer(signerCert)

		if (trustedCert) {
			result.isTrusted =
				trustedCert.isIssuer(signerCert) ||
				signerCert.serialNumber === trustedCert.serialNumber ||
				p7.certificates.some(
					(cert) =>
						trustedCert.isIssuer(cert) ||
						(cert as forge.pki.Certificate).serialNumber ===
							trustedCert.serialNumber,
				)
		}

		const signerInfoFields = extractSignerInfoFields(p7)
		const digestOid = signerInfoFields?.digestOid
		result.algorithms = {
			digest:
				(digestOid && getDigestAlgorithmName(digestOid)) ||
				getDigestAlgorithmName(signerCert.siginfo?.algorithmOid || ""),
			signature: getSignatureAlgorithmName(signerCert.signatureOid || ""),
		}
		if (digestOid && insecureDigestOids.has(digestOid)) {
			result.usesInsecureDigest = true
		}

		if (signature.signingTime) {
			result.signatureDate = new Date(signature.signingTime).toISOString()
		}

		const [, , start2, len2] = signature.byteRange
		const expectedEnd = start2 + len2
		if (expectedEnd === pdfBytes.length) result.coverageStatus = "full"
		else if (expectedEnd < pdfBytes.length) result.coverageStatus = "partial"

		const verification = await performCryptoVerification(
			p7,
			pdfBytes,
			signature.byteRange,
			signerCert,
			signerInfoFields,
		)
		result.cryptoVerified = verification.status === "verified"
		result.cryptoVerificationStatus = verification.status
		if (verification.status === "unsupported") {
			result.unsupportedAlgorithmReason = verification.reason
		} else if (verification.status === "failed") {
			result.errorMessage = verification.reason
		}

		result.isValid =
			verification.status === "verified" &&
			result.coverageStatus !== "unknown" &&
			!result.usesInsecureDigest
	} catch (error) {
		result.errorMessage =
			error instanceof Error ? error.message : "Failed to parse signature"
	}

	return result
}

export async function validatePdfSignatures(
	file: File,
	trustedCertificateFile?: File,
): Promise<ProcessedFile> {
	const pdfBytes = new Uint8Array(await file.arrayBuffer())
	const trustedCert = await parseTrustedCertificate(trustedCertificateFile)
	const signatures = extractPdfSignatures(pdfBytes)
	const results = await Promise.all(
		signatures.map((signature) =>
			validateOnePdfSignature(signature, pdfBytes, trustedCert),
		),
	)
	const report = {
		fileName: file.name,
		signatureCount: signatures.length,
		validSignatureCount: results.filter((result) => result.isValid).length,
		signatures: results,
	}
	const baseName = file.name.replace(/\.pdf$/i, "")
	return {
		blob: new Blob([JSON.stringify(report, null, 2)], {
			type: "application/json",
		}),
		name: `${baseName}-signature-report.json`,
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

export async function pdfToMarkdown(file: File): Promise<ProcessedFile> {
	const pdfjsLib = await getPdfjsLib()
	const bytes = await file.arrayBuffer()
	const uint8 = new Uint8Array(bytes)
	const doc = await pdfjsLib.getDocument({
		data: uint8,
		useWorkerFetch: false,
		isEvalSupported: false,
		useSystemFonts: true,
	}).promise

	const baseName = file.name.replace(/\.pdf$/i, "")
	const pages: string[] = [`# ${baseName}`]

	for (let i = 1; i <= doc.numPages; i++) {
		const page = await doc.getPage(i)
		const content = await page.getTextContent()
		const lines = content.items
			.map((item: unknown) => {
				const textItem = item as { str?: string }
				return textItem.str?.trim() ?? ""
			})
			.filter(Boolean)
		pages.push(`## Page ${i}\n\n${lines.join(" ")}`)
	}

	return {
		blob: new Blob([pages.join("\n\n")], { type: "text/markdown" }),
		name: `${baseName}.md`,
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

/**
 * Strip all metadata from a PDF, including the info dictionary, XMP metadata
 * stream, and standard fields (title, author, etc.).
 * Adapted from an AGPL-3.0 offline PDF reference implementation.
 */
export async function stripPdfMetadata(file: File): Promise<ProcessedFile> {
	const bytes = await file.arrayBuffer()
	const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })

	// Clear all keys from the info dictionary
	// @ts-expect-error getInfoDict is private but accessible at runtime
	const infoDict = doc.getInfoDict()
	const allKeys = infoDict.keys()
	for (const key of allKeys) {
		infoDict.delete(key)
	}

	// Reset standard metadata fields to empty
	doc.setTitle("")
	doc.setAuthor("")
	doc.setSubject("")
	doc.setKeywords([])
	doc.setCreator("")
	doc.setProducer("")

	// Remove XMP metadata stream from catalog if present
	try {
		// @ts-expect-error catalog.dict is private but accessible at runtime
		const catalogDict = doc.catalog.dict
		if (catalogDict.has(PDFName.of("Metadata"))) {
			catalogDict.delete(PDFName.of("Metadata"))
		}
	} catch {
		// Some PDFs may not have a standard catalog structure.
	}

	const outBytes = await doc.save()
	const baseName = file.name.replace(/\.pdf$/i, "")
	return {
		blob: pdfBlob(outBytes),
		name: `${baseName}-stripped.pdf`,
	}
}

/**
 * Remove all annotations (links, highlights, comments, form widgets, etc.)
 * from every page of a PDF.
 * Adapted from an AGPL-3.0 offline PDF reference implementation.
 */
export async function removePdfAnnotations(file: File): Promise<ProcessedFile> {
	const bytes = await file.arrayBuffer()
	const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })

	const pages = doc.getPages()
	for (const page of pages) {
		const annots = page.node.Annots()?.asArray()
		if (annots && annots.length > 0) {
			page.node.delete(PDFName.of("Annots"))
		}
	}

	const outBytes = await doc.save()
	const baseName = file.name.replace(/\.pdf$/i, "")
	return {
		blob: pdfBlob(outBytes),
		name: `${baseName}-no-annotations.pdf`,
	}
}
