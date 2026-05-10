import {
	readdirSync,
	writeFileSync,
	statSync,
	existsSync,
	readFileSync,
} from "node:fs"
import { join } from "node:path"
import { execSync } from "node:child_process"

const VIDEO_DIR = process.argv[2] || "test-results"
const OUTPUT = process.argv[3] || "videos/full-showcase.webm"

function getWebmFiles(dir: string): string[] {
	let results: string[] = []
	try {
		const list = readdirSync(dir)
		for (const file of list) {
			const fullPath = join(dir, file)
			const stat = statSync(fullPath)
			if (stat.isDirectory()) {
				// Skip retry directories to avoid duplicate videos
				if (file.includes("-retry")) continue
				results = results.concat(getWebmFiles(fullPath))
			} else if (file.endsWith("video.webm")) {
				if (existsSync(join(dir, "SUCCESS"))) {
					const trimPath = join(dir, "trim.json")
					if (existsSync(trimPath)) {
						try {
							const trimData = JSON.parse(readFileSync(trimPath, "utf-8"))
							const part1 = join(dir, "part1.webm")
							const part2 = join(dir, "part2.webm")

							// Split video losslessly using stored timestamps
							execSync(
								`ffmpeg -y -i ${fullPath} -t ${trimData.cutStart} -c copy ${part1}`,
								{ stdio: "ignore" },
							)
							execSync(
								`ffmpeg -y -i ${fullPath} -ss ${trimData.cutEnd} -c copy ${part2}`,
								{ stdio: "ignore" },
							)

							results.push(part1, part2)
						} catch (_err) {
							console.warn(`Trim failed for ${fullPath}, using full video`)
							results.push(fullPath)
						}
					} else {
						results.push(fullPath)
					}
				}
			}
		}
	} catch (err) {
		console.warn(`Could not read dir ${dir}`, err)
	}
	return results
}

const files = getWebmFiles(VIDEO_DIR).sort()

if (files.length === 0) {
	console.log(`No video files found in ${VIDEO_DIR}`)
	process.exit(1)
}

const LIST_FILE = "concat-list.txt"
const listContent = files.map((f) => `file '${f}'`).join("\n")
writeFileSync(LIST_FILE, listContent)

execSync(`mkdir -p $(dirname ${OUTPUT})`)

console.log(`Concatenating ${files.length} videos into ${OUTPUT}...`)
try {
	// Re-encode with VP9 for ~3x smaller output vs Playwright's raw VP8
	execSync(
		`ffmpeg -y -f concat -safe 0 -i ${LIST_FILE} -c:v libvpx-vp9 -crf 30 -b:v 0 -deadline good -cpu-used 4 -row-mt 1 -an ${OUTPUT}`,
		{ stdio: "inherit" },
	)
	console.log(`Done: ${OUTPUT}`)
} catch (err) {
	console.error("FFmpeg concatenation failed", err)
	process.exit(1)
} finally {
	execSync(`rm ${LIST_FILE}`)
}
