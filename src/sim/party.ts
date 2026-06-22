// Party (co-op group) — the sim's internal, mutable party state. The read-only
// PartyView the UI sees lives in world_api.ts; this is what the Sim owns and mutates
// (deterministically, via commands). Following Silkroad: the leader picks the XP mode
// and the loot mode at creation, and the XP mode caps the size (4 vs 8).
import type { PartyExpMode, PartyLootMode } from '../world_api';

export interface Party {
  id: number;
  leaderId: number; // player entity id of the leader
  members: number[]; // player entity ids; includes the leader; in join order
  expMode: PartyExpMode;
  lootMode: PartyLootMode;
}

export const PARTY_MAX_EACH_GET = 4; // "Exp Each Get": up to 4
export const PARTY_MAX_AUTO_SHARE = 8; // "Exp Auto Share": up to 8

// Capacity depends on the XP mode (Silkroad).
export function maxPartySize(exp: PartyExpMode): number {
  return exp === 'auto-share' ? PARTY_MAX_AUTO_SHARE : PARTY_MAX_EACH_GET;
}
