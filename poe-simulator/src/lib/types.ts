export type Slot = "Body Armour" | "Helmet" | "Gloves" | "Boots" | "Shield";

export interface UniqueItem {
  name: string;
  name_ko?: string | null;
  baseType: string;
  baseType_ko?: string | null;
  slot: Slot;
  icon: string;
  levelRequired: number;
  implicits: string[];
  explicits: string[];
  flavourText: string;
  isReplica: boolean;
  detailsId: string;
}

export type VestigialStatus = "confirmed" | "reported" | "unknown";

export interface VestigialEntry {
  mod: string | null;
  status: VestigialStatus;
  source?: string;
  notes?: string;
}

export interface CrystalInfo {
  name: string;
  name_ko?: string;
  slot: Slot | null;
  confirmed: boolean;
  source?: string;
}

export interface Eligibility {
  eligible: boolean;
  reasons: string[];
}
