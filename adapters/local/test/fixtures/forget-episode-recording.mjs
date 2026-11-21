import assert from 'node:assert/strict';
import { forgottenText, stepText } from './forget-episode.mjs';

// Literal outcomes from the paired recording. Profiles share identical recorded
// cells only; no refusal is inferred from a layout, fence or surviving source.
// Episode keys are fixture roles, so random Episode UUID ordering cannot move a pin.
// Item-scoped withholding uses the item withheld comment even in a changed cell.

const reads1 = {
  "get": "ok", // main's outcome; reported
  "list": "ok", // main's outcome; reported
  "listEpisodes[event]": "ok", // named conversation's Episode withheld (this fix)
  "listEpisodes[receipt]": "ok", // named conversation's Episode withheld (this fix)
  "getEpisode:source": "episode_not_found", // item withheld; named conversation's Episode withheld (this fix)
  "getEpisode:independent": "ok", // main's outcome; reported
  "recall[default]": "ok", // main's outcome; reported
  "recall[default+qual]": "ok", // main's outcome; reported
  "recall[rationale-evidence]": "source_unavailable", // main's outcome; reported
  "sessionStartContext[nextSteps]": "ok", // main's outcome; reported
  "sessionStartContext[nextSteps+procedural+background]": "revision_conflict", // main's outcome; reported
};

const reads2 = {
  "get": "memory_not_found", // item withheld
  "list": "ok", // main's outcome; reported
  "listEpisodes[event]": "ok", // named conversation's Episode withheld (this fix)
  "listEpisodes[receipt]": "ok", // named conversation's Episode withheld (this fix)
  "getEpisode:source": "episode_not_found", // item withheld; named conversation's Episode withheld (this fix)
  "getEpisode:independent": "ok", // main's outcome; reported
  "recall[default]": "ok", // main's outcome; reported
  "recall[default+qual]": "ok", // main's outcome; reported
  "recall[rationale-evidence]": "source_unavailable", // main's outcome; reported
  "sessionStartContext[nextSteps]": "ok", // main's outcome; reported
  "sessionStartContext[nextSteps+procedural+background]": "revision_conflict", // main's outcome; reported
};

const reads3 = {
  "get": "ok", // successful post-read; recorded
  "list": "ok", // withheld rows skipped; recorded
  "listEpisodes[event]": "ok", // successful post-read; recorded
  "listEpisodes[receipt]": "ok", // successful post-read; recorded
  "getEpisode:source": "episode_not_found", // item withheld
  "getEpisode:independent": "ok", // successful post-read; recorded
  "recall[default]": "ok", // successful post-read; recorded
  "recall[default+qual]": "ok", // successful post-read; recorded
  "recall[rationale-evidence]": "ok", // successful post-read; recorded
  "sessionStartContext[nextSteps]": "ok", // successful post-read; recorded
  "sessionStartContext[nextSteps+procedural+background]": "ok", // successful post-read; recorded
};

const reads4 = {
  "get": "memory_not_found", // item withheld
  "list": "ok", // withheld rows skipped; recorded
  "listEpisodes[event]": "ok", // successful post-read; recorded
  "listEpisodes[receipt]": "ok", // successful post-read; recorded
  "getEpisode:source": "episode_not_found", // item withheld
  "getEpisode:independent": "ok", // successful post-read; recorded
  "recall[default]": "ok", // successful post-read; recorded
  "recall[default+qual]": "ok", // successful post-read; recorded
  "recall[rationale-evidence]": "ok", // successful post-read; recorded
  "sessionStartContext[nextSteps]": "ok", // successful post-read; recorded
  "sessionStartContext[nextSteps+procedural+background]": "ok", // successful post-read; recorded
};

const reads5 = {
  "get": "ok", // main's outcome; reported
  "list": "ok", // withheld rows skipped; recorded
  "listEpisodes[event]": "ok", // main's outcome; reported
  "listEpisodes[receipt]": "ok", // main's outcome; reported
  "getEpisode:independent": "ok", // main's outcome; reported
  "recall[default]": "ok", // main's outcome; reported
  "recall[default+qual]": "ok", // main's outcome; reported
  "recall[rationale-evidence]": "ok", // main's outcome; reported
  "sessionStartContext[nextSteps]": "ok", // main's outcome; reported
  "sessionStartContext[nextSteps+procedural+background]": "ok", // main's outcome; reported
};

const reads6 = {
  "get": "memory_not_found", // item withheld
  "list": "ok", // withheld rows skipped; recorded
  "listEpisodes[event]": "ok", // main's outcome; reported
  "listEpisodes[receipt]": "ok", // main's outcome; reported
  "getEpisode:independent": "ok", // main's outcome; reported
  "recall[default]": "ok", // main's outcome; reported
  "recall[default+qual]": "ok", // main's outcome; reported
  "recall[rationale-evidence]": "ok", // main's outcome; reported
  "sessionStartContext[nextSteps]": "ok", // main's outcome; reported
  "sessionStartContext[nextSteps+procedural+background]": "ok", // main's outcome; reported
};

const reads7 = {
  "get": "ok", // main's outcome; reported
  "list": "ok", // withheld rows skipped; recorded
  "listEpisodes[event]": "ok", // main's outcome; reported
  "listEpisodes[receipt]": "ok", // main's outcome; reported
  "recall[default]": "ok", // main's outcome; reported
  "recall[default+qual]": "ok", // main's outcome; reported
  "recall[rationale-evidence]": "ok", // main's outcome; reported
  "sessionStartContext[nextSteps]": "ok", // main's outcome; reported
  "sessionStartContext[nextSteps+procedural+background]": "ok", // main's outcome; reported
};

const reads8 = {
  "get": "memory_not_found", // item withheld
  "list": "ok", // withheld rows skipped; recorded
  "listEpisodes[event]": "ok", // main's outcome; reported
  "listEpisodes[receipt]": "ok", // main's outcome; reported
  "recall[default]": "ok", // main's outcome; reported
  "recall[default+qual]": "ok", // main's outcome; reported
  "recall[rationale-evidence]": "ok", // main's outcome; reported
  "sessionStartContext[nextSteps]": "ok", // main's outcome; reported
  "sessionStartContext[nextSteps+procedural+background]": "ok", // main's outcome; reported
};

const reads9 = {
  "get": "ok", // successful post-read; recorded
  "list": "ok", // successful post-read; recorded
  "listEpisodes[event]": "ok", // successful post-read; recorded
  "listEpisodes[receipt]": "ok", // successful post-read; recorded
  "getEpisode:source": "episode_not_found", // item withheld
  "getEpisode:independent": "ok", // successful post-read; recorded
  "recall[default]": "ok", // successful post-read; recorded
  "recall[default+qual]": "revision_conflict", // pre-existing refusal now reachable; reported
  "recall[rationale-evidence]": "revision_conflict", // pre-existing refusal now reachable; reported
  "sessionStartContext[nextSteps]": "ok", // successful post-read; recorded
  "sessionStartContext[nextSteps+procedural+background]": "revision_conflict", // pre-existing refusal now reachable; reported
};

const reads10 = {
  "get": "memory_not_found", // item withheld
  "list": "ok", // successful post-read; recorded
  "listEpisodes[event]": "ok", // successful post-read; recorded
  "listEpisodes[receipt]": "ok", // successful post-read; recorded
  "getEpisode:source": "episode_not_found", // item withheld
  "getEpisode:independent": "ok", // successful post-read; recorded
  "recall[default]": "ok", // successful post-read; recorded
  "recall[default+qual]": "revision_conflict", // pre-existing refusal now reachable; reported
  "recall[rationale-evidence]": "revision_conflict", // pre-existing refusal now reachable; reported
  "sessionStartContext[nextSteps]": "ok", // successful post-read; recorded
  "sessionStartContext[nextSteps+procedural+background]": "revision_conflict", // pre-existing refusal now reachable; reported
};

const reads11 = {
  "get": "ok", // main's outcome; reported
  "list": "ok", // main's outcome; reported
  "listEpisodes[event]": "ok", // named conversation's Episode withheld (this fix)
  "listEpisodes[receipt]": "ok", // named conversation's Episode withheld (this fix)
  "getEpisode:source": "episode_not_found", // item withheld; named conversation's Episode withheld (this fix)
  "getEpisode:independent": "episode_not_found", // item withheld; named conversation's Episode withheld (this fix)
  "getEpisode:neighbour": "ok", // main's outcome; reported
  "getEpisode:unknown": "ok", // main's outcome; reported
  "recall[default]": "ok", // main's outcome; reported
  "recall[default+qual]": "ok", // main's outcome; reported
  "recall[rationale-evidence]": "source_unavailable", // main's outcome; reported
  "sessionStartContext[nextSteps]": "ok", // main's outcome; reported
  "sessionStartContext[nextSteps+procedural+background]": "revision_conflict", // main's outcome; reported
};

const reads12 = {
  "get": "memory_not_found", // item withheld
  "list": "ok", // main's outcome; reported
  "listEpisodes[event]": "ok", // named conversation's Episode withheld (this fix)
  "listEpisodes[receipt]": "ok", // named conversation's Episode withheld (this fix)
  "getEpisode:source": "episode_not_found", // item withheld; named conversation's Episode withheld (this fix)
  "getEpisode:independent": "episode_not_found", // item withheld; named conversation's Episode withheld (this fix)
  "getEpisode:neighbour": "ok", // main's outcome; reported
  "getEpisode:unknown": "ok", // main's outcome; reported
  "recall[default]": "ok", // main's outcome; reported
  "recall[default+qual]": "ok", // main's outcome; reported
  "recall[rationale-evidence]": "source_unavailable", // main's outcome; reported
  "sessionStartContext[nextSteps]": "ok", // main's outcome; reported
  "sessionStartContext[nextSteps+procedural+background]": "revision_conflict", // main's outcome; reported
};

const reads13 = {
  "get": "ok", // successful post-read; recorded
  "list": "ok", // withheld rows skipped; recorded
  "listEpisodes[event]": "conversation_deleted", // pre-existing refusal now reachable; reported
  "listEpisodes[receipt]": "conversation_deleted", // pre-existing refusal now reachable; reported
  "getEpisode:source": "episode_not_found", // item withheld
  "getEpisode:independent": "episode_not_found", // item withheld
  "getEpisode:neighbour": "conversation_deleted", // pre-existing refusal now reachable; reported
  "getEpisode:unknown": "conversation_deleted", // pre-existing refusal now reachable; reported
  "recall[default]": "ok", // successful post-read; recorded
  "recall[default+qual]": "ok", // successful post-read; recorded
  "recall[rationale-evidence]": "ok", // successful post-read; recorded
  "sessionStartContext[nextSteps]": "conversation_deleted", // pre-existing refusal now reachable; reported
  "sessionStartContext[nextSteps+procedural+background]": "conversation_deleted", // pre-existing refusal now reachable; reported
};

const reads14 = {
  "get": "memory_not_found", // item withheld
  "list": "ok", // withheld rows skipped; recorded
  "listEpisodes[event]": "conversation_deleted", // pre-existing refusal now reachable; reported
  "listEpisodes[receipt]": "conversation_deleted", // pre-existing refusal now reachable; reported
  "getEpisode:source": "episode_not_found", // item withheld
  "getEpisode:independent": "episode_not_found", // item withheld
  "getEpisode:neighbour": "conversation_deleted", // pre-existing refusal now reachable; reported
  "getEpisode:unknown": "conversation_deleted", // pre-existing refusal now reachable; reported
  "recall[default]": "ok", // successful post-read; recorded
  "recall[default+qual]": "ok", // successful post-read; recorded
  "recall[rationale-evidence]": "ok", // successful post-read; recorded
  "sessionStartContext[nextSteps]": "conversation_deleted", // pre-existing refusal now reachable; reported
  "sessionStartContext[nextSteps+procedural+background]": "conversation_deleted", // pre-existing refusal now reachable; reported
};

const reads15 = {
  "get": "ok", // main's outcome; reported
  "list": "ok", // main's outcome; reported
  "listEpisodes[event]": "ok", // named conversation's Episode withheld (this fix)
  "listEpisodes[receipt]": "ok", // named conversation's Episode withheld (this fix)
  "getEpisode:source": "episode_not_found", // item withheld; named conversation's Episode withheld (this fix)
  "getEpisode:independent": "ok", // main's outcome; reported
  "getEpisode:consumer": "ok", // main's outcome; reported
  "recall[default]": "ok", // main's outcome; reported
  "recall[default+qual]": "ok", // main's outcome; reported
  "recall[rationale-evidence]": "source_unavailable", // main's outcome; reported
  "sessionStartContext[nextSteps]": "ok", // main's outcome; reported
  "sessionStartContext[nextSteps+procedural+background]": "revision_conflict", // main's outcome; reported
};

const reads16 = {
  "get": "memory_not_found", // item withheld
  "list": "ok", // main's outcome; reported
  "listEpisodes[event]": "ok", // named conversation's Episode withheld (this fix)
  "listEpisodes[receipt]": "ok", // named conversation's Episode withheld (this fix)
  "getEpisode:source": "episode_not_found", // item withheld; named conversation's Episode withheld (this fix)
  "getEpisode:independent": "ok", // main's outcome; reported
  "getEpisode:consumer": "ok", // main's outcome; reported
  "recall[default]": "ok", // main's outcome; reported
  "recall[default+qual]": "ok", // main's outcome; reported
  "recall[rationale-evidence]": "source_unavailable", // main's outcome; reported
  "sessionStartContext[nextSteps]": "ok", // main's outcome; reported
  "sessionStartContext[nextSteps+procedural+background]": "revision_conflict", // main's outcome; reported
};

const reads17 = {
  "get": "ok", // successful post-read; recorded
  "list": "ok", // withheld rows skipped; recorded
  "listEpisodes[event]": "ok", // successful post-read; recorded
  "listEpisodes[receipt]": "ok", // successful post-read; recorded
  "getEpisode:source": "episode_not_found", // item withheld
  "getEpisode:independent": "ok", // successful post-read; recorded
  "getEpisode:consumer": "ok", // successful post-read; recorded
  "recall[default]": "ok", // successful post-read; recorded
  "recall[default+qual]": "ok", // successful post-read; recorded
  "recall[rationale-evidence]": "ok", // successful post-read; recorded
  "sessionStartContext[nextSteps]": "ok", // successful post-read; recorded
  "sessionStartContext[nextSteps+procedural+background]": "ok", // successful post-read; recorded
};

const reads18 = {
  "get": "memory_not_found", // item withheld
  "list": "ok", // withheld rows skipped; recorded
  "listEpisodes[event]": "ok", // successful post-read; recorded
  "listEpisodes[receipt]": "ok", // successful post-read; recorded
  "getEpisode:source": "episode_not_found", // item withheld
  "getEpisode:independent": "ok", // successful post-read; recorded
  "getEpisode:consumer": "ok", // successful post-read; recorded
  "recall[default]": "ok", // successful post-read; recorded
  "recall[default+qual]": "ok", // successful post-read; recorded
  "recall[rationale-evidence]": "ok", // successful post-read; recorded
  "sessionStartContext[nextSteps]": "ok", // successful post-read; recorded
  "sessionStartContext[nextSteps+procedural+background]": "ok", // successful post-read; recorded
};

const reads19 = {
  "get": "ok+NEEDLE:forgotten", // main's outcome; reported
  "recall[default]": "ok+NEEDLE:forgotten", // main's outcome; reported
  "deleteConversation": "ok", // main's outcome; reported
};

const reads22 = {
  "get": "ok+NEEDLE:forgotten", // successful post-read; recorded
  "recall[default]": "ok+NEEDLE:forgotten", // successful post-read; recorded
  "deleteConversation": "ok", // successful post-read; recorded
};

const reads23 = {
  "get": "ok", // successful post-read; recorded
  "list": "ok", // withheld rows skipped; recorded
  "listEpisodes[event]": "ok", // successful post-read; recorded
  "listEpisodes[receipt]": "ok", // successful post-read; recorded
  "getEpisode:source": "episode_not_found", // item withheld
  "getEpisode:independent": "episode_not_found", // item withheld
  "getEpisode:consumer": "ok", // successful post-read; recorded
  "recall[default]": "ok", // successful post-read; recorded
  "recall[default+qual]": "ok", // successful post-read; recorded
  "recall[rationale-evidence]": "ok", // successful post-read; recorded
  "sessionStartContext[nextSteps]": "ok", // successful post-read; recorded
  "sessionStartContext[nextSteps+procedural+background]": "ok", // successful post-read; recorded
};

const reads24 = {
  "get": "memory_not_found", // item withheld
  "list": "ok", // withheld rows skipped; recorded
  "listEpisodes[event]": "ok", // successful post-read; recorded
  "listEpisodes[receipt]": "ok", // successful post-read; recorded
  "getEpisode:source": "episode_not_found", // item withheld
  "getEpisode:independent": "episode_not_found", // item withheld
  "getEpisode:consumer": "ok", // successful post-read; recorded
  "recall[default]": "ok", // successful post-read; recorded
  "recall[default+qual]": "ok", // successful post-read; recorded
  "recall[rationale-evidence]": "ok", // successful post-read; recorded
  "sessionStartContext[nextSteps]": "ok", // successful post-read; recorded
  "sessionStartContext[nextSteps+procedural+background]": "ok", // successful post-read; recorded
};

const reads25 = {
  "get": "ok", // main's outcome; reported
  "list": "ok", // main's outcome; reported
  "listEpisodes[event]": "ok", // named conversation's Episode withheld (this fix)
  "listEpisodes[receipt]": "ok", // named conversation's Episode withheld (this fix)
  "getEpisode:source": "episode_not_found", // item withheld; named conversation's Episode withheld (this fix)
  "getEpisode:independent": "ok", // main's outcome; reported
  "getEpisode:consumer": "ok", // main's outcome; reported
  "recall[default]": "ok", // main's outcome; reported
  "recall[default+qual]": "ok", // main's outcome; reported
  "recall[rationale-evidence]": "source_unavailable", // main's outcome; reported
  "sessionStartContext[nextSteps]": "ok", // named conversation's Episode withheld (this fix)
  "sessionStartContext[nextSteps+procedural+background]": "revision_conflict", // main's outcome; reported
};

const reads26 = {
  "get": "memory_not_found", // item withheld
  "list": "ok", // main's outcome; reported
  "listEpisodes[event]": "ok", // named conversation's Episode withheld (this fix)
  "listEpisodes[receipt]": "ok", // named conversation's Episode withheld (this fix)
  "getEpisode:source": "episode_not_found", // item withheld; named conversation's Episode withheld (this fix)
  "getEpisode:independent": "ok", // main's outcome; reported
  "getEpisode:consumer": "ok", // main's outcome; reported
  "recall[default]": "ok", // main's outcome; reported
  "recall[default+qual]": "ok", // main's outcome; reported
  "recall[rationale-evidence]": "source_unavailable", // main's outcome; reported
  "sessionStartContext[nextSteps]": "ok", // named conversation's Episode withheld (this fix)
  "sessionStartContext[nextSteps+procedural+background]": "revision_conflict", // main's outcome; reported
};

const reads27 = {
  "get": "ok+NEEDLE:forgotten", // successful post-read; recorded
  "recall[default]": "ok+NEEDLE:forgotten", // successful post-read; recorded
};

const reads28 = {
  "get": "ok", // main's outcome; reported
  "list": "ok", // main's outcome; reported
  "listEpisodes[event]": "conversation_deleted", // main's outcome; reported
  "listEpisodes[receipt]": "conversation_deleted", // main's outcome; reported
  "getEpisode:source": "episode_not_found", // item withheld
  "getEpisode:independent": "conversation_deleted", // main's outcome; reported
  "getEpisode:consumer": "ok", // main's outcome; reported
  "recall[default]": "ok", // main's outcome; reported
  "recall[default+qual]": "revision_conflict", // main's outcome; reported
  "recall[rationale-evidence]": "revision_conflict", // main's outcome; reported
  "sessionStartContext[nextSteps]": "conversation_deleted", // main's outcome; reported
  "sessionStartContext[nextSteps+procedural+background]": "conversation_deleted", // main's outcome; reported
};

const reads29 = {
  "get": "memory_not_found", // item withheld
  "list": "ok", // main's outcome; reported
  "listEpisodes[event]": "conversation_deleted", // main's outcome; reported
  "listEpisodes[receipt]": "conversation_deleted", // main's outcome; reported
  "getEpisode:source": "episode_not_found", // item withheld
  "getEpisode:independent": "conversation_deleted", // main's outcome; reported
  "getEpisode:consumer": "ok", // main's outcome; reported
  "recall[default]": "ok", // main's outcome; reported
  "recall[default+qual]": "revision_conflict", // main's outcome; reported
  "recall[rationale-evidence]": "revision_conflict", // main's outcome; reported
  "sessionStartContext[nextSteps]": "conversation_deleted", // main's outcome; reported
  "sessionStartContext[nextSteps+procedural+background]": "conversation_deleted", // main's outcome; reported
};

const reads30 = {
  "get": "ok", // main's outcome; reported
  "list": "ok", // main's outcome; reported
  "listEpisodes[event]": "ok", // named conversation's Episode withheld (this fix)
  "listEpisodes[receipt]": "ok", // named conversation's Episode withheld (this fix)
  "getEpisode:source": "episode_not_found", // item withheld; named conversation's Episode withheld (this fix)
  "getEpisode:independent": "ok", // main's outcome; reported
  "getEpisode:neighbour": "ok", // main's outcome; reported
  "getEpisode:unknown": "ok", // main's outcome; reported
  "recall[default]": "ok", // main's outcome; reported
  "recall[default+qual]": "ok", // main's outcome; reported
  "recall[rationale-evidence]": "source_unavailable", // main's outcome; reported
  "sessionStartContext[nextSteps]": "ok", // main's outcome; reported
  "sessionStartContext[nextSteps+procedural+background]": "revision_conflict", // main's outcome; reported
};

const reads31 = {
  "get": "memory_not_found", // item withheld
  "list": "ok", // main's outcome; reported
  "listEpisodes[event]": "ok", // named conversation's Episode withheld (this fix)
  "listEpisodes[receipt]": "ok", // named conversation's Episode withheld (this fix)
  "getEpisode:source": "episode_not_found", // item withheld; named conversation's Episode withheld (this fix)
  "getEpisode:independent": "ok", // main's outcome; reported
  "getEpisode:neighbour": "ok", // main's outcome; reported
  "getEpisode:unknown": "ok", // main's outcome; reported
  "recall[default]": "ok", // main's outcome; reported
  "recall[default+qual]": "ok", // main's outcome; reported
  "recall[rationale-evidence]": "source_unavailable", // main's outcome; reported
  "sessionStartContext[nextSteps]": "ok", // main's outcome; reported
  "sessionStartContext[nextSteps+procedural+background]": "revision_conflict", // main's outcome; reported
};

const reads32 = {
  "get": "ok", // successful post-read; recorded
  "list": "ok", // withheld rows skipped; recorded
  "listEpisodes[event]": "conversation_deleted", // pre-existing refusal now reachable; reported
  "listEpisodes[receipt]": "conversation_deleted", // pre-existing refusal now reachable; reported
  "getEpisode:source": "episode_not_found", // item withheld
  "getEpisode:independent": "ok", // successful post-read; recorded
  "getEpisode:neighbour": "conversation_deleted", // pre-existing refusal now reachable; reported
  "getEpisode:unknown": "conversation_deleted", // pre-existing refusal now reachable; reported
  "recall[default]": "ok", // successful post-read; recorded
  "recall[default+qual]": "ok", // successful post-read; recorded
  "recall[rationale-evidence]": "ok", // successful post-read; recorded
  "sessionStartContext[nextSteps]": "conversation_deleted", // pre-existing refusal now reachable; reported
  "sessionStartContext[nextSteps+procedural+background]": "conversation_deleted", // pre-existing refusal now reachable; reported
};

const reads33 = {
  "get": "memory_not_found", // item withheld
  "list": "ok", // withheld rows skipped; recorded
  "listEpisodes[event]": "conversation_deleted", // pre-existing refusal now reachable; reported
  "listEpisodes[receipt]": "conversation_deleted", // pre-existing refusal now reachable; reported
  "getEpisode:source": "episode_not_found", // item withheld
  "getEpisode:independent": "ok", // successful post-read; recorded
  "getEpisode:neighbour": "conversation_deleted", // pre-existing refusal now reachable; reported
  "getEpisode:unknown": "conversation_deleted", // pre-existing refusal now reachable; reported
  "recall[default]": "ok", // successful post-read; recorded
  "recall[default+qual]": "ok", // successful post-read; recorded
  "recall[rationale-evidence]": "ok", // successful post-read; recorded
  "sessionStartContext[nextSteps]": "conversation_deleted", // pre-existing refusal now reachable; reported
  "sessionStartContext[nextSteps+procedural+background]": "conversation_deleted", // pre-existing refusal now reachable; reported
};

const reads34 = {
  "get": "ok", // main's outcome; reported
  "list": "ok", // main's outcome; reported
  "listEpisodes[event]": "ok", // main's outcome; reported
  "listEpisodes[receipt]": "ok", // main's outcome; reported
  "getEpisode:source": "ok", // main's outcome; reported
  "getEpisode:independent": "ok", // main's outcome; reported
  "getEpisode:neighbour": "ok", // main's outcome; reported
  "getEpisode:unknown": "ok", // main's outcome; reported
  "recall[default]": "ok", // main's outcome; reported
  "recall[default+qual]": "ok", // main's outcome; reported
  "recall[rationale-evidence]": "source_unavailable", // main's outcome; reported
  "sessionStartContext[nextSteps]": "ok", // main's outcome; reported
  "sessionStartContext[nextSteps+procedural+background]": "revision_conflict", // main's outcome; reported
};

const reads35 = {
  "get": "memory_not_found", // item withheld
  "list": "ok", // main's outcome; reported
  "listEpisodes[event]": "ok", // main's outcome; reported
  "listEpisodes[receipt]": "ok", // main's outcome; reported
  "getEpisode:source": "ok", // main's outcome; reported
  "getEpisode:independent": "ok", // main's outcome; reported
  "getEpisode:neighbour": "ok", // main's outcome; reported
  "getEpisode:unknown": "ok", // main's outcome; reported
  "recall[default]": "ok", // main's outcome; reported
  "recall[default+qual]": "ok", // main's outcome; reported
  "recall[rationale-evidence]": "source_unavailable", // main's outcome; reported
  "sessionStartContext[nextSteps]": "ok", // main's outcome; reported
  "sessionStartContext[nextSteps+procedural+background]": "revision_conflict", // main's outcome; reported
};

const reads36 = {
  "get": "ok", // main's outcome; reported
  "list": "ok", // main's outcome; reported
  "listEpisodes[event]": "conversation_deleted", // main's outcome; reported
  "listEpisodes[receipt]": "conversation_deleted", // main's outcome; reported
  "getEpisode:source": "conversation_deleted", // main's outcome; reported
  "getEpisode:independent": "ok", // main's outcome; reported
  "getEpisode:neighbour": "conversation_deleted", // main's outcome; reported
  "getEpisode:unknown": "conversation_deleted", // main's outcome; reported
  "recall[default]": "ok", // main's outcome; reported
  "recall[default+qual]": "revision_conflict", // main's outcome; reported
  "recall[rationale-evidence]": "revision_conflict", // main's outcome; reported
  "sessionStartContext[nextSteps]": "conversation_deleted", // main's outcome; reported
  "sessionStartContext[nextSteps+procedural+background]": "conversation_deleted", // main's outcome; reported
};

const reads37 = {
  "get": "memory_not_found", // item withheld
  "list": "ok", // main's outcome; reported
  "listEpisodes[event]": "conversation_deleted", // main's outcome; reported
  "listEpisodes[receipt]": "conversation_deleted", // main's outcome; reported
  "getEpisode:source": "conversation_deleted", // main's outcome; reported
  "getEpisode:independent": "ok", // main's outcome; reported
  "getEpisode:neighbour": "conversation_deleted", // main's outcome; reported
  "getEpisode:unknown": "conversation_deleted", // main's outcome; reported
  "recall[default]": "ok", // main's outcome; reported
  "recall[default+qual]": "revision_conflict", // main's outcome; reported
  "recall[rationale-evidence]": "revision_conflict", // main's outcome; reported
  "sessionStartContext[nextSteps]": "conversation_deleted", // main's outcome; reported
  "sessionStartContext[nextSteps+procedural+background]": "conversation_deleted", // main's outcome; reported
};

const cases = {
  "forget-episode :: X_29_episodes correct": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads1,
  },
  "forget-episode :: X_29_episodes forget": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads2,
  },
  "forget-episode :: X_33_episodes correct": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads1,
  },
  "forget-episode :: X_33_episodes forget": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads2,
  },
  "forget-episode :: X_48_episodes correct": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads3,
  },
  "forget-episode :: X_48_episodes forget": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads4,
  },
  "forget-episode :: X_48_episodes_other_session_only correct": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads5,
  },
  "forget-episode :: X_48_episodes_other_session_only forget": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads6,
  },
  "forget-episode :: X_48_no_episodes correct": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads7,
  },
  "forget-episode :: X_48_no_episodes forget": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads8,
  },
  "forget-episode :: X_53lineage_episodes correct": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads3,
  },
  "forget-episode :: X_53lineage_episodes forget": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads4,
  },
  "forget-episode :: X_53lineage_no_episodes correct": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads7,
  },
  "forget-episode :: X_53lineage_no_episodes forget": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads8,
  },
  "forget-episode :: X_53time_correct_episodes": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads3,
  },
  "forget-episode :: X_53time_different_messages_episodes correct": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads9,
  },
  "forget-episode :: X_53time_different_messages_episodes forget": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads10,
  },
  "forget-episode :: X_53time_episodes forget": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads4,
  },
  "forget-episode :: X_53time_episodes_other_session_only correct": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads5,
  },
  "forget-episode :: X_53time_episodes_other_session_only forget": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads6,
  },
  "forget-episode :: X_53time_no_episodes correct": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads7,
  },
  "forget-episode :: X_53time_no_episodes forget": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads8,
  },
  "forget-episode-keeper :: legacy keeper invalidates proven origin and stamped consumer 29 correct": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads11,
  },
  "forget-episode-keeper :: legacy keeper invalidates proven origin and stamped consumer 29 forget": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads12,
  },
  "forget-episode-keeper :: legacy keeper invalidates proven origin and stamped consumer 33 correct": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads11,
  },
  "forget-episode-keeper :: legacy keeper invalidates proven origin and stamped consumer 33 forget": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads12,
  },
  "forget-episode-keeper :: legacy keeper invalidates proven origin and stamped consumer 48 correct": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads13,
  },
  "forget-episode-keeper :: legacy keeper invalidates proven origin and stamped consumer 48 forget": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads14,
  },
  "forget-episode-keeper :: legacy keeper invalidates proven origin and stamped consumer 53 event time correct": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads13,
  },
  "forget-episode-keeper :: legacy keeper invalidates proven origin and stamped consumer 53 event time forget": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads14,
  },
  "forget-episode-keeper :: legacy keeper invalidates proven origin and stamped consumer 53 lineage correct": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads13,
  },
  "forget-episode-keeper :: legacy keeper invalidates proven origin and stamped consumer 53 lineage forget": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads14,
  },
  "forget-episode-scope :: cross-conversation consumer loses named passages and step 29 correct": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads15,
  },
  "forget-episode-scope :: cross-conversation consumer loses named passages and step 29 forget": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads16,
  },
  "forget-episode-scope :: cross-conversation consumer loses named passages and step 33 correct": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads15,
  },
  "forget-episode-scope :: cross-conversation consumer loses named passages and step 33 forget": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads16,
  },
  "forget-episode-scope :: cross-conversation consumer loses named passages and step 48 correct": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads17,
  },
  "forget-episode-scope :: cross-conversation consumer loses named passages and step 48 forget": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads18,
  },
  "forget-episode-scope :: cross-conversation consumer loses named passages and step 53 event time correct": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads17,
  },
  "forget-episode-scope :: cross-conversation consumer loses named passages and step 53 event time forget": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads18,
  },
  "forget-episode-scope :: cross-conversation consumer loses named passages and step 53 lineage correct": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads17,
  },
  "forget-episode-scope :: cross-conversation consumer loses named passages and step 53 lineage forget": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads18,
  },
  "forget-episode-scope :: mixed-origin summary outside window pins commit outcome 29 correct": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads15,
  },
  "forget-episode-scope :: mixed-origin summary outside window pins commit outcome 29 forget": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads16,
  },
  "forget-episode-scope :: mixed-origin summary outside window pins commit outcome 33 correct": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads15,
  },
  "forget-episode-scope :: mixed-origin summary outside window pins commit outcome 33 forget": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads16,
  },
  "forget-episode-scope :: mixed-origin summary outside window pins commit outcome 48 correct": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads17,
  },
  "forget-episode-scope :: mixed-origin summary outside window pins commit outcome 48 forget": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads18,
  },
  "forget-episode-scope :: mixed-origin summary outside window pins commit outcome 53 event time correct": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads17,
  },
  "forget-episode-scope :: mixed-origin summary outside window pins commit outcome 53 event time forget": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads18,
  },
  "forget-episode-scope :: mixed-origin summary outside window pins commit outcome 53 lineage correct": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads17,
  },
  "forget-episode-scope :: mixed-origin summary outside window pins commit outcome 53 lineage forget": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads18,
  },
  "forget-episode-scope :: mixed-origin summary window deletes source conversation then correct 48": {
    actions: ["conversation_deleted", "conversation_deleted", "ok"], // exact recorded action sequence
    p2: reads19,
    p3: reads28,
  },
  "forget-episode-scope :: mixed-origin summary window deletes source conversation then correct 53 event time": {
    actions: ["conversation_deleted", "conversation_deleted", "ok"], // exact recorded action sequence
    p2: reads19,
    p3: reads28,
  },
  "forget-episode-scope :: mixed-origin summary window deletes source conversation then correct 53 lineage": {
    actions: ["conversation_deleted", "conversation_deleted", "ok"], // exact recorded action sequence
    p2: reads19,
    p3: reads28,
  },
  "forget-episode-scope :: mixed-origin summary window deletes source conversation then forget 48": {
    actions: ["conversation_deleted", "conversation_deleted", "ok"], // exact recorded action sequence
    p2: reads19,
    p3: reads29,
  },
  "forget-episode-scope :: mixed-origin summary window deletes source conversation then forget 53 event time": {
    actions: ["conversation_deleted", "conversation_deleted", "ok"], // exact recorded action sequence
    p2: reads19,
    p3: reads29,
  },
  "forget-episode-scope :: mixed-origin summary window deletes source conversation then forget 53 lineage": {
    actions: ["conversation_deleted", "conversation_deleted", "ok"], // exact recorded action sequence
    p2: reads19,
    p3: reads29,
  },
  "forget-episode-scope :: mixed-origin summary window deletes unrelated conversation then correct 48": {
    actions: ["conversation_deleted", "conversation_deleted", "ok"], // exact recorded action sequence
    p2: reads22,
    p3: reads23,
  },
  "forget-episode-scope :: mixed-origin summary window deletes unrelated conversation then correct 53 event time": {
    actions: ["conversation_deleted", "conversation_deleted", "ok"], // exact recorded action sequence
    p2: reads22,
    p3: reads23,
  },
  "forget-episode-scope :: mixed-origin summary window deletes unrelated conversation then correct 53 lineage": {
    actions: ["conversation_deleted", "conversation_deleted", "ok"], // exact recorded action sequence
    p2: reads22,
    p3: reads23,
  },
  "forget-episode-scope :: mixed-origin summary window deletes unrelated conversation then forget 48": {
    actions: ["conversation_deleted", "conversation_deleted", "ok"], // exact recorded action sequence
    p2: reads22,
    p3: reads24,
  },
  "forget-episode-scope :: mixed-origin summary window deletes unrelated conversation then forget 53 event time": {
    actions: ["conversation_deleted", "conversation_deleted", "ok"], // exact recorded action sequence
    p2: reads22,
    p3: reads24,
  },
  "forget-episode-scope :: mixed-origin summary window deletes unrelated conversation then forget 53 lineage": {
    actions: ["conversation_deleted", "conversation_deleted", "ok"], // exact recorded action sequence
    p2: reads22,
    p3: reads24,
  },
  "forget-episode-scope :: mixed-origin summary window pins commit outcome 29 correct": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads15,
  },
  "forget-episode-scope :: mixed-origin summary window pins commit outcome 29 forget": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads26,
  },
  "forget-episode-scope :: mixed-origin summary window pins commit outcome 33 correct": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads25,
  },
  "forget-episode-scope :: mixed-origin summary window pins commit outcome 33 forget": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads26,
  },
  "forget-episode-scope :: mixed-origin summary window pins commit outcome 48 correct": {
    actions: ["conversation_deleted", "conversation_deleted"], // exact recorded action sequence
    p2: reads27,
  },
  "forget-episode-scope :: mixed-origin summary window pins commit outcome 48 forget": {
    actions: ["conversation_deleted", "conversation_deleted"], // exact recorded action sequence
    p2: reads27,
  },
  "forget-episode-scope :: mixed-origin summary window pins commit outcome 53 event time correct": {
    actions: ["conversation_deleted", "conversation_deleted"], // exact recorded action sequence
    p2: reads27,
  },
  "forget-episode-scope :: mixed-origin summary window pins commit outcome 53 event time forget": {
    actions: ["conversation_deleted", "conversation_deleted"], // exact recorded action sequence
    p2: reads27,
  },
  "forget-episode-scope :: mixed-origin summary window pins commit outcome 53 lineage correct": {
    actions: ["conversation_deleted", "conversation_deleted"], // exact recorded action sequence
    p2: reads27,
  },
  "forget-episode-scope :: mixed-origin summary window pins commit outcome 53 lineage forget": {
    actions: ["conversation_deleted", "conversation_deleted"], // exact recorded action sequence
    p2: reads27,
  },
  "forget-episode-scope :: named source preserves window and unknown-time Episodes 29 correct": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads30,
  },
  "forget-episode-scope :: named source preserves window and unknown-time Episodes 29 forget": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads31,
  },
  "forget-episode-scope :: named source preserves window and unknown-time Episodes 33 correct": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads30,
  },
  "forget-episode-scope :: named source preserves window and unknown-time Episodes 33 forget": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads31,
  },
  "forget-episode-scope :: named source preserves window and unknown-time Episodes 48 correct": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads32,
  },
  "forget-episode-scope :: named source preserves window and unknown-time Episodes 48 forget": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads33,
  },
  "forget-episode-scope :: named source preserves window and unknown-time Episodes 53 event time correct": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads32,
  },
  "forget-episode-scope :: named source preserves window and unknown-time Episodes 53 event time forget": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads33,
  },
  "forget-episode-scope :: named source preserves window and unknown-time Episodes 53 lineage correct": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads32,
  },
  "forget-episode-scope :: named source preserves window and unknown-time Episodes 53 lineage forget": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads33,
  },
  "forget-episode-scope :: session-less receipt preserves every Episode and source row 29 correct": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads34,
  },
  "forget-episode-scope :: session-less receipt preserves every Episode and source row 29 forget": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads35,
  },
  "forget-episode-scope :: session-less receipt preserves every Episode and source row 33 correct": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads34,
  },
  "forget-episode-scope :: session-less receipt preserves every Episode and source row 33 forget": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads35,
  },
  "forget-episode-scope :: session-less receipt preserves every Episode and source row 48 correct": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads36,
  },
  "forget-episode-scope :: session-less receipt preserves every Episode and source row 48 forget": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads37,
  },
  "forget-episode-scope :: session-less receipt preserves every Episode and source row 53 event time correct": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads36,
  },
  "forget-episode-scope :: session-less receipt preserves every Episode and source row 53 event time forget": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads37,
  },
  "forget-episode-scope :: session-less receipt preserves every Episode and source row 53 lineage correct": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads36,
  },
  "forget-episode-scope :: session-less receipt preserves every Episode and source row 53 lineage forget": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads37,
  },
  "forget-episode-scope :: two named sessions invalidate both source Episodes 29 correct": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads11,
  },
  "forget-episode-scope :: two named sessions invalidate both source Episodes 29 forget": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads12,
  },
  "forget-episode-scope :: two named sessions invalidate both source Episodes 33 correct": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads11,
  },
  "forget-episode-scope :: two named sessions invalidate both source Episodes 33 forget": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads12,
  },
  "forget-episode-scope :: two named sessions invalidate both source Episodes 48 correct": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads13,
  },
  "forget-episode-scope :: two named sessions invalidate both source Episodes 48 forget": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads14,
  },
  "forget-episode-scope :: two named sessions invalidate both source Episodes 53 event time correct": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads13,
  },
  "forget-episode-scope :: two named sessions invalidate both source Episodes 53 event time forget": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads14,
  },
  "forget-episode-scope :: two named sessions invalidate both source Episodes 53 lineage correct": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads13,
  },
  "forget-episode-scope :: two named sessions invalidate both source Episodes 53 lineage forget": {
    actions: ["ok"], // exact recorded action sequence
    p1: reads14,
  },
};

export function recorded(family, name) {
  const result = cases[family + ' :: ' + name];
  assert.ok(result, 'a recording must exist for ' + family + ' :: ' + name);
  return result;
}
export function assertRecorded(result, expected, needles = [forgottenText, stepText]) {
  assert.equal(typeof expected, 'string', 'every call has one literal recorded outcome');
  const [code, hitNames = ''] = expected.split('+NEEDLE:');
  const present = hitNames.split('/').filter(Boolean);
  // Scan the complete success or refusal before checking its outcome. A refused
  // action leaves a live Memory: its recorded p2 reads contain forgotten text.
  const text = JSON.stringify(result);
  for (const needle of new Set([forgottenText, stepText, ...needles])) {
    const hit = (needle === forgottenText && present.includes('forgotten')) ||
      (needle === stepText && present.includes('step'));
    assert.equal(text.includes(needle), hit, 'whole result needle: ' + needle);
  }
  if (code === 'ok') {
    assert.equal(result.ok, true, JSON.stringify(result));
    return result.value;
  }
  assert.deepEqual(result, { ok: false, error: { code, retryable: false } });
}
export function episodeRole(row) {
  const gist = JSON.parse(row.record).gist;
  if (gist.includes('consumerneedle')) return 'consumer';
  if (gist.includes('independent')) return 'independent';
  if (gist.includes('neighbour')) return 'neighbour';
  if (gist.includes('unknown episode')) return 'unknown';
  assert.ok(gist.includes(forgottenText) || gist.includes('unknown unnamed'), 'known source fixture role');
  return 'source';
}
