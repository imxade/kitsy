import { useCallback, useEffect, useRef, useState } from "react"
import {
	type CameraDevice,
	type CameraFacingMode,
	enumerateVideoDevices,
	requestCameraStream,
} from "../lib/camera"
import type { ProcessedFile } from "../lib/image-processor"
import {
	DEFAULT_OVERLAY_RECT,
	buildRecordingName,
	clampOverlayRect,
	getPreferredRecordingMimeType,
	isDesktopViewport,
	type OverlayRect,
	type RecorderKind,
} from "../lib/recorder"
import Icon from "./Icon"

interface RecorderPanelProps {
	kind: RecorderKind
	onResultsChange: (results: ProcessedFile[] | null) => void
	onErrorChange: (message: string | null) => void
}

declare global {
	interface Window {
		__KITSY_RECORDER_E2E__?: {
			start: (kind: RecorderKind) => ProcessedFile | Promise<ProcessedFile>
		}
	}
}

type DragMode = "move" | "resize" | null

function stopStream(stream: MediaStream | null) {
	for (const track of stream?.getTracks() || []) track.stop()
}

async function waitForPlayback(video: HTMLVideoElement) {
	video.muted = true
	video.playsInline = true
	await video.play().catch(() => undefined)
}

export default function RecorderPanel({
	kind,
	onResultsChange,
	onErrorChange,
}: RecorderPanelProps) {
	const [isRecording, setIsRecording] = useState(false)
	const [isClientReady, setIsClientReady] = useState(false)
	const [status, setStatus] = useState("Ready to record.")
	const [elapsedMs, setElapsedMs] = useState(0)
	const [includeCamera, setIncludeCamera] = useState(false)
	const [includeMicrophone, setIncludeMicrophone] = useState(true)
	const [includeSystemAudio, setIncludeSystemAudio] = useState(false)
	const [overlayRect, setOverlayRect] =
		useState<OverlayRect>(DEFAULT_OVERLAY_RECT)
	const [cameraAspectRatio, setCameraAspectRatio] = useState<string | null>(
		null,
	)
	const [screenAspectRatio, setScreenAspectRatio] = useState<string | null>(
		null,
	)
	const [videoDevices, setVideoDevices] = useState<CameraDevice[]>([])
	const [facingMode, setFacingMode] = useState<CameraFacingMode>("user")
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

	const overlayRectRef = useRef(DEFAULT_OVERLAY_RECT)
	const overlayElementRef = useRef<HTMLDivElement>(null)
	const overlayAnimationFrameRef = useRef<number | null>(null)
	const pendingOverlayRectRef = useRef<OverlayRect | null>(null)

	const selectedDeviceIdRef = useRef(selectedDeviceId)
	const facingModeRef = useRef(facingMode)
	const includeMicrophoneRef = useRef(includeMicrophone)

	useEffect(() => {
		selectedDeviceIdRef.current = selectedDeviceId
	}, [selectedDeviceId])

	useEffect(() => {
		facingModeRef.current = facingMode
	}, [facingMode])

	useEffect(() => {
		includeMicrophoneRef.current = includeMicrophone
	}, [includeMicrophone])

	const updateCameraAspectRatio = useCallback((video: HTMLVideoElement) => {
		if (video.videoWidth && video.videoHeight) {
			setCameraAspectRatio(`${video.videoWidth} / ${video.videoHeight}`)
		}
	}, [])

	const cameraRecordCanvasRef = useRef<HTMLCanvasElement | null>(null)
	const cameraRecordRafRef = useRef<number | null>(null)
	const micStreamRef = useRef<MediaStream | null>(null)
	const previewPromiseRef = useRef<Promise<MediaStream | null> | null>(null)

	const startCameraPreview = useCallback(
		async (targetDeviceId?: string, targetFacing?: CameraFacingMode) => {
			if (
				typeof navigator === "undefined" ||
				!navigator.mediaDevices?.getUserMedia ||
				window.__KITSY_RECORDER_E2E__
			) {
				return null
			}
			const deviceId = targetDeviceId ?? selectedDeviceIdRef.current
			const facing = targetFacing ?? facingModeRef.current
			const promise = (async () => {
				try {
					const stream = await requestCameraStream(
						deviceId || null,
						facing,
						includeMicrophoneRef.current,
					)
					cameraStreamRef.current = stream
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
						facingModeRef.current = settings.facingMode
					}
					if (settings?.deviceId) {
						setSelectedDeviceId(settings.deviceId)
						selectedDeviceIdRef.current = settings.deviceId
					}
					if (previewVideoRef.current) {
						previewVideoRef.current.srcObject = stream
						previewVideoRef.current.muted = true
						previewVideoRef.current.playsInline = true
						void previewVideoRef.current.play().catch(() => undefined)
						if (
							previewVideoRef.current.videoWidth &&
							previewVideoRef.current.videoHeight
						) {
							updateCameraAspectRatio(previewVideoRef.current)
						}
					}
					void refreshDevices()
					return stream
				} catch (error) {
					onErrorChange(
						error instanceof Error
							? `Camera access needed: ${error.message}`
							: "Could not access camera.",
					)
					return null
				}
			})()
			previewPromiseRef.current = promise
			return promise
		},
		[onErrorChange, refreshDevices, updateCameraAspectRatio],
	)

	useEffect(() => {
		if (kind === "camera") {
			void startCameraPreview()
		} else {
			stopStream(cameraStreamRef.current)
			cameraStreamRef.current = null
			if (previewVideoRef.current) {
				previewVideoRef.current.srcObject = null
			}
			setCameraAspectRatio(null)
		}
	}, [kind, startCameraPreview])

	const switchCamera = async (
		targetDeviceId: string,
		targetFacing: CameraFacingMode,
	) => {
		setSelectedDeviceId(targetDeviceId)
		setFacingMode(targetFacing)

		try {
			const newStream = await requestCameraStream(
				targetDeviceId || null,
				targetFacing,
				false,
			)
			const newVideoTrack = newStream.getVideoTracks?.()?.[0]
			const settings = newVideoTrack?.getSettings?.()
			if (settings?.width && settings?.height) {
				setCameraAspectRatio(`${settings.width} / ${settings.height}`)
			}

			if (kind === "camera") {
				const oldCameraStream = cameraStreamRef.current
				const preservedAudioTracks = oldCameraStream?.getAudioTracks?.() ?? []
				cameraStreamRef.current = new MediaStream([
					...newStream.getVideoTracks(),
					...preservedAudioTracks,
				])

				if (previewVideoRef.current) {
					previewVideoRef.current.srcObject = newStream
					previewVideoRef.current.muted = true
					previewVideoRef.current.playsInline = true
					void previewVideoRef.current.play().catch(() => undefined)
					if (
						previewVideoRef.current.videoWidth &&
						previewVideoRef.current.videoHeight
					) {
						updateCameraAspectRatio(previewVideoRef.current)
					}
				}

				if (activeStreamRef.current && cameraRecordRafRef.current === null) {
					const oldTrack = activeStreamRef.current.getVideoTracks?.()?.[0]
					if (oldTrack && newVideoTrack && oldTrack !== newVideoTrack) {
						if (typeof activeStreamRef.current.addTrack === "function") {
							activeStreamRef.current.addTrack(newVideoTrack)
						}
						if (typeof activeStreamRef.current.removeTrack === "function") {
							activeStreamRef.current.removeTrack(oldTrack)
						}
					}
				}

				if (oldCameraStream) {
					for (const track of oldCameraStream.getVideoTracks?.() ?? []) {
						track.stop?.()
					}
				}
			} else if (kind === "screen" && includeCamera) {
				const oldCameraStream = cameraStreamRef.current
				cameraStreamRef.current = newStream

				if (hiddenCameraVideoRef.current) {
					hiddenCameraVideoRef.current.srcObject = newStream
					await waitForPlayback(hiddenCameraVideoRef.current).catch(
						() => undefined,
					)
				}

				if (oldCameraStream) {
					for (const track of oldCameraStream.getVideoTracks?.() ?? []) {
						track.stop?.()
					}
				}
			}
			void refreshDevices()
		} catch (error) {
			onErrorChange(
				error instanceof Error
					? `Could not switch camera: ${error.message}`
					: "Could not switch camera.",
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
			const nextFacing =
				nextDev.facingMode ||
				(facingMode === "environment" ? "user" : "environment")
			await switchCamera(nextDev.deviceId, nextFacing)
		} else {
			const nextFacing: CameraFacingMode =
				facingMode === "environment" ? "user" : "environment"
			const matching = videoDevices.find((d) => d.facingMode === nextFacing)
			const nextDeviceId = matching ? matching.deviceId : ""
			await switchCamera(nextDeviceId, nextFacing)
		}
	}

	const handleCameraSelect = async (value: string) => {
		const dev = videoDevices.find((d) => d.deviceId === value)
		const nextFacing = dev?.facingMode || facingMode
		await switchCamera(value, nextFacing)
	}

	const canvasRef = useRef<HTMLCanvasElement>(null)
	const previewVideoRef = useRef<HTMLVideoElement>(null)
	const hiddenScreenVideoRef = useRef<HTMLVideoElement | null>(null)
	const hiddenCameraVideoRef = useRef<HTMLVideoElement | null>(null)
	const previewContainerRef = useRef<HTMLDivElement>(null)
	const recorderRef = useRef<MediaRecorder | null>(null)
	const mockRecordingRef = useRef<ProcessedFile | null>(null)
	const activeStreamRef = useRef<MediaStream | null>(null)
	const displayStreamRef = useRef<MediaStream | null>(null)
	const cameraStreamRef = useRef<MediaStream | null>(null)
	const audioContextRef = useRef<AudioContext | null>(null)
	const animationFrameRef = useRef<number | null>(null)
	const startTimestampRef = useRef<number | null>(null)
	const dragStateRef = useRef<{
		mode: DragMode
		startX: number
		startY: number
		origin: OverlayRect
	}>({
		mode: null,
		startX: 0,
		startY: 0,
		origin: DEFAULT_OVERLAY_RECT,
	})

	useEffect(() => {
		setIsClientReady(true)
	}, [])

	useEffect(() => {
		if (!isRecording) return
		const timer = window.setInterval(() => {
			if (startTimestampRef.current) {
				setElapsedMs(Date.now() - startTimestampRef.current)
			}
		}, 200)
		return () => window.clearInterval(timer)
	}, [isRecording])

	useEffect(() => {
		overlayRectRef.current = overlayRect
		const overlay = overlayElementRef.current
		if (!overlay) return
		overlay.style.left = `${overlayRect.x * 100}%`
		overlay.style.top = `${overlayRect.y * 100}%`
		overlay.style.width = `${overlayRect.width * 100}%`
		overlay.style.height = `${overlayRect.height * 100}%`
	}, [overlayRect])

	useEffect(() => {
		if (typeof document === "undefined") return
		cameraRecordCanvasRef.current = document.createElement("canvas")
		hiddenScreenVideoRef.current = document.createElement("video")
		hiddenCameraVideoRef.current = document.createElement("video")
	}, [])

	useEffect(() => {
		return () => {
			if (animationFrameRef.current !== null) {
				window.cancelAnimationFrame(animationFrameRef.current)
			}
			if (cameraRecordRafRef.current !== null) {
				window.cancelAnimationFrame(cameraRecordRafRef.current)
			}
			if (overlayAnimationFrameRef.current !== null) {
				window.cancelAnimationFrame(overlayAnimationFrameRef.current)
			}
			recorderRef.current?.state === "recording" && recorderRef.current.stop()
			stopStream(micStreamRef.current)
			stopStream(activeStreamRef.current)
			stopStream(displayStreamRef.current)
			stopStream(cameraStreamRef.current)
			audioContextRef.current?.close().catch(() => undefined)
		}
	}, [])

	const scheduleOverlayFrame = (rect: OverlayRect) => {
		pendingOverlayRectRef.current = rect
		if (overlayAnimationFrameRef.current !== null) return

		overlayAnimationFrameRef.current = window.requestAnimationFrame(() => {
			overlayAnimationFrameRef.current = null
			const pendingRect = pendingOverlayRectRef.current
			const overlay = overlayElementRef.current
			if (!pendingRect || !overlay) return
			overlay.style.left = `${pendingRect.x * 100}%`
			overlay.style.top = `${pendingRect.y * 100}%`
			overlay.style.width = `${pendingRect.width * 100}%`
			overlay.style.height = `${pendingRect.height * 100}%`
		})
	}

	const startCompositePreview = async (
		displayStream: MediaStream,
		cameraStream: MediaStream | null,
		captureCanvasStream: boolean,
	) => {
		const canvas = canvasRef.current
		const screenVideo = hiddenScreenVideoRef.current
		const cameraVideo = hiddenCameraVideoRef.current
		if (!canvas || !screenVideo || !cameraVideo) {
			throw new Error("Preview canvas is unavailable.")
		}

		screenVideo.srcObject = displayStream
		await waitForPlayback(screenVideo)

		if (cameraStream && includeCamera) {
			cameraVideo.srcObject = cameraStream
			await waitForPlayback(cameraVideo)
		} else {
			cameraVideo.srcObject = null
		}

		const screenTrack = displayStream.getVideoTracks()[0]
		const settings = screenTrack?.getSettings()
		canvas.width = Number(settings?.width) || 1280
		canvas.height = Number(settings?.height) || 720

		const context = canvas.getContext("2d")
		if (!context) throw new Error("Canvas 2D context is unavailable.")

		const drawFrame = () => {
			context.fillStyle = "#111827"
			context.fillRect(0, 0, canvas.width, canvas.height)
			context.drawImage(screenVideo, 0, 0, canvas.width, canvas.height)

			if (includeCamera && cameraStream && cameraVideo.readyState >= 2) {
				const rect = clampOverlayRect(overlayRectRef.current)
				const width = canvas.width * rect.width
				const height = canvas.height * rect.height
				const x = canvas.width * rect.x
				const y = canvas.height * rect.y
				context.save()
				context.beginPath()
				context.roundRect(x, y, width, height, 24)
				context.clip()
				context.drawImage(cameraVideo, x, y, width, height)
				context.restore()
				context.strokeStyle = "rgba(255,255,255,0.85)"
				context.lineWidth = 4
				context.strokeRect(x, y, width, height)
			}

			animationFrameRef.current = window.requestAnimationFrame(drawFrame)
		}

		drawFrame()
		return captureCanvasStream ? canvas.captureStream(30) : null
	}

	const createMixedAudioTracks = (streams: Array<MediaStream | null>) => {
		const audioStreams = streams
			.filter((stream): stream is MediaStream => Boolean(stream))
			.map((stream) => new MediaStream(stream.getAudioTracks()))
			.filter((stream) => stream.getAudioTracks().length > 0)

		if (audioStreams.length === 0) return []
		if (audioStreams.length === 1) return audioStreams[0].getAudioTracks()

		const AudioContextCtor = window.AudioContext
		if (!AudioContextCtor) return [audioStreams[0].getAudioTracks()[0]]

		const audioContext = new AudioContextCtor()
		audioContextRef.current = audioContext
		const destination = audioContext.createMediaStreamDestination()
		for (const stream of audioStreams) {
			audioContext.createMediaStreamSource(stream).connect(destination)
		}
		return destination.stream.getAudioTracks()
	}

	const cleanupStreams = () => {
		if (animationFrameRef.current !== null) {
			window.cancelAnimationFrame(animationFrameRef.current)
			animationFrameRef.current = null
		}
		if (cameraRecordRafRef.current !== null) {
			window.cancelAnimationFrame(cameraRecordRafRef.current)
			cameraRecordRafRef.current = null
		}
		audioContextRef.current?.close().catch(() => undefined)
		audioContextRef.current = null
		stopStream(micStreamRef.current)
		micStreamRef.current = null
		stopStream(activeStreamRef.current)
		stopStream(displayStreamRef.current)
		stopStream(cameraStreamRef.current)
		activeStreamRef.current = null
		displayStreamRef.current = null
		cameraStreamRef.current = null
		setCameraAspectRatio(null)
		setScreenAspectRatio(null)
		if (previewVideoRef.current) previewVideoRef.current.srcObject = null
		if (hiddenScreenVideoRef.current)
			hiddenScreenVideoRef.current.srcObject = null
		if (hiddenCameraVideoRef.current)
			hiddenCameraVideoRef.current.srcObject = null
	}

	const startRecording = async () => {
		if (window.__KITSY_RECORDER_E2E__) {
			onErrorChange(null)
			onResultsChange(null)
			mockRecordingRef.current = await window.__KITSY_RECORDER_E2E__.start(kind)
			startTimestampRef.current = Date.now()
			setElapsedMs(0)
			setIsRecording(true)
			setStatus("Recording in progress...")
			return
		}

		if (!navigator.mediaDevices || typeof MediaRecorder === "undefined") {
			onErrorChange("This browser does not support in-browser recording APIs.")
			return
		}
		if (kind === "screen" && !isDesktopViewport(window.innerWidth)) {
			onErrorChange(
				"Screen recording is currently enabled only for desktop-sized viewports.",
			)
			return
		}

		onErrorChange(null)
		onResultsChange(null)
		setStatus("Requesting browser capture permissions...")

		try {
			let recordingStream: MediaStream
			let displayStream: MediaStream | null = null
			let cameraStream: MediaStream | null = null

			if (kind === "audio") {
				recordingStream = await navigator.mediaDevices.getUserMedia({
					audio: true,
					video: false,
				})
			} else if (kind === "camera") {
				let initialCamera = cameraStreamRef.current
				if (!initialCamera && previewPromiseRef.current) {
					initialCamera = await previewPromiseRef.current
				}
				if (
					!initialCamera ||
					initialCamera.getVideoTracks().every((t) => t.readyState === "ended")
				) {
					initialCamera = await requestCameraStream(
						selectedDeviceId || null,
						facingMode,
						includeMicrophone,
					)
					cameraStreamRef.current = initialCamera
					const track = initialCamera.getVideoTracks?.()?.[0]
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
					if (previewVideoRef.current) {
						previewVideoRef.current.srcObject = initialCamera
						previewVideoRef.current.muted = true
						previewVideoRef.current.playsInline = true
						await waitForPlayback(previewVideoRef.current)
					}
					void refreshDevices()
				}
				cameraStream = initialCamera

				const audioTracks = includeMicrophone
					? (cameraStream?.getAudioTracks() ?? [])
					: []

				const canvas =
					cameraRecordCanvasRef.current || document.createElement("canvas")
				cameraRecordCanvasRef.current = canvas
				const video = previewVideoRef.current
				let videoStreamToRecord: MediaStream = cameraStream

				if (video && typeof canvas.captureStream === "function") {
					const context = canvas.getContext("2d")
					if (context) {
						canvas.width = video.videoWidth || 1280
						canvas.height = video.videoHeight || 720

						const drawCamera = () => {
							if (video && (video.readyState >= 2 || video.videoWidth > 0)) {
								if (
									video.videoWidth &&
									video.videoHeight &&
									(canvas.width !== video.videoWidth ||
										canvas.height !== video.videoHeight)
								) {
									canvas.width = video.videoWidth
									canvas.height = video.videoHeight
								}
								context.drawImage(video, 0, 0, canvas.width, canvas.height)
							}
							cameraRecordRafRef.current =
								window.requestAnimationFrame(drawCamera)
						}
						drawCamera()
						videoStreamToRecord = canvas.captureStream(30)
					}
				}

				recordingStream = new MediaStream([
					...videoStreamToRecord.getVideoTracks(),
					...audioTracks,
				])
			} else {
				displayStream = await navigator.mediaDevices.getDisplayMedia({
					video: {
						frameRate: 30,
					},
					audio: includeSystemAudio,
				})
				const screenTrack = displayStream.getVideoTracks?.()?.[0]
				const settings = screenTrack?.getSettings?.()
				if (settings?.width && settings?.height) {
					setScreenAspectRatio(`${settings.width} / ${settings.height}`)
				}
				cameraStream =
					includeCamera || includeMicrophone
						? await requestCameraStream(
								selectedDeviceId || null,
								facingMode,
								includeMicrophone,
							)
						: null
				const mixedAudioTracks = createMixedAudioTracks([
					includeSystemAudio ? displayStream : null,
					includeMicrophone ? cameraStream : null,
				])
				const canvasStream = await startCompositePreview(
					displayStream,
					cameraStream,
					includeCamera,
				)
				recordingStream = includeCamera
					? new MediaStream([
							...(canvasStream?.getVideoTracks() ?? []),
							...mixedAudioTracks,
						])
					: new MediaStream([
							...displayStream.getVideoTracks(),
							...mixedAudioTracks,
						])
			}

			displayStreamRef.current = displayStream
			cameraStreamRef.current = cameraStream
			activeStreamRef.current = recordingStream

			const mimeType = getPreferredRecordingMimeType(kind, (value) =>
				typeof MediaRecorder.isTypeSupported !== "function"
					? true
					: MediaRecorder.isTypeSupported(value),
			)
			const chunks: Blob[] = []
			const recorder = new MediaRecorder(recordingStream, { mimeType })
			recorderRef.current = recorder
			recorder.ondataavailable = (event) => {
				if (event.data.size > 0) chunks.push(event.data)
			}
			recorder.onerror = () => {
				onErrorChange("Recording failed while MediaRecorder was running.")
			}
			recorder.onstop = () => {
				const blob = new Blob(chunks, { type: mimeType })
				onResultsChange([
					{
						blob,
						name: buildRecordingName(kind, mimeType),
					},
				])
				setIsRecording(false)
				setStatus("Recording finished. Review or download the result below.")
				setElapsedMs(0)
				startTimestampRef.current = null
				if (cameraRecordRafRef.current !== null) {
					window.cancelAnimationFrame(cameraRecordRafRef.current)
					cameraRecordRafRef.current = null
				}
				stopStream(micStreamRef.current)
				micStreamRef.current = null
				if (kind !== "camera") {
					cleanupStreams()
				}
			}

			recorder.start(250)
			startTimestampRef.current = Date.now()
			setElapsedMs(0)
			setIsRecording(true)
			setStatus("Recording in progress...")
		} catch (error) {
			cleanupStreams()
			onErrorChange(
				error instanceof Error
					? `Could not start recording: ${error.message}`
					: "Could not start recording.",
			)
		}
	}

	const stopRecording = () => {
		if (mockRecordingRef.current) {
			onResultsChange([mockRecordingRef.current])
			mockRecordingRef.current = null
			setIsRecording(false)
			setStatus("Recording finished. Review or download the result below.")
			setElapsedMs(0)
			startTimestampRef.current = null
			return
		}

		if (recorderRef.current?.state === "recording") {
			recorderRef.current.stop()
		}
	}

	const minutes = String(Math.floor(elapsedMs / 60000)).padStart(2, "0")
	const seconds = String(Math.floor((elapsedMs % 60000) / 1000)).padStart(
		2,
		"0",
	)

	return (
		<div className="card bg-base-100 border border-base-content/10">
			<div className="card-body gap-4">
				<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
					<div>
						<h3 className="text-lg font-semibold">
							{kind === "screen"
								? "Desktop capture"
								: kind === "camera"
									? "Camera capture"
									: "Audio capture"}
						</h3>
						<p className="text-sm text-base-content/60">
							{kind === "screen"
								? "Screen recording uses browser-native capture and can blend a movable camera overlay into the exported video."
								: kind === "camera"
									? "Camera recording works on desktop and mobile browsers that expose MediaRecorder."
									: "Audio recording captures microphone input entirely in the browser."}
						</p>
					</div>
					<div className="badge badge-outline badge-lg">
						{isRecording ? `REC ${minutes}:${seconds}` : "Ready"}
					</div>
				</div>

				{kind === "screen" && (
					<div className="grid gap-3 sm:grid-cols-3">
						<label className="label cursor-pointer justify-start gap-3 rounded-xl border border-base-content/10 px-3 py-2">
							<input
								type="checkbox"
								className="checkbox checkbox-primary checkbox-sm"
								checked={includeCamera}
								onChange={(event) => setIncludeCamera(event.target.checked)}
								disabled={isRecording}
							/>
							<span className="label-text">Camera overlay</span>
						</label>
						<label className="label cursor-pointer justify-start gap-3 rounded-xl border border-base-content/10 px-3 py-2">
							<input
								type="checkbox"
								className="checkbox checkbox-primary checkbox-sm"
								checked={includeMicrophone}
								onChange={(event) => setIncludeMicrophone(event.target.checked)}
								disabled={isRecording}
							/>
							<span className="label-text">Microphone</span>
						</label>
						<label className="label cursor-pointer justify-start gap-3 rounded-xl border border-base-content/10 px-3 py-2">
							<input
								type="checkbox"
								className="checkbox checkbox-primary checkbox-sm"
								checked={includeSystemAudio}
								onChange={(event) =>
									setIncludeSystemAudio(event.target.checked)
								}
								disabled={isRecording}
							/>
							<span className="label-text">System audio</span>
						</label>
					</div>
				)}

				{kind === "camera" && (
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div className="flex items-center gap-2">
							<label className="label cursor-pointer justify-start gap-2 rounded-xl border border-base-content/10 px-3 py-1.5">
								<Icon name="camera" size={16} className="opacity-70" />
								<span className="label-text text-xs font-semibold">
									Camera:
								</span>
								<select
									aria-label="Select camera device"
									data-testid="recorder-camera-select"
									className="select select-ghost select-xs text-xs font-medium focus:outline-none cursor-pointer"
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
							</label>

							<button
								type="button"
								className="btn btn-circle btn-sm btn-outline border-base-content/10"
								onClick={() => void flipCamera()}
								aria-label="Switch camera"
								title="Switch camera"
								data-testid="recorder-flip-camera"
							>
								<Icon name="camera-rotate" size={16} />
							</button>
						</div>

						<label className="label cursor-pointer justify-start gap-2 rounded-xl border border-base-content/10 px-3 py-1.5">
							<input
								type="checkbox"
								className="checkbox checkbox-primary checkbox-xs"
								checked={includeMicrophone}
								onChange={(event) => setIncludeMicrophone(event.target.checked)}
								disabled={isRecording}
							/>
							<span className="label-text text-xs">Include microphone</span>
						</label>
					</div>
				)}

				{kind === "screen" && (
					<div
						ref={previewContainerRef}
						className="relative overflow-hidden rounded-2xl border border-base-content/10 bg-neutral text-neutral-content"
					>
						<canvas
							ref={canvasRef}
							className="block h-auto w-full"
							style={
								screenAspectRatio
									? { aspectRatio: `${screenAspectRatio}` }
									: isRecording
										? undefined
										: { aspectRatio: "16 / 9" }
							}
							data-testid="recorder-preview"
						/>
						{includeCamera && (
							<div
								ref={overlayElementRef}
								className="absolute border-2 border-white/80 bg-black/10 shadow-lg"
								style={{ touchAction: "none" }}
								onPointerDown={(event) => {
									event.preventDefault()
									const mode =
										(event.target as HTMLElement).dataset.handle === "resize"
											? "resize"
											: "move"
									dragStateRef.current = {
										mode,
										startX: event.clientX,
										startY: event.clientY,
										origin: overlayRectRef.current,
									}
									event.currentTarget.setPointerCapture(event.pointerId)
								}}
								onPointerMove={(event) => {
									const state = dragStateRef.current
									const container = previewContainerRef.current
									if (!state.mode || !container) return

									const dx =
										(event.clientX - state.startX) / container.clientWidth
									const dy =
										(event.clientY - state.startY) / container.clientHeight
									const next =
										state.mode === "move"
											? {
													...state.origin,
													x: state.origin.x + dx,
													y: state.origin.y + dy,
												}
											: {
													...state.origin,
													width: state.origin.width + dx,
													height: state.origin.height + dy,
												}
									const clamped = clampOverlayRect(next)
									overlayRectRef.current = clamped
									scheduleOverlayFrame(clamped)
								}}
								onPointerUp={(event) => {
									dragStateRef.current.mode = null
									setOverlayRect(overlayRectRef.current)
									if (event.currentTarget.hasPointerCapture(event.pointerId)) {
										event.currentTarget.releasePointerCapture(event.pointerId)
									}
								}}
								onPointerCancel={(event) => {
									dragStateRef.current.mode = null
									setOverlayRect(overlayRectRef.current)
									if (event.currentTarget.hasPointerCapture(event.pointerId)) {
										event.currentTarget.releasePointerCapture(event.pointerId)
									}
								}}
								data-testid="camera-overlay"
							>
								<div className="flex h-full flex-col justify-between p-2 text-xs font-semibold text-white">
									<span>Camera overlay</span>
									<div
										className="ml-auto h-5 w-5 cursor-se-resize rounded-full border border-white/70 bg-white/20"
										data-handle="resize"
										data-testid="camera-overlay-handle"
									/>
								</div>
							</div>
						)}
					</div>
				)}

				{kind === "camera" && (
					<div className="overflow-hidden rounded-2xl border border-base-content/10 bg-neutral">
						<video
							ref={previewVideoRef}
							autoPlay
							muted
							playsInline
							className="block h-auto w-full"
							style={
								cameraAspectRatio
									? { aspectRatio: `${cameraAspectRatio}` }
									: isRecording
										? undefined
										: { aspectRatio: "16 / 9" }
							}
							onLoadedMetadata={(event) => {
								updateCameraAspectRatio(event.currentTarget)
							}}
							onLoadedData={(event) => {
								updateCameraAspectRatio(event.currentTarget)
							}}
							onResize={(event) => {
								updateCameraAspectRatio(event.currentTarget)
							}}
							data-testid="recorder-preview"
						/>
					</div>
				)}

				{kind === "audio" && (
					<div className="flex min-h-40 items-center justify-center rounded-2xl border border-dashed border-base-content/20 bg-base-200/40 text-center">
						<div className="space-y-3">
							<Icon name="audio" size={52} className="mx-auto opacity-60" />
							<p className="text-sm text-base-content/60">
								Start recording to capture a local voice note or microphone-only
								clip.
							</p>
						</div>
					</div>
				)}

				{kind === "camera" ? (
					<div className="flex flex-col items-center justify-center gap-3 pt-2">
						{isClientReady && (
							<span className="hidden" data-testid="recorder-mounted">
								ready
							</span>
						)}
						<button
							type="button"
							className="group relative flex h-20 w-20 items-center justify-center rounded-full border-4 border-base-content/30 bg-transparent p-1.5 shadow-xl transition-all duration-150 active:scale-90"
							onClick={isRecording ? stopRecording : startRecording}
							data-testid="recorder-toggle"
							aria-label={isRecording ? "Stop Recording" : "Start Recording"}
						>
							<span
								className={`transition-all duration-200 shadow-md ${
									isRecording
										? "h-7 w-7 rounded-md bg-error animate-pulse"
										: "h-full w-full rounded-full bg-error group-hover:scale-95"
								}`}
							/>
							<span className="sr-only">
								{isRecording ? "Stop Recording" : "Start Recording"}
							</span>
						</button>
						<div className="flex items-center gap-2">
							<span className="text-xs font-semibold text-base-content/80">
								{isRecording ? `REC ${minutes}:${seconds}` : "Start Recording"}
							</span>
							<span className="text-xs text-base-content/50">• {status}</span>
						</div>
					</div>
				) : (
					<div className="flex flex-wrap items-center gap-3">
						{isClientReady && (
							<span className="hidden" data-testid="recorder-mounted">
								ready
							</span>
						)}
						<button
							type="button"
							className={`btn ${isRecording ? "btn-error" : "btn-primary"}`}
							onClick={isRecording ? stopRecording : startRecording}
							data-testid="recorder-toggle"
						>
							{isRecording ? "Stop Recording" : "Start Recording"}
						</button>
						<p className="text-sm text-base-content/60">{status}</p>
					</div>
				)}
			</div>
		</div>
	)
}
