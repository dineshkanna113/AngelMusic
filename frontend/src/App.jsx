import { useEffect, useRef } from "react";
import Login from "./components/Login";
import PlayerBar from "./components/PlayerBar";
import { MobileNav, Sidebar, Toasts, TopBar } from "./components/Shell";
import SidePanel from "./components/SidePanels";
import { api, auth } from "./lib/api";
import { useSession, useStreamTokenRefresh } from "./lib/hooks";
import { library } from "./lib/library";
import { player } from "./lib/player";
import { useRoute } from "./lib/router";
import { AlbumView, Albums, ArtistView, Artists, Favorites } from "./views/Albums";
import Downloads from "./views/Downloads";
import Home from "./views/Home";
import { MixView } from "./views/Mixes";
import { PlaylistView, Playlists, Recent } from "./views/Playlists";
import Search from "./views/Search";
import Review from "./views/Review";
import Settings from "./views/Settings";
import Songs from "./views/Songs";
import Upload from "./views/Upload";

function View() {
  const { section, params } = useRoute();
  switch (section) {
    case "songs": return <Songs />;
    case "albums": return <Albums />;
    case "album": return <AlbumView id={params[0]} />;
    case "artists": return <Artists />;
    case "artist": return <ArtistView id={params[0]} />;
    case "favorites": return <Favorites />;
    case "playlists": return <Playlists />;
    case "playlist": return <PlaylistView id={params[0]} />;
    case "recent": return <Recent />;
    case "mix": return <MixView id={params[0]} />;
    case "search": return <Search query={params[0] ?? ""} />;
    case "downloads": return <Downloads />;
    case "settings": return <Settings />;
    case "upload": return <Upload />;
    case "review": return <Review />;
    default: return <Home />;
  }
}

function Authenticated() {
  const { path } = useRoute();
  const mainRef = useRef(null);
  const footerRef = useRef(null);
  useStreamTokenRefresh();

  useEffect(() => {
    player.onPlayed = (id) => library.recordPlay(id);
    // Roles can change while a session is open (e.g. an admin grants upload access).
    api("/api/auth/me").then((user) => auth.updateUser(user)).catch(() => {});
    library.load().then((tracks) => tracks && player.restore(tracks));
    const reload = () => library.load();
    window.addEventListener("online", reload);
    return () => {
      window.removeEventListener("online", reload);
      player.onPlayed = null;
    };
  }, []);

  // New page → start at the top.
  useEffect(() => {
    if (!path.startsWith("/search")) mainRef.current?.scrollTo(0, 0);
  }, [path]);

  // Expose the footer height so overlay panels on small screens stop above it.
  useEffect(() => {
    const el = footerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty("--player-h", `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="flex h-dvh flex-col bg-surface-0">
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main ref={mainRef} className="min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-5 md:px-6">
            <View />
          </main>
        </div>
        <SidePanel />
      </div>
      <footer ref={footerRef}>
        <PlayerBar />
        <MobileNav />
      </footer>
      <Toasts />
    </div>
  );
}

export default function App() {
  const session = useSession();
  // Keyed by user so logging in as someone else starts from a clean tree.
  return session ? <Authenticated key={session.user.id} /> : <Login />;
}
