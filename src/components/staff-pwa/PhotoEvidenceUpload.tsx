import React, { useState, useRef } from 'react';
import { Camera, Upload, X, Check, Image as ImageIcon } from 'lucide-react';

interface PhotoEvidenceUploadProps {
  onPhotoSelected: (dataUrl: string) => void;
  onClear: () => void;
  existingPhotoUrl?: string;
}

export const PhotoEvidenceUpload: React.FC<PhotoEvidenceUploadProps> = ({
  onPhotoSelected,
  onClear,
  existingPhotoUrl,
}) => {
  const [photoPreview, setPhotoPreview] = useState<string | null>(existingPhotoUrl || null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        setPhotoPreview(result);
        onPhotoSelected(result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSimulateCapture = () => {
    // High-fidelity operational shelf restock photo simulation
    const sampleShelfPhoto =
      'https://images.unsplash.com/photo-1542838132-92c53300491e?w=600&auto=format&fit=crop&q=80';
    setPhotoPreview(sampleShelfPhoto);
    onPhotoSelected(sampleShelfPhoto);
  };

  const handleRemove = () => {
    setPhotoPreview(null);
    onClear();
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
          <Camera className="h-3.5 w-3.5 text-blue-600" />
          <span>Restock / Operational Proof (Optional)</span>
        </label>
        <span className="text-[11px] text-slate-400 font-medium">Privacy Protected</span>
      </div>

      {photoPreview ? (
        <div className="relative rounded-2xl overflow-hidden border border-slate-200 bg-slate-900/5 aspect-video flex items-center justify-center">
          <img
            src={photoPreview}
            alt="Work verification evidence"
            className="w-full h-full object-cover"
          />
          <button
            type="button"
            onClick={handleRemove}
            className="absolute top-2 right-2 p-1.5 rounded-full bg-slate-900/70 text-white hover:bg-slate-900 transition-colors"
            title="Remove photo"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="absolute bottom-2 left-2 bg-emerald-600/90 text-white text-[11px] font-bold px-2 py-0.5 rounded-full backdrop-blur-xs flex items-center gap-1">
            <Check className="h-3 w-3" />
            Evidence Attached
          </div>
        </div>
      ) : (
        <div className="border border-dashed border-slate-300 rounded-2xl p-4 text-center bg-slate-50/60 hover:bg-slate-50 transition-colors">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileChange}
            className="hidden"
          />
          <div className="flex flex-col items-center justify-center gap-2">
            <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
              <Camera className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-800">
                Take photo or attach verification image
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Photo of the shelf or equipment. Please keep people out of the shot.
              </p>
            </div>
            <div className="flex gap-2 mt-1">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-xs font-semibold px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 flex items-center gap-1"
              >
                <Upload className="h-3 w-3 text-slate-400" />
                <span>Upload File</span>
              </button>
              <button
                type="button"
                onClick={handleSimulateCapture}
                className="text-xs font-bold px-3 py-1.5 rounded-xl bg-blue-600 text-white hover:bg-blue-700 flex items-center gap-1"
              >
                <Camera className="h-3 w-3" />
                <span>Capture Camera</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
