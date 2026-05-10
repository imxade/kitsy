import { createServerFn } from "@tanstack/react-start"
import {
	clearSession,
	getRequestHeader,
	updateSession,
	useSession as readServerSession,
} from "@tanstack/react-start/server"
import { z } from "zod"
import {
	GOOGLE_DRIVE_RESULTS_FOLDER_NAME,
	GOOGLE_DRIVE_TODO_FILE_NAME,
	type GoogleDriveFile,
} from "./google-drive"

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke"
const GOOGLE_DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files"
const GOOGLE_DRIVE_UPLOAD_FILES_URL =
	"https://www.googleapis.com/upload/drive/v3/files"
const SESSION_NAME =
	process.env.NODE_ENV === "production"
		? "__Host-kitsy_session"
		: "kitsy_session"
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 400
const ACCESS_TOKEN_REFRESH_SKEW_MS = 60 * 1000
const FALLBACK_ACCESS_TOKEN_EXPIRES_IN_SECONDS = 3600

type GoogleDriveServerSession = {
	accessToken?: string
	refreshToken: string
	expiresAt?: number
	scope?: string
}

type AppSession = {
	drive?: GoogleDriveServerSession | null
}

const authorizationCodeSchema = z.object({
	code: z.string().min(1),
	redirectUri: z.string().url(),
})

const todoDocumentSchema = z.object({
	raw: z.string(),
})

const accessTokenCache = new Map<
	string,
	{ token: string; expiresAt: number; scope?: string }
>()

function googleClientId() {
	return (process.env.GOOGLE_DRIVE_CLIENT_ID ?? "").trim()
}

function googleClientSecret() {
	return (process.env.GOOGLE_DRIVE_CLIENT_SECRET ?? "").trim()
}

function requireGoogleClientId() {
	const clientId = googleClientId()
	if (!clientId) throw new Error("Google Drive client ID is not configured.")
	return clientId
}

function requireGoogleClientSecret() {
	const clientSecret = googleClientSecret()
	if (!clientSecret) {
		throw new Error("Google Drive client secret is not configured.")
	}
	return clientSecret
}

function isGoogleDriveServerConfigured() {
	return googleClientId().length > 0 && googleClientSecret().length > 0
}

function getSessionConfig() {
	return {
		password: `kitsy-session:${requireGoogleClientSecret()}`,
		name: SESSION_NAME,
		maxAge: SESSION_MAX_AGE_SECONDS,
		cookie: {
			httpOnly: true,
			sameSite: "lax" as const,
			secure: process.env.NODE_ENV === "production",
			path: "/",
		},
	}
}

async function getAppSession() {
	return await readServerSession<AppSession>(getSessionConfig())
}

function currentRequestOrigin() {
	return getRequestHeader("origin") ?? ""
}

function assertRequestOrigin(expectedOriginUrl: string) {
	const origin = currentRequestOrigin()
	if (!origin) return
	const expectedOrigin = new URL(expectedOriginUrl).origin
	if (origin !== expectedOrigin) {
		throw new Error("Request origin does not match this request.")
	}
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
					: typeof data?.error === "string"
						? data.error
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

async function exchangeGoogleAuthorizationCode(
	code: string,
	redirectUri: string,
) {
	assertRequestOrigin(redirectUri)
	const response = await fetch(GOOGLE_TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: requireGoogleClientId(),
			client_secret: requireGoogleClientSecret(),
			code,
			redirect_uri: redirectUri,
			grant_type: "authorization_code",
		}),
	})
	if (!response.ok) {
		let detail = `Google authorization failed: ${response.status}`
		try {
			const data = await response.json()
			if (data?.error_description) detail = data.error_description
			else if (data?.error) detail = data.error
		} catch {
			// Ignore parsing failure.
		}
		throw new Error(detail)
	}
	const data = (await response.json()) as {
		access_token?: string
		refresh_token?: string
		expires_in?: number
		scope?: string
	}
	if (!data.access_token) {
		throw new Error("Google authorization was incomplete.")
	}
	if (!data.refresh_token) {
		throw new Error(
			"Google authorization did not include offline Drive access. Reconnect and approve Drive access.",
		)
	}
	return {
		accessToken: data.access_token,
		refreshToken: data.refresh_token,
		expiresAt:
			Date.now() +
			(data.expires_in ?? FALLBACK_ACCESS_TOKEN_EXPIRES_IN_SECONDS) * 1000,
		scope: data.scope,
	}
}

async function refreshGoogleAccessToken(refreshToken: string) {
	const clientId = requireGoogleClientId()
	const clientSecret = requireGoogleClientSecret()
	const cacheKey = `${clientId}:${refreshToken.slice(-16)}`
	const cached = accessTokenCache.get(cacheKey)
	if (cached && cached.expiresAt > Date.now() + ACCESS_TOKEN_REFRESH_SKEW_MS) {
		return cached
	}

	const response = await fetch(GOOGLE_TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: clientId,
			client_secret: clientSecret,
			refresh_token: refreshToken,
			grant_type: "refresh_token",
		}),
	})
	if (!response.ok) {
		let detail = `Google Drive session refresh failed: ${response.status}`
		try {
			const data = await response.json()
			if (data?.error_description) detail = data.error_description
			else if (data?.error) detail = data.error
		} catch {
			// Ignore parsing failure.
		}
		throw new Error(detail)
	}
	const data = (await response.json()) as {
		access_token?: string
		expires_in?: number
		scope?: string
	}
	if (!data.access_token) {
		throw new Error("Google Drive session refresh was incomplete.")
	}

	const result = {
		token: data.access_token,
		expiresAt:
			Date.now() +
			(data.expires_in ?? FALLBACK_ACCESS_TOKEN_EXPIRES_IN_SECONDS) * 1000,
		scope: data.scope,
	}
	accessTokenCache.set(cacheKey, result)
	return result
}

async function requireGoogleDriveAccessToken() {
	const session = await getAppSession()
	const drive = session.data.drive
	if (!drive?.refreshToken) {
		throw new Error("Connect Google Drive first.")
	}
	if (
		drive.accessToken &&
		drive.expiresAt &&
		drive.expiresAt > Date.now() + ACCESS_TOKEN_REFRESH_SKEW_MS
	) {
		return drive.accessToken
	}

	const refreshed = await refreshGoogleAccessToken(drive.refreshToken)
	await updateSession(getSessionConfig(), {
		drive: {
			...drive,
			accessToken: refreshed.token,
			expiresAt: refreshed.expiresAt,
			scope: refreshed.scope ?? drive.scope,
		},
	})
	return refreshed.token
}

async function revokeGoogleDriveToken(token: string) {
	try {
		await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
		})
	} catch {
		// Best-effort revocation; ignore expired or already-revoked tokens.
	}
}

async function loadGoogleDriveTodoDocument(accessToken: string) {
	const query = encodeURIComponent(
		`name='${escapeDriveQueryValue(GOOGLE_DRIVE_TODO_FILE_NAME)}' and trashed=false`,
	)
	const response = await driveJsonRequest<{
		files?: GoogleDriveFile[]
	}>(
		`${GOOGLE_DRIVE_FILES_URL}?spaces=appDataFolder&q=${query}&fields=files(id,name,modifiedTime)&pageSize=10`,
		accessToken,
	)

	const file = response.files?.[0]
	if (!file) return null

	const mediaResponse = await fetch(
		`${GOOGLE_DRIVE_FILES_URL}/${encodeURIComponent(file.id)}?alt=media`,
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

async function saveGoogleDriveTodoDocument(accessToken: string, raw: string) {
	const existing = await loadGoogleDriveTodoDocument(accessToken)
	const blob = new Blob([raw], { type: "application/json" })
	const metadata = existing
		? { name: GOOGLE_DRIVE_TODO_FILE_NAME }
		: { name: GOOGLE_DRIVE_TODO_FILE_NAME, parents: ["appDataFolder"] }
	const { body, contentType } = createMultipartBody(metadata, blob)
	const endpoint = existing
		? `${GOOGLE_DRIVE_UPLOAD_FILES_URL}/${encodeURIComponent(existing.file.id)}?uploadType=multipart&fields=id,name,modifiedTime`
		: `${GOOGLE_DRIVE_UPLOAD_FILES_URL}?uploadType=multipart&fields=id,name,modifiedTime`

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
		`${GOOGLE_DRIVE_FILES_URL}?spaces=drive&q=${query}&fields=files(id,name,webViewLink)&pageSize=10`,
		accessToken,
	)

	return response.files?.[0] ?? null
}

async function createGoogleDriveResultsFolder(accessToken: string) {
	return await driveJsonRequest<GoogleDriveFile>(
		`${GOOGLE_DRIVE_FILES_URL}?fields=id,name,webViewLink`,
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

async function ensureGoogleDriveResultsFolder(accessToken: string) {
	return (
		(await findGoogleDriveResultsFolder(accessToken)) ??
		(await createGoogleDriveResultsFolder(accessToken))
	)
}

async function uploadFileToGoogleDrive({
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
	const { body, contentType } = createMultipartBody(
		{
			name,
			parents: [parentId],
		},
		blob,
	)
	return await driveJsonRequest<GoogleDriveFile>(
		`${GOOGLE_DRIVE_UPLOAD_FILES_URL}?uploadType=multipart&fields=id,name,webViewLink`,
		accessToken,
		{
			method: "POST",
			headers: {
				"Content-Type": contentType,
			},
			body,
		},
	)
}

function uploadFileInput(input: FormData) {
	if (!(input instanceof FormData)) {
		throw new Error("Upload request must be form data.")
	}
	return input
}

function formDataString(data: FormData, key: string) {
	const value = data.get(key)
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`Upload request is missing ${key}.`)
	}
	return value.trim()
}

function formDataFile(data: FormData, key: string) {
	const value = data.get(key)
	if (!(value instanceof Blob)) {
		throw new Error(`Upload request is missing ${key}.`)
	}
	return value
}

function safeDriveFileName(name: string) {
	return name.replace(/[\\/]+/g, "-").trim() || "kitsy-output"
}

export const getGoogleDriveAuthConfig = createServerFn({
	method: "GET",
}).handler(async () => {
	if (!isGoogleDriveServerConfigured()) {
		return {
			googleClientId: "",
			connected: false,
		}
	}
	const session = await getAppSession()
	return {
		googleClientId: googleClientId(),
		connected: Boolean(session.data.drive?.refreshToken),
	}
})

export const connectGoogleDriveServer = createServerFn({ method: "POST" })
	.inputValidator((input: unknown) => authorizationCodeSchema.parse(input))
	.handler(async ({ data }) => {
		const drive = await exchangeGoogleAuthorizationCode(
			data.code,
			data.redirectUri,
		)
		await updateSession(getSessionConfig(), { drive })
		return { connected: true }
	})

export const disconnectGoogleDriveServer = createServerFn({
	method: "POST",
}).handler(async () => {
	if (!isGoogleDriveServerConfigured()) {
		return { connected: false }
	}
	const session = await getAppSession()
	const token =
		session.data.drive?.refreshToken ?? session.data.drive?.accessToken
	await clearSession(getSessionConfig())
	if (token) await revokeGoogleDriveToken(token)
	return { connected: false }
})

export const loadGoogleDriveTodoDocumentServer = createServerFn({
	method: "GET",
}).handler(async () => {
	const accessToken = await requireGoogleDriveAccessToken()
	const result = await loadGoogleDriveTodoDocument(accessToken)
	return { raw: result?.raw ?? null }
})

export const saveGoogleDriveTodoDocumentServer = createServerFn({
	method: "POST",
})
	.inputValidator((input: unknown) => todoDocumentSchema.parse(input))
	.handler(async ({ data }) => {
		const accessToken = await requireGoogleDriveAccessToken()
		await saveGoogleDriveTodoDocument(accessToken, data.raw)
		return { ok: true }
	})

export const uploadFileToGoogleDriveServer = createServerFn({ method: "POST" })
	.inputValidator(uploadFileInput)
	.handler(async ({ data }) => {
		const accessToken = await requireGoogleDriveAccessToken()
		const folder = await ensureGoogleDriveResultsFolder(accessToken)
		return await uploadFileToGoogleDrive({
			accessToken,
			blob: formDataFile(data, "file"),
			name: safeDriveFileName(formDataString(data, "name")),
			parentId: folder.id,
		})
	})
