// The character body skin per weapon mastery ("class") — GDD G1 Visual Fatia 1.
//
// All four are KayKit Adventurers models that share the SAME Rig_Medium skeleton (verified:
// identical handslot.r/.l + upperarm.r + root bones), so the one set of Idle/Walk clips, the
// procedural attack swing, and the hand-slot weapon attach all work unchanged on every skin.
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
