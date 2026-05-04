export type RecorderKind = "screen" | "camera" | "audio"

export interface OverlayRect {
	x: number
	y: number
	width: number
	height: number
}

export const DEFAULT_OVERLAY_RECT: OverlayRect = {
	x: 0.72,
	y: 0.06,
	width: 0.24,
	height: 0.24,
}

export function clampOverlayRect(rect: OverlayRect): OverlayRect {
	const width =
		Math.round(Math.min(Math.max(rect.width, 0.12), 1.0) * 10000) / 10000
	const height =
		Math.round(Math.min(Math.max(rect.height, 0.12), 1.0) * 10000) / 10000
	const x = Math.round(Math.min(Math.max(rect.x, 0), 1 - width) * 10000) / 10000
	const y =
		Math.round(Math.min(Math.max(rect.y, 0), 1 - height) * 10000) / 10000
	return { x, y, width, height }
}

export function isDesktopViewport(width: number) {
	return width >= 768
}

export function getPreferredRecordingMimeType(
	kind: RecorderKind,
	supportsType: (value: string) => boolean,
) {
	const candidates =
		kind === "audio"
			? ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm"]
			: [
					"video/webm;codecs=vp9,opus",
					"video/webm;codecs=vp8,opus",
					"video/webm",
				]

	return (
		candidates.find((candidate) => supportsType(candidate)) || candidates[0]
	)
}

export function getRecordingExtension(mimeType: string) {
	if (mimeType.includes("ogg")) return "ogg"
	if (mimeType.includes("mp4")) return "mp4"
	if (mimeType.includes("audio")) return "webm"
	return "webm"
}

export function buildRecordingName(
	kind: RecorderKind,
	mimeType: string,
	now = new Date(),
) {
	const stamp = now
		.toISOString()
		.replaceAll(":", "-")
		.replace(/\.\d{3}Z$/, "Z")
	return `${kind}-recording-${stamp}.${getRecordingExtension(mimeType)}`
}
