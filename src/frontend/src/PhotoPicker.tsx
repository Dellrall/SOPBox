import type { ReactNode } from "react";
import { Camera, ImagePlus } from "lucide-react";
import { secondaryButton } from "./ui";

// Phones and tablets: there the camera option opens the camera straight away.
const touchDevice = () => typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;

/**
 * Two ways to add a photo: "Take photo" opens the back camera (phones and tablets only; a computer
 * has no use for it) and "Choose photo" opens the gallery or files. Both hand over the picked files.
 */
export function PhotoPicker({
  id,
  onFiles,
  multiple = false,
  disabled = false,
  takeLabel = "Take photo",
  chooseLabel = "Choose photo",
  takeClass,
  busy,
}: {
  id: string;
  onFiles: (files: File[]) => void;
  multiple?: boolean;
  disabled?: boolean;
  takeLabel?: string;
  chooseLabel?: string;
  /** Style of the main button: Take photo on a phone, Choose photo on a computer. */
  takeClass: string;
  /** Shown instead of the buttons while the photo is being read. */
  busy?: ReactNode;
}) {
  if (busy) return <span className={`${takeClass} pointer-events-none opacity-60`}>{busy}</span>;
  const camera = touchDevice();
  const off = disabled ? "pointer-events-none opacity-60" : "";
  const input = (suffix: string, capture: boolean) => (
    <input
      id={`${id}-${suffix}`}
      type="file"
      accept="image/*"
      {...(capture ? { capture: "environment" as const } : {})}
      multiple={multiple}
      disabled={disabled}
      className="sr-only"
      onChange={(e) => {
        const files = Array.from(e.currentTarget.files ?? []);
        e.currentTarget.value = ""; // so the same photo can be picked again
        if (files.length) onFiles(files);
      }}
    />
  );
  return (
    <span className="inline-flex flex-wrap items-center justify-center gap-2">
      {camera && (
        <>
          {input("camera", true)}
          <label htmlFor={`${id}-camera`} className={`${takeClass} cursor-pointer ${off}`}>
            <Camera aria-hidden className="h-4 w-4" /> {takeLabel}
          </label>
        </>
      )}
      {input("files", false)}
      <label htmlFor={`${id}-files`} className={`${camera ? secondaryButton : takeClass} cursor-pointer ${off}`}>
        <ImagePlus aria-hidden className="h-4 w-4" /> {chooseLabel}
      </label>
    </span>
  );
}
