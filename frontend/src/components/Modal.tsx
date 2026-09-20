import { useEffect, useState, type ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  title: string;
  children: ReactNode;
  maxWidth?: number;
  onClose: () => void;
}

export function Modal({ open, title, children, maxWidth = 620, onClose }: ModalProps) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let timer: number | undefined;
    let frame: number | undefined;
    if (open) {
      setMounted(true);
      frame = requestAnimationFrame(() => setVisible(true));
    } else if (mounted) {
      setVisible(false);
      timer = window.setTimeout(() => setMounted(false), 350);
    }
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [open, mounted]);

  if (!mounted) return null;
  return (
    <div className={`modal-overlay ${visible ? 'active' : ''}`} role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="modal-box modal-box-animated" style={{ maxWidth }} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn-sm btn-ghost" onClick={onClose} type="button" aria-label="Close dialog">✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({ open, title, message, onCancel, onConfirm }: ConfirmDialogProps) {
  return (
    <Modal open={open} title={title} maxWidth={420} onClose={onCancel}>
      <p className="modal-message">{message}</p>
      <div className="modal-actions">
        <button className="btn-ghost" onClick={onCancel} type="button">Cancel</button>
        <button className="btn-danger" onClick={onConfirm} type="button">Confirm</button>
      </div>
    </Modal>
  );
}
