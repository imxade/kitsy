import { Link } from "@tanstack/react-router"
import ThemeToggle from "./ThemeToggle"
import SearchBox from "./SearchBox"
import Icon from "./Icon"
import DebugConsole from "./DebugConsole"

export default function Header() {
	return (
		<header className="navbar bg-base-100/80 backdrop-blur-lg border-b border-base-content/10 sticky top-0 z-50">
			<div className="max-w-6xl mx-auto w-full flex items-center px-4 gap-4">
				{/* Brand */}
				<div className="flex-none">
					<Link
						to="/"
						className="text-xl font-extrabold text-base-content no-underline flex items-center gap-2 hover:opacity-80 transition-opacity"
					>
						Kitsy
					</Link>
				</div>

				{/* Nav */}
				<div className="flex-1 flex justify-end items-center gap-4">
					<SearchBox />
					<a
						href="http://github.com/imxade/Kitsy"
						target="_blank"
						rel="noreferrer"
						className="btn btn-ghost btn-circle btn-sm"
						aria-label="GitHub Repository"
					>
						<span className="sr-only">GitHub Repository</span>
						<Icon name="github" />
					</a>
					<DebugConsole />
					<ThemeToggle />
				</div>
			</div>
		</header>
	)
}
