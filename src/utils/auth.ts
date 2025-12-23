export interface AuthCredentials {
    role: "engineer" | "admin";
    passwordHash: string;
}

const STORAGE_KEY = "hmi-auth-credentials";
const DEFAULT_ADMIN123_PASSWORD_HASH =
    "240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9";
const MAX_PASSWORD_LENGTH = 100;

function getSubtleCrypto(): SubtleCrypto | null {
    try {
        if (typeof crypto === "undefined" || !crypto.subtle) return null;
        return crypto.subtle;
    } catch {
        return null;
    }
}

function getLocalStorage(): Storage | null {
    try {
        if (typeof localStorage === "undefined") return null;
        return localStorage;
    } catch {
        return null;
    }
}

function normalizeHash(hash: string): string | null {
    const trimmed = hash.trim();
    if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) return null;
    return trimmed.toLowerCase();
}

function normalizePassword(password: string): string {
    if (typeof password !== "string") {
        throw new Error("Invalid password: expected string.");
    }
    if (password.length === 0) {
        throw new Error("Invalid password: empty.");
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
        throw new Error("Invalid password: too long.");
    }
    return password;
}

function bytesToHex(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let result = "";
    for (const b of bytes) {
        result += b.toString(16).padStart(2, "0");
    }
    return result;
}

function parseCredential(value: unknown): AuthCredentials | null {
    if (!value || typeof value !== "object") return null;

    const maybeRole = (value as { role?: unknown }).role;
    const maybeHash = (value as { passwordHash?: unknown }).passwordHash;

    if (maybeRole !== "engineer" && maybeRole !== "admin") return null;
    if (typeof maybeHash !== "string") return null;

    const normalized = normalizeHash(maybeHash);
    if (!normalized) return null;

    return { role: maybeRole, passwordHash: normalized };
}

export async function hashPassword(password: string): Promise<string> {
    const normalizedPassword = normalizePassword(password);

    const subtle = getSubtleCrypto();
    if (!subtle) {
        throw new Error("Web Crypto API is not available.");
    }

    const encoder = new TextEncoder();
    const data = encoder.encode(normalizedPassword);
    const digest = await subtle.digest("SHA-256", data);
    return bytesToHex(digest);
}

export async function verifyPassword(
    password: string,
    hash: string,
): Promise<boolean> {
    const expected = normalizeHash(hash);
    if (!expected) return false;

    try {
        const actual = await hashPassword(password);
        return actual === expected;
    } catch {
        return false;
    }
}

export function getStoredCredentials(): AuthCredentials[] {
    const storage = getLocalStorage();
    if (!storage) return [];

    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return [];
    }

    if (!Array.isArray(parsed)) return [];

    const credentials: AuthCredentials[] = [];
    for (const item of parsed) {
        const credential = parseCredential(item);
        if (credential) credentials.push(credential);
    }

    return credentials;
}

export function setCredentials(credentials: AuthCredentials[]): void {
    const storage = getLocalStorage();
    if (!storage) return;

    const sanitized = credentials
        .map((c) => parseCredential(c))
        .filter((c): c is AuthCredentials => c !== null);

    try {
        storage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
    } catch {
        return;
    }
}

export function initializeDefaultCredentials(): void {
    const storage = getLocalStorage();
    if (!storage) return;

    const raw = storage.getItem(STORAGE_KEY);
    const existing = getStoredCredentials();

    const defaults: AuthCredentials[] = [
        { role: "engineer", passwordHash: DEFAULT_ADMIN123_PASSWORD_HASH },
        { role: "admin", passwordHash: DEFAULT_ADMIN123_PASSWORD_HASH },
    ];

    if (raw === null || existing.length === 0) {
        setCredentials(defaults);
        return;
    }

    const roles = new Set(existing.map((c) => c.role));
    if (roles.has("engineer") && roles.has("admin")) return;

    const merged = [...existing];
    if (!roles.has("engineer")) {
        merged.push({
            role: "engineer",
            passwordHash: DEFAULT_ADMIN123_PASSWORD_HASH,
        });
    }
    if (!roles.has("admin")) {
        merged.push({
            role: "admin",
            passwordHash: DEFAULT_ADMIN123_PASSWORD_HASH,
        });
    }

    setCredentials(merged);
}

try {
    initializeDefaultCredentials();
} catch {
}
