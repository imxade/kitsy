import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { getAllTools, getCategories } from "../lib/tool-registry"
import { rankToolsByQuery } from "../lib/search"
import ToolCard from "../components/ToolCard"
import Icon from "../components/Icon"

const searchSchema = z.object({
	q: z.string().optional().catch(""),
})

export const Route = createFileRoute("/")({
	validateSearch: (search) => searchSchema.parse(search),
	component: HomePage,
})

function HomePage() {
	const { q: query = "" } = Route.useSearch()
	const categories = getCategories()
	const allTools = getAllTools()
	const filteredTools = rankToolsByQuery(allTools, query)

	return (
		<main className="max-w-6xl mx-auto px-4 pb-12 pt-8">
			{/* Hero */}
			<section className="text-center mb-12">
				<h1 className="text-4xl sm:text-5xl font-extrabold text-base-content mb-4">
					Your files, your browser.
				</h1>
				<p className="text-lg text-base-content/60 max-w-2xl mx-auto">
					Convert, edit, and process files entirely in your browser. No backend,
					optional Google Drive sync, and installable offline as a PWA.
				</p>
			</section>

			{/* Filtered results */}
			{filteredTools !== null ? (
				filteredTools.length === 0 ? (
					<div className="text-center py-12 text-base-content/30 flex flex-col items-center">
						<Icon name="search" size={64} strokeWidth={1} className="mb-4" />
						<p className="text-lg">No tools found for "{query}"</p>
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
