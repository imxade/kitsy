// ── Tool Registry ──
// Each tool has a `process` function that takes files + options and returns results.

import type { ProcessedFile } from "./image-processor"
import {
	convertImage,
	resizeImage,
	compressImage,
	rotateImage,
	cropImage,
	upscaleImage,
	imageToSvg,
} from "./image-processor"
import {
	mergePdfs,
	splitPdf,
	deletePdfPages,
	reorderPdfPages,
	imagesToPdf,
	pdfToText,
	pdfToImages,
} from "./pdf-processor"
import { createZip } from "./file-processor"
import {
	convertVideo,
	trimVideo,
	extractAudio,
	convertAudio,
	trimAudio,
	videoToGif,
	gifToMp4,
	mergeVideos,
	mergeAudio,
	mergeAudioVideo,
	muteVideo,
	changeVideoSpeed,
} from "./ffmpeg-processor"

export type ToolCategory =
	| "pdf"
	| "image"
	| "video"
	| "audio"
	| "gif"
	| "file"
	| "document"

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
			".gif",
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
					{ label: "GIF", value: "image/gif" },
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
		id: "image-to-svg",
		name: "Image to SVG",
		description:
			"Convert a raster image (PNG/JPG) into a Scalable Vector Graphic (SVG) using ImageTracer.js",
		category: "image",
		icon: "🖌️",
		acceptedExtensions: [".png", ".jpg", ".jpeg", ".webp", ".bmp"],
		multiple: true,
		options: [
			{
				id: "numberofcolors",
				label: "Number of Colors",
				type: "number",
				default: 50,
				min: 2,
				max: 256,
			},
		],
		process: async (files, opts) => batch(files, (f) => imageToSvg(f, opts)),
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
		id: "image-compress",
		name: "Compress Image",
		description: "Reduce image file size with quality control",
		category: "image",
		icon: "🗜️",
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
				id: "quality",
				label: "Quality (%)",
				type: "number",
				default: 70,
				min: 10,
				max: 100,
			},
		],
		process: async (files, opts) =>
			batch(files, (f) => compressImage(f, Number(opts.quality))),
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
		description: "Convert between MP4, WebM, MKV, and AVI",
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

	// ── GIF ──
	{
		id: "gif-from-video",
		name: "Video to GIF",
		description: "Create a GIF from a video file",
		category: "gif",
		icon: "🎞️",
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
			{ id: "fps", label: "FPS", type: "number", default: 10, min: 1, max: 30 },
			{
				id: "width",
				label: "Width (px)",
				type: "number",
				default: 320,
				min: 50,
				max: 1920,
			},
		],
		process: async (files, opts) => [
			await videoToGif(files[0], Number(opts.fps), Number(opts.width)),
		],
	},
	{
		id: "gif-to-mp4",
		name: "GIF to MP4",
		description: "Convert a GIF to MP4 video",
		category: "gif",
		icon: "🎥",
		acceptedExtensions: [".gif"],
		multiple: false,
		options: [],
		process: async (files) => [await gifToMp4(files[0])],
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
			if (ext === ".xlsx" || ext === ".csv" || ext === ".ods") {
				const xlsx = await import("xlsx")
				const arrayBuffer = await file.arrayBuffer()
				const workbook = xlsx.read(arrayBuffer)
				const sheetName = workbook.SheetNames[0]
				const htmlFragment = xlsx.utils.sheet_to_html(
					workbook.Sheets[sheetName],
				)
				const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{font-family:sans-serif;padding:20px;} table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #ddd; padding: 8px; text-align: left; } th { background-color: #f2f2f2; }</style></head><body>${htmlFragment}</body></html>`
				const blob = new Blob([html], { type: "text/html" })
				return [{ blob, name: `${file.name}.html` }]
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
	{ id: "gif", label: "GIF Tools", icon: "🎞️" },
	{ id: "document", label: "Document Tools", icon: "📑" },
	{ id: "file", label: "File Utilities", icon: "📦" },
]
