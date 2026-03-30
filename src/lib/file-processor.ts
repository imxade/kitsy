// ── File Processor — fflate for ZIP ──

import { zipSync } from "fflate"
import type { ProcessedFile } from "./image-processor"

export async function createZip(files: File[]): Promise<ProcessedFile> {
	const entries: Record<string, Uint8Array> = {}

	for (const file of files) {
		const buffer = await file.arrayBuffer()
		entries[file.name] = new Uint8Array(buffer)
	}

	const zipped = zipSync(entries)
	return {
		blob: new Blob([zipped.slice()], { type: "application/zip" }),
		name: "archive.zip",
	}
}
