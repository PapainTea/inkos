// Copy all assets needed for standalone distribution into dist/
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const distDir = path.resolve(__dirname, "..", "dist");
const repoRoot = path.resolve(__dirname, "..", "..", "..");

console.log("Copying dist assets...");

// 1. Web UI
const publicSrc = path.resolve(__dirname, "..", "public");
const publicDest = path.join(distDir, "public");
fs.cpSync(publicSrc, publicDest, { recursive: true });
console.log("  public → dist/public");

// 2. CLI with full directory structure
const cliDist = path.join(distDir, "cli");
if (fs.existsSync(cliDist)) fs.rmSync(cliDist, { recursive: true });
fs.mkdirSync(path.join(cliDist, "dist"), { recursive: true });
fs.cpSync(
  path.join(repoRoot, "packages", "cli", "dist"),
  path.join(cliDist, "dist"),
  { recursive: true },
);

// Fix CLI package.json: replace workspace:* with actual version
const cliPkg = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "packages", "cli", "package.json"), "utf8"),
);
const corePkg = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "packages", "core", "package.json"), "utf8"),
);
if (cliPkg.dependencies) {
  for (const [k, v] of Object.entries(cliPkg.dependencies)) {
    if (v.startsWith("workspace:")) cliPkg.dependencies[k] = corePkg.version;
  }
}
delete cliPkg.devDependencies;
fs.writeFileSync(path.join(cliDist, "package.json"), JSON.stringify(cliPkg, null, 2));
console.log("  cli/package.json (workspace:* fixed)");

// 3. Core into CLI's node_modules
const coreTarget = path.join(cliDist, "node_modules", "@actalk", "inkos-core");
fs.mkdirSync(path.join(coreTarget, "dist"), { recursive: true });
fs.cpSync(
  path.join(repoRoot, "packages", "core", "dist"),
  path.join(coreTarget, "dist"),
  { recursive: true },
);
fs.copyFileSync(
  path.join(repoRoot, "packages", "core", "package.json"),
  path.join(coreTarget, "package.json"),
);
const genresDir = path.join(repoRoot, "packages", "core", "genres");
if (fs.existsSync(genresDir)) {
  fs.cpSync(genresDir, path.join(coreTarget, "genres"), { recursive: true });
}
console.log("  core → cli/node_modules/@actalk/inkos-core/");

// 4. Install CLI runtime dependencies
console.log("  Installing CLI runtime dependencies...");
try {
  execSync("npm install --omit=dev --no-package-lock", {
    cwd: cliDist,
    stdio: "pipe",
  });
  console.log("  npm install OK");
} catch (err) {
  console.error("  npm install failed:", String(err.stderr || err).slice(0, 300));
}

// 5. Bundle core as CJS for pkg (pkg Node 18 can't dynamic-import ESM)
const coreBundleDest = path.join(distDir, "core-bundle.cjs");
console.log("  Bundling core as CJS for pkg...");
try {
  // Write a shim that polyfills import.meta.url before the bundle
  const shimPath = path.join(distDir, "_core-shim.cjs");
  fs.writeFileSync(shimPath, [
    `const {pathToFileURL}=require("node:url");`,
    `const {createRequire:_cr}=require("node:module");`,
    `const _url=pathToFileURL(__filename).href;`,
    // Patch globalThis so the bundled code's import.meta references resolve
    `if(!globalThis.__import_meta_url)globalThis.__import_meta_url=_url;`,
  ].join("\n"));
  execSync(
    `npx esbuild ${path.join(repoRoot, "packages", "core", "dist", "index.js")} --bundle --platform=node --format=cjs --outfile=${coreBundleDest} --external:node:* --inject:${shimPath} --define:import.meta.url=globalThis.__import_meta_url`,
    { cwd: repoRoot, stdio: "pipe" },
  );
  // Clean up shim
  fs.unlinkSync(shimPath);
  console.log("  core-bundle.cjs OK");
} catch (err) {
  console.error("  esbuild failed:", String(err.stderr || err).slice(0, 300));
}

// 6. Node.js runtime for CLI subprocess spawn
//
// ⚠️ Don't use process.execPath on macOS with homebrew node — homebrew builds
// it as a thin shim that dynamically loads `@rpath/libnode.141.dylib`, and
// copying the shim alone leaves the dylib behind, breaking the spawn at
// runtime with: "Library not loaded @rpath/libnode.141.dylib".
//
// Instead, use the official Node.js binary downloaded from nodejs.org —
// it's statically linked against the system libraries only (CoreFoundation /
// libSystem / libc++) and is safe to copy standalone. Expected cache path
// matches what the repo uses for packaging.
const platform = process.argv.includes("--mac") ? "mac" : "win";
const nodeFileName = platform === "mac" ? "node" : "node.exe";
const nodeExeDest = path.join(distDir, nodeFileName);

if (platform === "mac") {
  const officialNodeBin = "/tmp/inkos-node-cache/node-v18.20.4-darwin-x64/bin/node";
  if (!fs.existsSync(officialNodeBin)) {
    throw new Error(
      `Official Node 18 binary not found at ${officialNodeBin}. ` +
      `Run: mkdir -p /tmp/inkos-node-cache && cd /tmp/inkos-node-cache && ` +
      `curl -sSL https://nodejs.org/dist/v18.20.4/node-v18.20.4-darwin-x64.tar.gz | tar -xz`
    );
  }
  fs.copyFileSync(officialNodeBin, nodeExeDest);
  console.log(`  official node 18 (${officialNodeBin}) → dist/${nodeFileName}`);
} else if (!fs.existsSync(nodeExeDest)) {
  const systemNode = process.execPath;
  fs.copyFileSync(systemNode, nodeExeDest);
  console.log(`  ${systemNode} → dist/${nodeFileName}`);
}

console.log("Done.");
