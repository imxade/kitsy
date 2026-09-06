// ── Image Processor — Canvas API ──

import type { Config as BackgroundRemovalConfig } from "@imgly/background-removal"
import ImageTracer from "imagetracerjs"
import {
	DEFAULT_TEXT_OVERLAY_BOX,
	clampTextOverlayBox,
	fitTextToBox,
	type TextOverlayBox,
} from "./text-overlay"

export interface ProcessedFile {
	blob: Blob
	name: string
}

export interface PerspectiveCropPoint {
	x: number
	y: number
}

export type DrawableImage = ImageBitmap | HTMLImageElement
interface LoadedImage {
	img: DrawableImage
	width: number
	height: number
	close: () => void
}

const LOSSY_IMAGE_MIMES = new Set(["image/jpeg", "image/webp", "image/avif"])
const BACKGROUND_REMOVAL_MODEL = "isnet_quint8"

function backgroundRemovalConfig(): BackgroundRemovalConfig {
	return {
		publicPath: new URL(
			"/background-removal/",
			window.location.origin,
		).toString(),
		device: "cpu",
		model: BACKGROUND_REMOVAL_MODEL,
		output: {
			format: "image/png",
			quality: 1,
		},
	}
}

function canvasEncodeOptions(
	type: string,
	quality = 100,
): { type: string; quality?: number } {
	return {
		type,
		...(LOSSY_IMAGE_MIMES.has(type)
			? { quality: Math.min(Math.max(quality, 0), 100) / 100 }
			: {}),
	}
}

/**
 * Loads an image file onto a drawable surface.
 * Uses native Image loading for SVG to ensure proper rendering context.
 */
export async function loadDrawable(file: File): Promise<LoadedImage> {
	if (file.type.includes("svg") || file.name.toLowerCase().endsWith(".svg")) {
		return new Promise((resolve, reject) => {
			const url = URL.createObjectURL(file)
			const img = new Image()
			img.onload = () => {
				const width = img.naturalWidth || 800
				const height = img.naturalHeight || 600
				resolve({
					img,
					width,
					height,
					close: () => URL.revokeObjectURL(url),
				})
			}
			img.onerror = () => {
				URL.revokeObjectURL(url)
				reject(new Error("Failed to load SVG"))
			}
			img.src = url
		})
	}
	const bitmap = await createImageBitmap(file)
	return {
		img: bitmap,
		width: bitmap.width,
		height: bitmap.height,
		close: () => bitmap.close(),
	}
}

export async function convertImage(
	file: File,
	outputMime: string,
	options: { quality?: number; numberofcolors?: number } = {},
): Promise<ProcessedFile> {
	if (file.type === outputMime && options.quality === undefined) {
		return { blob: file, name: file.name }
	}

	if (outputMime === "image/svg+xml") {
		return imageToSvg(file, {
			numberofcolors: options.numberofcolors ?? 20,
		})
	}

	const { img, width, height, close } = await loadDrawable(file)
	const canvas = new OffscreenCanvas(width, height)
	const ctx = canvas.getContext("2d")
	if (!ctx) throw new Error("Could not get canvas context")

	ctx.drawImage(img, 0, 0)
	const blob = await canvas.convertToBlob(
		canvasEncodeOptions(outputMime, options.quality ?? 100),
	)
	close()
	const ext = mimeToExt(outputMime)
	const name = file.name.replace(/\.[^.]+$/, "") + ext
	return { blob, name }
}

export async function resizeImage(
	file: File,
	width: number,
	height: number,
): Promise<ProcessedFile> {
	const { img, close } = await loadDrawable(file)
	const canvas = new OffscreenCanvas(width, height)
	const ctx = canvas.getContext("2d")
	if (!ctx) throw new Error("Could not get 2D context")
	ctx.imageSmoothingEnabled = true
	ctx.imageSmoothingQuality = "high"
	ctx.drawImage(img, 0, 0, width, height)
	close()

	const mime = file.type || "image/png"
	const blob = await canvas.convertToBlob(canvasEncodeOptions(mime))
	const name = `${file.name.replace(/\.[^.]+$/, "")}-resized${mimeToExt(mime)}`
	return { blob, name }
}

export async function rotateImage(
	file: File,
	angle: number,
): Promise<ProcessedFile> {
	const { img, width: bmpW, height: bmpH, close } = await loadDrawable(file)
	const rad = (angle * Math.PI) / 180

	// For 90/270 rotations, swap width and height
	const swap = angle === 90 || angle === 270
	const w = swap ? bmpH : bmpW
	const h = swap ? bmpW : bmpH

	const canvas = new OffscreenCanvas(w, h)
	const ctx = canvas.getContext("2d")
	if (!ctx) throw new Error("Could not get 2D context")

	ctx.translate(w / 2, h / 2)
	ctx.rotate(rad)
	ctx.drawImage(img, -bmpW / 2, -bmpH / 2)
	close()

	const mime = file.type || "image/png"
	const blob = await canvas.convertToBlob(canvasEncodeOptions(mime))
	const baseName = file.name.replace(/\.[^.]+$/, "")
	return { blob, name: `${baseName}-rotated${mimeToExt(mime)}` }
}

export async function cropImage(
	file: File,
	x: number,
	y: number,
	cropWidth: number,
	cropHeight: number,
): Promise<ProcessedFile> {
	const { img, width: bmpW, height: bmpH, close } = await loadDrawable(file)

	// Clamp to image bounds
	const sx = Math.max(0, Math.min(x, bmpW))
	const sy = Math.max(0, Math.min(y, bmpH))
	const sw = Math.min(cropWidth, bmpW - sx)
	const sh = Math.min(cropHeight, bmpH - sy)

	const canvas = new OffscreenCanvas(sw, sh)
	const ctx = canvas.getContext("2d")
	if (!ctx) throw new Error("Could not get 2D context")

	ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
	close()

	const mime = file.type || "image/png"
	const blob = await canvas.convertToBlob(canvasEncodeOptions(mime))
	const baseName = file.name.replace(/\.[^.]+$/, "")
	return { blob, name: `${baseName}-cropped${mimeToExt(mime)}` }
}

function solveLinearSystem(matrix: number[][]): number[] | null {
	const size = matrix.length
	for (let column = 0; column < size; column++) {
		let pivot = column
		for (let row = column + 1; row < size; row++) {
			if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) {
				pivot = row
			}
		}
		if (Math.abs(matrix[pivot][column]) < 1e-10) return null
		;[matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]]

		const pivotValue = matrix[column][column]
		for (let entry = column; entry <= size; entry++) {
			matrix[column][entry] /= pivotValue
		}
		for (let row = 0; row < size; row++) {
			if (row === column) continue
			const factor = matrix[row][column]
			for (let entry = column; entry <= size; entry++) {
				matrix[row][entry] -= factor * matrix[column][entry]
			}
		}
	}
	return matrix.map((row) => row[size])
}

function isConvexQuadrilateral(points: PerspectiveCropPoint[]): boolean {
	if (points.length !== 4) return false
	let direction = 0
	for (let index = 0; index < 4; index++) {
		const first = points[index]
		const second = points[(index + 1) % 4]
		const third = points[(index + 2) % 4]
		const cross =
			(second.x - first.x) * (third.y - second.y) -
			(second.y - first.y) * (third.x - second.x)
		if (Math.abs(cross) < 1e-5) return false
		const nextDirection = Math.sign(cross)
		if (direction !== 0 && direction !== nextDirection) return false
		direction = nextDirection
	}
	return true
}

/**
 * Straightens a four-corner document selection into a rectangular image.
 * Points must be ordered top-left, top-right, bottom-right, bottom-left.
 */
export async function perspectiveCropImage(
	file: File,
	points: PerspectiveCropPoint[],
): Promise<ProcessedFile> {
	const {
		img,
		width: sourceWidth,
		height: sourceHeight,
		close,
	} = await loadDrawable(file)
	try {
		const sourcePoints = points.map((point) => ({
			x: Math.min(Math.max(Math.round(point.x), 0), sourceWidth - 1),
			y: Math.min(Math.max(Math.round(point.y), 0), sourceHeight - 1),
		}))
		if (!isConvexQuadrilateral(sourcePoints)) {
			throw new Error("Crop corners must form a non-overlapping quadrilateral")
		}

		const distance = (
			first: PerspectiveCropPoint,
			second: PerspectiveCropPoint,
		) => Math.hypot(second.x - first.x, second.y - first.y)
		const outputWidth = Math.max(
			1,
			Math.round(
				(distance(sourcePoints[0], sourcePoints[1]) +
					distance(sourcePoints[3], sourcePoints[2])) /
					2,
			),
		)
		const outputHeight = Math.max(
			1,
			Math.round(
				(distance(sourcePoints[0], sourcePoints[3]) +
					distance(sourcePoints[1], sourcePoints[2])) /
					2,
			),
		)
		const destinationPoints = [
			{ x: 0, y: 0 },
			{ x: outputWidth - 1, y: 0 },
			{ x: outputWidth - 1, y: outputHeight - 1 },
			{ x: 0, y: outputHeight - 1 },
		]
		const matrix = destinationPoints.flatMap((destination, index) => {
			const source = sourcePoints[index]
			return [
				[
					destination.x,
					destination.y,
					1,
					0,
					0,
					0,
					-destination.x * source.x,
					-destination.y * source.x,
					source.x,
				],
				[
					0,
					0,
					0,
					destination.x,
					destination.y,
					1,
					-destination.x * source.y,
					-destination.y * source.y,
					source.y,
				],
			]
		})
		const transform = solveLinearSystem(matrix)
		if (!transform) throw new Error("Could not calculate the crop perspective")

		const sourceCanvas = new OffscreenCanvas(sourceWidth, sourceHeight)
		const sourceContext = sourceCanvas.getContext("2d", {
			willReadFrequently: true,
		})
		if (!sourceContext) throw new Error("Could not get 2D context")
		sourceContext.drawImage(img, 0, 0)
		const sourcePixels = sourceContext.getImageData(
			0,
			0,
			sourceWidth,
			sourceHeight,
		).data

		const outputCanvas = new OffscreenCanvas(outputWidth, outputHeight)
		const outputContext = outputCanvas.getContext("2d")
		if (!outputContext) throw new Error("Could not get 2D context")
		const outputPixels = outputContext.createImageData(
			outputWidth,
			outputHeight,
		)

		for (let y = 0; y < outputHeight; y++) {
			for (let x = 0; x < outputWidth; x++) {
				const denominator = transform[6] * x + transform[7] * y + 1
				const sourceX = Math.min(
					Math.max(
						(transform[0] * x + transform[1] * y + transform[2]) / denominator,
						0,
					),
					sourceWidth - 1,
				)
				const sourceY = Math.min(
					Math.max(
						(transform[3] * x + transform[4] * y + transform[5]) / denominator,
						0,
					),
					sourceHeight - 1,
				)
				const left = Math.floor(sourceX)
				const top = Math.floor(sourceY)
				const right = Math.min(left + 1, sourceWidth - 1)
				const bottom = Math.min(top + 1, sourceHeight - 1)
				const horizontal = sourceX - left
				const vertical = sourceY - top
				const destinationOffset = (y * outputWidth + x) * 4
				for (let channel = 0; channel < 4; channel++) {
					const topValue =
						sourcePixels[(top * sourceWidth + left) * 4 + channel] *
							(1 - horizontal) +
						sourcePixels[(top * sourceWidth + right) * 4 + channel] * horizontal
					const bottomValue =
						sourcePixels[(bottom * sourceWidth + left) * 4 + channel] *
							(1 - horizontal) +
						sourcePixels[(bottom * sourceWidth + right) * 4 + channel] *
							horizontal
					outputPixels.data[destinationOffset + channel] =
						topValue * (1 - vertical) + bottomValue * vertical
				}
			}
		}

		outputContext.putImageData(outputPixels, 0, 0)
		const mime = file.type || "image/png"
		const blob = await outputCanvas.convertToBlob(canvasEncodeOptions(mime))
		const baseName = file.name.replace(/\.[^.]+$/, "")
		return { blob, name: `${baseName}-flattened${mimeToExt(mime)}` }
	} finally {
		close()
	}
}

export async function upscaleImage(
	file: File,
	scale: number,
): Promise<ProcessedFile> {
	const { img, width: bmpW, height: bmpH, close } = await loadDrawable(file)
	const w = Math.round(bmpW * scale)
	const h = Math.round(bmpH * scale)

	const canvas = new OffscreenCanvas(w, h)
	const ctx = canvas.getContext("2d")
	if (!ctx) throw new Error("Could not get 2D context")

	// Use high-quality interpolation
	ctx.imageSmoothingEnabled = true
	ctx.imageSmoothingQuality = "high"
	ctx.drawImage(img, 0, 0, w, h)
	close()

	const mime = file.type || "image/png"
	const blob = await canvas.convertToBlob(canvasEncodeOptions(mime))
	const baseName = file.name.replace(/\.[^.]+$/, "")
	return { blob, name: `${baseName}-${scale}x${mimeToExt(mime)}` }
}

export async function blurImage(
	file: File,
	radius: number,
	region?: { x: number; y: number; width: number; height: number },
): Promise<ProcessedFile> {
	const { img, width, height, close } = await loadDrawable(file)
	const canvas = new OffscreenCanvas(width, height)
	const ctx = canvas.getContext("2d")
	if (!ctx) throw new Error("Could not get 2D context")

	// 1. Draw original image
	ctx.drawImage(img, 0, 0)

	if (region && region.width > 0 && region.height > 0) {
		// 2. Process only the region
		const regionCanvas = new OffscreenCanvas(region.width, region.height)
		const rctx = regionCanvas.getContext("2d")
		if (!rctx) throw new Error("Could not get region context")

		rctx.drawImage(
			img,
			region.x,
			region.y,
			region.width,
			region.height,
			0,
			0,
			region.width,
			region.height,
		)
		const blurredRegion = new OffscreenCanvas(region.width, region.height)
		const bctx = blurredRegion.getContext("2d")
		if (!bctx) throw new Error("Could not get blur context")

		bctx.filter = `blur(${radius}px)`
		bctx.drawImage(regionCanvas, 0, 0)

		// 3. Composite back
		ctx.drawImage(blurredRegion, region.x, region.y)
	} else {
		// Full image blur
		ctx.filter = `blur(${radius}px)`
		ctx.drawImage(img, 0, 0)
	}
	close()

	const mime = file.type || "image/png"
	const blob = await canvas.convertToBlob(canvasEncodeOptions(mime))
	const name = `${file.name.replace(/\.[^.]+$/, "")}-blurred${mimeToExt(mime)}`
	return { blob, name }
}

export async function pixelateImage(
	file: File,
	size: number,
	region?: { x: number; y: number; width: number; height: number },
): Promise<ProcessedFile> {
	const { img, width, height, close } = await loadDrawable(file)
	const canvas = new OffscreenCanvas(width, height)
	const ctx = canvas.getContext("2d")
	if (!ctx) throw new Error("Could not get 2D context")

	// 1. Draw original
	ctx.drawImage(img, 0, 0)

	const targetWidth = region?.width || width
	const targetHeight = region?.height || height
	const targetX = region?.x || 0
	const targetY = region?.y || 0

	if (targetWidth > 0 && targetHeight > 0) {
		// Scale down the target area
		const sw = Math.max(1, Math.floor(targetWidth / size))
		const sh = Math.max(1, Math.floor(targetHeight / size))

		const smallCanvas = new OffscreenCanvas(sw, sh)
		const sctx = smallCanvas.getContext("2d")
		if (!sctx) throw new Error("Could not get small 2D context")
		sctx.drawImage(
			img,
			targetX,
			targetY,
			targetWidth,
			targetHeight,
			0,
			0,
			sw,
			sh,
		)

		// Draw back with no smoothing
		ctx.imageSmoothingEnabled = false
		ctx.drawImage(
			smallCanvas,
			0,
			0,
			sw,
			sh,
			targetX,
			targetY,
			targetWidth,
			targetHeight,
		)
	}
	close()

	const mime = file.type || "image/png"
	const blob = await canvas.convertToBlob(canvasEncodeOptions(mime))
	const name = `${file.name.replace(/\.[^.]+$/, "")}-pixelated${mimeToExt(mime)}`
	return { blob, name }
}

export async function imageToSvg(
	file: File,
	options: Record<string, unknown> = {},
): Promise<ProcessedFile> {
	const { img, width, height, close } = await loadDrawable(file)
	const canvas = new OffscreenCanvas(width, height)
	const ctx = canvas.getContext("2d")
	if (!ctx) throw new Error("Could not get 2D context")

	ctx.drawImage(img, 0, 0)
	close()

	const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
	const svgString = ImageTracer.imagedataToSVG(imageData, {
		numberofcolors: Number(options.numberofcolors) || 50,
		...options,
	})

	const blob = new Blob([svgString], { type: "image/svg+xml" })
	const name = `${file.name.replace(/\.[^.]+$/, "")}.svg`

	return { blob, name }
}

export async function addTextToImage(
	file: File,
	text: string,
	options: {
		fontFamily?: string
		color?: string
		opacity?: number
		box?: TextOverlayBox
		bold?: boolean
		italic?: boolean
		bgBox?: boolean
		bgBoxColor?: string
	} = {},
): Promise<ProcessedFile> {
	const { img, width, height, close } = await loadDrawable(file)
	const canvas = new OffscreenCanvas(width, height)
	const ctx = canvas.getContext("2d")
	if (!ctx) throw new Error("Could not get 2D context")

	ctx.drawImage(img, 0, 0)

	const box = clampTextOverlayBox(options.box ?? DEFAULT_TEXT_OVERLAY_BOX)
	const textBox = {
		x: box.x * width,
		y: box.y * height,
		width: box.width * width,
		height: box.height * height,
	}
	const padding = Math.max(4, Math.min(textBox.width, textBox.height) * 0.08)
	const innerWidth = Math.max(1, textBox.width - padding * 2)
	const innerHeight = Math.max(1, textBox.height - padding * 2)
	const fontFamily = options.fontFamily || "sans-serif"
	const layout = fitTextToBox(ctx, text, innerWidth, innerHeight, {
		fontFamily,
		bold: options.bold,
		italic: options.italic,
		maxFontSize: Math.floor(innerHeight),
	})

	if (options.bgBox) {
		ctx.globalAlpha = 0.6
		ctx.fillStyle = options.bgBoxColor || "rgba(0,0,0,0.5)"
		ctx.fillRect(textBox.x, textBox.y, textBox.width, textBox.height)
	}

	ctx.globalAlpha = options.opacity ?? 1
	ctx.fillStyle = options.color || "white"
	ctx.font = `${options.italic ? "italic" : "normal"} ${
		options.bold ? "bold" : "normal"
	} ${layout.fontSize}px ${fontFamily}`
	ctx.textAlign = "center"
	ctx.textBaseline = "top"

	ctx.save()
	ctx.beginPath()
	ctx.rect(textBox.x, textBox.y, textBox.width, textBox.height)
	ctx.clip()
	const lineX = textBox.x + textBox.width / 2
	const startY =
		textBox.y + padding + Math.max(0, (innerHeight - layout.totalHeight) / 2)
	for (let index = 0; index < layout.lines.length; index++) {
		ctx.fillText(layout.lines[index], lineX, startY + index * layout.lineHeight)
	}
	ctx.restore()
	close()

	const mime = file.type || "image/png"
	const blob = await canvas.convertToBlob(canvasEncodeOptions(mime))
	const name = `${file.name.replace(/\.[^.]+$/, "")}-text${mimeToExt(mime)}`
	return { blob, name }
}

export async function removeImageBackground(
	file: File,
	options: {
		backgroundColor?: string
	} = {},
): Promise<ProcessedFile> {
	const { removeBackground } = await import("@imgly/background-removal")
	const foreground = await removeBackground(file, backgroundRemovalConfig())
	const backgroundColor = options.backgroundColor

	const blob =
		backgroundColor && backgroundColor !== "transparent"
			? await compositeImageBackground(foreground, backgroundColor)
			: foreground
	const name = `${file.name.replace(/\.[^.]+$/, "")}-nobg.png`
	return { blob, name }
}

async function compositeImageBackground(
	foreground: Blob,
	backgroundColor: string,
): Promise<Blob> {
	const bitmap = await createImageBitmap(foreground)
	const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
	const ctx = canvas.getContext("2d")
	if (!ctx) throw new Error("Could not get 2D context")

	ctx.fillStyle = backgroundColor
	ctx.fillRect(0, 0, canvas.width, canvas.height)
	ctx.drawImage(bitmap, 0, 0)
	bitmap.close()

	return canvas.convertToBlob({ type: "image/png" })
}

function mimeToExt(mime: string): string {
	const map: Record<string, string> = {
		"image/png": ".png",
		"image/jpeg": ".jpg",
		"image/webp": ".webp",
		"image/avif": ".avif",
		"image/bmp": ".bmp",
		"image/gif": ".gif",
		"image/svg+xml": ".svg",
		"image/x-icon": ".ico",
		"image/vnd.microsoft.icon": ".ico",
	}
	return map[mime] ?? ".png"
}
