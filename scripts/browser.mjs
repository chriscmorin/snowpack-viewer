import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import { chromium, firefox, webkit } from '@playwright/test';

const TYPES = { chromium, firefox, webkit };

/** SPV_BROWSER selects a Playwright engine. All requested engines are required. */
export function selectedBrowserName() {
  const name = process.env.SPV_BROWSER || 'chromium';
  if (!Object.hasOwn(TYPES, name)) throw new Error(`SPV_BROWSER must be chromium, firefox, or webkit; received ${name}`);
  return name;
}

export function selectedBrowserType() { return TYPES[selectedBrowserName()]; }

/** Use installed Chrome for Chromium when present; otherwise Playwright's engine. */
export function browserLaunchOptions() {
  const name = selectedBrowserName();
  const override = process.env.SPV_BROWSER_PATH;
  if (override) {
    if (!existsSync(override)) throw new Error(`SPV_BROWSER_PATH does not exist: ${override}`);
    return { headless: true, executablePath: override };
  }
  if (name !== 'chromium') return { headless: true };
  const candidates = platform() === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    : platform() === 'win32'
      ? [
        `${process.env.PROGRAMFILES ?? 'C:\\Program Files'}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)'}\\Google\\Chrome\\Application\\chrome.exe`
      ]
      : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const path = candidates.find(existsSync);
  return path ? { headless: true, executablePath: path } : { headless: true };
}

export async function launchSelectedBrowser() {
  const name = selectedBrowserName();
  try {
    return await selectedBrowserType().launch(browserLaunchOptions());
  } catch (error) {
    throw new Error(`Could not launch Playwright ${name}. Install it with "npx playwright install ${name}" or set SPV_BROWSER_PATH.`, { cause: error });
  }
}
