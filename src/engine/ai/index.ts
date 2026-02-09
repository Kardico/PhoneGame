/**
 * AI module barrel exports.
 *
 * Import all AI decision-making functions from this single entry point.
 */

// Production decisions
export { decideProduction } from './productionAI';

// Procurement (spot order) decisions
export { decideProcurement } from './procurementAI';

// Fulfillment (order acceptance) logic
export { sortOrdersByPriority, decideOrderFulfillment } from './fulfillmentAI';

// Contract AI (proposals + evaluation)
export { proposeContracts, evaluateContractProposals, getOrderBook } from './contractAI';
