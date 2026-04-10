import { useCallback, useState } from "react";

interface Props {
  onFile: (file: File) => void;
  accept: string;
}

export default function FileUpload({ onFile, accept }: Props) {
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={`flex flex-col items-center justify-center w-full h-48 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
        dragging ? "border-blue-400 bg-blue-50" : "border-gray-300 hover:border-gray-400"
      }`}
    >
      <p className="text-gray-500 text-sm">Drag & drop a recipe PDF or photo here</p>
      <p className="text-gray-400 text-xs mt-1">or click to browse</p>
      <input
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
      />
    </label>
  );
}
