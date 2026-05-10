const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const workspaceRoot = path.resolve(__dirname, "..");
const mockPage = path.join(__dirname, "mock-screenshots", "mock.html");
const outputDir = path.join(workspaceRoot, "assets", "screenshots");
const userDataDir = path.join(workspaceRoot, "tmp", "chrome-screenshots");

const chromeCandidates = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  path.join(
    process.env.LOCALAPPDATA || "",
    "Google",
    "Chrome",
    "Application",
    "chrome.exe"
  ),
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
].filter(Boolean);

const chromePath = chromeCandidates.find((candidate) => fs.existsSync(candidate));
if (!chromePath) {
  throw new Error("Could not find Chrome or Edge. Set CHROME_PATH to generate screenshots.");
}

const screenshots = [
  ["labels", "01-labels-applied-1280x800.png"],
  ["history", "02-edit-history-1280x800.png"],
  ["popup", "03-drive-import-export-1280x800.png"]
];

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(userDataDir, { recursive: true });

for (const [shot, filename] of screenshots) {
  const outputPath = path.join(outputDir, filename);
  const url = `${pathToFileURL(mockPage).href}?shot=${shot}`;
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--allow-file-access-from-files",
    `--user-data-dir=${userDataDir}`,
    "--window-size=1280,800",
    "--force-device-scale-factor=1",
    "--virtual-time-budget=1600",
    `--screenshot=${outputPath}`,
    url
  ];

  execFileSync(chromePath, args, { stdio: "inherit" });
  console.log(`Wrote ${path.relative(workspaceRoot, outputPath)}`);
}
