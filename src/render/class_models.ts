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
