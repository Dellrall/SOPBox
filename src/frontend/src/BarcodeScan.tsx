import { useEffect, useRef, useState } from "react";
import { ScanBarcode, X } from "lucide-react";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";

type Detector = { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> };

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code"];

/** The phone's own barcode reader where it has one (Android Chrome), else ZXing loaded from this site. */
async function makeDetector(): Promise<Detector> {
  const native = (window as { BarcodeDetector?: { new (o: object): Detector; getSupportedFormats(): Promise<string[]> } })
    .BarcodeDetector;
  if (native && (await native.getSupportedFormats()).includes("ean_13")) return new native({ formats: FORMATS });
  const { BarcodeDetector, prepareZXingModule } = await import("barcode-detector/ponyfill");
  // Served from this site: the CSP allows no other origin.
  prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path) } });
  return new BarcodeDetector({ formats: FORMATS as never }) as unknown as Detector;
}

/** A button that opens the back camera and hands back the first barcode it reads. */
export function ScanButton({ onCode, label = "Scan barcode" }: { onCode: (code: string) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={() => setOpen(true)}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white text-brand-700 ring-1 ring-line hover:bg-brand-50"
      >
        <ScanBarcode aria-hidden className="h-5 w-5" />
      </button>
      {open && (
        <Scanner
          onClose={() => setOpen(false)}
          onCode={(code) => {
            setOpen(false);
            onCode(code);
          }}
        />
      )}
    </>
  );
}

function Scanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const done = useRef(onCode);
  done.current = onCode;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (stopped) return stream.getTracks().forEach((t) => t.stop());
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        const detector = await makeDetector();
        const look = async () => {
          if (stopped) return;
          const found = v.readyState >= 2 ? await detector.detect(v).catch(() => []) : [];
          const code = found[0]?.rawValue.trim();
          if (code) done.current(code);
          else timer = window.setTimeout(look, 200);
        };
        void look();
      } catch {
        setError("Could not open the camera. Allow camera access, or type the code instead.");
      }
    })();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div role="dialog" aria-modal aria-label="Scan a barcode" className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex items-center justify-between p-3 text-white">
        <p className="text-sm font-semibold">Point the camera at the barcode</p>
        <button type="button" aria-label="Close" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-full bg-white/15">
          <X aria-hidden className="h-5 w-5" />
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        <video ref={video} muted playsInline className="h-full w-full object-cover" />
        <div aria-hidden className="pointer-events-none absolute inset-x-8 top-1/2 h-32 -translate-y-1/2 rounded-2xl ring-2 ring-white/80" />
      </div>
      {error && <p role="alert" className="bg-white p-4 text-sm text-red-700">{error}</p>}
    </div>
  );
}
