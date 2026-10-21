import { FC, ReactElement } from "react";
import { UserSettings } from "../../lib";

interface Props {
  theme: UserSettings["buttonStyle"]["theme"];
}

const HighContrastStyle = (
  <style>
    {
      `
        .pyrodeck-button {
          background: #222;
        }
        
        .pyrodeck-button:hover {
          background: #50555D;
        }
        
        .pyrodeck-button:focus {
          background: #fff;
        }
      `
    }
  </style>
);

const CleanStyle = (
  <style>
    {
      `
        .pyrodeck-button {
          background: rgba(14, 20, 27, 0.5);
        }
        
        .pyrodeck-button:hover {
          background: rgba(14, 20, 27, 0.75);
        }
      `
    }
  </style>
);

function getThemeElement(theme: UserSettings["buttonStyle"]["theme"]): ReactElement | null {
  switch (theme) {
    case "HighContrast":
      return HighContrastStyle;
    case "Clean":
      return CleanStyle;
    default:
      return null;
  }
}

export const ButtonStyle: FC<Props> = ({ theme }) => {
  return (
    <>
      {getThemeElement(theme)}
      <style>
        {
          `
            .pyrodeck-button {
              margin: 0 !important;
            }

            .pyrodeck-button svg path {
              fill: currentcolor;
            }
          `
        }
      </style>
    </>
  );
};
