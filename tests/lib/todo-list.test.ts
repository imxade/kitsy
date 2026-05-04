import { describe, expect, it } from "vitest"
import {
	mergeTodoItems,
	parseTodoItems,
	serializeTodoItems,
	splitTodoText,
	type TodoItem,
} from "../../src/lib/todo-list"

describe("todo list helpers", () => {
	it("parses saved todo items", () => {
		const items = parseTodoItems(
			JSON.stringify([
				{
					id: "a",
					text: "Ship feature",
					completed: false,
					createdAt: "2026-04-27T00:00:00.000Z",
					updatedAt: "2026-04-27T00:00:00.000Z",
					reminderDate: null,
					deletedAt: null,
					draft: false,
				},
			]),
		)
		expect(items[0]?.text).toBe("Ship feature")
	})

	it("appends imported items without overwriting existing entries", () => {
		const existing: TodoItem[] = [
			{
				id: "a",
				text: "Existing",
				completed: false,
				createdAt: "2026-04-27T00:00:00.000Z",
				updatedAt: "2026-04-27T00:00:00.000Z",
				reminderDate: null,
				deletedAt: null,
				draft: false,
				pinned: false,
			},
		]
		const incoming: TodoItem[] = [
			{
				id: "a",
				text: "Duplicate",
				completed: true,
				createdAt: "2026-04-27T00:00:00.000Z",
				updatedAt: "2026-04-27T00:00:00.000Z",
				reminderDate: null,
				deletedAt: null,
				draft: false,
				pinned: false,
			},
			{
				id: "b",
				text: "Imported",
				completed: false,
				createdAt: "2026-04-27T01:00:00.000Z",
				updatedAt: "2026-04-27T01:00:00.000Z",
				reminderDate: null,
				deletedAt: null,
				draft: false,
				pinned: false,
			},
		]

		expect(mergeTodoItems(existing, incoming).map((item) => item.id)).toEqual([
			"b",
			"a",
		])
	})

	it("serializes items with stable formatting", () => {
		const serialized = serializeTodoItems([
			{
				id: "a",
				text: "Task",
				completed: false,
				createdAt: "2026-04-27T00:00:00.000Z",
				updatedAt: "2026-04-27T00:00:00.000Z",
				reminderDate: null,
				deletedAt: null,
				draft: false,
				pinned: false,
			},
		])
		expect(serialized).toContain("\n")
		expect(parseTodoItems(serialized)[0]?.id).toBe("a")
	})

	it("splits todo text into plain text and external links", () => {
		expect(
			splitTodoText("Review https://example.com/docs, then report back."),
		).toEqual([
			{ text: "Review " },
			{ text: "https://example.com/docs", href: "https://example.com/docs" },
			{ text: "," },
			{ text: " then report back." },
		])
	})
})
