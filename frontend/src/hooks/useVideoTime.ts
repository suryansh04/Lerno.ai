import { useCallback, useSyncExternalStore } from "react";

const EVENTS = ["timeupdate", "seeked", "loadedmetadata", "emptied"];

// Reads one value from the video's time where it is shown, so only that small part re-renders, and only when the
// value changes: the whole page re-rendering on every time update made the player and the scenes lag.
export default function useVideoTime<T extends number | boolean>(
  video: HTMLVideoElement | null,
  read: (video: HTMLVideoElement) => T,
  fallback: T,
  // timeupdate comes about four times a second, too slow for spoken words; a frame callback runs only while playing.
  everyFrame = false,
) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      EVENTS.forEach((event) => video?.addEventListener(event, onChange));
      let frame = 0;
      const onFrame = () => {
        onChange();
        frame = video!.requestVideoFrameCallback(onFrame);
      };
      if (everyFrame && video && "requestVideoFrameCallback" in video) frame = video.requestVideoFrameCallback(onFrame);
      return () => {
        EVENTS.forEach((event) => video?.removeEventListener(event, onChange));
        if (frame) video?.cancelVideoFrameCallback(frame);
      };
    },
    [video, everyFrame],
  );
  return useSyncExternalStore(subscribe, () => (video ? read(video) : fallback));
}
