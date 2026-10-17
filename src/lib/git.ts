import { simpleGit, type SimpleGit } from "simple-git";
import { promises as fs } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";

export const BOTS_ROOT = path.join(process.cwd(), "data", "bots");

export interface ParsedGithubUrl {
  owner: string;
  repo: string;
  branch: string | null;
  /** URL normalized to a clonable https URL */
  cloneUrl: string;
}

/**
 * Parses a GitHub URL in any of these forms:
 *  - https://github.com/owner/repo
 *  - https://github.com/owner/repo.git
 *  - https://github.com/owner/repo/tree/branch
 *  - https://github.com/owner/repo/tree/branch/sub/path  (branch with subpath)
 *  - git@github.com:owner/repo.git
 */
export function parseGithubUrl(raw: string): ParsedGithubUrl {
  let url = raw.trim();
  if (!url) throw new Error("GitHub URL is required");

  // Convert SSH to https
  if (url.startsWith("git@github.com:")) {
    const parts = url.replace("git@github.com:", "").replace(/\.git$/, "").split("/");
    if (parts.length < 2) throw new Error("Invalid SSH GitHub URL");
    const [owner, repo] = parts;
    return { owner, repo, branch: null, cloneUrl: `https://github.com/${owner}/${repo}.git` };
  }

  if (!url.startsWith("https://github.com/") && !url.startsWith("http://github.com/")) {
    throw new Error("URL must point to github.com");
  }
  const after = url.replace(/^https?:\/\/github\.com\//, "");
  const segments = after.split("/").filter(Boolean);
  if (segments.length < 2) throw new Error("Could not extract owner/repo from URL");

  const owner = segments[0];
  let repo = segments[1].replace(/\.git$/, "");
  let branch: string | null = null;
  if (segments[2] === "tree" && segments[3]) {
    branch = decodeURIComponent(segments[3]);
  }

  return {
    owner,
    repo,
    branch,
    cloneUrl: `https://github.com/${owner}/${repo}.git`,
  };
}

export function botWorkDir(botId: string): string {
  return path.join(BOTS_ROOT, botId);
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function rmrf(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

/**
 * Clones a GitHub repository (shallow) into /data/bots/<botId>.
 * Returns the absolute work directory.
 */
export async function cloneRepo(
  botId: string,
  githubUrl: string,
  branch: string
): Promise<string> {
  const parsed = parseGithubUrl(githubUrl);
  const target = botWorkDir(botId);

  await rmrf(target);
  await ensureDir(path.dirname(target));

  const git: SimpleGit = simpleGit();
  const ref = branch || parsed.branch || "main";

  await git.clone(parsed.cloneUrl, target, [
    "--depth",
    "1",
    "--branch",
    ref,
    "--single-branch",
  ]);

  return target;
}

/**
 * Best-effort guess of install command if user didn't provide one.
 * Looks at which lockfile exists in the working directory.
 */
export async function detectInstallCommand(workDir: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(workDir);
    if (entries.includes("bun.lock") || entries.includes("bun.lockb")) return "bun install";
    if (entries.includes("package-lock.json")) return "npm install";
    if (entries.includes("yarn.lock")) return "yarn install";
    if (entries.includes("requirements.txt")) return "pip install -r requirements.txt";
    if (entries.includes("Cargo.toml")) return "cargo build --release";
    if (entries.includes("go.mod")) return "go mod download";
    if (entries.includes("pom.xml")) return "mvn install";
    if (entries.includes("build.gradle") || entries.includes("build.gradle.kts")) return "./gradlew build";
    if (entries.includes("package.json")) return "npm install";
    return null;
  } catch {
    return null;
  }
}

/** Removes the bot's working directory (called on delete). */
export async function removeWorkDir(botId: string): Promise<void> {
  await rmrf(botWorkDir(botId));
}

/**
 * Quick repository metadata fetch from the GitHub REST API.
 * Returns the default branch and a list of recent branches.
 * Public only — no auth.
 */
export async function fetchRepoMeta(githubUrl: string): Promise<{
  defaultBranch: string;
  branches: string[];
}> {
  const parsed = parseGithubUrl(githubUrl);
  const api = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`;
  const res = await fetch(api, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "bot-fleet",
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const repo = (await res.json()) as { default_branch?: string };
  const branchesRes = await fetch(`${api}/branches?per_page=50`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "bot-fleet",
    },
  });
  const branches =
    branchesRes.ok
      ? ((await branchesRes.json()) as Array<{ name: string }>).map((b) => b.name)
      : [];
  return {
    defaultBranch: repo.default_branch ?? "main",
    branches,
  };
}

/** Optional: if GITHUB_TOKEN is set, use it for cloning private repos. */
export function githubAuthEnv(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return {};
  // git uses GIT_ASKPASS or credential helpers; simplest is to embed in URL via token
  return {};
}

export { db };
