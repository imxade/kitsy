import { describe, expect, it } from "vitest"
import {
	matchesTodoDateRange,
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

	describe("matchesTodoDateRange", () => {
		const makeItem = (reminderDate: string | null): TodoItem => ({
			id: "test",
			text: "Task",
			completed: false,
			createdAt: "2026-05-01T00:00:00.000Z",
			updatedAt: "2026-05-01T00:00:00.000Z",
			reminderDate,
			deletedAt: null,
			draft: false,
			pinned: false,
		})

		it("matches any item when neither bound is set", () => {
			expect(matchesTodoDateRange(makeItem("2026-05-05"), null, null)).toBe(
				true,
			)
			expect(matchesTodoDateRange(makeItem(null), null, null)).toBe(true)
			expect(matchesTodoDateRange(makeItem("2026-05-05"), "", "")).toBe(true)
			expect(matchesTodoDateRange(makeItem(null), "", "")).toBe(true)
		})

		it("filters between range when both bounds are set", () => {
			const after = "2026-05-01"
			const before = "2026-05-10"

			expect(matchesTodoDateRange(makeItem("2026-05-01"), after, before)).toBe(
				true,
			)
			expect(matchesTodoDateRange(makeItem("2026-05-05"), after, before)).toBe(
				true,
			)
			expect(matchesTodoDateRange(makeItem("2026-05-10"), after, before)).toBe(
				true,
			)
			expect(matchesTodoDateRange(makeItem("2026-04-30"), after, before)).toBe(
				false,
			)
			expect(matchesTodoDateRange(makeItem("2026-05-11"), after, before)).toBe(
				false,
			)
			expect(matchesTodoDateRange(makeItem(null), after, before)).toBe(false)
		})

		it("keeps upper end open when only after is set", () => {
			const after = "2026-05-05"

			expect(matchesTodoDateRange(makeItem("2026-05-05"), after, null)).toBe(
				true,
			)
			expect(matchesTodoDateRange(makeItem("2026-12-31"), after, "")).toBe(true)
			expect(matchesTodoDateRange(makeItem("2026-05-04"), after, null)).toBe(
				false,
			)
			expect(matchesTodoDateRange(makeItem(null), after, null)).toBe(false)
		})

		it("keeps lower end open when only before is set", () => {
			const before = "2026-05-05"

			expect(matchesTodoDateRange(makeItem("2026-05-05"), null, before)).toBe(
				true,
			)
			expect(matchesTodoDateRange(makeItem("2020-01-01"), "", before)).toBe(
				true,
			)
			expect(matchesTodoDateRange(makeItem("2026-05-06"), null, before)).toBe(
				false,
			)
			expect(matchesTodoDateRange(makeItem(null), null, before)).toBe(false)
		})
	})
})
