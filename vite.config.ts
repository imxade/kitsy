import { defineConfig, type ViteDevServer, type PreviewServer } from "vite"
import { devtools } from "@tanstack/devtools-vite"
import tsconfigPaths from "vite-tsconfig-paths"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { nitro } from "nitro/vite"
import { serwist } from "@serwist/vite"

// 🔥 COOP/COEP middleware (fixes workers, wasm, ffmpeg)
function coopCoepMiddleware() {
	return {
		name: "coop-coep-middleware",

		configureServer(server: ViteDevServer) {
			server.middlewares.use((_req, res, next) => {
				res.setHeader("Cross-Origin-Opener-Policy", "same-origin")
				res.setHeader("Cross-Origin-Embedder-Policy", "require-corp")
				res.setHeader("Cross-Origin-Resource-Policy", "same-origin")
				next()
			})
		},

		configurePreviewServer(server: PreviewServer) {
			server.middlewares.use((_req, res, next) => {
				res.setHeader("Cross-Origin-Opener-Policy", "same-origin")
				res.setHeader("Cross-Origin-Embedder-Policy", "require-corp")
				res.setHeader("Cross-Origin-Resource-Policy", "same-origin")
				next()
			})
		},
	}
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

		coopCoepMiddleware(),

		nitro({
			rollupConfig: { external: [/^@sentry\//] },
			routeRules: {
				"/**": {
					headers: {
						"Cross-Origin-Opener-Policy": "same-origin",
						"Cross-Origin-Embedder-Policy": "require-corp",
						"Cross-Origin-Resource-Policy": "same-origin",
					},
				},
			},
		}),

		tsconfigPaths({ projects: ["./tsconfig.json"] }),
		tailwindcss(),
		tanstackStart(),
		viteReact(),

		serwist({
			swSrc: "src/sw.ts",
			swDest: "sw.js",
			globPatterns: ["**/*"],
			globDirectory: ".output/public",
			injectionPoint: "self.__WB_MANIFEST",
			rollupFormat: "iife",
			devOptions: {
				enabled: true,
			},
		}),
	],
})
