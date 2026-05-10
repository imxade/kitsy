export const GOOGLE_DRIVE_SCOPES = [
	"https://www.googleapis.com/auth/drive.appdata",
	"https://www.googleapis.com/auth/drive.file",
].join(" ")

export const GOOGLE_DRIVE_RESULTS_FOLDER_NAME = "Kitsy"
export const GOOGLE_DRIVE_TODO_FILE_NAME = "kitsy.todo-sync.v2.json"
export const GOOGLE_DRIVE_CONNECTION_KEY = "kitsy.google-drive.connected"

const GOOGLE_IDENTITY_SERVICES_URL = "https://accounts.google.com/gsi/client"
const GOOGLE_AUTH_TIMEOUT_MS = 60_000

export interface GoogleDriveFile {
	id: string
	name: string
	mimeType?: string
	modifiedTime?: string
	webViewLink?: string
}

type GoogleCodeResponse = {
	code?: string
	error?: string
	error_description?: string
}

type GooglePopupError = {
	type?: "popup_failed_to_open" | "popup_closed" | "unknown"
}

type GoogleCodeClient = {
	requestCode: () => void
}

type GoogleIdentityServices = {
	accounts: {
		oauth2: {
			initCodeClient: (config: {
				client_id: string
				scope: string
				ux_mode: "popup"
				callback: (response: GoogleCodeResponse) => void
				error_callback?: (error: GooglePopupError) => void
				include_granted_scopes?: boolean
				select_account?: boolean
			}) => GoogleCodeClient
		}
	}
}

declare global {
	interface Window {
		google?: GoogleIdentityServices
	}
}

let googleIdentityServicesPromise: Promise<GoogleIdentityServices> | null = null

export function isGoogleDriveConfigured(clientId?: string | null) {
	return (clientId ?? "").trim().length > 0
}

export function preloadGoogleIdentityServices() {
	if (typeof window === "undefined") return Promise.resolve(null)
	return loadGoogleIdentityServices()
		.then(() => null)
		.catch(() => null)
}

export function rememberGoogleDriveConnection(connected: boolean) {
	if (connected) {
		window.localStorage.setItem(GOOGLE_DRIVE_CONNECTION_KEY, "1")
		return
	}
	window.localStorage.removeItem(GOOGLE_DRIVE_CONNECTION_KEY)
}

export function shouldReconnectGoogleDrive() {
	return window.localStorage.getItem(GOOGLE_DRIVE_CONNECTION_KEY) === "1"
}

export async function requestGoogleDriveAuthorizationCode(clientId: string) {
	if (!clientId) throw new Error("Google Drive is not configured.")
	const google = await loadGoogleIdentityServices()
	const redirectUri = window.location.origin
	const code = await new Promise<string>((resolve, reject) => {
		let settled = false
		const timeout = window.setTimeout(() => {
			if (settled) return
			settled = true
			reject(new Error("Google authorization timed out. Try again."))
		}, GOOGLE_AUTH_TIMEOUT_MS)

		const finish = (callback: () => void) => {
			if (settled) return
			settled = true
			window.clearTimeout(timeout)
			callback()
		}

		const client = google.accounts.oauth2.initCodeClient({
			client_id: clientId,
			scope: GOOGLE_DRIVE_SCOPES,
			ux_mode: "popup",
			include_granted_scopes: true,
			select_account: true,
			callback: (response) => {
				finish(() => {
					if (response.error) {
						reject(
							new Error(
								`Google authorization failed: ${
									response.error_description ?? response.error
								}`,
							),
						)
						return
					}
					if (!response.code) {
						reject(
							new Error("Google authorization returned no authorization code."),
						)
						return
					}
					resolve(response.code)
				})
			},
			error_callback: (error) => {
				finish(() => {
					if (error.type === "popup_closed") {
						reject(
							new Error("Google authorization was closed before it finished."),
						)
						return
					}
					if (error.type === "popup_failed_to_open") {
						reject(new Error("Google authorization popup failed to open."))
						return
					}
					reject(new Error("Google authorization failed."))
				})
			},
		})

		client.requestCode()
	})
	return { code, redirectUri }
}

function loadGoogleIdentityServices() {
	if (window.google?.accounts.oauth2) return Promise.resolve(window.google)
	googleIdentityServicesPromise ??= new Promise((resolve, reject) => {
		const existingScript = document.querySelector<HTMLScriptElement>(
			`script[src="${GOOGLE_IDENTITY_SERVICES_URL}"]`,
		)
		const script = existingScript ?? document.createElement("script")

		const onLoad = () => {
			if (window.google?.accounts.oauth2) {
				resolve(window.google)
				return
			}
			googleIdentityServicesPromise = null
			script.remove()
			reject(new Error("Google Identity Services did not initialize."))
		}

		script.addEventListener("load", onLoad, { once: true })
		script.addEventListener(
			"error",
			() => {
				googleIdentityServicesPromise = null
				script.remove()
				reject(new Error("Google Identity Services failed to load."))
			},
			{ once: true },
		)

		if (!existingScript) {
			script.src = GOOGLE_IDENTITY_SERVICES_URL
			script.async = true
			script.defer = true
			document.head.appendChild(script)
		}
	})
	return googleIdentityServicesPromise
}
