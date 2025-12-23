export type { RGBA } from "./colormap";
export { amplitudeToColor } from "./colormap";
export { captureSpectrumAnalyzer } from "./screenshot";

export type { AuthCredentials } from "./auth";
export {
    getStoredCredentials,
    hashPassword,
    initializeDefaultCredentials,
    setCredentials,
    verifyPassword,
} from "./auth";

