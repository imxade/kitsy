import {
	HeadContent,
	Scripts,
	createRootRoute,
	useRouter,
} from "@tanstack/react-router"
import { useEffect } from "react"
import Footer from "../components/Footer"
import Header from "../components/Header"
import { prefetchFFmpeg } from "../lib/ffmpeg-processor"
import appCss from "../styles.css?url"

const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('Kitsy-theme')||'dracula';document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "Kitsy | Browser-Based File Tools" },
			{
				name: "description",
				content:
					"Convert, edit, and process files entirely in your browser. No uploads, no servers.",
			},
		],
		links: [
			{ rel: "stylesheet", href: appCss },
			{ rel: "manifest", href: "/manifest.json" },
		],
	}),
	shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
	const router = useRouter()

	useEffect(() => {
		prefetchFFmpeg()
		// Preload the tool component chunk correctly using the router
		router.preloadRoute({ to: "/tool/$id", params: { id: "image-convert" } })
	}, [router])

	return (
		<html lang="en" data-theme="dracula" suppressHydrationWarning>
			<head>
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: Theme initialization script */}
				<script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
				<HeadContent />
			</head>
			<body className="min-h-screen bg-base-200 font-sans antialiased">
				<div className="flex flex-col min-h-screen">
					<Header />
					<div className="flex-1">{children}</div>
					<Footer />
				</div>
				<Scripts />
			</body>
		</html>
	)
}
