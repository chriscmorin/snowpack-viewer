import type { ProStation } from '../core/types';
import { renderTimeline, TIMELINE_PROPERTIES } from './timeline';
import type { TimelineProperty } from './timeline';
import { renderProfile } from './profile';

export interface ViewerOptions {
  property?: TimelineProperty;
  selectedIndex?: number;
  showSoil?: boolean;
  sourceName?: string;
}
export interface ViewerController {
  update(station: ProStation, options?: ViewerOptions): void;
  destroy(): void;
  setIndex(index: number): void;
  setProperty(property: TimelineProperty): void;
  showSoil(show: boolean): void;
  exportTimelinePNG(): Promise<Blob>;
  exportProfilePNG(): Promise<Blob>;
  printTimeline(): void;
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function safeName(name: string) { return (name || 'snowpack').replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '-').slice(0, 80); }
function profileDate(station: ProStation, index: number) {
  return station.profiles[index]?.date.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

export function createViewer(host: HTMLElement, station: ProStation, options: ViewerOptions = {}): ViewerController {
  if (!station.profiles.length) throw new Error('The station contains no profiles.');
  let data = station;
  let selectedIndex = Math.max(0, Math.min(options.selectedIndex ?? data.profiles.length - 1, data.profiles.length - 1));
  let property: TimelineProperty = options.property ?? 'grainshape';
  let soil = options.showSoil ?? data.profiles.some(profile => profile.bottom < 0);
  let sourceName = options.sourceName ?? `${data.name || 'station'}.pro`;
  let previewIndex: number | null = null;
  let pinned = false;
  const root = document.createElement('section'); root.className = 'spv-viewer'; root.tabIndex = 0;
  root.setAttribute('aria-label', 'SNOWPACK profile viewer');
  const layout = document.createElement('div'); layout.className = 'spv-plots';
  const timelinePanel = document.createElement('section'); timelinePanel.className = 'spv-panel spv-panel-timeline';
  const timelineHeading = document.createElement('div'); timelineHeading.className = 'spv-panel-heading';
  const timelineTitle = document.createElement('h2');
  const timelineMenu = document.createElement('details'); timelineMenu.className = 'spv-menu';
  const timelineSummary = document.createElement('summary'); timelineSummary.setAttribute('aria-label', 'Timeline menu'); timelineSummary.textContent = '☰';
  const timelineItems = document.createElement('div'); timelineItems.className = 'spv-menu-items';
  const propertyLabel = document.createElement('p'); propertyLabel.className = 'spv-menu-label'; propertyLabel.textContent = 'TIMELINE';
  const propertyButtons = new Map<TimelineProperty, HTMLButtonElement>();
  timelineItems.append(propertyLabel);
  for (const item of TIMELINE_PROPERTIES) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = item.label; button.dataset.property = item.key;
    button.addEventListener('click', () => { setProperty(item.key); timelineMenu.open = false; });
    timelineItems.append(button); propertyButtons.set(item.key, button);
  }
  const separator = document.createElement('hr'); timelineItems.append(separator);
  const soilButton = document.createElement('button'); soilButton.type = 'button';
  soilButton.addEventListener('click', () => { showSoil(!soil); timelineMenu.open = false; });
  timelineItems.append(soilButton);
  const printButton = document.createElement('button'); printButton.type = 'button'; printButton.textContent = 'Print'; printButton.setAttribute('aria-label', 'Print timeline');
  printButton.addEventListener('click', () => { timeline.print(); timelineMenu.open = false; }); timelineItems.append(printButton);
  const timelinePNG = document.createElement('button'); timelinePNG.type = 'button'; timelinePNG.textContent = 'Export PNG'; timelinePNG.setAttribute('aria-label', 'Export timeline PNG');
  timelinePNG.addEventListener('click', async () => { timelineMenu.open = false; download(await timeline.exportPNG(), `${safeName(sourceName)}-timeline.png`); }); timelineItems.append(timelinePNG);
  timelineMenu.append(timelineSummary, timelineItems); timelineHeading.append(timelineTitle, timelineMenu);
  const timelineHost = document.createElement('div'); timelineHost.className = 'spv-timeline-host';
  const timelineFoot = document.createElement('div'); timelineFoot.className = 'spv-panel-foot';
  const zoomHint = document.createElement('span'); zoomHint.textContent = 'Drag timeline to zoom · Double-click to reset';
  const count = document.createElement('span'); timelineFoot.append(zoomHint, count);
  timelinePanel.append(timelineHeading, timelineHost, timelineFoot);

  const profilePanel = document.createElement('section'); profilePanel.className = 'spv-panel spv-panel-profile';
  const profileHeading = document.createElement('div'); profileHeading.className = 'spv-panel-heading';
  const profileTitle = document.createElement('h2');
  const profileMenu = document.createElement('details'); profileMenu.className = 'spv-menu';
  const profileSummary = document.createElement('summary'); profileSummary.setAttribute('aria-label', 'Profile menu'); profileSummary.textContent = '☰';
  const profileItems = document.createElement('div'); profileItems.className = 'spv-menu-items';
  const profilePNG = document.createElement('button'); profilePNG.type = 'button'; profilePNG.textContent = 'Export PNG'; profilePNG.setAttribute('aria-label', 'Export profile PNG');
  profilePNG.addEventListener('click', async () => { profileMenu.open = false; download(await profile.exportPNG(), `${safeName(sourceName)}-profile.png`); });
  profileItems.append(profilePNG); profileMenu.append(profileSummary, profileItems); profileHeading.append(profileTitle, profileMenu);
  const profileHost = document.createElement('div'); profileHost.className = 'spv-profile-host';
  const profileFoot = document.createElement('div'); profileFoot.className = 'spv-panel-foot spv-profile-navigation';
  const prev = document.createElement('button'); prev.type = 'button'; prev.setAttribute('aria-label', 'Previous timestep'); prev.textContent = '←';
  const date = document.createElement('span'); date.className = 'spv-selected-date';
  const next = document.createElement('button'); next.type = 'button'; next.setAttribute('aria-label', 'Next timestep'); next.textContent = '→';
  prev.addEventListener('click', () => setIndex(selectedIndex - 1)); next.addEventListener('click', () => setIndex(selectedIndex + 1));
  profileFoot.append(prev, date, next); profilePanel.append(profileHeading, profileHost, profileFoot);
  layout.append(timelinePanel, profilePanel); root.append(layout); host.replaceChildren(root);

  const timeline = renderTimeline(timelineHost, data, { property, showSoil: soil, selectedIndex, onSelect: pinIndex, onHover: preview });
  const profile = renderProfile(profileHost, data.profiles[selectedIndex]!, data, property, soil);
  function preview(index: number | null) {
    if (pinned) return;
    previewIndex = index;
    profile.update(data.profiles[index ?? selectedIndex]!, data, property, soil);
    date.textContent = profileDate(data, index ?? selectedIndex) + (index === null ? '' : ' · preview');
  }
  function sync() {
    timelineTitle.textContent = `Timeline View · ${sourceName}`;
    profileTitle.textContent = `Profile View · ${sourceName}`;
    date.textContent = profileDate(data, selectedIndex);
    count.textContent = `${data.profiles.length.toLocaleString()} timesteps`;
    prev.disabled = selectedIndex === 0; next.disabled = selectedIndex === data.profiles.length - 1;
    soilButton.textContent = soil ? 'Hide soil layers' : 'Show soil layers';
    for (const [key, button] of propertyButtons) { button.classList.toggle('is-current', key === property); button.setAttribute('aria-pressed', String(key === property)); }
  }
  function setIndex(index: number) {
    const nextIndex = Math.max(0, Math.min(index, data.profiles.length - 1));
    if (nextIndex === selectedIndex && previewIndex === null) return;
    selectedIndex = nextIndex; previewIndex = null; profile.update(data.profiles[selectedIndex]!, data, property, soil); timeline.update(data, { selectedIndex }); sync();
  }
  function pinIndex(index: number) {
    if (pinned && index === selectedIndex) { pinned = false; preview(null); return; }
    pinned = true;
    setIndex(index);
  }
  function setProperty(nextProperty: TimelineProperty) {
    property = nextProperty; timeline.update(data, { property }); profile.setProperty(property); sync();
  }
  function showSoil(show: boolean) { soil = show; timeline.update(data, { showSoil: soil }); profile.setShowSoil(soil); sync(); }
  const keydown = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLButtonElement || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); setIndex(selectedIndex - 1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); setIndex(selectedIndex + 1); }
  };
  root.addEventListener('keydown', keydown);
  const outsideClick = (event: MouseEvent) => {
    if (!timelineMenu.contains(event.target as Node)) timelineMenu.open = false;
    if (!profileMenu.contains(event.target as Node)) profileMenu.open = false;
  };
  document.addEventListener('click', outsideClick);
  sync();
  return {
    update(nextStation, nextOptions = {}) {
      data = nextStation; if (!data.profiles.length) throw new Error('The station contains no profiles.');
      pinned = false; previewIndex = null;
      selectedIndex = Math.max(0, Math.min(nextOptions.selectedIndex ?? data.profiles.length - 1, data.profiles.length - 1));
      if (nextOptions.property) property = nextOptions.property;
      soil = nextOptions.showSoil ?? data.profiles.some(profile => profile.bottom < 0);
      if (nextOptions.sourceName) sourceName = nextOptions.sourceName;
      timeline.update(data, { property, showSoil: soil, selectedIndex }); profile.update(data.profiles[selectedIndex]!, data, property, soil); sync();
    },
    destroy() { document.removeEventListener('click', outsideClick); root.removeEventListener('keydown', keydown); timeline.destroy(); profile.destroy(); root.remove(); },
    setIndex, setProperty, showSoil,
    exportTimelinePNG: () => timeline.exportPNG(), exportProfilePNG: () => profile.exportPNG(), printTimeline: () => timeline.print()
  };
}
