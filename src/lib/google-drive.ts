export const GOOGLE_DRIVE_SCOPES = [
	"https://www.googleapis.com/auth/drive.appdata",
	"https://www.googleapis.com/auth/drive.file",
].join(" ")

export const GOOGLE_DRIVE_RESULTS_FOLDER_NAME = "Kitsy"
export const GOOGLE_DRIVE_TODO_FILE_NAME = "kitsy.todo-sync.v2.json"
export const GOOGLE_DRIVE_CONNECTION_KEY = "kitsy.google-drive.connected"

const OAUTH_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token"
const OAUTH_REVOKE_URL = "https://oauth2.googleapis.com/revoke"

export interface GoogleDriveSession {
	accessToken: string
	refreshToken: string
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

function getGoogleDriveClientId() {
	return (import.meta.env.VITE_GOOGLE_DRIVE_CLIENT_ID ?? "").trim()
}

function getGoogleDriveClientSecret() {
	return (import.meta.env.VITE_GOOGLE_DRIVE_CLIENT_SECRET ?? "").trim()
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

// ── PKCE helpers ──

function generateCodeVerifier(): string {
	const array = new Uint8Array(32)
	crypto.getRandomValues(array)
	return base64UrlEncode(array)
}

async function generateCodeChallenge(verifier: string): Promise<string> {
	const encoder = new TextEncoder()
	const data = encoder.encode(verifier)
	const digest = await crypto.subtle.digest("SHA-256", data)
	return base64UrlEncode(new Uint8Array(digest))
}

function base64UrlEncode(buffer: Uint8Array): string {
	let str = ""
	for (const byte of buffer) {
		str += String.fromCharCode(byte)
	}
	return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

// ── OAuth authorization code flow via popup ──

function buildAuthUrl(
	clientId: string,
	codeChallenge: string,
	redirectUri: string,
): string {
	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: redirectUri,
		response_type: "code",
		scope: GOOGLE_DRIVE_SCOPES,
		access_type: "offline",
		prompt: "consent",
		code_challenge: codeChallenge,
		code_challenge_method: "S256",
	})
	return `${OAUTH_AUTHORIZE_URL}?${params.toString()}`
}

function openAuthPopup(url: string): Window {
	const width = 500
	const height = 600
	const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2)
	const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2)
	const features = `width=${width},height=${height},left=${left},top=${top},scrollbars=yes,resizable=yes`
	const popup = window.open(url, "kitsy-google-auth", features)
	if (!popup) {
		throw new Error("Google authorization popup failed to open.")
	}
	return popup
}

const OAUTH_STORAGE_KEY = "kitsy-oauth-callback"

/**
 * Call this once on app startup. If the current window is the OAuth popup
 * (opened by the opener for Google consent), it extracts the authorization
 * code from the URL, writes it to `localStorage`, and closes itself.
 * The main window listens for the `storage` event to receive the code.
 */
export function handleOAuthCallback(): boolean {
	if (typeof window === "undefined") return false

	const params = new URLSearchParams(window.location.search)
	const code = params.get("code")
	const error = params.get("error")
	const hasOAuthParams = code !== null || error !== null

	if (!hasOAuthParams) return false

	// We are the popup callback. Relay the result via localStorage.
	// We use a timestamp to ensure the storage event fires even for duplicates.
	const payload = JSON.stringify({
		code: code ?? undefined,
		error: error ?? undefined,
		ts: Date.now(),
	})

	window.localStorage.setItem(OAUTH_STORAGE_KEY, payload)

	// Clean the URL so the app doesn't re-trigger on refresh
	window.history.replaceState({}, "", window.location.pathname)

	// Add a small delay before closing to ensure the storage event fires
	// and is received by the opener window.
	setTimeout(() => {
		window.close()
	}, 100)
	return true
}

function waitForAuthCode(popup: Window): Promise<string> {
	return new Promise((resolve, reject) => {
		let settled = false

		// Clear any old stale callback data first
		window.localStorage.removeItem(OAUTH_STORAGE_KEY)

		const cleanup = () => {
			settled = true
			clearInterval(closedPoll)
			window.removeEventListener("storage", onStorage)
			window.localStorage.removeItem(OAUTH_STORAGE_KEY)
		}

		const onStorage = (event: StorageEvent) => {
			if (event.key !== OAUTH_STORAGE_KEY || !event.newValue) return
			if (settled) return

			cleanup()
			popup.close()

			try {
				const data = JSON.parse(event.newValue)
				if (data.error) {
					reject(
						new Error(
							data.error === "access_denied"
								? "Google authorization was denied."
								: `Google authorization failed: ${data.error}`,
						),
					)
					return
				}

				if (!data.code) {
					reject(new Error("Google authorization failed: no code returned."))
					return
				}

				resolve(data.code)
			} catch {
				reject(new Error("Failed to parse authorization response."))
			}
		}

		// Poll only for popup closure (user manually closes the popup)
		const closedPoll = setInterval(() => {
			if (popup.closed && !settled) {
				// Wait a brief moment to see if the storage event is in the queue
				setTimeout(() => {
					if (!settled) {
						cleanup()
						reject(
							new Error("Google authorization was closed before it finished."),
						)
					}
				}, 300)
				clearInterval(closedPoll)
			}
		}, 500)

		window.addEventListener("storage", onStorage)
	})
}

async function exchangeCodeForTokens(
	code: string,
	codeVerifier: string,
	redirectUri: string,
): Promise<GoogleDriveSession> {
	const clientId = getGoogleDriveClientId()
	const clientSecret = getGoogleDriveClientSecret()

	const body = new URLSearchParams({
		client_id: clientId,
		code,
		code_verifier: codeVerifier,
		grant_type: "authorization_code",
		redirect_uri: redirectUri,
	})
	if (clientSecret) {
		body.set("client_secret", clientSecret)
	}

	const response = await fetch(OAUTH_TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body,
	})

	if (!response.ok) {
		let detail = "Token exchange failed."
		try {
			const data = await response.json()
			if (data?.error_description) detail = data.error_description
			else if (data?.error) detail = data.error
		} catch {
			// Ignore parsing failure.
		}
		throw new Error(detail)
	}

	const data = await response.json()
	if (!data.access_token) {
		throw new Error("Google Drive authorization failed: no access token.")
	}
	if (!data.refresh_token) {
		throw new Error(
			"Google Drive authorization failed: no refresh token. Re-authorize with full consent.",
		)
	}

	return {
		accessToken: data.access_token,
		refreshToken: data.refresh_token,
		expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
		scope: data.scope ?? GOOGLE_DRIVE_SCOPES,
	}
}

export async function refreshAccessToken(
	refreshToken: string,
): Promise<{ accessToken: string; expiresAt: number; scope: string }> {
	const clientId = getGoogleDriveClientId()
	const clientSecret = getGoogleDriveClientSecret()

	const body = new URLSearchParams({
		client_id: clientId,
		refresh_token: refreshToken,
		grant_type: "refresh_token",
	})
	if (clientSecret) {
		body.set("client_secret", clientSecret)
	}

	const response = await fetch(OAUTH_TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body,
	})

	if (!response.ok) {
		let detail = "Token refresh failed."
		try {
			const data = await response.json()
			if (data?.error_description) detail = data.error_description
			else if (data?.error) detail = data.error
		} catch {
			// Ignore parsing failure.
		}
		throw new Error(detail)
	}

	const data = await response.json()
	if (!data.access_token) {
		throw new Error("Token refresh failed: no access token returned.")
	}

	return {
		accessToken: data.access_token,
		expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
		scope: data.scope ?? GOOGLE_DRIVE_SCOPES,
	}
}

// ── Public API ──

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

/**
 * Opens a popup for user consent and returns a session with both access and
 * refresh tokens. Uses Authorization Code flow with PKCE. The popup only
 * appears when the user explicitly clicks "Connect Drive". Silent renewal
 * of expired access tokens is handled by `refreshAccessToken` using the
 * stored refresh token — no popup needed.
 */
export async function requestGoogleDriveSession(): Promise<GoogleDriveSession> {
	const clientId = getGoogleDriveClientId()
	if (!clientId) {
		throw new Error("Google Drive is not configured for this deployment.")
	}

	// 1. Open popup synchronously FIRST to avoid browser popup blockers,
	// because `await generateCodeChallenge` will lose the transient user activation.
	const popup = openAuthPopup("")

	// 2. Generate PKCE params and build the auth URL
	const redirectUri = `${window.location.origin}/`
	const codeVerifier = generateCodeVerifier()
	const codeChallenge = await generateCodeChallenge(codeVerifier)
	const authUrl = buildAuthUrl(clientId, codeChallenge, redirectUri)

	// 3. Navigate the popup to the actual Google Auth URL
	popup.location.href = authUrl

	// 4. Wait for the user to complete the flow
	const code = await waitForAuthCode(popup)
	return await exchangeCodeForTokens(code, codeVerifier, redirectUri)
}

export async function revokeGoogleDriveSession(token: string) {
	try {
		await fetch(`${OAUTH_REVOKE_URL}?token=${encodeURIComponent(token)}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
		})
	} catch {
		// Best-effort revocation; ignore failures for expired/already-revoked tokens.
	}
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
