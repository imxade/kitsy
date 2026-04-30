import {
	createContext,
	useContext,
	useEffect,
	useRef,
	useState,
	type ReactNode,
} from "react"
import { prefetchFFmpeg } from "../lib/ffmpeg-processor"
import type { ProcessedFile } from "../lib/image-processor"
import {
	ensureGoogleDriveResultsFolder,
	isGoogleDriveConfigured,
	loadGoogleDriveTodoDocument,
	rememberGoogleDriveConnection,
	requestGoogleDriveSession,
	revokeGoogleDriveSession,
	saveGoogleDriveTodoDocument,
	shouldReconnectGoogleDrive,
	uploadFileToGoogleDrive,
} from "../lib/google-drive"

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

export function AppShellProvider({ children }: { children: ReactNode }) {
	const configured = isGoogleDriveConfigured()
	const [isOnline, setIsOnline] = useState(true)
	const [isOfflineReady, setIsOfflineReady] = useState(false)
	const [showOfflineReadyToast, setShowOfflineReadyToast] = useState(false)
	const [cloudConnecting, setCloudConnecting] = useState(false)
	const [cloudError, setCloudError] = useState<string | null>(null)
	const [cloudStatus, setCloudStatus] = useState(
		configured ? "Drive disconnected" : "Drive unavailable",
	)
	const [cloudConnected, setCloudConnected] = useState(false)
	const sessionRef = useRef<{
		accessToken: string
		expiresAt: number
	} | null>(null)
	const tokenPromiseRef = useRef<{
		interactive: boolean
		promise: Promise<string | null>
	} | null>(null)
	const ensureAccessRef = useRef<
		(interactive: boolean) => Promise<string | null>
	>(async () => null)

	useEffect(() => {
		if (typeof window !== "undefined") {
			try {
				const saved = window.localStorage.getItem("kitsy.oauth.session")
				if (saved) {
					const session = JSON.parse(saved)
					if (session.expiresAt > Date.now() + 30000) {
						sessionRef.current = session
						setCloudConnected(true)
						setCloudStatus("Drive connected")
					}
				}
			} catch {
				// Ignore
			}
		}
	}, [])

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

	const ensureAccess = async (interactive: boolean) => {
		if (!configured) {
			setCloudStatus("Drive unavailable")
			return null
		}

		if (!isOnline) {
			setCloudStatus("Offline. Cloud features are disabled.")
			return null
		}

		const existing = sessionRef.current
		if (existing && existing.expiresAt > Date.now() + 30_000) {
			setCloudConnected(true)
			return existing.accessToken
		}

		const activeRequest = tokenPromiseRef.current
		if (activeRequest) {
			if (!interactive || activeRequest.interactive) {
				return await activeRequest.promise
			}

			const silentToken = await activeRequest.promise
			if (silentToken) return silentToken
		}

		setCloudConnecting(true)
		setCloudError(null)
		setCloudStatus(
			interactive ? "Connecting to Drive..." : "Refreshing Drive session...",
		)

		const tokenPromise = (async () => {
			try {
				const session = await requestGoogleDriveSession({
					prompt: interactive ? "select_account" : "none",
				})
				sessionRef.current = session
				try {
					window.localStorage.setItem(
						"kitsy.oauth.session",
						JSON.stringify(session),
					)
				} catch {}
				rememberGoogleDriveConnection(true)
				setCloudConnected(true)
				setCloudStatus("Drive connected")
				return session.accessToken
			} catch (error) {
				if (interactive) {
					setCloudError(
						error instanceof Error
							? error.message
							: "Google Drive authorization failed.",
					)
				}
				setCloudConnected(false)
				setCloudStatus(
					interactive
						? "Drive disconnected"
						: "Reconnect Drive to resume cloud sync.",
				)
				return null
			} finally {
				setCloudConnecting(false)
				if (tokenPromiseRef.current?.promise === tokenPromise) {
					tokenPromiseRef.current = null
				}
			}
		})()

		tokenPromiseRef.current = {
			interactive,
			promise: tokenPromise,
		}
		return await tokenPromise
	}

	ensureAccessRef.current = ensureAccess

	useEffect(() => {
		if (!configured || !isOnline || !shouldReconnectGoogleDrive()) return
		if (
			sessionRef.current?.expiresAt &&
			sessionRef.current.expiresAt > Date.now()
		)
			return

		void ensureAccessRef.current(false)
	}, [configured, isOnline])

	const connectDrive = async () => {
		const token = await ensureAccess(true)
		return token !== null
	}

	const disconnectDrive = async () => {
		const accessToken = sessionRef.current?.accessToken ?? null
		sessionRef.current = null
		try {
			window.localStorage.removeItem("kitsy.oauth.session")
		} catch {}
		rememberGoogleDriveConnection(false)
		setCloudConnected(false)
		setCloudError(null)
		setCloudStatus(configured ? "Drive disconnected" : "Drive unavailable")

		if (!accessToken) return
		try {
			await revokeGoogleDriveSession(accessToken)
		} catch {
			// Ignore expired/revoked token failures during disconnect.
		}
	}

	const loadTodoDocument = async () => {
		const token = await ensureAccess(false)
		if (!token) return null

		try {
			const result = await loadGoogleDriveTodoDocument(token)
			if (!result) return null
			setCloudStatus("Todo list synced with Drive")
			return result.raw
		} catch (error) {
			setCloudError(
				error instanceof Error
					? error.message
					: "Failed to load Drive todo list.",
			)
			setCloudStatus("Drive sync needs attention")
			return null
		}
	}

	const saveTodoDocument = async (raw: string) => {
		const token = await ensureAccess(false)
		if (!token) return false

		try {
			await saveGoogleDriveTodoDocument(token, raw)
			setCloudStatus("Todo list synced with Drive")
			return true
		} catch (error) {
			setCloudError(
				error instanceof Error ? error.message : "Failed to sync todo list.",
			)
			setCloudStatus("Drive sync needs attention")
			return false
		}
	}

	const uploadProcessedFile = async (file: ProcessedFile) => {
		const token = await ensureAccess(true)
		if (!token) {
			throw new Error("Drive connection is required before uploading files.")
		}

		const folder = await ensureGoogleDriveResultsFolder(token)
		const uploaded = await uploadFileToGoogleDrive({
			accessToken: token,
			blob: file.blob,
			name: file.name,
			parentId: folder.id,
		})

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

	const disabledReason = !configured
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
							×
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
