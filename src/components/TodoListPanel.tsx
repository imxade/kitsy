import {
	useDeferredValue,
	useEffect,
	useRef,
	useState,
	type ChangeEvent,
} from "react"
import { useAppShell } from "./AppShellProvider"
import Icon from "./Icon"
import {
	TODO_STORAGE_KEY,
	createTodoItem,
	getVisibleTodoItems,
	isTodoReminderToday,
	matchesTodoQuery,
	mergeTodoItems,
	parseTodoItems,
	parseTodoSyncDocument,
	serializeTodoExport,
	serializeTodoItems,
	serializeTodoSyncDocument,
	splitTodoText,
	type TodoItem,
} from "../lib/todo-list"

type FilterMode = "all" | "open" | "done"

function formatReminderDate(value: string | null) {
	if (!value) return null
	return new Date(`${value}T00:00:00.000Z`).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		year: "numeric",
		timeZone: "UTC",
	})
}

function readEditableText(element: HTMLElement) {
	return (element.innerText || element.textContent || "")
		.replace(/\r\n/g, "\n")
		.replace(/\u00a0/g, " ")
}

function moveCaretToEnd(element: HTMLElement) {
	const selection = window.getSelection()
	if (!selection) return

	const range = document.createRange()
	range.selectNodeContents(element)
	range.collapse(false)
	selection.removeAllRanges()
	selection.addRange(range)
}

function insertPlainTextAtSelection(element: HTMLElement, text: string) {
	const selection = window.getSelection()
	if (!selection || !selection.rangeCount) {
		element.textContent = `${element.textContent ?? ""}${text}`
		moveCaretToEnd(element)
		return
	}

	const anchor = selection.anchorNode
	if (anchor && !element.contains(anchor)) {
		element.textContent = `${element.textContent ?? ""}${text}`
		moveCaretToEnd(element)
		return
	}

	const range = selection.getRangeAt(0)
	range.deleteContents()
	const textNode = document.createTextNode(text)
	range.insertNode(textNode)
	range.setStartAfter(textNode)
	range.collapse(true)
	selection.removeAllRanges()
	selection.addRange(range)
}

function TodoTextContent({ item }: { item: TodoItem }) {
	return (
		<>
			{splitTodoText(item.text).map((segment, index) =>
				segment.href ? (
					<a
						key={`${item.id}-link-${index}`}
						href={segment.href}
						target="_blank"
						rel="noreferrer noopener"
						className="link link-hover break-all"
						data-testid="todo-link"
						onClick={(event) => event.stopPropagation()}
						onMouseDown={(event) => event.stopPropagation()}
					>
						{segment.text}
					</a>
				) : (
					<span key={`${item.id}-text-${index}`}>{segment.text}</span>
				),
			)}
		</>
	)
}

function EditableTodoCard({
	item,
	isDraft = false,
	onTextChange,
	onBlur,
	onToggleComplete,
	onReminderChange,
	onTogglePin,
	onRemove,
}: {
	item: TodoItem
	isDraft?: boolean
	onTextChange: (text: string) => void
	onBlur: () => void
	onToggleComplete?: () => void
	onReminderChange: (value: string | null) => void
	onTogglePin?: () => void
	onRemove?: () => void
}) {
	const editorRef = useRef<HTMLDivElement>(null)
	const editingItemIdRef = useRef<string | null>(null)
	const [isExpanded, setIsExpanded] = useState(false)
	const [isEditing, setIsEditing] = useState(false)
	const [clickCoords, setClickCoords] = useState<{
		x: number
		y: number
	} | null>(null)
	const reminderToday = !isDraft && isTodoReminderToday(item)
	const showEditor = isDraft || isEditing

	useEffect(() => {
		if (!showEditor) {
			editingItemIdRef.current = null
			return
		}

		const editor = editorRef.current
		if (!editor || editingItemIdRef.current === item.id) return

		editingItemIdRef.current = item.id
		editor.textContent = item.text

		if (isEditing) {
			editor.focus()

			if (clickCoords) {
				const { x, y } = clickCoords
				setClickCoords(null)

				let range: Range | null = null
				if (document.caretRangeFromPoint) {
					range = document.caretRangeFromPoint(x, y)
				} else if ("caretPositionFromPoint" in document) {
					const pos = (
						document as Document & {
							caretPositionFromPoint: (
								x: number,
								y: number,
							) => { offsetNode: Node; offset: number } | null
						}
					).caretPositionFromPoint(x, y)
					if (pos) {
						range = document.createRange()
						range.setStart(pos.offsetNode, pos.offset)
						range.collapse(true)
					}
				}

				if (range && editor.contains(range.startContainer)) {
					const selection = window.getSelection()
					if (selection) {
						selection.removeAllRanges()
						selection.addRange(range)
					}
				} else {
					moveCaretToEnd(editor)
				}
			} else {
				moveCaretToEnd(editor)
			}
		}
	}, [isEditing, item.id, item.text, showEditor, clickCoords])

	const startEditing = (x?: number, y?: number) => {
		if (x !== undefined && y !== undefined) setClickCoords({ x, y })
		setIsEditing(true)
		setIsExpanded(true)
	}

	const editableClassName = `w-full rounded-md px-0 py-0 text-sm leading-6 whitespace-pre-wrap break-words focus:outline-none focus:ring-2 focus:ring-primary/30 ${
		isExpanded || isEditing
			? "max-h-[60vh] overflow-y-auto"
			: "max-h-6 overflow-hidden"
	} ${item.completed ? "text-base-content/60 line-through" : ""}`

	return (
		<fieldset
			className={`rounded-xl border px-4 py-3 transition-all ${
				reminderToday
					? "border-warning/40 bg-warning/10"
					: item.pinned
						? "border-primary/30 bg-primary/5"
						: "border-base-content/10 bg-base-200/40"
			}`}
			data-testid={isDraft ? "todo-draft" : "todo-item"}
			onMouseEnter={() => setIsExpanded(true)}
			onMouseLeave={() => {
				if (!isEditing && document.activeElement !== editorRef.current) {
					setIsExpanded(false)
				}
			}}
			onBlur={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget as Node)) {
					setIsEditing(false)
					setIsExpanded(false)
					onBlur()
				}
			}}
		>
			<div className="flex gap-3">
				{isDraft ? (
					<div className="mt-2 flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-base-content/20 text-[10px] text-base-content/40">
						+
					</div>
				) : (
					<input
						type="checkbox"
						className="checkbox checkbox-primary checkbox-sm mt-2"
						checked={item.completed}
						onChange={onToggleComplete}
						aria-label={
							item.completed ? "Mark todo as open" : "Mark todo as done"
						}
					/>
				)}

				<div className="min-w-0 flex-1">
					{showEditor ? (
						<div className="relative">
							{/* biome-ignore lint/a11y/useSemanticElements: contenteditable is required so todo links can render inline outside edit mode without textarea link handling. */}
							<div
								ref={editorRef}
								role="textbox"
								tabIndex={0}
								aria-label={isDraft ? "Draft todo text" : "Todo text"}
								aria-multiline="true"
								contentEditable
								suppressContentEditableWarning
								className={editableClassName}
								data-testid={isDraft ? "todo-draft-input" : "todo-edit-input"}
								onFocus={() => {
									setIsExpanded(true)
									setIsEditing(true)
								}}
								onInput={(event) =>
									onTextChange(readEditableText(event.currentTarget))
								}
								onPaste={(event) => {
									event.preventDefault()
									const text = event.clipboardData.getData("text/plain")
									insertPlainTextAtSelection(event.currentTarget, text)
									onTextChange(readEditableText(event.currentTarget))
								}}
							/>
							{item.text.length === 0 && (
								<span className="pointer-events-none absolute left-0 top-0 text-sm leading-6 text-base-content/45">
									{isDraft ? "Write a todo..." : "Empty todo deletes on blur"}
								</span>
							)}
						</div>
					) : (
						// biome-ignore lint/a11y/useSemanticElements: the editable preview can contain anchors, so a native button would create invalid nested interactive content.
						<div
							role="button"
							tabIndex={0}
							aria-label="Edit todo text"
							className={`${editableClassName} cursor-text`}
							onClick={(event) => {
								const target = event.target as HTMLElement
								if (target.closest("a")) return
								startEditing(event.clientX, event.clientY)
							}}
							onKeyDown={(event) => {
								if (
									event.key !== "Enter" &&
									event.key !== " " &&
									event.key !== "F2"
								)
									return
								event.preventDefault()
								startEditing()
							}}
						>
							{item.text.trim().length > 0 ? (
								<TodoTextContent item={item} />
							) : (
								<span className="text-base-content/40">
									Empty todo deletes on blur
								</span>
							)}
						</div>
					)}

					<div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-base-content/45">
						<input
							type="date"
							className="input input-bordered input-xs w-[9.5rem]"
							value={item.reminderDate ?? ""}
							onChange={(event) => onReminderChange(event.target.value || null)}
							aria-label={isDraft ? "Draft reminder date" : "Reminder date"}
						/>
						{item.reminderDate && (
							<span
								className={`badge badge-sm ${
									reminderToday ? "badge-warning" : "badge-ghost"
								}`}
							>
								Reminder {formatReminderDate(item.reminderDate)}
							</span>
						)}
						{!isDraft && (
							<span>Added {new Date(item.createdAt).toLocaleString()}</span>
						)}
						{isDraft && item.text.trim().length > 0 && (
							<span>Autosaved draft</span>
						)}
						<div className="flex-1" />
						{onTogglePin && (
							<button
								type="button"
								className={`btn btn-ghost btn-xs btn-circle ${item.pinned ? "text-primary" : ""}`}
								onClick={onTogglePin}
								aria-label={
									item.pinned
										? `Unpin ${item.text || "todo"}`
										: `Pin ${item.text || "todo"}`
								}
								title={item.pinned ? "Unpin" : "Pin to top"}
							>
								<Icon name={item.pinned ? "pinned" : "pinned-off"} size={14} />
							</button>
						)}
						{onRemove && (
							<button
								type="button"
								className="btn btn-ghost btn-xs btn-circle"
								onClick={onRemove}
								aria-label={`Remove ${item.text || "todo"}`}
							>
								<Icon name="trash" size={14} />
							</button>
						)}
					</div>
				</div>
			</div>
		</fieldset>
	)
}

function TodoSection({
	title,
	items,
	emptyText,
	onTextChange,
	onBlur,
	onToggleComplete,
	onReminderChange,
	onTogglePin,
	onRemove,
}: {
	title: string
	items: TodoItem[]
	emptyText: string
	onTextChange: (id: string, text: string) => void
	onBlur: (id: string) => void
	onToggleComplete: (id: string) => void
	onReminderChange: (id: string, value: string | null) => void
	onTogglePin: (id: string) => void
	onRemove: (id: string) => void
}) {
	const reminderItems = items.filter((item) => isTodoReminderToday(item))
	const regularItems = items.filter((item) => !isTodoReminderToday(item))

	return (
		<section className="space-y-3">
			<div className="flex items-center justify-between">
				<h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-base-content/50">
					{title}
				</h3>
				<span className="text-xs text-base-content/40">{items.length}</span>
			</div>

			{reminderItems.length > 0 && (
				<div className="space-y-2">
					<p className="text-xs font-semibold text-warning">
						Today&apos;s reminders
					</p>
					{reminderItems.map((item) => (
						<EditableTodoCard
							key={item.id}
							item={item}
							onTextChange={(text) => onTextChange(item.id, text)}
							onBlur={() => onBlur(item.id)}
							onToggleComplete={() => onToggleComplete(item.id)}
							onReminderChange={(value) => onReminderChange(item.id, value)}
							onTogglePin={() => onTogglePin(item.id)}
							onRemove={() => onRemove(item.id)}
						/>
					))}
				</div>
			)}

			{regularItems.length === 0 && reminderItems.length === 0 ? (
				<div className="rounded-xl border border-dashed border-base-content/20 p-6 text-center text-sm text-base-content/50">
					{emptyText}
				</div>
			) : (
				regularItems.map((item) => (
					<EditableTodoCard
						key={item.id}
						item={item}
						onTextChange={(text) => onTextChange(item.id, text)}
						onBlur={() => onBlur(item.id)}
						onToggleComplete={() => onToggleComplete(item.id)}
						onReminderChange={(value) => onReminderChange(item.id, value)}
						onTogglePin={() => onTogglePin(item.id)}
						onRemove={() => onRemove(item.id)}
					/>
				))
			)}
		</section>
	)
}

export default function TodoListPanel() {
	const { isOnline, cloud } = useAppShell()
	const [isClientReady, setIsClientReady] = useState(false)
	const [items, setItems] = useState<TodoItem[]>([])
	const [filter, setFilter] = useState<FilterMode>("open")
	const [search, setSearch] = useState("")
	const [status, setStatus] = useState<string | null>(null)
	const [syncStatus, setSyncStatus] = useState<string | null>(null)
	const [hasLoaded, setHasLoaded] = useState(false)
	const hasHydratedFromCloudRef = useRef(false)
	const importInputRef = useRef<HTMLInputElement>(null)
	const syncTimerRef = useRef<number | null>(null)
	const emptyDraftRef = useRef<TodoItem | null>(null)
	const loadTodoDocumentRef = useRef(cloud.loadTodoDocument)
	const saveTodoDocumentRef = useRef(cloud.saveTodoDocument)
	const deferredSearch = useDeferredValue(search)

	useEffect(() => {
		setIsClientReady(true)
	}, [])

	useEffect(() => {
		loadTodoDocumentRef.current = cloud.loadTodoDocument
		saveTodoDocumentRef.current = cloud.saveTodoDocument
	}, [cloud.loadTodoDocument, cloud.saveTodoDocument])

	useEffect(() => {
		try {
			const saved = window.localStorage.getItem(TODO_STORAGE_KEY)
			if (saved) setItems(parseTodoItems(saved, { allowEmpty: true }))
		} catch (error) {
			setStatus(
				error instanceof Error
					? error.message
					: "Failed to load saved todo items.",
			)
		} finally {
			setHasLoaded(true)
		}
	}, [])

	useEffect(() => {
		if (!hasLoaded) return
		window.localStorage.setItem(TODO_STORAGE_KEY, serializeTodoItems(items))
	}, [items, hasLoaded])

	useEffect(() => {
		if (!cloud.connected) {
			hasHydratedFromCloudRef.current = false
			return
		}
		if (!hasLoaded || hasHydratedFromCloudRef.current) return

		let cancelled = false

		void (async () => {
			const raw = await loadTodoDocumentRef.current()
			if (cancelled) return

			if (raw) {
				try {
					const remote = parseTodoSyncDocument(raw)
					setItems((prev) => mergeTodoItems(prev, remote.items))
					setSyncStatus("Drive sync restored and merged automatically.")
				} catch (error) {
					setSyncStatus(
						error instanceof Error
							? error.message
							: "Failed to parse Drive todo list.",
					)
				}
			} else {
				setSyncStatus("Drive sync is active.")
			}

			hasHydratedFromCloudRef.current = true
		})()

		return () => {
			cancelled = true
		}
	}, [cloud.connected, hasLoaded])

	useEffect(() => {
		if (!hasLoaded || !cloud.connected || !hasHydratedFromCloudRef.current)
			return

		if (syncTimerRef.current) window.clearTimeout(syncTimerRef.current)
		syncTimerRef.current = window.setTimeout(() => {
			void (async () => {
				const ok = await saveTodoDocumentRef.current(
					serializeTodoSyncDocument(items),
				)
				if (ok) setSyncStatus("Drive sync is up to date.")
			})()
		}, 700)

		return () => {
			if (syncTimerRef.current) window.clearTimeout(syncTimerRef.current)
		}
	}, [cloud.connected, items, hasLoaded])

	if (!emptyDraftRef.current) {
		emptyDraftRef.current = createTodoItem("", {
			draft: true,
		})
	}

	const visibleItems = getVisibleTodoItems(items)
	const draftItem =
		items
			.filter((item) => item.draft && !item.deletedAt)
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ??
		emptyDraftRef.current
	const filteredItems = visibleItems.filter((item) =>
		matchesTodoQuery(item, deferredSearch),
	)

	const openItems = filteredItems.filter((item) => !item.completed)
	const doneItems = filteredItems.filter((item) => item.completed)
	const counts = {
		all: visibleItems.length,
		open: visibleItems.filter((item) => !item.completed).length,
		done: visibleItems.filter((item) => item.completed).length,
	}

	const setDraftState = (text: string, reminderDate: string | null) => {
		setItems((prev) => {
			const draft = prev
				.filter((item) => item.draft && !item.deletedAt)
				.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
			const updatedAt = new Date().toISOString()

			if (!draft) {
				if (text.trim().length === 0 && !reminderDate) return prev
				return mergeTodoItems(prev, [
					createTodoItem(text, {
						draft: true,
						reminderDate,
						updatedAt,
					}),
				])
			}

			return prev.map((item) =>
				item.id === draft.id
					? {
							...item,
							text,
							reminderDate,
							updatedAt,
						}
					: item,
			)
		})
		setStatus(null)
	}

	const commitDraft = () => {
		setItems((prev) => {
			const draft = prev
				.filter((item) => item.draft && !item.deletedAt)
				.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
			if (!draft) return prev

			if (draft.text.trim().length === 0) {
				return prev.filter((item) => item.id !== draft.id)
			}

			const updatedAt = new Date().toISOString()
			return prev.map((item) =>
				item.id === draft.id
					? {
							...item,
							draft: false,
							updatedAt,
						}
					: item,
			)
		})
	}

	const updateTodoItem = (id: string, patch: Partial<TodoItem>) => {
		setItems((prev) =>
			prev.map((item) =>
				item.id === id
					? {
							...item,
							...patch,
							updatedAt: new Date().toISOString(),
						}
					: item,
			),
		)
		setStatus(null)
	}

	const removeTodoItem = (id: string) => {
		setItems((prev) =>
			prev.map((item) =>
				item.id === id
					? {
							...item,
							deletedAt: new Date().toISOString(),
							updatedAt: new Date().toISOString(),
						}
					: item,
			),
		)
	}

	const togglePinItem = (id: string) => {
		const item = items.find((entry) => entry.id === id)
		if (!item) return
		updateTodoItem(id, { pinned: !item.pinned })
	}

	const handleItemBlur = (id: string) => {
		const item = items.find((entry) => entry.id === id)
		if (!item) return
		if (item.text.trim().length === 0) {
			removeTodoItem(id)
		}
	}

	const exportItems = () => {
		const blob = new Blob([serializeTodoExport(items)], {
			type: "application/json",
		})
		const url = URL.createObjectURL(blob)
		const anchor = document.createElement("a")
		anchor.href = url
		anchor.download = "kitsy-todo-list.json"
		document.body.appendChild(anchor)
		anchor.click()
		document.body.removeChild(anchor)
		window.setTimeout(() => URL.revokeObjectURL(url), 1000)
		setStatus(
			`Exported ${getVisibleTodoItems(items).length} todo item${getVisibleTodoItems(items).length === 1 ? "" : "s"}.`,
		)
	}

	const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0]
		if (!file) return

		try {
			const imported = parseTodoItems(await file.text())
			setItems((prev) => mergeTodoItems(prev, imported))
			setStatus(
				`Imported ${imported.length} item${imported.length === 1 ? "" : "s"} into the current list.`,
			)
		} catch (error) {
			setStatus(
				error instanceof Error ? error.message : "Failed to import todo list.",
			)
		} finally {
			event.target.value = ""
		}
	}

	const clearCompleted = () => {
		const now = new Date().toISOString()
		setItems((prev) =>
			prev.map((item) =>
				item.completed && !item.deletedAt
					? {
							...item,
							deletedAt: now,
							updatedAt: now,
						}
					: item,
			),
		)
	}

	return (
		<div className="card bg-base-100 border border-base-content/10">
			<div className="card-body gap-4">
				<EditableTodoCard
					item={draftItem}
					isDraft
					onTextChange={(text) => setDraftState(text, draftItem.reminderDate)}
					onBlur={commitDraft}
					onReminderChange={(value) => setDraftState(draftItem.text, value)}
				/>
				<div className="flex flex-col gap-3 sm:flex-row">
					<label className="input input-bordered flex items-center gap-2 flex-1">
						<Icon name="search" size={16} className="opacity-50" />
						<input
							type="text"
							className="grow"
							placeholder="Search todos"
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							data-testid="todo-input"
						/>
					</label>
				</div>

				<div className="flex flex-wrap gap-2">
					{(["open", "done", "all"] as const).map((value) => (
						<button
							key={value}
							type="button"
							className={`btn btn-sm ${filter === value ? "btn-primary" : "btn-ghost"}`}
							onClick={() => setFilter(value)}
						>
							{value === "all" ? "All" : value === "open" ? "Open" : "Done"} (
							{counts[value]})
						</button>
					))}
					<div className="flex-1" />
					<button
						type="button"
						className="btn btn-sm btn-outline"
						onClick={() => importInputRef.current?.click()}
					>
						Import JSON
					</button>
					<button
						type="button"
						className="btn btn-sm btn-outline"
						onClick={exportItems}
						data-testid="todo-export"
					>
						Download JSON
					</button>
					<button
						type="button"
						className="btn btn-sm btn-ghost"
						onClick={clearCompleted}
					>
						Clear Completed
					</button>
				</div>

				<input
					ref={importInputRef}
					type="file"
					accept=".json,application/json"
					className="hidden"
					onChange={handleImport}
					data-testid="todo-import"
				/>
				{isClientReady && (
					<span className="hidden" data-testid="todo-mounted">
						ready
					</span>
				)}

				<div className="rounded-xl border border-base-content/10 bg-base-200/20 p-3 text-xs text-base-content/60 space-y-1">
					<p>
						{!isOnline
							? "Offline. Todos still autosave locally, but cloud sync and uploads are disabled."
							: cloud.connected
								? "Google Drive sync is active. Todo changes are synced automatically."
								: cloud.configured
									? "Connect Google Drive to auto-sync this todo list."
									: "Google Drive is not configured in this deployment, so todos stay local only."}
					</p>
					<p className="opacity-70 italic">
						Tip: Clicking outside a todo or tabbing away saves it automatically.
					</p>
				</div>

				{status && (
					<div className="alert alert-info">
						<span>{status}</span>
					</div>
				)}

				{(syncStatus || cloud.error) && (
					<div
						className={`alert ${cloud.error ? "alert-warning" : "alert-success"}`}
					>
						<span>{cloud.error ?? syncStatus}</span>
					</div>
				)}

				<div className="space-y-4" data-testid="todo-list-panel">
					{filter === "all" ? (
						<div className="space-y-5">
							<TodoSection
								title="Open"
								items={openItems}
								emptyText="No open tasks match this view yet."
								onTextChange={(id, text) => updateTodoItem(id, { text })}
								onBlur={handleItemBlur}
								onToggleComplete={(id) => {
									const item = items.find((entry) => entry.id === id)
									if (!item) return
									updateTodoItem(id, { completed: !item.completed })
								}}
								onReminderChange={(id, value) =>
									updateTodoItem(id, { reminderDate: value })
								}
								onTogglePin={togglePinItem}
								onRemove={removeTodoItem}
							/>
							<TodoSection
								title="Completed"
								items={doneItems}
								emptyText="No completed tasks match this view yet."
								onTextChange={(id, text) => updateTodoItem(id, { text })}
								onBlur={handleItemBlur}
								onToggleComplete={(id) => {
									const item = items.find((entry) => entry.id === id)
									if (!item) return
									updateTodoItem(id, { completed: !item.completed })
								}}
								onReminderChange={(id, value) =>
									updateTodoItem(id, { reminderDate: value })
								}
								onTogglePin={togglePinItem}
								onRemove={removeTodoItem}
							/>
						</div>
					) : (
						<TodoSection
							title={filter === "open" ? "Open" : "Completed"}
							items={filter === "open" ? openItems : doneItems}
							emptyText={`No ${filter === "open" ? "open" : "completed"} tasks match this view yet.`}
							onTextChange={(id, text) => updateTodoItem(id, { text })}
							onBlur={handleItemBlur}
							onToggleComplete={(id) => {
								const item = items.find((entry) => entry.id === id)
								if (!item) return
								updateTodoItem(id, { completed: !item.completed })
							}}
							onReminderChange={(id, value) =>
								updateTodoItem(id, { reminderDate: value })
							}
							onTogglePin={togglePinItem}
							onRemove={removeTodoItem}
						/>
					)}
				</div>
			</div>
		</div>
	)
}
