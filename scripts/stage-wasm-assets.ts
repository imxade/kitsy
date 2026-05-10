import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs"
import { basename, join } from "node:path"

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
