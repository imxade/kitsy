import { useEffect, useMemo, useRef, useState } from "react"
import { addTextToImage, type ProcessedFile } from "../lib/image-processor"
import {
	DEFAULT_TEXT_OVERLAY_BOX,
	clampTextOverlayBox,
	fitTextToBox,
	type TextOverlayBox,
} from "../lib/text-overlay"

interface TextOverlayPanelProps {
	files: File[]
	options: Record<string, unknown>
	onResultsChange: (results: ProcessedFile[] | null) => void
	onErrorChange: (error: string | null) => void
}

type TextBoxGesture = "move" | "resize" | null

function optionText(options: Record<string, unknown>) {
	return String(options.text ?? "Hello World")
}

function optionStyle(options: Record<string, unknown>) {
	return {
		fontFamily: String(options.fontFamily ?? "sans-serif"),
		color: String(options.color ?? "#ffffff"),
		bold: Boolean(options.bold),
		italic: Boolean(options.italic),
		bgBox: Boolean(options.bgBox),
		bgBoxColor: String(options.bgBoxColor ?? "#000000"),
	}
}

export default function TextOverlayPanel({
	files,
	options,
	onResultsChange,
	onErrorChange,
}: TextOverlayPanelProps) {
	const imageRef = useRef<HTMLImageElement>(null)
	const gestureRef = useRef({
		startX: 0,
		startY: 0,
		origin: DEFAULT_TEXT_OVERLAY_BOX,
	})
	const displaySizeRef = useRef({ width: 0, height: 0 })
	const [imageUrl, setImageUrl] = useState<string | null>(null)
	const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 })
	const [box, setBox] = useState<TextOverlayBox>(DEFAULT_TEXT_OVERLAY_BOX)
	const [gesture, setGesture] = useState<TextBoxGesture>(null)
	const [isProcessing, setIsProcessing] = useState(false)

	const text = optionText(options)
	const style = optionStyle(options)
	const firstFile = files[0]

	useEffect(() => {
		if (!firstFile) {
			setImageUrl(null)
			return
		}

		const url = URL.createObjectURL(firstFile)
		setImageUrl(url)
		return () => URL.revokeObjectURL(url)
	}, [firstFile])

	useEffect(() => {
		displaySizeRef.current = displaySize
	}, [displaySize])

	useEffect(() => {
		if (!firstFile) return

		const image = imageRef.current
		if (!image) return

		const updateSize = () => {
			const rect = image.getBoundingClientRect()
			setDisplaySize({
				width: rect.width,
				height: rect.height,
			})
		}

		updateSize()
		const observer = new ResizeObserver(updateSize)
		observer.observe(image)
		return () => observer.disconnect()
	}, [firstFile])

	useEffect(() => {
		if (!gesture) return

		const handleMove = (event: PointerEvent) => {
			if (event.cancelable) event.preventDefault()
			const { width, height } = displaySizeRef.current
			if (width <= 0 || height <= 0) return

			const dx = (event.clientX - gestureRef.current.startX) / width
			const dy = (event.clientY - gestureRef.current.startY) / height
			const origin = gestureRef.current.origin
			const next =
				gesture === "move"
					? {
							...origin,
							x: origin.x + dx,
							y: origin.y + dy,
						}
					: {
							...origin,
							width: origin.width + dx,
							height: origin.height + dy,
						}
			setBox(clampTextOverlayBox(next))
		}

		const finish = () => setGesture(null)

		window.addEventListener("pointermove", handleMove, { passive: false })
		window.addEventListener("pointerup", finish)
		window.addEventListener("pointercancel", finish)
		return () => {
			window.removeEventListener("pointermove", handleMove)
			window.removeEventListener("pointerup", finish)
			window.removeEventListener("pointercancel", finish)
		}
	}, [gesture])

	const beginGesture = (
		event: React.PointerEvent<HTMLDivElement>,
		nextGesture: Exclude<TextBoxGesture, null>,
	) => {
		event.preventDefault()
		event.stopPropagation()
		gestureRef.current = {
			startX: event.clientX,
			startY: event.clientY,
			origin: box,
		}
		setGesture(nextGesture)
	}

	const overlayPixels = {
		x: box.x * displaySize.width,
		y: box.y * displaySize.height,
		width: box.width * displaySize.width,
		height: box.height * displaySize.height,
	}
	const padding = Math.max(
		4,
		Math.min(overlayPixels.width, overlayPixels.height) * 0.08,
	)

	const textLayout = useMemo(() => {
		if (typeof document === "undefined") {
			return { fontSize: 16, lineHeight: 19, lines: [text], totalHeight: 19 }
		}

		const canvas = document.createElement("canvas")
		const ctx = canvas.getContext("2d")
		if (!ctx) {
			return { fontSize: 16, lineHeight: 19, lines: [text], totalHeight: 19 }
		}

		return fitTextToBox(
			ctx,
			text,
			Math.max(1, overlayPixels.width - padding * 2),
			Math.max(1, overlayPixels.height - padding * 2),
			{
				fontFamily: style.fontFamily,
				bold: style.bold,
				italic: style.italic,
				maxFontSize: Math.floor(overlayPixels.height - padding * 2),
			},
		)
	}, [
		text,
		padding,
		overlayPixels.width,
		overlayPixels.height,
		style.fontFamily,
		style.bold,
		style.italic,
	])

	const applyText = async () => {
		if (files.length === 0) return

		setIsProcessing(true)
		onErrorChange(null)
		onResultsChange(null)
		try {
			const results: ProcessedFile[] = []
			for (const file of files) {
				results.push(
					await addTextToImage(file, text, {
						box,
						fontFamily: style.fontFamily,
						color: style.color,
						bold: style.bold,
						italic: style.italic,
						bgBox: style.bgBox,
						bgBoxColor: style.bgBoxColor,
					}),
				)
			}
			onResultsChange(results)
		} catch (error) {
			onErrorChange(
				error instanceof Error ? error.message : "Could not add text to image",
			)
		} finally {
			setIsProcessing(false)
		}
	}

	if (!firstFile || !imageUrl) return null

	return (
		<div className="flex flex-col gap-4">
			<div className="rounded-box border border-base-content/10 bg-base-200 overflow-auto">
				<div className="relative inline-block max-w-full align-top">
					<img
						ref={imageRef}
						src={imageUrl}
						alt="Text overlay preview"
						className="block max-w-full h-auto select-none"
						onLoad={() => {
							const rect = imageRef.current?.getBoundingClientRect()
							if (rect) {
								setDisplaySize({ width: rect.width, height: rect.height })
							}
						}}
						draggable={false}
					/>
					{displaySize.width > 0 && displaySize.height > 0 && (
						// biome-ignore lint/a11y/useSemanticElements: Text overlay drag handle
						<div
							role="button"
							tabIndex={0}
							className="absolute cursor-move border-2 border-primary bg-primary/10 shadow-lg"
							style={{
								left: overlayPixels.x,
								top: overlayPixels.y,
								width: overlayPixels.width,
								height: overlayPixels.height,
								touchAction: "none",
							}}
							onPointerDown={(event) => beginGesture(event, "move")}
							onKeyDown={() => {}}
							data-testid="text-overlay-box"
						>
							<div
								className="absolute inset-0 flex flex-col items-center justify-center overflow-hidden text-center"
								style={{
									padding,
									backgroundColor: style.bgBox
										? `${style.bgBoxColor}99`
										: "transparent",
									color: style.color,
									fontFamily: style.fontFamily,
									fontWeight: style.bold ? 700 : 400,
									fontStyle: style.italic ? "italic" : "normal",
									fontSize: textLayout.fontSize,
									lineHeight: `${textLayout.lineHeight}px`,
								}}
							>
								{textLayout.lines.map((line, index) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: Wrapped text lines have no stable IDs
									<div key={`${line}-${index}`} className="whitespace-pre">
										{line || "\u00a0"}
									</div>
								))}
							</div>
							{/* biome-ignore lint/a11y/useSemanticElements: Text overlay resize handle */}
							<div
								role="button"
								tabIndex={0}
								className="absolute -right-2 -bottom-2 h-4 w-4 rounded-full border-2 border-base-100/70 bg-primary shadow-md cursor-se-resize"
								onPointerDown={(event) => beginGesture(event, "resize")}
								onKeyDown={() => {}}
								data-testid="text-overlay-resize-handle"
							/>
						</div>
					)}
				</div>
			</div>
			<button
				type="button"
				className={`btn btn-primary btn-lg ${isProcessing ? "btn-disabled" : ""}`}
				onClick={applyText}
				disabled={isProcessing}
				data-testid="run-button"
			>
				{isProcessing ? (
					<>
						<span className="loading loading-spinner loading-sm" />{" "}
						Processing...
					</>
				) : (
					"Apply Text"
				)}
			</button>
		</div>
	)
}
