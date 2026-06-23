// Data-as-code abilities, grouped into weapon MASTERIES (GDD §B2: the three
// weapon trees act as the "classes"). The active mastery comes from the equipped
// weapon (unarmed -> Sword, the starter style); the sim reads the active kit for
// the action bar and ability resolution. Numbers are provisional and grounded
// loosely in a WoW-Classic profile (instant casts on the global cooldown that
// cost resource and out-hit the auto-attack). Tune later.
import type { StatusKind, MasteryId, DamageType } from '../../world_api';
import type { ItemStats } from './items';

// A status effect an ability applies on cast. Durations in seconds (the sim
// converts to ticks). magnitude carries the per-kind parameter.
export interface AbilityEffectDef {
  kind: StatusKind;
  durationSecs: number;
  magnitude?: number; // slow/defense: factor in (0,1]; crit: added crit chance; dot: damage/tick
  periodSecs?: number; // dot: seconds between damage ticks
}

export interface AbilityDef {
  id: string;
  name: string;
  slot: number; // action-bar slot (1-based)
  icon: string; // glyph shown on the HUD slot (presentation data, no logic)
  mpCost: number;
  cooldownSecs: number; // the ability's OWN cooldown (on top of the global one)
  // 'strike': damage on the current enemy target (effects debuff it). 'buff':
  // self-cast, no target/range — effects apply to the caster.
  kind: 'strike' | 'buff';
  // Strike shape: 'single' hits the target; 'cone' sweeps every enemy in front
  // within reach. Default 'single'.
  shape?: 'single' | 'cone';
  charge?: boolean; // strike: dash to the target first (a gap-closer); castable from afar
  castRange?: number; // charge: max distance to initiate from (units)
  damageMultiplier?: number; // strike: scales the base melee hit so it out-hits the auto-attack
  effects?: AbilityEffectDef[]; // status effects applied on a successful cast
}

// ---- Sword / Escudo: durable melee, stun + block (GDD: "Espada → stun e bloqueio")
const SWORD_ABILITIES: AbilityDef[] = [
  {
    id: 'strong_strike',
    name: 'Golpe Forte',
    slot: 1,
    icon: '⚔', // crossed swords
    mpCost: 15,
    cooldownSecs: 6,
    kind: 'strike',
    damageMultiplier: 2.0,
    // A heavy blow: big up-front hit, leaves the target bleeding and hobbled so
    // it can't easily disengage from the durable swordsman.
    effects: [
      { kind: 'slow', durationSecs: 3.0, magnitude: 0.5 },
      { kind: 'dot', durationSecs: 2.0, magnitude: 2, periodSecs: 0.5 },
    ],
  },
  {
    id: 'defensive_stance',
    name: 'Postura Defensiva',
    slot: 2,
    icon: '🛡', // shield — Espada's block/absorption
    mpCost: 20,
    cooldownSecs: 15,
    kind: 'buff',
    // Brace for 6s, taking half incoming damage — a Shield-Block-style cooldown
    // on a window shorter than its cooldown, so it's a planned mitigation.
    effects: [{ kind: 'defense', durationSecs: 6.0, magnitude: 0.5 }],
  },
  {
    id: 'stunning_blow',
    name: 'Atordoamento',
    slot: 3,
    icon: '💫', // dizzy — the Sword's signature control (GDD: "Espada → stun")
    mpCost: 20,
    cooldownSecs: 10,
    kind: 'strike',
    damageMultiplier: 1.0, // a control tool, not a nuke — the value is the stun
    effects: [{ kind: 'stun', durationSecs: 1.0 }],
  },
];

// ---- Lança: high single-target damage, crit, and area sweeps (GDD: "Lança →
// knockdown + sangramento"; passivo: aumenta vida). A longer reach than a sword.
const SPEAR_ABILITIES: AbilityDef[] = [
  {
    id: 'thrust',
    name: 'Estocada',
    slot: 1,
    icon: '🔱', // trident — a powerful piercing thrust
    mpCost: 15,
    cooldownSecs: 6,
    kind: 'strike',
    damageMultiplier: 2.5, // the spear's heavy single-target hit
    effects: [{ kind: 'knockdown', durationSecs: 1.0 }], // Lança's signature control
  },
  {
    id: 'sweep',
    name: 'Varredura',
    slot: 2,
    icon: '🌀', // swirl — an arcing sweep that hits everything in front
    mpCost: 20,
    cooldownSecs: 8,
    kind: 'strike',
    shape: 'cone',
    damageMultiplier: 1.2, // per enemy caught in the sweep
    effects: [{ kind: 'dot', durationSecs: 2.0, magnitude: 2, periodSecs: 0.5 }], // bleed
  },
  {
    id: 'charge',
    name: 'Investida',
    slot: 3,
    icon: '➹', // arrow — a dash that closes the gap to the target
    mpCost: 15,
    cooldownSecs: 8,
    kind: 'strike',
    charge: true,
    castRange: 12, // can be launched from well outside melee
    damageMultiplier: 1.0,
  },
  {
    id: 'fury',
    name: 'Fúria',
    slot: 4,
    icon: '🔥', // fire — a battle fury that guarantees critical hits for a while
    mpCost: 25,
    cooldownSecs: 18,
    kind: 'buff',
    effects: [{ kind: 'crit', durationSecs: 5.0, magnitude: 1.0 }], // +100% crit chance window
  },
];

// ---- Arco: ranged single-target damage; survives by keeping its distance (GDD:
// "Arco → slow (kiting) + tiro perfurante"; passivo: aumenta precisão). The long
// reach makes the auto-attack ("auto-shot") and abilities fire from afar.
const BOW_ABILITIES: AbilityDef[] = [
  {
    id: 'charged_shot',
    name: 'Tiro Carregado',
    slot: 1,
    icon: '🏹', // bow — a heavy, piercing single-target shot
    mpCost: 18,
    cooldownSecs: 6,
    kind: 'strike',
    damageMultiplier: 3.0, // the bow's big single-target hit (GDD: "forte em alvo único")
  },
  {
    id: 'multi_shot',
    name: 'Tiro Múltiplo',
    slot: 2,
    icon: '🎯', // target — a volley that strikes everything in the firing arc
    mpCost: 20,
    cooldownSecs: 8,
    kind: 'strike',
    shape: 'cone',
    damageMultiplier: 1.0, // per enemy in the volley
  },
  {
    id: 'slowing_shot',
    name: 'Tiro Lento',
    slot: 3,
    icon: '🥶', // frost — a crippling shot that slows, the bow's kiting tool
    mpCost: 15,
    cooldownSecs: 7,
    kind: 'strike',
    damageMultiplier: 1.5,
    effects: [{ kind: 'slow', durationSecs: 3.0, magnitude: 0.5 }], // GDD: "Arco → slow (kiting)"
  },
];

// ---- Mago / Cajado: ranged MAGICAL damage scaling with Intelligence (G1). The first
// class to deal magical damage (reduced by Int magic-resist, not armor). Reuses the
// existing dot (burn) and slow (chill) effects — no new status kinds. (GDD: "Mago →
// dano mágico à distância".)
const MAGE_ABILITIES: AbilityDef[] = [
  {
    id: 'fireball',
    name: 'Bola de Fogo',
    slot: 1,
    icon: '🔥', // fire — the Mago's signature ranged nuke
    mpCost: 18,
    cooldownSecs: 6,
    kind: 'strike',
    damageMultiplier: 3.0, // a big single-target hit (mirrors the bow's Tiro Carregado)
    effects: [{ kind: 'dot', durationSecs: 2.0, magnitude: 3, periodSecs: 0.5 }], // lingering burn
  },
  {
    id: 'flame_wave',
    name: 'Onda de Chamas',
    slot: 2,
    icon: '🌋', // erupting flames — an arc that scorches everything in front
    mpCost: 22,
    cooldownSecs: 9,
    kind: 'strike',
    shape: 'cone',
    damageMultiplier: 1.2, // per enemy caught in the wave
    effects: [{ kind: 'dot', durationSecs: 2.0, magnitude: 2, periodSecs: 0.5 }], // burn on each
  },
  {
    id: 'frost_bolt',
    name: 'Lança de Gelo',
    slot: 3,
    icon: '❄', // frost — a chilling bolt that slows, the Mago's kiting tool
    mpCost: 15,
    cooldownSecs: 7,
    kind: 'strike',
    damageMultiplier: 1.5,
    effects: [{ kind: 'slow', durationSecs: 3.0, magnitude: 0.5 }], // chill -> kiting
  },
];

export interface MasteryDef {
  id: MasteryId;
  name: string;
  ranged: boolean; // ranged masteries shoot at distance (no frontal facing gate; pivot to fire)
  attackRange?: number; // units the auto-attack/abilities reach (undefined -> the sim's melee range)
  baseCrit?: number; // always-on crit chance (0..1) — the Arco "precision" passive
  // Damage type this mastery's auto-attack and abilities deal (default 'physical').
  // The Mago is 'magical' (scales with Int, reduced by magic-resist). Omitting it
  // keeps the physical classes byte-identical.
  damageType?: DamageType;
  passive: ItemStats; // always-on bonus folded into stats while this mastery is active
  abilities: AbilityDef[];
}

export const MASTERIES: Record<MasteryId, MasteryDef> = {
  sword: {
    id: 'sword',
    name: 'Espada',
    ranged: false,
    // attackRange omitted -> the sim's default melee range, so the starter feels unchanged.
    passive: {}, // block/absorption is delivered actively via Postura Defensiva for now
    abilities: SWORD_ABILITIES,
  },
  spear: {
    id: 'spear',
    name: 'Lança',
    ranged: false,
    attackRange: 3.0, // a reach weapon: a little longer than a sword
    passive: { maxHp: 30 }, // GDD: "Lança — passivo: aumenta vida"
    abilities: SPEAR_ABILITIES,
  },
  bow: {
    id: 'bow',
    name: 'Arco',
    ranged: true,
    attackRange: 14, // shoots from well outside a wolf's aggro radius — kite and pick targets
    baseCrit: 0.15, // GDD: "Arco — passivo: aumenta precisão" (a steady chance to crit)
    passive: {},
    abilities: BOW_ABILITIES,
  },
  mage: {
    id: 'mage',
    name: 'Mago',
    ranged: true, // casts from range, pivoting to fire (like the bow)
    attackRange: 12, // staff reach — a bit shorter than the bow's 14
    baseCrit: 0.05, // crit comes from the WEAPON (a small steady chance); Int does NOT add crit
    damageType: 'magical', // staff hits scale with Int and are reduced by magic-resist
    passive: { maxMp: 30 }, // a caster's deeper mana pool
    abilities: MAGE_ABILITIES,
  },
};

// Unarmed (or a weapon with no mastery) falls back to the Sword tree — the
// starter style every character begins with.
export const DEFAULT_MASTERY: MasteryId = 'sword';

// Back-compat alias: the bare Sword kit (the default action bar). Tests and any
// caller that means "the starter abilities" use this.
export const ABILITIES = SWORD_ABILITIES;
