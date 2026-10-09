import picomatch from "picomatch";
import * as pathe from "pathe";

export * from "pathe";
export const posix = pathe;
export const delimiter = ":";
export const matchesGlob = (path: string, glob: string): boolean => picomatch(glob, { dot: true })(path);
export default { ...pathe, posix: pathe, delimiter, matchesGlob };
