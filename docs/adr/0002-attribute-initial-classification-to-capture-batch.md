# Attribute initial classification to the capture batch

A memory can be admitted by more than one batch, while correction, filing and
explicit recovery can change it afterward. We record only the first capture
classification attempt against its exact admission batch, not a global
per-memory success flag: that preserves provenance without mistaking current
filing for the original attempt's outcome. Later recovery remains separate;
the journal is observation, not a retry queue or proof of semantic quality.
