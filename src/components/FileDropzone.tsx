import { useCallback, useState, useRef } from "react"

interface FileDropzoneProps {
	acceptedExtensions: string[]
	acceptedMimeTypes: string[]
	multiple: boolean
	onFilesSelected: (files: File[]) => void
}

export default function FileDropzone({
	acceptedExtensions,
	acceptedMimeTypes,
	multiple,
	onFilesSelected,
}: FileDropzoneProps) {
	const [isDragging, setIsDragging] = useState(false)
	const inputRef = useRef<HTMLInputElement>(null)

	const handleDrag = useCallback((e: React.DragEvent) => {
		e.preventDefault()
		e.stopPropagation()
	}, [])

	const handleDragIn = useCallback((e: React.DragEvent) => {
		e.preventDefault()
		e.stopPropagation()
		if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
			setIsDragging(true)
		}
	}, [])

	const handleDragOut = useCallback((e: React.DragEvent) => {
		e.preventDefault()
		e.stopPropagation()
		setIsDragging(false)
	}, [])

	const handleDrop = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault()
			e.stopPropagation()
			setIsDragging(false)
			const droppedFiles = Array.from(e.dataTransfer.files)
			if (droppedFiles.length > 0) {
				onFilesSelected(multiple ? droppedFiles : [droppedFiles[0]])
			}
		},
		[multiple, onFilesSelected],
	)

	const handleClick = () => {
		inputRef.current?.click()
	}

	const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const selectedFiles = Array.from(e.target.files || [])
		if (selectedFiles.length > 0) {
			onFilesSelected(selectedFiles)
		}
	}

	const acceptStr =
		acceptedMimeTypes[0] === "*/*"
			? ""
			: [
					...acceptedMimeTypes,
					...acceptedExtensions,
					// Mobile browsers need MIME types for CSV selection
					...(acceptedExtensions.includes(".csv") ? ["text/csv"] : []),
				].join(",")

	return (
		// biome-ignore lint/a11y/useSemanticElements: Dropzone requires a div
		<div
			onDragEnter={handleDragIn}
			onDragLeave={handleDragOut}
			onDragOver={handleDrag}
			onDrop={handleDrop}
			onClick={handleClick}
			onKeyDown={(e) => e.key === "Enter" && handleClick()}
			role="button"
			tabIndex={0}
			className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-12 text-center transition-all duration-200 ${
				isDragging
					? "border-primary bg-primary/10 scale-[1.02]"
					: "border-base-content/20 bg-base-200/50 hover:border-primary/50 hover:bg-base-200"
			}`}
		>
			<div className="text-5xl mb-4">📂</div>
			<p className="text-lg font-semibold text-base-content">
				{isDragging ? "Drop files here" : "Drag & drop files here"}
			</p>
			<p className="text-sm text-base-content/60 mt-1">or click to browse</p>
			{acceptedExtensions[0] !== "*" && (
				<p className="text-xs text-base-content/40 mt-3">
					Supported: {acceptedExtensions.join(", ")}
				</p>
			)}
			<input
				ref={inputRef}
				type="file"
				className="hidden"
				accept={acceptStr}
				multiple={multiple}
				onChange={handleChange}
			/>
		</div>
	)
}
