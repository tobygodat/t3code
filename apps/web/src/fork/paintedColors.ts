import type { ThemeAppearance, ThemeColors } from "@t3tools/shared/themePalettes";

/** The surfaces fork/theme.css paints over index.css. Keep in sync with that file. */
export const FORK_STANDARD_PAINTED_COLORS: Readonly<Record<ThemeAppearance, Partial<ThemeColors>>> =
  {
    light: {},
    dark: { canvas: "#171717", surface: "#1b1b1b", surfaceRaised: "#1b1b1b" },
  };
