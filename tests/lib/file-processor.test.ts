import { describe, it, expect } from "vitest"
import {
	createZip,
	unzipFiles,
	csvToJson,
	jsonToCsv,
	formatJson,
} from "../../src/lib/file-processor"

describe("file-processor", () => {
	it("exports all file and data functions", () => {
		expect(typeof createZip).toBe("function")
		expect(typeof unzipFiles).toBe("function")
		expect(typeof csvToJson).toBe("function")
		expect(typeof jsonToCsv).toBe("function")
		expect(typeof formatJson).toBe("function")
	})

	it("csvToJson converts CSV string to JSON blob", async () => {
		const csv = "name,age\nAlice,30\nBob,25"
		const file = new File([csv], "test.csv", { type: "text/csv" })
		const result = await csvToJson(file)
		expect(result.name).toBe("test.json")
		expect(result.blob.type).toBe("application/json")
		
		const json = JSON.parse(await result.blob.text())
		expect(json).toHaveLength(2)
		expect(json[0].name).toBe("Alice")
	})

	it("jsonToCsv converts JSON array to CSV blob", async () => {
		const data = [{ name: "Alice", age: 30 }, { name: "Bob", age: 25 }]
		const file = new File([JSON.stringify(data)], "test.json", { type: "application/json" })
		const result = await jsonToCsv(file)
		expect(result.name).toBe("test.csv")
		expect(result.blob.type).toBe("text/csv")
		
		const csv = await result.blob.text()
		expect(csv).toContain("name,age")
		expect(csv).toContain("Alice,30")
	})

	it("formatJson prettifies JSON", async () => {
		const raw = '{"a":1,"b":2}'
		const file = new File([raw], "test.json", { type: "application/json" })
		const result = await formatJson(file)
		const text = await result.blob.text()
		expect(text).toContain("  ") // Check for indentation
	})
})
