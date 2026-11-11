/**
 * Fictional demo data, created through the real services (so it obeys every rule).
 * All organisations and people are made up and marked "(sample)".
 */
import type { Actor } from './shared/actor.js';
import { addDays } from './shared/clock.js';
import { toMinor } from './shared/money.js';
import type { Platform } from './platform.js';

export const DEMO_TENANT = 'tnt_demo';

export const SUPPLIERS = [
  { supplierId: 'sup_granite', supplierName: 'Granite & Rebar Supply (sample)' },
  { supplierId: 'sup_riverside', supplierName: 'Riverside Concrete Works (sample)' },
  { supplierId: 'sup_summit', supplierName: 'Summit MEP Contractors (sample)' },
] as const;

const a = (userId: string, name: string, roles: Actor['roles'], supplierId?: string): Actor => ({
  userId,
  name,
  tenantId: DEMO_TENANT,
  roles,
  ...(supplierId ? { supplierId } : {}),
});

/** Demo personas. Emails/passwords for the API live in identity/demo-identities.ts. */
export const DEMO_ACTORS = {
  buyer: a('usr_buyer', 'Nadia Kamal (buyer)', ['buyer']),
  pm: a('usr_pm', 'Omar Said (project manager)', ['project_manager']),
  commercial: a('usr_cm', 'Laila Hassan (commercial manager)', ['commercial_manager']),
  director: a('usr_dir', 'Karim Mansour (director)', ['director']),
  granite: a('usr_granite', 'Hany Adel (Granite & Rebar, sample)', ['supplier'], 'sup_granite'),
  riverside: a('usr_riverside', 'Mona Fathy (Riverside Concrete, sample)', ['supplier'], 'sup_riverside'),
  summit: a('usr_summit', 'Tarek Nabil (Summit MEP, sample)', ['supplier'], 'sup_summit'),
} satisfies Record<string, Actor>;

export type PersonaKey = keyof typeof DEMO_ACTORS;

const usd = toMinor;

export async function seedDemo(p: Platform): Promise<{ structuralRfxId: string; mepRfxId: string; contractId: string }> {
  const { buyer, pm, commercial, granite, riverside, summit } = DEMO_ACTORS;
  const now = p.clock.now().toISOString();

  // 1. Structural package: three bids, closed early, levelled and awarded → contract + change orders.
  const structural = await p.sourcing.create(buyer, {
    type: 'RFQ',
    title: 'Structural works package — Tower B podium',
    projectName: 'Riverside Mixed-Use Development (sample)',
    currency: 'USD',
    bidDueAt: addDays(now, 7),
    lines: [
      { code: 'S-01', description: 'Reinforced concrete C40 to podium slabs', unit: 'm³', quantity: 1250 },
      { code: 'S-02', description: 'Rebar B500B, supply and fix', unit: 't', quantity: 180.5 },
      { code: 'S-03', description: 'Formwork to slab soffits', unit: 'm²', quantity: 4200 },
      { code: 'S-04', description: 'Post-tensioning tendons, complete', unit: 'lot', quantity: 1 },
      { code: 'S-05', description: 'Waterproofing membrane to podium deck', unit: 'm²', quantity: 3100 },
    ],
    suppliers: [...SUPPLIERS],
  });
  await p.sourcing.publish(buyer, structural.id);
  const [l1, l2, l3, l4, l5] = structural.lines.map((l) => l.id) as [string, string, string, string, string];
  await p.sourcing.submitBid(granite, structural.id, {
    lines: [
      { lineId: l1, unitPriceMinor: usd(145) },
      { lineId: l2, unitPriceMinor: usd(980) },
      { lineId: l3, unitPriceMinor: usd(32.5) },
      { lineId: l4, unitPriceMinor: usd(185_000) },
      { lineId: l5, unitPriceMinor: usd(18.4) },
    ],
    leadTimeDays: 120,
    validityDays: 90,
  });
  await p.sourcing.submitBid(riverside, structural.id, {
    lines: [
      { lineId: l1, unitPriceMinor: usd(138) },
      { lineId: l2, unitPriceMinor: usd(1015) },
      { lineId: l3, unitPriceMinor: usd(29.75) },
      { lineId: l5, unitPriceMinor: usd(17.9) },
    ],
    leadTimeDays: 110,
    validityDays: 60,
    exclusions: 'Post-tensioning excluded (by specialist).',
  });
  await p.sourcing.submitBid(summit, structural.id, {
    lines: [
      { lineId: l1, unitPriceMinor: usd(152) },
      { lineId: l2, unitPriceMinor: usd(995) },
      { lineId: l3, unitPriceMinor: usd(36) },
      { lineId: l4, unitPriceMinor: usd(210_000) },
      { lineId: l5, unitPriceMinor: usd(26) },
    ],
    leadTimeDays: 135,
    validityDays: 90,
  });
  await p.sourcing.close(buyer, structural.id);
  await p.sourcing.award(buyer, structural.id, { supplierId: 'sup_granite' });
  const contract = (await p.contracts.byRfx(buyer, structural.id))!;
  const sovRebar = contract.sov.find((s) => s.code === 'S-02')!.id;
  const sovWaterproofing = contract.sov.find((s) => s.code === 'S-05')!.id;

  // CO-001: supplier request, approved (PM → commercial).
  const co1 = await p.contracts.createChangeOrder(granite, contract.id, {
    title: 'Additional podium drainage',
    reason: 'DESIGN_CHANGE',
    description: 'Revised drainage layout adds floor drains and extra reinforcement around sleeves.',
    lines: [
      { kind: 'ADD', sovLineId: null, description: 'Floor drains and sleeves, cast-in', costType: 'MATERIAL', quantity: 24, unit: 'nr', unitPriceMinor: usd(450) },
      { kind: 'ADD', sovLineId: sovRebar, description: 'Trimming bars around sleeves', costType: 'MATERIAL', quantity: 6.2, unit: 't', unitPriceMinor: usd(980) },
    ],
    markupBps: 1_000,
    scheduleImpactDays: 5,
  });
  await p.contracts.submit(granite, co1.id);
  await p.contracts.decide(pm, co1.id, { decision: 'APPROVE', comment: 'Matches the revised drawing set.' });
  await p.contracts.decide(commercial, co1.id, { decision: 'APPROVE', comment: 'Rates in line with the bid.' });

  // CO-002: supplier-initiated value engineering, waiting for commercial approval, director step next.
  const co2 = await p.contracts.createChangeOrder(granite, contract.id, {
    title: 'Value engineering: alternative waterproofing system',
    reason: 'VALUE_ENGINEERING',
    description: 'Swap to a hot-applied membrane with a longer warranty; longer cure time.',
    lines: [
      { kind: 'OMIT', sovLineId: sovWaterproofing, description: 'Omit specified sheet membrane', costType: 'SUBCONTRACT', quantity: 3100, unit: 'm²', unitPriceMinor: usd(18.4) },
      { kind: 'ADD', sovLineId: null, description: 'Hot-applied membrane with protection board', costType: 'SUBCONTRACT', quantity: 3100, unit: 'm²', unitPriceMinor: usd(21.1) },
    ],
    markupBps: 1_200,
    scheduleImpactDays: 18,
  });
  await p.contracts.submit(granite, co2.id);
  await p.contracts.decide(pm, co2.id, { decision: 'APPROVE', comment: 'Technically acceptable.' });

  // 2. MEP package: open for bids, one of three in.
  const mep = await p.sourcing.create(buyer, {
    type: 'RFQ',
    title: 'MEP first-fix package — Tower B',
    projectName: 'Riverside Mixed-Use Development (sample)',
    currency: 'USD',
    bidDueAt: addDays(now, 10),
    lines: [
      { code: 'M-01', description: 'HVAC ductwork, galvanised, first fix', unit: 'm²', quantity: 2600 },
      { code: 'M-02', description: 'Chilled water pipework DN50–DN150', unit: 'm', quantity: 1850 },
      { code: 'M-03', description: 'Cable containment (tray + ladder)', unit: 'm', quantity: 3400 },
      { code: 'M-04', description: 'Fire sprinkler mains', unit: 'm', quantity: 950 },
    ],
    suppliers: [...SUPPLIERS],
  });
  await p.sourcing.publish(buyer, mep.id);
  const m = mep.lines.map((l) => l.id);
  await p.sourcing.submitBid(summit, mep.id, {
    lines: [
      { lineId: m[0]!, unitPriceMinor: usd(41) },
      { lineId: m[1]!, unitPriceMinor: usd(96.5) },
      { lineId: m[2]!, unitPriceMinor: usd(22.8) },
      { lineId: m[3]!, unitPriceMinor: usd(74) },
    ],
    leadTimeDays: 90,
    validityDays: 60,
  });

  // 3. A draft RFI.
  await p.sourcing.create(buyer, {
    type: 'RFI',
    title: 'Façade systems market sounding',
    projectName: 'Riverside Mixed-Use Development (sample)',
    currency: 'USD',
    bidDueAt: addDays(now, 14),
    lines: [
      { code: 'Q-01', description: 'Unitised curtain wall: typical lead time and capacity', unit: 'answer', quantity: 1 },
      { code: 'Q-02', description: 'Indicative rate per m² for a 4,000 m² façade', unit: 'answer', quantity: 1 },
    ],
    suppliers: [SUPPLIERS[0], SUPPLIERS[2]],
  });

  return { structuralRfxId: structural.id, mepRfxId: mep.id, contractId: contract.id };
}
