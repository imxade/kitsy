import { useServerFn } from "@tanstack/react-start"
import {
	createContext,
	useContext,
	useEffect,
	useState,
	type ReactNode,
} from "react"
import { prefetchFFmpeg } from "../lib/ffmpeg-processor"
import type { ProcessedFile } from "../lib/image-processor"
import {
	isGoogleDriveConfigured,
	preloadGoogleIdentityServices,
	rememberGoogleDriveConnection,
	requestGoogleDriveAuthorizationCode,
	shouldReconnectGoogleDrive,
} from "../lib/google-drive"
import {
	connectGoogleDriveServer,
	disconnectGoogleDriveServer,
	getGoogleDriveAuthConfig,
	loadGoogleDriveTodoDocumentServer,
	saveGoogleDriveTodoDocumentServer,
	uploadFileToGoogleDriveServer,
} from "../lib/server-functions"

interface AppShellContextValue {
	isOnline: boolean
	isOfflineReady: boolean
	dismissOfflineReadyToast: () => void
	cloud: {
		configured: boolean
		connected: boolean
		connecting: boolean
		status: string
		error: string | null
		disabledReason: string | null
		connect: () => Promise<boolean>
		disconnect: () => Promise<void>
		loadTodoDocument: () => Promise<string | null>
		saveTodoDocument: (raw: string) => Promise<boolean>
		uploadProcessedFile: (file: ProcessedFile) => Promise<{
			id: string
			name: string
			webViewLink?: string
		}>
		uploadProcessedFiles: (files: ProcessedFile[]) => Promise<
			{
				id: string
				name: string
				webViewLink?: string
			}[]
		>
	}
}

const DEFAULT_CONTEXT: AppShellContextValue = {
	isOnline: true,
	isOfflineReady: false,
	dismissOfflineReadyToast: () => undefined,
	cloud: {
		configured: false,
		connected: false,
		connecting: false,
		status: "Cloud disabled",
		error: null,
		disabledReason: "Cloud is unavailable in this build.",
		connect: async () => false,
		disconnect: async () => undefined,
		loadTodoDocument: async () => null,
		saveTodoDocument: async () => false,
		uploadProcessedFile: async () => {
			throw new Error("Cloud is unavailable in this build.")
		},
		uploadProcessedFiles: async () => {
			throw new Error("Cloud is unavailable in this build.")
		},
	},
}

const AppShellContext = createContext<AppShellContextValue>(DEFAULT_CONTEXT)

function getOfflineReadyDismissed() {
	try {
		return (
			window.sessionStorage.getItem("kitsy.offline-ready.dismissed") === "1"
		)
	} catch {
		return false
	}
}

function driveErrorMessage(error: unknown, fallback: string) {
	return error instanceof Error ? error.message : fallback
}

export function AppShellProvider({ children }: { children: ReactNode }) {
	const getGoogleDriveAuthConfigFn = useServerFn(getGoogleDriveAuthConfig)
	const connectGoogleDriveFn = useServerFn(connectGoogleDriveServer)
	const disconnectGoogleDriveFn = useServerFn(disconnectGoogleDriveServer)
	const loadGoogleDriveTodoDocumentFn = useServerFn(
		loadGoogleDriveTodoDocumentServer,
	)
	const saveGoogleDriveTodoDocumentFn = useServerFn(
		saveGoogleDriveTodoDocumentServer,
	)
	const uploadFileToGoogleDriveFn = useServerFn(uploadFileToGoogleDriveServer)

	const [isOnline, setIsOnline] = useState(true)
	const [isOfflineReady, setIsOfflineReady] = useState(false)
	const [showOfflineReadyToast, setShowOfflineReadyToast] = useState(false)
	const [cloudConnecting, setCloudConnecting] = useState(false)
	const [cloudError, setCloudError] = useState<string | null>(null)
	const [cloudStatus, setCloudStatus] = useState("Checking Drive...")
	const [cloudConnected, setCloudConnected] = useState(false)
	const [googleClientId, setGoogleClientId] = useState("")
	const [cloudConfigLoading, setCloudConfigLoading] = useState(true)

	const configured = isGoogleDriveConfigured(googleClientId)

	useEffect(() => {
		let active = true
		const loadConfig = async () => {
			try {
				const config = await getGoogleDriveAuthConfigFn()
				if (!active) return
				setGoogleClientId(config.googleClientId)
				setCloudConnected(config.connected)
				setCloudStatus(
					config.googleClientId
						? config.connected
							? "Drive connected"
							: shouldReconnectGoogleDrive()
								? "Reconnect Drive to resume cloud sync."
								: "Drive disconnected"
						: "Drive unavailable",
				)
				if (config.googleClientId) void preloadGoogleIdentityServices()
			} catch (error) {
				if (!active) return
				setCloudError(
					driveErrorMessage(error, "Failed to load Drive configuration."),
				)
				setCloudStatus("Drive unavailable")
			} finally {
				if (active) setCloudConfigLoading(false)
			}
		}

		void loadConfig()
		return () => {
			active = false
		}
	}, [getGoogleDriveAuthConfigFn])

	useEffect(() => {
		setIsOnline(typeof navigator === "undefined" ? true : navigator.onLine)

		const handleOnline = () => setIsOnline(true)
		const handleOffline = () => setIsOnline(false)
		window.addEventListener("online", handleOnline)
		window.addEventListener("offline", handleOffline)
		return () => {
			window.removeEventListener("online", handleOnline)
			window.removeEventListener("offline", handleOffline)
		}
	}, [])

	useEffect(() => {
		let cancelled = false

		const bootClientServices = async () => {
			try {
				const ffmpegReady = prefetchFFmpeg()
				const serviceWorkerReady =
					"serviceWorker" in navigator
						? navigator.serviceWorker.register("/sw.js").then(async () => {
								await navigator.serviceWorker.ready
							})
						: Promise.resolve()

				await Promise.all([ffmpegReady, serviceWorkerReady])
				if (!cancelled) {
					setIsOfflineReady(true)
					if (!getOfflineReadyDismissed()) setShowOfflineReadyToast(true)
				}
			} catch (error) {
				console.warn("Offline readiness prefetch failed:", error)
			}
		}

		bootClientServices()

		return () => {
			cancelled = true
		}
	}, [])

	const ensureConnected = async (interactive: boolean) => {
		if (!configured) {
			setCloudStatus("Drive unavailable")
			return false
		}

		if (!isOnline) {
			setCloudStatus("Offline. Cloud features are disabled.")
			return false
		}

		if (cloudConnected) return true

		if (!interactive) {
			setCloudStatus("Reconnect Drive to resume cloud sync.")
			return false
		}

		setCloudConnecting(true)
		setCloudError(null)
		setCloudStatus("Connecting to Drive...")

		try {
			const auth = await requestGoogleDriveAuthorizationCode(googleClientId)
			await connectGoogleDriveFn({ data: auth })
			rememberGoogleDriveConnection(true)
			setCloudConnected(true)
			setCloudStatus("Drive connected")
			return true
		} catch (error) {
			setCloudError(
				driveErrorMessage(error, "Google Drive authorization failed."),
			)
			setCloudConnected(false)
			setCloudStatus("Drive disconnected")
			return false
		} finally {
			setCloudConnecting(false)
		}
	}

	const connectDrive = async () => {
		return await ensureConnected(true)
	}

	const disconnectDrive = async () => {
		setCloudConnecting(true)
		setCloudError(null)
		try {
			await disconnectGoogleDriveFn()
		} catch (error) {
			setCloudError(driveErrorMessage(error, "Failed to disconnect Drive."))
		} finally {
			rememberGoogleDriveConnection(false)
			setCloudConnected(false)
			setCloudStatus(configured ? "Drive disconnected" : "Drive unavailable")
			setCloudConnecting(false)
		}
	}

	const loadTodoDocument = async () => {
		if (!(await ensureConnected(false))) return null

		try {
			const result = await loadGoogleDriveTodoDocumentFn()
			setCloudStatus("Todo list synced with Drive")
			setCloudError(null)
			return result.raw
		} catch (error) {
			const message = driveErrorMessage(
				error,
				"Failed to load Drive todo list.",
			)
			setCloudError(message)
			if (message.includes("Connect Google Drive")) setCloudConnected(false)
			setCloudStatus("Drive sync needs attention")
			return null
		}
	}

	const saveTodoDocument = async (raw: string) => {
		if (!(await ensureConnected(false))) return false

		try {
			await saveGoogleDriveTodoDocumentFn({ data: { raw } })
			setCloudStatus("Todo list synced with Drive")
			setCloudError(null)
			return true
		} catch (error) {
			const message = driveErrorMessage(error, "Failed to sync todo list.")
			setCloudError(message)
			if (message.includes("Connect Google Drive")) setCloudConnected(false)
			setCloudStatus("Drive sync needs attention")
			return false
		}
	}

	const uploadProcessedFile = async (file: ProcessedFile) => {
		if (!(await ensureConnected(true))) {
			throw new Error("Drive connection is required before uploading files.")
		}

		const data = new FormData()
		data.set("name", file.name)
		data.set("file", file.blob, file.name)
		const uploaded = await uploadFileToGoogleDriveFn({ data })

		setCloudStatus(`Saved "${file.name}" to Google Drive`)
		setCloudError(null)
		return uploaded
	}

	const uploadProcessedFiles = async (files: ProcessedFile[]) => {
		const uploaded: {
			id: string
			name: string
			webViewLink?: string
		}[] = []
		for (const file of files) {
			uploaded.push(await uploadProcessedFile(file))
		}
		return uploaded
	}

	const disabledReason = cloudConfigLoading
		? "Checking Google Drive configuration."
		: !configured
			? "Google Drive is not configured in this deployment."
			: !isOnline
				? "Offline. Cloud features are disabled."
				: null

	return (
		<AppShellContext.Provider
			value={{
				isOnline,
				isOfflineReady,
				dismissOfflineReadyToast: () => {
					setShowOfflineReadyToast(false)
					try {
						window.sessionStorage.setItem("kitsy.offline-ready.dismissed", "1")
					} catch {
						// Ignore sessionStorage failures.
					}
				},
				cloud: {
					configured,
					connected: cloudConnected,
					connecting: cloudConnecting,
					status: cloudStatus,
					error: cloudError,
					disabledReason,
					connect: connectDrive,
					disconnect: disconnectDrive,
					loadTodoDocument,
					saveTodoDocument,
					uploadProcessedFile,
					uploadProcessedFiles,
				},
			}}
		>
			{children}
			{showOfflineReadyToast && isOfflineReady && (
				<div className="toast toast-bottom toast-end z-[70]">
					<div className="alert border border-success/30 bg-base-100 shadow-lg">
						<div className="max-w-xs text-sm">
							<p className="font-semibold">Offline cache is ready.</p>
							<p className="text-base-content/70">
								Kitsy can now be installed and used locally offline.
							</p>
						</div>
						<button
							type="button"
							className="btn btn-ghost btn-sm btn-circle"
							onClick={() => {
								setShowOfflineReadyToast(false)
								try {
									window.sessionStorage.setItem(
										"kitsy.offline-ready.dismissed",
										"1",
									)
								} catch {
									// Ignore sessionStorage failures.
								}
							}}
							aria-label="Dismiss offline-ready notice"
						>
							x
						</button>
					</div>
				</div>
			)}
		</AppShellContext.Provider>
	)
}

export function useAppShell() {
	return useContext(AppShellContext)
}

export default AppShellProvider
