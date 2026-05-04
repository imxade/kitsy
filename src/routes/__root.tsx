import {
	HeadContent,
	Scripts,
	createRootRoute,
	useRouter,
} from "@tanstack/react-router"
import { useEffect } from "react"
import AppShellProvider from "../components/AppShellProvider"
import Header from "../components/Header"
import "../styles.css"

const THEME_INIT_SCRIPT = `
try {
	var t = localStorage.getItem('Kitsy-theme') || 'dracula';
	document.documentElement.setAttribute('data-theme', t);
} catch (e) {}
`

/**
 * Map of route path prefixes to their dedicated PWA manifests.
 * When installed from one of these routes, the PWA opens to that route.
 */
const ROUTE_MANIFESTS: Record<string, string> = {
	"/tool/todo-list": "/manifest-todo.json",
}

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "Kitsy | Browser-Based File Tools" },
			{
				name: "description",
				content:
					"Convert, edit, and process files locally in your browser with optional Google Drive sync and offline-ready PWA support.",
			},
			{
				httpEquiv: "Content-Security-Policy",
				content:
					"default-src 'self'; " +
					// allow inline (needed), but restrict everything else
					"script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; " +
					"style-src 'self' 'unsafe-inline'; " +
					"connect-src 'self' https://oauth2.googleapis.com https://www.googleapis.com; " +
					"img-src 'self' data: blob:; " +
					"media-src 'self' data: blob:; " +
					"worker-src 'self' blob:; " +
					"frame-src 'self' blob:; " +
					"child-src 'self' blob:; " +
					"object-src 'none'; " +
					"base-uri 'self'; " +
					"frame-ancestors 'none';",
			},
		],
		links: [{ rel: "manifest", href: "/manifest.json" }],
	}),
	shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
	const router = useRouter()

	useEffect(() => {
		// Preload the tool component chunk correctly using the router
		router.preloadRoute({ to: "/tool/$id", params: { id: "image-convert" } })
	}, [router])

	// Swap the manifest <link> based on the current route so PWAs installed
	// from specific pages (e.g. /tool/todo-list) open to that route by default.
	useEffect(() => {
		const pathname = router.state.location.pathname
		const manifestHref =
			Object.entries(ROUTE_MANIFESTS).find(([prefix]) =>
				pathname.startsWith(prefix),
			)?.[1] ?? "/manifest.json"

		const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
		if (link && link.href !== new URL(manifestHref, location.origin).href) {
			link.href = manifestHref
		}
	})

	return (
		<html lang="en" data-theme="dracula" suppressHydrationWarning>
			<head>
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: Theme initialization script */}
				<script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
				<HeadContent />
			</head>
			<body
				className="min-h-screen bg-base-200 font-sans antialiased"
				suppressHydrationWarning
			>
				<AppShellProvider>
					<div className="flex flex-col min-h-screen">
						<Header />
						<div className="flex-1">{children}</div>
					</div>
				</AppShellProvider>
				<Scripts />
			</body>
		</html>
	)
}
