// Consent shared by the coordinator and Codex installer, with no host dependencies.
export async function confirmStopped({ write, prompt, t }) {
  write('');
  write(t('stop_hint'));
  while (!/^(?:y|yes)$/iu.test((await prompt(t('ask_hosts_stopped'))).trim())) {
    // Ctrl+C/EOF cancels at the prompt seam.
  }
}
