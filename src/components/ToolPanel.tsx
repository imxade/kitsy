import { useState, useRef, useEffect } from "react"
import * as docxPreview from "docx-preview"
import { getPdfjsLib, getPdfPageCount } from "../lib/pdfjs"
import type { ToolDefinition } from "../lib/tool-registry"
import type { ProcessedFile } from "../lib/image-processor"
import { createZip } from "../lib/file-processor"
import FileDropzone from "./FileDropzone"
import { useAppShell } from "./AppShellProvider"
import Icon from "./Icon"
import CollagePanel from "./CollagePanel"
import RecorderPanel from "./RecorderPanel"
import TextOverlayPanel from "./TextOverlayPanel"
import TodoListPanel from "./TodoListPanel"
import ScannerPanel from "./ScannerPanel"

interface ToolPanelProps {
	tool: ToolDefinition
	presetDefaults?: Record<string, unknown>
}

/** Format seconds to HH:MM:SS */
function formatTime(seconds: number): string {
	const h = Math.floor(seconds / 3600)
	const m = Math.floor((seconds % 3600) / 60)
	const s = Math.floor(seconds % 60)
	return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

interface CropSelection {
	x: number
	y: number
	cropWidth: number
	cropHeight: number
}

interface CropBounds {
	width: number
	height: number
}

type CropGestureMode = "move" | "resize" | null

function clampCropSelection(
	selection: CropSelection,
	bounds: CropBounds,
): CropSelection {
	const cropWidth = Math.min(
		Math.max(Math.round(selection.cropWidth), 10),
		Math.max(bounds.width, 10),
	)
	const cropHeight = Math.min(
		Math.max(Math.round(selection.cropHeight), 10),
		Math.max(bounds.height, 10),
	)
	const x = Math.min(
		Math.max(Math.round(selection.x), 0),
		Math.max(bounds.width - cropWidth, 0),
	)
	const y = Math.min(
		Math.max(Math.round(selection.y), 0),
		Math.max(bounds.height - cropHeight, 0),
	)

	return { x, y, cropWidth, cropHeight }
}

function useCropInteraction({
	x,
	y,
	cropWidth,
	cropHeight,
	scale,
	bounds,
	onCropChange,
}: CropSelection & {
	scale: number
	bounds: CropBounds
	onCropChange: (crop: CropSelection) => void
}) {
	const [activeMode, setActiveMode] = useState<CropGestureMode>(null)
	const boundsRef = useRef({ width: bounds.width, height: bounds.height })
	const onCropChangeRef = useRef(onCropChange)
	const gestureRef = useRef({
		startX: 0,
		startY: 0,
		origin: { x, y, cropWidth, cropHeight },
	})

	useEffect(() => {
		boundsRef.current = { width: bounds.width, height: bounds.height }
	}, [bounds.height, bounds.width])

	useEffect(() => {
		onCropChangeRef.current = onCropChange
	}, [onCropChange])

	useEffect(() => {
		if (!activeMode) return

		const safeScale = scale > 0 ? scale : 1
		const handleMove = (event: PointerEvent) => {
			if (event.cancelable) event.preventDefault()
			const dx = (event.clientX - gestureRef.current.startX) / safeScale
			const dy = (event.clientY - gestureRef.current.startY) / safeScale
			const origin = gestureRef.current.origin
			const next =
				activeMode === "move"
					? {
							x: origin.x + dx,
							y: origin.y + dy,
							cropWidth: origin.cropWidth,
							cropHeight: origin.cropHeight,
						}
					: {
							x: origin.x,
							y: origin.y,
							cropWidth: origin.cropWidth + dx,
							cropHeight: origin.cropHeight + dy,
						}

			onCropChangeRef.current(clampCropSelection(next, boundsRef.current))
		}

		const finish = () => {
			setActiveMode(null)
		}

		window.addEventListener("pointermove", handleMove, { passive: false })
		window.addEventListener("pointerup", finish)
		window.addEventListener("pointercancel", finish)
		return () => {
			window.removeEventListener("pointermove", handleMove)
			window.removeEventListener("pointerup", finish)
			window.removeEventListener("pointercancel", finish)
		}
	}, [activeMode, scale])

	const beginGesture = (
		event: React.PointerEvent<HTMLDivElement>,
		mode: Exclude<CropGestureMode, null>,
	) => {
		event.preventDefault()
		event.stopPropagation()
		gestureRef.current = {
			startX: event.clientX,
			startY: event.clientY,
			origin: clampCropSelection(
				{ x, y, cropWidth, cropHeight },
				boundsRef.current,
			),
		}
		setActiveMode(mode)
	}

	return {
		beginMove: (event: React.PointerEvent<HTMLDivElement>) =>
			beginGesture(event, "move"),
		beginResize: (event: React.PointerEvent<HTMLDivElement>) =>
			beginGesture(event, "resize"),
	}
}

function RemoveButton({
	onClick,
	label = "Remove file",
}: {
	onClick: () => void
	label?: string
}) {
	return (
		<button
			type="button"
			className="btn btn-ghost btn-xs btn-circle absolute top-1 right-1 bg-base-300/80 hover:bg-error hover:text-white z-10"
			onClick={onClick}
			aria-label={label}
		>
			<Icon name="close" size={14} />
		</button>
	)
}

function PreviewFrame({
	children,
	className = "",
	containerRef,
}: {
	children: React.ReactNode
	className?: string
	containerRef?: React.Ref<HTMLDivElement>
}) {
	return (
		<div
			ref={containerRef}
			className={`card card-border overflow-hidden ${className}`}
		>
			{children}
		</div>
	)
}

// -- Media Previews --

function VideoPreview({
	file,
	onRemove,
	onSetStart,
	onSetEnd,
}: {
	file: File
	onRemove?: () => void
	onSetStart?: (time: string) => void
	onSetEnd?: (time: string) => void
}) {
	const videoRef = useRef<HTMLVideoElement>(null)
	const [time, setTime] = useState("00:00:00")

	const [url, setUrl] = useState<string | null>(null)
	useEffect(() => {
		const u = URL.createObjectURL(file)
		setUrl(u)
		return () => URL.revokeObjectURL(u)
	}, [file])

	if (!url) return null

	return (
		<PreviewFrame className="relative">
			{onRemove && <RemoveButton onClick={onRemove} />}
			<p className="text-xs font-semibold text-base-content/60 px-3 pt-2 truncate">
				{file.name}
			</p>
			{/* biome-ignore lint/a11y/useMediaCaption: User file */}
			<video
				ref={videoRef}
				src={url}
				controls
				className="w-full max-h-64"
				onTimeUpdate={() => {
					if (videoRef.current)
						setTime(formatTime(videoRef.current.currentTime))
				}}
			/>
			<div className="flex items-center gap-2 px-3 py-2 bg-base-200/50">
				<span className="text-xs text-base-content/60">Current: {time}</span>
				<div className="flex-1" />
				{onSetStart && (
					<button
						type="button"
						className="btn btn-xs btn-primary btn-outline"
						onClick={() => onSetStart(time)}
					>
						Set Start
					</button>
				)}
				{onSetEnd && (
					<button
						type="button"
						className="btn btn-xs btn-primary btn-outline"
						onClick={() => onSetEnd(time)}
					>
						Set End
					</button>
				)}
			</div>
		</PreviewFrame>
	)
}

function AudioPreview({
	file,
	onRemove,
	onSetStart,
	onSetEnd,
}: {
	file: File
	onRemove?: () => void
	onSetStart?: (time: string) => void
	onSetEnd?: (time: string) => void
}) {
	const audioRef = useRef<HTMLAudioElement>(null)
	const [time, setTime] = useState("00:00:00")

	const [url, setUrl] = useState<string | null>(null)
	useEffect(() => {
		const u = URL.createObjectURL(file)
		setUrl(u)
		return () => URL.revokeObjectURL(u)
	}, [file])

	if (!url) return null

	return (
		<PreviewFrame className="relative p-3">
			{onRemove && <RemoveButton onClick={onRemove} />}
			<p className="text-sm truncate mb-2 pr-6">{file.name}</p>
			{/* biome-ignore lint/a11y/useMediaCaption: User file */}
			<audio
				ref={audioRef}
				src={url}
				controls
				className="w-full"
				onTimeUpdate={() => {
					if (audioRef.current)
						setTime(formatTime(audioRef.current.currentTime))
				}}
			/>
			<div className="flex items-center gap-2 mt-2">
				<span className="text-xs text-base-content/60">Current: {time}</span>
				<div className="flex-1" />
				{onSetStart && (
					<button
						type="button"
						className="btn btn-xs btn-primary btn-outline"
						onClick={() => onSetStart(time)}
					>
						Set Start
					</button>
				)}
				{onSetEnd && (
					<button
						type="button"
						className="btn btn-xs btn-primary btn-outline"
						onClick={() => onSetEnd(time)}
					>
						Set End
					</button>
				)}
			</div>
		</PreviewFrame>
	)
}

function ImagePreview({
	file,
	onRemove,
}: {
	file: File
	onRemove?: () => void
}) {
	const [url, setUrl] = useState<string | null>(null)

	useEffect(() => {
		const u = URL.createObjectURL(file)
		setUrl(u)
		return () => URL.revokeObjectURL(u)
	}, [file])

	if (!url) return null

	return (
		<PreviewFrame className="relative">
			{onRemove && <RemoveButton onClick={onRemove} />}
			<img
				src={url}
				alt={file.name}
				className="w-full h-auto object-contain max-h-48"
			/>
			<p className="text-xs text-center text-base-content/50 py-1 truncate px-2">
				{file.name}
			</p>
		</PreviewFrame>
	)
}

function PdfPagePreview({
	file,
	pageNum,
	label,
	onRemove,
}: {
	file: File
	pageNum: number
	label?: string
	onRemove?: () => void
}) {
	const [imgUrl, setImgUrl] = useState<string | null>(null)

	useEffect(() => {
		let cancelled = false
		;(async () => {
			try {
				const bytes = await file.arrayBuffer()
				const pdfjsLib = await getPdfjsLib()
				const doc = await pdfjsLib.getDocument({
					data: new Uint8Array(bytes),
					useWorkerFetch: false,
					isEvalSupported: false,
					useSystemFonts: true,
				}).promise
				if (pageNum > doc.numPages) return
				const page = await doc.getPage(pageNum)
				const viewport = page.getViewport({ scale: 0.5 })
				const canvas = new OffscreenCanvas(viewport.width, viewport.height)
				const ctx = canvas.getContext("2d")
				if (!ctx) return
				await page.render({
					canvasContext: ctx as unknown as CanvasRenderingContext2D,
					viewport,
					canvas: canvas as unknown as HTMLCanvasElement,
				}).promise
				const blob = await canvas.convertToBlob({ type: "image/png" })
				if (!cancelled) setImgUrl(URL.createObjectURL(blob))
			} catch {
				// Silently fail
			}
		})()
		return () => {
			cancelled = true
		}
	}, [file, pageNum])

	useEffect(() => {
		return () => {
			if (imgUrl) URL.revokeObjectURL(imgUrl)
		}
	}, [imgUrl])

	return (
		<PreviewFrame className="relative">
			{onRemove && <RemoveButton onClick={onRemove} label="Remove page" />}
			{imgUrl ? (
				<img
					src={imgUrl}
					alt={`Page ${pageNum}`}
					className="w-full h-auto object-contain max-h-48 bg-white"
				/>
			) : (
				<div className="flex items-center justify-center h-32 bg-base-200">
					<span className="loading loading-spinner loading-sm" />
				</div>
			)}
			<p className="text-xs text-center text-base-content/50 py-1 truncate px-2">
				{label || `Page ${pageNum}`}
			</p>
		</PreviewFrame>
	)
}

function PdfPreview({ file, onRemove }: { file: File; onRemove?: () => void }) {
	return (
		<PdfPagePreview
			file={file}
			pageNum={1}
			label={file.name}
			onRemove={onRemove}
		/>
	)
}

// -- PDF All Pages Preview (for delete/reorder) --

function PdfAllPagesPreview({
	file,
	onDeletePage,
	onReorder,
}: {
	file: File
	onDeletePage?: (pageNum: number) => void
	onReorder?: (newOrder: number[]) => void
}) {
	const [pageCount, setPageCount] = useState(0)
	const [pageOrder, setPageOrder] = useState<number[]>([])

	useEffect(() => {
		;(async () => {
			try {
				const count = await getPdfPageCount(file)
				setPageCount(count)
				setPageOrder(Array.from({ length: count }, (_, i) => i + 1))
			} catch {
				// Silently fail
			}
		})()
	}, [file])

	const handleMoveUp = (idx: number) => {
		if (idx === 0) return
		const newOrder = [...pageOrder]
		;[newOrder[idx - 1], newOrder[idx]] = [newOrder[idx], newOrder[idx - 1]]
		setPageOrder(newOrder)
		onReorder?.(newOrder)
	}

	const handleMoveDown = (idx: number) => {
		if (idx === pageOrder.length - 1) return
		const newOrder = [...pageOrder]
		;[newOrder[idx], newOrder[idx + 1]] = [newOrder[idx + 1], newOrder[idx]]
		setPageOrder(newOrder)
		onReorder?.(newOrder)
	}

	if (pageCount === 0) return null

	return (
		<div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
			{pageOrder.map((pageNum, idx) => (
				<div key={`page-${pageNum}`} className="relative">
					<PdfPagePreview
						file={file}
						pageNum={pageNum}
						onRemove={
							onDeletePage
								? () => {
										setPageOrder((prev) => prev.filter((p) => p !== pageNum))
										onDeletePage(pageNum)
									}
								: undefined
						}
					/>
					{onReorder && (
						<div className="flex justify-center gap-1 mt-1">
							<button
								type="button"
								className="btn btn-ghost btn-xs"
								onClick={() => handleMoveUp(idx)}
								disabled={idx === 0}
							>
								<Icon name="up" size={14} />
							</button>
							<button
								type="button"
								className="btn btn-ghost btn-xs"
								onClick={() => handleMoveDown(idx)}
								disabled={idx === pageOrder.length - 1}
							>
								<Icon name="down" size={14} />
							</button>
						</div>
					)}
				</div>
			))}
		</div>
	)
}

// -- Video Crop Preview --

function VideoCropPreview({
	file,
	x,
	y,
	cropWidth,
	cropHeight,
	onCropChange,
	onRemove,
}: {
	file: File
	x: number
	y: number
	cropWidth: number
	cropHeight: number
	onCropChange: (crop: {
		x: number
		y: number
		cropWidth: number
		cropHeight: number
	}) => void
	onRemove?: () => void
}) {
	const videoRef = useRef<HTMLVideoElement>(null)
	const [url, setUrl] = useState<string | null>(null)
	useEffect(() => {
		const u = URL.createObjectURL(file)
		setUrl(u)
		return () => URL.revokeObjectURL(u)
	}, [file])
	const containerRef = useRef<HTMLDivElement>(null)
	const [vidSize, setVidSize] = useState({ w: 0, h: 0 })

	const handleVidLoad = (e: React.SyntheticEvent<HTMLVideoElement>) => {
		setVidSize({
			w: e.currentTarget.videoWidth,
			h: e.currentTarget.videoHeight,
		})
	}

	const containerWidth = containerRef.current?.clientWidth || 400
	const scale = vidSize.w > 0 ? containerWidth / vidSize.w : 1
	const { beginMove, beginResize } = useCropInteraction({
		x,
		y,
		cropWidth,
		cropHeight,
		scale,
		bounds: { width: vidSize.w, height: vidSize.h },
		onCropChange,
	})

	if (!url) return null

	return (
		<div className="space-y-3">
			<PreviewFrame
				containerRef={containerRef}
				className="relative select-none"
			>
				{onRemove && <RemoveButton onClick={onRemove} />}
				{/* biome-ignore lint/a11y/useMediaCaption: User file */}
				<video
					ref={videoRef}
					src={url}
					controls
					className="w-full h-auto"
					onLoadedMetadata={handleVidLoad}
				/>
				{vidSize.w > 0 && (
					// biome-ignore lint/a11y/useSemanticElements: Crop drag handle
					<div
						role="button"
						tabIndex={0}
						className="absolute border-2 border-primary bg-primary/10 cursor-move"
						style={{
							left: x * scale,
							top: y * scale,
							width: Math.min(cropWidth, vidSize.w - x) * scale,
							height: Math.min(cropHeight, vidSize.h - y) * scale,
							touchAction: "none",
						}}
						onPointerDown={beginMove}
						onKeyDown={() => {}}
						data-testid="crop-selection"
					>
						{/* biome-ignore lint/a11y/useSemanticElements: Crop resize handle */}
						<div
							role="button"
							tabIndex={0}
							className="absolute -right-2 -bottom-2 w-4 h-4 bg-primary border-2 border-base-100/50 rounded-full cursor-se-resize shadow-md"
							onPointerDown={beginResize}
							onKeyDown={() => {}}
							data-testid="crop-resize-handle"
						/>
					</div>
				)}
			</PreviewFrame>
			<p className="text-xs text-base-content/50 text-center">
				Drag to reposition. Drag the bottom-right corner to resize.
			</p>
		</div>
	)
}

// -- Image Crop Preview --

function ImageCropPreview({
	file,
	x,
	y,
	cropWidth,
	cropHeight,
	onCropChange,
	onRemove,
}: {
	file: File
	x: number
	y: number
	cropWidth: number
	cropHeight: number
	onCropChange: (crop: {
		x: number
		y: number
		cropWidth: number
		cropHeight: number
	}) => void
	onRemove?: () => void
}) {
	const [url, setUrl] = useState<string | null>(null)
	useEffect(() => {
		const u = URL.createObjectURL(file)
		setUrl(u)
		return () => URL.revokeObjectURL(u)
	}, [file])
	const containerRef = useRef<HTMLDivElement>(null)
	const [imgSize, setImgSize] = useState({ w: 0, h: 0 })

	const handleImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
		setImgSize({
			w: e.currentTarget.naturalWidth,
			h: e.currentTarget.naturalHeight,
		})
	}

	const containerWidth = containerRef.current?.clientWidth || 400
	const scale = imgSize.w > 0 ? containerWidth / imgSize.w : 1
	const { beginMove, beginResize } = useCropInteraction({
		x,
		y,
		cropWidth,
		cropHeight,
		scale,
		bounds: { width: imgSize.w, height: imgSize.h },
		onCropChange,
	})

	if (!url) return null

	return (
		<div className="space-y-3">
			<PreviewFrame
				containerRef={containerRef}
				className="relative select-none"
			>
				{onRemove && <RemoveButton onClick={onRemove} />}
				<img
					src={url}
					alt="Crop source"
					className="w-full h-auto"
					onLoad={handleImgLoad}
				/>
				{imgSize.w > 0 && (
					// biome-ignore lint/a11y/useSemanticElements: Crop drag handle
					<div
						role="button"
						tabIndex={0}
						className="absolute border-2 border-primary bg-primary/10 cursor-move"
						style={{
							left: x * scale,
							top: y * scale,
							width: Math.min(cropWidth, imgSize.w - x) * scale,
							height: Math.min(cropHeight, imgSize.h - y) * scale,
							touchAction: "none",
						}}
						onPointerDown={beginMove}
						onKeyDown={() => {}}
						data-testid="crop-selection"
					>
						{/* biome-ignore lint/a11y/useSemanticElements: Crop resize handle */}
						<div
							role="button"
							tabIndex={0}
							className="absolute -right-2 -bottom-2 w-4 h-4 bg-primary border-2 border-base-100/50 rounded-full cursor-se-resize shadow-md"
							onPointerDown={beginResize}
							onKeyDown={() => {}}
							data-testid="crop-resize-handle"
						/>
					</div>
				)}
			</PreviewFrame>
			<p className="text-xs text-base-content/50 text-center">
				Drag to reposition. Drag the bottom-right corner to resize.
			</p>
		</div>
	)
}

// -- Image Rotate Preview --

function ImageRotatePreview({
	file,
	angle,
	onRemove,
}: {
	file: File
	angle: number
	onRemove?: () => void
}) {
	const [url, setUrl] = useState<string | null>(null)
	useEffect(() => {
		const u = URL.createObjectURL(file)
		setUrl(u)
		return () => URL.revokeObjectURL(u)
	}, [file])

	if (!url) return null

	return (
		<div className="relative">
			{onRemove && <RemoveButton onClick={onRemove} />}
			<div className="grid gap-3 grid-cols-2">
				<PreviewFrame>
					<p className="text-xs text-center text-base-content/50 py-1">
						Original
					</p>
					<img
						src={url}
						alt="Original"
						className="w-full h-auto object-contain max-h-48"
					/>
				</PreviewFrame>
				<PreviewFrame className="border-primary/30">
					<p className="text-xs text-center text-primary py-1">
						After {angle} degree rotation
					</p>
					<img
						src={url}
						alt={`Rotated ${angle}`}
						className="w-full h-auto object-contain max-h-48"
						style={{ transform: `rotate(${angle}deg)` }}
					/>
				</PreviewFrame>
			</div>
		</div>
	)
}

// -- Text Result Preview --

function TextPreview({ blob, name }: { blob: Blob; name: string }) {
	const [text, setText] = useState<string | null>(null)
	useEffect(() => {
		blob.text().then(setText)
	}, [blob])
	if (!text) return null
	return (
		<PreviewFrame>
			<div className="bg-base-200/50 p-2 border-b border-base-content/10">
				<span className="text-xs font-semibold px-2 text-base-content">
					{name}
				</span>
			</div>
			<pre className="p-4 text-sm overflow-auto max-h-64 whitespace-pre-wrap">
				{text}
			</pre>
		</PreviewFrame>
	)
}

function DocxPreview({ blob, name }: { blob: Blob; name: string }) {
	const containerRef = useRef<HTMLDivElement>(null)
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		let cancelled = false
		const render = async () => {
			if (!containerRef.current) return
			try {
				if (cancelled || !containerRef.current) return
				containerRef.current.innerHTML = ""
				await docxPreview.renderAsync(blob, containerRef.current, undefined, {
					className: "docx-preview",
					inWrapper: false,
					ignoreWidth: false,
					ignoreHeight: false,
					ignoreFonts: false,
					breakPages: true,
					ignoreLastRenderedPageBreak: true,
					experimental: true,
				})
			} catch (err) {
				if (!cancelled && containerRef.current) {
					const errorMessage = document.createElement("p")
					errorMessage.className = "p-4 text-error"
					errorMessage.textContent = `Failed to render DOCX: ${
						err instanceof Error ? err.message : "Unknown error"
					}`
					containerRef.current.replaceChildren(errorMessage)
				}
			} finally {
				if (!cancelled) setLoading(false)
			}
		}
		render()
		return () => {
			cancelled = true
		}
	}, [blob])

	return (
		<PreviewFrame className="bg-white">
			<div className="bg-base-200/50 p-2 border-b border-base-content/10 flex items-center justify-between">
				<span className="text-xs font-semibold px-2 text-base-content">
					{name}
				</span>
			</div>
			{loading && (
				<div className="flex justify-center p-8">
					<span className="loading loading-spinner loading-md" />
				</div>
			)}
			<div
				ref={containerRef}
				className="overflow-auto max-h-[600px] bg-white docx-no-pad"
				style={{ minHeight: loading ? 0 : 200 }}
			/>
		</PreviewFrame>
	)
}

// -- Type helpers --

function isImage(file: File) {
	return (
		file.type.startsWith("image/") ||
		/\.(png|jpe?g|webp|avif|bmp|gif|ico)$/i.test(file.name)
	)
}
function isPdf(file: File) {
	return file.type === "application/pdf" || /\.pdf$/i.test(file.name)
}
function isVideo(file: File) {
	return (
		file.type.startsWith("video/") || /\.(mp4|webm|mkv|avi)$/i.test(file.name)
	)
}
function isAudio(file: File) {
	return (
		file.type.startsWith("audio/") || /\.(mp3|wav|ogg|aac)$/i.test(file.name)
	)
}

// -- Main --

export default function ToolPanel({ tool, presetDefaults }: ToolPanelProps) {
	const uiMode = tool.uiMode ?? "standard"
	const requiresFiles = tool.requiresFiles ?? true
	const { cloud } = useAppShell()
	const fileInputRef = useRef<HTMLInputElement>(null)
	const [files, setFiles] = useState<File[]>([])
	const [options, setOptions] = useState<Record<string, unknown>>(() => {
		const defaults: Record<string, unknown> = {}
		for (const opt of tool.options) {
			if (opt.default !== undefined) defaults[opt.id] = opt.default
		}
		return { ...defaults, ...(presetDefaults || {}) }
	})
	const [isProcessing, setIsProcessing] = useState(false)
	const [results, setResults] = useState<ProcessedFile[] | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [cloudMessage, setCloudMessage] = useState<string | null>(null)
	const [activeUploads, setActiveUploads] = useState<string[]>([])

	const handleFilesSelected = (newFiles: File[]) => {
		setFiles(newFiles)
		setResults(null)
		setError(null)
		setCloudMessage(null)
	}

	const removeFile = (idx: number) => {
		setFiles((p) => p.filter((_, j) => j !== idx))
		setCloudMessage(null)
	}

	const handleAddMoreClick = () => {
		fileInputRef.current?.click()
	}

	const handleFileAppend = (e: React.ChangeEvent<HTMLInputElement>) => {
		const newFiles = Array.from(e.target.files || [])
		if (newFiles.length > 0) {
			setFiles((p) => [...p, ...newFiles])
			setResults(null)
			setError(null)
			setCloudMessage(null)
		}
		// Reset input value so same file can be selected again
		e.target.value = ""
	}

	useEffect(() => {
		let cancelled = false
		if (uiMode === "auto-process" && files.length > 0) {
			const run = async () => {
				setIsProcessing(true)
				setError(null)
				setResults(null)
				try {
					const result = await tool.process(files, options)
					if (!cancelled) setResults(result)
				} catch (err) {
					if (!cancelled)
						setError(err instanceof Error ? err.message : "Processing failed")
				} finally {
					if (!cancelled) setIsProcessing(false)
				}
			}
			run()
		}
		return () => {
			cancelled = true
		}
	}, [files, tool, options, uiMode])

	const handleRun = async () => {
		if (files.length === 0) return
		setIsProcessing(true)
		setError(null)
		setResults(null)
		setCloudMessage(null)

		try {
			const result = await tool.process(files, options)
			setResults(result)
		} catch (err) {
			setError(err instanceof Error ? err.message : "Processing failed")
		} finally {
			setIsProcessing(false)
		}
	}

	const download = (r: ProcessedFile) => {
		const url = URL.createObjectURL(r.blob)
		const a = document.createElement("a")
		a.href = url
		a.download = r.name
		document.body.appendChild(a)
		a.click()
		document.body.removeChild(a)
		setTimeout(() => URL.revokeObjectURL(url), 1000)
	}

	const downloadAll = async () => {
		if (!results || results.length === 0) return
		if (results.length === 1) {
			download(results[0])
			return
		}
		// Create ZIP of all results
		const zipFiles = results.map(
			(r) => new File([r.blob], r.name, { type: r.blob.type }),
		)
		const zipResult = await createZip(zipFiles)
		download(zipResult)
	}

	const uploadToDrive = async (file: ProcessedFile) => {
		setCloudMessage(null)
		setActiveUploads((prev) => [...prev, file.name])

		try {
			await cloud.uploadProcessedFile(file)
			setCloudMessage(`Saved "${file.name}" to Google Drive.`)
		} catch (err) {
			setCloudMessage(
				err instanceof Error
					? err.message
					: "Failed to save the file to Drive.",
			)
		} finally {
			setActiveUploads((prev) => prev.filter((name) => name !== file.name))
		}
	}

	const uploadAllToDrive = async () => {
		if (!results || results.length === 0) return
		setCloudMessage(null)
		setActiveUploads(results.map((file) => file.name))

		try {
			const uploaded = await cloud.uploadProcessedFiles(results)
			setCloudMessage(
				`Saved ${uploaded.length} file${uploaded.length === 1 ? "" : "s"} to Google Drive.`,
			)
		} catch (err) {
			setCloudMessage(
				err instanceof Error ? err.message : "Failed to save files to Drive.",
			)
		} finally {
			setActiveUploads([])
		}
	}

	const handleCropChange = (crop: {
		x: number
		y: number
		cropWidth: number
		cropHeight: number
	}) => {
		setOptions((p) => ({
			...p,
			x: crop.x,
			y: crop.y,
			cropWidth: crop.cropWidth,
			cropHeight: crop.cropHeight,
		}))
	}

	// For PDF delete/reorder, track modified page order
	const handlePdfReorder = (newOrder: number[]) => {
		setOptions((p) => ({ ...p, order: newOrder.join(",") }))
	}

	const handlePdfDeletePage = (pageNum: number) => {
		setOptions((p) => {
			const current = String(p.pages || "")
			const pages = current ? `${current},${pageNum}` : String(pageNum)
			return { ...p, pages }
		})
	}

	const isPdfPageTool =
		tool.id === "pdf-delete-pages" || tool.id === "pdf-reorder"
	const recorderKind =
		tool.id === "audio-recorder"
			? "audio"
			: tool.id === "camera-recorder"
				? "camera"
				: "screen"
	const panelClassName =
		"card rounded-3xl border border-base-content/8 bg-base-100/90 shadow-sm"
	const panelBodyClassName = "card-body gap-4 p-5"

	return (
		<div className="flex flex-col gap-6">
			{/* File input */}
			{requiresFiles && files.length === 0 ? (
				<FileDropzone
					acceptedExtensions={tool.acceptedExtensions}
					acceptedMimeTypes={[]}
					multiple={tool.multiple}
					onFilesSelected={handleFilesSelected}
				/>
			) : requiresFiles ? (
				<div className={panelClassName}>
					<div className={panelBodyClassName}>
						<div className="flex items-center justify-between mb-3">
							<div className="flex items-center gap-2">
								<h4 className="font-semibold text-sm text-base-content/70">
									Selected Files ({files.length})
								</h4>
								{tool.multiple && (
									<button
										type="button"
										className="btn btn-circle btn-ghost btn-xs text-primary bg-primary/10 hover:bg-primary hover:text-white transition-all scale-110"
										onClick={handleAddMoreClick}
										title="Add more files"
									>
										<Icon name="plus" />
									</button>
								)}
							</div>
							<button
								type="button"
								className="btn btn-ghost btn-xs"
								onClick={() => {
									setFiles([])
									setResults(null)
								}}
							>
								Clear all
							</button>
						</div>

						{/* Hidden input for adding more files */}
						<input
							type="file"
							ref={fileInputRef}
							className="hidden"
							multiple={tool.multiple}
							accept={tool.acceptedExtensions.join(",")}
							onChange={handleFileAppend}
						/>

						{/* Rich file previews with inline remove buttons */}
						{(tool.id === "image-crop" ||
							tool.id === "image-blur" ||
							tool.id === "image-pixelate") &&
						files.length > 0 &&
						isImage(files[0]) ? (
							<ImageCropPreview
								file={files[0]}
								x={Number(options.x ?? 0)}
								y={Number(options.y ?? 0)}
								cropWidth={Number(options.cropWidth ?? 400)}
								cropHeight={Number(options.cropHeight ?? 400)}
								onCropChange={handleCropChange}
								onRemove={() => removeFile(0)}
							/>
						) : tool.id === "image-rotate" &&
							files.length > 0 &&
							isImage(files[0]) ? (
							<ImageRotatePreview
								file={files[0]}
								angle={Number(options.angle ?? 90)}
								onRemove={() => removeFile(0)}
							/>
						) : isPdfPageTool && files.length === 1 && isPdf(files[0]) ? (
							<PdfAllPagesPreview
								file={files[0]}
								onDeletePage={
									tool.id === "pdf-delete-pages"
										? handlePdfDeletePage
										: undefined
								}
								onReorder={
									tool.id === "pdf-reorder" ? handlePdfReorder : undefined
								}
							/>
						) : (
							<>
								{/* Image previews */}
								{files.some(isImage) && (
									<div className="grid gap-3 grid-cols-2 sm:grid-cols-3 mb-3">
										{files.map((f, i) =>
											isImage(f) ? (
												<ImagePreview
													key={`img-${f.name}-${i}`}
													file={f}
													onRemove={() => removeFile(i)}
												/>
											) : null,
										)}
									</div>
								)}

								{/* PDF previews */}
								{files.some(isPdf) && (
									<div className="grid gap-3 grid-cols-2 sm:grid-cols-3 mb-3">
										{files.map((f, i) =>
											isPdf(f) ? (
												<PdfPreview
													key={`pdf-${f.name}-${i}`}
													file={f}
													onRemove={() => removeFile(i)}
												/>
											) : null,
										)}
									</div>
								)}

								{/* Video previews */}
								{files.some(isVideo) && (
									<div className="flex flex-col gap-3 mb-3">
										{files.map((f, i) =>
											isVideo(f) ? (
												tool.id === "video-crop" ? (
													<VideoCropPreview
														key={`vid-crop-${f.name}-${i}`}
														file={f}
														x={Number(options.x ?? 0)}
														y={Number(options.y ?? 0)}
														cropWidth={Number(options.cropWidth ?? 400)}
														cropHeight={Number(options.cropHeight ?? 400)}
														onCropChange={handleCropChange}
														onRemove={() => removeFile(i)}
													/>
												) : (
													<VideoPreview
														key={`vid-${f.name}-${i}`}
														file={f}
														onRemove={() => removeFile(i)}
														onSetStart={
															tool.id === "video-trim"
																? (time) =>
																		setOptions((p) => ({ ...p, start: time }))
																: undefined
														}
														onSetEnd={
															tool.id === "video-trim"
																? (time) =>
																		setOptions((p) => ({ ...p, end: time }))
																: undefined
														}
													/>
												)
											) : null,
										)}
									</div>
								)}

								{/* Audio previews */}
								{files.some(isAudio) && (
									<div className="flex flex-col gap-3 mb-3">
										{files.map((f, i) =>
											isAudio(f) ? (
												<AudioPreview
													key={`aud-${f.name}-${i}`}
													file={f}
													onRemove={() => removeFile(i)}
													onSetStart={
														tool.id === "audio-trim"
															? (time) =>
																	setOptions((p) => ({ ...p, start: time }))
															: undefined
													}
													onSetEnd={
														tool.id === "audio-trim"
															? (time) =>
																	setOptions((p) => ({ ...p, end: time }))
															: undefined
													}
												/>
											) : null,
										)}
									</div>
								)}

								{/* Fallback for unknown types */}
								{files.map((f, i) =>
									!isImage(f) && !isPdf(f) && !isVideo(f) && !isAudio(f) ? (
										<div
											key={`unk-${f.name}-${i}`}
											className="badge badge-lg gap-2 bg-base-200 border-base-content/10 relative"
										>
											<span className="max-w-[200px] truncate text-xs">
												{f.name}
											</span>
											<span className="text-xs text-base-content/40">
												{(f.size / 1024).toFixed(0)}KB
											</span>
											<button
												type="button"
												className="btn btn-ghost btn-xs btn-circle text-base-content/40 hover:text-error"
												onClick={() => removeFile(i)}
												aria-label={`Remove ${f.name}`}
											>
												✕
											</button>
										</div>
									) : null,
								)}
							</>
						)}
					</div>
				</div>
			) : null}

			{/* Options */}
			{tool.options.length > 0 && files.length > 0 && (
				<div className={panelClassName}>
					<div className={panelBodyClassName}>
						<h4 className="font-semibold text-sm text-base-content/70 mb-3">
							Options
						</h4>
						<div className="grid gap-4 sm:grid-cols-2">
							{tool.options.map((opt) => {
								if (opt.isVisible && !opt.isVisible(options)) return null
								return (
									<div key={opt.id} className="form-control">
										<label className="label" htmlFor={`opt-${opt.id}`}>
											<span className="label-text text-sm">{opt.label}</span>
										</label>
										{opt.type === "select" && opt.options ? (
											<select
												id={`opt-${opt.id}`}
												className="select select-bordered select-sm"
												value={String(options[opt.id] ?? opt.default)}
												onChange={(e) =>
													setOptions((p) => ({
														...p,
														[opt.id]: e.target.value,
													}))
												}
											>
												{opt.options.map((o) => (
													<option key={o.value} value={o.value}>
														{o.label}
													</option>
												))}
											</select>
										) : opt.type === "number" ? (
											<input
												id={`opt-${opt.id}`}
												type="number"
												className="input input-bordered input-sm"
												value={Number(options[opt.id] ?? opt.default)}
												min={opt.min}
												max={opt.max}
												step={opt.step}
												onChange={(e) =>
													setOptions((p) => ({
														...p,
														[opt.id]: Number(e.target.value),
													}))
												}
											/>
										) : opt.type === "text" ? (
											<input
												id={`opt-${opt.id}`}
												type="text"
												className="input input-bordered input-sm"
												value={String(options[opt.id] ?? opt.default)}
												onChange={(e) =>
													setOptions((p) => ({
														...p,
														[opt.id]: e.target.value,
													}))
												}
											/>
										) : opt.type === "color" ? (
											<input
												id={`opt-${opt.id}`}
												type="color"
												className="input input-bordered input-sm h-10 w-full p-1"
												value={String(options[opt.id] ?? opt.default)}
												onChange={(e) =>
													setOptions((p) => ({
														...p,
														[opt.id]: e.target.value,
													}))
												}
											/>
										) : opt.type === "file" ? (
											<input
												id={`opt-${opt.id}`}
												type="file"
												accept={opt.accept}
												className="file-input file-input-bordered file-input-sm"
												onChange={(e) => {
													if (e.target.files?.[0]) {
														setOptions((p) => ({
															...p,
															[opt.id]: e.target.files?.[0],
														}))
													}
												}}
											/>
										) : (
											<input
												id={`opt-${opt.id}`}
												type="checkbox"
												className="checkbox checkbox-primary checkbox-sm"
												checked={Boolean(options[opt.id] ?? opt.default)}
												onChange={(e) =>
													setOptions((p) => ({
														...p,
														[opt.id]: e.target.checked,
													}))
												}
											/>
										)}
									</div>
								)
							})}
						</div>
					</div>
				</div>
			)}

			{/* Run */}
			{uiMode === "standard" && files.length > 0 && (
				<button
					type="button"
					className={`btn btn-primary btn-lg ${isProcessing ? "btn-disabled" : ""}`}
					onClick={handleRun}
					disabled={isProcessing}
					data-testid="run-button"
				>
					{isProcessing ? (
						<>
							<span className="loading loading-spinner loading-sm" />{" "}
							Processing...
						</>
					) : (
						`${results ? "Re-run" : "Run"} ${tool.name}`
					)}
				</button>
			)}

			{/* Image Collage */}
			{uiMode === "collage" && files.length > 0 && (
				<CollagePanel files={files} />
			)}

			{uiMode === "text-overlay" && files.length > 0 && (
				<TextOverlayPanel
					files={files}
					options={options}
					onResultsChange={setResults}
					onErrorChange={setError}
				/>
			)}

			{uiMode === "recorder" && (
				<RecorderPanel
					kind={recorderKind}
					onResultsChange={setResults}
					onErrorChange={setError}
				/>
			)}

			{uiMode === "scanner" && (
				<ScannerPanel onResultsChange={setResults} onErrorChange={setError} />
			)}

			{uiMode === "todo" && <TodoListPanel />}

			{/* Error */}
			{error && (
				<div className="alert alert-error">
					<span>{error}</span>
				</div>
			)}

			{/* Results */}
			{results && results.length > 0 && (
				<div
					className="card bg-base-100 border border-success/30 shadow-sm"
					data-testid="result-card"
				>
					<div className={panelBodyClassName}>
						<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-3">
							<h4 className="font-semibold text-sm text-success flex items-center gap-2">
								Results ({results.length}{" "}
								{results.length === 1 ? "file" : "files"})
							</h4>
							<div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2 sm:justify-end">
								{results.length > 1 && (
									<button
										type="button"
										className="btn btn-success btn-sm w-full sm:w-auto"
										onClick={downloadAll}
									>
										Download All (ZIP)
									</button>
								)}
								{results.length > 1 && (
									<button
										type="button"
										className="btn btn-outline btn-sm w-full sm:w-auto"
										onClick={uploadAllToDrive}
										disabled={
											results.length === 0 ||
											activeUploads.length > 0 ||
											Boolean(cloud.disabledReason)
										}
										title={cloud.disabledReason ?? cloud.status}
										data-testid="result-save-all-to-drive"
									>
										{activeUploads.length > 0
											? "Saving..."
											: "Save All to Drive"}
									</button>
								)}
							</div>
						</div>

						<div className="flex flex-col gap-2">
							{results.map((r, i) => (
								<div
									key={`${r.name}-${i}`}
									className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-box bg-base-200/50 px-4 py-3"
								>
									<div className="flex items-center gap-3 min-w-0">
										<div className="min-w-0">
											<p className="text-sm font-medium truncate">{r.name}</p>
											<p className="text-xs text-base-content/40">
												{(r.blob.size / 1024).toFixed(1)} KB
											</p>
										</div>
									</div>
									<div className="flex items-center gap-2">
										<button
											type="button"
											className="btn btn-outline btn-sm flex-1 sm:flex-none"
											onClick={() => uploadToDrive(r)}
											disabled={
												activeUploads.includes(r.name) ||
												Boolean(cloud.disabledReason)
											}
											title={cloud.disabledReason ?? cloud.status}
											data-testid="result-save-to-drive"
										>
											{activeUploads.includes(r.name)
												? "Saving..."
												: "Save to Drive"}
										</button>
										<button
											type="button"
											className="btn btn-primary btn-sm flex-1 sm:flex-none"
											onClick={() => download(r)}
										>
											Download
										</button>
									</div>
								</div>
							))}
						</div>

						{cloudMessage && (
							<div className="alert alert-info mt-4">
								<span>{cloudMessage}</span>
							</div>
						)}

						{/* Image previews in results */}
						{results.some((r) => r.blob.type.startsWith("image/")) && (
							<div
								className="mt-4 grid gap-3 grid-cols-2 sm:grid-cols-3"
								data-testid="preview"
							>
								{results.map((r, i) => {
									if (!r.blob.type.startsWith("image/")) return null
									const u = URL.createObjectURL(r.blob)
									return (
										<PreviewFrame key={`prev-${r.name}-${i}`}>
											<img
												src={u}
												alt={r.name}
												className="w-full h-auto object-contain max-h-48"
											/>
										</PreviewFrame>
									)
								})}
							</div>
						)}

						{/* Video previews in results */}
						{results.some((r) => r.blob.type.startsWith("video/")) && (
							<div className="mt-4 flex flex-col gap-3" data-testid="preview">
								{results.map((r, i) => {
									if (!r.blob.type.startsWith("video/")) return null
									const u = URL.createObjectURL(r.blob)
									return (
										<PreviewFrame key={`prev-vid-${r.name}-${i}`}>
											{/* biome-ignore lint/a11y/useMediaCaption: Result preview */}
											<video src={u} controls className="w-full max-h-64" />
										</PreviewFrame>
									)
								})}
							</div>
						)}

						{/* Audio previews in results */}
						{results.some((r) => r.blob.type.startsWith("audio/")) && (
							<div className="mt-4 flex flex-col gap-3" data-testid="preview">
								{results.map((r, i) => {
									if (!r.blob.type.startsWith("audio/")) return null
									const u = URL.createObjectURL(r.blob)
									return (
										<PreviewFrame
											key={`prev-aud-${r.name}-${i}`}
											className="p-3"
										>
											{/* biome-ignore lint/a11y/useMediaCaption: Result preview */}
											<audio src={u} controls className="w-full" />
										</PreviewFrame>
									)
								})}
							</div>
						)}

						{/* Text previews in results */}
						{results.some(
							(r) =>
								r.blob.type === "text/plain" ||
								r.blob.type === "application/json" ||
								r.name.endsWith(".txt") ||
								r.name.endsWith(".json"),
						) && (
							<div className="mt-4 flex flex-col gap-3" data-testid="preview">
								{results.map((r, i) => {
									if (
										r.blob.type !== "text/plain" &&
										r.blob.type !== "application/json" &&
										!r.name.endsWith(".txt") &&
										!r.name.endsWith(".json")
									)
										return null
									return (
										<TextPreview
											key={`prev-txt-${r.name}-${i}`}
											blob={r.blob}
											name={r.name}
										/>
									)
								})}
							</div>
						)}

						{/* Document Viewer Previews in results (HTML/PDF/DOCX) */}
						{results.some(
							(r) =>
								r.blob.type === "text/html" ||
								r.name.endsWith(".docx") ||
								(r.name.toLowerCase().endsWith(".pdf") &&
									tool.id === "document-viewer"),
						) && (
							<div className="mt-4 flex flex-col gap-4" data-testid="preview">
								{results.map((r, i) => {
									if (r.name.endsWith(".docx")) {
										return (
											<DocxPreview
												key={`prev-docx-${r.name}-${i}`}
												blob={r.blob}
												name={r.name}
											/>
										)
									}
									// HTML / PDF → iframe
									if (
										r.blob.type !== "text/html" &&
										!(
											r.name.toLowerCase().endsWith(".pdf") &&
											tool.id === "document-viewer"
										)
									)
										return null
									const u = URL.createObjectURL(r.blob)
									return (
										<PreviewFrame
											key={`prev-doc-${r.name}-${i}`}
											className="bg-white"
										>
											<div className="bg-base-200/50 p-2 border-b border-base-content/10 flex items-center justify-between">
												<span className="text-xs font-semibold px-2 text-base-content">
													{r.name}
												</span>
												<a
													href={u}
													target="_blank"
													rel="noreferrer"
													className="btn btn-xs btn-outline"
												>
													Open Fullscreen
												</a>
											</div>
											<iframe
												src={u}
												title={r.name}
												className="w-full h-[600px] border-none"
												{...(r.name.toLowerCase().endsWith(".pdf")
													? {}
													: { sandbox: "allow-same-origin allow-scripts" })}
											/>
										</PreviewFrame>
									)
								})}
							</div>
						)}

						<button
							type="button"
							className="btn btn-ghost btn-sm mt-3 self-center"
							onClick={() => {
								setFiles([])
								setResults(null)
							}}
						>
							Process more files
						</button>
					</div>
				</div>
			)}
		</div>
	)
}
