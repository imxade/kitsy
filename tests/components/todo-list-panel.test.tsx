// @vitest-environment jsdom

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import TodoListPanel from "../../src/components/TodoListPanel"
import { TODO_STORAGE_KEY } from "../../src/lib/todo-list"

function inputEditable(element: HTMLElement, text: string) {
	element.textContent = text
	fireEvent.input(element)
}

describe("TodoListPanel", () => {
	beforeEach(() => {
		window.localStorage.clear()
	})

	afterEach(() => {
		cleanup()
	})

	it("loads from localStorage and appends imported tasks", async () => {
		window.localStorage.setItem(
			TODO_STORAGE_KEY,
			JSON.stringify([
				{
					id: "stored",
					text: "Stored task",
					completed: false,
					createdAt: "2026-04-27T00:00:00.000Z",
					updatedAt: "2026-04-27T00:00:00.000Z",
					reminderDate: null,
					deletedAt: null,
					draft: false,
				},
			]),
		)

		render(<TodoListPanel />)
		expect(await screen.findByText("Stored task")).toBeTruthy()

		const draftInput = screen.getByTestId("todo-draft-input")
		inputEditable(draftInput, "Fresh task")
		fireEvent.blur(draftInput)
		expect(await screen.findByText("Fresh task")).toBeTruthy()

		const importFile = new File(
			[
				JSON.stringify([
					{
						id: "imported",
						text: "Imported task",
						completed: false,
						createdAt: "2026-04-27T01:00:00.000Z",
						updatedAt: "2026-04-27T01:00:00.000Z",
						reminderDate: null,
						deletedAt: null,
						draft: false,
					},
				]),
			],
			"todos.json",
			{ type: "application/json" },
		)

		fireEvent.change(screen.getByTestId("todo-import"), {
			target: { files: [importFile] },
		})

		expect(await screen.findByText("Imported task")).toBeTruthy()
		await waitFor(() => {
			expect(window.localStorage.getItem(TODO_STORAGE_KEY)).toContain(
				"Imported task",
			)
		})
	})

	it("exports the current list as a JSON download", async () => {
		const appendChildSpy = vi.spyOn(document.body, "appendChild")
		const removeChildSpy = vi.spyOn(document.body, "removeChild")
		const clickSpy = vi
			.spyOn(HTMLAnchorElement.prototype, "click")
			.mockImplementation(() => undefined)
		const createObjectUrlSpy = vi
			.spyOn(URL, "createObjectURL")
			.mockReturnValue("blob:todo-export")
		const revokeObjectUrlSpy = vi
			.spyOn(URL, "revokeObjectURL")
			.mockImplementation(() => undefined)

		render(<TodoListPanel />)
		const draftInput = screen.getByTestId("todo-draft-input")
		inputEditable(draftInput, "Export me")
		fireEvent.blur(draftInput)
		fireEvent.click(screen.getByTestId("todo-export"))

		expect(createObjectUrlSpy).toHaveBeenCalled()
		expect(appendChildSpy).toHaveBeenCalled()
		expect(removeChildSpy).toHaveBeenCalled()

		appendChildSpy.mockRestore()
		removeChildSpy.mockRestore()
		clickSpy.mockRestore()
		createObjectUrlSpy.mockRestore()
		revokeObjectUrlSpy.mockRestore()
	})

	it("renders todo links as new-tab anchors", async () => {
		render(<TodoListPanel />)
		const draftInput = screen.getByTestId("todo-draft-input")
		inputEditable(draftInput, "Docs https://example.com/guide")
		fireEvent.blur(draftInput)

		const link = await screen.findByTestId("todo-link")
		expect(link.getAttribute("href")).toBe("https://example.com/guide")
		expect(link.getAttribute("target")).toBe("_blank")
		expect(link.getAttribute("rel")).toContain("noopener")
	})

	it("deletes an emptied todo when focus leaves the editor", async () => {
		render(<TodoListPanel />)
		const draftInput = screen.getByTestId("todo-draft-input")
		inputEditable(draftInput, "Disposable task")
		fireEvent.blur(draftInput)

		const todoText = await screen.findByText("Disposable task")
		const todoCard = todoText.closest('[data-testid="todo-item"]')
		if (!(todoCard instanceof HTMLElement)) {
			throw new Error("Todo card was not rendered.")
		}
		fireEvent.click(todoText)
		const editor = within(todoCard).getByTestId("todo-edit-input")
		inputEditable(editor, "")
		fireEvent.blur(editor)

		await waitFor(() => {
			expect(screen.queryByText("Disposable task")).toBeNull()
		})
	})

	it("expands the todo preview on hover and edits on click", async () => {
		window.localStorage.setItem(
			TODO_STORAGE_KEY,
			JSON.stringify([
				{
					id: "hover-test",
					text: "walk dog",
					completed: false,
					createdAt: "2026-05-11T00:00:00.000Z",
					updatedAt: "2026-05-11T00:00:00.000Z",
					reminderDate: null,
					deletedAt: null,
					draft: false,
					pinned: false,
				},
			]),
		)
		render(<TodoListPanel />)

		const preview = await screen.findByRole("button", {
			name: "Edit todo text",
		})
		fireEvent.mouseEnter(preview)
		expect(preview.textContent).toBe("walk dog")

		fireEvent.click(preview)

		const editor = await screen.findByTestId("todo-edit-input")
		expect(editor.textContent).toBe("walk dog")
	})

	it("keeps links clickable when a long todo preview expands", async () => {
		window.localStorage.setItem(
			TODO_STORAGE_KEY,
			JSON.stringify([
				{
					id: "link-hover-test",
					text: [
						"Review https://example.com/docs",
						"with enough surrounding text to exercise the expanded preview.",
						"The link should stay clickable instead of becoming editor text.",
					].join(" "),
					completed: false,
					createdAt: "2026-05-18T00:00:00.000Z",
					updatedAt: "2026-05-18T00:00:00.000Z",
					reminderDate: null,
					deletedAt: null,
					draft: false,
					pinned: false,
				},
			]),
		)
		render(<TodoListPanel />)

		const preview = await screen.findByRole("button", {
			name: "Edit todo text",
		})
		fireEvent.mouseEnter(preview)

		const link = screen.getByTestId("todo-link") as HTMLAnchorElement
		expect(link.href).toBe("https://example.com/docs")
		fireEvent.click(link)

		expect(screen.queryByTestId("todo-edit-input")).toBeNull()
	})

	it("filters todos using after and before date filters", async () => {
		window.localStorage.setItem(
			TODO_STORAGE_KEY,
			JSON.stringify([
				{
					id: "task-1",
					text: "Task May 1",
					completed: false,
					createdAt: "2026-05-01T00:00:00.000Z",
					updatedAt: "2026-05-01T00:00:00.000Z",
					reminderDate: "2026-05-01",
					deletedAt: null,
					draft: false,
					pinned: false,
				},
				{
					id: "task-2",
					text: "Task May 5",
					completed: false,
					createdAt: "2026-05-05T00:00:00.000Z",
					updatedAt: "2026-05-05T00:00:00.000Z",
					reminderDate: "2026-05-05",
					deletedAt: null,
					draft: false,
					pinned: false,
				},
				{
					id: "task-3",
					text: "Task May 15",
					completed: false,
					createdAt: "2026-05-15T00:00:00.000Z",
					updatedAt: "2026-05-15T00:00:00.000Z",
					reminderDate: "2026-05-15",
					deletedAt: null,
					draft: false,
					pinned: false,
				},
				{
					id: "task-4",
					text: "Task No Date",
					completed: false,
					createdAt: "2026-05-02T00:00:00.000Z",
					updatedAt: "2026-05-02T00:00:00.000Z",
					reminderDate: null,
					deletedAt: null,
					draft: false,
					pinned: false,
				},
			]),
		)

		render(<TodoListPanel />)

		// Initially all 4 items should be visible
		expect(await screen.findByText("Task May 1")).toBeTruthy()
		expect(screen.getByText("Task May 5")).toBeTruthy()
		expect(screen.getByText("Task May 15")).toBeTruthy()
		expect(screen.getByText("Task No Date")).toBeTruthy()

		const afterInput = screen.getByTestId("todo-filter-after")
		const beforeInput = screen.getByTestId("todo-filter-before")

		// 1. Setting only after keeps upper end open
		fireEvent.change(afterInput, { target: { value: "2026-05-05" } })
		expect(screen.queryByText("Task May 1")).toBeNull()
		expect(screen.getByText("Task May 5")).toBeTruthy()
		expect(screen.getByText("Task May 15")).toBeTruthy()
		expect(screen.queryByText("Task No Date")).toBeNull()

		// 2. Setting both creates a range between after and before
		fireEvent.change(beforeInput, { target: { value: "2026-05-10" } })
		expect(screen.queryByText("Task May 1")).toBeNull()
		expect(screen.getByText("Task May 5")).toBeTruthy()
		expect(screen.queryByText("Task May 15")).toBeNull()
		expect(screen.queryByText("Task No Date")).toBeNull()

		// 3. Clearing after keeps lower end open (only before is active)
		fireEvent.change(afterInput, { target: { value: "" } })
		expect(screen.getByText("Task May 1")).toBeTruthy()
		expect(screen.getByText("Task May 5")).toBeTruthy()
		expect(screen.queryByText("Task May 15")).toBeNull()
		expect(screen.queryByText("Task No Date")).toBeNull()

		// 4. Clicking the clear button clears both dates and shows all items
		const clearButton = screen.getByTestId("todo-filter-clear-dates")
		fireEvent.click(clearButton)
		expect(screen.getByText("Task May 1")).toBeTruthy()
		expect(screen.getByText("Task May 5")).toBeTruthy()
		expect(screen.getByText("Task May 15")).toBeTruthy()
		expect(screen.getByText("Task No Date")).toBeTruthy()
		expect(screen.queryByTestId("todo-filter-clear-dates")).toBeNull()
	})
})
