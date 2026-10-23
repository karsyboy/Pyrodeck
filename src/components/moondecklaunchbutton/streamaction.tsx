import { Button, Focusable, playSectionClasses } from "@decky/ui";
import { FC } from "react";
import { FaChevronDown } from "react-icons/fa";
import { MoonDeckMain } from "../icons";

interface Props {
  label: string;
  disabled?: boolean;
  launchDisabled?: boolean;
  hostName?: string;
  message?: string | null;
  onLaunch?: () => void;
  onChooseHost?: (anchor: EventTarget) => void;
}

/** Native Library controls, including Steam's hover, focus and contrast rules. */
export const StreamAction: FC<Props> = ({ label, disabled, launchDisabled, hostName, message, onLaunch, onChooseHost }) => (
  <>
    <style>
      {`
      .pyrodeck-stream-actions {
        position: relative; display: flex; align-items: center; gap: 4px;
        width: max-content; max-width: calc(100vw - 32px);
      }
      .BasicUI .pyrodeck-stream-actions .pyrodeck-stream-primary,
      .BasicUI .pyrodeck-stream-actions .pyrodeck-stream-host {
        margin: 0; height: 48px; flex-shrink: 0; font: inherit;
        color: inherit; gap: 10px;
      }
      .BasicUI .pyrodeck-stream-actions .pyrodeck-stream-primary {
        width: auto; min-width: 128px; padding: 0 16px; font-weight: 500;
      }
      .pyrodeck-stream-actions svg { width: 20px; height: 20px; fill: currentColor; }
      .BasicUI .pyrodeck-stream-actions .pyrodeck-stream-host { width: 40px; }
      .pyrodeck-stream-host svg { width: 12px; height: 12px; }
      .pyrodeck-stream-message {
        position: absolute; right: 0; bottom: 100%; margin-bottom: 8px;
        max-width: 300px; padding: 10px 14px; border-radius: 2px;
        background: #23262e; color: #dcdedf; font-size: 14px;
      }
    `}
    </style>
    <Focusable
      className="pyrodeck-stream-actions"
      flow-children="row"
      role="group"
      aria-label="Pyrolight streaming"
    >
      {message && <div className="pyrodeck-stream-message" role="status">{message}</div>}
      <Button
        className={`${playSectionClasses.MenuButton} pyrodeck-stream-primary`}
        disabled={disabled || launchDisabled}
        focusable={!disabled && !launchDisabled}
        noFocusRing={false}
        onOKActionDescription={label}
        aria-label={`${label}${hostName ? ` from ${hostName}` : ""}`}
        onClick={onLaunch}
      >
        <MoonDeckMain aria-hidden="true" />
        <span>{label}</span>
      </Button>
      {onChooseHost && (
        <Button
          className={`${playSectionClasses.MenuButton} pyrodeck-stream-host`}
          disabled={disabled}
          focusable={!disabled}
          noFocusRing={false}
          aria-label="Choose streaming host"
          onOKActionDescription="Choose streaming host"
          onClick={(event) => onChooseHost(event.currentTarget!)}
        >
          <FaChevronDown aria-hidden="true" />
        </Button>
      )}
    </Focusable>
  </>
);
