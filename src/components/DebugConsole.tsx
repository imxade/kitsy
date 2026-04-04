import { useState, useEffect, useRef, useCallback } from "react"
import Icon from "./Icon"

interface LogEntry {
	level: "log" | "warn" | "error" | "info" | "debug"
	args: string[]
	ts: number
}

const LEVEL_STYLE: Record<string, string> = {
	error: "text-error",
	warn: "text-warning",
	info: "text-info",
	debug: "text-base-content/50",
	log: "text-base-content",
}

const MAX_ENTRIES = 500

// --- Global Logger ---
let globalLogs: LogEntry[] = []
let subscribers: ((logs: LogEntry[]) => void)[] = []

function notifySubscribers() {
	subscribers.forEach((fn) => {
		fn([...globalLogs])
	})
}

const originals = {
	log: console.log,
	warn: console.warn,
	error: console.error,
	info: console.info,
	debug: console.debug,
}

const push =
	(level: LogEntry["level"], fromSw = false) =>
	(...args: unknown[]) => {
		if (!fromSw) originals[level](...args)
		const entry: LogEntry = {
			level,
			args: args.map((a) => {
				try {
					if (a instanceof Error) return a.stack || a.message
					return typeof a === "string" ? a : JSON.stringify(a, null, 2)
				} catch {
					return String(a)
				}
			}),
			ts: Date.now(),
		}
		globalLogs.push(entry)
		if (globalLogs.length > MAX_ENTRIES) {
			globalLogs = globalLogs.slice(-MAX_ENTRIES)
		}
		notifySubscribers()
	}

if (typeof window !== "undefined") {
	console.log = push("log")
	console.warn = push("warn")
	console.error = push("error")
	console.info = push("info")
	console.debug = push("debug")

	// Capture unhandled errors
	const onError = (e: ErrorEvent) => {
		push("error")(`[Uncaught] ${e.message} at ${e.filename}:${e.lineno}`)
	}
	const onUnhandled = (e: PromiseRejectionEvent) => {
		push("error")("[UnhandledRejection]", e.reason)
	}
	window.addEventListener("error", onError)
	window.addEventListener("unhandledrejection", onUnhandled)

	// Listen for SW logs
	navigator.serviceWorker?.addEventListener("message", (event) => {
		if (event.data?.type === "SW_LOG") {
			push(event.data.level as LogEntry["level"], true)(...event.data.args)
		}
	})
}
// --------------------

export default function DebugConsole() {
	const [open, setOpen] = useState(false)
	const [logs, setLogs] = useState<LogEntry[]>(globalLogs)
	const bottomRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const update = (newLogs: LogEntry[]) => setLogs(newLogs)
		subscribers.push(update)
		setLogs([...globalLogs]) // Initial sync
		return () => {
			subscribers = subscribers.filter((s) => s !== update)
		}
	}, [])

	// Auto-scroll to bottom when new logs arrive
	useEffect(() => {
		if (open && logs.length >= 0) {
			bottomRef.current?.scrollIntoView({ behavior: "smooth" })
		}
	}, [open, logs]) // added logs back to scroll on new entry

	const clearLogs = useCallback(() => {
		globalLogs = []
		notifySubscribers()
	}, [])

	const hasErrors = logs.some((l) => l.level === "error")

	const formatTime = (ts: number) => {
		const d = new Date(ts)
		return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`
	}

	return (
		<>
			{/* Toggle button */}
			<button
				type="button"
				className={`btn btn-ghost btn-circle btn-sm relative ${hasErrors ? "text-error" : ""}`}
				onClick={() => setOpen((p) => !p)}
				aria-label="Toggle Debug Console"
			>
				<Icon name="terminal" size={20} />
				{hasErrors && (
					<span className="absolute top-0 right-0 w-2 h-2 bg-error rounded-full" />
				)}
			</button>

			{/* Console panel */}
			{open && (
				<div className="fixed inset-0 h-[100dvh] z-[9999] flex flex-col bg-base-300/95 backdrop-blur-sm">
					{/* Toolbar */}
					<div className="flex items-center gap-2 px-3 py-2 bg-base-100 border-b border-base-content/10">
						<span className="font-mono text-sm font-bold flex-1">
							Console ({logs.length})
						</span>

						<button
							type="button"
							className="btn btn-ghost btn-xs"
							onClick={clearLogs}
							aria-label="Clear logs"
						>
							<Icon name="trash" size={14} />
						</button>
						<button
							type="button"
							className="btn btn-ghost btn-circle btn-sm"
							onClick={() => setOpen(false)}
							aria-label="Close console"
						>
							<Icon name="close" size={18} />
						</button>
					</div>

					{/* Log output */}
					<div className="flex-1 overflow-auto p-2 font-mono text-[10px] sm:text-xs leading-relaxed">
						{logs.length === 0 && (
							<p className="text-base-content/30 text-center py-8">
								No logs yet
							</p>
						)}
						{logs.map((entry, i) => (
							<div
								key={`${entry.ts}-${i}`}
								className={`flex gap-2 py-0.5 border-b border-base-content/5 ${LEVEL_STYLE[entry.level]}`}
							>
								<span className="text-base-content/30 shrink-0">
									{formatTime(entry.ts)}
								</span>
								<span className="shrink-0 w-12 uppercase font-bold opacity-60">
									{entry.level}
								</span>
								<span className="whitespace-pre-wrap break-all">
									{entry.args.join(" ")}
								</span>
							</div>
						))}
						<div ref={bottomRef} />
					</div>
				</div>
			)}
		</>
	)
}
