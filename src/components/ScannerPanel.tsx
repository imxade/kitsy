import { useCallback, useEffect, useRef, useState } from "react"
import {
	type CameraDevice,
	type CameraFacingMode,
	enumerateVideoDevices,
	requestCameraStream,
} from "../lib/camera"
import type { ProcessedFile } from "../lib/image-processor"
import { imagesToPdf } from "../lib/pdf-processor"
import Icon from "./Icon"
import ScannerCropEditor from "./ScannerCropEditor"

interface ScannerPanelProps {
	onResultsChange: (results: ProcessedFile[] | null) => void
	onErrorChange: (error: string | null) => void
}

function ScanPagePreview({ file }: { file: File }) {
	const [url, setUrl] = useState<string | null>(null)

	useEffect(() => {
		if (typeof URL.createObjectURL !== "function") return
		const objectUrl = URL.createObjectURL(file)
		setUrl(objectUrl)
		return () => URL.revokeObjectURL(objectUrl)
	}, [file])

	return url ? (
		<img
			src={url}
			alt=""
			className="h-16 w-16 rounded-box bg-base-300 object-cover"
		/>
	) : (
		<div className="h-16 w-16 rounded-box bg-base-300" aria-hidden="true" />
	)
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
	const [cameraAspectRatio, setCameraAspectRatio] = useState<string | null>(
		null,
	)
	const [previewReady, setPreviewReady] = useState(false)
	const [creating, setCreating] = useState(false)
	const [cropPageIndex, setCropPageIndex] = useState<number | null>(null)
	const [videoDevices, setVideoDevices] = useState<CameraDevice[]>([])
	const [facingMode, setFacingMode] = useState<CameraFacingMode>("environment")
	const [selectedDeviceId, setSelectedDeviceId] = useState("")

	const refreshDevices = useCallback(async () => {
		const devices = await enumerateVideoDevices()
		setVideoDevices(devices)
		return devices
	}, [])

	useEffect(() => {
		void refreshDevices()
		if (
			typeof navigator === "undefined" ||
			!navigator.mediaDevices?.addEventListener
		) {
			return
		}
		const handleDeviceChange = () => void refreshDevices()
		navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange)
		return () => {
			navigator.mediaDevices.removeEventListener(
				"devicechange",
				handleDeviceChange,
			)
		}
	}, [refreshDevices])

	const updateCameraAspectRatio = useCallback((video: HTMLVideoElement) => {
		if (video.videoWidth && video.videoHeight) {
			setCameraAspectRatio(`${video.videoWidth} / ${video.videoHeight}`)
		}
	}, [])

	const stopCamera = useCallback(() => {
		streamRef.current?.getTracks().forEach((track) => {
			track.stop()
		})
		streamRef.current = null
		if (videoRef.current) videoRef.current.srcObject = null
		setCameraActive(false)
		setPreviewReady(false)
		setCameraAspectRatio(null)
	}, [])

	useEffect(() => stopCamera, [stopCamera])

	useEffect(() => {
		if (!cameraActive || !streamRef.current || !videoRef.current) return

		const video = videoRef.current
		video.muted = true
		video.playsInline = true
		video.srcObject = streamRef.current
		void video.play().catch(() => undefined)
		if (video.videoWidth && video.videoHeight) {
			updateCameraAspectRatio(video)
		}
	}, [cameraActive, updateCameraAspectRatio])

	const startCamera = async (
		targetDeviceId = selectedDeviceId,
		targetFacing = facingMode,
	) => {
		onErrorChange(null)
		if (!navigator.mediaDevices?.getUserMedia) {
			onErrorChange("Camera capture is not available in this browser.")
			return
		}
		try {
			stopCamera()
			const stream = await requestCameraStream(
				targetDeviceId || null,
				targetFacing,
				false,
			)
			streamRef.current = stream
			const track = stream.getVideoTracks?.()?.[0]
			const settings = track?.getSettings?.()
			if (settings?.width && settings?.height) {
				setCameraAspectRatio(`${settings.width} / ${settings.height}`)
			}
			if (
				settings?.facingMode === "user" ||
				settings?.facingMode === "environment"
			) {
				setFacingMode(settings.facingMode)
			}
			if (settings?.deviceId) {
				setSelectedDeviceId(settings.deviceId)
			}
			if (videoRef.current) {
				videoRef.current.muted = true
				videoRef.current.playsInline = true
				videoRef.current.srcObject = stream
				void videoRef.current.play().catch(() => undefined)
				if (videoRef.current.videoWidth && videoRef.current.videoHeight) {
					updateCameraAspectRatio(videoRef.current)
				}
			}
			setPreviewReady(true)
			setCameraActive(true)
			void refreshDevices()
		} catch (error) {
			onErrorChange(
				error instanceof Error
					? `Could not start camera: ${error.message}`
					: "Could not start camera.",
			)
		}
	}

	const flipCamera = async () => {
		if (videoDevices.length > 1) {
			const currentIndex = videoDevices.findIndex(
				(d) => d.deviceId === selectedDeviceId,
			)
			const nextIndex =
				currentIndex >= 0 ? (currentIndex + 1) % videoDevices.length : 1
			const nextDev = videoDevices[nextIndex]
			setSelectedDeviceId(nextDev.deviceId)
			const nextFacing =
				nextDev.facingMode ||
				(facingMode === "environment" ? "user" : "environment")
			setFacingMode(nextFacing)
			if (cameraActive) {
				await startCamera(nextDev.deviceId, nextFacing)
			}
		} else {
			const nextFacing: CameraFacingMode =
				facingMode === "environment" ? "user" : "environment"
			setFacingMode(nextFacing)
			const matching = videoDevices.find((d) => d.facingMode === nextFacing)
			const nextDeviceId = matching ? matching.deviceId : ""
			setSelectedDeviceId(nextDeviceId)
			if (cameraActive) {
				await startCamera(nextDeviceId, nextFacing)
			}
		}
	}

	const handleCameraSelect = async (value: string) => {
		const dev = videoDevices.find((d) => d.deviceId === value)
		setSelectedDeviceId(value)
		const nextFacing = dev?.facingMode || facingMode
		if (dev?.facingMode) setFacingMode(dev.facingMode)
		if (cameraActive) {
			await startCamera(value, nextFacing)
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
		setCropPageIndex((current) => {
			if (current === index) return index + direction
			if (current === index + direction) return index
			return current
		})
		onResultsChange(null)
	}

	const removePage = (index: number) => {
		setPages((current) =>
			current.filter((_, currentIndex) => currentIndex !== index),
		)
		setCropPageIndex((current) => {
			if (current === index) return null
			if (current !== null && current > index) return current - 1
			return current
		})
		onResultsChange(null)
	}

	const replaceCroppedPage = (index: number, file: File) => {
		setPages((current) =>
			current.map((currentFile, currentIndex) =>
				currentIndex === index ? file : currentFile,
			),
		)
		setCropPageIndex(null)
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

				{!cameraActive ? (
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div className="flex flex-wrap items-center gap-2">
							<button
								type="button"
								className="btn btn-primary btn-sm rounded-full gap-2 px-4 shadow-sm"
								onClick={() => startCamera()}
							>
								<Icon name="camera" size={16} />
								<span>Start camera</span>
							</button>
							<button
								type="button"
								className="btn btn-outline btn-sm rounded-full gap-2 px-4"
								onClick={() => fileInputRef.current?.click()}
							>
								<Icon name="photo-plus" size={16} />
								<span>Add images</span>
							</button>
						</div>

						{/* Camera selector before starting camera */}
						<div className="flex items-center gap-1.5 text-xs text-base-content/70">
							<Icon name="camera" size={14} className="opacity-60" />
							<select
								aria-label="Select camera"
								data-testid="scanner-camera-select"
								className="select select-bordered select-xs rounded-full font-medium"
								value={selectedDeviceId || (videoDevices[0]?.deviceId ?? "")}
								onChange={(e) => void handleCameraSelect(e.target.value)}
							>
								{videoDevices.length === 0 ? (
									<option value="">Default Camera</option>
								) : (
									videoDevices.map((device, idx) => (
										<option
											key={device.deviceId || idx}
											value={device.deviceId}
										>
											{device.label}
										</option>
									))
								)}
							</select>
						</div>
					</div>
				) : (
					<div className="flex flex-col gap-3">
						{/* Viewfinder container */}
						<div className="relative overflow-hidden rounded-2xl border border-base-content/10 bg-neutral shadow-lg">
							{/* Top Bar inside Viewfinder */}
							<div className="absolute top-3 inset-x-3 z-10 flex items-center justify-between pointer-events-auto">
								<div className="flex items-center gap-1.5 rounded-full bg-black/60 backdrop-blur-md px-3 py-1 text-white border border-white/10 shadow-sm">
									<Icon name="camera" size={14} className="text-white/80" />
									<select
										aria-label="Select camera"
										data-testid="scanner-camera-select-active"
										className="bg-transparent text-xs font-semibold text-white focus:outline-none cursor-pointer pr-1"
										value={
											selectedDeviceId || (videoDevices[0]?.deviceId ?? "")
										}
										onChange={(e) => void handleCameraSelect(e.target.value)}
									>
										{videoDevices.length === 0 ? (
											<option
												value=""
												className="bg-neutral text-neutral-content"
											>
												Default Camera
											</option>
										) : (
											videoDevices.map((device, idx) => (
												<option
													key={device.deviceId || idx}
													value={device.deviceId}
													className="bg-neutral text-neutral-content"
												>
													{device.label}
												</option>
											))
										)}
									</select>
								</div>

								<button
									type="button"
									className="btn btn-circle btn-xs bg-black/60 hover:bg-black/80 backdrop-blur-md border border-white/10 text-white shadow-sm"
									onClick={stopCamera}
									aria-label="Close camera"
									title="Close camera"
								>
									<Icon name="close" size={14} />
								</button>
							</div>

							<video
								ref={videoRef}
								autoPlay
								muted
								playsInline
								className="block h-auto w-full"
								style={
									cameraAspectRatio
										? { aspectRatio: `${cameraAspectRatio}` }
										: undefined
								}
								onLoadedMetadata={(event) => {
									updateCameraAspectRatio(event.currentTarget)
									setPreviewReady(true)
								}}
								onLoadedData={(event) => {
									updateCameraAspectRatio(event.currentTarget)
								}}
								onResize={(event) => {
									updateCameraAspectRatio(event.currentTarget)
								}}
								data-testid="scanner-preview"
							/>
						</div>

						{/* Bottom Camera Action Dock */}
						<div className="flex items-center justify-between rounded-3xl bg-neutral/95 backdrop-blur-md px-6 py-3 border border-white/10 text-neutral-content shadow-xl">
							{/* Left: Gallery / Add Images circular button */}
							<div className="flex flex-col items-center gap-1">
								<button
									type="button"
									className="relative flex h-12 w-12 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white transition-all hover:bg-white/20 active:scale-90"
									onClick={() => fileInputRef.current?.click()}
									aria-label="Add images"
									title="Add images from files"
								>
									<Icon name="photo-plus" size={22} />
									{pages.length > 0 && (
										<span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-content shadow-sm">
											{pages.length}
										</span>
									)}
								</button>
								<span className="text-[10px] font-medium text-white/70">
									Gallery
								</span>
							</div>

							{/* Center: Real Circular Camera Shutter Button */}
							<div className="flex flex-col items-center gap-1">
								<button
									type="button"
									className="group relative flex h-18 w-18 items-center justify-center rounded-full border-4 border-white/90 bg-transparent p-1 shadow-2xl transition-all duration-150 active:scale-90 disabled:opacity-40"
									onClick={capturePage}
									disabled={!previewReady}
									aria-label="Capture page"
									title="Capture page"
									data-testid="scanner-capture-page"
								>
									<span className="h-full w-full rounded-full bg-white transition-all duration-150 group-hover:scale-95 group-active:scale-85 shadow-inner" />
								</button>
								<span className="text-[10px] font-medium text-white/70">
									Capture
								</span>
							</div>

							{/* Right: Flip Camera Button */}
							<div className="flex flex-col items-center gap-1">
								<button
									type="button"
									className="flex h-12 w-12 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white transition-all hover:bg-white/20 active:scale-90"
									onClick={flipCamera}
									aria-label="Switch camera"
									title="Switch camera (flip front/back)"
									data-testid="scanner-flip-camera"
								>
									<Icon name="camera-rotate" size={22} />
								</button>
								<span className="text-[10px] font-medium text-white/70">
									Flip
								</span>
							</div>
						</div>
					</div>
				)}
				{pages.length > 0 && (
					<div className="flex flex-col gap-2">
						{pages.map((page, index) => (
							<div
								key={`${page.name}-${index}`}
								className="flex items-center gap-2 rounded-box bg-base-200 px-3 py-2"
							>
								<ScanPagePreview file={page} />
								<span className="min-w-0 flex-1 truncate text-sm">
									{index + 1}. {page.name}
								</span>
								<button
									type="button"
									className="btn btn-outline btn-xs"
									onClick={() => setCropPageIndex(index)}
								>
									Crop
								</button>
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
									onClick={() => removePage(index)}
								>
									<Icon name="close" size={14} />
								</button>
							</div>
						))}
						{cropPageIndex !== null && pages[cropPageIndex] && (
							<ScannerCropEditor
								file={pages[cropPageIndex]}
								onApply={(file) => replaceCroppedPage(cropPageIndex, file)}
								onCancel={() => setCropPageIndex(null)}
								onError={onErrorChange}
							/>
						)}
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
