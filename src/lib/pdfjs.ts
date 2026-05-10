import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs"
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url"

// ensure worker is only configured in browser
if (typeof window !== "undefined") {
	pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl
}

// export directly (no promise, no lazy loader)
export async function getPdfjsLib() {
	return pdfjsLib
}

export async function getPdfPageCount(file: File): Promise<number> {
	const loadingTask = pdfjsLib.getDocument({
		data: new Uint8Array(await file.arrayBuffer()),
	})
	const doc = await loadingTask.promise
	try {
		return doc.numPages
	} finally {
		await doc.destroy?.()
	}
}
