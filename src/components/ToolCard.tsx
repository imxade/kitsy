import { Link } from "@tanstack/react-router"
import type { ToolDefinition } from "../lib/tool-registry"

export default function ToolCard({ tool }: { tool: ToolDefinition }) {
	return (
		<Link
			to="/tool/$id"
			params={{ id: tool.id }}
			className="card bg-base-100 shadow-md hover:shadow-xl border border-base-content/5 transition-all duration-200 hover:-translate-y-1 no-underline group"
		>
			<div className="card-body p-5">
				<div className="flex items-start gap-3">
					{/* <span className="text-3xl">{tool.icon}</span> */}
					<div className="flex-1 min-w-0">
						<h3 className="card-title text-base font-bold text-base-content group-hover:text-primary transition-colors">
							{tool.name}
						</h3>
						<p className="text-sm text-base-content/60 mt-1 line-clamp-2">
							{tool.description}
						</p>
					</div>
				</div>
				<div className="card-actions justify-end mt-3">
					<span className="badge badge-ghost badge-sm text-xs">
						{tool.acceptedExtensions[0] === "*"
							? "Any file"
							: tool.acceptedExtensions.join(" ")}
					</span>
				</div>
			</div>
		</Link>
	)
}
