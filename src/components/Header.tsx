import { Link } from "@tanstack/react-router"
import { useAppShell } from "./AppShellProvider"
import ThemeToggle from "./ThemeToggle"
import SearchBox from "./SearchBox"
import Icon from "./Icon"
import DebugConsole from "./DebugConsole"

function cloudIconName(cloud: {
	connected: boolean
	connecting: boolean
	configured: boolean
}): "cloud-check" | "cloud-off" | "cloud" {
	if (cloud.connected) return "cloud-check"
	if (!cloud.configured) return "cloud-off"
	return "cloud"
}

export default function Header() {
	const { isOnline, cloud } = useAppShell()

	const iconName = !isOnline ? "cloud-off" : cloudIconName(cloud)
	const iconColorClass = cloud.connected
		? "text-success"
		: !cloud.configured || !isOnline
			? "text-base-content/40"
			: ""

	return (
		<header className="navbar bg-base-100/80 backdrop-blur-lg border-b border-base-content/10 sticky top-0 z-50">
			<div className="max-w-6xl mx-auto w-full flex items-center px-4 gap-2 sm:gap-4">
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
				<div className="flex-1 flex justify-end items-center gap-1 sm:gap-4">
					<SearchBox />
					<div
						className="tooltip tooltip-bottom tooltip-warning before:max-w-[200px] before:whitespace-normal"
						data-tip="⚠️ For security, please disable all browser extensions for this site."
					>
						<button
							type="button"
							className={`btn btn-ghost btn-circle btn-sm ${iconColorClass}`}
							onClick={() =>
								void (cloud.connected ? cloud.disconnect() : cloud.connect())
							}
							disabled={cloud.connecting || !cloud.configured || !isOnline}
							title={cloud.disabledReason ?? cloud.status}
							aria-label={cloud.status}
						>
							{cloud.connecting ? (
								<span className="loading loading-spinner loading-xs" />
							) : (
								<Icon name={iconName} size={20} />
							)}
						</button>
					</div>
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
