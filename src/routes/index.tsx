import { useState, useMemo, useId } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { getAllTools, getCategories } from "../lib/tool-registry"
import ToolCard from "../components/ToolCard"

export const Route = createFileRoute("/")({ component: HomePage })

function HomePage() {
	const categories = getCategories()
	const allTools = getAllTools()
	const [query, setQuery] = useState("")
	const searchInputId = useId()

	const filteredTools = useMemo(() => {
		const q = query.toLowerCase().trim()
		if (!q) return null // null = show all by category
		return allTools.filter(
			(t) =>
				t.name.toLowerCase().includes(q) ||
				t.description.toLowerCase().includes(q) ||
				t.category.toLowerCase().includes(q) ||
				t.acceptedExtensions.some((ext) => ext.toLowerCase().includes(q)),
		)
	}, [query, allTools])

	return (
		<main className="max-w-6xl mx-auto px-4 pb-12 pt-8">
			{/* Hero */}
			<section className="text-center mb-8">
				<h1 className="text-4xl sm:text-5xl font-extrabold text-base-content mb-4">
					Your files, your browser.
				</h1>
				<p className="text-lg text-base-content/60 max-w-2xl mx-auto">
					Convert, edit, and process files entirely in your browser. No uploads,
					no servers just fast, private, installable (PWA) for offline use.
				</p>
			</section>

			{/* Search */}
			<div className="flex justify-center mb-10">
				<label className="input input-bordered flex items-center gap-2 w-full max-w-md">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 16 16"
						fill="currentColor"
						className="w-4 h-4 opacity-50"
						aria-label="Search icon"
						role="img"
					>
						<path
							fillRule="evenodd"
							d="M9.965 11.026a5 5 0 1 1 1.06-1.06l2.755 2.754a.75.75 0 1 1-1.06 1.06l-2.755-2.754ZM10.5 7a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z"
							clipRule="evenodd"
						/>
					</svg>
					<input
						type="text"
						className="grow"
						placeholder="Search tools... (e.g. rotate, pdf, mp4)"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						id={searchInputId}
					/>
					{query && (
						<button
							type="button"
							className="btn btn-ghost btn-xs btn-circle"
							onClick={() => setQuery("")}
							aria-label="Clear search"
						>
							✕
						</button>
					)}
				</label>
			</div>

			{/* Filtered results */}
			{filteredTools !== null ? (
				filteredTools.length === 0 ? (
					<div className="text-center py-12 text-base-content/50">
						<div className="text-4xl mb-3">🔍</div>
						<p>No tools found for "{query}"</p>
					</div>
				) : (
					<section className="mb-10">
						<h2 className="text-xl font-bold text-base-content mb-4">
							{filteredTools.length} result
							{filteredTools.length !== 1 ? "s" : ""}
						</h2>
						<div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
							{filteredTools.map((tool) => (
								<ToolCard key={tool.id} tool={tool} />
							))}
						</div>
					</section>
				)
			) : (
				// Default: show by category
				categories.map((cat) => {
					const tools = allTools.filter((t) => t.category === cat.id)
					if (tools.length === 0) return null
					return (
						<section key={cat.id} className="mb-10">
							<h2 className="text-xl font-bold text-base-content mb-4 flex items-center gap-2">
								<span>{cat.icon}</span>
								{cat.label}
							</h2>
							<div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
								{tools.map((tool) => (
									<ToolCard key={tool.id} tool={tool} />
								))}
							</div>
						</section>
					)
				})
			)}
		</main>
	)
}
