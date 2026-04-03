import React, { useId, useMemo, useRef, useState } from 'react';
import { FileAudio, UploadCloud } from 'lucide-react';

interface UploadDropzoneProps {
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  file?: File | null;
  files?: File[];
  label?: string;
  hint?: string;
  dragLabel?: string;
  className?: string;
  onFilesSelected: (files: File[]) => void;
}

const fileKey = (file: File): string => `${file.name}_${file.size}_${file.lastModified}`;

export const UploadDropzone: React.FC<UploadDropzoneProps> = ({
  accept,
  multiple = false,
  disabled = false,
  file = null,
  files,
  label = 'Upload file',
  hint = 'Click to browse or drag and drop',
  dragLabel = 'Drop to upload',
  className = '',
  onFilesSelected,
}) => {
  const [isDragActive, setIsDragActive] = useState(false);
  const inputId = useId();
  const hintId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const selectedFiles = useMemo(() => {
    if (Array.isArray(files)) return files.filter(Boolean);
    if (file) return [file];
    return [];
  }, [file, files]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLLabelElement>): void => {
    if (disabled) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    inputRef.current?.click();
  };

  const handleFiles = (list: FileList | null): void => {
    if (!list || disabled) return;
    const incoming = Array.from(list);
    if (incoming.length === 0) return;
    if (multiple) {
      onFilesSelected(incoming);
      return;
    }
    const first = incoming[0];
    if (first) {
      onFilesSelected([first]);
    }
  };

  return (
    <label
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-describedby={hintId}
      aria-disabled={disabled}
      onKeyDown={handleKeyDown}
      onDragOver={(event) => {
        if (disabled) return;
        event.preventDefault();
        setIsDragActive(true);
      }}
      onDragEnter={(event) => {
        if (disabled) return;
        event.preventDefault();
        setIsDragActive(true);
      }}
      onDragLeave={(event) => {
        if (disabled) return;
        event.preventDefault();
        const related = event.relatedTarget as Node | null;
        if (!related || !event.currentTarget.contains(related)) {
          setIsDragActive(false);
        }
      }}
      onDrop={(event) => {
        if (disabled) return;
        event.preventDefault();
        setIsDragActive(false);
        handleFiles(event.dataTransfer?.files || null);
      }}
      className={`vf-upload-dropzone relative overflow-hidden rounded-xl border-2 border-dashed px-4 py-4 text-center transition-[background-color,border-color,color,box-shadow,transform,opacity,filter] focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
        isDragActive
          ? 'vf-upload-dropzone--active border-indigo-400 bg-indigo-50/70'
          : 'border-gray-200 bg-gray-50'
      } ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-gray-100/80'} ${className}`}
    >
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={(event) => {
          handleFiles(event.currentTarget.files);
          event.currentTarget.value = '';
        }}
        aria-label={label}
        aria-describedby={hintId}
        aria-disabled={disabled}
        tabIndex={-1}
        className="sr-only"
        disabled={disabled}
      />

      {selectedFiles.length > 0 ? (
        <div className="space-y-1">
          <span className="sr-only">{label}</span>
          <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-bold text-indigo-700 shadow-sm">
            <FileAudio size={14} />
            {selectedFiles.length === 1 ? selectedFiles[0]?.name || 'Selected file' : `${selectedFiles.length} files selected`}
          </div>
          {selectedFiles.length > 1 && (
            <div className="mx-auto max-h-20 max-w-sm overflow-y-auto text-left text-[11px] text-gray-600 custom-scrollbar">
              {selectedFiles.map((current) => (
                <div key={fileKey(current)} className="truncate">
                  {current.name}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-1">
          <UploadCloud
            size={18}
            className={`mx-auto text-gray-400 transition-transform ${isDragActive ? 'animate-bounce text-indigo-500' : ''}`}
          />
          <p className="text-xs font-bold text-gray-600">{isDragActive ? dragLabel : label}</p>
          <p id={hintId} className="text-[11px] text-gray-400">{hint}</p>
        </div>
      )}
    </label>
  );
};
