/**
 * Same-source ablation switches, baked in by Vite `define` (see vite.config.ts /
 * vite.ablation.config.ts). The main arm is the skill-conformant build; each ablation arm
 * breaks exactly ONE absolute clause of the skill so the clause's price is measured rather
 * than argued:
 *
 *   virtual   — "virtual scrolling for lists" / "render only visible items"
 *   memo      — "React.memo: Expensive components"
 *   stableKey — "useSuspenseQuery with queryKey" (constant key ⇒ stable reference)
 */
export interface Arm {
  virtual: boolean;
  memo: boolean;
  stableKey: boolean;
}

declare global {
  const __FD_ARM__: Arm;
}

export const arm: Arm = typeof __FD_ARM__ === 'undefined' ? { virtual: true, memo: true, stableKey: true } : __FD_ARM__;
