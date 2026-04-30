const GOOGLE_IDENTITY_SCRIPT_URL = "https://accounts.google.com/gsi/client"

export const GOOGLE_DRIVE_SCOPES = [
	"https://www.googleapis.com/auth/drive.appdata",
	"https://www.googleapis.com/auth/drive.file",
].join(" ")

export const GOOGLE_DRIVE_RESULTS_FOLDER_NAME = "Kitsy"
export const GOOGLE_DRIVE_TODO_FILE_NAME = "kitsy.todo-sync.v2.json"
export const GOOGLE_DRIVE_CONNECTION_KEY = "kitsy.google-drive.connected"

interface GoogleOauthErrorCallback {
	type: "popup_failed_to_open" | "popup_closed" | "unknown"
}

interface GoogleTokenResponse {
	access_token?: string
	expires_in?: number
	scope?: string
	error?: string
	error_description?: string
}

interface GoogleTokenClient {
	requestAccessToken: (overrideConfig?: {
		prompt?: "" | "none" | "consent" | "select_account"
		login_hint?: string
	}) => void
}

interface GoogleIdentity {
	accounts: {
		oauth2: {
			initTokenClient: (config: {
				client_id: string
				scope: string
				prompt?: "" | "none" | "consent" | "select_account"
				login_hint?: string
				callback: (response: GoogleTokenResponse) => void
				error_callback?: (error: GoogleOauthErrorCallback) => void
			}) => GoogleTokenClient
			revoke: (
				accessToken: string,
				callback?: (response: {
					successful?: boolean
					error?: string
					error_description?: string
				}) => void,
			) => void
		}
	}
}

export interface GoogleDriveSession {
	accessToken: string
	expiresAt: number
	scope: string
}

export interface GoogleDriveFile {
	id: string
	name: string
	mimeType?: string
	modifiedTime?: string
	webViewLink?: string
}

declare global {
	interface Window {
		google?: GoogleIdentity
	}
}

let googleIdentityPromise: Promise<GoogleIdentity> | null = null

function getGoogleDriveClientId() {
	return (import.meta.env.VITE_GOOGLE_DRIVE_CLIENT_ID ?? "").trim()
}

function escapeDriveQueryValue(value: string) {
	return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

async function ensureDriveResponse(response: Response) {
	if (response.ok) return response

	let detail = response.statusText || "Request failed."
	try {
		const data = await response.json()
		const message =
			typeof data?.error?.message === "string"
				? data.error.message
				: typeof data?.error_description === "string"
					? data.error_description
					: null
		if (message) detail = message
	} catch {
		try {
			const text = await response.text()
			if (text) detail = text
		} catch {
			// Ignore secondary parsing failures.
		}
	}

	throw new Error(`Google Drive request failed (${response.status}): ${detail}`)
}

async function driveJsonRequest<T>(
	input: string,
	accessToken: string,
	init?: RequestInit,
) {
	const headers = new Headers(init?.headers)
	headers.set("Authorization", `Bearer ${accessToken}`)

	const response = await fetch(input, {
		...init,
		headers,
	})
	await ensureDriveResponse(response)
	return (await response.json()) as T
}

function createMultipartBody(metadata: Record<string, unknown>, blob: Blob) {
	const boundary = `kitsy-${crypto.randomUUID()}`
	const body = new Blob(
		[
			`--${boundary}\r\n`,
			"Content-Type: application/json; charset=UTF-8\r\n\r\n",
			JSON.stringify(metadata),
			"\r\n",
			`--${boundary}\r\n`,
			`Content-Type: ${blob.type || "application/octet-stream"}\r\n\r\n`,
			blob,
			"\r\n",
			`--${boundary}--`,
		],
		{
			type: `multipart/related; boundary=${boundary}`,
		},
	)

	return {
		body,
		contentType: `multipart/related; boundary=${boundary}`,
	}
}

async function loadGoogleIdentity(): Promise<GoogleIdentity> {
	if (window.google?.accounts?.oauth2) return window.google
	if (googleIdentityPromise) return googleIdentityPromise

	googleIdentityPromise = new Promise<GoogleIdentity>((resolve, reject) => {
		const existing = document.querySelector<HTMLScriptElement>(
			`script[src="${GOOGLE_IDENTITY_SCRIPT_URL}"]`,
		)
		if (existing) {
			existing.addEventListener("load", () => {
				if (window.google?.accounts?.oauth2) resolve(window.google)
			})
			existing.addEventListener("error", () => {
				reject(new Error("Failed to load Google Identity Services."))
			})
			return
		}

		const script = document.createElement("script")
		script.src = GOOGLE_IDENTITY_SCRIPT_URL
		script.async = true
		script.defer = true
		script.onload = () => {
			if (window.google?.accounts?.oauth2) {
				resolve(window.google)
				return
			}
			reject(new Error("Google Identity Services did not initialize."))
		}
		script.onerror = () => {
			reject(new Error("Failed to load Google Identity Services."))
		}
		document.head.appendChild(script)
	})

	return googleIdentityPromise
}

export function isGoogleDriveConfigured() {
	return getGoogleDriveClientId().length > 0
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

export async function requestGoogleDriveSession({
	prompt,
}: {
	prompt: "" | "none" | "consent" | "select_account"
}): Promise<GoogleDriveSession> {
	const clientId = getGoogleDriveClientId()
	if (!clientId) {
		throw new Error("Google Drive is not configured for this deployment.")
	}

	const google = await loadGoogleIdentity()

	return await new Promise<GoogleDriveSession>((resolve, reject) => {
		let settled = false
		const fail = (message: string) => {
			if (settled) return
			settled = true
			reject(new Error(message))
		}
		const succeed = (session: GoogleDriveSession) => {
			if (settled) return
			settled = true
			resolve(session)
		}

		const client = google.accounts.oauth2.initTokenClient({
			client_id: clientId,
			scope: GOOGLE_DRIVE_SCOPES,
			prompt,
			callback: (response) => {
				if (!response.access_token) {
					fail(
						response.error_description ||
							response.error ||
							"Google Drive authorization failed.",
					)
					return
				}

				succeed({
					accessToken: response.access_token,
					expiresAt: Date.now() + (response.expires_in ?? 0) * 1000,
					scope: response.scope ?? GOOGLE_DRIVE_SCOPES,
				})
			},
			error_callback: (error) => {
				const message =
					error.type === "popup_closed"
						? "Google authorization was closed before it finished."
						: error.type === "popup_failed_to_open"
							? "Google authorization popup failed to open."
							: "Google authorization failed."
				fail(message)
			},
		})

		client.requestAccessToken({ prompt })
	})
}

export async function revokeGoogleDriveSession(accessToken: string) {
	const google = await loadGoogleIdentity()
	await new Promise<void>((resolve) => {
		google.accounts.oauth2.revoke(accessToken, () => resolve())
	})
}

export async function loadGoogleDriveTodoDocument(accessToken: string) {
	const query = encodeURIComponent(
		`name='${escapeDriveQueryValue(GOOGLE_DRIVE_TODO_FILE_NAME)}' and trashed=false`,
	)
	const response = await driveJsonRequest<{
		files?: GoogleDriveFile[]
	}>(
		`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${query}&fields=files(id,name,modifiedTime)&pageSize=10`,
		accessToken,
	)

	const file = response.files?.[0]
	if (!file) return null

	const mediaResponse = await fetch(
		`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`,
		{
			headers: {
				Authorization: `Bearer ${accessToken}`,
			},
		},
	)
	await ensureDriveResponse(mediaResponse)

	return {
		file,
		raw: await mediaResponse.text(),
	}
}

export async function saveGoogleDriveTodoDocument(
	accessToken: string,
	raw: string,
) {
	const existing = await loadGoogleDriveTodoDocument(accessToken)
	const blob = new Blob([raw], { type: "application/json" })
	const metadata = existing
		? { name: GOOGLE_DRIVE_TODO_FILE_NAME }
		: { name: GOOGLE_DRIVE_TODO_FILE_NAME, parents: ["appDataFolder"] }
	const { body, contentType } = createMultipartBody(metadata, blob)
	const endpoint = existing
		? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existing.file.id)}?uploadType=multipart&fields=id,name,modifiedTime`
		: "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime"

	return await driveJsonRequest<GoogleDriveFile>(endpoint, accessToken, {
		method: existing ? "PATCH" : "POST",
		headers: {
			"Content-Type": contentType,
		},
		body,
	})
}

async function findGoogleDriveResultsFolder(accessToken: string) {
	const query = encodeURIComponent(
		`name='${escapeDriveQueryValue(GOOGLE_DRIVE_RESULTS_FOLDER_NAME)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
	)
	const response = await driveJsonRequest<{
		files?: GoogleDriveFile[]
	}>(
		`https://www.googleapis.com/drive/v3/files?spaces=drive&q=${query}&fields=files(id,name,webViewLink)&pageSize=10`,
		accessToken,
	)

	return response.files?.[0] ?? null
}

async function createGoogleDriveResultsFolder(accessToken: string) {
	return await driveJsonRequest<GoogleDriveFile>(
		"https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink",
		accessToken,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json; charset=UTF-8",
			},
			body: JSON.stringify({
				name: GOOGLE_DRIVE_RESULTS_FOLDER_NAME,
				mimeType: "application/vnd.google-apps.folder",
			}),
		},
	)
}

export async function ensureGoogleDriveResultsFolder(accessToken: string) {
	return (
		(await findGoogleDriveResultsFolder(accessToken)) ??
		(await createGoogleDriveResultsFolder(accessToken))
	)
}

export async function uploadFileToGoogleDrive({
	accessToken,
	blob,
	name,
	parentId,
}: {
	accessToken: string
	blob: Blob
	name: string
	parentId: string
}) {
	const initResponse = await fetch(
		"https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink",
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"Content-Type": "application/json; charset=UTF-8",
				"X-Upload-Content-Type": blob.type || "application/octet-stream",
				"X-Upload-Content-Length": String(blob.size),
			},
			body: JSON.stringify({
				name,
				parents: [parentId],
			}),
		},
	)
	await ensureDriveResponse(initResponse)

	const uploadUrl = initResponse.headers.get("Location")
	if (!uploadUrl) {
		throw new Error("Google Drive did not return an upload session URL.")
	}

	const uploadResponse = await fetch(uploadUrl, {
		method: "PUT",
		headers: {
			"Content-Type": blob.type || "application/octet-stream",
		},
		body: blob,
	})
	await ensureDriveResponse(uploadResponse)
	return (await uploadResponse.json()) as GoogleDriveFile
}
