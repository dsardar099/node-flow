import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Both Dockerfiles copy every workspace manifest in before `pnpm install`, so
// that the install layer caches on dependency changes rather than on source
// changes. That list is hand-written, and nothing in the build tells you when
// it stops matching the workspace: adding a package silently omits it from the
// install, and deleting one fails the build with `file not found` — which is
// how `packages/server-e2e` broke the images the moment it was removed.
//
// The failure lands in CI, minutes into an image build, on a change that had
// nothing to do with Docker. Comparing the two lists here moves it to a unit
// test that names the offending package.

// `__dirname`, not `import.meta.dirname`: this package builds to CommonJS.
const repoRoot = join(__dirname, '../../../..');

function workspacePackages(): string[] {
  return readdirSync(join(repoRoot, 'packages'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) =>
      existsSync(join(repoRoot, 'packages', name, 'package.json')),
    )
    .sort();
}

function manifestsCopiedBy(dockerfile: string): string[] {
  const text = readFileSync(join(repoRoot, 'docker', dockerfile), 'utf8');
  return [...text.matchAll(/^COPY packages\/([^/\s]+)\/package\.json/gm)]
    .map((m) => m[1])
    .sort();
}

function manifest(pkg: string): Record<string, any> {
  return JSON.parse(
    readFileSync(join(repoRoot, 'packages', pkg, 'package.json'), 'utf8'),
  );
}

const published = () => workspacePackages().filter((p) => !manifest(p).private);

describe('docker manifest lists', () => {
  it.each(['server.Dockerfile', 'ui.Dockerfile'])(
    '%s copies exactly the packages the workspace has',
    (dockerfile) => {
      expect(manifestsCopiedBy(dockerfile)).toEqual(workspacePackages());
    },
  );

  it('finds the manifests it is reading, so a rename cannot make this vacuous', () => {
    expect(workspacePackages()).toContain('server');
    expect(manifestsCopiedBy('server.Dockerfile').length).toBeGreaterThan(1);
  });
});

// `pnpm -r publish` skips anything marked private, and rewrites `workspace:*`
// to the concrete version on the way out. A published package that depends on
// a private one therefore ships a manifest naming a version of a package that
// does not exist, and every `npm install` of it fails on a 404 — in the
// registry, where it cannot be taken back, not in CI.
describe('npm publish closure', () => {
  it('has no published package depending on an unpublished one', () => {
    const names = new Set(published().map((p) => manifest(p).name));
    const broken: string[] = [];

    for (const pkg of published()) {
      const { name, dependencies = {}, peerDependencies = {} } = manifest(pkg);
      for (const dep of [
        ...Object.keys(dependencies),
        ...Object.keys(peerDependencies),
      ]) {
        if (dep.startsWith('@node-flow-dev/') && !names.has(dep))
          broken.push(`${name} -> ${dep}`);
      }
    }

    expect(broken).toEqual([]);
  });

  // `--provenance` refuses to sign a package with no repository field, and the
  // release dry run packs rather than publishes, so it never reaches this.
  it('gives every published package the repository field provenance requires', () => {
    for (const pkg of published()) {
      const { name, repository } = manifest(pkg);
      expect(repository?.url, `${name} has no repository.url`).toMatch(
        /github\.com/,
      );
      expect(repository?.directory, `${name} has no repository.directory`).toBe(
        `packages/${pkg}`,
      );
    }
  });

  it('publishes something, so the two checks above cannot pass vacuously', () => {
    expect(published().length).toBeGreaterThanOrEqual(4);
  });
});
