import { useNavigate, useSearch } from "@tanstack/react-router"
import { useState, useEffect, useId } from "react"
import Icon from "./Icon"

export default function SearchBox() {
	const navigate = useNavigate()
	const search = useSearch({ strict: false }) as { q?: string }
	const [value, setValue] = useState(search.q || "")
	const searchInputId = useId()

	useEffect(() => {
		setValue(search.q || "")
	}, [search.q])

	const handleSearch = (val: string) => {
		setValue(val)
		navigate({
			to: "/",
			search: (prev: Record<string, unknown>) => ({
				...prev,
				q: val || undefined,
			}),
			replace: true,
		})
	}

	return (
		<div className="flex-1 max-w-md mx-2">
			<label className="input input-bordered input-sm flex items-center gap-2 w-full">
				<Icon name="search" size={16} className="opacity-50" />
				<input
					type="text"
					className="grow"
					placeholder="Search tools..."
					value={value}
					onChange={(e) => handleSearch(e.target.value)}
					id={searchInputId}
				/>
				{value && (
					<button
						type="button"
						className="btn btn-ghost btn-xs btn-circle"
						onClick={() => handleSearch("")}
						aria-label="Clear search"
					>
						<Icon name="close" size={14} />
					</button>
				)}
			</label>
		</div>
	)
}
