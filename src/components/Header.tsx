import { Link } from "@tanstack/react-router"
import ThemeToggle from "./ThemeToggle"

export default function Header() {
	return (
		<header className="navbar bg-base-100/80 backdrop-blur-lg border-b border-base-content/10 sticky top-0 z-50">
			<div className="max-w-6xl mx-auto w-full flex items-center px-4">
				{/* Brand */}
				<div className="flex-1">
					<Link
						to="/"
						className="text-xl font-extrabold text-base-content no-underline flex items-center gap-2 hover:opacity-80 transition-opacity"
					>
						Hanee
					</Link>
				</div>

				{/* Nav */}
				<div className="flex items-center gap-4">
					<a
						href="http://github.com/imxade/Hanee"
						target="_blank"
						rel="noreferrer"
						className="btn btn-ghost btn-circle btn-sm"
						aria-label="GitHub Repository"
					>
						<span className="sr-only">GitHub Repository</span>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="20"
							height="20"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
							aria-hidden="true"
						>
							<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.2c3-.3 6-1.5 6-6.5a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 5 3 6.2 6 6.5a4.8 4.8 0 0 0-1 3.2v4" />
						</svg>
					</a>
					<ThemeToggle />
				</div>
			</div>
		</header>
	)
}
