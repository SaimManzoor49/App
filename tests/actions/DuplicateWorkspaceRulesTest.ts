import * as API from '@libs/API';
import {WRITE_COMMANDS} from '@libs/API/types';
import {arePolicyRulesEnabled, isPolicyFeatureEnabled} from '@libs/PolicyUtils';

import {INTERNAL_DO_NOT_USE_applyHTTPSOnyxUpdates} from '@userActions/OnyxUpdates';
import {duplicateWorkspace} from '@userActions/Policy/Policy';
import {flushQueue} from '@userActions/QueuedOnyxUpdates';

import CONST from '@src/CONST';
import IntlStore from '@src/languages/IntlStore';
import ONYXKEYS from '@src/ONYXKEYS';
import type {Policy, PolicyCategories} from '@src/types/onyx';

import Onyx from 'react-native-onyx';

import createRandomPolicy from '../utils/collections/policies';
import createMock from '../utils/createMock';
import getOnyxValue from '../utils/getOnyxValue';
import * as TestHelper from '../utils/TestHelper';
import waitForBatchedUpdates from '../utils/waitForBatchedUpdates';

const SOURCE_ID = '104231';
const TARGET_ID = '104232';
const TARGET_KEY = `${ONYXKEYS.COLLECTION.POLICY}${TARGET_ID}` as const;
const categories: PolicyCategories = {
    Travel: {name: 'Travel', enabled: true, maxAmountNoReceipt: 100, areCommentsRequired: true, externalID: 'travel-123'},
};

describe('duplicateWorkspace Rules state throughout the response', () => {
    let writeSpy: jest.SpiedFunction<typeof API.write>;

    beforeAll(() => {
        Onyx.init({keys: ONYXKEYS});
    });

    beforeEach(async () => {
        global.fetch = TestHelper.createGlobalFetchMock();
        IntlStore.load(CONST.LOCALES.EN);
        // eslint-disable-next-line rulesdir/no-multiple-api-calls -- This spy intercepts the single DuplicatePolicy write; it does not send a request.
        writeSpy = jest.spyOn(API, 'write').mockImplementation(() => Promise.resolve());
        await Onyx.clear();
        await Onyx.set(ONYXKEYS.SESSION, {email: 'contributor@example.com', accountID: 1});
        await waitForBatchedUpdates();
    });

    afterEach(async () => {
        await flushQueue();
        jest.restoreAllMocks();
        await Onyx.clear();
        await waitForBatchedUpdates();
    });

    it.each([
        {name: 'disabled Rules with a trailing server true', sourceRules: false, expenses: false, codingRules: false, serverRules: true, expected: false},
        {name: 'disabled Rules with a stale selection', sourceRules: false, expenses: true, codingRules: false, serverRules: true, expected: false},
        {name: 'disabled Rules with a null server flag', sourceRules: false, expenses: false, codingRules: false, serverRules: null, expected: false},
        {name: 'enabled Rules selected', sourceRules: true, expenses: true, codingRules: false, serverRules: true, expected: true},
        {name: 'enabled Rules deselected', sourceRules: true, expenses: false, codingRules: false, serverRules: true, expected: false},
        {name: 'merchant rules copied independently', sourceRules: true, expenses: false, codingRules: true, serverRules: true, expected: true},
        {name: 'migrated Control category rules', sourceRules: undefined, expenses: true, codingRules: false, serverRules: null, expected: true},
    ])('keeps $name consistent for every policy subscriber notification', async ({sourceRules, expenses, codingRules, serverRules, expected}) => {
        // Given a Control source with retained category rules and an observed target policy
        const sourcePolicy: Policy = {
            ...createRandomPolicy(Number(SOURCE_ID), CONST.POLICY.TYPE.CORPORATE),
            owner: 'contributor@example.com',
            ownerAccountID: 1,
            employeeList: {},
            areRulesEnabled: sourceRules,
        };
        const observedVisibility: boolean[] = [];
        const connection = Onyx.connect({
            key: TARGET_KEY,
            callback: (policy) => {
                if (!policy) {
                    return;
                }
                observedVisibility.push(arePolicyRulesEnabled(policy, categories));
            },
        });

        try {
            // When duplication and its potentially contradictory response use the real WRITE update queue
            duplicateWorkspace(sourcePolicy, {
                currentUserAccountID: 1,
                currentUserEmail: 'contributor@example.com',
                policyName: 'Rules experiment',
                policyID: SOURCE_ID,
                targetPolicyID: TARGET_ID,
                welcomeNote: 'Rules experiment',
                localCurrency: CONST.CURRENCY.USD,
                personalDetailsByLogins: {},
                policyCategories: categories,
                parts: {categories: true, expenses, codingRules},
            });
            const onyxData = writeSpy.mock.calls.at(-1)?.[2];
            if (!onyxData) {
                throw new Error('DuplicatePolicy did not include its Onyx updates');
            }
            await Onyx.update(onyxData.optimisticData ?? []);
            await waitForBatchedUpdates();
            const request = {
                command: WRITE_COMMANDS.DUPLICATE_POLICY,
                data: {apiRequestType: CONST.API_REQUEST_TYPE.WRITE},
                successData: onyxData.successData,
            };
            await INTERNAL_DO_NOT_USE_applyHTTPSOnyxUpdates(request, {jsonCode: 200, onyxData: [{onyxMethod: Onyx.METHOD.MERGE, key: TARGET_KEY, value: {areRulesEnabled: serverRules}}]}, 0);
            await flushQueue();
            await waitForBatchedUpdates();

            // Then neither an intermediate flash nor an incorrect final flag reaches subscribers, and category data is retained
            expect(observedVisibility.length).toBeGreaterThan(0);
            expect(observedVisibility.every((visible) => visible === expected)).toBe(true);
            const policy = await getOnyxValue(TARGET_KEY);
            expect(policy?.areRulesEnabled).toBe(expected);
            const copiedCategories = await getOnyxValue(`${ONYXKEYS.COLLECTION.POLICY_CATEGORIES}${TARGET_ID}`);
            expect(copiedCategories?.Travel).toMatchObject(categories.Travel);
        } finally {
            Onyx.disconnect(connection);
        }
    });

    it.each([
        {sourceEnabled: false, selected: false, copyAccounting: false},
        {sourceEnabled: false, selected: false, copyAccounting: true},
        {sourceEnabled: false, selected: true, copyAccounting: false},
        {sourceEnabled: false, selected: true, copyAccounting: true},
        {sourceEnabled: true, selected: false, copyAccounting: false},
        {sourceEnabled: true, selected: false, copyAccounting: true},
        {sourceEnabled: true, selected: true, copyAccounting: false},
        {sourceEnabled: true, selected: true, copyAccounting: true},
    ])('keeps feature state stable with source=$sourceEnabled, selected=$selected, accounting=$copyAccounting', async ({sourceEnabled, selected, copyAccounting}) => {
        // Given a source with enabled integrations and features that DuplicatePolicy does not copy
        const sourcePolicy = createMock<Policy>({
            ...createRandomPolicy(Number(SOURCE_ID), CONST.POLICY.TYPE.CORPORATE),
            owner: 'contributor@example.com',
            ownerAccountID: 1,
            employeeList: {},
            areRulesEnabled: sourceEnabled,
            areCompanyCardsEnabled: false,
            isHREnabled: true,
            isRecruitingEnabled: true,
            areExpensifyCardsEnabled: true,
            areInvoicesEnabled: sourceEnabled,
            areWorkflowsEnabled: sourceEnabled,
            areTagsEnabled: sourceEnabled,
            areDistanceRatesEnabled: sourceEnabled,
            arePerDiemRatesEnabled: sourceEnabled,
            isTravelEnabled: sourceEnabled,
            tax: {trackingEnabled: sourceEnabled},
            isMCPEnabled: false,
            receiptPartners: {enabled: true},
            units: {time: {enabled: true, rate: 15000}},
            connections: {
                [CONST.POLICY.CONNECTIONS.NAME.GUSTO]: {config: {}},
                [CONST.POLICY.CONNECTIONS.NAME.MERGE_HR]: {config: {}},
                [CONST.POLICY.CONNECTIONS.NAME.MERGE_ATS]: {config: {}},
                [CONST.POLICY.CONNECTIONS.NAME.QBO]: sourceEnabled ? {config: {}} : undefined,
            },
        });
        const getFeatureState = (policy: Policy) => ({
            hr: isPolicyFeatureEnabled(policy, CONST.POLICY.MORE_FEATURES.IS_HR_ENABLED),
            recruiting: isPolicyFeatureEnabled(policy, CONST.POLICY.MORE_FEATURES.IS_RECRUITING_ENABLED),
            time: isPolicyFeatureEnabled(policy, CONST.POLICY.MORE_FEATURES.IS_TIME_TRACKING_ENABLED),
            receipts: isPolicyFeatureEnabled(policy, CONST.POLICY.MORE_FEATURES.ARE_RECEIPT_PARTNERS_ENABLED),
            expensifyCards: isPolicyFeatureEnabled(policy, CONST.POLICY.MORE_FEATURES.ARE_EXPENSIFY_CARDS_ENABLED),
            mcp: isPolicyFeatureEnabled(policy, CONST.POLICY.MORE_FEATURES.IS_MCP_ENABLED),
            rules: arePolicyRulesEnabled(policy, categories),
            invoices: policy.areInvoicesEnabled,
            workflows: policy.areWorkflowsEnabled,
            accounting: policy.areConnectionsEnabled,
            companyCards: policy.areCompanyCardsEnabled,
            tags: policy.areTagsEnabled,
            distance: policy.areDistanceRatesEnabled,
            perDiem: policy.arePerDiemRatesEnabled,
            travel: policy.isTravelEnabled,
            taxes: policy.tax?.trackingEnabled,
        });
        const expected = {
            hr: false,
            recruiting: false,
            time: false,
            receipts: false,
            expensifyCards: false,
            mcp: true,
            rules: sourceEnabled && selected,
            invoices: sourceEnabled && selected,
            workflows: sourceEnabled && selected,
            accounting: sourceEnabled && copyAccounting,
            companyCards: true,
            tags: sourceEnabled && selected,
            distance: sourceEnabled && selected,
            perDiem: sourceEnabled && selected,
            travel: sourceEnabled && selected,
            taxes: sourceEnabled && selected,
        };
        const observedStates: Array<ReturnType<typeof getFeatureState>> = [];
        const connection = Onyx.connect({
            key: TARGET_KEY,
            callback: (policy) => {
                if (!policy) {
                    return;
                }
                observedStates.push(getFeatureState(policy));
            },
        });

        try {
            // When the duplicate is observed before and after its authoritative server feature flags arrive
            duplicateWorkspace(sourcePolicy, {
                currentUserAccountID: 1,
                currentUserEmail: 'contributor@example.com',
                policyName: 'Feature experiment',
                policyID: SOURCE_ID,
                targetPolicyID: TARGET_ID,
                welcomeNote: 'Feature experiment',
                localCurrency: CONST.CURRENCY.USD,
                personalDetailsByLogins: {},
                policyCategories: categories,
                parts: {
                    categories: true,
                    expenses: selected,
                    reimbursements: selected,
                    invoices: selected,
                    exportLayouts: selected,
                    connections: copyAccounting,
                    tags: selected,
                    taxes: selected,
                    distance: selected,
                    perDiem: selected,
                    travel: selected,
                },
            });
            const onyxData = writeSpy.mock.calls.at(-1)?.[2];
            if (!onyxData) {
                throw new Error('DuplicatePolicy did not include its Onyx updates');
            }
            await Onyx.update(onyxData.optimisticData ?? []);
            await waitForBatchedUpdates();
            await INTERNAL_DO_NOT_USE_applyHTTPSOnyxUpdates(
                {command: WRITE_COMMANDS.DUPLICATE_POLICY, data: {apiRequestType: CONST.API_REQUEST_TYPE.WRITE}, successData: onyxData.successData},
                {
                    jsonCode: 200,
                    onyxData: [
                        {
                            onyxMethod: Onyx.METHOD.MERGE,
                            key: TARGET_KEY,
                            value: {
                                areWorkflowsEnabled: true,
                                isHREnabled: false,
                                isRecruitingEnabled: false,
                                areExpensifyCardsEnabled: false,
                                isMCPEnabled: true,
                                receiptPartners: null,
                                units: {time: {enabled: false}},
                            },
                        },
                        {onyxMethod: Onyx.METHOD.MERGE, key: TARGET_KEY, value: {areWorkflowsEnabled: sourceEnabled && selected}},
                    ],
                },
                0,
            );
            await flushQueue();
            await waitForBatchedUpdates();

            // Then no excluded feature appears transiently, while chosen features and accounting connections remain available
            expect(observedStates.length).toBeGreaterThan(0);
            for (const state of observedStates) {
                expect(state).toEqual(expected);
            }
            const duplicate = await getOnyxValue(TARGET_KEY);
            expect(duplicate?.connections).toEqual(
                sourceEnabled && copyAccounting ? {[CONST.POLICY.CONNECTIONS.NAME.QBO]: sourcePolicy.connections?.[CONST.POLICY.CONNECTIONS.NAME.QBO]} : undefined,
            );
        } finally {
            Onyx.disconnect(connection);
        }
    });
});
