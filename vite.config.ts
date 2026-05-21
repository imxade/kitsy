/// <reference types="vitest/config" />

import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import { nitro } from "nitro/vite"
import { serwist } from "@serwist/vite"
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const rootPkg = JSON.parse(readFileSync("package.json", "utf-8"))

function packageVersion(packageName: string): string {
	try {
		const entry = fileURLToPath(import.meta.resolve(packageName))
		let current = dirname(entry)
		while (current !== dirname(current)) {
			const pkgPath = join(current, "package.json")
			if (existsSync(pkgPath)) {
				const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
				if (pkg.name === packageName) return pkg.version
			}
			current = dirname(current)
		}
	} catch {
		// The package may not be installed yet during a fresh checkout.
	}

	return (
		rootPkg.dependencies?.[packageName] ??
		rootPkg.devDependencies?.[packageName] ??
		"uninstalled"
	)
}

const ffmpegCoreVersion = packageVersion("@ffmpeg/core")
const qpdfWasmVersion = packageVersion("@neslinesli93/qpdf-wasm")
const backgroundRemovalAssetKeys = [
	"/onnxruntime-web/ort-wasm-simd-threaded.wasm",
	"/onnxruntime-web/ort-wasm-simd-threaded.mjs",
	"/models/isnet_quint8",
]

function backgroundRemovalPrecacheEntries() {
	const resourcesPath = join("public", "background-removal", "resources.json")
	if (!existsSync(resourcesPath)) return []

	const resources = readFileSync(resourcesPath)
	const resourceMap = JSON.parse(resources.toString("utf-8")) as Record<
		string,
		{ chunks?: Array<{ name: string }> }
	>
	const chunkNames = new Set<string>()
	for (const key of backgroundRemovalAssetKeys) {
		for (const chunk of resourceMap[key]?.chunks ?? []) {
			chunkNames.add(chunk.name)
		}
	}

	return [
		{
			url: "/background-removal/resources.json",
			revision: createHash("sha256").update(resources).digest("hex"),
		},
		...[...chunkNames].sort().map((chunkName) => ({
			url: `/background-removal/${chunkName}`,
			revision: null,
		})),
	]
}

export default defineConfig({
	server: {
		host: true,
		port: 3000,
	},

	preview: {
		host: true,
		port: 3000,
	},
	plugins: [
		devtools(),
		tanstackStart({
			// router: {
			// 	autoCodeSplitting: false,
			// },
		}),
		react({
			reactCompiler: true,
		}),
		tailwindcss(),
		nitro({
			publicAssets: [
				{
					baseURL: "/",
					dir: "dist",
					maxAge: 0,
				},
			],
			externals: {
				external: ["@sentry/*"],
			},
		}),
		serwist({
			swSrc: "src/sw.ts",
			swDest: "sw.js",
			globPatterns: ["**/*"],
			globDirectory: ".output/public",
			additionalPrecacheEntries: [
				{ url: "/", revision: String(Date.now()) },
				{
					url: "/ffmpeg/ffmpeg-core.js",
					revision: `core-${ffmpegCoreVersion}`,
				},
				{
					url: "/ffmpeg/ffmpeg-core.wasm",
					revision: `core-${ffmpegCoreVersion}`,
				},
				{
					url: "/qpdf.wasm",
					revision: `qpdf-${qpdfWasmVersion}`,
				},
				...backgroundRemovalPrecacheEntries(),
			],
			injectionPoint: "self.__WB_MANIFEST",
			rollupFormat: "iife",
			devOptions: {
				enabled: true,
			},
			maximumFileSizeToCacheInBytes: 160 * 1024 * 1024,
		}),
	],

	test: {
		exclude: ["tests/e2e/**", "node_modules/**"],
	},
})
