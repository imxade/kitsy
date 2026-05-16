export interface TextOverlayBox {
	x: number
	y: number
	width: number
	height: number
}

export interface TextFitStyle {
	fontFamily?: string
	bold?: boolean
	italic?: boolean
	minFontSize?: number
	maxFontSize?: number
}

export interface TextMeasureContext {
	font: string
	measureText(text: string): TextMetrics
}

export interface FittedTextLayout {
	fontSize: number
	lineHeight: number
	lines: string[]
	totalHeight: number
}

export const DEFAULT_TEXT_OVERLAY_BOX: TextOverlayBox = {
	x: 0.12,
	y: 0.68,
	width: 0.76,
	height: 0.2,
}

const MIN_BOX_SIZE = 0.05
const DEFAULT_MIN_FONT_SIZE = 8

function clamp(value: number, min: number, max: number) {
	return Math.min(Math.max(value, min), max)
}

export function clampTextOverlayBox(box: TextOverlayBox): TextOverlayBox {
	const width = clamp(box.width, MIN_BOX_SIZE, 1)
	const height = clamp(box.height, MIN_BOX_SIZE, 1)
	const x = clamp(box.x, 0, 1 - width)
	const y = clamp(box.y, 0, 1 - height)
	return { x, y, width, height }
}

export function buildTextFont(style: TextFitStyle, fontSize: number) {
	const fontStyle = style.italic ? "italic" : "normal"
	const fontWeight = style.bold ? "bold" : "normal"
	const fontFamily = style.fontFamily || "sans-serif"
	return `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`
}

function splitLongWord(
	ctx: TextMeasureContext,
	word: string,
	maxWidth: number,
) {
	const parts: string[] = []
	let current = ""

	for (const char of Array.from(word)) {
		const next = `${current}${char}`
		if (current && ctx.measureText(next).width > maxWidth) {
			parts.push(current)
			current = char
		} else {
			current = next
		}
	}

	if (current) parts.push(current)
	return parts.length > 0 ? parts : [word]
}

function wrapText(ctx: TextMeasureContext, text: string, maxWidth: number) {
	const lines: string[] = []
	const paragraphs = text.split(/\r?\n/)

	for (const paragraph of paragraphs) {
		const words = paragraph.trim().split(/\s+/).filter(Boolean)
		if (words.length === 0) {
			lines.push("")
			continue
		}

		let line = ""
		for (const word of words) {
			const pieces =
				ctx.measureText(word).width > maxWidth
					? splitLongWord(ctx, word, maxWidth)
					: [word]

			for (const piece of pieces) {
				const next = line ? `${line} ${piece}` : piece
				if (!line || ctx.measureText(next).width <= maxWidth) {
					line = next
				} else {
					lines.push(line)
					line = piece
				}
			}
		}

		if (line) lines.push(line)
	}

	return lines.length > 0 ? lines : [""]
}

export function fitTextToBox(
	ctx: TextMeasureContext,
	text: string,
	maxWidth: number,
	maxHeight: number,
	style: TextFitStyle = {},
): FittedTextLayout {
	const safeText = text.length > 0 ? text : " "
	const width = Math.max(1, maxWidth)
	const height = Math.max(1, maxHeight)
	const minFontSize = Math.max(
		1,
		Math.floor(style.minFontSize ?? DEFAULT_MIN_FONT_SIZE),
	)
	const maxFontSize = Math.max(
		minFontSize,
		Math.floor(style.maxFontSize ?? Math.min(width, height)),
	)

	const layoutAt = (fontSize: number): FittedTextLayout => {
		ctx.font = buildTextFont(style, fontSize)
		const lines = wrapText(ctx, safeText, width)
		const lineHeight = Math.ceil(fontSize * 1.18)
		return {
			fontSize,
			lineHeight,
			lines,
			totalHeight: lines.length * lineHeight,
		}
	}

	let best = layoutAt(minFontSize)
	let low = minFontSize
	let high = maxFontSize

	while (low <= high) {
		const mid = Math.floor((low + high) / 2)
		const layout = layoutAt(mid)
		const fits =
			layout.totalHeight <= height &&
			layout.lines.every((line) => ctx.measureText(line).width <= width + 0.5)

		if (fits) {
			best = layout
			low = mid + 1
		} else {
			high = mid - 1
		}
	}

	return best
}
