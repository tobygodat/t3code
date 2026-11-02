import { APP_STAGE_LABEL } from "../branding";

/** The fork builds its updates from origin/main: one track, no update-everything for remotes. */
export const IS_FORK_BUILD = APP_STAGE_LABEL === "Fork";
