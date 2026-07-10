import { Rocket } from "lucide-react";

type QuickStartActionButtonProps = {
  onClick: () => void;
  disabled?: boolean;
};

export default function QuickStartActionButton({ onClick, disabled = false }: QuickStartActionButtonProps) {
  return (
    <button
      type="button"
      className="quick-start-action-button"
      onClick={onClick}
      disabled={disabled}
      aria-label="Use for Quick Start"
    >
      <Rocket size={15} aria-hidden="true" />
      <span>Use</span>
    </button>
  );
}
