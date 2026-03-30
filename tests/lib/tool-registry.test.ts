import { describe, it, expect } from "vitest"
import {
	getAllTools,
	getToolById,
	getToolsByCategory,
	getCategories,
} from "../../src/lib/tool-registry"

describe("tool-registry", () => {
	it("returns all tools as a non-empty array", () => {
		const tools = getAllTools()
		expect(tools.length).toBeGreaterThanOrEqual(25)
	})

	it("each tool has required fields", () => {
		for (const tool of getAllTools()) {
			expect(tool.id).toBeTruthy()
			expect(tool.name).toBeTruthy()
			expect(tool.description).toBeTruthy()
			expect(tool.category).toBeTruthy()
			expect(tool.icon).toBeTruthy()
			expect(tool.acceptedExtensions.length).toBeGreaterThan(0)
			expect(typeof tool.process).toBe("function")
		}
	})

	it("looks up tools by ID", () => {
		const tool = getToolById("image-convert")
		expect(tool).toBeDefined()
		expect(tool?.name).toBe("Convert Image")
	})

	it("returns undefined for unknown ID", () => {
		expect(getToolById("nonexistent")).toBeUndefined()
	})

	it("filters tools by category", () => {
		const pdfTools = getToolsByCategory("pdf")
		expect(pdfTools.length).toBeGreaterThan(0)
		for (const t of pdfTools) {
			expect(t.category).toBe("pdf")
		}
	})

	it("returns all categories", () => {
		const cats = getCategories()
		const ids = cats.map((c) => c.id)
		expect(ids).toContain("pdf")
		expect(ids).toContain("image")
		expect(ids).toContain("video")
		expect(ids).toContain("audio")
		expect(ids).toContain("gif")
		expect(ids).toContain("file")
	})

	it("has no duplicate tool IDs", () => {
		const tools = getAllTools()
		const ids = tools.map((t) => t.id)
		expect(new Set(ids).size).toBe(ids.length)
	})

	it("has valid categories for all tools", () => {
		const validCategories = getCategories().map((c) => c.id)
		for (const tool of getAllTools()) {
			expect(validCategories).toContain(tool.category)
		}
	})

	it("no tool description contains em-dashes", () => {
		for (const tool of getAllTools()) {
			expect(tool.description).not.toContain("\u2014")
			expect(tool.name).not.toContain("\u2014")
		}
	})

	it("finds audio-merge tool", () => {
		const tool = getToolById("audio-merge")
		expect(tool).toBeDefined()
		expect(tool?.category).toBe("audio")
	})

	it("finds video-audio-merge tool", () => {
		const tool = getToolById("video-audio-merge")
		expect(tool).toBeDefined()
		expect(tool?.category).toBe("video")
	})

	it("all extensions start with a dot or are a wildcard", () => {
		for (const tool of getAllTools()) {
			for (const ext of tool.acceptedExtensions) {
				expect(ext === "*" || ext.startsWith(".")).toBe(true)
			}
		}
	})
})
