import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';

interface ScannerModalProps {
  open: boolean;
  onClose: () => void;
  onDetected: (value: string) => void;
}

interface BarcodeResult { rawValue?: string; }
interface BarcodeDetectorLike { detect: (source: HTMLVideoElement) => Promise<BarcodeResult[]>; }
interface BarcodeDetectorConstructor { new (): BarcodeDetectorLike; }

export function ScannerModal({ open, onClose, onDetected }: ScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [manualValue, setManualValue] = useState('');
  const [status, setStatus] = useState('Initializing camera...');

  useEffect(() => {
    if (!open) return undefined;
    let frame = 0;
    let active = true;
    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (!active) { stream.getTracks().forEach((track) => track.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        const Detector = (window as Window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
        if (!Detector) { setStatus('Camera active. Enter a value manually if barcode detection is unavailable.'); return; }
        setStatus('Point camera at QR code or barcode');
        const detector = new Detector();
        const detect = async () => {
          if (!active || !videoRef.current) return;
          try {
            const results = await detector.detect(videoRef.current);
            const value = results[0]?.rawValue;
            if (value) { onDetected(value); return; }
          } catch {
            setStatus('Unable to read barcode. You can enter the value manually.');
          }
          frame = requestAnimationFrame(() => void detect());
        };
        frame = requestAnimationFrame(() => void detect());
      } catch (error) {
        setStatus(error instanceof Error ? `Camera error: ${error.message}` : 'Camera permission was denied.');
      }
    };
    void start();
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [open, onDetected]);

  return (
    <Modal open={open} title="Scan QR / Barcode" maxWidth={520} onClose={onClose}>
      <video ref={videoRef} className="scanner-video" autoPlay playsInline muted />
      <p className="scanner-status">{status}</p>
      <div className="scanner-manual">
        <label>Manual value<input value={manualValue} onChange={(event) => setManualValue(event.target.value)} autoFocus={!open} /></label>
        <button className="btn-primary" disabled={!manualValue.trim()} onClick={() => onDetected(manualValue.trim())} type="button">Use value</button>
      </div>
    </Modal>
  );
}
