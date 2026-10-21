import { FC } from "react";
import { UserSettings } from "../../lib";

interface Props {
  buttonPosition?: UserSettings["buttonPosition"];
}

export const achorPositionName = "--pyrodeck-anchor-pos";
export const xOffsetName = "--pyrodeck-x-offset";
export const yOffsetName = "--pyrodeck-y-offset";
export const ySpecialOffsetName = "--pyrodeck-y-special-offset";

export const OffsetStyle: FC<Props> = ({ buttonPosition }) => {
  if (!buttonPosition) {
    return null;
  }
  return (
    <style>
      {
        `
          :root {
            ${achorPositionName}: ${buttonPosition.horizontalAlignment === "top" ? "static" : "relative"};
            ${xOffsetName}: ${buttonPosition.offsetX || "0px"};
            ${yOffsetName}: ${buttonPosition.offsetY || "0px"};
            ${ySpecialOffsetName}: ${buttonPosition.offsetForHltb ? "85px" : "0px"};
          }
        `
      }
    </style>
  );
};
