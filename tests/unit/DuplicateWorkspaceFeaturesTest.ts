import {getDuplicateWorkspaceFeatureState, getValidDuplicateWorkspaceParts, isDuplicateWorkspaceFeatureEnabled} from '@libs/PolicyUtils/duplicateFeatures';

import CONST from '@src/CONST';
import type {Policy} from '@src/types/onyx';

import createRandomPolicy from '../utils/collections/policies';

describe('duplicate workspace feature contract compatibility', () => {
    const createLegacyPolicy = (): Policy => ({
        ...createRandomPolicy(104231, CONST.POLICY.TYPE.CORPORATE),
        customUnits: {
            daily: {customUnitID: 'daily', name: CONST.CUSTOM_UNITS.NAME_PER_DIEM_INTERNATIONAL, enabled: true, rates: {}},
        },
    });

    it('preserves enabled Per Diem on legacy workspaces with no explicit feature flag', () => {
        // Given an enabled legacy unit and no explicit toggle
        const policy = createLegacyPolicy();

        // When selecting the source feature for copying
        const parts = getValidDuplicateWorkspaceParts(policy, {perDiem: true});

        // Then the existing unit-based availability is preserved
        expect(isDuplicateWorkspaceFeatureEnabled(policy, 'perDiem')).toBe(true);
        expect(getDuplicateWorkspaceFeatureState(policy, parts).arePerDiemRatesEnabled).toBe(true);
    });

    it('respects an explicit disabled Per Diem flag despite a retained enabled unit', () => {
        // Given a disabled feature whose old configuration remains
        const policy = {...createLegacyPolicy(), arePerDiemRatesEnabled: false};

        // When stale selection data requests that feature
        const parts = getValidDuplicateWorkspaceParts(policy, {perDiem: true});

        // Then the stored configuration cannot turn the feature back on
        expect(parts.perDiem).toBe(false);
        expect(getDuplicateWorkspaceFeatureState(policy, parts).arePerDiemRatesEnabled).toBe(false);
    });

    it('preserves copying report metadata without enabling custom report fields', () => {
        // Given report metadata on a source with custom report fields disabled
        const policy = {...createLegacyPolicy(), areReportFieldsEnabled: false};

        // When the report settings part is selected
        const parts = getValidDuplicateWorkspaceParts(policy, {reports: true});

        // Then copying the data remains allowed without activating the separate feature toggle
        expect(parts.reports).toBe(true);
        expect(getDuplicateWorkspaceFeatureState(policy, parts).areReportFieldsEnabled).toBe(false);
    });

    it('rejects all invoicing aliases when the source feature is off', () => {
        // Given disabled Invoices and stale related part selections
        const policy = {...createLegacyPolicy(), areInvoicesEnabled: false};

        // When the request parts are normalized
        const parts = getValidDuplicateWorkspaceParts(policy, {invoices: true, invoiceFields: true, reimbursements: true});

        // Then the request cannot copy hidden aliases of the disabled feature
        expect(parts).toEqual({invoices: false, invoiceFields: false, reimbursements: false});
    });

    it('does not mutate source settings or the selections supplied by a caller', () => {
        // Given source flags and a selection object that a caller may keep using
        const policy = {...createLegacyPolicy(), areWorkflowsEnabled: false, isHREnabled: true};
        const selection = {exportLayouts: true, categories: true};

        // When deriving the duplicate's valid selection and state
        const parts = getValidDuplicateWorkspaceParts(policy, selection);
        getDuplicateWorkspaceFeatureState(policy, parts);

        // Then only the new selection is corrected and the source is unchanged
        expect(parts.exportLayouts).toBe(false);
        expect(selection).toEqual({exportLayouts: true, categories: true});
        expect(policy.areWorkflowsEnabled).toBe(false);
        expect(policy.isHREnabled).toBe(true);
    });
});
