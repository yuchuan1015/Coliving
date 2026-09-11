export type PetWishDraft = { requested_name: string; requested_species: string; appearance_description: string };
export const validWishDraft = (draft: PetWishDraft) =>
  [draft.requested_name, draft.requested_species].every(v => typeof v === "string" && !!v.trim() && [...v].length <= 64) &&
  typeof draft.appearance_description === "string" && !!draft.appearance_description.trim() && [...draft.appearance_description].length <= 2000;
