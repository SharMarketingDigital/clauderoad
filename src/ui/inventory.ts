// UI labels for the equipment slots (the K1 Silkroad set). Pure data the HUD reads to
// render each slot (and later the character sheet, K6). Imports only the seam — no
// sim/DOM dependency. NOTE: distinct from src/sim/inventory.ts (the sim leaf that owns
// EQUIP_SLOTS/BAG_SLOTS); the canonical slot order lives there as EQUIP_SLOTS.
import type { EquipSlot } from '../world_api';

export const SLOT_LABELS: Record<EquipSlot, string> = {
  weapon: 'Arma',
  shield: 'Escudo',
  helmet: 'Capacete',
  chest: 'Colete',
  hands: 'Luvas',
  legs: 'Calça',
  feet: 'Botas',
  necklace: 'Colar',
  earring: 'Brinco',
  ring: 'Anel',
};
