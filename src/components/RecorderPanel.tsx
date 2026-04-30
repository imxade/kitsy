import { useEffect, useRef, useState } from "react"
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
	const [includeCamera, setIncludeCamera] = useState(kind === "screen")
	const [includeMicrophone, setIncludeMicrophone] = useState(true)
	const [includeSystemAudio, setIncludeSystemAudio] = useState(false)
	const [overlayRect, setOverlayRect] =
		useState<OverlayRect>(DEFAULT_OVERLAY_RECT)
	const overlayRectRef = useRef(DEFAULT_OVERLAY_RECT)
	const overlayElementRef = useRef<HTMLDivElement>(null)
	const overlayAnimationFrameRef = useRef<number | null>(null)
	const pendingOverlayRectRef = useRef<OverlayRect | null>(null)

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
		hiddenScreenVideoRef.current = document.createElement("video")
		hiddenCameraVideoRef.current = document.createElement("video")
	}, [])

	useEffect(() => {
		return () => {
			if (animationFrameRef.current !== null) {
				window.cancelAnimationFrame(animationFrameRef.current)
			}
			if (overlayAnimationFrameRef.current !== null) {
				window.cancelAnimationFrame(overlayAnimationFrameRef.current)
			}
			recorderRef.current?.state === "recording" && recorderRef.current.stop()
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
		return canvas.captureStream(30)
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
		audioContextRef.current?.close().catch(() => undefined)
		audioContextRef.current = null
		stopStream(activeStreamRef.current)
		stopStream(displayStreamRef.current)
		stopStream(cameraStreamRef.current)
		activeStreamRef.current = null
		displayStreamRef.current = null
		cameraStreamRef.current = null
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
				recordingStream = await navigator.mediaDevices.getUserMedia({
					video: true,
					audio: includeMicrophone,
				})
				if (previewVideoRef.current) {
					previewVideoRef.current.srcObject = recordingStream
					await waitForPlayback(previewVideoRef.current)
				}
			} else {
				displayStream = await navigator.mediaDevices.getDisplayMedia({
					video: {
						frameRate: 30,
					},
					audio: includeSystemAudio,
				})
				cameraStream =
					includeCamera || includeMicrophone
						? await navigator.mediaDevices.getUserMedia({
								video: includeCamera,
								audio: includeMicrophone,
							})
						: null
				const canvasStream = await startCompositePreview(
					displayStream,
					cameraStream,
				)
				const mixedAudioTracks = createMixedAudioTracks([
					includeSystemAudio ? displayStream : null,
					includeMicrophone ? cameraStream : null,
				])
				recordingStream = new MediaStream([
					...canvasStream.getVideoTracks(),
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
				cleanupStreams()
			}

			recorder.start(250)
			startTimestampRef.current = Date.now()
			setElapsedMs(0)
			setIsRecording(true)
			setStatus("Recording in progress...")
		} catch (error) {
			cleanupStreams()
			onErrorChange(
				error instanceof Error ? error.message : "Failed to start recording.",
			)
			setStatus("Recording did not start.")
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
					<label className="label cursor-pointer justify-start gap-3 rounded-xl border border-base-content/10 px-3 py-2">
						<input
							type="checkbox"
							className="checkbox checkbox-primary checkbox-sm"
							checked={includeMicrophone}
							onChange={(event) => setIncludeMicrophone(event.target.checked)}
							disabled={isRecording}
						/>
						<span className="label-text">Include microphone audio</span>
					</label>
				)}

				{kind === "screen" && (
					<div
						ref={previewContainerRef}
						className="relative overflow-hidden rounded-2xl border border-base-content/10 bg-neutral text-neutral-content"
					>
						<canvas
							ref={canvasRef}
							className="aspect-video w-full"
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
							className="aspect-video w-full"
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
			</div>
		</div>
	)
}
