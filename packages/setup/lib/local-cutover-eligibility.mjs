const LEGACY_CUTOVER_INSTALLERS = Object.freeze(['0.6.11', '0.6.12']);

export function isLegacyCutoverInstaller(version) {
  return LEGACY_CUTOVER_INSTALLERS.includes(version);
}
