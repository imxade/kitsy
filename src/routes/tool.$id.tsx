import { createFileRoute, Link } from "@tanstack/react-router"
import { getToolById } from "../lib/tool-registry"
import ToolPanel from "../components/ToolPanel"

export const Route = createFileRoute("/tool/$id")({
	component: ToolPage,
})

function ToolPage() {
	const { id } = Route.useParams()
	const tool = getToolById(id)

	if (!tool) {
		return (
			<main className="max-w-3xl mx-auto px-4 py-16 text-center">
				<div className="text-6xl mb-4">🔍</div>
				<h1 className="text-2xl font-bold text-base-content mb-2">
					Tool not found
				</h1>
				<p className="text-base-content/60 mb-6">
					The tool "{id}" doesn't exist or hasn't been implemented yet.
				</p>
				<Link to="/" className="btn btn-primary">
					Back to Home
				</Link>
			</main>
		)
	}

	return (
		<main className="max-w-3xl mx-auto px-4 pb-12 pt-8">
			{/* Breadcrumb */}
			<div className="breadcrumbs text-sm mb-6">
				<ul>
					<li>
						<Link to="/">Home</Link>
					</li>
					<li className="text-base-content/60">{tool.name}</li>
				</ul>
			</div>

			{/* Tool header */}
			<div className="flex items-center gap-4 mb-8">
				{/* <span className="text-4xl">{tool.icon}</span> */}
				<div>
					<h1 className="text-2xl font-bold text-base-content">{tool.name}</h1>
					<p className="text-base-content/60">{tool.description}</p>
				</div>
			</div>

			{/* Tool panel */}
			<ToolPanel tool={tool} />
		</main>
	)
}
