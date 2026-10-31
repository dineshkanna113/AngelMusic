import { useEffect, useState } from "react";
import { api, auth } from "../lib/api";
import { useSession } from "../lib/hooks";
import { library, useLibrary } from "../lib/library";
import { player } from "../lib/player";
import { href, navigate, useRoute } from "../lib/router";
import { useToasts } from "../lib/toast";
import {
  AlbumIcon, ArtistIcon, CheckIcon, HeartIcon, HomeIcon, OfflineIcon, PlaylistIcon, PlusIcon, SearchIcon, SettingsIcon,
  SongsIcon, UploadIcon, WaveIcon,
} from "./Icons";
import { Menu, MenuItem } from "./Menu";
import { newPlaylistWith } from "./TrackMenu";

const NAV = [
  ["", "Home", HomeIcon],
  ["songs", "Songs", SongsIcon],
  ["albums", "Albums", AlbumIcon],
  ["artists", "Artists", ArtistIcon],
  ["favorites", "Favorites", HeartIcon],
  ["playlists", "Playlists", PlaylistIcon],
  ["downloads", "Downloads", OfflineIcon],
];

/** Pending-review count for the admin badge, refreshed every minute and on navigation. */
function usePendingCount(enabled, section) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const load = () => api("/api/uploads?scope=all&status=pending&limit=1")
      .then((d) => setCount(d.counts.pending ?? 0)).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [enabled, section]);
  return count;
}

function NavLink({ to, label, icon: Icon, active, compact = false, badge = 0 }) {
  return (
    <a
      href={href(...(to ? [to] : []))}
      aria-current={active ? "page" : undefined}
      className={
        compact
          ? `flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[10px] ${active ? "text-accent" : "text-muted"}`
          : `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
              active ? "bg-surface-2 font-medium text-fg" : "text-muted hover:bg-surface-2 hover:text-fg"
            }`
      }
    >
      <Icon className={compact ? "h-5 w-5" : "h-4 w-4"} />
      {label}
      {badge > 0 && <span className="ml-auto rounded-full bg-gold/20 px-1.5 text-[10px] font-semibold text-gold">{badge}</span>}
    </a>
  );
}

export function Sidebar() {
  const { section, params } = useRoute();
  const { playlists } = useLibrary();
  const user = useSession()?.user;
  const pending = usePendingCount(user?.is_admin, section);
  useEffect(() => {
    library.loadPlaylists();
  }, []);
  return (
    <nav aria-label="Main" className="hidden w-60 shrink-0 flex-col gap-1 overflow-y-auto border-r border-line bg-surface-1/50 p-3 md:flex">
      <a href="#/" className="mb-4 flex items-center gap-2 px-3 pt-1">
        <WaveIcon className="h-5 w-5 text-accent" />
        <span className="font-semibold tracking-tight">AngelStream</span>
      </a>
      {NAV.map(([to, label, Icon]) => (
        <NavLink key={to} to={to} label={label} icon={Icon} active={section === to} />
      ))}
      {user?.can_upload && <NavLink to="upload" label="Upload" icon={UploadIcon} active={section === "upload"} />}
      {user?.is_admin && <NavLink to="review" label="Review" icon={CheckIcon} active={section === "review"} badge={pending} />}
      <div className="mt-5 flex items-center justify-between px-3">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Your playlists</span>
        <button type="button" aria-label="New playlist" onClick={() => newPlaylistWith([])}
          className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-surface-2 hover:text-fg">
          <PlusIcon className="h-4 w-4" />
        </button>
      </div>
      <ul className="mt-1">
        {(playlists ?? []).map((pl) => (
          <li key={pl.id}>
            <a
              href={href("playlist", pl.id)}
              className={`block truncate rounded-md px-3 py-1.5 text-sm ${
                section === "playlist" && params[0] === String(pl.id) ? "bg-surface-2 text-fg" : "text-muted hover:text-fg"
              }`}
            >
              {pl.name}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function MobileNav() {
  const { section } = useRoute();
  return (
    <nav aria-label="Main" className="flex border-t border-line bg-surface-1 md:hidden">
      {[NAV[0], NAV[1], NAV[2], NAV[5], ["settings", "Settings", SettingsIcon]].map(([to, label, Icon]) => (
        <NavLink key={to} to={to} label={label} icon={Icon} active={section === to} compact />
      ))}
    </nav>
  );
}

export function TopBar() {
  const { section, params } = useRoute();
  const session = useSession();
  const { offlineMode, scanning } = useLibrary();
  const routeQuery = section === "search" ? params[0] ?? "" : "";
  const [query, setQuery] = useState(routeQuery);

  useEffect(() => setQuery(routeQuery), [routeQuery]);

  const onChange = (value) => {
    setQuery(value);
    if (value.trim()) {
      // Replace rather than push so typing doesn't flood the back button history.
      const target = `#/search/${encodeURIComponent(value)}`;
      if (section === "search") {
        window.history.replaceState(null, "", target);
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      } else {
        window.location.hash = target.slice(1);
      }
    } else if (section === "search") {
      navigate("");
    }
  };

  return (
    <header className="flex items-center gap-3 border-b border-line px-4 py-2.5">
      <label className="relative w-full max-w-md">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          id="global-search"
          type="search"
          placeholder="Search songs, albums, artists…  ( / )"
          value={query}
          onChange={(e) => onChange(e.target.value)}
          className="input pl-9"
          aria-label="Search library"
        />
      </label>
      <div className="ml-auto flex items-center gap-2 text-sm">
        {offlineMode && <span className="rounded bg-gold/15 px-2 py-0.5 text-xs text-gold">Offline</span>}
        {scanning && <span className="text-xs text-muted">Scanning…</span>}
        <Menu
          label="Account"
          trigger={<span className="grid h-8 w-8 place-items-center rounded-full bg-surface-3 text-xs font-semibold uppercase">{session?.user?.username?.[0]}</span>}
          className="rounded-full"
        >
          {(close) => (
            <>
              <div className="px-3 py-2 text-xs text-muted">Signed in as <span className="text-fg">{session?.user?.username}</span></div>
              <MenuItem icon={SettingsIcon} close={close} onSelect={() => navigate("settings")}>Settings</MenuItem>
              <MenuItem icon={SongsIcon} close={close} onSelect={() => navigate("recent")}>Recently played</MenuItem>
              {session?.user?.can_upload && <MenuItem icon={UploadIcon} close={close} onSelect={() => navigate("upload")}>Upload music</MenuItem>}
              {session?.user?.is_admin && <MenuItem icon={CheckIcon} close={close} onSelect={() => navigate("review")}>Review uploads</MenuItem>}
              <MenuItem close={close} onSelect={() => { player.reset(); library.reset(); auth.logout(); }}>Sign out</MenuItem>
            </>
          )}
        </Menu>
      </div>
    </header>
  );
}

export function Toasts() {
  const toasts = useToasts();
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-3 z-[70] flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div key={t.id} role={t.tone === "error" ? "alert" : "status"}
          className={`pointer-events-auto max-w-md rounded-lg px-4 py-2 text-sm shadow-xl ${
            t.tone === "error" ? "bg-danger text-white" : "bg-fg text-surface-0"
          }`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
