import { useEffect, useState } from "react"

const THEMES = ["dracula", "cupcake"] as const
type Theme = (typeof THEMES)[number]

function getStoredTheme(): Theme {
	if (typeof window === "undefined") return "dracula"
	const stored = localStorage.getItem("Hanee-theme")
	if (stored === "dracula" || stored === "cupcake") return stored
	return "dracula"
}

export default function ThemeToggle() {
	const [theme, setTheme] = useState<Theme>("dracula")

	useEffect(() => {
		const initial = getStoredTheme()
		setTheme(initial)
		document.documentElement.setAttribute("data-theme", initial)
	}, [])

	function toggle() {
		const next: Theme = theme === "dracula" ? "cupcake" : "dracula"
		setTheme(next)
		document.documentElement.setAttribute("data-theme", next)
		localStorage.setItem("Hanee-theme", next)
	}

	return (
		<button
			type="button"
			onClick={toggle}
			className="btn btn-ghost btn-sm btn-circle"
			aria-label={`Switch to ${theme === "dracula" ? "light" : "dark"} mode`}
			title={`Current: ${theme}. Click to switch.`}
		>
			{theme === "dracula" ? "🌙" : "☀️"}
		</button>
	)
}
