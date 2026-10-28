import CONST from '@src/CONST';
import type {Policy, PolicyCategories} from '@src/types/onyx';

import {getAccountingConnectionNames} from './connections';
import {isPerDiemEnabled} from './customUnits';
import {isPolicyFeatureEnabled} from './features';

// The form names and DuplicatePolicy part names differ. Keep their feature eligibility
// together so retained configuration cannot offer or enable a disabled feature.
const COPY_FEATURES = {
    accounting: {part: 'connections', feature: CONST.POLICY.MORE_FEATURES.ARE_CONNECTIONS_ENABLED},
    tags: {part: 'tags', feature: CONST.POLICY.MORE_FEATURES.ARE_TAGS_ENABLED},
    taxes: {part: 'taxes', feature: CONST.POLICY.MORE_FEATURES.ARE_TAXES_ENABLED},
    workflows: {part: 'exportLayouts', feature: CONST.POLICY.MORE_FEATURES.ARE_WORKFLOWS_ENABLED},
    rules: {part: 'expenses', feature: CONST.POLICY.MORE_FEATURES.ARE_RULES_ENABLED},
    codingRules: {part: 'codingRules', feature: CONST.POLICY.MORE_FEATURES.ARE_RULES_ENABLED},
    distanceRates: {part: 'distance', feature: CONST.POLICY.MORE_FEATURES.ARE_DISTANCE_RATES_ENABLED},
    perDiem: {part: 'perDiem', feature: CONST.POLICY.MORE_FEATURES.ARE_PER_DIEM_RATES_ENABLED},
    invoices: {part: 'invoices', feature: CONST.POLICY.MORE_FEATURES.ARE_INVOICES_ENABLED},
    invoiceFields: {part: 'invoiceFields', feature: CONST.POLICY.MORE_FEATURES.ARE_INVOICES_ENABLED},
    reimbursements: {part: 'reimbursements', feature: CONST.POLICY.MORE_FEATURES.ARE_INVOICES_ENABLED},
    travel: {part: 'travel', feature: CONST.POLICY.MORE_FEATURES.IS_TRAVEL_ENABLED},
} as const;

function isDuplicateWorkspaceFeatureEnabled(policy: Policy | undefined, name: string, categories?: PolicyCategories): boolean {
    if (name === 'accounting') {
        return getAccountingConnectionNames().some((connectionName) => !!policy?.connections?.[connectionName]);
    }
    if (name === 'perDiem') {
        return isPerDiemEnabled(policy);
    }
    const definition = Object.entries(COPY_FEATURES).find(([key]) => key === name)?.[1];
    return !definition || isPolicyFeatureEnabled(policy, definition.feature, categories);
}

function getValidDuplicateWorkspaceParts(policy: Policy, parts: Record<string, boolean>, categories?: PolicyCategories): Record<string, boolean> {
    return Object.fromEntries(
        Object.entries(parts).map(([part, selected]) => {
            const definition = Object.entries(COPY_FEATURES).find(([, entry]) => entry.part === part);
            return [part, selected && (!definition || isDuplicateWorkspaceFeatureEnabled(policy, definition[0], categories))];
        }),
    );
}

function getDuplicateWorkspaceFeatureState(policy: Policy, parts: Record<string, boolean>, categories?: PolicyCategories) {
    const copied = (name: keyof typeof COPY_FEATURES) => !!parts[COPY_FEATURES[name].part] && isDuplicateWorkspaceFeatureEnabled(policy, name, categories);

    // Categories and MCP have new-workspace defaults. Features with no duplication part
    // start without the source workspace's setup; supported features require an enabled source and selection.
    return {
        areCategoriesEnabled: true,
        areCompanyCardsEnabled: policy.type !== CONST.POLICY.TYPE.SUBMIT,
        areTagsEnabled: copied('tags'),
        areDistanceRatesEnabled: copied('distanceRates'),
        areInvoicesEnabled: copied('invoices'),
        areRulesEnabled: copied('rules') || copied('codingRules'),
        areWorkflowsEnabled: copied('workflows'),
        areReportFieldsEnabled: !!parts.reports && !!policy.areReportFieldsEnabled,
        areInvoiceFieldsEnabled: !!parts.invoiceFields && !!policy.areInvoiceFieldsEnabled,
        areConnectionsEnabled: copied('accounting'),
        arePerDiemRatesEnabled: copied('perDiem'),
        isTravelEnabled: copied('travel'),
        isHREnabled: false,
        isRecruitingEnabled: false,
        areExpensifyCardsEnabled: false,
        isMCPEnabled: true,
        tax: {trackingEnabled: copied('taxes')},
        receiptPartners: {enabled: false},
        units: {time: {enabled: false}},
    } satisfies Partial<Policy>;
}

export {isDuplicateWorkspaceFeatureEnabled, getValidDuplicateWorkspaceParts, getDuplicateWorkspaceFeatureState};
