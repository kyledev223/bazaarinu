// Guards against route files existing locally but never reaching git (and so
// never reaching Vercel), which happened once via an over-broad .gitignore.
import { execSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) return routeFiles(p);
    return /^(route|page|layout)\.tsx?$/.test(f) ? [p] : [];
  });
}

describe.skipIf(!existsSync(".git"))("repository", () => {
  it("tracks every app route, page and layout", () => {
    const files = routeFiles("src/app").map((f) => f.split(path.sep).join("/"));
    const ignored = files.filter((f) => {
      try {
        execSync(`git check-ignore -q "${f}"`);
        return true; // exit 0 = ignored
      } catch {
        return false;
      }
    });
    expect(ignored).toEqual([]);
    expect(files.length).toBeGreaterThan(20);
  });
});
