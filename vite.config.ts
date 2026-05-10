/// <reference types="vitest/config" />

import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import { nitro } from "nitro/vite"
import { serwist } from "@serwist/vite"
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
