import '../render/styles.css';
import { parsePro } from '../core/pro';
import { createViewer } from '../render/viewer';
import type { ViewerController } from '../render/viewer';

declare const __EXAMPLE_URL__: string;
declare const __VIEWER_DOWNLOAD_URL__: string;
declare const __SOURCE_URL__: string;

const exampleUrl = __EXAMPLE_URL__;
const viewerDownloadUrl = __VIEWER_DOWNLOAD_URL__;
const sourceUrl = __SOURCE_URL__;
const seasonHash = '0fa1c925b4f9c2da16098715923211e4d3d857b10098548946c9bda685f6956a';
const seasonDate = '1996-03-01T18:00:00.000Z';

const app = document.getElementById('app');
if (!app) throw new Error('The application root is missing.');
app.className = 'spv-app';
const header = document.createElement('header'); header.className = 'spv-app-header';
const brand = document.createElement('div'); brand.className = 'spv-brand';
const title = document.createElement('strong'); title.textContent = 'Snow profile viewer';
const subtitle = document.createElement('span'); subtitle.textContent = exampleUrl ? 'SNOWPACK .pro · online demo' : 'SNOWPACK .pro · offline';
brand.append(title, subtitle);
const actions = document.createElement('div'); actions.className = 'spv-file-actions';
const input = document.createElement('input'); input.type = 'file'; input.accept = '.pro,.pro.gz,.gz,text/plain,application/gzip,application/x-gzip'; input.className = 'spv-file-input'; input.id = 'spv-file';
const openButton = document.createElement('button'); openButton.type = 'button'; openButton.className = 'spv-button spv-button-primary'; openButton.textContent = 'Open .pro file';
openButton.addEventListener('click', () => input.click());
actions.append(openButton);
const exampleButton = document.createElement('button'); exampleButton.type = 'button'; exampleButton.className = 'spv-button'; exampleButton.textContent = 'Open example';
if (exampleUrl) {
  actions.append(exampleButton);
  const viewerLink = document.createElement('a'); viewerLink.href = viewerDownloadUrl; viewerLink.download = 'snowpack-viewer.html'; viewerLink.textContent = 'Download offline viewer'; viewerLink.className = 'spv-button';
  const dataLink = document.createElement('a'); dataLink.href = exampleUrl; dataLink.download = 'snowpack-large-MST96.pro.gz'; dataLink.textContent = 'Download example data'; dataLink.className = 'spv-button';
  actions.append(viewerLink, dataLink);
}
actions.append(input); header.append(brand, actions);
const content = document.createElement('div'); content.className = 'spv-app-content';
const status = document.createElement('div'); status.className = 'spv-app-status'; status.setAttribute('role', 'status');
const footer = document.createElement('footer'); footer.className = 'spv-app-footer';
const licenseButton = document.createElement('button'); licenseButton.type = 'button';
licenseButton.className = 'spv-source-button'; licenseButton.textContent = 'Source & license';
const licenseDialog = document.createElement('dialog'); licenseDialog.className = 'spv-license-dialog';
const licenseHead = document.createElement('div'); licenseHead.className = 'spv-license-head';
const licenseTitle = document.createElement('h2'); licenseTitle.id = 'spv-license-title'; licenseTitle.textContent = 'Source & license';
licenseDialog.setAttribute('aria-labelledby', licenseTitle.id);
const licenseClose = document.createElement('button'); licenseClose.type = 'button';
licenseClose.className = 'spv-source-button'; licenseClose.textContent = 'Close';
licenseClose.addEventListener('click', () => licenseDialog.close());
licenseHead.append(licenseTitle, licenseClose);
const sourceInfo = document.createElement('p');
sourceInfo.textContent = 'This viewer is licensed under AGPL-3.0-or-later. Source code and build instructions are available in the source repository.';
const sourceLink = document.createElement('a');
sourceLink.href = sourceUrl;
sourceLink.target = '_blank'; sourceLink.rel = 'noopener noreferrer';
sourceLink.textContent = 'Source repository';
const licenseText = document.createElement('pre'); licenseText.className = 'spv-license-text';
licenseButton.addEventListener('click', () => {
  licenseText.textContent = document.getElementById('license-notices')?.textContent?.trim() || 'License notices are unavailable in this copy.';
  licenseDialog.showModal();
});
licenseDialog.append(licenseHead, sourceInfo, sourceLink, licenseText);
footer.append(status, licenseButton);
app.append(header, content, footer, licenseDialog);
let viewer: ViewerController | null = null;
let dragDepth = 0;
let loadToken = 0;
let exampleAbort: AbortController | null = null;

function setStatus(message: string, error = false) { status.textContent = message; status.style.color = error ? '#9f3030' : ''; }
function openText(text: string, name: string, initialDate?: string) {
  const station = parsePro(text);
  if (!station.profiles.length) throw new Error('This .pro file contains no dated profiles.');
  const selectedIndex = initialDate ? station.profiles.findIndex(profile => profile.date.toISOString() === initialDate) : station.profiles.length - 1;
  if (selectedIndex < 0) throw new Error('The example profile date is missing from this .pro file.');
  const options = initialDate ? { sourceName: name, selectedIndex, property: 'grainshape' as const } : { sourceName: name, selectedIndex };
  if (viewer) viewer.update(station, options);
  else viewer = createViewer(content, station, options);
  setStatus(`${name} · ${station.profiles.length.toLocaleString()} timesteps · ${station.name}`);
}
async function gunzip(blob: Blob): Promise<string> {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open compressed .pro.gz files.');
  try {
    return await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text();
  } catch {
    throw new Error('Could not decompress this .pro.gz file.');
  }
}
async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
async function openFile(file?: File) {
  if (!file) return;
  const token = ++loadToken;
  exampleAbort?.abort(); exampleAbort = null; exampleButton.disabled = false;
  const compressed = file.name.toLowerCase().endsWith('.pro.gz');
  if (!compressed && !file.name.toLowerCase().endsWith('.pro')) { setStatus('Choose a SNOWPACK .pro or .pro.gz file.', true); return; }
  setStatus(`Opening ${file.name}…`);
  try {
    const text = compressed ? await gunzip(file) : await file.text();
    if (token === loadToken) openText(text, file.name);
  } catch (error) {
    if (token === loadToken) setStatus(error instanceof Error ? error.message : 'Could not open this file.', true);
  }
}
input.addEventListener('change', () => { void openFile(input.files?.[0]); input.value = ''; });
exampleButton.addEventListener('click', () => { void openExample(); });
async function openExample() {
  if (!exampleUrl || exampleAbort) return;
  const token = ++loadToken;
  const abort = new AbortController(); exampleAbort = abort; exampleButton.disabled = true;
  setStatus('Opening example…');
  try {
    const response = await fetch(exampleUrl, { signal: abort.signal });
    if (!response.ok) throw new Error(`Could not download the example (HTTP ${response.status}).`);
    const text = await gunzip(await response.blob());
    if (token !== loadToken) return;
    if (await sha256(text) !== seasonHash) throw new Error('The downloaded example did not match the expected file.');
    if (token === loadToken) openText(text, 'snowpack-large-MST96.pro', seasonDate);
  } catch (error) {
    if (token === loadToken) setStatus(error instanceof Error ? error.message : 'Could not open the example.', true);
  } finally {
    if (exampleAbort === abort) { exampleAbort = null; exampleButton.disabled = false; }
  }
}
function isFileDrag(event: DragEvent) { return Array.from(event.dataTransfer?.types ?? []).includes('Files'); }
document.addEventListener('dragenter', event => { if (!isFileDrag(event)) return; event.preventDefault(); dragDepth++; app.classList.add('spv-drop-active'); });
document.addEventListener('dragover', event => { if (isFileDrag(event)) { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; } });
document.addEventListener('dragleave', event => { if (!isFileDrag(event)) return; dragDepth = Math.max(0, dragDepth - 1); if (dragDepth === 0) app.classList.remove('spv-drop-active'); });
document.addEventListener('drop', event => {
  if (!isFileDrag(event)) return;
  event.preventDefault(); dragDepth = 0; app.classList.remove('spv-drop-active');
  void openFile(event.dataTransfer?.files[0]);
});

const empty = document.createElement('div'); empty.className = 'spv-empty';
empty.innerHTML = `<h1>Explore a SNOWPACK snow profile</h1><p>Open a <strong>.pro</strong> or <strong>.pro.gz</strong> file to see its timeline and selected snow profile. Drag a file anywhere onto this window${exampleUrl ? ', or try the example.' : '.'}</p>`;
const emptyOpen = document.createElement('button'); emptyOpen.type = 'button'; emptyOpen.className = 'spv-button spv-button-primary'; emptyOpen.textContent = 'Open .pro file'; emptyOpen.addEventListener('click', () => input.click());
empty.append(emptyOpen);
if (exampleUrl) {
  const emptyExample = document.createElement('button'); emptyExample.type = 'button'; emptyExample.className = 'spv-button'; emptyExample.textContent = 'Try example'; emptyExample.addEventListener('click', () => exampleButton.click());
  empty.append(emptyExample);
}
content.append(empty);
