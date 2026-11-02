import { useEffect, useState } from "react";
import { growth } from "./growth";
import { useSession } from "./hooks";

let studioCache = null;

/** The artists this user manages (admins manage all, so they get `null` meaning "any"). */
export function useStudioArtists() {
  const session = useSession();
  const [artists, setArtists] = useState(studioCache);
  useEffect(() => {
    if (!session) return;
    growth.studio().then((list) => { studioCache = list; setArtists(list); }).catch(() => setArtists([]));
  }, [session?.user?.id]);
  return artists;
}
