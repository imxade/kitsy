import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { basename, dirname, join } from "node:path"

const root = process.cwd()
const publicDir = join(root, "public")

function copyMatchingFiles(
	sourceDir: string,
	matcher: (file: string) => boolean,
	targetDir: string,
): number {
	if (!existsSync(sourceDir)) return 0

	let copied = 0
	const visit = (dir: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const source = join(dir, entry.name)
			if (entry.isDirectory()) {
				visit(source)
				continue
			}
			if (!entry.isFile() || !matcher(source)) continue

			mkdirSync(targetDir, { recursive: true })
			cpSync(source, join(targetDir, basename(source)))
			copied += 1
		}
	}

	visit(sourceDir)
	return copied
}

function copyFile(source: string, target: string) {
	mkdirSync(dirname(target), { recursive: true })
	cpSync(source, target, { force: true })
}

function copyBackgroundRemovalAssets() {
	const sourceDir = join(
		root,
		"node_modules/@imgly/background-removal-data/dist",
	)
	const targetDir = join(publicDir, "background-removal")
	const resourcesPath = join(sourceDir, "resources.json")
	if (!existsSync(resourcesPath)) return 0

	rmSync(targetDir, { recursive: true, force: true })
	mkdirSync(targetDir, { recursive: true })

	const resourceMap = JSON.parse(readFileSync(resourcesPath, "utf-8")) as Record<
		string,
		{ chunks?: Array<{ name: string }> }
	>
	const assetKeys = [
		"/onnxruntime-web/ort-wasm-simd-threaded.wasm",
		"/onnxruntime-web/ort-wasm-simd-threaded.mjs",
		"/models/isnet_quint8",
	]

	const chunkNames = new Set<string>()
	for (const key of assetKeys) {
		const entry = resourceMap[key]
		if (!entry) continue

		entry.chunks = entry.chunks?.map((chunk) => {
			chunkNames.add(chunk.name)
			return { ...chunk, name: `${chunk.name}.bin` }
		})
	}

	writeFileSync(
		join(targetDir, "resources.json"),
		`${JSON.stringify(resourceMap, null, 2)}\n`,
	)

	for (const chunkName of chunkNames) {
		copyFile(join(sourceDir, chunkName), join(targetDir, `${chunkName}.bin`))
	}

	return chunkNames.size + 1
}

copyMatchingFiles(
	join(root, "node_modules/@ffmpeg/core/dist/esm"),
	(file) => basename(file).startsWith("ffmpeg-core."),
	join(publicDir, "ffmpeg"),
)

copyMatchingFiles(
	join(root, "node_modules/@neslinesli93/qpdf-wasm"),
	(file) => basename(file) === "qpdf.wasm",
	publicDir,
)

copyBackgroundRemovalAssets()
