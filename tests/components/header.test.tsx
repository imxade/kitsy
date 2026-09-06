// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		className,
	}: {
		children: React.ReactNode
		to: string
		className?: string
	}) => (
		<a href={to} className={className}>
			{children}
		</a>
	),
	useNavigate: () => vi.fn(),
	useSearch: () => ({ q: "" }),
}))

vi.mock("../../src/components/AppShellProvider", () => ({
	useAppShell: () => ({
		isOnline: true,
		cloud: {
			configured: true,
			connected: false,
			connecting: false,
			status: "Drive disconnected",
			disabledReason: null,
			connect: vi.fn(),
			disconnect: vi.fn(),
		},
	}),
}))

vi.mock("../../src/components/ThemeToggle", () => ({
	default: () => <div data-testid="theme-toggle" />,
}))

vi.mock("../../src/components/DebugConsole", () => ({
	default: () => <div data-testid="debug-console" />,
}))

import Header from "../../src/components/Header"

describe("Header", () => {
	afterEach(() => {
		cleanup()
		vi.restoreAllMocks()
	})

	it("renders brand, GitHub, LinkedIn, and Twitter links in the navbar", () => {
		render(<Header />)

		const linkedinLink = screen.getByRole("link", { name: /linkedin/i })
		expect(linkedinLink).toBeDefined()
		expect(linkedinLink.getAttribute("href")).toBe(
			"https://www.linkedin.com/in/basakrituraj",
		)
		expect(linkedinLink.getAttribute("target")).toBe("_blank")
		expect(linkedinLink.getAttribute("rel")).toBe("noreferrer")

		const twitterLink = screen.getByRole("link", { name: /twitter/i })
		expect(twitterLink).toBeDefined()
		expect(twitterLink.getAttribute("href")).toBe("https://x.com/riturajbasak")
		expect(twitterLink.getAttribute("target")).toBe("_blank")
		expect(twitterLink.getAttribute("rel")).toBe("noreferrer")

		const githubLink = screen.getByRole("link", { name: /github/i })
		expect(githubLink).toBeDefined()
		expect(githubLink.getAttribute("href")).toBe(
			"https://github.com/imxade/Kitsy",
		)
	})
})
