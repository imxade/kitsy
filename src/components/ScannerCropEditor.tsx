import { useEffect, useRef, useState } from "react"
import { cropImage } from "../lib/image-processor"

interface CropBox {
	x: number
	y: number
	width: number
	height: number
}

interface ScannerCropEditorProps {
	file: File
	onApply: (file: File) => void
	onCancel: () => void
	onError: (message: string) => void
}

function clampCrop(
	crop: CropBox,
	imageWidth: number,
	imageHeight: number,
): CropBox {
	const width = Math.min(Math.max(Math.round(crop.width), 1), imageWidth)
	const height = Math.min(Math.max(Math.round(crop.height), 1), imageHeight)
	return {
		x: Math.min(Math.max(Math.round(crop.x), 0), imageWidth - width),
		y: Math.min(Math.max(Math.round(crop.y), 0), imageHeight - height),
		width,
		height,
	}
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
	const [crop, setCrop] = useState<CropBox>({
		x: 0,
		y: 0,
		width: 0,
		height: 0,
	})
	const [isCropping, setIsCropping] = useState(false)

	useEffect(() => {
		const objectUrl = URL.createObjectURL(file)
		setUrl(objectUrl)
		setImageSize({ width: 0, height: 0 })
		setCrop({ x: 0, y: 0, width: 0, height: 0 })
		return () => URL.revokeObjectURL(objectUrl)
	}, [file])

	const setCropValue = (key: keyof CropBox, value: number) => {
		setCrop((current) =>
			clampCrop(
				{ ...current, [key]: Number.isFinite(value) ? value : 0 },
				imageSize.width,
				imageSize.height,
			),
		)
	}

	const apply = async () => {
		if (imageSize.width === 0 || imageSize.height === 0) return
		setIsCropping(true)
		onError("")
		try {
			const next = await cropImage(
				file,
				crop.x,
				crop.y,
				crop.width,
				crop.height,
			)
			onApply(new File([next.blob], next.name, { type: next.blob.type }))
		} catch (error) {
			onError(
				error instanceof Error ? error.message : "Could not crop this page.",
			)
		} finally {
			setIsCropping(false)
		}
	}

	const displayWidth = imageRef.current?.clientWidth ?? 0
	const displayHeight = imageRef.current?.clientHeight ?? 0
	const hasImage = imageSize.width > 0 && imageSize.height > 0

	return (
		<div className="rounded-2xl border border-base-content/10 bg-base-200/40 p-4">
			<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
				<div>
					<h3 className="font-semibold">Crop selected page</h3>
					<p className="text-sm text-base-content/60">
						Set the crop bounds in source-image pixels.
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
									setCrop({ x: 0, y: 0, width, height })
								}}
							/>
						)}
						{hasImage && displayWidth > 0 && displayHeight > 0 && (
							<div
								className="pointer-events-none absolute border-2 border-primary bg-primary/10"
								style={{
									left: `${(crop.x / imageSize.width) * 100}%`,
									top: `${(crop.y / imageSize.height) * 100}%`,
									width: `${(crop.width / imageSize.width) * 100}%`,
									height: `${(crop.height / imageSize.height) * 100}%`,
								}}
							/>
						)}
					</div>
				</div>

				<div className="grid grid-cols-2 gap-2 content-start">
					{(
						[
							["x", "X"],
							["y", "Y"],
							["width", "Width"],
							["height", "Height"],
						] as const
					).map(([key, label]) => (
						<label key={key} className="form-control">
							<span className="label-text text-xs">{label} (px)</span>
							<input
								aria-label={`Crop ${label}`}
								type="number"
								className="input input-bordered input-sm w-full"
								min={key === "width" || key === "height" ? 1 : 0}
								value={crop[key] || ""}
								disabled={!hasImage || isCropping}
								onChange={(event) =>
									setCropValue(key, Number(event.target.value))
								}
							/>
						</label>
					))}
					<button
						type="button"
						className="btn btn-primary col-span-2 mt-2"
						disabled={!hasImage || isCropping}
						onClick={apply}
						data-testid="scanner-apply-crop"
					>
						{isCropping ? "Cropping..." : "Apply crop"}
					</button>
				</div>
			</div>
		</div>
	)
}
