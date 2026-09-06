import { useCallback, useEffect, useRef, useState } from "react"
import { imagesToPdf } from "../lib/pdf-processor"
import type { ProcessedFile } from "../lib/image-processor"
import Icon from "./Icon"

interface ScannerPanelProps {
	onResultsChange: (results: ProcessedFile[] | null) => void
	onErrorChange: (error: string | null) => void
}

export default function ScannerPanel({
	onResultsChange,
	onErrorChange,
}: ScannerPanelProps) {
	const videoRef = useRef<HTMLVideoElement>(null)
	const fileInputRef = useRef<HTMLInputElement>(null)
	const streamRef = useRef<MediaStream | null>(null)
	const [pages, setPages] = useState<File[]>([])
	const [cameraActive, setCameraActive] = useState(false)
	const [previewReady, setPreviewReady] = useState(false)
	const [creating, setCreating] = useState(false)

	const stopCamera = useCallback(() => {
		streamRef.current?.getTracks().forEach((track) => {
			track.stop()
		})
		streamRef.current = null
		if (videoRef.current) videoRef.current.srcObject = null
		setCameraActive(false)
		setPreviewReady(false)
	}, [])

	useEffect(() => stopCamera, [stopCamera])

	useEffect(() => {
		if (!cameraActive || !streamRef.current || !videoRef.current) return

		const video = videoRef.current
		video.muted = true
		video.playsInline = true
		video.srcObject = streamRef.current
		void video.play().catch(() => undefined)
	}, [cameraActive])

	const startCamera = async () => {
		onErrorChange(null)
		if (!navigator.mediaDevices?.getUserMedia) {
			onErrorChange("Camera capture is not available in this browser.")
			return
		}
		try {
			stopCamera()
			const stream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: { ideal: "environment" } },
				audio: false,
			})
			streamRef.current = stream
			setPreviewReady(false)
			setCameraActive(true)
		} catch (error) {
			onErrorChange(
				error instanceof Error
					? `Could not start camera: ${error.message}`
					: "Could not start camera.",
			)
		}
	}

	const capturePage = async () => {
		const video = videoRef.current
		if (
			!previewReady ||
			!video ||
			video.videoWidth === 0 ||
			video.videoHeight === 0
		) {
			onErrorChange("Wait for the camera preview before capturing a page.")
			return
		}
		const canvas = document.createElement("canvas")
		canvas.width = video.videoWidth
		canvas.height = video.videoHeight
		const context = canvas.getContext("2d")
		if (!context) return
		context.drawImage(video, 0, 0)
		const blob = await new Promise<Blob | null>((resolve) =>
			canvas.toBlob(resolve, "image/jpeg", 0.92),
		)
		if (!blob) {
			onErrorChange("Could not capture the camera image.")
			return
		}
		setPages((current) => [
			...current,
			new File([blob], `scan-${current.length + 1}.jpg`, {
				type: "image/jpeg",
			}),
		])
		onResultsChange(null)
	}

	const appendFiles = (files: File[]) => {
		setPages((current) => [...current, ...files])
		onResultsChange(null)
		onErrorChange(null)
	}

	const movePage = (index: number, direction: -1 | 1) => {
		setPages((current) => {
			const next = [...current]
			const target = index + direction
			if (target < 0 || target >= next.length) return current
			;[next[index], next[target]] = [next[target], next[index]]
			return next
		})
		onResultsChange(null)
	}

	const createPdf = async () => {
		if (pages.length === 0) return
		setCreating(true)
		onErrorChange(null)
		onResultsChange(null)
		try {
			onResultsChange([await imagesToPdf(pages)])
		} catch (error) {
			onErrorChange(
				error instanceof Error ? error.message : "Could not create PDF.",
			)
		} finally {
			setCreating(false)
		}
	}

	return (
		<div
			className="card rounded-3xl border border-base-content/8 bg-base-100/90 shadow-sm"
			data-testid="scanner-mounted"
		>
			<div className="card-body gap-4 p-5">
				<div className="flex flex-wrap items-center gap-2">
					<button
						type="button"
						className="btn btn-primary btn-sm"
						onClick={startCamera}
					>
						Start camera
					</button>
					{cameraActive && (
						<>
							<button
								type="button"
								className="btn btn-outline btn-sm"
								onClick={capturePage}
								disabled={!previewReady}
							>
								Capture page
							</button>
							<button
								type="button"
								className="btn btn-ghost btn-sm"
								onClick={stopCamera}
							>
								Stop camera
							</button>
						</>
					)}
					<button
						type="button"
						className="btn btn-outline btn-sm"
						onClick={() => fileInputRef.current?.click()}
					>
						Add images
					</button>
					<input
						ref={fileInputRef}
						data-testid="scanner-image-input"
						type="file"
						accept="image/*"
						multiple
						className="hidden"
						onChange={(event) => {
							appendFiles(Array.from(event.target.files ?? []))
							event.target.value = ""
						}}
					/>
				</div>
				{cameraActive && (
					<div className="overflow-hidden rounded-2xl border border-base-content/10 bg-neutral">
						<video
							ref={videoRef}
							autoPlay
							muted
							playsInline
							className="aspect-video w-full object-cover"
							onLoadedMetadata={() => setPreviewReady(true)}
							data-testid="scanner-preview"
						/>
					</div>
				)}
				{pages.length > 0 && (
					<div className="flex flex-col gap-2">
						{pages.map((page, index) => (
							<div
								key={`${page.name}-${index}`}
								className="flex items-center gap-2 rounded-box bg-base-200 px-3 py-2"
							>
								<span className="min-w-0 flex-1 truncate text-sm">
									{index + 1}. {page.name}
								</span>
								<button
									type="button"
									className="btn btn-ghost btn-xs"
									aria-label="Move page up"
									onClick={() => movePage(index, -1)}
									disabled={index === 0}
								>
									<Icon name="up" size={14} />
								</button>
								<button
									type="button"
									className="btn btn-ghost btn-xs"
									aria-label="Move page down"
									onClick={() => movePage(index, 1)}
									disabled={index === pages.length - 1}
								>
									<Icon name="down" size={14} />
								</button>
								<button
									type="button"
									className="btn btn-ghost btn-xs"
									aria-label="Remove page"
									onClick={() => {
										setPages((current) =>
											current.filter(
												(_, currentIndex) => currentIndex !== index,
											),
										)
										onResultsChange(null)
									}}
								>
									<Icon name="close" size={14} />
								</button>
							</div>
						))}
						<button
							type="button"
							className="btn btn-primary"
							onClick={createPdf}
							disabled={creating}
							data-testid="scanner-create-pdf"
						>
							{creating ? "Creating PDF..." : "Create PDF"}
						</button>
					</div>
				)}
			</div>
		</div>
	)
}
