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
})
