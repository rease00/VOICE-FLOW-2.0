#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const FRONTEND_DIR = path.resolve(ROOT, "..", "frontend");
const ARTIFACT_DIR = path.join(ROOT, "artifacts");
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
const DEFAULT_MIN_WORDS = 100;
const DEFAULT_SUITE = "frontend-errors";
const DEFAULT_SAMPLE_TEXT =
  "This frontend audit uses a controlled sample paragraph to satisfy the minimum word constraint while still collecting real compiler, linter, test, and build errors. The goal is to fail loudly with actionable diagnostics instead of silent pass-through checks. During this run, the script executes TypeScript type checking, ESLint analysis, Vitest tests, and the Vite production build from the frontend workspace. Any failure captures concrete log lines and writes them into a persistent report artifact. The sample text is intentionally longer than one hundred words so the audit gate remains deterministic in local and CI environments even when a custom text payload is not supplied by environment variables or command line flags.";

const argv = process.argv.slice(2);

function parseArgs(rawArgs) {
  const output = {
    minWords: DEFAULT_MIN_WORDS,
    suite: DEFAULT_SUITE,
    text: process.env.FRONTEND_AUDIT_TEXT || DEFAULT_SAMPLE_TEXT,
  };

  for (let i = 0; i < rawArgs.length; i += 1) {
    const token = rawArgs[i];
    if (token === "--min-words") {
      const parsed = Number(rawArgs[i + 1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        output.minWords = Math.trunc(parsed);
      }
      i += 1;
      continue;
    }
    if (token === "--suite") {
      output.suite = String(rawArgs[i + 1] || DEFAULT_SUITE).trim() || DEFAULT_SUITE;
      i += 1;
      continue;
    }
    if (token === "--text") {
      output.text = String(rawArgs[i + 1] || "").trim() || output.text;
      i += 1;
    }
  }

  return output;
}

function countWords(text) {
  const tokenized = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return tokenized.length;
}

function extractErrorLines(outputText) {
  const lines = String(outputText || "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);

  const matched = lines.filter((line) =>
    /(error|failed|exception|cannot|not found|TS\d{3,5}|eslint|vitest|vite)/i.test(line)
  );

  if (matched.length > 0) {
    return matched.slice(0, 80);
  }

  return lines.slice(-40);
}

function runFrontendStep(step) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";
    const child =
      process.platform === "win32"
        ? spawn("cmd.exe", ["/d", "/s", "/c", `${npmBin} run ${step.script}`], {
            cwd: FRONTEND_DIR,
            shell: false,
            env: process.env,
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: false,
          })
        : spawn(npmBin, ["run", step.script], {
            cwd: FRONTEND_DIR,
            shell: false,
            env: process.env,
            stdio: ["ignore", "pipe", "pipe"],
          });

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on("error", (error) => {
      const message = error instanceof Error ? error.message : String(error);
      resolve({
        name: step.name,
        script: step.script,
        ok: false,
        code: 1,
        elapsedMs: Date.now() - startedAt,
        errorLines: [message],
      });
    });

    child.on("close", (code) => {
      const outputText = `${stdout}\n${stderr}`;
      resolve({
        name: step.name,
        script: step.script,
        ok: code === 0,
        code: code ?? 1,
        elapsedMs: Date.now() - startedAt,
        errorLines: extractErrorLines(outputText),
      });
    });
  });
}

function writeReport(report) {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const slug = report.suite.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  const jsonPath = path.join(ARTIFACT_DIR, `${slug}-audit-report.json`);
  const mdPath = path.join(ARTIFACT_DIR, `${slug}-audit-report.md`);

  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");

  const lines = [
    `# Frontend Audit Report (${report.suite})`,
    "",
    `- Timestamp: ${report.timestamp}`,
    `- Min words required: ${report.minWords}`,
    `- Sample words provided: ${report.sampleWords}`,
    `- Frontend directory: ${report.frontendDir}`,
    `- Result: ${report.failedSteps === 0 ? "PASS" : "FAIL"}`,
    "",
  ];

  for (const step of report.steps) {
    lines.push(`## ${step.name}`);
    lines.push("");
    lines.push(`- Command: npm run ${step.script}`);
    lines.push(`- Status: ${step.ok ? "PASS" : "FAIL"}`);
    lines.push(`- Exit code: ${step.code}`);
    lines.push(`- Duration ms: ${step.elapsedMs}`);
    if (!step.ok) {
      lines.push("- Captured errors:");
      for (const row of step.errorLines.slice(0, 60)) {
        lines.push(`  - ${row}`);
      }
    }
    lines.push("");
  }

  fs.writeFileSync(mdPath, `${lines.join("\n")}\n`, "utf8");
  return { jsonPath, mdPath };
}

async function main() {
  const options = parseArgs(argv);
  const sampleWords = countWords(options.text);
  if (sampleWords < options.minWords) {
    console.error(
      `[audit:${options.suite}] blocked: sample text has ${sampleWords} words, minimum is ${options.minWords}.`
    );
    process.exit(1);
  }

  if (!fs.existsSync(FRONTEND_DIR)) {
    console.error(`[audit:${options.suite}] frontend directory not found: ${FRONTEND_DIR}`);
    process.exit(1);
  }

  const steps = [
    { name: "TypeScript Typecheck", script: "typecheck" },
    { name: "ESLint", script: "lint" },
    { name: "Vitest", script: "test:ci" },
    { name: "Production Build", script: "build" },
  ];

  const results = [];
  for (const step of steps) {
    console.log(`\n[audit:${options.suite}] running frontend step: ${step.script}`);
    const result = await runFrontendStep(step);
    results.push(result);
    if (result.ok) {
      console.log(`[audit:${options.suite}] step passed: ${step.script}`);
    } else {
      console.error(`[audit:${options.suite}] step failed: ${step.script} (exit ${result.code})`);
    }
  }

  const report = {
    timestamp: new Date().toISOString(),
    suite: options.suite,
    minWords: options.minWords,
    sampleWords,
    frontendDir: FRONTEND_DIR,
    failedSteps: results.filter((item) => !item.ok).length,
    steps: results,
  };

  const paths = writeReport(report);
  console.log(`[audit:${options.suite}] report json: ${paths.jsonPath}`);
  console.log(`[audit:${options.suite}] report md: ${paths.mdPath}`);

  if (report.failedSteps > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
