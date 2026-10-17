/// <reference types="vite/client" />

interface Window {
  __WORLD_EXECUTE_ME__?: {
    state: Record<string, unknown>;
    stage: unknown;
    ui: unknown;
    audio: unknown;
    enter: () => Promise<void>;
    seek: (time: number) => void;
    pause: () => void;
    play: () => Promise<void>;
    setCamera: (free: boolean) => void;
  };
}
