// ── Image Processor — Canvas API ──

export interface ProcessedFile {
	blob: Blob
	name: string
}

export type DrawableImage = ImageBitmap | HTMLImageElement
interface LoadedImage {
	img: DrawableImage
	width: number
	height: number
	close: () => void
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
	quality: number,
): Promise<ProcessedFile> {
	const { img, width, height, close } = await loadDrawable(file)
	const canvas = new OffscreenCanvas(width, height)
	const ctx = canvas.getContext("2d")
	if (!ctx) throw new Error("Could not get 2D context")
	ctx.drawImage(img, 0, 0)
	close()

	const blob = await canvas.convertToBlob({
		type: outputMime,
		quality: quality / 100,
	})
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
	ctx.drawImage(img, 0, 0, width, height)
	close()

	const mime = file.type || "image/png"
	const blob = await canvas.convertToBlob({ type: mime, quality: 0.92 })
	const name = `${file.name.replace(/\.[^.]+$/, "")}-resized${mimeToExt(mime)}`
	return { blob, name }
}

export async function compressImage(
	file: File,
	quality: number,
): Promise<ProcessedFile> {
	const { img, width, height, close } = await loadDrawable(file)
	const canvas = new OffscreenCanvas(width, height)
	const ctx = canvas.getContext("2d")
	if (!ctx) throw new Error("Could not get 2D context")
	ctx.drawImage(img, 0, 0)
	close()

	// JPEG/WebP support quality with lossy compression; PNG is lossless
	const mime = file.type === "image/png" ? "image/webp" : file.type
	const blob = await canvas.convertToBlob({
		type: mime,
		quality: quality / 100,
	})
	const ext = mimeToExt(mime)
	const name = `${file.name.replace(/\.[^.]+$/, "")}-compressed${ext}`
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
	const blob = await canvas.convertToBlob({ type: mime, quality: 0.92 })
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
	const blob = await canvas.convertToBlob({ type: mime, quality: 0.92 })
	const baseName = file.name.replace(/\.[^.]+$/, "")
	return { blob, name: `${baseName}-cropped${mimeToExt(mime)}` }
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
	const blob = await canvas.convertToBlob({ type: mime, quality: 0.95 })
	const baseName = file.name.replace(/\.[^.]+$/, "")
	return { blob, name: `${baseName}-${scale}x${mimeToExt(mime)}` }
}

export async function imageToSvg(
	file: File,
	options: Record<string, unknown> = {},
): Promise<ProcessedFile> {
	const ImageTracer = (await import("imagetracerjs")).default

	const bitmap = await createImageBitmap(file)
	const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
	const ctx = canvas.getContext("2d")
	if (!ctx) throw new Error("Could not get 2D context")

	ctx.drawImage(bitmap, 0, 0)
	bitmap.close()

	const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)

	const svgString = ImageTracer.imagedataToSVG(imageData, {
		numberofcolors: Number(options.numberofcolors) || 16,
		...options,
	})

	const blob = new Blob([svgString], { type: "image/svg+xml" })
	const name = file.name.replace(/\.[^.]+$/, "") + ".svg"

	return { blob, name }
}

function mimeToExt(mime: string): string {
	const map: Record<string, string> = {
		"image/png": ".png",
		"image/jpeg": ".jpg",
		"image/webp": ".webp",
		"image/avif": ".avif",
		"image/bmp": ".bmp",
		"image/gif": ".gif",
	}
	return map[mime] ?? ".png"
}
