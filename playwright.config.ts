import { defineConfig } from "@playwright/test"
import { devices } from "playwright-core"
import chromium from "@sparticuz/chromium"

const chromiumExecutablePath =
	process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
	(await chromium.executablePath())
const chromiumArgs = [
	"--disable-web-security",
	"--no-sandbox",
	"--disable-setuid-sandbox",
]
const serverPort = Number(process.env.PLAYWRIGHT_PORT ?? 3000)
const baseURL =
	process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${serverPort}`

export default defineConfig({
	testDir: "./tests/e2e",
	timeout: 60_000,
	expect: { timeout: 10_000 },
	fullyParallel: false,
	retries: 1,
	workers: 1,
	reporter: [["html"], ["list"]],
	use: {
		baseURL,
		colorScheme: "dark",
		viewport: { width: 1280, height: 720 },
		video: "on",
		actionTimeout: 15_000,
		trace: "retain-on-failure",
	},
	projects: [
		{
			name: "sparticuz-chromium",
			use: {
				...devices["Desktop Chrome"],
				viewport: { width: 1280, height: 720 },
				launchOptions: {
					executablePath: chromiumExecutablePath,
					args: chromiumArgs,
				},
			},
		},
	],
	webServer: {
		command: `npm run build && npm run preview -- --port ${serverPort}`,
		port: serverPort,
		reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "1",
		timeout: 120_000,
	},
})
