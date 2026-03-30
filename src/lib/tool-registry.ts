// ── Tool Registry ──
// Each tool has a `process` function that takes files + options and returns results.

import type { ProcessedFile } from "./image-processor"
import {
	convertImage,
	resizeImage,
	rotateImage,
	cropImage,
	upscaleImage,
	blurImage,
	pixelateImage,
	addImageWatermark,
} from "./image-processor"
import {
	mergePdfs,
	splitPdf,
	deletePdfPages,
	reorderPdfPages,
	imagesToPdf,
	pdfToText,
	pdfToImages,
	compressPdf,
	addPdfWatermark,
	rotatePdf,
} from "./pdf-processor"
import {
	createZip,
	unzipFiles,
	csvToJson,
	jsonToCsv,
	formatJson,
} from "./file-processor"
import {
	convertVideo,
	trimVideo,
	extractAudio,
	convertAudio,
	trimAudio,
	mergeVideos,
	mergeAudio,
	mergeAudioVideo,
	muteVideo,
	changeVideoSpeed,
	resizeVideo,
	cropVideo,
	addVideoWatermark,
	extractFrames,
	changeVolume,
	fadeAudio,
} from "./ffmpeg-processor"

export type ToolCategory =
	| "pdf"
	| "image"
	| "video"
	| "audio"
	| "gif"
	| "file"
	| "document"
	| "data"

export interface ToolOption {
	id: string
	label: string
	type: "select" | "number" | "checkbox" | "text" | "file"
	options?: { label: string; value: string }[]
	default?: string | number | boolean
	min?: number
	max?: number
	accept?: string
}

export interface ToolDefinition {
	id: string
	name: string
	description: string
	category: ToolCategory
	icon: string
	acceptedExtensions: string[]
	multiple: boolean
	options: ToolOption[]
	process: (
		files: File[],
		options: Record<string, unknown>,
	) => Promise<ProcessedFile[]>
}

/** Process each file individually and collect results */
async function batch(
	files: File[],
	fn: (file: File) => Promise<ProcessedFile>,
): Promise<ProcessedFile[]> {
	const results: ProcessedFile[] = []
	for (const f of files) results.push(await fn(f))
	return results
}

// ── Tool Definitions ──

const tools: ToolDefinition[] = [
	// ── Image ──
	{
		id: "image-convert",
		name: "Convert Image",
		description: "Convert between PNG, JPG, WebP, AVIF, BMP, and GIF",
		category: "image",
		icon: "🖼️",
		acceptedExtensions: [
			".png",
			".jpg",
			".jpeg",
			".webp",
			".avif",
			".bmp",
			".svg",
		],
		multiple: true,
		options: [
			{
				id: "format",
				label: "Output Format",
				type: "select",
				options: [
					{ label: "PNG", value: "image/png" },
					{ label: "JPG", value: "image/jpeg" },
					{ label: "WebP", value: "image/webp" },
					{ label: "AVIF", value: "image/avif" },
					{ label: "BMP", value: "image/bmp" },
					{ label: "SVG", value: "image/svg+xml" },
				],
				default: "image/png",
			},
			{
				id: "quality",
				label: "Quality (%)",
				type: "number",
				default: 85,
				min: 10,
				max: 100,
			},
		],
		process: async (files, opts) =>
			batch(files, (f) =>
				convertImage(f, String(opts.format), Number(opts.quality)),
			),
	},
	{
		id: "image-resize",
		name: "Resize Image",
		description: "Resize images to specific dimensions",
		category: "image",
		icon: "📐",
		acceptedExtensions: [
			".png",
			".jpg",
			".jpeg",
			".webp",
			".avif",
			".bmp",
			".gif",
			".svg",
		],
		multiple: true,
		options: [
			{
				id: "width",
				label: "Width (px)",
				type: "number",
				default: 800,
				min: 1,
				max: 10000,
			},
			{
				id: "height",
				label: "Height (px)",
				type: "number",
				default: 600,
				min: 1,
				max: 10000,
			},
		],
		process: async (files, opts) =>
			batch(files, (f) =>
				resizeImage(f, Number(opts.width), Number(opts.height)),
			),
	},
	{
		id: "image-rotate",
		name: "Rotate Image",
		description: "Rotate images by 90°, 180°, or 270°",
		category: "image",
		icon: "🔄",
		acceptedExtensions: [
			".png",
			".jpg",
			".jpeg",
			".webp",
			".avif",
			".bmp",
			".gif",
			".svg",
		],
		multiple: true,
		options: [
			{
				id: "angle",
				label: "Rotation Angle",
				type: "select",
				options: [
					{ label: "90° Clockwise", value: "90" },
					{ label: "180°", value: "180" },
					{ label: "90° Counter-clockwise", value: "270" },
				],
				default: "90",
			},
		],
		process: async (files, opts) =>
			batch(files, (f) => rotateImage(f, Number(opts.angle))),
	},
	{
		id: "image-crop",
		name: "Crop Image",
		description: "Crop images by specifying position and dimensions",
		category: "image",
		icon: "✂️",
		acceptedExtensions: [
			".png",
			".jpg",
			".jpeg",
			".webp",
			".avif",
			".bmp",
			".gif",
			".svg",
		],
		multiple: false,
		options: [
			{
				id: "x",
				label: "X Offset (px)",
				type: "number",
				default: 0,
				min: 0,
				max: 10000,
			},
			{
				id: "y",
				label: "Y Offset (px)",
				type: "number",
				default: 0,
				min: 0,
				max: 10000,
			},
			{
				id: "cropWidth",
				label: "Crop Width (px)",
				type: "number",
				default: 400,
				min: 1,
				max: 10000,
			},
			{
				id: "cropHeight",
				label: "Crop Height (px)",
				type: "number",
				default: 400,
				min: 1,
				max: 10000,
			},
		],
		process: async (files, opts) => [
			await cropImage(
				files[0],
				Number(opts.x),
				Number(opts.y),
				Number(opts.cropWidth),
				Number(opts.cropHeight),
			),
		],
	},
	{
		id: "image-upscale",
		name: "Upscale Image",
		description: "Enlarge images with high-quality interpolation",
		category: "image",
		icon: "🔍",
		acceptedExtensions: [
			".png",
			".jpg",
			".jpeg",
			".webp",
			".avif",
			".bmp",
			".gif",
			".svg",
		],
		multiple: true,
		options: [
			{
				id: "scale",
				label: "Scale Factor",
				type: "number",
				default: 2,
				min: 1,
				max: 8,
			},
		],
		process: async (files, opts) =>
			batch(files, (f) => upscaleImage(f, Number(opts.scale))),
	},

	// ── PDF ──
	{
		id: "pdf-merge",
		name: "Merge PDF",
		description: "Combine multiple PDF files into one",
		category: "pdf",
		icon: "📄",
		acceptedExtensions: [".pdf"],
		multiple: true,
		options: [],
		process: async (files) => [await mergePdfs(files)],
	},
	{
		id: "pdf-split",
		name: "Split PDF",
		description: "Extract individual pages from a PDF",
		category: "pdf",
		icon: "✂️",
		acceptedExtensions: [".pdf"],
		multiple: false,
		options: [],
		process: async (files) => await splitPdf(files[0]),
	},
	{
		id: "pdf-delete-pages",
		name: "Delete PDF Pages",
		description: "Remove specific pages from a PDF",
		category: "pdf",
		icon: "🗑️",
		acceptedExtensions: [".pdf"],
		multiple: false,
		options: [],
		process: async (files, opts) => {
			if (!opts.pages)
				throw new Error(
					"Please select pages to delete by clicking the ✕ button on the page previews.",
				)
			const pagesStr = String(opts.pages)
			const pageNums = pagesStr.split(",").map((s) => Number(s.trim()))
			return [await deletePdfPages(files[0], pageNums)]
		},
	},
	{
		id: "pdf-reorder",
		name: "Reorder PDF Pages",
		description: "Rearrange pages in a PDF by specifying new order",
		category: "pdf",
		icon: "🔀",
		acceptedExtensions: [".pdf"],
		multiple: false,
		options: [],
		process: async (files, opts) => {
			if (!opts.order) {
				const { PDFDocument } = await import("pdf-lib")
				const bytes = await files[0].arrayBuffer()
				const doc = await PDFDocument.load(bytes)
				const count = doc.getPageCount()
				const docOrder = Array.from({ length: count }, (_, i) => i + 1)
				// Returning the same PDF structurally, no reorder actually applied
				return [await reorderPdfPages(files[0], docOrder)]
			}
			const orderStr = String(opts.order)
			const order = orderStr.split(",").map((s) => Number(s.trim()))
			return [await reorderPdfPages(files[0], order)]
		},
	},
	{
		id: "pdf-images-to-pdf",
		name: "Images to PDF",
		description: "Combine images into a single PDF document",
		category: "pdf",
		icon: "📸",
		acceptedExtensions: [".png", ".jpg", ".jpeg", ".webp", ".bmp", ".svg"],
		multiple: true,
		options: [],
		process: async (files) => [await imagesToPdf(files)],
	},
	{
		id: "pdf-to-text",
		name: "PDF to Text",
		description: "Extract text content from a PDF file",
		category: "pdf",
		icon: "📝",
		acceptedExtensions: [".pdf"],
		multiple: false,
		options: [],
		process: async (files) => [await pdfToText(files[0])],
	},

	{
		id: "pdf-to-images",
		name: "PDF to Images",
		description: "Convert each PDF page to an image (PNG or JPG)",
		category: "pdf",
		icon: "🖼️",
		acceptedExtensions: [".pdf"],
		multiple: false,
		options: [
			{
				id: "format",
				label: "Image Format",
				type: "select",
				options: [
					{ label: "PNG", value: "png" },
					{ label: "JPG", value: "jpg" },
				],
				default: "png",
			},
			{
				id: "scale",
				label: "Scale",
				type: "number",
				default: 2,
				min: 1,
				max: 4,
			},
		],
		process: async (files, opts) =>
			await pdfToImages(files[0], String(opts.format), Number(opts.scale)),
	},

	// ── Video ──
	{
		id: "video-convert",
		name: "Convert Video",
		description: "Convert between MP4, WebM, MKV, AVI, GIF",
		category: "video",
		icon: "🎬",
		acceptedExtensions: [
			".mp4",
			".webm",
			".mkv",
			".avi",
			".mov",
			".flv",
			".3gp",
			".gif",
		],
		multiple: false,
		options: [
			{
				id: "format",
				label: "Output Format",
				type: "select",
				options: [
					{ label: "MP4", value: "mp4" },
					{ label: "WebM", value: "webm" },
					{ label: "MKV", value: "mkv" },
					{ label: "AVI", value: "avi" },
					{ label: "GIF", value: "gif" },
					{ label: "WebP", value: "webp" },
				],
				default: "mp4",
			},
		],
		process: async (files, opts) => [
			await convertVideo(files[0], String(opts.format)),
		],
	},
	{
		id: "video-trim",
		name: "Trim Video",
		description: "Cut a segment from a video",
		category: "video",
		icon: "✂️",
		acceptedExtensions: [
			".mp4",
			".webm",
			".mkv",
			".avi",
			".mov",
			".flv",
			".3gp",
		],
		multiple: false,
		options: [
			{
				id: "start",
				label: "Start Time (e.g. 00:00:00)",
				type: "text",
				default: "",
			},
			{
				id: "end",
				label: "End Time (e.g. 00:00:10)",
				type: "text",
				default: "",
			},
		],
		process: async (files, opts) => [
			await trimVideo(
				files[0],
				String(opts.start || ""),
				String(opts.end || ""),
			),
		],
	},
	{
		id: "video-extract-audio",
		name: "Extract Audio",
		description: "Extract audio track from a video file",
		category: "video",
		icon: "🔊",
		acceptedExtensions: [
			".mp4",
			".webm",
			".mkv",
			".avi",
			".mov",
			".flv",
			".3gp",
		],
		multiple: false,
		options: [
			{
				id: "format",
				label: "Audio Format",
				type: "select",
				options: [
					{ label: "MP3", value: "mp3" },
					{ label: "WAV", value: "wav" },
					{ label: "AAC", value: "aac" },
				],
				default: "mp3",
			},
		],
		process: async (files, opts) => [
			await extractAudio(files[0], String(opts.format)),
		],
	},
	{
		id: "video-merge",
		name: "Merge Videos",
		description: "Concatenate multiple video files into one",
		category: "video",
		icon: "🔗",
		acceptedExtensions: [".mp4", ".webm", ".mkv", ".avi", ".mov"],
		multiple: true,
		options: [],
		process: async (files) => [await mergeVideos(files)],
	},
	{
		id: "video-audio-merge",
		name: "Merge Audio into Video",
		description: "Overlay an audio track onto a video file",
		category: "video",
		icon: "🎤",
		acceptedExtensions: [
			".mp4",
			".webm",
			".mkv",
			".avi",
			".mov",
			".flv",
			".3gp",
		],
		multiple: false,
		options: [
			{
				id: "audioFile",
				label: "Select Audio File",
				type: "file",
				accept: "audio/*",
			},
			{
				id: "start",
				label: "Audio Start Offset (e.g. 00:00:00)",
				type: "text",
				default: "00:00:00",
			},
		],
		process: async (files, opts) => {
			if (!opts.audioFile || !(opts.audioFile instanceof File)) {
				throw new Error("Please select an audio file to merge.")
			}
			return [
				await mergeAudioVideo(
					files[0],
					opts.audioFile as File,
					String(opts.start || "00:00:00"),
				),
			]
		},
	},
	{
		id: "video-mute",
		name: "Mute Video",
		description: "Remove all audio tracks from a video",
		category: "video",
		icon: "🔇",
		acceptedExtensions: [
			".mp4",
			".webm",
			".mkv",
			".avi",
			".mov",
			".flv",
			".3gp",
		],
		multiple: false,
		options: [],
		process: async (files) => [await muteVideo(files[0])],
	},
	{
		id: "video-speed",
		name: "Change Video Speed",
		description: "Speed up or slow down a video",
		category: "video",
		icon: "⚡",
		acceptedExtensions: [
			".mp4",
			".webm",
			".mkv",
			".avi",
			".mov",
			".flv",
			".3gp",
		],
		multiple: false,
		options: [
			{
				id: "speed",
				label: "Playback Speed",
				type: "select",
				options: [
					{ label: "0.25x", value: "0.25" },
					{ label: "0.5x", value: "0.5" },
					{ label: "0.75x", value: "0.75" },
					{ label: "1.0x", value: "1.0" },
					{ label: "1.25x", value: "1.25" },
					{ label: "1.5x", value: "1.5" },
					{ label: "2.0x", value: "2.0" },
					{ label: "4.0x", value: "4.0" },
				],
				default: "2.0",
			},
		],
		process: async (files, opts) => [
			await changeVideoSpeed(files[0], Number(opts.speed || 1.0)),
		],
	},

	// ── Audio ──
	{
		id: "audio-convert",
		name: "Convert Audio",
		description: "Convert between MP3, WAV, OGG, and AAC",
		category: "audio",
		icon: "🎵",
		acceptedExtensions: [
			".mp3",
			".wav",
			".ogg",
			".aac",
			".flac",
			".m4a",
			".wma",
		],
		multiple: true,
		options: [
			{
				id: "format",
				label: "Output Format",
				type: "select",
				options: [
					{ label: "MP3", value: "mp3" },
					{ label: "WAV", value: "wav" },
					{ label: "OGG", value: "ogg" },
					{ label: "AAC", value: "aac" },
					{ label: "FLAC", value: "flac" },
				],
				default: "mp3",
			},
		],
		process: async (files, opts) =>
			batch(files, (f) => convertAudio(f, String(opts.format))),
	},
	{
		id: "audio-trim",
		name: "Trim Audio",
		description: "Cut a segment from an audio file",
		category: "audio",
		icon: "✂️",
		acceptedExtensions: [
			".mp3",
			".wav",
			".ogg",
			".aac",
			".flac",
			".m4a",
			".wma",
		],
		multiple: false,
		options: [
			{
				id: "start",
				label: "Start Time (e.g. 00:00:00)",
				type: "text",
				default: "",
			},
			{
				id: "end",
				label: "End Time (e.g. 00:00:10)",
				type: "text",
				default: "",
			},
		],
		process: async (files, opts) => [
			await trimAudio(
				files[0],
				String(opts.start || ""),
				String(opts.end || ""),
			),
		],
	},
	{
		id: "audio-merge",
		name: "Merge Audio",
		description: "Concatenate multiple audio files into one",
		category: "audio",
		icon: "🔗",
		acceptedExtensions: [
			".mp3",
			".wav",
			".ogg",
			".aac",
			".flac",
			".m4a",
			".wma",
		],
		multiple: true,
		options: [],
		process: async (files) => [await mergeAudio(files)],
	},

	// ── PDF to PPTX ──

	// ── File Utilities ──
	{
		id: "document-viewer",
		name: "Document Viewer",
		description: "View Document files locally in the browser",
		category: "document",
		icon: "📄",
		acceptedExtensions: [
			".pdf",
			".docx",
			".xlsx",
			".csv",
			".txt",
			".ods",
			".json",
		],
		multiple: false,
		options: [],
		process: async (files) => {
			const file = files[0]
			const ext = file.name.substring(file.name.lastIndexOf(".")).toLowerCase()

			if (ext === ".pdf") {
				return [{ blob: file, name: file.name }]
			}
			if (ext === ".docx") {
				// Pass through raw DOCX for docx-preview rendering in UI
				return [{ blob: file, name: file.name }]
			}
			if (ext === ".xlsx") {
				const ExcelJS = (await import("exceljs")).default
				const workbook = new ExcelJS.Workbook()
				await workbook.xlsx.load(await file.arrayBuffer())
				const worksheet = workbook.worksheets[0]

				let tableHtml =
					'<table style="border-collapse:collapse;width:100%;font-size:14px;"><thead style="background:#f9fafb"><tr>'
				worksheet.getRow(1).eachCell((cell) => {
					tableHtml += `<th style="border:1px solid #e5e7eb;padding:8px;text-align:left;">${cell.text}</th>`
				})
				tableHtml += "</tr></thead><tbody>"

				worksheet.eachRow((row, rowNumber) => {
					if (rowNumber === 1) return
					tableHtml += "<tr>"
					row.eachCell({ includeEmpty: true }, (cell) => {
						tableHtml += `<td style="border:1px solid #e5e7eb;padding:8px">${cell.text}</td>`
					})
					tableHtml += "</tr>"
				})
				tableHtml += "</tbody></table>"

				const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{font-family:sans-serif;padding:20px;color:#374151;}</style></head><body>${tableHtml}</body></html>`
				const blob = new Blob([html], { type: "text/html" })
				return [{ blob, name: `${file.name}.html` }]
			}
			if (ext === ".csv") {
				const Papa = (await import("papaparse")).default
				const text = await file.text()
				return new Promise((resolve) => {
					Papa.parse(text, {
						header: false,
						skipEmptyLines: true,
						complete: (results) => {
							let tableHtml =
								'<table style="border-collapse:collapse;width:100%;font-size:14px;"><tbody>'
							for (const row of results.data as string[][]) {
								tableHtml += "<tr>"
								for (const cell of row) {
									tableHtml += `<td style="border:1px solid #e5e7eb;padding:8px">${cell}</td>`
								}
								tableHtml += "</tr>"
							}
							tableHtml += "</tbody></table>"
							const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{font-family:sans-serif;padding:20px;color:#374151;}</style></head><body>${tableHtml}</body></html>`
							const blob = new Blob([html], { type: "text/html" })
							resolve([{ blob, name: `${file.name}.html` }])
						},
					})
				})
			}
			if (ext === ".txt" || ext === ".json") {
				return [{ blob: file, name: file.name }]
			}

			throw new Error("Unsupported file format for preview.")
		},
	},
	// ── Image Collage ──
	{
		id: "image-collage",
		name: "Image Collage",
		description: "Arrange, resize, and layer images on a canvas",
		category: "image",
		icon: "🖼️",
		acceptedExtensions: [
			".png",
			".jpg",
			".jpeg",
			".webp",
			".avif",
			".bmp",
			".gif",
			".svg",
		],
		multiple: true,
		options: [],
		// Collage is handled by its own UI — process is a no-op
		process: async (files) => files.map((f) => ({ blob: f, name: f.name })),
	},

	{
		id: "file-zip",
		name: "Create ZIP",
		description: "Bundle files into a ZIP archive",
		category: "file",
		icon: "📦",
		acceptedExtensions: ["*"],
		multiple: true,
		options: [],
		process: async (files) => [await createZip(files)],
	},

	// ── New Features Phase 11 ──

	{
		id: "image-blur",
		name: "Blur Image",
		description:
			"Apply Gaussian blur effect to a selected region or the whole image",
		category: "image",
		icon: "🌫️",
		acceptedExtensions: [
			".png",
			".jpg",
			".jpeg",
			".webp",
			".avif",
			".bmp",
			".gif",
			".svg",
		],
		multiple: false,
		options: [
			{
				id: "radius",
				label: "Blur Radius (px)",
				type: "number",
				default: 5,
				min: 1,
				max: 100,
			},
			{ id: "x", label: "X Offset", type: "number", default: 0 },
			{ id: "y", label: "Y Offset", type: "number", default: 0 },
			{ id: "cropWidth", label: "Region Width", type: "number", default: 400 },
			{
				id: "cropHeight",
				label: "Region Height",
				type: "number",
				default: 400,
			},
		],
		process: async (files, opts) => [
			await blurImage(files[0], Number(opts.radius), {
				x: Number(opts.x ?? 0),
				y: Number(opts.y ?? 0),
				width: Number(opts.cropWidth ?? 0),
				height: Number(opts.cropHeight ?? 0),
			}),
		],
	},
	{
		id: "image-pixelate",
		name: "Pixelate Image",
		description:
			"Apply pixelation effect to a selected region or the whole image",
		category: "image",
		icon: "👾",
		acceptedExtensions: [
			".png",
			".jpg",
			".jpeg",
			".webp",
			".avif",
			".bmp",
			".gif",
			".svg",
		],
		multiple: false,
		options: [
			{
				id: "size",
				label: "Pixel Size",
				type: "number",
				default: 10,
				min: 2,
				max: 100,
			},
			{ id: "x", label: "X Offset", type: "number", default: 0 },
			{ id: "y", label: "Y Offset", type: "number", default: 0 },
			{ id: "cropWidth", label: "Region Width", type: "number", default: 400 },
			{
				id: "cropHeight",
				label: "Region Height",
				type: "number",
				default: 400,
			},
		],
		process: async (files, opts) => [
			await pixelateImage(files[0], Number(opts.size), {
				x: Number(opts.x ?? 0),
				y: Number(opts.y ?? 0),
				width: Number(opts.cropWidth ?? 0),
				height: Number(opts.cropHeight ?? 0),
			}),
		],
	},
	{
		id: "image-watermark",
		name: "Add Image Watermark",
		description: "Add a text watermark",
		category: "image",
		icon: "🖋️",
		acceptedExtensions: [
			".png",
			".jpg",
			".jpeg",
			".webp",
			".avif",
			".bmp",
			".gif",
			".svg",
		],
		multiple: true,
		options: [
			{ id: "text", label: "Watermark Text", type: "text", default: "Kitsy" },
		],
		process: async (files, opts) =>
			batch(files, (f) => addImageWatermark(f, String(opts.text))),
	},
	{
		id: "pdf-compress",
		name: "Compress PDF",
		description: "Reduce PDF file size",
		category: "pdf",
		icon: "🗜️",
		acceptedExtensions: [".pdf"],
		multiple: true,
		options: [],
		process: async (files) => batch(files, (f) => compressPdf(f)),
	},
	{
		id: "pdf-watermark",
		name: "Add PDF Watermark",
		description: "Add watermark to every page",
		category: "pdf",
		icon: "🖋️",
		acceptedExtensions: [".pdf"],
		multiple: true,
		options: [
			{
				id: "text",
				label: "Watermark Text",
				type: "text",
				default: "CONFIDENTIAL",
			},
		],
		process: async (files, opts) =>
			batch(files, (f) => addPdfWatermark(f, String(opts.text))),
	},
	{
		id: "pdf-rotate",
		name: "Rotate PDF",
		description: "Rotate all pages",
		category: "pdf",
		icon: "🔄",
		acceptedExtensions: [".pdf"],
		multiple: true,
		options: [
			{
				id: "angle",
				label: "Angle",
				type: "select",
				options: [
					{ label: "90°", value: "90" },
					{ label: "180°", value: "180" },
					{ label: "270°", value: "270" },
				],
				default: "90",
			},
		],
		process: async (files, opts) =>
			batch(files, (f) => rotatePdf(f, Number(opts.angle))),
	},
	{
		id: "video-resize",
		name: "Resize Video",
		description: "Change video dimensions",
		category: "video",
		icon: "📐",
		acceptedExtensions: [".mp4", ".mov", ".avi", ".webm", ".mkv"],
		multiple: true,
		options: [
			{ id: "width", label: "Width", type: "number", default: 1280 },
			{ id: "height", label: "Height", type: "number", default: 720 },
		],
		process: async (files, opts) =>
			batch(files, (f) =>
				resizeVideo(f, Number(opts.width), Number(opts.height)),
			),
	},
	{
		id: "video-crop",
		name: "Crop Video",
		description: "Crop video area",
		category: "video",
		icon: "✂️",
		acceptedExtensions: [".mp4", ".mov", ".avi", ".webm", ".mkv"],
		multiple: true,
		options: [
			{ id: "w", label: "Width", type: "number", default: 640 },
			{ id: "h", label: "Height", type: "number", default: 480 },
			{ id: "x", label: "X", type: "number", default: 0 },
			{ id: "y", label: "Y", type: "number", default: 0 },
		],
		process: async (files, opts) =>
			batch(files, (f) =>
				cropVideo(
					f,
					Number(opts.x),
					Number(opts.y),
					Number(opts.w),
					Number(opts.h),
				),
			),
	},
	{
		id: "video-watermark",
		name: "Add Video Watermark",
		description: "Add text watermark to video",
		category: "video",
		icon: "🖋️",
		acceptedExtensions: [".mp4", ".mov", ".avi", ".webm", ".mkv"],
		multiple: true,
		options: [{ id: "text", label: "Text", type: "text", default: "Kitsy" }],
		process: async (files, opts) =>
			batch(files, (f) => addVideoWatermark(f, String(opts.text))),
	},
	{
		id: "video-extract-frames",
		name: "Extract Video Frames",
		description: "Get 1 frame per second",
		category: "video",
		icon: "🖼️",
		acceptedExtensions: [".mp4", ".mov", ".avi", ".webm", ".mkv"],
		multiple: true,
		options: [],
		process: async (files) => {
			const res: ProcessedFile[] = []
			for (const f of files) res.push(...(await extractFrames(f)))
			return res
		},
	},
	{
		id: "audio-volume",
		name: "Change Volume",
		description: "Adjust audio level",
		category: "audio",
		icon: "🔊",
		acceptedExtensions: [".mp3", ".wav", ".ogg", ".aac", ".m4a"],
		multiple: true,
		options: [
			{ id: "factor", label: "Volume Factor", type: "number", default: 1.5 },
		],
		process: async (files, opts) =>
			batch(files, (f) => changeVolume(f, Number(opts.factor))),
	},
	{
		id: "audio-fade",
		name: "Audio Fade",
		description: "Apply fade-in/fade-out",
		category: "audio",
		icon: "🔉",
		acceptedExtensions: [".mp3", ".wav", ".ogg", ".aac", ".m4a"],
		multiple: true,
		options: [
			{
				id: "type",
				label: "Fade Type",
				type: "select",
				options: [
					{ label: "Fade In", value: "in" },
					{ label: "Fade Out", value: "out" },
				],
				default: "in",
			},
			{ id: "duration", label: "Duration (s)", type: "number", default: 3 },
		],
		process: async (files, opts) =>
			batch(files, (f) =>
				fadeAudio(f, opts.type as "in" | "out", Number(opts.duration)),
			),
	},
	{
		id: "file-unzip",
		name: "Unzip Files",
		description: "Extract ZIP content",
		category: "file",
		icon: "📦",
		acceptedExtensions: [".zip"],
		multiple: true,
		options: [],
		process: async (files) => {
			const res: ProcessedFile[] = []
			for (const f of files) res.push(...(await unzipFiles(f)))
			return res
		},
	},
	{
		id: "data-csv-to-json",
		name: "CSV to JSON",
		description: "Convert CSV to JSON",
		category: "data",
		icon: "📊",
		acceptedExtensions: [".csv"],
		multiple: true,
		options: [],
		process: async (files) => batch(files, (f) => csvToJson(f)),
	},
	{
		id: "data-json-to-csv",
		name: "JSON to CSV",
		description: "Convert JSON array to CSV",
		category: "data",
		icon: "📝",
		acceptedExtensions: [".json"],
		multiple: true,
		options: [],
		process: async (files) => batch(files, (f) => jsonToCsv(f)),
	},
	{
		id: "data-format-json",
		name: "Format JSON",
		description: "Prettify JSON data",
		category: "data",
		icon: "✨",
		acceptedExtensions: [".json"],
		multiple: true,
		options: [],
		process: async (files) => batch(files, (f) => formatJson(f)),
	},
]

// ── Lookup ──

const toolMap = new Map<string, ToolDefinition>()
for (const t of tools) toolMap.set(t.id, t)

export const getToolById = (id: string) => toolMap.get(id)
export const getToolsByCategory = (cat: ToolCategory) =>
	tools.filter((t) => t.category === cat)
export const getAllTools = () => tools
export const getCategories = (): {
	id: ToolCategory
	label: string
	icon: string
}[] => [
	{ id: "pdf", label: "PDF Tools", icon: "📄" },
	{ id: "image", label: "Image Tools", icon: "🖼️" },
	{ id: "video", label: "Video Tools", icon: "🎬" },
	{ id: "audio", label: "Audio Tools", icon: "🎵" },
	{ id: "document", label: "Document Tools", icon: "📑" },
	{ id: "file", label: "File Utilities", icon: "📦" },
	{ id: "data", label: "Data Tools", icon: "📊" },
]
