export function captureEvent(value) {
  if (
    typeof value?.session_id !== "string" ||
    value.session_id.length > 256 ||
    typeof value?.transcript_path !== "string" ||
    value.transcript_path.length > 8_192 ||
    typeof value?.cwd !== "string" ||
    value.cwd.length > 8_192
  ) {
    return null;
  }
  return {
    session_id: value.session_id,
    transcript_path: value.transcript_path,
    cwd: value.cwd,
  };
}
