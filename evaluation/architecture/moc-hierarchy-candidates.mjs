import { generateMocCandidates as navigate } from '../../core/moc-recall-candidates.mjs';

// H1 retains its public-map semantics and original scripted select port.
export function generateMocCandidates({ groupModel, ...input }) {
  return navigate({ ...input, groupModel: { ...groupModel,
    selectGroups: groupModel?.select?.bind(groupModel) } });
}
