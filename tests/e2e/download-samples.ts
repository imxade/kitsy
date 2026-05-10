/**
 * Downloads sample test assets to /tmp/kitsy-test-assets/ for E2E tests.
 * Runs once before the test suite — reuses files if they already exist.
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { join } from "node:path"

export const ASSETS_DIR = "/tmp/kitsy-test-assets"

interface Asset {
	name: string
	url: string
}

const assets: Asset[] = [
	{
		name: "image.jpg",
		url: "https://picsum.photos/800/600.jpg",
	},
	{
		name: "image.png",
		url: "https://picsum.photos/800/600.webp",
	},
	{
		name: "video.mp4",
		url: "https://www.w3schools.com/html/mov_bbb.mp4",
	},
	{
		name: "audio.mp3",
		url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
	},
	{
		name: "document.pdf",
		url: "https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf",
	},
	{
		name: "sample.csv",
		url: "https://raw.githubusercontent.com/datasciencedojo/datasets/master/titanic.csv",
	},
	{
		name: "sample.json",
		url: "https://jsonplaceholder.typicode.com/users",
	},
	{
		name: "sample.txt",
		url: "https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english-no-swears.txt",
	},
	{
		name: "sample.zip",
		url: "https://github.com/octocat/Hello-World/archive/refs/heads/master.zip",
	},
]
export async function downloadSamples(): Promise<void> {
	mkdirSync(ASSETS_DIR, { recursive: true })

	for (const asset of assets) {
		const dest = join(ASSETS_DIR, asset.name)
		if (existsSync(dest)) {
			console.log(`[SKIP] ${asset.name} already exists`)
			continue
		}
		console.log(`[DOWNLOAD] ${asset.name} from ${asset.url}`)
		try {
			const res = await fetch(asset.url, { redirect: "follow" })
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			const buf = Buffer.from(await res.arrayBuffer())
			writeFileSync(dest, buf)
			console.log(`[OK] ${asset.name} (${(buf.length / 1024).toFixed(0)} KB)`)
		} catch (err) {
			console.error(`[FAIL] ${asset.name}: ${err}`)
		}
	}

	// Create duplicate files for testing merge tools
	writeFileSync(
		join(ASSETS_DIR, "document2.pdf"),
		Buffer.from(readFileSync(join(ASSETS_DIR, "document.pdf"))),
	)
	writeFileSync(
		join(ASSETS_DIR, "video2.mp4"),
		Buffer.from(readFileSync(join(ASSETS_DIR, "video.mp4"))),
	)
	writeFileSync(
		join(ASSETS_DIR, "audio2.mp3"),
		Buffer.from(readFileSync(join(ASSETS_DIR, "audio.mp3"))),
	)
	writeFileSync(
		join(ASSETS_DIR, "sample.rtf"),
		String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0 Arial;}}\f0\fs24 Kitsy offline document conversion sample.\par}`,
	)

	console.log("[DONE] All sample assets ready")
}

// Allow running directly: node --experimental-strip-types tests/e2e/download-samples.ts
if (process.argv[1]?.endsWith("download-samples.ts")) {
	downloadSamples()
}
