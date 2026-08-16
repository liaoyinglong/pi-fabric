export interface FabricCapabilityRequirement {
  ref: string;
  optional?: boolean;
}

/** Generic provider-generation lease used by ActionRegistry. */
export interface FabricComponentProviderLease {
  readonly bindingId: string;
  readonly name: string;
  readonly generation: number;
  readonly active: boolean;
  retire(): void;
  release(): Promise<void>;
}
