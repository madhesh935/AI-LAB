import React from 'react';
import { CameraFeed } from '../../types/retail';
import { Modal } from '../common/Modal';
import { CameraFeedCard } from '../dashboard/CameraFeedCard';

interface CameraPreviewModalProps {
  camera: CameraFeed | null;
  isOpen: boolean;
  onClose: () => void;
}

export const CameraPreviewModal: React.FC<CameraPreviewModalProps> = ({ camera, isOpen, onClose }) => {
  if (!isOpen || !camera) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${camera.name} — Live Edge Inference`}
      description={`Zone: ${camera.zone} • Resolution: ${camera.resolution}`}
      size="lg"
    >
      <div className="p-4 bg-slate-900">
        <CameraFeedCard feed={camera} />
      </div>
    </Modal>
  );
};
