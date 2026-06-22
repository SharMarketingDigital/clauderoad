// Character PERSISTENCE (data only — NOT gameplay). Serializes a player's progression to
// a plain JSON-safe object and applies a (possibly untrusted) saved object back onto a
// player entity, DEFENSIVELY. This never reads/writes any gameplay rule, formula, RNG, or
// tick logic — it only moves the progression DATA in and out. The Sim's serializePlayer/
// restorePlayer wrap these; the offline single-player never calls them.
//
// Hard rule: applySave must NEVER throw or produce invalid state from bad input. Anything
// missing/corrupt is dropped and the entity keeps its fresh-spawn value, so a garbage DB
// row can't break the Sim. The caller (Sim) recomputes derived stats afterwards.
import type { Entity, ItemStack, EquippedItem } from './types';
import type { EquipSlot, Rarity } from '../world_api';
import { ITEMS } from './content/items';
import { BAG_SLOTS } from './inventory';
import { MAX_PLUS } from './content/enhance';
import { SKILL_MAX_RANK } from './content/skill_ranks';
import { MAX_DURABILITY } from './content/durability';

// The persistent slice of a character (what defines its progression). Plain + JSON-safe.
// Excludes derived stats (str/maxHp/… — recomputed) and transient combat/position state.
export interface PlayerSave {
  level: number;
  xp: number;
  attrPoints: number;
  baseStr: number;
  baseInt: number;
  baseMaxHp: number;
  baseMaxMp: number;
  sp: number;
  skillRanks: Record<string, number>;
  gold: number;
  bag: ItemStack[];
  equipment: { weapon: EquippedItem | null; armor: EquippedItem | null };
}

// Read the persistent progression off a player entity into a fresh, JSON-safe object
// (deep-copied so it never aliases the entity's own arrays/maps).
export function toSave(e: Entity): PlayerSave {
  return {
    level: e.level,
    xp: e.xp,
    attrPoints: e.attrPoints,
    baseStr: e.baseStr,
    baseInt: e.baseInt,
    baseMaxHp: e.baseMaxHp,
    baseMaxMp: e.baseMaxMp,
    sp: e.sp,
    skillRanks: { ...e.skillRanks },
    gold: e.gold,
    bag: e.bag.map((s) => ({ itemId: s.itemId, rarity: s.rarity, plus: s.plus, qty: s.qty })),
    equipment: {
      weapon: e.equipment.weapon ? { ...e.equipment.weapon } : null,
      armor: e.equipment.armor ? { ...e.equipment.armor } : null,
    },
  };
}

// Apply an UNTRUSTED saved object onto a player entity, field by field. Every value is
// validated; an invalid scalar keeps the entity's current (fresh-spawn) value, and an
// invalid bag/equipment/ranks resets to empty (= a fresh character). Never throws.
export function applySave(e: Entity, raw: unknown): void {
  if (!isObj(raw)) return; // not even an object -> leave the fresh spawn untouched
  if (isInt(raw.level) && raw.level >= 1) e.level = raw.level;
  if (isNum(raw.xp) && raw.xp >= 0) e.xp = raw.xp;
  if (isInt(raw.attrPoints) && raw.attrPoints >= 0) e.attrPoints = raw.attrPoints;
  if (isNum(raw.baseStr) && raw.baseStr >= 0) e.baseStr = raw.baseStr;
  if (isNum(raw.baseInt) && raw.baseInt >= 0) e.baseInt = raw.baseInt;
  if (isNum(raw.baseMaxHp) && raw.baseMaxHp > 0) e.baseMaxHp = raw.baseMaxHp; // must stay > 0 (HP pool)
  if (isNum(raw.baseMaxMp) && raw.baseMaxMp >= 0) e.baseMaxMp = raw.baseMaxMp;
  if (isInt(raw.sp) && raw.sp >= 0) e.sp = raw.sp;
  if (isNum(raw.gold) && raw.gold >= 0) e.gold = Math.floor(raw.gold);
  e.skillRanks = sanitizeRanks(raw.skillRanks);
  e.bag = sanitizeBag(raw.bag);
  const eq = sanitizeEquipment(raw.equipment);
  e.equipment.weapon = eq.weapon;
  e.equipment.armor = eq.armor;
}

// ---- validation helpers (pure) ----
function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function isInt(v: unknown): v is number {
  return isNum(v) && Number.isInteger(v);
}
function isRarity(v: unknown): v is Rarity {
  return v === 'normal' || v === 'sos' || v === 'som' || v === 'sun';
}
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function sanitizeRanks(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObj(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    // keep any ability id with a valid rank; unknown ids are harmless (the sim ignores them)
    if (isInt(v) && v >= 1 && v <= SKILL_MAX_RANK) out[k] = v;
  }
  return out;
}

function sanitizeBag(raw: unknown): ItemStack[] {
  if (!Array.isArray(raw)) return [];
  const out: ItemStack[] = [];
  for (const item of raw) {
    const st = sanitizeStack(item);
    if (st) out.push(st);
    if (out.length >= BAG_SLOTS) break; // never exceed the bag capacity
  }
  return out;
}
function sanitizeStack(raw: unknown): ItemStack | null {
  if (!isObj(raw)) return null;
  if (typeof raw.itemId !== 'string' || !ITEMS[raw.itemId]) return null; // unknown item -> drop
  if (!isRarity(raw.rarity)) return null;
  if (!isInt(raw.plus) || raw.plus < 0 || raw.plus > MAX_PLUS) return null;
  if (!isInt(raw.qty) || raw.qty < 1) return null;
  return { itemId: raw.itemId, rarity: raw.rarity, plus: raw.plus, qty: raw.qty };
}

function sanitizeEquipment(raw: unknown): { weapon: EquippedItem | null; armor: EquippedItem | null } {
  if (!isObj(raw)) return { weapon: null, armor: null };
  return { weapon: sanitizeEquipped(raw.weapon, 'weapon'), armor: sanitizeEquipped(raw.armor, 'armor') };
}
function sanitizeEquipped(raw: unknown, slot: EquipSlot): EquippedItem | null {
  if (!isObj(raw)) return null;
  if (typeof raw.itemId !== 'string' || ITEMS[raw.itemId]?.slot !== slot) return null; // unknown / wrong slot -> drop
  if (!isRarity(raw.rarity)) return null;
  if (!isInt(raw.plus) || raw.plus < 0 || raw.plus > MAX_PLUS) return null;
  const durability = isNum(raw.durability) ? clamp(raw.durability, 0, MAX_DURABILITY) : MAX_DURABILITY;
  return { itemId: raw.itemId, rarity: raw.rarity, plus: raw.plus, durability };
}
