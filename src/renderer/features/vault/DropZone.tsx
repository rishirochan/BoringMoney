import { useRef, useState } from "react";

export default function DropZone({
  hasVault,
  onFiles,
}: {
  hasVault: boolean;
  onFiles: (paths: string[]) => void;
}) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // Electron 44 removed File.path; the preload hands back the real path.
  const paths = (files: FileList | null) =>
    [...(files ?? [])].map(window.boringmoney.getFilePath).filter(Boolean);

  return (
    <>
      <button
        type="button"
        className={"dropzone" + (over ? " is-over" : "")}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          onFiles(paths(e.dataTransfer.files));
        }}
      >
        <span className="dropzone-title">
          {hasVault ? "Drop statements here" : "No storage folder yet"}
        </span>
        <span className="dropzone-hint">
          {hasVault
            ? "PDF or CSV — or click to browse"
            : "Choose a folder above, or drop files and we'll ask for one"}
        </span>
      </button>
      <input
        ref={input}
        type="file"
        multiple
        accept=".pdf,.csv"
        hidden
        onChange={(e) => {
          onFiles(paths(e.target.files));
          e.target.value = "";
        }}
      />
    </>
  );
}
