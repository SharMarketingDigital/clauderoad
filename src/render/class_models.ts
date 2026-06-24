// The character body skin per weapon mastery ("class") — GDD G1 Visual Fatia 1.
//
// All four are KayKit Adventurers models that share the SAME Rig_Medium skeleton (verified:
// identical handslot.r/.l + upperarm.r + root bones), so the one set of Idle/Walk clips, the
// per-weapon attack clips, and the hand-slot weapon attach all work unchanged on every skin.
// Presentation only — the sim never knows which model a class uses; it only exposes the
// mastery on each player's EntityView, and the renderer maps it here.
import type { MasteryId } from '../world_api';

export const MASTERY_MODEL: Record<MasteryId, string> = {
  sword: '/models/Knight.glb', // Espada & Escudo (the original avatar)
  spear: '/models/Barbarian.glb', // Lança
  bow: '/models/Ranger.glb', // Arqueiro
  mage: '/models/Mage.glb', // Mago
};

// The weapon model(s) a class wields, attached to the Rig_Medium hand-slot bones — GDD G1
// Visual Fatia 2. `rightHand` (handslot.r) is the wielded weapon (always present); `leftHand`
// (handslot.l) is an off-hand carried ONLY by Sword & Shield — bow/staff/spear are single-weapon
// and leave the left hand empty. Each .gltf ships with its own .bin + atlas in public/models/.
export interface ClassWeapon {
  rightHand: string; // model attached to handslot.r
  leftHand?: string; // model attached to handslot.l — only Sword & Shield has one
}

export const MASTERY_WEAPON: Record<MasteryId, ClassWeapon> = {
  sword: { rightHand: '/models/sword_1handed.gltf', leftHand: '/models/shield_round.gltf' },
  spear: { rightHand: '/models/spear_A.gltf' }, // lança — sem escudo
  bow: { rightHand: '/models/bow.gltf' }, // arco — sem escudo
  mage: { rightHand: '/models/staff.gltf' }, // cajado — sem escudo
};

// The KayKit Rig_Medium attack clip a class plays when it strikes — GDD G1 Visual Fatia 4.
// `attack` is the auto-attack / default ability hit; `heavy` (optional) is a weightier clip
// for a heavy hit (the Sword's Golpe Forte, slot 1). Clips ship in Rig_Medium_CombatMelee.glb
// (Melee_*) and Rig_Medium_CombatRanged.glb (Ranged_Bow_* / Ranged_Magic_*) — same rig as
// every skin, so they bind by bone name. Presentation only.
export interface ClassAttack {
  attack: string; // clip played on a normal attack
  heavy?: string; // clip played on a heavy hit (falls back to `attack` when absent)
}

export const MASTERY_ATTACK_CLIP: Record<MasteryId, ClassAttack> = {
  sword: { attack: 'Melee_1H_Attack_Slice_Diagonal', heavy: 'Melee_1H_Attack_Chop' }, // slice; Golpe Forte = chop
  spear: { attack: 'Melee_2H_Attack_Stab' }, // lança — estocada perfurante
  bow: { attack: 'Ranged_Bow_Release' }, // arco — disparo
  mage: { attack: 'Ranged_Magic_Shoot' }, // mago — conjuração/disparo mágico
};
