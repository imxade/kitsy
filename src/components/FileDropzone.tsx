import { useState, useRef, useEffect } from "react"
import Icon from "./Icon"

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

	// Clipboard paste support
	useEffect(() => {
		const handlePaste = (e: ClipboardEvent) => {
			const clipboardData = e.clipboardData
			if (!clipboardData) return

			const pastedFiles: File[] = []

			// First try clipboardData.files (for file pastes)
			if (clipboardData.files.length > 0) {
				pastedFiles.push(...Array.from(clipboardData.files))
			}

			// Also check clipboardData.items for image blobs (e.g. screenshots)
			if (pastedFiles.length === 0 && clipboardData.items) {
				for (const item of Array.from(clipboardData.items)) {
					if (item.kind === "file") {
						const file = item.getAsFile()
						if (file) pastedFiles.push(file)
					}
				}
			}

			if (pastedFiles.length > 0) {
				e.preventDefault()
				onFilesSelected(multiple ? pastedFiles : [pastedFiles[0]])
			}
		}

		document.addEventListener("paste", handlePaste)
		return () => document.removeEventListener("paste", handlePaste)
	}, [multiple, onFilesSelected])

	const handleDrag = (e: React.DragEvent) => {
		e.preventDefault()
		e.stopPropagation()
	}

	const handleDragIn = (e: React.DragEvent) => {
		e.preventDefault()
		e.stopPropagation()
		if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
			setIsDragging(true)
		}
	}

	const handleDragOut = (e: React.DragEvent) => {
		e.preventDefault()
		e.stopPropagation()
		setIsDragging(false)
	}

	const handleDrop = (e: React.DragEvent) => {
		e.preventDefault()
		e.stopPropagation()
		setIsDragging(false)
		const droppedFiles = Array.from(e.dataTransfer.files)
		if (droppedFiles.length > 0) {
			onFilesSelected(multiple ? droppedFiles : [droppedFiles[0]])
		}
	}

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
			<div className="text-base-content/20 mb-6 group-hover:text-primary/40 transition-colors">
				<Icon name="folder" size={64} strokeWidth={1} />
			</div>
			<p className="text-lg font-semibold text-base-content">
				{isDragging ? "Drop files here" : "Drag & drop files here"}
			</p>
			<p className="text-sm text-base-content/60 mt-1">
				or paste / click to browse
			</p>
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
				data-testid="file-input"
			/>
		</div>
	)
}
