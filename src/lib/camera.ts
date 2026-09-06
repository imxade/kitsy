export type CameraFacingMode = "environment" | "user"

export interface CameraDevice {
	deviceId: string
	label: string
	facingMode?: CameraFacingMode
}

/**
 * Enumerates available video input devices and returns user-friendly labels.
 */
export async function enumerateVideoDevices(): Promise<CameraDevice[]> {
	if (
		typeof navigator === "undefined" ||
		!navigator.mediaDevices?.enumerateDevices
	) {
		return []
	}
	try {
		const devices = await navigator.mediaDevices.enumerateDevices()
		return devices
			.filter((device) => device.kind === "videoinput")
			.map((device, index) => {
				const labelLower = (device.label || "").toLowerCase()
				let inferredFacing: CameraFacingMode | undefined
				if (
					labelLower.includes("back") ||
					labelLower.includes("rear") ||
					labelLower.includes("environment")
				) {
					inferredFacing = "environment"
				} else if (
					labelLower.includes("front") ||
					labelLower.includes("user") ||
					labelLower.includes("selfie") ||
					labelLower.includes("face")
				) {
					inferredFacing = "user"
				}

				const fallbackLabel =
					index === 0
						? "Camera 1 (Default)"
						: `Camera ${index + 1}${inferredFacing ? ` (${inferredFacing})` : ""}`
				return {
					deviceId: device.deviceId,
					label: device.label || fallbackLabel,
					facingMode: inferredFacing,
				}
			})
	} catch {
		return []
	}
}

/**
 * Builds video track constraints based on an optional deviceId or facingMode.
 */
export function buildVideoConstraints(
	deviceId?: string | null,
	facingMode: CameraFacingMode = "environment",
): MediaTrackConstraints {
	if (deviceId) {
		return {
			deviceId: { exact: deviceId },
		}
	}
	return {
		facingMode: { ideal: facingMode },
	}
}

/**
 * Requests a camera media stream with fallback support if an exact deviceId fails.
 */
export async function requestCameraStream(
	deviceId?: string | null,
	facingMode: CameraFacingMode = "environment",
	audio = false,
): Promise<MediaStream> {
	if (
		typeof navigator === "undefined" ||
		!navigator.mediaDevices?.getUserMedia
	) {
		throw new Error("Camera capture is not available in this browser.")
	}

	try {
		return await navigator.mediaDevices.getUserMedia({
			video: buildVideoConstraints(deviceId, facingMode),
			audio,
		})
	} catch (error) {
		// If exact deviceId threw (e.g. OverconstrainedError on some mobile browsers), retry with facingMode fallback
		if (deviceId) {
			return await navigator.mediaDevices.getUserMedia({
				video: { facingMode: { ideal: facingMode } },
				audio,
			})
		}
		throw error
	}
}
