// App icons: Phosphor (MIT), wrapped so call sites keep their names and Tailwind sizing.
import {
  ArrowCircleDownIcon, CaretDownIcon, CompassIcon, CaretUpIcon, CheckIcon as PhCheck, DiscIcon as PhDisc, DotsSixVerticalIcon,
  DotsThreeIcon, DownloadSimpleIcon, GearSixIcon, HeartIcon as PhHeart, HouseIcon, MagnifyingGlassIcon,
  MicrophoneStageIcon, MoonIcon as PhMoon, MusicNoteIcon, PauseIcon as PhPause, PlayIcon as PhPlay, PlaylistIcon as PhPlaylist,
  PlusIcon as PhPlus, QueueIcon as PhQueue, RadioIcon as PhRadio, RepeatIcon as PhRepeat, ShareFatIcon, ShuffleIcon as PhShuffle,
  SkipBackIcon, SkipForwardIcon, SpeakerHifiIcon, SpeakerHighIcon, SpeakerSlashIcon, TrashIcon as PhTrash,
  UploadSimpleIcon, UserIcon, UsersThreeIcon, VinylRecordIcon, WaveformIcon, XIcon,
} from "@phosphor-icons/react";

const make = (Comp, weight = "regular") => {
  const Icon = ({ className = "h-5 w-5", weight: w, ...rest }) => (
    <Comp weight={w ?? weight} className={className} aria-hidden="true" focusable="false" {...rest} />
  );
  Icon.displayName = Comp.displayName;
  return Icon;
};

// Playback controls are solid so they read at small sizes.
export const PlayIcon = make(PhPlay, "fill");
export const PauseIcon = make(PhPause, "fill");
export const NextIcon = make(SkipForwardIcon, "fill");
export const PrevIcon = make(SkipBackIcon, "fill");
export const ShuffleIcon = make(PhShuffle, "bold");
export const RepeatIcon = make(PhRepeat, "bold");
export const VolumeIcon = make(SpeakerHighIcon, "fill");
export const MuteIcon = make(SpeakerSlashIcon, "fill");
export const SearchIcon = make(MagnifyingGlassIcon, "bold");
export const WaveIcon = make(WaveformIcon, "bold");
export const DiscIcon = make(PhDisc, "duotone");
export const HeartIcon = make(PhHeart, "fill");
export const HeartOutlineIcon = make(PhHeart, "bold");
export const QueueIcon = make(PhQueue, "bold");
export const LyricsIcon = make(MicrophoneStageIcon, "bold");
export const MoreIcon = make(DotsThreeIcon, "bold");
export const PlusIcon = make(PhPlus, "bold");
export const DownloadIcon = make(DownloadSimpleIcon, "bold");
export const CheckIcon = make(PhCheck, "bold");
export const TrashIcon = make(PhTrash, "bold");
// Navigation uses the fill weight, like stickers.
export const HomeIcon = make(HouseIcon, "fill");
export const SongsIcon = make(MusicNoteIcon, "fill");
export const AlbumIcon = make(VinylRecordIcon, "fill");
export const ArtistIcon = make(UserIcon, "fill");
export const PlaylistIcon = make(PhPlaylist, "fill");
export const OfflineIcon = make(ArrowCircleDownIcon, "fill");
export const SettingsIcon = make(GearSixIcon, "fill");
export const BrowseIcon = make(CompassIcon, "fill");
export const FriendsIcon = make(UsersThreeIcon, "fill");
export const UploadIcon = make(UploadSimpleIcon, "bold");
export const MoonIcon = make(PhMoon, "fill");
export const CloseIcon = make(XIcon, "bold");
export const DragIcon = make(DotsSixVerticalIcon, "bold");
export const UpIcon = make(CaretUpIcon, "bold");
export const DownIcon = make(CaretDownIcon, "bold");
export const SpeakerIcon = make(SpeakerHifiIcon, "fill");
export const RadioIcon = make(PhRadio, "fill");
export const ShareIcon = make(ShareFatIcon, "fill");
