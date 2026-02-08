/**
 * AI module index — re-exports all AI decision functions.
 *
 * Architecture:
 * - productionAI: start/stop production lines
 * - procurementAI: order resources from suppliers
 * - fulfillmentAI: accept/decline/prioritize incoming orders
 *
 * Each module has tweakable parameters at the top that can be adjusted
 * to change AI behavior without modifying decision logic.
 */

export { decideProduction } from './productionAI';
export type { ProductionDecision } from './productionAI';

export { decideProcurement } from './procurementAI';
export type { ProcurementDecision } from './procurementAI';

export { sortOrdersByPriority, decideOrderFulfillment } from './fulfillmentAI';
