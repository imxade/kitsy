import { zipSync, unzipSync } from "fflate"
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

export async function unzipFiles(file: File): Promise<ProcessedFile[]> {
	const buffer = await file.arrayBuffer()
	const unzipped = unzipSync(new Uint8Array(buffer))
	const results: ProcessedFile[] = []

	for (const [name, data] of Object.entries(unzipped)) {
		if (data.length === 0) continue // Skip directories
		const mime = name.endsWith(".png")
			? "image/png"
			: name.endsWith(".jpg")
				? "image/jpeg"
				: "application/octet-stream"
		results.push({
			blob: new Blob([data.slice()], { type: mime }),
			name,
		})
	}
	return results
}

// ── Data ──

/**
 * Convert CSV to JSON using PapaParse.
 * Handles quoted fields, multiline cells, and various delimiters.
 */
export async function csvToJson(file: File): Promise<ProcessedFile> {
	const Papa = (await import("papaparse")).default
	const text = await file.text()

	return new Promise((resolve, reject) => {
		Papa.parse(text, {
			header: true,
			skipEmptyLines: true,
			complete: (results) => {
				const json = JSON.stringify(results.data, null, 2)
				resolve({
					blob: new Blob([json], { type: "application/json" }),
					name: `${file.name.replace(/\.csv$/i, "")}.json`,
				})
			},
			error: (error: Error) => reject(error),
		})
	})
}

/**
 * Convert JSON array to CSV using PapaParse.
 */
export async function jsonToCsv(file: File): Promise<ProcessedFile> {
	const Papa = (await import("papaparse")).default
	const text = await file.text()
	const data = JSON.parse(text)

	if (!Array.isArray(data)) {
		throw new Error("Invalid JSON: expected an array of objects")
	}

	const csv = Papa.unparse(data)
	return {
		blob: new Blob([csv], { type: "text/csv" }),
		name: `${file.name.replace(/\.json$/i, "")}.csv`,
	}
}

export async function formatJson(file: File): Promise<ProcessedFile> {
	const text = await file.text()
	const data = JSON.parse(text)
	const formatted = JSON.stringify(data, null, 2)
	return {
		blob: new Blob([formatted], { type: "application/json" }),
		name: file.name,
	}
}
