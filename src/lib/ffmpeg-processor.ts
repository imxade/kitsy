// ── FFmpeg Processor — lazy-loaded singleton ──
// @ffmpeg/ffmpeg v0.12 manages its own internal Web Worker.
// We load the WASM core lazily on first use and cache it.

import { FFmpeg } from "@ffmpeg/ffmpeg"
import { fetchFile, toBlobURL } from "@ffmpeg/util"
import type { ProcessedFile } from "./image-processor"

let ffmpeg: FFmpeg | null = null
let loadPromise: Promise<void> | null = null

async function getFFmpeg(): Promise<FFmpeg> {
	if (ffmpeg?.loaded) return ffmpeg

	if (!loadPromise) {
		ffmpeg = new FFmpeg()
		loadPromise = (async () => {
			await ffmpeg?.load({
				coreURL: await toBlobURL("/ffmpeg/ffmpeg-core.js", "text/javascript"),
				wasmURL: await toBlobURL(
					"/ffmpeg/ffmpeg-core.wasm",
					"application/wasm",
				),
			})
		})()
	}

	await loadPromise
	if (!ffmpeg) {
		throw new Error("FFmpeg is not loaded")
	}
	return ffmpeg
}

/** Convert readFile output to a clean Uint8Array backed by a plain ArrayBuffer */
function toBytes(data: Uint8Array | string): Uint8Array<ArrayBuffer> {
	if (typeof data === "string") return new TextEncoder().encode(data)
	// .slice() creates a fresh ArrayBuffer-backed copy (fixes TS6 BlobPart checks)
	return data.slice() as Uint8Array<ArrayBuffer>
}

export async function prefetchFFmpeg() {
	try {
		await getFFmpeg()
	} catch (e) {
		console.warn("FFmpeg prefetch failed:", e)
	}
}

// ── Video ──

export async function convertVideo(
	file: File,
	outputFormat: string,
): Promise<ProcessedFile> {
	const ff = await getFFmpeg()
	const inputName = `input${getExtFromFile(file)}`
	const outputName = `output.${outputFormat}`

	await ff.writeFile(inputName, await fetchFile(file))

	const args = ["-i", inputName]
	if (outputFormat === "webm") {
		args.push("-c:v", "libvpx", "-c:a", "libvorbis")
	} else if (outputFormat === "mkv") {
		args.push("-c", "copy")
	} else if (outputFormat === "avi") {
		args.push("-c:v", "mjpeg", "-q:v", "2", "-c:a", "libmp3lame")
	}
	args.push(outputName)

	await ff.exec(args)
	const data = toBytes((await ff.readFile(outputName)) as Uint8Array)

	await ff.deleteFile(inputName)
	await ff.deleteFile(outputName)

	const blob = new Blob([data], { type: `video/${outputFormat}` })
	const baseName = file.name.replace(/\.[^.]+$/, "")
	return { blob, name: `${baseName}.${outputFormat}` }
}

export async function trimVideo(
	file: File,
	startTime: string,
	endTime: string,
): Promise<ProcessedFile> {
	const ff = await getFFmpeg()
	const ext = getExtFromFile(file)
	const inputName = `input${ext}`
	const outputName = `trimmed${ext}`

	await ff.writeFile(inputName, await fetchFile(file))

	const args: string[] = ["-i", inputName]
	if (startTime && startTime !== "" && startTime !== "00:00:00") {
		args.push("-ss", startTime)
	}
	if (endTime && endTime !== "") {
		args.push("-to", endTime)
	}
	args.push(outputName)

	await ff.exec(args)
	const data = toBytes((await ff.readFile(outputName)) as Uint8Array)

	await ff.deleteFile(inputName)
	await ff.deleteFile(outputName)

	const baseName = file.name.replace(/\.[^.]+$/, "")
	return {
		blob: new Blob([data], { type: file.type || "video/mp4" }),
		name: `${baseName}-trimmed${ext}`,
	}
}

export async function extractAudio(
	file: File,
	outputFormat: string,
): Promise<ProcessedFile> {
	const ff = await getFFmpeg()
	const inputName = `input${getExtFromFile(file)}`
	const outputName = `audio.${outputFormat}`

	await ff.writeFile(inputName, await fetchFile(file))
	await ff.exec([
		"-i",
		inputName,
		"-vn",
		"-acodec",
		getAudioCodec(outputFormat),
		outputName,
	])
	const data = toBytes((await ff.readFile(outputName)) as Uint8Array)

	await ff.deleteFile(inputName)
	await ff.deleteFile(outputName)

	const baseName = file.name.replace(/\.[^.]+$/, "")
	return {
		blob: new Blob([data], { type: `audio/${outputFormat}` }),
		name: `${baseName}.${outputFormat}`,
	}
}

// ── Audio ──

export async function convertAudio(
	file: File,
	outputFormat: string,
): Promise<ProcessedFile> {
	const ff = await getFFmpeg()
	const inputName = `input${getExtFromFile(file)}`
	const outputName = `output.${outputFormat}`

	await ff.writeFile(inputName, await fetchFile(file))
	await ff.exec([
		"-i",
		inputName,
		"-acodec",
		getAudioCodec(outputFormat),
		outputName,
	])
	const data = toBytes((await ff.readFile(outputName)) as Uint8Array)

	await ff.deleteFile(inputName)
	await ff.deleteFile(outputName)

	const baseName = file.name.replace(/\.[^.]+$/, "")
	return {
		blob: new Blob([data], { type: `audio/${outputFormat}` }),
		name: `${baseName}.${outputFormat}`,
	}
}

export async function trimAudio(
	file: File,
	startTime: string,
	endTime: string,
): Promise<ProcessedFile> {
	const ff = await getFFmpeg()
	const ext = getExtFromFile(file)
	const inputName = `input${ext}`
	const outputName = `trimmed${ext}`

	await ff.writeFile(inputName, await fetchFile(file))

	const args: string[] = ["-i", inputName]
	if (startTime && startTime !== "" && startTime !== "00:00:00") {
		args.push("-ss", startTime)
	}
	if (endTime && endTime !== "") {
		args.push("-to", endTime)
	}
	args.push(outputName)

	await ff.exec(args)
	const data = toBytes((await ff.readFile(outputName)) as Uint8Array)

	await ff.deleteFile(inputName)
	await ff.deleteFile(outputName)

	const baseName = file.name.replace(/\.[^.]+$/, "")
	return {
		blob: new Blob([data], { type: file.type || "audio/mpeg" }),
		name: `${baseName}-trimmed${ext}`,
	}
}

// ── GIF ──

export async function videoToGif(
	file: File,
	fps: number,
	width: number,
): Promise<ProcessedFile> {
	const ff = await getFFmpeg()
	const inputName = `input${getExtFromFile(file)}`
	const outputName = "output.gif"

	await ff.writeFile(inputName, await fetchFile(file))
	await ff.exec([
		"-i",
		inputName,
		"-vf",
		`fps=${fps},scale=${width}:-1:flags=lanczos`,
		"-f",
		"gif",
		outputName,
	])
	const data = toBytes((await ff.readFile(outputName)) as Uint8Array)

	await ff.deleteFile(inputName)
	await ff.deleteFile(outputName)

	const baseName = file.name.replace(/\.[^.]+$/, "")
	return {
		blob: new Blob([data], { type: "image/gif" }),
		name: `${baseName}.gif`,
	}
}

// ── GIF to Video ──

export async function gifToMp4(file: File): Promise<ProcessedFile> {
	const ff = await getFFmpeg()
	const inputName = "input.gif"
	const outputName = "output.mp4"

	await ff.writeFile(inputName, await fetchFile(file))
	await ff.exec([
		"-i",
		inputName,
		"-movflags",
		"faststart",
		"-pix_fmt",
		"yuv420p",
		"-vf",
		"scale=trunc(iw/2)*2:trunc(ih/2)*2",
		outputName,
	])
	const data = toBytes((await ff.readFile(outputName)) as Uint8Array)

	await ff.deleteFile(inputName)
	await ff.deleteFile(outputName)

	const baseName = file.name.replace(/\.[^.]+$/, "")
	return {
		blob: new Blob([data], { type: "video/mp4" }),
		name: `${baseName}.mp4`,
	}
}

// ── Merge Videos ──

export async function mergeVideos(files: File[]): Promise<ProcessedFile> {
	const ff = await getFFmpeg()

	// Write all input files
	const inputNames: string[] = []
	for (let i = 0; i < files.length; i++) {
		const name = `input${i}${getExtFromFile(files[i])}`
		await ff.writeFile(name, await fetchFile(files[i]))
		inputNames.push(name)
	}

	// Create concat list
	const concatList = inputNames.map((n) => `file '${n}'`).join("\n")
	await ff.writeFile("concat.txt", new TextEncoder().encode(concatList))

	const outputName = "merged.mp4"
	await ff.exec([
		"-f",
		"concat",
		"-safe",
		"0",
		"-i",
		"concat.txt",
		"-c",
		"copy",
		outputName,
	])
	const data = toBytes((await ff.readFile(outputName)) as Uint8Array)

	// Cleanup
	for (const name of inputNames) await ff.deleteFile(name)
	await ff.deleteFile("concat.txt")
	await ff.deleteFile(outputName)

	return {
		blob: new Blob([data], { type: "video/mp4" }),
		name: "merged.mp4",
	}
}

// ── Merge Audio ──

export async function mergeAudio(files: File[]): Promise<ProcessedFile> {
	const ff = await getFFmpeg()

	const inputNames: string[] = []
	for (let i = 0; i < files.length; i++) {
		const name = `audioin${i}${getExtFromFile(files[i])}`
		await ff.writeFile(name, await fetchFile(files[i]))
		inputNames.push(name)
	}

	const concatList = inputNames.map((n) => `file '${n}'`).join("\n")
	await ff.writeFile("audioconcat.txt", new TextEncoder().encode(concatList))

	const outputName = "merged.mp3"
	await ff.exec([
		"-f",
		"concat",
		"-safe",
		"0",
		"-i",
		"audioconcat.txt",
		"-acodec",
		"libmp3lame",
		outputName,
	])
	const data = toBytes((await ff.readFile(outputName)) as Uint8Array)

	for (const name of inputNames) await ff.deleteFile(name)
	await ff.deleteFile("audioconcat.txt")
	await ff.deleteFile(outputName)

	return {
		blob: new Blob([data], { type: "audio/mpeg" }),
		name: "merged.mp3",
	}
}

// ── Merge Audio into Video ──

export async function mergeAudioVideo(
	videoFile: File,
	audioFile: File,
	startTime: string,
): Promise<ProcessedFile> {
	const ff = await getFFmpeg()
	const videoName = `video${getExtFromFile(videoFile)}`
	const audioName = `audio${getExtFromFile(audioFile)}`
	const outputName = "output.mp4"

	await ff.writeFile(videoName, await fetchFile(videoFile))
	await ff.writeFile(audioName, await fetchFile(audioFile))

	const args = [
		"-i",
		videoName,
		"-i",
		audioName,
		"-map",
		"0:v:0",
		"-map",
		"1:a:0",
		"-c:v",
		"copy",
		"-shortest",
	]
	if (startTime && startTime !== "00:00:00") {
		args.push("-itsoffset", startTime)
	}
	args.push(outputName)

	await ff.exec(args)
	const data = toBytes((await ff.readFile(outputName)) as Uint8Array)

	await ff.deleteFile(videoName)
	await ff.deleteFile(audioName)
	await ff.deleteFile(outputName)

	const baseName = videoFile.name.replace(/\.[^.]+$/, "")
	return {
		blob: new Blob([data], { type: "video/mp4" }),
		name: `${baseName}-with-audio.mp4`,
	}
}

// ── New Video Tools ──

export async function muteVideo(file: File): Promise<ProcessedFile> {
	const ff = await getFFmpeg()
	const ext = getExtFromFile(file)
	const inputName = `input${ext}`
	const outputName = `muted${ext}`

	await ff.writeFile(inputName, await fetchFile(file))
	await ff.exec(["-i", inputName, "-c:v", "copy", "-an", outputName])
	const data = toBytes((await ff.readFile(outputName)) as Uint8Array)

	await ff.deleteFile(inputName)
	await ff.deleteFile(outputName)

	const baseName = file.name.replace(/\.[^.]+$/, "")
	return {
		blob: new Blob([data], { type: file.type || "video/mp4" }),
		name: `${baseName}-muted${ext}`,
	}
}

export async function changeVideoSpeed(
	file: File,
	speed: number,
): Promise<ProcessedFile> {
	const ff = await getFFmpeg()
	const ext = getExtFromFile(file)
	const inputName = `input${ext}`
	const outputName = `speed${ext}`

	await ff.writeFile(inputName, await fetchFile(file))
	// setpts controls video speed. Disregard audio (-an) to prevent track mapping crashes.
	const vFilter = `setpts=${(1 / speed).toFixed(4)}*PTS`

	await ff.exec(["-i", inputName, "-filter:v", vFilter, "-an", outputName])
	const data = toBytes((await ff.readFile(outputName)) as Uint8Array)

	await ff.deleteFile(inputName)
	await ff.deleteFile(outputName)

	const baseName = file.name.replace(/\.[^.]+$/, "")
	return {
		blob: new Blob([data], { type: file.type || "video/mp4" }),
		name: `${baseName}-speed-${speed}x${ext}`,
	}
}

export async function resizeVideo(
	file: File,
	width: number,
	height: number,
): Promise<ProcessedFile> {
	const ff = await getFFmpeg()
	const ext = getExtFromFile(file)
	const inputName = `input${ext}`
	const outputName = `resize${ext}`

	await ff.writeFile(inputName, await fetchFile(file))
	await ff.exec([
		"-i",
		inputName,
		"-vf",
		`scale=${width}:${height}`,
		outputName,
	])
	const data = toBytes((await ff.readFile(outputName)) as Uint8Array)

	await ff.deleteFile(inputName)
	await ff.deleteFile(outputName)

	const baseName = file.name.replace(/\.[^.]+$/, "")
	return {
		blob: new Blob([data], { type: file.type || "video/mp4" }),
		name: `${baseName}-resized${ext}`,
	}
}

export async function cropVideo(
	file: File,
	x: number,
	y: number,
	w: number,
	h: number,
): Promise<ProcessedFile> {
	const ff = await getFFmpeg()
	const ext = getExtFromFile(file)
	const inputName = `input${ext}`
	const outputName = `crop${ext}`

	await ff.writeFile(inputName, await fetchFile(file))
	await ff.exec([
		"-i",
		inputName,
		"-vf",
		`crop=${w}:${h}:${x}:${y}`,
		outputName,
	])
	const data = toBytes((await ff.readFile(outputName)) as Uint8Array)

	await ff.deleteFile(inputName)
	await ff.deleteFile(outputName)

	const baseName = file.name.replace(/\.[^.]+$/, "")
	return {
		blob: new Blob([data], { type: file.type || "video/mp4" }),
		name: `${baseName}-cropped${ext}`,
	}
}

export async function addVideoWatermark(
	file: File,
	text: string,
): Promise<ProcessedFile> {
	const ff = await getFFmpeg()
	const ext = getExtFromFile(file)
	const inputName = `input${ext}`
	const watermarkName = "watermark.png"
	const outputName = `watermarked${ext}`

	// 1. Create a canvas for the watermark (100% offline reliable)
	// We'll make it large enough for the text
	const canvas = new OffscreenCanvas(400, 100)
	const ctx = canvas.getContext("2d")
	if (!ctx) throw new Error("Could not get canvas context")
	ctx.font = "24px sans-serif"
	ctx.fillStyle = "rgba(255, 255, 255, 0.5)"
	ctx.textAlign = "right"
	ctx.textBaseline = "bottom"
	ctx.fillText(text, 390, 90)

	const watermarkBlob = await canvas.convertToBlob({ type: "image/png" })
	const watermarkBuffer = await watermarkBlob.arrayBuffer()

	await ff.writeFile(inputName, await fetchFile(file))
	await ff.writeFile(watermarkName, new Uint8Array(watermarkBuffer))

	// 2. Use overlay filter instead of drawtext
	// This avoids "font not found" errors in offline environments
	await ff.exec([
		"-i",
		inputName,
		"-i",
		watermarkName,
		"-filter_complex",
		"overlay=W-w-10:H-h-10",
		"-c:a",
		"copy",
		outputName,
	])

	const data = toBytes((await ff.readFile(outputName)) as Uint8Array)

	await ff.deleteFile(inputName)
	await ff.deleteFile(watermarkName)
	await ff.deleteFile(outputName)

	const baseName = file.name.replace(/\.[^.]+$/, "")
	return {
		blob: new Blob([data], { type: file.type || "video/mp4" }),
		name: `${baseName}-watermarked${ext}`,
	}
}

export async function extractFrames(file: File): Promise<ProcessedFile[]> {
	const ff = await getFFmpeg()
	const ext = getExtFromFile(file)
	const inputName = `input${ext}`
	const outputNamePattern = "frame_%03d.png"

	await ff.writeFile(inputName, await fetchFile(file))
	// Extract 1 frame per second
	await ff.exec(["-i", inputName, "-vf", "fps=1", outputNamePattern])

	const files = await ff.listDir(".")
	const frameFiles = files
		.filter((f) => f.name.startsWith("frame_") && f.name.endsWith(".png"))
		.sort((a, b) => a.name.localeCompare(b.name))

	const results: ProcessedFile[] = []
	for (const f of frameFiles) {
		const data = toBytes((await ff.readFile(f.name)) as Uint8Array)
		results.push({
			blob: new Blob([data], { type: "image/png" }),
			name: f.name,
		})
		await ff.deleteFile(f.name)
	}

	await ff.deleteFile(inputName)
	return results
}

export async function changeVolume(
	file: File,
	factor: number,
): Promise<ProcessedFile> {
	const ff = await getFFmpeg()
	const ext = getExtFromFile(file)
	const inputName = `input${ext}`
	const outputName = `volume${ext}`

	await ff.writeFile(inputName, await fetchFile(file))
	await ff.exec(["-i", inputName, "-af", `volume=${factor}`, outputName])
	const data = toBytes((await ff.readFile(outputName)) as Uint8Array)

	await ff.deleteFile(inputName)
	await ff.deleteFile(outputName)

	const baseName = file.name.replace(/\.[^.]+$/, "")
	return {
		blob: new Blob([data], { type: file.type || "audio/mpeg" }),
		name: `${baseName}-volume${ext}`,
	}
}

export async function fadeAudio(
	file: File,
	type: "in" | "out",
	duration: number,
): Promise<ProcessedFile> {
	const ff = await getFFmpeg()
	const ext = getExtFromFile(file)
	const inputName = `input${ext}`
	const outputName = `fade${ext}`

	await ff.writeFile(inputName, await fetchFile(file))
	const filter = `afade=t=${type}:d=${duration}`
	await ff.exec(["-i", inputName, "-af", filter, outputName])
	const data = toBytes((await ff.readFile(outputName)) as Uint8Array)

	await ff.deleteFile(inputName)
	await ff.deleteFile(outputName)

	const baseName = file.name.replace(/\.[^.]+$/, "")
	return {
		blob: new Blob([data], { type: file.type || "audio/mpeg" }),
		name: `${baseName}-fade-${type}${ext}`,
	}
}

// ── Helpers ──

function getExtFromFile(file: File): string {
	const match = file.name.match(/\.[^.]+$/)
	return match ? match[0] : ".bin"
}

function getAudioCodec(format: string): string {
	const map: Record<string, string> = {
		mp3: "libmp3lame",
		wav: "pcm_s16le",
		ogg: "libvorbis",
		aac: "aac",
	}
	return map[format] ?? "copy"
}
