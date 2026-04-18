#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptDir, '..');
const npmExecPath = String(process.env.npm_execpath || '').trim();
const nodeMajor = Number.parseInt(String(process.versions.node || '0').split('.')[0] || '0', 10);
const forceTypecheck = String(process.env.VF_CLOUDFLARE_FORCE_TYPECHECK || '').trim() === '1';
const useTurbopack = String(process.env.VF_CLOUDFLARE_USE_TURBOPACK || '').trim() === '1';
const skipNextBuild = String(process.env.VF_CLOUDFLARE_SKIP_NEXT_BUILD || '').trim() === '1';

if (!npmExecPath) {
	console.error('[cloudflare:build] npm_execpath is missing, cannot continue.');
	process.exit(1);
}

const run = (command, args, options = {}) => {
	const result = spawnSync(command, args, {
		cwd: frontendRoot,
		stdio: 'inherit',
		shell: false,
		...options,
	});

	if (result.error) {
		throw result.error;
	}

	if (typeof result.status === 'number') {
		if (result.status !== 0) {
			process.exit(result.status);
		}
		return;
	}

	process.exit(1);
};

const runNpm = (args, options = {}) => {
	run(process.execPath, [npmExecPath, ...args], options);
};

const cleanBuildArtifacts = () => {
	for (const relativePath of ['.next', '.open-next']) {
		const target = path.join(frontendRoot, relativePath);
		if (!fs.existsSync(target)) continue;
		fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
	}
};

const collectFiles = (rootDir) => {
	const out = [];
	const walk = (currentDir) => {
		for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
			const fullPath = path.join(currentDir, entry.name);
			if (entry.isDirectory()) {
				walk(fullPath);
				continue;
			}
			out.push(fullPath);
		}
	};
	walk(rootDir);
	return out;
};

const createServerChunkRuntimeBridges = () => {
	const defaultFnRoot = path.join(frontendRoot, '.open-next', 'server-functions', 'default');
	const sourceChunksRoot = path.join(defaultFnRoot, '.next', 'server', 'chunks');
	const targetChunksRoot = path.join(defaultFnRoot, 'server', 'chunks');
	if (!fs.existsSync(sourceChunksRoot)) return;

	let written = 0;
	for (const sourcePath of collectFiles(sourceChunksRoot)) {
		if (!sourcePath.endsWith('.js')) continue;
		const relativeChunkPath = path.relative(sourceChunksRoot, sourcePath);
		const targetPath = path.join(targetChunksRoot, relativeChunkPath);
		const targetDir = path.dirname(targetPath);
		fs.mkdirSync(targetDir, { recursive: true });

		let relativeRequirePath = path.relative(targetDir, sourcePath).replace(/\\/g, '/');
		if (!relativeRequirePath.startsWith('.')) {
			relativeRequirePath = `./${relativeRequirePath}`;
		}

		const bridgeSource = `"use strict";\nmodule.exports = require(${JSON.stringify(relativeRequirePath)});\n`;
		fs.writeFileSync(targetPath, bridgeSource, 'utf8');
		written += 1;
	}

	console.log(`[cloudflare:build] Generated ${written} server chunk runtime bridge file(s).`);
};

const patchOpenNextTurbopackPluginForWindows = () => {
	const pluginPath = path.join(
		frontendRoot,
		'node_modules',
		'@opennextjs',
		'cloudflare',
		'dist',
		'cli',
		'build',
		'patches',
		'plugins',
		'turbopack.js'
	);

	if (!fs.existsSync(pluginPath)) {
		return;
	}

	const source = fs.readFileSync(pluginPath, 'utf8');
	let patched = source;

	patched = patched.replace(
		'if (file.includes(".next/server/chunks/")) {',
		'if (file.replace(/\\\\/g, "/").includes(".next/server/chunks/")) {'
	);

	patched = patched.replace(
		'chunk.replace(/.*\\/\\.next\\//, "")',
		'chunk.replace(/\\\\/g, "/").replace(/.*\\/\\.next\\//, "")'
	);

	patched = patched.replace(
		'return require("${chunk}");',
		'return require(${JSON.stringify(chunk.replace(/\\\\/g, "/"))});'
	);

	patched = patched.replace(
		'    case "next/dist/compiled/@vercel/og/index.node.js":\n      $RAW = await import("next/dist/compiled/@vercel/og/index.edge.js");\n      break;\n',
		''
	);

	if (patched !== source) {
		fs.writeFileSync(pluginPath, patched, 'utf8');
		console.log('[cloudflare:build] Patched OpenNext Turbopack chunk inlining for Windows paths.');
	}
};

const patchCloudflareHandlerRuntimeCompatibility = () => {
	const handlerPath = path.join(frontendRoot, '.open-next', 'server-functions', 'default', 'handler.mjs');
	if (!fs.existsSync(handlerPath)) {
		return;
	}

	const source = fs.readFileSync(handlerPath, 'utf8');
	let patched = source;

	patched = patched
		.split('eval("quire".replace(/^/,"re"))(moduleName)')
		.join('require(moduleName)');

	// Cloudflare Workers blocks dynamic code generation through Function constructors.
	patched = patched
		.split('Function.apply(null,h).apply(null,i)')
		.join('(function(){return function(){}})()')
		.split('Function.apply(null,s).apply(null,l)')
		.join('(function(){return function(){}})()')
		.split('return Function(b3)()')
		.join('return function(){}')
		.split('return Function(t3)()')
		.join('return function(){}');

	if (patched !== source) {
		fs.writeFileSync(handlerPath, patched, 'utf8');
		console.log(
			'[cloudflare:build] Rewrote eval/Function-based dynamic code paths in handler.mjs for Cloudflare runtime compatibility.'
		);
	}
};

const main = () => {
	patchOpenNextTurbopackPluginForWindows();

	if (nodeMajor >= 24) {
		console.error(
			'[cloudflare:build] Node 24+ is not supported due to V8 crashes that cause high CPU/GPU usage.\n' +
			'[cloudflare:build] Please switch to Node 22 LTS (see .nvmrc).\n' +
			'[cloudflare:build]   nvm install 22 && nvm use 22'
		);
		process.exit(1);
	}

	if (nodeMajor >= 20 && !forceTypecheck) {
		console.warn(
			'[cloudflare:build] Skipping explicit typecheck; run `npm --prefix frontend run typecheck` separately for strict validation.'
		);
	} else {
		runNpm(['run', 'typecheck']);
	}

	const nextBuildScript = useTurbopack ? 'build' : 'build:cloudflare';
	if (!useTurbopack) {
		console.log('[cloudflare:build] Using webpack-based Next build for Cloudflare runtime compatibility.');
	}

	if (skipNextBuild) {
		console.log('[cloudflare:build] Reusing existing .next output (VF_CLOUDFLARE_SKIP_NEXT_BUILD=1).');
	} else {
		console.log('[cloudflare:build] Cleaning .next and .open-next before build to avoid stale artifact mismatches.');
		cleanBuildArtifacts();

		const nextBuildEnv = {
			...process.env,
			VF_SKIP_NEXT_BUILD_TYPECHECK: '1',
			VF_SKIP_NEXT_BUILD_LINT: '1',
			NEXT_DISABLE_SWC_WORKER: '1',
			NODE_OPTIONS: [
				process.env.NODE_OPTIONS || '',
				'--max-old-space-size=4096',
			].filter(Boolean).join(' '),
		};

		if (!useTurbopack) {
			nextBuildEnv.NEXT_DISABLE_WEBPACK_CACHE = '1';
		}

		runNpm(['run', nextBuildScript], {
			env: nextBuildEnv,
		});
	}

	// Turbopack does not emit pages-manifest.json for App Router-only projects.
	// OpenNext's cache asset builder always tries to read it, so we stub it.
	const standaloneNextServer = path.join(frontendRoot, '.next', 'standalone', 'frontend', '.next', 'server');
	fs.mkdirSync(standaloneNextServer, { recursive: true });
	if (!fs.existsSync(path.join(standaloneNextServer, 'pages-manifest.json'))) {
		fs.writeFileSync(path.join(standaloneNextServer, 'pages-manifest.json'), '{}');
	}

	runNpm(['exec', '--', 'opennextjs-cloudflare', 'build', '--skipBuild']);
	patchCloudflareHandlerRuntimeCompatibility();
	createServerChunkRuntimeBridges();
	run(process.execPath, [path.join(frontendRoot, 'scripts', 'create-pages-dist.mjs')]);

	console.log('[cloudflare:build] Cloudflare build artifacts are ready.');
};

try {
	main();
} catch (error) {
	const detail = error instanceof Error ? error.message : String(error);
	console.error('[cloudflare:build] Failed to build Cloudflare artifacts.');
	console.error(detail);
	process.exit(1);
}
