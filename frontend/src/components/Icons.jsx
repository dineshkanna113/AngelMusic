const Svg = ({ children, className = "h-5 w-5", ...rest }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className} {...rest}>
    {children}
  </svg>
);

export const PlayIcon = (p) => <Svg {...p}><path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14Z" /></Svg>;
export const PauseIcon = (p) => <Svg {...p}><path d="M7 4h3.5v16H7zM13.5 4H17v16h-3.5z" /></Svg>;
export const NextIcon = (p) => <Svg {...p}><path d="M5 5.5v13a.75.75 0 0 0 1.15.63L15.5 13v5.25h2.5V5.75h-2.5V11L6.15 4.87A.75.75 0 0 0 5 5.5Z" /></Svg>;
export const PrevIcon = (p) => <Svg {...p}><path d="M19 5.5v13a.75.75 0 0 1-1.15.63L8.5 13v5.25H6V5.75h2.5V11l9.35-6.13A.75.75 0 0 1 19 5.5Z" /></Svg>;
export const ShuffleIcon = (p) => <Svg {...p}><path d="M16 3h5v5l-1.8-1.8-4.1 4.1-1.4-1.4 4.1-4.1L16 3ZM3 5.6 4.4 4.2l15.4 15.4V18h1.2v3h-5v-1.2h1.6L3 5.6Zm6.3 7.7 1.4 1.4-6.3 6.3L3 19.6l6.3-6.3Z" /></Svg>;
export const RepeatIcon = (p) => <Svg {...p}><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7Zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4Z" /></Svg>;
export const VolumeIcon = (p) => <Svg {...p}><path d="M3 9v6h4l5 5V4L7 9H3Zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.47 4.47 0 0 0 2.5-4ZM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06A9 9 0 0 0 14 3.23Z" /></Svg>;
export const MuteIcon = (p) => <Svg {...p}><path d="M3 9v6h4l5 5V4L7 9H3Zm18.1 3 2.4-2.4-1.4-1.4-2.4 2.4-2.4-2.4-1.4 1.4 2.4 2.4-2.4 2.4 1.4 1.4 2.4-2.4 2.4 2.4 1.4-1.4-2.4-2.4Z" /></Svg>;
export const SearchIcon = (p) => <Svg {...p}><path d="M10 2a8 8 0 0 1 6.32 12.9l5.39 5.4-1.42 1.4-5.39-5.38A8 8 0 1 1 10 2Zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z" /></Svg>;
export const WaveIcon = (p) => <Svg {...p}><path d="M3 10h2v4H3zm4-3h2v10H7zm4-4h2v18h-2zm4 4h2v10h-2zm4 3h2v4h-2z" /></Svg>;
export const DiscIcon = (p) => <Svg {...p}><path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm0 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm0 2a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z" /></Svg>;
export const HeartIcon = (p) => <Svg {...p}><path d="M12 21s-7.5-4.6-10-9.2C.4 8.6 2.2 4.5 6 4.5c2.2 0 3.6 1.2 4.4 2.4h.2C11.4 5.7 12.8 4.5 15 4.5c3.8 0 5.6 4.1 4 7.3C19.5 16.4 12 21 12 21Z" /></Svg>;
export const HeartOutlineIcon = (p) => <Svg {...p}><path d="M16.5 4.5c-1.9 0-3.4 1-4.5 2.4C10.9 5.5 9.4 4.5 7.5 4.5 4.4 4.5 2 7 2 10.1c0 4.4 4.6 8.1 9.4 11.6l.6.4.6-.4c4.8-3.5 9.4-7.2 9.4-11.6 0-3.1-2.4-5.6-5.5-5.6Zm-4.5 15C7.9 16.5 4 13.4 4 10.1 4 8.1 5.6 6.5 7.5 6.5c1.5 0 2.7.9 3.5 2.3h2c.8-1.4 2-2.3 3.5-2.3 1.9 0 3.5 1.6 3.5 3.6 0 3.3-3.9 6.4-8 9.4Z" /></Svg>;
export const QueueIcon = (p) => <Svg {...p}><path d="M3 5h12v2H3zm0 4h12v2H3zm0 4h8v2H3zm13 0v6l5-3-5-3Z" /></Svg>;
export const LyricsIcon = (p) => <Svg {...p}><path d="M4 4h16v12H7l-3 3V4Zm3 4v2h10V8H7Zm0 3v2h7v-2H7Z" /></Svg>;
export const MoreIcon = (p) => <Svg {...p}><path d="M5 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z" /></Svg>;
export const PlusIcon = (p) => <Svg {...p}><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z" /></Svg>;
export const DownloadIcon = (p) => <Svg {...p}><path d="M11 4h2v8.2l3.3-3.3 1.4 1.4L12 16l-5.7-5.7 1.4-1.4 3.3 3.3V4ZM5 18h14v2H5v-2Z" /></Svg>;
export const CheckIcon = (p) => <Svg {...p}><path d="m9.5 16.2-4.2-4.2-1.4 1.4 5.6 5.6L21 7.5 19.6 6.1 9.5 16.2Z" /></Svg>;
export const TrashIcon = (p) => <Svg {...p}><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 12H7L6 9Zm4 2v8h1.5v-8H10Zm2.5 0v8H14v-8h-1.5Z" /></Svg>;
export const HomeIcon = (p) => <Svg {...p}><path d="M12 3 2 11h3v9h5v-6h4v6h5v-9h3L12 3Z" /></Svg>;
export const SongsIcon = (p) => <Svg {...p}><path d="M9 3v10.6A3.5 3.5 0 1 0 11 17V8h6V3H9Z" /></Svg>;
export const AlbumIcon = (p) => <Svg {...p}><path d="M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm8 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0 4a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z" /></Svg>;
export const ArtistIcon = (p) => <Svg {...p}><path d="M12 3a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Zm0 11c4.4 0 8 2 8 4.5V21H4v-2.5C4 16 7.6 14 12 14Z" /></Svg>;
export const PlaylistIcon = (p) => <Svg {...p}><path d="M3 6h12v2H3zm0 4h12v2H3zm0 4h8v2H3zm14-4v5.6a2.5 2.5 0 1 0 2 2.4V12h2v-2h-4Z" /></Svg>;
export const OfflineIcon = (p) => <Svg {...p}><path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm-1 5v6.2l-2.3-2.3-1.4 1.4L12 17l4.7-4.7-1.4-1.4-2.3 2.3V7h-2Z" /></Svg>;
export const SettingsIcon = (p) => <Svg {...p}><path d="m19.4 13 .1-1-.1-1 2.1-1.6-2-3.5-2.5 1a7 7 0 0 0-1.7-1l-.4-2.6h-4l-.4 2.7a7 7 0 0 0-1.7 1l-2.5-1-2 3.4L4.6 11l-.1 1 .1 1-2.1 1.6 2 3.5 2.5-1c.5.4 1.1.7 1.7 1l.4 2.7h4l.4-2.7c.6-.3 1.2-.6 1.7-1l2.5 1 2-3.5-2.1-1.6ZM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z" /></Svg>;
export const MoonIcon = (p) => <Svg {...p}><path d="M14.5 2.5A9.5 9.5 0 1 0 21.5 17 8 8 0 0 1 14.5 2.5Z" /></Svg>;
export const CloseIcon = (p) => <Svg {...p}><path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6 10.6 12 5 6.4 6.4 5Z" /></Svg>;
export const DragIcon = (p) => <Svg {...p}><path d="M8 5h2v2H8zm6 0h2v2h-2zM8 11h2v2H8zm6 0h2v2h-2zm-6 6h2v2H8zm6 0h2v2h-2z" /></Svg>;
export const UpIcon = (p) => <Svg {...p}><path d="m12 7 6 6-1.4 1.4-4.6-4.6-4.6 4.6L6 13l6-6Z" /></Svg>;
export const DownIcon = (p) => <Svg {...p}><path d="m12 17-6-6 1.4-1.4 4.6 4.6 4.6-4.6L18 11l-6 6Z" /></Svg>;
export const SpeakerIcon = (p) => <Svg {...p}><path d="M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm5 2.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm0 5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Zm0 2.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z" /></Svg>;
export const RadioIcon = (p) => <Svg {...p}><path d="M12 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM7.05 7.05l1.41 1.41a5 5 0 0 0 0 7.08l-1.41 1.41a7 7 0 0 1 0-9.9Zm9.9 0a7 7 0 0 1 0 9.9l-1.41-1.41a5 5 0 0 0 0-7.08l1.41-1.41ZM4.22 4.22l1.42 1.42a9 9 0 0 0 0 12.72l-1.42 1.42a11 11 0 0 1 0-15.56Zm15.56 0a11 11 0 0 1 0 15.56l-1.42-1.42a9 9 0 0 0 0-12.72l1.42-1.42Z" /></Svg>;
export const UploadIcon = (p) => <Svg {...p}><path d="M11 16h2V7.8l3.3 3.3 1.4-1.4L12 4 6.3 9.7l1.4 1.4L11 7.8V16Zm-6 2h14v2H5v-2Z" /></Svg>;
