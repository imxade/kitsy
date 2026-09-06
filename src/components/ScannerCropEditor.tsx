import { useEffect, useRef, useState } from "react"
import {
	perspectiveCropImage,
	type PerspectiveCropPoint,
} from "../lib/image-processor"

interface ScannerCropEditorProps {
	file: File
	onApply: (file: File) => void
	onCancel: () => void
	onError: (message: string) => void
}

const CORNER_LABELS = ["Top left", "Top right", "Bottom right", "Bottom left"]

function clampPoint(
	point: PerspectiveCropPoint,
	imageWidth: number,
	imageHeight: number,
): PerspectiveCropPoint {
	return {
		x: Math.min(Math.max(Math.round(point.x), 0), imageWidth - 1),
		y: Math.min(Math.max(Math.round(point.y), 0), imageHeight - 1),
	}
}

function initialCorners(width: number, height: number): PerspectiveCropPoint[] {
	return [
		{ x: 0, y: 0 },
		{ x: width - 1, y: 0 },
		{ x: width - 1, y: height - 1 },
		{ x: 0, y: height - 1 },
	]
}

export default function ScannerCropEditor({
	file,
	onApply,
	onCancel,
	onError,
}: ScannerCropEditorProps) {
	const imageRef = useRef<HTMLImageElement>(null)
	const [url, setUrl] = useState<string | null>(null)
	const [imageSize, setImageSize] = useState({ width: 0, height: 0 })
	const [corners, setCorners] = useState<PerspectiveCropPoint[]>([])
	const [activeCorner, setActiveCorner] = useState<number | null>(null)
	const [isCropping, setIsCropping] = useState(false)
	const imageSizeRef = useRef(imageSize)

	useEffect(() => {
		imageSizeRef.current = imageSize
	}, [imageSize])

	useEffect(() => {
		const objectUrl = URL.createObjectURL(file)
		setUrl(objectUrl)
		setImageSize({ width: 0, height: 0 })
		setCorners([])
		return () => URL.revokeObjectURL(objectUrl)
	}, [file])

	useEffect(() => {
		if (activeCorner === null) return

		const moveCorner = (event: PointerEvent) => {
			const image = imageRef.current
			const { width, height } = imageSizeRef.current
			if (!image || width === 0 || height === 0) return
			if (event.cancelable) event.preventDefault()
			const bounds = image.getBoundingClientRect()
			const point = clampPoint(
				{
					x: ((event.clientX - bounds.left) / bounds.width) * width,
					y: ((event.clientY - bounds.top) / bounds.height) * height,
				},
				width,
				height,
			)
			setCorners((current) =>
				current.map((corner, index) =>
					index === activeCorner ? point : corner,
				),
			)
		}
		const finishGesture = () => setActiveCorner(null)
		window.addEventListener("pointermove", moveCorner, { passive: false })
		window.addEventListener("pointerup", finishGesture)
		window.addEventListener("pointercancel", finishGesture)
		return () => {
			window.removeEventListener("pointermove", moveCorner)
			window.removeEventListener("pointerup", finishGesture)
			window.removeEventListener("pointercancel", finishGesture)
		}
	}, [activeCorner])

	const setCornerValue = (
		index: number,
		axis: keyof PerspectiveCropPoint,
		value: number,
	) => {
		setCorners((current) =>
			current.map((point, pointIndex) =>
				pointIndex === index
					? clampPoint(
							{ ...point, [axis]: Number.isFinite(value) ? value : 0 },
							imageSize.width,
							imageSize.height,
						)
					: point,
			),
		)
	}

	const apply = async () => {
		if (corners.length !== 4) return
		setIsCropping(true)
		onError("")
		try {
			const next = await perspectiveCropImage(file, corners)
			onApply(new File([next.blob], next.name, { type: next.blob.type }))
		} catch (error) {
			onError(
				error instanceof Error ? error.message : "Could not flatten this page.",
			)
		} finally {
			setIsCropping(false)
		}
	}

	const hasImage = imageSize.width > 0 && imageSize.height > 0
	const polygon = corners
		.map(
			(point) =>
				`${(point.x / imageSize.width) * 100},${(point.y / imageSize.height) * 100}`,
		)
		.join(" ")

	return (
		<div className="rounded-2xl border border-base-content/10 bg-base-200/40 p-4">
			<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
				<div>
					<h3 className="font-semibold">Straighten selected page</h3>
					<p className="text-sm text-base-content/60">
						Place each corner on the document. The selected shape is flattened
						into a rectangle.
					</p>
				</div>
				<button
					type="button"
					className="btn btn-ghost btn-sm"
					onClick={onCancel}
				>
					Cancel
				</button>
			</div>

			<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
				<div className="overflow-auto rounded-box bg-neutral p-2">
					<div className="relative mx-auto w-fit max-w-full">
						{url && (
							<img
								ref={imageRef}
								src={url}
								alt="Selected scan crop preview"
								className="block max-h-[28rem] max-w-full select-none"
								onLoad={(event) => {
									const image = event.currentTarget
									const width = image.naturalWidth
									const height = image.naturalHeight
									setImageSize({ width, height })
									setCorners(initialCorners(width, height))
								}}
							/>
						)}
						{hasImage && corners.length === 4 && (
							<>
								<svg
									className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
									viewBox="0 0 100 100"
									preserveAspectRatio="none"
									aria-hidden="true"
								>
									<polygon
										points={polygon}
										className="fill-primary/10 stroke-primary"
										strokeWidth="0.5"
									/>
								</svg>
								{corners.map((point, index) => (
									// biome-ignore lint/a11y/useSemanticElements: Pointer-operated document corner
									<div
										key={CORNER_LABELS[index]}
										role="button"
										tabIndex={0}
										aria-label={`Move ${CORNER_LABELS[index]} corner`}
										className="absolute -ml-3 -mt-3 h-6 w-6 cursor-grab rounded-full border-2 border-base-100 bg-primary shadow-md active:cursor-grabbing"
										style={{
											left: `${(point.x / imageSize.width) * 100}%`,
											top: `${(point.y / imageSize.height) * 100}%`,
											touchAction: "none",
										}}
										onPointerDown={(event) => {
											event.preventDefault()
											setActiveCorner(index)
										}}
										onKeyDown={() => {}}
										data-testid={`scanner-crop-corner-${index}`}
									/>
								))}
							</>
						)}
					</div>
				</div>

				<div className="grid grid-cols-2 gap-2 content-start">
					{corners.map((point, index) => (
						<div
							key={CORNER_LABELS[index]}
							className="col-span-2 grid grid-cols-[1fr_1fr_1fr] gap-2"
						>
							<span className="self-center text-xs text-base-content/70">
								{CORNER_LABELS[index]}
							</span>
							<input
								aria-label={`${CORNER_LABELS[index]} X`}
								type="number"
								className="input input-bordered input-sm w-full"
								min={0}
								value={point.x}
								disabled={!hasImage || isCropping}
								onChange={(event) =>
									setCornerValue(index, "x", Number(event.target.value))
								}
							/>
							<input
								aria-label={`${CORNER_LABELS[index]} Y`}
								type="number"
								className="input input-bordered input-sm w-full"
								min={0}
								value={point.y}
								disabled={!hasImage || isCropping}
								onChange={(event) =>
									setCornerValue(index, "y", Number(event.target.value))
								}
							/>
						</div>
					))}
					<button
						type="button"
						className="btn btn-ghost btn-sm col-span-2"
						disabled={!hasImage || isCropping}
						onClick={() =>
							setCorners(initialCorners(imageSize.width, imageSize.height))
						}
					>
						Reset corners
					</button>
					<button
						type="button"
						className="btn btn-primary col-span-2"
						disabled={!hasImage || isCropping}
						onClick={apply}
						data-testid="scanner-apply-crop"
					>
						{isCropping ? "Flattening..." : "Flatten page"}
					</button>
				</div>
			</div>
		</div>
	)
}
