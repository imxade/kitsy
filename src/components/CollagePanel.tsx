import { useState, useRef, useEffect, useCallback } from "react"
import { Stage, Layer, Image as KonvaImage, Transformer } from "react-konva"
import type Konva from "konva"

interface CollageImage {
	id: string
	src: HTMLImageElement
	x: number
	y: number
	width: number
	height: number
	rotation: number
	scaleX: number
	scaleY: number
}

interface CollagePanelProps {
	files: File[]
}

const CANVAS_WIDTH = 800
const CANVAS_HEIGHT = 600

export default function CollagePanel({ files }: CollagePanelProps) {
	const [images, setImages] = useState<CollageImage[]>([])
	const [selectedId, setSelectedId] = useState<string | null>(null)
	const stageRef = useRef<Konva.Stage>(null)
	const trRef = useRef<Konva.Transformer>(null)

	// Load files into images
	useEffect(() => {
		let cancelled = false
		const loadImages = async () => {
			const loaded: CollageImage[] = []
			for (let i = 0; i < files.length; i++) {
				const file = files[i]
				const url = URL.createObjectURL(file)
				const img = new Image()
				img.crossOrigin = "anonymous"
				await new Promise<void>((resolve, reject) => {
					img.onload = () => resolve()
					img.onerror = reject
					img.src = url
				})
				if (cancelled) {
					URL.revokeObjectURL(url)
					return
				}
				// Scale to fit canvas
				const scale = Math.min(
					(CANVAS_WIDTH * 0.4) / img.width,
					(CANVAS_HEIGHT * 0.4) / img.height,
					1,
				)
				loaded.push({
					id: `img-${i}-${Date.now()}`,
					src: img,
					x: 50 + (i % 3) * 250,
					y: 50 + Math.floor(i / 3) * 200,
					width: img.width * scale,
					height: img.height * scale,
					rotation: 0,
					scaleX: 1,
					scaleY: 1,
				})
			}
			if (!cancelled) setImages(loaded)
		}
		loadImages()
		return () => {
			cancelled = true
		}
	}, [files])

	// Attach transformer to selected node
	useEffect(() => {
		if (!trRef.current || !stageRef.current) return
		if (selectedId) {
			const node = stageRef.current.findOne(`#${selectedId}`)
			if (node) {
				trRef.current.nodes([node])
				trRef.current.getLayer()?.batchDraw()
			}
		} else {
			trRef.current.nodes([])
		}
	}, [selectedId])

	const handleDragEnd = useCallback(
		(id: string, e: Konva.KonvaEventObject<DragEvent>) => {
			setImages((prev) =>
				prev.map((img) =>
					img.id === id ? { ...img, x: e.target.x(), y: e.target.y() } : img,
				),
			)
		},
		[],
	)

	const handleTransformEnd = useCallback(
		(id: string, e: Konva.KonvaEventObject<Event>) => {
			const node = e.target as Konva.Image
			setImages((prev) =>
				prev.map((img) =>
					img.id === id
						? {
								...img,
								x: node.x(),
								y: node.y(),
								rotation: node.rotation(),
								scaleX: node.scaleX(),
								scaleY: node.scaleY(),
							}
						: img,
				),
			)
		},
		[],
	)

	const bringForward = () => {
		if (!selectedId) return
		setImages((prev) => {
			const idx = prev.findIndex((img) => img.id === selectedId)
			if (idx < prev.length - 1) {
				const next = [...prev]
				;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
				return next
			}
			return prev
		})
	}

	const sendBackward = () => {
		if (!selectedId) return
		setImages((prev) => {
			const idx = prev.findIndex((img) => img.id === selectedId)
			if (idx > 0) {
				const next = [...prev]
				;[next[idx], next[idx - 1]] = [next[idx - 1], next[idx]]
				return next
			}
			return prev
		})
	}

	const exportCollage = async (format: "png" | "jpg") => {
		if (!stageRef.current) return
		// Deselect before export
		setSelectedId(null)
		setTimeout(() => {
			const uri = stageRef.current?.toDataURL({
				mimeType: format === "jpg" ? "image/jpeg" : "image/png",
				quality: 0.92,
			})
			const a = document.createElement("a")
			a.href = uri
			a.download = `collage.${format}`
			a.click()
		}, 100)
	}

	return (
		<div className="flex flex-col gap-4">
			{/* Controls */}
			<div className="flex flex-wrap gap-2 items-center">
				<button
					type="button"
					className="btn btn-sm btn-outline"
					onClick={bringForward}
					disabled={!selectedId}
				>
					↑ Bring Forward
				</button>
				<button
					type="button"
					className="btn btn-sm btn-outline"
					onClick={sendBackward}
					disabled={!selectedId}
				>
					↓ Send Backward
				</button>
				<div className="divider divider-horizontal" />
				<button
					type="button"
					className="btn btn-sm btn-primary"
					onClick={() => exportCollage("png")}
				>
					Export PNG
				</button>
				<button
					type="button"
					className="btn btn-sm btn-secondary"
					onClick={() => exportCollage("jpg")}
				>
					Export JPG
				</button>
			</div>

			{/* Canvas */}
			<div
				className="border border-base-300 rounded-lg overflow-hidden bg-base-200"
				style={{ width: CANVAS_WIDTH, maxWidth: "100%" }}
			>
				<Stage
					ref={stageRef}
					width={CANVAS_WIDTH}
					height={CANVAS_HEIGHT}
					onMouseDown={(e) => {
						if (e.target === e.target.getStage()) setSelectedId(null)
					}}
					onTouchStart={(e) => {
						if (e.target === e.target.getStage()) setSelectedId(null)
					}}
				>
					<Layer>
						{images.map((img) => (
							<KonvaImage
								key={img.id}
								id={img.id}
								image={img.src}
								x={img.x}
								y={img.y}
								width={img.width}
								height={img.height}
								rotation={img.rotation}
								scaleX={img.scaleX}
								scaleY={img.scaleY}
								draggable
								onClick={() => setSelectedId(img.id)}
								onTap={() => setSelectedId(img.id)}
								onDragEnd={(e) => handleDragEnd(img.id, e)}
								onTransformEnd={(e) => handleTransformEnd(img.id, e)}
							/>
						))}
						<Transformer
							ref={trRef}
							boundBoxFunc={(_oldBox, newBox) => newBox}
						/>
					</Layer>
				</Stage>
			</div>
		</div>
	)
}
