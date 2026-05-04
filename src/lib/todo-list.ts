export interface TodoItem {
	id: string
	text: string
	completed: boolean
	createdAt: string
	updatedAt: string
	reminderDate: string | null
	deletedAt: string | null
	draft: boolean
	pinned: boolean
}

export interface TodoSyncDocument {
	version: 2
	syncedAt: string
	items: TodoItem[]
}

export interface TodoTextSegment {
	text: string
	href?: string
}

export const TODO_STORAGE_KEY = "kitsy.todo-list.v1"
const TODO_URL_PATTERN = /https?:\/\/\S+/g

function normalizeIsoDate(value: unknown, fallback: string) {
	return typeof value === "string" && value.length > 0 ? value : fallback
}

function normalizeReminderDate(value: unknown) {
	if (typeof value !== "string") return null
	return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

function getTodoRevision(item: TodoItem) {
	return Date.parse(item.deletedAt || item.updatedAt || item.createdAt) || 0
}

function compareTodoRevision(a: TodoItem, b: TodoItem) {
	// Pinned items always come first
	if (a.pinned && !b.pinned) return -1
	if (!a.pinned && b.pinned) return 1

	return (
		getTodoRevision(b) - getTodoRevision(a) ||
		Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
		b.id.localeCompare(a.id)
	)
}

function sanitizeTodoItem(
	raw: Partial<TodoItem> & Pick<TodoItem, "id" | "text">,
) {
	const createdAt = normalizeIsoDate(raw.createdAt, new Date().toISOString())
	return {
		id: raw.id,
		text: raw.text,
		completed: Boolean(raw.completed),
		createdAt,
		updatedAt: normalizeIsoDate(raw.updatedAt, createdAt),
		reminderDate: normalizeReminderDate(raw.reminderDate),
		deletedAt:
			typeof raw.deletedAt === "string" && raw.deletedAt.length > 0
				? raw.deletedAt
				: null,
		draft: Boolean(raw.draft),
		pinned: Boolean(raw.pinned),
	} satisfies TodoItem
}

function pickPreferredTodoItem(a: TodoItem, b: TodoItem) {
	const comparison = compareTodoRevision(a, b)
	if (comparison < 0) return a
	if (comparison > 0) return b
	if (a.deletedAt && !b.deletedAt) return a
	if (!a.deletedAt && b.deletedAt) return b
	if (!a.draft && b.draft) return a
	if (a.draft && !b.draft) return b
	return a
}

function subsequenceMatch(query: string, value: string) {
	let cursor = 0
	for (const char of value) {
		if (char === query[cursor]) cursor += 1
		if (cursor >= query.length) return true
	}
	return cursor >= query.length
}

export function createTodoItem(
	text: string,
	overrides: Partial<TodoItem> = {},
): TodoItem {
	const createdAt = overrides.createdAt ?? new Date().toISOString()
	return {
		id: overrides.id ?? crypto.randomUUID(),
		text,
		completed: overrides.completed ?? false,
		createdAt,
		updatedAt: overrides.updatedAt ?? createdAt,
		reminderDate: overrides.reminderDate ?? null,
		deletedAt: overrides.deletedAt ?? null,
		draft: overrides.draft ?? false,
		pinned: overrides.pinned ?? false,
	}
}

export function normalizeTodoItems(items: TodoItem[]) {
	const mergedById = new Map<string, TodoItem>()

	for (const item of items) {
		const current = mergedById.get(item.id)
		mergedById.set(
			item.id,
			current ? pickPreferredTodoItem(current, item) : item,
		)
	}

	const normalized = [...mergedById.values()].sort(compareTodoRevision)
	let seenDraft = false

	return normalized
		.map((item) => {
			if (!item.draft) return item
			if (!seenDraft) {
				seenDraft = true
				return item
			}
			if (item.text.trim().length === 0) return null
			return { ...item, draft: false }
		})
		.filter((item): item is TodoItem => item !== null)
}

export function parseTodoItems(
	raw: string,
	options: { allowEmpty?: boolean } = {},
): TodoItem[] {
	const parsed = JSON.parse(raw)
	if (!Array.isArray(parsed))
		throw new Error("Expected a JSON array of todo items.")

	return normalizeTodoItems(
		parsed
			.map((entry) => {
				if (
					typeof entry !== "object" ||
					entry === null ||
					typeof entry.id !== "string" ||
					typeof entry.text !== "string"
				) {
					throw new Error("Invalid todo item in imported file.")
				}

				return sanitizeTodoItem(
					entry as Partial<TodoItem> & Pick<TodoItem, "id" | "text">,
				)
			})
			.filter(
				(entry) =>
					options.allowEmpty ||
					entry.draft ||
					Boolean(entry.deletedAt) ||
					entry.text.trim().length > 0,
			),
	)
}

export function parseTodoSyncDocument(raw: string) {
	const parsed = JSON.parse(raw)

	if (Array.isArray(parsed)) {
		return {
			version: 2,
			syncedAt: new Date().toISOString(),
			items: parseTodoItems(JSON.stringify(parsed), { allowEmpty: true }),
		} satisfies TodoSyncDocument
	}

	if (
		typeof parsed !== "object" ||
		parsed === null ||
		!Array.isArray((parsed as TodoSyncDocument).items)
	) {
		throw new Error("Invalid synced todo document.")
	}

	return {
		version: 2,
		syncedAt:
			typeof parsed.syncedAt === "string"
				? parsed.syncedAt
				: new Date().toISOString(),
		items: parseTodoItems(JSON.stringify(parsed.items), { allowEmpty: true }),
	} satisfies TodoSyncDocument
}

export function mergeTodoItems(existing: TodoItem[], incoming: TodoItem[]) {
	return normalizeTodoItems([...existing, ...incoming])
}

export function getVisibleTodoItems(items: TodoItem[]) {
	return normalizeTodoItems(items).filter(
		(item) => !item.deletedAt && !item.draft,
	)
}

export function serializeTodoItems(
	items: TodoItem[],
	options: { includeDeleted?: boolean; includeDrafts?: boolean } = {},
) {
	const includeDeleted = options.includeDeleted ?? true
	const includeDrafts = options.includeDrafts ?? true
	const normalized = normalizeTodoItems(items).filter((item) => {
		if (!includeDeleted && item.deletedAt) return false
		if (!includeDrafts && item.draft) return false
		return item.text.trim().length > 0 || item.deletedAt || item.draft
	})

	return JSON.stringify(normalized, null, "\t")
}

export function serializeTodoSyncDocument(items: TodoItem[]) {
	return JSON.stringify(
		{
			version: 2,
			syncedAt: new Date().toISOString(),
			items: JSON.parse(serializeTodoItems(items)),
		} satisfies TodoSyncDocument,
		null,
		"\t",
	)
}

export function serializeTodoExport(items: TodoItem[]) {
	return serializeTodoItems(items, {
		includeDeleted: false,
		includeDrafts: false,
	})
}

export function isTodoReminderToday(item: TodoItem, now = new Date()) {
	if (!item.reminderDate) return false
	const today = `${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(
		now.getUTCDate(),
	).padStart(2, "0")}`
	return item.reminderDate.slice(5) === today
}

export function matchesTodoQuery(item: TodoItem, query: string) {
	const normalizedQuery = query.toLowerCase().trim()
	if (!normalizedQuery) return true

	const haystack = item.text.toLowerCase()
	const tokens = normalizedQuery
		.split(/\s+/)
		.map((token) => token.replace(/[^a-z0-9]+/g, ""))
		.filter(Boolean)

	return tokens.every((token) => {
		if (haystack.includes(token)) return true
		return subsequenceMatch(token, haystack.replace(/\s+/g, ""))
	})
}

export function splitTodoText(text: string): TodoTextSegment[] {
	const segments: TodoTextSegment[] = []
	let cursor = 0

	for (const match of text.matchAll(TODO_URL_PATTERN)) {
		const rawMatch = match[0]
		const start = match.index ?? 0
		const normalized = rawMatch.replace(/[),.;!?]+$/g, "")
		const trailing = rawMatch.slice(normalized.length)

		if (start > cursor) {
			segments.push({ text: text.slice(cursor, start) })
		}
		segments.push({ text: normalized, href: normalized })
		if (trailing) segments.push({ text: trailing })
		cursor = start + rawMatch.length
	}

	if (cursor < text.length) {
		segments.push({ text: text.slice(cursor) })
	}

	return segments.length > 0 ? segments : [{ text }]
}
