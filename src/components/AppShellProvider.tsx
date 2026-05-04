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
	handleOAuthCallback,
	isGoogleDriveConfigured,
	loadGoogleDriveTodoDocument,
	refreshAccessToken,
	rememberGoogleDriveConnection,
	requestGoogleDriveSession,
	revokeGoogleDriveSession,
	saveGoogleDriveTodoDocument,
	shouldReconnectGoogleDrive,
	uploadFileToGoogleDrive,
	type GoogleDriveSession,
} from "../lib/google-drive"

const SESSION_STORAGE_KEY = "kitsy.oauth.session"

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

function loadStoredSession(): GoogleDriveSession | null {
	try {
		const saved = window.localStorage.getItem(SESSION_STORAGE_KEY)
		if (!saved) return null
		const session = JSON.parse(saved) as GoogleDriveSession
		// Must have a refresh token to be useful
		if (!session.refreshToken) return null
		return session
	} catch {
		return null
	}
}

function saveStoredSession(session: GoogleDriveSession) {
	try {
		window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
	} catch {
		// Ignore storage failures.
	}
}

function clearStoredSession() {
	try {
		window.localStorage.removeItem(SESSION_STORAGE_KEY)
	} catch {
		// Ignore storage failures.
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
	const sessionRef = useRef<GoogleDriveSession | null>(null)
	const refreshPromiseRef = useRef<Promise<string | null> | null>(null)
	const refreshTimerRef = useRef<number | null>(null)
	const ensureAccessRef = useRef<
		(interactive: boolean) => Promise<string | null>
	>(async () => null)

	// If this window is the OAuth popup callback, relay the code and close.
	useEffect(() => {
		handleOAuthCallback()
	}, [])

	// Hydrate session from localStorage on mount
	useEffect(() => {
		if (typeof window === "undefined") return
		const stored = loadStoredSession()
		if (stored) {
			sessionRef.current = stored
			// If access token is still valid, mark as connected immediately
			if (stored.expiresAt > Date.now() + 30_000) {
				setCloudConnected(true)
				setCloudStatus("Drive connected")
			}
			// If we have a refresh token, we can reconnect silently
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

	// Schedule a proactive token refresh 2 minutes before expiry
	const scheduleRefreshRef = useRef<(session: GoogleDriveSession) => void>(
		() => undefined,
	)
	scheduleRefreshRef.current = (session: GoogleDriveSession) => {
		if (refreshTimerRef.current) {
			window.clearTimeout(refreshTimerRef.current)
			refreshTimerRef.current = null
		}

		const msUntilExpiry = session.expiresAt - Date.now()
		const refreshIn = Math.max(0, msUntilExpiry - 2 * 60 * 1000)

		refreshTimerRef.current = window.setTimeout(() => {
			void ensureAccessRef.current(false)
		}, refreshIn)
	}

	const doRefresh = async (
		currentSession: GoogleDriveSession,
	): Promise<string | null> => {
		try {
			const result = await refreshAccessToken(currentSession.refreshToken)
			const updated: GoogleDriveSession = {
				...currentSession,
				accessToken: result.accessToken,
				expiresAt: result.expiresAt,
				scope: result.scope,
			}
			sessionRef.current = updated
			saveStoredSession(updated)
			setCloudConnected(true)
			setCloudStatus("Drive connected")
			scheduleRefreshRef.current(updated)
			return updated.accessToken
		} catch {
			// Refresh failed — token may be revoked or expired permanently
			setCloudConnected(false)
			setCloudStatus("Reconnect Drive to resume cloud sync.")
			return null
		}
	}

	const ensureAccess = async (interactive: boolean) => {
		if (!configured) {
			setCloudStatus("Drive unavailable")
			return null
		}

		if (!isOnline) {
			setCloudStatus("Offline. Cloud features are disabled.")
			return null
		}

		// Check if current access token is still valid
		const existing = sessionRef.current
		if (existing && existing.expiresAt > Date.now() + 30_000) {
			setCloudConnected(true)
			return existing.accessToken
		}

		// If we have a refresh token, try silent refresh
		if (existing?.refreshToken) {
			// Deduplicate concurrent refresh calls
			if (refreshPromiseRef.current) {
				return await refreshPromiseRef.current
			}

			setCloudStatus("Refreshing Drive session...")
			const promise = doRefresh(existing)
			refreshPromiseRef.current = promise

			try {
				const token = await promise
				if (token) return token
			} finally {
				refreshPromiseRef.current = null
			}
		}

		// No refresh token or refresh failed — need interactive consent
		if (!interactive) {
			setCloudConnected(false)
			setCloudStatus("Reconnect Drive to resume cloud sync.")
			return null
		}

		// Interactive: open consent popup
		setCloudConnecting(true)
		setCloudError(null)
		setCloudStatus("Connecting to Drive...")

		try {
			const session = await requestGoogleDriveSession()
			sessionRef.current = session
			saveStoredSession(session)
			rememberGoogleDriveConnection(true)
			setCloudConnected(true)
			setCloudStatus("Drive connected")
			scheduleRefreshRef.current(session)
			return session.accessToken
		} catch (error) {
			setCloudError(
				error instanceof Error
					? error.message
					: "Google Drive authorization failed.",
			)
			setCloudConnected(false)
			setCloudStatus("Drive disconnected")
			return null
		} finally {
			setCloudConnecting(false)
		}
	}

	ensureAccessRef.current = ensureAccess

	// Automatic silent reconnect on page load
	useEffect(() => {
		if (!configured || !isOnline || !shouldReconnectGoogleDrive()) return
		const stored = sessionRef.current
		if (!stored?.refreshToken) return

		// If access token is still valid, just schedule refresh
		if (stored.expiresAt > Date.now() + 30_000) {
			scheduleRefreshRef.current(stored)
			return
		}

		// Access token expired, refresh silently
		void ensureAccessRef.current(false)
	}, [configured, isOnline])

	// Clean up refresh timer on unmount
	useEffect(() => {
		return () => {
			if (refreshTimerRef.current) {
				window.clearTimeout(refreshTimerRef.current)
			}
		}
	}, [])

	const connectDrive = async () => {
		const token = await ensureAccess(true)
		return token !== null
	}

	const disconnectDrive = async () => {
		const session = sessionRef.current
		sessionRef.current = null
		if (refreshTimerRef.current) {
			window.clearTimeout(refreshTimerRef.current)
			refreshTimerRef.current = null
		}
		clearStoredSession()
		rememberGoogleDriveConnection(false)
		setCloudConnected(false)
		setCloudError(null)
		setCloudStatus(configured ? "Drive disconnected" : "Drive unavailable")

		// Revoke the refresh token (or access token) for clean disconnect
		const tokenToRevoke = session?.refreshToken ?? session?.accessToken
		if (tokenToRevoke) {
			try {
				await revokeGoogleDriveSession(tokenToRevoke)
			} catch {
				// Ignore expired/revoked token failures during disconnect.
			}
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
