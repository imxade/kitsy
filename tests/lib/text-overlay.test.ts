import { describe, expect, it } from "vitest"
import {
	clampTextOverlayBox,
	fitTextToBox,
	type TextMeasureContext,
} from "../../src/lib/text-overlay"

function fakeMeasureContext(): TextMeasureContext {
	return {
		font: "normal normal 16px sans-serif",
		measureText(text: string) {
			const fontSize = Number(this.font.match(/(\d+)px/)?.[1] ?? 16)
			return { width: text.length * fontSize * 0.55 } as TextMetrics
		},
	}
}

describe("text-overlay", () => {
	it("clamps overlay boxes inside the image bounds", () => {
		expect(
			clampTextOverlayBox({ x: 0.9, y: -0.2, width: 0.4, height: 0.02 }),
		).toEqual({
			x: 0.6,
			y: 0,
			width: 0.4,
			height: 0.05,
		})
	})

	it("wraps text and reduces font size to fit the target box", () => {
		const layout = fitTextToBox(
			fakeMeasureContext(),
			"A long caption that should wrap into multiple lines",
			120,
			60,
			{ maxFontSize: 42 },
		)

		expect(layout.fontSize).toBeLessThan(42)
		expect(layout.lines.length).toBeGreaterThan(1)
		expect(layout.totalHeight).toBeLessThanOrEqual(60)
	})
})
