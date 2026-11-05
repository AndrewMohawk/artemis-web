"use client";

import {
  AlertTriangle,
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  ChevronDown,
  CircleHelp,
  CloudSun,
  Database,
  Download,
  ExternalLink,
  FileAudio,
  FileImage,
  FileText,
  Gauge,
  Headphones,
  Import,
  Info,
  Library,
  Orbit,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Star,
  Sun,
  Tags,
  Waves,
  X,
} from "lucide-react";
import React, {
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AudioPlayer } from "./components/audio-player";
import catalogMetadata from "./data/catalog.json";
import {
  buildSignalIndex,
  countActiveFilterGroups,
  createDefaultFilters,
  filterSignals,
  numericValues,
  RF_BANDS,
  textValues,
  type Datum,
  type EngineeringUnit,
  type FiltersState,
  type NumericFilterState,
  type SignalRecord,
} from "./lib/signal-filters";
import type { SignalDocument } from "./lib/workspace-store";
import {
  DATABASE_BUNDLE_BYTE_LIMIT,
  SIGID_DATABASE_ID,
  WORKSPACE_PERSISTENCE_BYTE_LIMIT,
  bookmarkKey,
  createDefaultWorkspace,
  exportDatabaseBundle,
  getDatabaseStats,
  importDatabaseBundle,
  loadWorkspace,
  resolveActiveSignals,
  saveWorkspace,
  validateWorkspace,
  type LocalDatabase,
  type UserPreferences,
  type WorkspaceState,
} from "./lib/workspace-store";
import type {
  DatabaseUpdateState,
  ManagedDatabase,
  ManagedDocument,
  ManagedPreferences,
  ManagedSignal,
  ManagedTag,
  NewManagedDocument,
  ParameterKind,
} from "./components/artemis-managers";
import type { SpaceWeatherData as FullSpaceWeatherData } from "./components/space-weather";

type SpaceWeatherData = {
  JSON_INFO?: { utc_date?: string; utc_time?: string };
  AK?: {
    k_index?: number;
    a_index?: number;
    exp_noise?: string;
    k_MAX_24h?: number;
  };
  XRAY?: {
    peak_flux_class?: string;
    peak_flux_class_3h?: string;
    peak_flux_class_24h?: string;
  };
  SGAS?: { ssn?: number; sfi?: number };
  GSR_SCALES?: {
    G_now?: number;
    S_now?: number;
    R_now?: number;
    G_max24h?: number;
    S_max24h?: number;
    R_max24h?: number;
  };
  PROPAGATION?: Record<string, string>;
  FORCST?: {
    PRE_DATES?: string[];
    GEO_MID_ACTIVE?: number[];
    CLASS_M?: number[];
    CLASS_X?: number[];
    SUMMARY?: {
      G_REPORT?: [number, string];
      S_REPORT?: [number, string];
      R_REPORT?: [number, string];
    };
  };
};

type ViewName = "library" | "saved" | "weather";

const FullSpaceWeather = React.lazy(async () => ({
  default: (await import("./components/space-weather")).SpaceWeather,
}));
const FullDatabaseManager = React.lazy(async () => ({
  default: (await import("./components/artemis-managers")).DatabaseManagerModal,
}));
const FullSignalEditor = React.lazy(async () => ({
  default: (await import("./components/artemis-managers")).SignalEditorModal,
}));
const FullTagManager = React.lazy(async () => ({
  default: (await import("./components/artemis-managers")).TagManagerModal,
}));
const FullDocumentsManager = React.lazy(async () => ({
  default: (await import("./components/artemis-managers")).DocumentsManagerModal,
}));
const FullPreferences = React.lazy(async () => ({
  default: (await import("./components/artemis-managers")).PreferencesModal,
}));
const FullAbout = React.lazy(async () => ({
  default: (await import("./components/artemis-managers")).AboutModal,
}));

const CATALOG_VERSION = catalogMetadata.version;
const CATALOG_TAG = catalogMetadata.tag;
const MEDIA_BASE =
  `https://raw.githubusercontent.com/AresValley/Artemis-Database/${catalogMetadata.sourceCommit}/static`;

function formatEngineering(value: number, kind: "frequency" | "time" = "frequency") {
  if (kind === "time") {
    if (value < 1) return `${Math.round(value * 1000)} ms`;
    return `${trimNumber(value)} s`;
  }
  if (value >= 1_000_000_000) return `${trimNumber(value / 1_000_000_000)} GHz`;
  if (value >= 1_000_000) return `${trimNumber(value / 1_000_000)} MHz`;
  if (value >= 1_000) return `${trimNumber(value / 1_000)} kHz`;
  return `${trimNumber(value)} Hz`;
}

function trimNumber(value: number) {
  const digits = Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2;
  return Number(value.toFixed(digits)).toLocaleString();
}

function formatRange(items: Datum[], kind: "frequency" | "time" = "frequency") {
  const values = numericValues(items).sort((a, b) => a - b);
  if (!values.length) return "Unknown";
  if (values.length === 1) return formatEngineering(values[0], kind);
  return `${formatEngineering(values[0], kind)} – ${formatEngineering(values.at(-1)!, kind)}`;
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function HelpDropdown({
  updateAvailable,
  onCheckUpdates,
  onOpenAbout,
}: {
  updateAvailable: boolean;
  onCheckUpdates: () => void;
  onOpenAbout: () => void;
}) {
  return (
    <details className={cx("header-help", updateAvailable && "has-update")}>
      <summary aria-label="Open help menu">
        <CircleHelp size={19} />
        <span>Help</span>
        {updateAvailable ? <i /> : null}
        <ChevronDown size={14} />
      </summary>
      <div className="header-help-popover">
        <button onClick={onCheckUpdates}>
          <RefreshCw size={15} /> Check for updates {updateAvailable ? <em>NEW</em> : null}
        </button>
        <hr />
        <a href="https://aresvalley.com/" target="_blank" rel="noreferrer"><ExternalLink size={15} /> Project homepage</a>
        <a href="https://aresvalley.github.io/Artemis/" target="_blank" rel="noreferrer"><FileText size={15} /> Documentation</a>
        <a href="https://github.com/AresValley/Artemis/blob/master/CHANGELOG.md" target="_blank" rel="noreferrer"><Info size={15} /> Release notes</a>
        <a href="https://github.com/AresValley/Artemis/issues" target="_blank" rel="noreferrer"><AlertTriangle size={15} /> Report an issue</a>
        <hr />
        <button onClick={onOpenAbout}><Info size={15} /> About Artemis</button>
      </div>
    </details>
  );
}

const ACCENT_COLORS: Record<string, string> = {
  Red: "#ef5350", Pink: "#ec407a", Purple: "#ab47bc", DeepPurple: "#7e57c2",
  Indigo: "#5c6bc0", Blue: "#42a5f5", LightBlue: "#29b6f6", Cyan: "#26c6da",
  Teal: "#26a69a", Green: "#66bb6a", LightGreen: "#9ccc65", Lime: "#d4e157",
  Yellow: "#ffee58", Amber: "#ffca28", Orange: "#ffa726", DeepOrange: "#ff7043",
  Brown: "#8d6e63", Grey: "#78909c", BlueGrey: "#607d8b",
};

const PARAMETER_KEYS: Record<ParameterKind, keyof Pick<SignalRecord, "frequency" | "bandwidth" | "modulation" | "mode" | "acf" | "location">> = {
  Frequency: "frequency",
  Bandwidth: "bandwidth",
  Modulation: "modulation",
  Mode: "mode",
  ACF: "acf",
  Location: "location",
};

const PARAMETER_KINDS = Object.keys(PARAMETER_KEYS) as ParameterKind[];

function engineeringValue(value: number) {
  if (Math.abs(value) >= 1_000_000_000) return { value: value / 1_000_000_000, unit: "GHz" as const };
  if (Math.abs(value) >= 1_000_000) return { value: value / 1_000_000, unit: "MHz" as const };
  if (Math.abs(value) >= 1_000) return { value: value / 1_000, unit: "kHz" as const };
  return { value, unit: "Hz" as const };
}

function signalToManaged(signal: SignalRecord): ManagedSignal {
  const parameters = {} as ManagedSignal["parameters"];
  for (const kind of PARAMETER_KINDS) {
    const items = signal[PARAMETER_KEYS[kind]];
    parameters[kind] = items.map((item, index) => {
      if ((kind === "Frequency" || kind === "Bandwidth") && typeof item.value === "number") {
        const engineering = engineeringValue(item.value);
        return { id: `${kind}-${index}`, value: String(engineering.value), description: item.description || "", unit: engineering.unit };
      }
      return {
        id: `${kind}-${index}`,
        value: String(item.value),
        description: item.description || "",
        unit: kind === "ACF" ? "ms" : undefined,
      };
    });
  }
  return {
    id: signal.pageid,
    name: signal.title,
    description: signal.description || signal["short description"],
    sinceVersion: signal.added_since,
    categoryIds: [...signal.category],
    parameters,
  };
}

function summarizeDescription(description: string) {
  const plain = description
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
    .replace(/[*_`>#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.slice(0, 280) || "Locally stored signal reference.";
}

function managedToSignal(managed: ManagedSignal, existing?: SignalRecord): SignalRecord {
  const unitScale = { Hz: 1, kHz: 1_000, MHz: 1_000_000, GHz: 1_000_000_000, ms: 1 } as const;
  const convert = (kind: ParameterKind): Datum[] => managed.parameters[kind]
    .filter((parameter) => parameter.value.trim() !== "")
    .map((parameter) => {
      if (kind === "Frequency" || kind === "Bandwidth" || kind === "ACF") {
        const number = Number(parameter.value);
        return {
          value: Number.isFinite(number) ? number * unitScale[parameter.unit || (kind === "ACF" ? "ms" : "Hz")] : 0,
          description: parameter.description,
        };
      }
      return { value: parameter.value.trim(), description: parameter.description };
    });
  return {
    pageid: managed.id,
    title: managed.name.trim(),
    added_since: managed.sinceVersion ?? existing?.added_since ?? 1,
    spectrum: existing?.spectrum || null,
    audio: existing?.audio || null,
    category: [...managed.categoryIds],
    frequency: convert("Frequency"),
    bandwidth: convert("Bandwidth"),
    acf: convert("ACF"),
    modulation: convert("Modulation"),
    mode: convert("Mode"),
    location: convert("Location"),
    "short description": summarizeDescription(managed.description),
    description: managed.description,
    custom: existing?.custom ?? true,
  };
}

function documentToManaged(document: SignalDocument): ManagedDocument {
  const extension = document.fileName.includes(".") ? document.fileName.split(".").pop() || "" : "";
  return {
    id: document.id,
    name: document.name,
    description: document.description,
    type: document.type,
    fileName: document.fileName,
    extension,
    dataUrl: document.dataUrl,
    preview: document.preview,
  };
}

function managedPreferences(preferences: UserPreferences): ManagedPreferences {
  return {
    theme: preferences.theme,
    accent: (ACCENT_COLORS[preferences.accent] ? preferences.accent : "Green") as ManagedPreferences["accent"],
    scale: preferences.scale,
    autoloadLatest: preferences.autoloadLatest,
  };
}

function NavButton({
  active,
  icon,
  label,
  badge,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      className={cx("nav-button", active && "is-active")}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
    >
      {icon}
      <span>{label}</span>
      {badge ? <span className="nav-badge">{badge}</span> : null}
    </button>
  );
}

function ParameterRow({
  label,
  values,
  formatter,
  onEdit,
}: {
  label: string;
  values: Datum[];
  formatter?: (value: number) => string;
  onEdit?: () => void;
}) {
  return (
    <div className="parameter-row">
      <dt>{label}</dt>
      <dd>
        {values.length ? (
          values.map((item, index) => (
            <button
              type="button"
              className="value-chip"
              title={item.description || undefined}
              key={`${item.value}-${index}`}
              onClick={onEdit}
            >
              {formatter && typeof item.value === "number"
                ? formatter(item.value)
                : String(item.value)}
            </button>
          ))
        ) : (
          <span className="empty-value">Not specified</span>
        )}
      </dd>
    </div>
  );
}

function BandRail({ signal }: { signal: SignalRecord }) {
  const frequencies = numericValues(signal.frequency);
  const low = frequencies.length ? Math.min(...frequencies) : 0;
  const high = frequencies.length ? Math.max(...frequencies) : 0;

  return (
    <div className="band-rail" aria-label="Radio-frequency band coverage">
      {RF_BANDS.map((band) => {
        const active = Boolean(frequencies.length && low <= band.max && high >= band.min);
        return (
          <div
            className={cx("band-segment", active && "is-active")}
            key={band.label}
            title={`${band.label}: ${formatEngineering(band.min)} to ${formatEngineering(band.max)}`}
          >
            {band.label}
          </div>
        );
      })}
    </div>
  );
}

function SignalList({
  signals,
  selectedId,
  bookmarks,
  onSelect,
}: {
  signals: SignalRecord[];
  selectedId: string;
  bookmarks: Set<string>;
  onSelect: (signal: SignalRecord) => void;
}) {
  const rowHeight = 97;
  const overscan = 5;
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(620);
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
  const endIndex = Math.min(signals.length, startIndex + visibleCount);
  const visibleSignals = signals.slice(startIndex, endIndex);

  useEffect(() => {
    const element = listRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setViewportHeight(entry.contentRect.height));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [signals]);

  useEffect(() => {
    const element = listRef.current;
    const selectedIndex = signals.findIndex((signal) => signal.pageid === selectedId);
    if (!element || selectedIndex < 0) return;
    const rowTop = selectedIndex * rowHeight;
    const rowBottom = rowTop + rowHeight;
    if (rowTop < element.scrollTop || rowBottom > element.scrollTop + element.clientHeight) {
      element.scrollTo({ top: Math.max(0, rowTop - element.clientHeight / 2 + rowHeight / 2) });
    }
  }, [selectedId, signals]);

  return (
    <div
      className="signal-list"
      ref={listRef}
      role="listbox"
      aria-label="Signals"
      tabIndex={0}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      {signals.length ? (
        <div className="signal-list-window" style={{ height: signals.length * rowHeight }}>
          {visibleSignals.map((signal, visibleIndex) => {
            const index = startIndex + visibleIndex;
            return (
              <button
                className={cx("signal-list-item", selectedId === signal.pageid && "is-selected")}
                key={signal.pageid}
                style={{ transform: `translateY(${index * rowHeight}px)` }}
                onClick={() => onSelect(signal)}
                role="option"
                aria-selected={selectedId === signal.pageid}
                aria-posinset={index + 1}
                aria-setsize={signals.length}
              >
                <span className="signal-item-topline">
                  <strong>{signal.title}</strong>
                  {bookmarks.has(signal.pageid) ? (
                    <Star className="saved-star" size={13} fill="currentColor" aria-label="Saved" />
                  ) : null}
                </span>
                <span className="signal-list-summary">
                  {signal["short description"] || "User-created signal reference"}
                </span>
                <span className="signal-list-meta">
                  <span>{formatRange(signal.frequency)}</span>
                  <span aria-hidden="true">·</span>
                  <span>{textValues(signal.modulation).slice(0, 2).join(" / ") || "Unknown"}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
      {!signals.length ? (
        <div className="empty-list">
          <Search size={28} />
          <strong>No signals found</strong>
          <span>Try a broader search or clear one of the filters.</span>
        </div>
      ) : null}
    </div>
  );
}

const SignalDetail = React.memo(function SignalDetail({
  signal,
  saved,
  onToggleSaved,
  onBack,
  onOpenDocuments,
  onEdit,
  onRemoveCategory,
  onAddCategory,
}: {
  signal: SignalRecord;
  saved: boolean;
  onToggleSaved: () => void;
  onBack: () => void;
  onOpenDocuments: () => void;
  onEdit: () => void;
  onRemoveCategory: (category: string) => void;
  onAddCategory: () => void;
}) {
  return (
    <article className="signal-detail" aria-labelledby="signal-title">
      <div className="mobile-detail-toolbar">
        <button className="quiet-button" onClick={onBack}>
          <ArrowLeft size={18} /> Back to signals
        </button>
      </div>

      <div className="detail-kicker-row">
        <span className="detail-kicker">
          {signal.custom ? "LOCAL REFERENCE" : `SIGID REFERENCE · #${signal.pageid}`}
        </span>
        <div className="detail-actions">
          <button className="icon-text-button" onClick={onEdit} aria-label="Edit signal and parameters">
            <Pencil size={16} />
            <span>Edit</span>
          </button>
          <button
            className={cx("icon-text-button", saved && "is-saved")}
            onClick={onToggleSaved}
            aria-label={saved ? "Remove from saved signals" : "Save signal"}
          >
            {saved ? <BookmarkCheck size={17} /> : <Bookmark size={17} />}
            <span>{saved ? "Saved" : "Save"}</span>
          </button>
          {!signal.custom ? (
            <a
              className="icon-text-button"
              href={`https://www.sigidwiki.com/wiki/index.php?curid=${signal.pageid}`}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={16} />
              <span>SigID Wiki</span>
            </a>
          ) : null}
        </div>
      </div>

      <h1 id="signal-title">{signal.title}</h1>
      <p className="signal-lede">{signal["short description"]}</p>

      <div className="tag-row" aria-label="Categories">
        {signal.category.map((category) => (
          <button
            type="button"
            className="category-tag"
            key={category}
            title="Remove tag from this signal"
            onClick={() => onRemoveCategory(category)}
          >
            {category}
          </button>
        ))}
        <button type="button" className="category-tag add-category-tag" onClick={onAddCategory}>
          <Plus size={13} /> Add tag
        </button>
        <span className="version-tag" title="First database version containing this signal">
          v{signal.added_since}
        </span>
      </div>

      <section className="range-section" aria-label="Signal range summary">
        <div className="range-card">
          <span>Frequency range</span>
          <strong>{formatRange(signal.frequency)}</strong>
        </div>
        <div className="range-card">
          <span>Bandwidth range</span>
          <strong>{formatRange(signal.bandwidth)}</strong>
        </div>
      </section>

      <BandRail signal={signal} />

      <section className="parameters-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">SIGNATURE</span>
            <h2>Signal parameters</h2>
          </div>
          <SlidersHorizontal size={19} />
        </div>
        <dl className="parameter-table">
          <ParameterRow label="Frequency" values={signal.frequency} formatter={(v) => formatEngineering(v)} onEdit={onEdit} />
          <ParameterRow label="Bandwidth" values={signal.bandwidth} formatter={(v) => formatEngineering(v)} onEdit={onEdit} />
          <ParameterRow label="Modulation" values={signal.modulation} onEdit={onEdit} />
          <ParameterRow label="Mode" values={signal.mode} onEdit={onEdit} />
          <ParameterRow label="ACF" values={signal.acf} formatter={(v) => `${trimNumber(v)} ms`} onEdit={onEdit} />
          <ParameterRow label="Location" values={signal.location} onEdit={onEdit} />
        </dl>
      </section>

      <section className="description-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">REFERENCE NOTES</span>
            <h2>About this signal</h2>
          </div>
          <FileText size={19} />
        </div>
        <div className="markdown-body">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
            }}
          >
            {signal.description || signal["short description"]}
          </ReactMarkdown>
        </div>
      </section>

      <button className="mobile-documents-button" onClick={onOpenDocuments}>
        <FileText size={18} /> Open attached media
      </button>
    </article>
  );
});

const MediaPanel = React.memo(function MediaPanel({
  signal,
  documents,
  onOpenDocuments,
  preferences,
  onAudioSettingsChange,
}: {
  signal: SignalRecord;
  documents: SignalDocument[];
  onOpenDocuments: () => void;
  preferences: Pick<UserPreferences, "audioVolume" | "audioLoop" | "audioOutputDeviceId">;
  onAudioSettingsChange: (settings: { volume?: number; loop?: boolean; outputDeviceId?: string }) => void;
}) {
  const mainImage = documents.find((document) => document.type === "Image" && document.preview && document.dataUrl);
  const mainAudio = documents.find((document) => document.type === "Audio" && document.preview && document.dataUrl);
  const rawImage = signal.spectrum?.url
    ? `${MEDIA_BASE}/${signal.pageid}/media/1.png`
    : "";
  const rawAudio = signal.audio?.url
    ? `${MEDIA_BASE}/${signal.pageid}/media/1.ogg`
    : "";
  const [failedImageSources, setFailedImageSources] = useState<Set<string>>(() => new Set());
  const fallbackImage = signal.spectrum?.url || "";
  const localImage = mainImage?.dataUrl || "";
  const imageSource = localImage
    || (rawImage && !failedImageSources.has(rawImage)
      ? rawImage
      : fallbackImage && !failedImageSources.has(fallbackImage)
        ? fallbackImage
        : "");

  return (
    <aside className="media-panel" aria-label="Signal media">
      <section className="media-card waterfall-card">
        <div className="media-card-heading">
          <div>
            <span className="eyebrow">WATERFALL / FFT</span>
            <strong>Spectrum sample</strong>
          </div>
          <Waves size={18} />
        </div>
        <div className="spectrum-frame">
          {imageSource ? (
            <img
              src={imageSource}
              alt={`Spectrum waterfall for ${signal.title}`}
              loading="eager"
              decoding="async"
              onError={() => setFailedImageSources((current) => new Set(current).add(imageSource))}
            />
          ) : (
            <div className="media-placeholder">
              <Waves size={34} />
              <span>No spectrum sample</span>
            </div>
          )}
          <div className="spectrum-scanline" aria-hidden="true" />
        </div>
        {signal.spectrum?.filename ? (
          <span className="media-filename">{signal.spectrum.filename}</span>
        ) : null}
      </section>

      <section className="media-card audio-card">
        <div className="media-card-heading">
          <div>
            <span className="eyebrow">AUDIO SAMPLE</span>
            <strong>Listen for the pattern</strong>
          </div>
          <Headphones size={18} />
        </div>
        <AudioPlayer
          title={mainAudio?.name || signal.audio?.filename || `${signal.title} sample`}
          sources={[mainAudio?.dataUrl || "", rawAudio, signal.audio?.url || ""]}
          initialVolume={preferences.audioVolume}
          initialLoop={preferences.audioLoop}
          initialOutputDeviceId={preferences.audioOutputDeviceId}
          onSettingsChange={onAudioSettingsChange}
        />
      </section>

      <button className="documents-card" onClick={onOpenDocuments}>
        <span className="documents-icon">
          <FileText size={20} />
        </span>
        <span>
          <strong>Attached media</strong>
          <small>View image, audio, and source files</small>
        </span>
        <ExternalLink size={16} />
      </button>

      <div className="source-note">
        <Info size={15} />
        <span>
          Community reference data from Artemis DB {CATALOG_TAG} and Signal Identification Wiki.
        </span>
      </div>
    </aside>
  );
});

function FacetFilter({
  label,
  options,
  selected,
  counts,
  onChange,
  formatOption = (value) => value,
}: {
  label: string;
  options: string[];
  selected: string[];
  counts: Map<string, number>;
  onChange: (next: string[]) => void;
  formatOption?: (value: string) => string;
}) {
  const [search, setSearch] = useState("");
  const visibleOptions = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return term
      ? options.filter((option) => option.toLocaleLowerCase().includes(term))
      : options;
  }, [options, search]);

  function toggle(option: string) {
    onChange(
      selected.includes(option)
        ? selected.filter((value) => value !== option)
        : [...selected, option],
    );
  }

  return (
    <details className={cx("facet-filter", selected.length > 0 && "is-active")}>
      <summary>
        <span>{label}</span>
        <small>{selected.length ? `${selected.length} selected` : "Any"}</small>
        <ChevronDown size={14} />
      </summary>
      <div className="facet-menu">
        <div className="facet-menu-heading">
          <strong>{label}</strong>
          {selected.length ? <button onClick={() => onChange([])}>Clear</button> : null}
        </div>
        {options.length > 12 ? (
          <label className="facet-search">
            <Search size={14} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={`Find ${label.toLocaleLowerCase()}`}
              aria-label={`Search ${label.toLocaleLowerCase()} options`}
            />
          </label>
        ) : null}
        <div className="facet-options">
          {visibleOptions.map((option) => (
            <label key={option}>
              <input
                type="checkbox"
                checked={selected.includes(option)}
                onChange={() => toggle(option)}
              />
              <span>{formatOption(option)}</span>
              <small>{counts.get(option) || 0}</small>
            </label>
          ))}
          {!visibleOptions.length ? <p>No matching options</p> : null}
        </div>
      </div>
    </details>
  );
}

function NumericFilter({
  label,
  filter,
  onChange,
  units,
  availableCount,
}: {
  label: string;
  filter: NumericFilterState;
  onChange: (next: NumericFilterState) => void;
  units: EngineeringUnit[];
  availableCount?: number;
}) {
  const isUsable = filter.active && filter.value.trim() !== "";
  return (
    <div className={cx("numeric-filter", isUsable && "is-active")}>
      <div className="numeric-filter-heading">
        <label>
          <input
            type="checkbox"
            checked={filter.active}
            onChange={(event) => onChange({ ...filter, active: event.target.checked })}
          />
          <span>{label}</span>
        </label>
        <small>{availableCount ? `${availableCount} recorded` : `±${filter.tolerance}%`}</small>
      </div>
      <div className="numeric-filter-controls">
        <input
          type="number"
          min="0"
          step="any"
          inputMode="decimal"
          value={filter.value}
          placeholder="Target"
          aria-label={`${label} target value`}
          onChange={(event) => onChange({
            ...filter,
            value: event.target.value,
            active: event.target.value !== "" ? true : filter.active,
          })}
        />
        {units.length > 1 ? (
          <select
            value={filter.unit}
            aria-label={`${label} unit`}
            onChange={(event) => onChange({ ...filter, unit: event.target.value as EngineeringUnit })}
          >
            {units.map((unit) => <option key={unit}>{unit}</option>)}
          </select>
        ) : <span className="fixed-unit">{units[0]}</span>}
        <label className="tolerance-control">
          <span>±{filter.tolerance}%</span>
          <input
            type="range"
            min="0"
            max="50"
            step="1"
            value={filter.tolerance}
            aria-label={`${label} tolerance percentage`}
            onChange={(event) => onChange({ ...filter, tolerance: Number(event.target.value) })}
          />
        </label>
      </div>
    </div>
  );
}

function FilterWorkbench({
  filters,
  onChange,
  categories,
  modulations,
  locations,
  versions,
  counts,
  acfCount,
  resultCount,
}: {
  filters: FiltersState;
  onChange: (next: FiltersState) => void;
  categories: string[];
  modulations: string[];
  locations: string[];
  versions: string[];
  counts: {
    categories: Map<string, number>;
    modulations: Map<string, number>;
    locations: Map<string, number>;
    versions: Map<string, number>;
  };
  acfCount: number;
  resultCount: number;
}) {
  const canReset = JSON.stringify(filters) !== JSON.stringify(createDefaultFilters());
  const quickCategories = ["Digital", "Military", "Amateur Radio", "Radar", "Satellite"]
    .filter((category) => categories.includes(category));
  const setNumeric = (key: "frequency" | "bandwidth" | "acf", next: NumericFilterState) =>
    onChange({ ...filters, [key]: next });
  const toggleCategory = (category: string) => onChange({
    ...filters,
    categories: filters.categories.includes(category)
      ? filters.categories.filter((value) => value !== category)
      : [...filters.categories, category],
  });

  return (
    <section className="filter-workbench" aria-label="Signal filters">
      <div className="filter-workbench-heading">
        <span><SlidersHorizontal size={14} /> Filters</span>
        <output aria-live="polite">{resultCount} matches</output>
        <button disabled={!canReset} onClick={() => onChange(createDefaultFilters())}>Reset</button>
      </div>
      <div className="filter-workbench-body">
        <div className="category-shortcuts" aria-label="Category shortcuts">
          {quickCategories.map((category) => (
            <button
              className={filters.categories.includes(category) ? "is-active" : ""}
              key={category}
              aria-pressed={filters.categories.includes(category)}
              onClick={() => toggleCategory(category)}
            >
              {category}
            </button>
          ))}
        </div>

        <div className="numeric-filters">
          <NumericFilter
            label="Frequency"
            filter={filters.frequency}
            onChange={(next) => setNumeric("frequency", next)}
            units={["Hz", "kHz", "MHz", "GHz"]}
          />
          <NumericFilter
            label="Bandwidth"
            filter={filters.bandwidth}
            onChange={(next) => setNumeric("bandwidth", next)}
            units={["Hz", "kHz", "MHz", "GHz"]}
          />
          <NumericFilter
            label="ACF"
            filter={filters.acf}
            onChange={(next) => setNumeric("acf", next)}
            units={["ms"]}
            availableCount={acfCount}
          />
        </div>

        <div className="facet-grid">
          <FacetFilter
            label="Category / tag"
            options={categories}
            selected={filters.categories}
            counts={counts.categories}
            onChange={(categories) => onChange({ ...filters, categories })}
          />
          <FacetFilter
            label="Modulation"
            options={modulations}
            selected={filters.modulations}
            counts={counts.modulations}
            onChange={(modulations) => onChange({ ...filters, modulations })}
          />
          <FacetFilter
            label="Location"
            options={locations}
            selected={filters.locations}
            counts={counts.locations}
            onChange={(locations) => onChange({ ...filters, locations })}
          />
          <FacetFilter
            label="DB version"
            options={versions}
            selected={filters.versions}
            counts={counts.versions}
            onChange={(versions) => onChange({ ...filters, versions })}
            formatOption={(version) => `v${version}`}
          />
        </div>

        <label className="band-shortcut">
          <span>RF band shortcut <small>Web convenience</small></span>
          <select value={filters.band} onChange={(event) => onChange({ ...filters, band: event.target.value })}>
            <option value="">Any band</option>
            {RF_BANDS.map((band) => <option key={band.label}>{band.label}</option>)}
          </select>
        </label>
        <p className="filter-logic">Matches any checked option within a filter and every active filter together.</p>
      </div>
    </section>
  );
}

function DocumentsModal({ signal, onClose }: { signal: SignalRecord; onClose: () => void }) {
  const documents = [
    signal.spectrum
      ? {
          type: "Image",
          name: signal.spectrum.filename || "Spectrum sample",
          href: `${MEDIA_BASE}/${signal.pageid}/media/1.png`,
          icon: <FileImage size={18} />,
        }
      : null,
    signal.audio
      ? {
          type: "Audio",
          name: signal.audio.filename || "Audio sample",
          href: `${MEDIA_BASE}/${signal.pageid}/media/1.ogg`,
          icon: <FileAudio size={18} />,
        }
      : null,
    !signal.custom
      ? {
          type: "Source",
          name: "Signal Identification Wiki entry",
          href: `https://www.sigidwiki.com/wiki/index.php?curid=${signal.pageid}`,
          icon: <ExternalLink size={18} />,
        }
      : null,
  ].filter(Boolean) as Array<{ type: string; name: string; href: string; icon: React.ReactNode }>;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal documents-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="documents-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">{signal.title}</span>
            <h2 id="documents-title">Attached media</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close attached media">
            <X size={19} />
          </button>
        </div>
        <div className="document-list">
          {documents.map((document) => (
            <a href={document.href} target="_blank" rel="noreferrer" key={document.href}>
              <span className="document-type-icon">{document.icon}</span>
              <span>
                <small>{document.type}</small>
                <strong>{document.name}</strong>
              </span>
              <ExternalLink size={16} />
            </a>
          ))}
          {!documents.length ? <div className="audio-empty">No media attached</div> : null}
        </div>
      </section>
    </div>
  );
}

function DatabaseModal({
  customSignals,
  onClose,
  onNewSignal,
  onImport,
  onExport,
}: {
  customSignals: SignalRecord[];
  onClose: () => void;
  onNewSignal: () => void;
  onImport: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onExport: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal database-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="database-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">DATABASE MANAGER</span>
            <h2 id="database-title">Signal libraries</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close database manager">
            <X size={19} />
          </button>
        </div>

        <div className="database-list">
          <div className="database-row is-current">
            <span className="database-mark"><Database size={20} /></span>
            <span>
              <small>COMMUNITY REFERENCE · READ ONLY</small>
              <strong>SigID Database {CATALOG_TAG}</strong>
              <em>{catalogMetadata.signalCount} recognized signals</em>
            </span>
            <span className="current-pill">Current</span>
          </div>
          <div className="database-row">
            <span className="database-mark local"><Library size={20} /></span>
            <span>
              <small>LOCAL · THIS DEVICE</small>
              <strong>Field Notes</strong>
              <em>{customSignals.length} custom {customSignals.length === 1 ? "signal" : "signals"}</em>
            </span>
            <button className="small-button" onClick={onNewSignal}>
              <Plus size={15} /> Add
            </button>
          </div>
        </div>

        <div className="database-actions">
          <label className="secondary-button file-button">
            <Import size={17} /> Import JSON
            <input type="file" accept="application/json,.json" onChange={onImport} />
          </label>
          <button className="secondary-button" onClick={onExport} disabled={!customSignals.length}>
            <Download size={17} /> Export local library
          </button>
        </div>
        <p className="database-footnote">
          Local signals and saved items remain in this browser. Export a JSON backup before clearing browser data.
        </p>
      </section>
    </div>
  );
}

function NewSignalModal({ onClose, onCreate }: { onClose: () => void; onCreate: (signal: SignalRecord) => void }) {
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [frequency, setFrequency] = useState("");
  const [bandwidth, setBandwidth] = useState("");
  const [category, setCategory] = useState("Field observation");
  const [modulation, setModulation] = useState("");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    const frequencyHz = Number(frequency) * 1_000_000;
    const bandwidthHz = Number(bandwidth) * 1_000;
    onCreate({
      pageid: `local-${Date.now()}`,
      title: title.trim(),
      added_since: CATALOG_VERSION,
      spectrum: null,
      audio: null,
      category: [category.trim() || "Field observation"],
      frequency: Number.isFinite(frequencyHz) && frequencyHz > 0 ? [{ value: frequencyHz }] : [],
      bandwidth: Number.isFinite(bandwidthHz) && bandwidthHz > 0 ? [{ value: bandwidthHz }] : [],
      acf: [],
      modulation: modulation.trim() ? [{ value: modulation.trim().toUpperCase() }] : [],
      mode: [],
      location: [],
      "short description": summary.trim() || "Locally saved field observation.",
      description: summary.trim() || "Locally saved field observation.",
      custom: true,
    });
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        className="modal new-signal-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-signal-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">FIELD NOTES</span>
            <h2 id="new-signal-title">Add a signal</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close new signal form">
            <X size={19} />
          </button>
        </div>
        <div className="new-signal-form">
          <label className="wide-field">
            <span>Signal name</span>
            <input autoFocus required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Unknown burst at 14.2 MHz" />
          </label>
          <label className="wide-field">
            <span>Observation notes</span>
            <textarea value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Describe the cadence, sound, time, and anything distinctive…" />
          </label>
          <label>
            <span>Frequency (MHz)</span>
            <input type="number" min="0" step="any" inputMode="decimal" value={frequency} onChange={(e) => setFrequency(e.target.value)} placeholder="14.200" />
          </label>
          <label>
            <span>Bandwidth (kHz)</span>
            <input type="number" min="0" step="any" inputMode="decimal" value={bandwidth} onChange={(e) => setBandwidth(e.target.value)} placeholder="2.8" />
          </label>
          <label>
            <span>Category</span>
            <input value={category} onChange={(e) => setCategory(e.target.value)} />
          </label>
          <label>
            <span>Modulation</span>
            <input value={modulation} onChange={(e) => setModulation(e.target.value)} placeholder="FSK, PSK, FM…" />
          </label>
        </div>
        <div className="modal-footer">
          <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary-button"><Plus size={17} /> Add to Field Notes</button>
        </div>
      </form>
    </div>
  );
}

function SpaceWeather({ data, loading, onRefresh }: { data: SpaceWeatherData | null; loading: boolean; onRefresh: () => void }) {
  const forecastDates = data?.FORCST?.PRE_DATES || [];
  const propagation = data?.PROPAGATION
    ? Object.entries(data.PROPAGATION).slice(0, 8)
    : [];

  return (
    <main className="weather-view">
      <section className="weather-hero">
        <div>
          <span className="eyebrow">LIVE RF CONDITIONS</span>
          <h1>Space weather</h1>
          <p>Current solar and geomagnetic conditions that shape HF propagation and reception.</p>
        </div>
        <div className="weather-hero-actions">
          <span className="weather-timestamp">
            <span className="live-dot" />
            {data?.JSON_INFO?.utc_date
              ? `${data.JSON_INFO.utc_date} · ${data.JSON_INFO.utc_time} UTC`
              : loading
                ? "Retrieving live report…"
                : "Report unavailable"}
          </span>
          <button className="icon-text-button" onClick={onRefresh} disabled={loading}>
            <RefreshCw size={16} className={loading ? "is-spinning" : ""} /> Refresh
          </button>
        </div>
      </section>

      <section className="weather-metrics">
        <div className="weather-metric primary-weather-metric">
          <span className="metric-icon violet"><Gauge size={20} /></span>
          <span><small>PLANETARY K-INDEX</small><strong>{data?.AK?.k_index ?? "—"}</strong></span>
          <em>{data?.AK?.k_index !== undefined && data.AK.k_index < 4 ? "Quiet" : "Elevated"}</em>
        </div>
        <div className="weather-metric">
          <span className="metric-icon teal"><Sun size={20} /></span>
          <span><small>SOLAR FLUX</small><strong>{data?.SGAS?.sfi ?? "—"}</strong></span>
          <em>SFI</em>
        </div>
        <div className="weather-metric">
          <span className="metric-icon amber"><Sparkles size={20} /></span>
          <span><small>SUNSPOT NUMBER</small><strong>{data?.SGAS?.ssn ?? "—"}</strong></span>
          <em>SSN</em>
        </div>
        <div className="weather-metric">
          <span className="metric-icon coral"><Orbit size={20} /></span>
          <span><small>X-RAY FLUX</small><strong>{data?.XRAY?.peak_flux_class ?? "—"}</strong></span>
          <em>Current</em>
        </div>
      </section>

      <section className="weather-grid">
        <div className="weather-panel scale-panel">
          <div className="section-heading">
            <div><span className="eyebrow">NOAA SCALES</span><h2>Radio environment</h2></div>
            <CloudSun size={20} />
          </div>
          <div className="scale-list">
            {[
              ["G", "Geomagnetic storm", data?.GSR_SCALES?.G_now ?? 0, "violet"],
              ["S", "Solar radiation", data?.GSR_SCALES?.S_now ?? 0, "amber"],
              ["R", "Radio blackout", data?.GSR_SCALES?.R_now ?? 0, "coral"],
            ].map(([letter, label, value, tone]) => (
              <div className="scale-row" key={String(letter)}>
                <span className={`scale-letter ${tone}`}>{letter}{value}</span>
                <span><strong>{label}</strong><small>{Number(value) === 0 ? "No current impact" : "Conditions elevated"}</small></span>
                <div className="scale-track"><i style={{ width: `${Math.max(6, Number(value) * 20)}%` }} /></div>
              </div>
            ))}
          </div>
          <div className="noise-callout">
            <Radio size={17} />
            <span><small>EXPECTED HF NOISE</small><strong>{data?.AK?.exp_noise || "Awaiting report"}</strong></span>
          </div>
        </div>

        <div className="weather-panel propagation-panel">
          <div className="section-heading">
            <div><span className="eyebrow">PROPAGATION</span><h2>Band outlook</h2></div>
            <Waves size={20} />
          </div>
          <div className="propagation-grid">
            {propagation.length ? propagation.map(([key, value]) => (
              <div className="propagation-cell" key={key}>
                <small>{key.replaceAll("_", " ")}</small>
                <strong className={/open|good|fair/i.test(value) ? "positive" : ""}>{value}</strong>
              </div>
            )) : Array.from({ length: 6 }).map((_, index) => <div className="propagation-cell skeleton-cell" key={index} />)}
          </div>
        </div>
      </section>

      <section className="weather-panel forecast-panel">
        <div className="section-heading">
          <div><span className="eyebrow">THREE-DAY OUTLOOK</span><h2>Forecast</h2></div>
          <span className="forecast-legend">Chance of activity</span>
        </div>
        <div className="forecast-table">
          {forecastDates.map((date, index) => (
            <div className="forecast-day" key={date}>
              <strong>{date}</strong>
              <span><small>Geomagnetic</small><b>{data?.FORCST?.GEO_MID_ACTIVE?.[index] ?? 0}%</b></span>
              <span><small>M-class flare</small><b>{data?.FORCST?.CLASS_M?.[index] ?? 0}%</b></span>
              <span><small>X-class flare</small><b>{data?.FORCST?.CLASS_X?.[index] ?? 0}%</b></span>
            </div>
          ))}
          {!forecastDates.length ? <div className="audio-empty">Forecast is loading</div> : null}
        </div>
      </section>

      <p className="weather-credit">
        Live report provided by the AresValley Poseidon engine. Conditions are informational, not operational guidance.
      </p>
    </main>
  );
}

export default function Home() {
  const [view, setView] = useState<ViewName>("library");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [filters, setFilters] = useState<FiltersState>(() => createDefaultFilters());
  const [selectedId, setSelectedId] = useState("5803");
  const [catalogSignals, setCatalogSignals] = useState<SignalRecord[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [workspace, setWorkspace] = useState<WorkspaceState>(() => createDefaultWorkspace());
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const [databaseOpen, setDatabaseOpen] = useState(false);
  const [newSignalOpen, setNewSignalOpen] = useState(false);
  const [editorSignalId, setEditorSignalId] = useState<string | null>(null);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [weather, setWeather] = useState<FullSpaceWeatherData | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState("");
  const [updateState, setUpdateState] = useState<DatabaseUpdateState>("idle");
  const [updateMessage, setUpdateMessage] = useState("");
  const [operationStatus, setOperationStatus] = useState("Ready");
  const [filterPaneWidth, setFilterPaneWidth] = useState(270);
  const [signalPaneWidth, setSignalPaneWidth] = useState(315);
  const searchRef = useRef<HTMLInputElement>(null);

  const bookmarks = useMemo(() => {
    const prefix = `${workspace.activeDatabaseId}::`;
    return new Set(workspace.bookmarks
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length)));
  }, [workspace.activeDatabaseId, workspace.bookmarks]);
  const allSignals = useMemo(
    () => resolveActiveSignals(workspace, catalogSignals),
    [catalogSignals, workspace],
  );
  const signalIndex = useMemo(() => buildSignalIndex(allSignals), [allSignals]);
  const filterMetadata = useMemo(() => {
    const categories = new Map<string, number>();
    const modulations = new Map<string, number>();
    const locations = new Map<string, number>();
    const versions = new Map<string, number>();
    let acfCount = 0;
    const increment = (map: Map<string, number>, value: string) =>
      map.set(value, (map.get(value) || 0) + 1);

    allSignals.forEach((signal) => {
      new Set(signal.category).forEach((value) => increment(categories, value));
      new Set(textValues(signal.modulation)).forEach((value) => increment(modulations, value));
      new Set(textValues(signal.location)).forEach((value) => increment(locations, value));
      increment(versions, String(signal.added_since));
      if (signal.acf.length) acfCount += 1;
    });

    return {
      options: {
        categories: Array.from(categories.keys()).sort(),
        modulations: Array.from(modulations.keys()).sort(),
        locations: Array.from(locations.keys()).sort(),
        versions: Array.from(versions.keys()).sort((a, b) => Number(b) - Number(a)),
      },
      counts: { categories, modulations, locations, versions },
      acfCount,
    };
  }, [allSignals]);

  const filteredSignals = useMemo(() => {
    return filterSignals({
      signals: allSignals,
      index: signalIndex,
      query: deferredQuery,
      filters,
      savedOnly: view === "saved",
      bookmarks,
    });
  }, [allSignals, bookmarks, deferredQuery, filters, signalIndex, view]);

  const selected =
    filteredSignals.find((signal) => signal.pageid === selectedId) || filteredSignals[0] || null;

  const activeFilterCount = countActiveFilterGroups(filters);
  const activeLocalDatabase = workspace.databases.find((database) => database.id === workspace.activeDatabaseId) || null;
  const activeDatabaseName = activeLocalDatabase?.name || "SigID Database";
  const activeDatabaseVersion = activeLocalDatabase?.version || CATALOG_VERSION;
  const activeDocuments = useMemo(() => workspace.activeDatabaseId === SIGID_DATABASE_ID
    ? workspace.sigidDocuments
    : activeLocalDatabase?.documents || [], [activeLocalDatabase?.documents, workspace.activeDatabaseId, workspace.sigidDocuments]);
  const selectedDocuments = useMemo(() => selected
    ? activeDocuments.filter((document) => document.signalId === selected.pageid)
    : [], [activeDocuments, selected]);
  const activeTags = useMemo(() => {
    const configured = workspace.activeDatabaseId === SIGID_DATABASE_ID
      ? workspace.sigidTags
      : activeLocalDatabase?.tags || [];
    return Array.from(new Set([...configured, ...allSignals.flatMap((signal) => signal.category)])).sort();
  }, [activeLocalDatabase?.tags, allSignals, workspace.activeDatabaseId, workspace.sigidTags]);
  const managedTags = useMemo<ManagedTag[]>(() => activeTags.map((tag) => ({
    id: tag,
    name: tag,
    signalCount: allSignals.filter((signal) => signal.category.includes(tag)).length,
  })), [activeTags, allSignals]);

  useEffect(() => {
    const controller = new AbortController();
    async function initialize() {
      const workspacePromise = loadWorkspace();
      const catalogPromise = fetch("/api/signals", { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error("Signal catalog unavailable");
          return response.json() as Promise<{ signals?: SignalRecord[] }>;
        });
      const [workspaceResult, catalogResult] = await Promise.allSettled([workspacePromise, catalogPromise]);
      if (controller.signal.aborted) return;
      if (workspaceResult.status === "fulfilled") {
        setWorkspace(workspaceResult.value.preferences.autoloadLatest
          ? { ...workspaceResult.value, activeDatabaseId: SIGID_DATABASE_ID }
          : workspaceResult.value);
      }
      setWorkspaceReady(true);
      if (catalogResult.status === "fulfilled" && Array.isArray(catalogResult.value.signals)) {
        setCatalogSignals(catalogResult.value.signals);
        setCatalogError("");
      } else {
        setCatalogError("The signal catalog could not be loaded. Retry when the connection returns.");
      }
      setCatalogLoading(false);
    }
    void initialize();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!workspaceReady) return;
    const timeout = window.setTimeout(() => {
      void saveWorkspace(workspace).catch((error) => {
        setOperationStatus(error instanceof Error ? error.message : "Workspace save failed");
      });
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [workspace, workspaceReady]);

  useEffect(() => {
    const preferences = workspace.preferences;
    const root = document.documentElement;
    root.dataset.theme = preferences.theme;
    root.style.setProperty("--ui-scale", String(preferences.scale));
    const accent = ACCENT_COLORS[preferences.accent] || ACCENT_COLORS.Green;
    root.style.setProperty("--accent", accent);
    root.style.setProperty("--accent-strong", accent);
    root.style.setProperty("--accent-soft", `${accent}24`);
  }, [workspace.preferences]);

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      const inInteractiveControl = Boolean(target.closest("input, textarea, select, button, a, summary, [contenteditable='true']"));
      if (event.key === "/" && !inInteractiveControl) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape") {
        setDocumentsOpen(false);
        setDatabaseOpen(false);
        setNewSignalOpen(false);
        setEditorSignalId(null);
        setTagManagerOpen(false);
        setPreferencesOpen(false);
        setAboutOpen(false);
      }
      if (!inInteractiveControl && view !== "weather" && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.preventDefault();
        const index = filteredSignals.findIndex((signal) => signal.pageid === selectedId);
        const nextIndex = event.key === "ArrowDown"
          ? Math.min(filteredSignals.length - 1, index + 1)
          : Math.max(0, index - 1);
        if (filteredSignals[nextIndex]) setSelectedId(filteredSignals[nextIndex].pageid);
      }
    }
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [filteredSignals, selectedId, view]);

  async function loadWeather() {
    setWeatherLoading(true);
    setWeatherError("");
    try {
      const response = await fetch("/api/space-weather", { cache: "no-store" });
      if (!response.ok) throw new Error("Weather report unavailable");
      setWeather(await response.json());
    } catch {
      setWeatherError("Live Poseidon data is temporarily unavailable. The last successful report remains visible.");
    } finally {
      setWeatherLoading(false);
    }
  }

  function changeView(next: ViewName) {
    setView(next);
    setMobileDetailOpen(false);
    if (next === "weather") setQuery("");
    if (next === "weather" && !weather && !weatherLoading) void loadWeather();
  }

  const selectSignal = useCallback((signal: SignalRecord) => {
    setSelectedId(signal.pageid);
    setMobileDetailOpen(true);
  }, []);

  const toggleBookmark = useCallback(() => {
    if (!selected || !workspaceReady) return;
    setWorkspace((current) => {
      const next = new Set(current.bookmarks);
      const key = bookmarkKey(current.activeDatabaseId, selected.pageid);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...current, bookmarks: Array.from(next) };
    });
  }, [selected, workspaceReady]);

  const closeMobileDetail = useCallback(() => setMobileDetailOpen(false), []);
  const openDocuments = useCallback(() => {
    if (workspaceReady) setDocumentsOpen(true);
  }, [workspaceReady]);

  const updateAudioSettings = useCallback((settings: { volume?: number; loop?: boolean; outputDeviceId?: string }) => {
    if (!workspaceReady) return;
    setWorkspace((current) => ({
      ...current,
      preferences: {
        ...current.preferences,
        ...(settings.volume === undefined ? {} : { audioVolume: settings.volume }),
        ...(settings.loop === undefined ? {} : { audioLoop: settings.loop }),
        ...(settings.outputDeviceId === undefined ? {} : { audioOutputDeviceId: settings.outputDeviceId }),
      },
    }));
  }, [workspaceReady]);

  function requireWorkspaceReady() {
    if (!workspaceReady) throw new Error("Your local Artemis workspace is still loading. Try again in a moment.");
  }

  function saveManagedSignal(managed: ManagedSignal) {
    requireWorkspaceReady();
    const existing = allSignals.find((signal) => signal.pageid === managed.id);
    if (!existing && allSignals.length >= 5_000) throw new Error("This database has reached the 5,000 signal limit.");
    if (Object.values(managed.parameters).some((parameters) => parameters.length > 2_000)) {
      throw new Error("A signal parameter cannot contain more than 2,000 values.");
    }
    const signal = managedToSignal(managed, existing);
    setWorkspace((current) => {
      if (current.activeDatabaseId === SIGID_DATABASE_ID) {
        const isBaseSignal = catalogSignals.some((candidate) => candidate.pageid === signal.pageid);
        return {
          ...current,
          deletedSigidIds: current.deletedSigidIds.filter((id) => id !== signal.pageid),
          sigidOverrides: isBaseSignal
            ? { ...current.sigidOverrides, [signal.pageid]: signal }
            : current.sigidOverrides,
          sigidAdditions: isBaseSignal
            ? current.sigidAdditions.filter((candidate) => candidate.pageid !== signal.pageid)
            : [signal, ...current.sigidAdditions.filter((candidate) => candidate.pageid !== signal.pageid)],
        };
      }
      return {
        ...current,
        databases: current.databases.map((database) => database.id === current.activeDatabaseId
          ? {
              ...database,
              updatedAt: new Date().toISOString(),
              tags: Array.from(new Set([...database.tags, ...signal.category])),
              signals: [signal, ...database.signals.filter((candidate) => candidate.pageid !== signal.pageid)],
            }
          : database),
      };
    });
    setSelectedId(signal.pageid);
    setNewSignalOpen(false);
    setEditorSignalId(null);
    setView("library");
    setMobileDetailOpen(true);
    setOperationStatus(`${signal.title} saved`);
  }

  function deleteManagedSignal(signalId: string) {
    requireWorkspaceReady();
    const signalName = allSignals.find((signal) => signal.pageid === signalId)?.title || "Signal";
    setWorkspace((current) => {
      const deletedBookmark = bookmarkKey(current.activeDatabaseId, signalId);
      const bookmarks = current.bookmarks.filter((id) => id !== deletedBookmark);
      if (current.activeDatabaseId === SIGID_DATABASE_ID) {
        const overrides = { ...current.sigidOverrides };
        delete overrides[signalId];
        const isBaseSignal = catalogSignals.some((candidate) => candidate.pageid === signalId);
        return {
          ...current,
          bookmarks,
          sigidOverrides: overrides,
          sigidAdditions: current.sigidAdditions.filter((signal) => signal.pageid !== signalId),
          deletedSigidIds: isBaseSignal
            ? Array.from(new Set([...current.deletedSigidIds, signalId]))
            : current.deletedSigidIds,
          sigidDocuments: current.sigidDocuments.filter((document) => document.signalId !== signalId),
        };
      }
      return {
        ...current,
        bookmarks,
        databases: current.databases.map((database) => database.id === current.activeDatabaseId
          ? {
              ...database,
              updatedAt: new Date().toISOString(),
              signals: database.signals.filter((signal) => signal.pageid !== signalId),
              documents: database.documents.filter((document) => document.signalId !== signalId),
            }
          : database),
      };
    });
    setNewSignalOpen(false);
    setEditorSignalId(null);
    setMobileDetailOpen(false);
    setOperationStatus(`${signalName} deleted`);
  }

  function downloadText(contents: string, name: string) {
    const blob = new Blob([contents], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function createDatabase(name: string) {
    requireWorkspaceReady();
    if (workspace.databases.length >= 50) throw new Error("This workspace has reached the 50 database limit.");
    const now = new Date().toISOString();
    const database: LocalDatabase = {
      id: `database-${crypto.randomUUID?.() || Date.now()}`,
      name,
      version: 1,
      createdAt: now,
      updatedAt: now,
      signals: [],
      tags: [],
      documents: [],
    };
    setWorkspace((current) => ({ ...current, activeDatabaseId: database.id, databases: [...current.databases, database] }));
    setOperationStatus(`${name} created and loaded`);
  }

  function loadDatabase(databaseId: string) {
    requireWorkspaceReady();
    setWorkspace((current) => ({ ...current, activeDatabaseId: databaseId }));
    setFilters(createDefaultFilters());
    setSelectedId("");
    setMobileDetailOpen(false);
    setOperationStatus(`${databaseId === SIGID_DATABASE_ID ? "SigID Database" : workspace.databases.find((database) => database.id === databaseId)?.name || "Database"} loaded`);
  }

  function renameDatabase(databaseId: string, name: string) {
    requireWorkspaceReady();
    if (databaseId === SIGID_DATABASE_ID) throw new Error("The bundled SigID database name is fixed.");
    setWorkspace((current) => ({
      ...current,
      databases: current.databases.map((database) => database.id === databaseId ? { ...database, name, updatedAt: new Date().toISOString() } : database),
    }));
    setOperationStatus(`Database renamed to ${name}`);
  }

  function deleteDatabase(databaseId: string) {
    requireWorkspaceReady();
    if (databaseId === SIGID_DATABASE_ID) throw new Error("The bundled SigID database cannot be deleted.");
    setWorkspace((current) => ({
      ...current,
      activeDatabaseId: current.activeDatabaseId === databaseId ? SIGID_DATABASE_ID : current.activeDatabaseId,
      databases: current.databases.filter((database) => database.id !== databaseId),
      bookmarks: current.bookmarks.filter((key) => !key.startsWith(`${databaseId}::`)),
    }));
    setOperationStatus("Database deleted");
  }

  async function importDatabase(file: File) {
    requireWorkspaceReady();
    if (workspace.databases.length >= 50) throw new Error("Delete a local database before importing another one.");
    if (!file.name.toLocaleLowerCase().endsWith(".json")) {
      throw new Error("This web edition imports validated Artemis JSON archives. Desktop SQLite .tar archives must first be exported to JSON.");
    }
    if (file.size > DATABASE_BUNDLE_BYTE_LIMIT) {
      throw new Error("Database archives are limited to 65 MiB.");
    }
    const database = importDatabaseBundle(await file.text());
    const imported = { ...database, id: `database-${crypto.randomUUID?.() || Date.now()}` };
    setWorkspace(validateWorkspace({ ...workspace, activeDatabaseId: imported.id, databases: [...workspace.databases, imported] }));
    setOperationStatus(`${imported.name} imported`);
  }

  function exportDatabase(databaseId: string) {
    requireWorkspaceReady();
    if (databaseId === SIGID_DATABASE_ID) {
      const now = new Date().toISOString();
      const database: LocalDatabase = {
        id: "sigid-export",
        name: "SigID Database",
        version: CATALOG_VERSION,
        createdAt: now,
        updatedAt: now,
        signals: allSignals,
        tags: activeTags,
        documents: workspace.sigidDocuments,
      };
      downloadText(exportDatabaseBundle(database), `sigid-${CATALOG_TAG}.artemis.json`);
    } else {
      const database = workspace.databases.find((candidate) => candidate.id === databaseId);
      if (!database) throw new Error("Database not found.");
      downloadText(exportDatabaseBundle(database), `${database.name.replace(/[^a-z0-9]+/gi, "-").toLocaleLowerCase()}.artemis.json`);
    }
    setOperationStatus("Database archive exported");
  }

  const checkUpdates = useCallback(async () => {
    setUpdateState("checking");
    setUpdateMessage("Checking AresValley releases…");
    try {
      const response = await fetch("/api/update-info", { cache: "no-store" });
      if (!response.ok) throw new Error("Update service unavailable");
      const info = await response.json() as { database?: { version?: string }; upstreamApplication?: { version?: string } };
      const latestDatabase = Number(String(info.database?.version || "").replace(/\D/g, ""));
      const available = Number.isFinite(latestDatabase) && latestDatabase > CATALOG_VERSION;
      setUpdateState(available ? "available" : "current");
      setUpdateMessage(available
        ? `SigID ${info.database?.version} is available. The web catalog will update after its verified deployment.`
        : `Database ${CATALOG_TAG} is current. Upstream Artemis ${info.upstreamApplication?.version || "release information loaded"}.`);
    } catch {
      setUpdateState("error");
      setUpdateMessage("Unable to check releases right now.");
    }
  }, []);

  useEffect(() => {
    if (!workspaceReady) return;
    const timeout = window.setTimeout(() => void checkUpdates(), 0);
    return () => window.clearTimeout(timeout);
  }, [checkUpdates, workspaceReady]);

  function updateActiveDocuments(transform: (documents: SignalDocument[]) => SignalDocument[]) {
    const candidate = workspace.activeDatabaseId === SIGID_DATABASE_ID
      ? { ...workspace, sigidDocuments: transform(workspace.sigidDocuments) }
      : {
          ...workspace,
          databases: workspace.databases.map((database) => database.id === workspace.activeDatabaseId
            ? { ...database, documents: transform(database.documents), updatedAt: new Date().toISOString() }
            : database),
        };
    setWorkspace(validateWorkspace(candidate));
  }

  function addDocument(document: NewManagedDocument) {
    requireWorkspaceReady();
    if (!selected) throw new Error("Select a signal before adding a document.");
    if (activeDocuments.length >= 5_000) throw new Error("This database has reached the 5,000 document limit.");
    const mime = document.dataUrl?.match(/^data:([^;,]+)/)?.[1] || "application/octet-stream";
    const saved: SignalDocument = {
      id: `document-${crypto.randomUUID?.() || Date.now()}`,
      signalId: selected.pageid,
      fileName: document.fileName,
      name: document.name,
      description: document.description,
      type: document.type,
      preview: document.preview,
      mime,
      dataUrl: document.dataUrl,
    };
    if (JSON.stringify(workspace).length + (document.dataUrl?.length || 0) > WORKSPACE_PERSISTENCE_BYTE_LIMIT) {
      throw new Error("This attachment would exceed the 64 MiB workspace limit. Export or remove stored files first.");
    }
    updateActiveDocuments((documents) => [...documents, saved]);
    setOperationStatus(`${document.name} attached`);
  }

  function updateDocument(document: ManagedDocument) {
    requireWorkspaceReady();
    if (document.id.startsWith("builtin-")) throw new Error("Bundled reference media metadata is read-only.");
    updateActiveDocuments((documents) => {
      const existing = documents.find((current) => current.id === document.id);
      return documents.map((current) => {
        if (current.id === document.id) {
          return {
            ...current,
            name: document.name,
            description: document.description,
            type: document.type,
            preview: document.preview,
          };
        }
        if (document.preview && existing && current.signalId === existing.signalId && current.type === document.type) {
          return { ...current, preview: false };
        }
        return current;
      });
    });
    setOperationStatus(`${document.name} updated`);
  }

  function deleteDocument(documentId: string) {
    requireWorkspaceReady();
    if (documentId.startsWith("builtin-")) throw new Error("Bundled reference media cannot be deleted.");
    updateActiveDocuments((documents) => documents.filter((document) => document.id !== documentId));
    setOperationStatus("Document deleted");
  }

  function setMainDocument(documentId: string, type: "Image" | "Audio") {
    requireWorkspaceReady();
    updateActiveDocuments((documents) => documents.map((document) => document.signalId === selected?.pageid && document.type === type
      ? { ...document, preview: documentId.startsWith("builtin-") ? false : document.id === documentId }
      : document));
    setOperationStatus(`Main ${type.toLocaleLowerCase()} updated`);
  }

  function updateConfiguredTags(transform: (tags: string[]) => string[]) {
    setWorkspace((current) => {
      if (current.activeDatabaseId === SIGID_DATABASE_ID) return { ...current, sigidTags: transform(current.sigidTags) };
      return {
        ...current,
        databases: current.databases.map((database) => database.id === current.activeDatabaseId
          ? { ...database, tags: transform(database.tags), updatedAt: new Date().toISOString() }
          : database),
      };
    });
  }

  function addTag(name: string) {
    requireWorkspaceReady();
    if (activeTags.includes(name)) throw new Error("That tag already exists.");
    if (activeTags.length >= 1_000) throw new Error("This database has reached the 1,000 tag limit.");
    updateConfiguredTags((tags) => [...tags, name]);
    setOperationStatus(`${name} tag added`);
  }

  function transformActiveSignalTags(transform: (categories: string[]) => string[]) {
    setWorkspace((current) => {
      if (current.activeDatabaseId !== SIGID_DATABASE_ID) {
        return {
          ...current,
          databases: current.databases.map((database) => database.id === current.activeDatabaseId
            ? {
                ...database,
                tags: transform(database.tags),
                signals: database.signals.map((signal) => ({ ...signal, category: transform(signal.category) })),
                updatedAt: new Date().toISOString(),
              }
            : database),
        };
      }
      const overrides = { ...current.sigidOverrides };
      for (const signal of allSignals) {
        const categories = transform(signal.category);
        if (categories.join("\0") !== signal.category.join("\0") && catalogSignals.some((base) => base.pageid === signal.pageid)) {
          overrides[signal.pageid] = { ...signal, category: categories };
        }
      }
      return {
        ...current,
        sigidTags: transform(current.sigidTags),
        sigidOverrides: overrides,
        sigidAdditions: current.sigidAdditions.map((signal) => ({ ...signal, category: transform(signal.category) })),
      };
    });
  }

  function renameTag(tagId: string, name: string) {
    requireWorkspaceReady();
    if (activeTags.includes(name) && name !== tagId) throw new Error("That tag already exists.");
    transformActiveSignalTags((categories) => Array.from(new Set(categories.map((category) => category === tagId ? name : category))));
    setOperationStatus(`${tagId} renamed to ${name}`);
  }

  function deleteTag(tagId: string) {
    requireWorkspaceReady();
    transformActiveSignalTags((categories) => categories.filter((category) => category !== tagId));
    setOperationStatus(`${tagId} deleted`);
  }

  function savePreferences(preferences: ManagedPreferences) {
    requireWorkspaceReady();
    setWorkspace((current) => ({
      ...current,
      preferences: { ...current.preferences, ...preferences },
    }));
    setPreferencesOpen(false);
    setOperationStatus("Preferences saved");
  }

  const managedDatabases = useMemo<ManagedDatabase[]>(() => {
    const builtInDocuments = catalogSignals.reduce((count, signal) => count + Number(Boolean(signal.spectrum?.url)) + Number(Boolean(signal.audio?.url)), 0);
    return [
      {
        id: SIGID_DATABASE_ID,
        name: "SigID Database",
        version: CATALOG_VERSION,
        createdAt: "Community catalog",
        editable: false,
        isSigid: true,
        signalCount: resolveActiveSignals(workspace, catalogSignals).length,
        documentCount: builtInDocuments + workspace.sigidDocuments.length,
        imageCount: catalogSignals.filter((signal) => Boolean(signal.spectrum?.url)).length + workspace.sigidDocuments.filter((document) => document.type === "Image").length,
        audioCount: catalogSignals.filter((signal) => Boolean(signal.audio?.url)).length + workspace.sigidDocuments.filter((document) => document.type === "Audio").length,
      },
      ...workspace.databases.map((database) => {
        const stats = getDatabaseStats(database);
        return {
          id: database.id,
          name: database.name,
          version: database.version,
          createdAt: new Date(database.createdAt).toLocaleDateString(),
          editable: true,
          signalCount: stats.signals,
          documentCount: stats.documents,
          imageCount: stats.images,
          audioCount: stats.audio,
        };
      }),
    ];
  }, [catalogSignals, workspace]);

  const managedDocuments = useMemo<ManagedDocument[]>(() => {
    if (!selected) return [];
    const local = selectedDocuments.map(documentToManaged);
    const hasLocalImage = selectedDocuments.some((document) => document.type === "Image" && document.preview);
    const hasLocalAudio = selectedDocuments.some((document) => document.type === "Audio" && document.preview);
    const builtIn: ManagedDocument[] = [];
    if (selected.spectrum?.url) builtIn.push({
      id: `builtin-image-${selected.pageid}`,
      name: selected.spectrum.filename || "Spectrum sample",
      description: "Bundled SigID spectrum/waterfall preview.",
      type: "Image",
      fileName: selected.spectrum.filename || "spectrum.png",
      extension: selected.spectrum.filename?.split(".").pop() || "png",
      url: selected.spectrum.url,
      preview: !hasLocalImage,
    });
    if (selected.audio?.url) builtIn.push({
      id: `builtin-audio-${selected.pageid}`,
      name: selected.audio.filename || "Audio sample",
      description: "Bundled SigID audio preview.",
      type: "Audio",
      fileName: selected.audio.filename || "sample.ogg",
      extension: selected.audio.filename?.split(".").pop() || "ogg",
      url: selected.audio.url,
      preview: !hasLocalAudio,
    });
    return [...local, ...builtIn];
  }, [selected, selectedDocuments]);
  const managedEditorSignal = editorSignalId
    ? allSignals.find((signal) => signal.pageid === editorSignalId) || null
    : null;

  function removeSelectedCategory(category: string) {
    if (!selected || !workspaceReady) return;
    saveManagedSignal(signalToManaged({ ...selected, category: selected.category.filter((value) => value !== category) }));
  }

  function startPaneResize(kind: "filter" | "signals", event: React.PointerEvent<HTMLButtonElement>) {
    const startX = event.clientX;
    const startWidth = kind === "filter" ? filterPaneWidth : signalPaneWidth;
    function move(moveEvent: PointerEvent) {
      const next = Math.max(kind === "filter" ? 235 : 270, Math.min(kind === "filter" ? 380 : 480, startWidth + moveEvent.clientX - startX));
      if (kind === "filter") setFilterPaneWidth(next);
      else setSignalPaneWidth(next);
    }
    function stop() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <button className="brand" onClick={() => changeView("library")} aria-label="Artemis signal library home">
          <span className="brand-mark"><span /></span>
          <span className="brand-copy"><strong>ARTEMIS</strong><small>RF REFERENCE</small></span>
        </button>

        <nav className="desktop-nav" aria-label="Primary navigation">
          <NavButton active={view === "library"} icon={<Library size={17} />} label="Signals" onClick={() => changeView("library")} />
          <NavButton active={view === "saved"} icon={<Bookmark size={17} />} label="Saved" badge={bookmarks.size} onClick={() => changeView("saved")} />
          <NavButton active={view === "weather"} icon={<CloudSun size={18} />} label="Space weather" onClick={() => changeView("weather")} />
        </nav>

        <div className="header-actions">
          <span className="mobile-catalog-count">{allSignals.length.toLocaleString()} SIGNALS</span>
          <span className="live-status">
            <span className={catalogError ? "error-dot" : "live-dot"} />
            {catalogLoading ? "CATALOG LOADING" : catalogError ? "CATALOG OFFLINE" : "DATABASE READY"}
          </span>
          <button className="database-button" disabled={!workspaceReady} onClick={() => setDatabaseOpen(true)}>
            <Database size={16} />
            <span>{activeDatabaseName} <b>v{activeDatabaseVersion}</b></span>
            <ChevronDown size={14} />
          </button>
          <button className="icon-button" disabled={!workspaceReady} onClick={() => setTagManagerOpen(true)} aria-label="Open tag manager"><Tags size={18} /></button>
          <button className="icon-button" disabled={!workspaceReady} onClick={() => setPreferencesOpen(true)} aria-label="Open preferences"><Settings size={18} /></button>
          <HelpDropdown updateAvailable={updateState === "available"} onCheckUpdates={checkUpdates} onOpenAbout={() => setAboutOpen(true)} />
        </div>
      </header>

      {view === "weather" ? (
        <Suspense fallback={<main className="weather-view"><div className="audio-empty">Loading the space-weather workspace…</div></main>}>
          <FullSpaceWeather data={weather} loading={weatherLoading} onRefresh={loadWeather} />
        </Suspense>
      ) : (
        <main
          className={cx("library-layout", mobileDetailOpen && "mobile-detail-is-open")}
          style={{ "--filter-pane-width": `${filterPaneWidth}px`, "--signal-pane-width": `${signalPaneWidth}px` } as React.CSSProperties}
        >
          <FilterWorkbench
            filters={filters}
            onChange={setFilters}
            categories={filterMetadata.options.categories}
            modulations={filterMetadata.options.modulations}
            locations={filterMetadata.options.locations}
            versions={filterMetadata.options.versions}
            counts={filterMetadata.counts}
            acfCount={filterMetadata.acfCount}
            resultCount={filteredSignals.length}
          />
          <button
            className="pane-splitter"
            aria-label="Resize filter panel"
            onPointerDown={(event) => startPaneResize("filter", event)}
          />

          <aside className="library-sidebar">
            <div className="sidebar-tools">
              <div className="search-box">
                <Search size={18} />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={view === "saved" ? "Search saved signals" : "Search all signals"}
                  aria-label="Search signal names and descriptions"
                />
                {query ? (
                  <button onClick={() => setQuery("")} aria-label="Clear search"><X size={15} /></button>
                ) : (
                  <kbd>/</kbd>
                )}
              </div>
            </div>

            <div className="results-heading">
              <span>
                <strong>{filteredSignals.length}</strong> {view === "saved" ? "saved" : "signals"}
              </span>
              {activeFilterCount ? <span>{activeFilterCount} FILTERS ACTIVE</span> : <span>NAME / FREQUENCY</span>}
            </div>

            <SignalList signals={filteredSignals} selectedId={selected?.pageid || ""} bookmarks={bookmarks} onSelect={selectSignal} />

            <button className="add-signal-button" disabled={!workspaceReady} onClick={() => { setEditorSignalId(null); setNewSignalOpen(true); }}>
              <Plus size={17} /> New signal
            </button>
          </aside>
          <button
            className="pane-splitter"
            aria-label="Resize signal list"
            onPointerDown={(event) => startPaneResize("signals", event)}
          />

          <div className="detail-workspace">
            {selected ? (
              <>
                <SignalDetail
                  signal={selected}
                  saved={bookmarks.has(selected.pageid)}
                  onToggleSaved={toggleBookmark}
                  onBack={closeMobileDetail}
                  onOpenDocuments={openDocuments}
                  onEdit={() => { if (workspaceReady) { setEditorSignalId(selected.pageid); setNewSignalOpen(true); } }}
                  onRemoveCategory={removeSelectedCategory}
                  onAddCategory={() => { if (workspaceReady) { setEditorSignalId(selected.pageid); setNewSignalOpen(true); } }}
                />
                <MediaPanel
                  signal={selected}
                  documents={selectedDocuments}
                  onOpenDocuments={openDocuments}
                  preferences={workspace.preferences}
                  onAudioSettingsChange={updateAudioSettings}
                />
              </>
            ) : (
              <div className="empty-detail">
                <Search size={30} />
                <strong>{catalogLoading ? "Loading signal catalog" : "No matching signal"}</strong>
                <span>{catalogError || "Adjust the persistent filters to bring signals back into view."}</span>
              </div>
            )}
          </div>
        </main>
      )}

      <nav className="mobile-nav" aria-label="Mobile navigation">
        <NavButton active={view === "library"} icon={<Library size={19} />} label="Signals" onClick={() => changeView("library")} />
        <NavButton active={view === "saved"} icon={<Bookmark size={19} />} label="Saved" badge={bookmarks.size} onClick={() => changeView("saved")} />
        <NavButton active={view === "weather"} icon={<CloudSun size={20} />} label="Weather" onClick={() => changeView("weather")} />
        <NavButton active={databaseOpen} icon={<Database size={19} />} label="Database" onClick={() => { if (workspaceReady) setDatabaseOpen(true); }} />
      </nav>

      <div className="app-status" role="status">
        <span className={catalogError ? "" : "status-ok"}>{catalogError ? "OFFLINE" : "READY"}</span>
        <strong>{activeDatabaseName} v{activeDatabaseVersion}</strong>
        <span>{allSignals.length.toLocaleString()} signals</span>
        <span>{activeFilterCount} active filters</span>
        <span>{weatherError || operationStatus}</span>
      </div>

      <Suspense fallback={null}>
        {documentsOpen && selected ? (
          <FullDocumentsManager
            signalName={selected.title}
            documents={managedDocuments}
            onClose={() => setDocumentsOpen(false)}
            onAdd={addDocument}
            onUpdate={updateDocument}
            onDelete={deleteDocument}
            onSetMain={setMainDocument}
          />
        ) : null}
        {databaseOpen ? (
          <FullDatabaseManager
            databases={managedDatabases}
            currentDatabaseId={workspace.activeDatabaseId}
            onClose={() => setDatabaseOpen(false)}
            onCreate={createDatabase}
            onLoad={(databaseId) => { loadDatabase(databaseId); setDatabaseOpen(false); }}
            onRename={renameDatabase}
            onDelete={deleteDatabase}
            onImport={importDatabase}
            onExport={exportDatabase}
            onCheckUpdates={checkUpdates}
            updateState={updateState}
            updateMessage={updateMessage}
          />
        ) : null}
        {newSignalOpen ? (
          <FullSignalEditor
            key={managedEditorSignal?.pageid || "new-signal"}
            signal={managedEditorSignal ? signalToManaged(managedEditorSignal) : null}
            categories={managedTags}
            onClose={() => { setNewSignalOpen(false); setEditorSignalId(null); }}
            onSave={saveManagedSignal}
            onDelete={managedEditorSignal ? deleteManagedSignal : undefined}
          />
        ) : null}
        {tagManagerOpen ? (
          <FullTagManager
            tags={managedTags}
            onClose={() => setTagManagerOpen(false)}
            onAdd={addTag}
            onRename={renameTag}
            onDelete={deleteTag}
          />
        ) : null}
        {preferencesOpen ? (
          <FullPreferences
            preferences={managedPreferences(workspace.preferences)}
            onClose={() => setPreferencesOpen(false)}
            onSave={savePreferences}
          />
        ) : null}
        {aboutOpen ? (
          <FullAbout onClose={() => setAboutOpen(false)} applicationVersion="1.0" databaseVersion={activeDatabaseVersion} />
        ) : null}
      </Suspense>
    </div>
  );
}
